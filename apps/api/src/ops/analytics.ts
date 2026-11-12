import type { PrismaClient } from "../../../../generated/prisma/client.js";
import type { TransactionInput } from "../csvProcessing.js";
import { sumByCurrency, toMinorUnits, formatMinorUnits } from "../money.js";
import { ALLOWED_CURRENCIES, ALLOWED_STATUSES } from "../importValidation.js";

export type OpsTransaction = {
  transactionId: string; amount: string; currency: string; status: string;
  merchantId: string | null; failureReason: string | null; createdAt: string;
};
export type Snapshot = { source: "postgres" | "memory"; asOf: string; importId: string | null; rows: OpsTransaction[] };
export type Scope = { dateFrom?: string; dateTo?: string; currency?: string; merchantId?: string; status?: string; search?: string; limit?: number };
export type Fact = { id: string; label: string; value: string | number; unit: string };
export type Finding = { id: string; rule: "possible_duplicate" | "failure_spike"; severity: "review"; description: string; transactionIds: string[]; evidence: Record<string, unknown> };
export type ToolResult = { source: Snapshot["source"]; asOf: string; importId: string | null; scope: Scope; facts: Fact[]; findings: Finding[]; data: unknown; warnings: string[] };
export const MAX_ROWS = 10000;
const DAY = 86400000;

// One bounded snapshot per question: subsequent tool calls see the same rows.
// Never silently sample, or switch to memory after a database query fails.
export async function loadSnapshot(prisma: PrismaClient | null, local: TransactionInput[], importId?: string): Promise<Snapshot> {
  const asOf = new Date().toISOString();
  const rows = prisma
    ? await prisma.transaction.findMany({
        where: importId ? { importId } : undefined,
        select: { transactionId: true, amount: true, currency: true, status: true, merchantId: true, failureReason: true, createdAt: true },
        orderBy: [{ createdAt: "asc" }, { transactionId: "asc" }], take: MAX_ROWS + 1,
      })
    : local.filter((row) => !importId || row.importId === importId);
  if (rows.length > MAX_ROWS) throw new Error(`Investigation exceeds ${MAX_ROWS} rows. Select a smaller import.`);
  return {
    source: prisma ? "postgres" : "memory", asOf, importId: importId ?? null,
    rows: rows.map((row) => ({
      transactionId: row.transactionId, amount: formatMinorUnits(toMinorUnits(String(row.amount))), currency: row.currency, status: row.status,
      merchantId: row.merchantId ?? null, failureReason: row.failureReason, createdAt: row.createdAt.toISOString(),
    })).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.transactionId.localeCompare(b.transactionId)),
  };
}

export function parseScope(input: unknown, search = false): Scope {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Tool input must be an object");
  const values = input as Record<string, unknown>;
  const allowed = ["dateFrom", "dateTo", "currency", "merchantId", ...(search ? ["status", "search", "limit"] : [])];
  if (Object.keys(values).some((key) => !allowed.includes(key))) throw new Error("Unsupported tool argument");
  const scope: Scope = {};
  for (const key of allowed) {
    const value = values[key];
    if (value === undefined) continue;
    if (key === "limit") {
      if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 50) throw new Error("limit must be between 1 and 50");
      scope.limit = Number(value); continue;
    }
    if (typeof value !== "string" || !value.length || value.length > 120) throw new Error(`Invalid ${key}`);
    if (key === "dateFrom" || key === "dateTo") {
      const date = new Date(value);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error(`Invalid ${key}; use YYYY-MM-DD`);
    }
    if (key === "currency" && !ALLOWED_CURRENCIES.has(value)) throw new Error("Unsupported currency");
    if (key === "status" && !ALLOWED_STATUSES.has(value)) throw new Error("Unsupported status");
    if (key === "merchantId" && !/^[A-Za-z0-9_-]{1,80}$/.test(value)) throw new Error("Invalid merchantId");
    Object.assign(scope, { [key]: value });
  }
  if (scope.dateFrom && scope.dateTo && scope.dateFrom > scope.dateTo) throw new Error("dateFrom must precede dateTo");
  return scope;
}

export function selectRows(snapshot: Snapshot, scope: Scope) {
  return snapshot.rows.filter((row) => {
    const day = row.createdAt.slice(0, 10);
    return (!scope.dateFrom || day >= scope.dateFrom) && (!scope.dateTo || day <= scope.dateTo)
      && (!scope.currency || row.currency === scope.currency) && (!scope.merchantId || row.merchantId === scope.merchantId)
      && (!scope.status || row.status === scope.status) && (!scope.search || row.transactionId.toLowerCase().includes(scope.search.toLowerCase()));
  });
}
const rate = (failed: number, total: number) => total ? Math.round(failed * 10000 / total) / 100 : 0;
const counts = (rows: OpsTransaction[]) => ({ total: rows.length, failed: rows.filter((r) => r.status === "FAILED").length });

export function runAnalytics(name: string, input: unknown, snapshot: Snapshot, callId: string): ToolResult {
  if (!["get_summary", "search_transactions", "find_duplicates", "flag_anomalies"].includes(name)) throw new Error("Unknown tool");
  const scope = parseScope(input, name === "search_transactions");
  const rows = selectRows(snapshot, scope);
  const result: ToolResult = {
    source: snapshot.source, asOf: snapshot.asOf, importId: snapshot.importId, scope, facts: [], findings: [], data: null,
    warnings: ["Synthetic demonstration data only. Findings require human review; recorded reasons do not establish root cause."],
  };
  const fact = (key: string, label: string, value: string | number, unit = "transactions") => result.facts.push({ id: `${callId}.${key}`, label, value, unit });
  if (snapshot.source === "memory") result.warnings.push("In-memory demo storage: data is lost when the API restarts.");
  if (!rows.length) result.warnings.push("No transactions match the selected scope.");

  if (name === "get_summary") {
    const failed = rows.filter((row) => row.status === "FAILED").length;
    const successful = rows.filter((row) => row.status === "SUCCESS").length;
    fact("total", "Total transactions", rows.length);
    fact("failed", "Failed transactions", failed);
    fact("successful", "Successful transactions", successful);
    fact("pending", "Pending transactions", rows.length - failed - successful);
    fact("failure_rate", "Failure rate", rate(failed, rows.length), "%");
    fact("success_rate", "Success rate", rate(successful, rows.length), "%");
    const totals = sumByCurrency(rows);
    for (const total of totals) fact(`processed_${total.currency}`, "Processed amount", total.amount, total.currency);
    const reasons = new Map<string, number>();
    for (const row of rows.filter((r) => r.status === "FAILED")) {
      const reason = row.failureReason || "Not recorded";
      reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
    }
    // Group values are data, never instructions. Limit output size explicitly.
    const breakdown = [...reasons].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    breakdown.slice(0, 20).forEach(([reason, count], index) => fact(`reason_${index}`, `Recorded reason: ${reason}`, count));
    if (breakdown.length > 20) result.warnings.push("Only the top 20 recorded failure reasons are shown.");
    result.data = { processedAmountsByCurrency: totals, reasons: breakdown.slice(0, 20).map(([reason, count]) => ({ reason, count })) };
  }
  if (name === "search_transactions") {
    fact("matches", "Matching transactions", rows.length);
    const limit = scope.limit ?? 20;
    result.data = { transactions: rows.slice(0, limit), returned: Math.min(limit, rows.length), truncated: rows.length > limit };
    if (rows.length > limit) result.warnings.push("Search results are truncated. Narrow the filters; counts cover all matching rows.");
  }
  if (name === "find_duplicates") {
    // Equal merchant + currency + successful amount within a fixed five-minute
    // window anchored at the first transaction. Retry/failure pairs are excluded.
    const groups = new Map<string, OpsTransaction[]>();
    let missingMerchant = 0;
    for (const row of rows) {
      if (!row.merchantId) { missingMerchant++; continue; }
      if (row.status !== "SUCCESS") continue;
      const key = JSON.stringify([row.merchantId, row.currency, formatMinorUnits(toMinorUnits(row.amount))]);
      const existing = groups.get(key) ?? [];
      existing.push(row); groups.set(key, existing);
    }
    let candidateGroups = 0;
    for (const transactions of groups.values()) {
      let cluster: OpsTransaction[] = [];
      const flush = () => {
        if (cluster.length < 2) return;
        candidateGroups++;
        if (result.findings.length < 20) result.findings.push({
          id: `${callId}.duplicate_${candidateGroups}`, rule: "possible_duplicate", severity: "review",
          description: "Successful payments share a merchant, currency and amount within a five-minute window; this does not prove a duplicate charge.",
          transactionIds: cluster.slice(0, 50).map((r) => r.transactionId),
          evidence: { merchantId: cluster[0].merchantId, currency: cluster[0].currency, amount: cluster[0].amount, count: cluster.length, firstAt: cluster[0].createdAt, lastAt: cluster.at(-1)!.createdAt, windowSeconds: 300, transactionIdsTruncated: cluster.length > 50 },
        });
      };
      for (const row of transactions) {
        if (cluster.length && Date.parse(row.createdAt) - Date.parse(cluster[0].createdAt) > 300000) { flush(); cluster = []; }
        cluster.push(row);
      }
      flush();
    }
    fact("groups", "Possible duplicate groups", candidateGroups, "groups");
    fact("missing_merchant", "Rows without merchant information", missingMerchant);
    if (missingMerchant) result.warnings.push("Rows without merchantId are excluded from duplicate checks; no inferred merchant identities.");
    if (candidateGroups > 20) result.warnings.push("Only the first 20 duplicate groups are shown.");
    result.data = { rule: "same_merchant_currency_amount_success_within_5_minutes", candidateGroups };
  }
  if (name === "flag_anomalies") {
    const days = [...new Set(rows.map((row) => row.createdAt.slice(0, 10)))].sort();
    let spikeCount = 0;
    let insufficient = 0;
    for (const day of days) {
      const previousDay = new Date(Date.parse(day) - DAY).toISOString().slice(0, 10);
      const current = counts(rows.filter((row) => row.createdAt.startsWith(day)));
      // Include the prior calendar day even when it precedes the requested range;
      // preserve merchant/currency filters. Missing days are not bridged.
      const previous = counts(selectRows(snapshot, { ...scope, dateFrom: previousDay, dateTo: previousDay }));
      if (current.total < 5 || previous.total < 5) { insufficient++; continue; }
      const change = Math.round((current.failed / current.total - previous.failed / previous.total) * 10000) / 100;
      if (change < 20) continue;
      spikeCount++;
      if (result.findings.length >= 20) continue;
      fact(`rate_${day}`, `Failure rate on ${day}`, rate(current.failed, current.total), "%");
      fact(`baseline_${day}`, `Failure rate on ${previousDay}`, rate(previous.failed, previous.total), "%");
      fact(`change_${day}`, `Failure rate increase on ${day}`, change, "percentage points");
      if (result.findings.length < 20) result.findings.push({
        id: `${callId}.spike_${day}`, rule: "failure_spike", severity: "review",
        description: "Failure rate increased by at least twenty percentage points from the previous UTC calendar day, with at least five payments on each day.",
        transactionIds: [], evidence: { day, previousDay, current, previous, changePercentagePoints: change },
      });
    }
    fact("spikes", "Failure spike days", spikeCount, "days");
    fact("insufficient", "Days without enough comparison data", insufficient, "days");
    if (insufficient) result.warnings.push("Some days have fewer than five transactions or lack a prior-day baseline. No conclusion can be drawn for those days.");
    if (spikeCount > 20) result.warnings.push("Only the first 20 spike findings are shown.");
    result.data = { rule: "daily_failure_rate_increase_20_percentage_points_minimum_5_each_day", timezone: "UTC", spikeCount };
  }
  return result;
}
