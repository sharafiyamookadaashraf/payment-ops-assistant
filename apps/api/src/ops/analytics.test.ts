import test from "node:test";
import assert from "node:assert/strict";
import { runAnalytics, parseScope, loadSnapshot, type Snapshot, type OpsTransaction } from "./analytics.js";
import { validateRow } from "../csvProcessing.js";
const row = (id: string, overrides: Partial<OpsTransaction> = {}): OpsTransaction => ({ transactionId: id, amount: "0.10", currency: "SEK", status: "SUCCESS", merchantId: "demo-shop", failureReason: null, createdAt: "2026-11-10T12:00:00.000Z", ...overrides });
const snapshot = (rows: OpsTransaction[]): Snapshot => ({ source: "memory", asOf: "2026-11-12T12:00:00.000Z", importId: null, rows });
const value = (result: ReturnType<typeof runAnalytics>, id: string) => result.facts.find((fact) => fact.id === `t.${id}`)?.value;
test("exact totals stay separated by currency", () => {
  const result = runAnalytics("get_summary", {}, snapshot([row("a"), row("b", { amount: "0.20" }), row("c", { amount: "100", currency: "EUR" })]), "t");
  assert.equal(value(result, "processed_SEK"), "0.30"); assert.equal(value(result, "processed_EUR"), "100.00");
});
test("duplicates require successful payments and a known matching merchant", () => {
  const result = runAnalytics("find_duplicates", {}, snapshot([row("a"), row("b"), row("c", { merchantId: "other" }), row("d", { status: "FAILED" }), row("e", { merchantId: null }), row("f", { createdAt: "2026-11-10T12:05:01.000Z" })]), "t");
  assert.equal(value(result, "groups"), 1); assert.deepEqual(result.findings[0].transactionIds, ["a", "b"]); assert.equal(value(result, "missing_merchant"), 1);
});
test("spikes use a prior calendar day outside the date filter and percentage points", () => {
  const rows = [0, 1, 2, 3, 4].flatMap((n) => [row(`old-${n}`, { createdAt: "2026-11-09T12:00:00.000Z", status: n === 0 ? "FAILED" : "SUCCESS" }), row(`new-${n}`, { status: n < 3 ? "FAILED" : "SUCCESS" })]);
  const result = runAnalytics("flag_anomalies", { dateFrom: "2026-11-10", dateTo: "2026-11-10" }, snapshot(rows), "t");
  assert.equal(value(result, "spikes"), 1); assert.equal(value(result, "change_2026-11-10"), 40);
});
test("a missing calendar day does not become a baseline", () => {
  const rows = [0, 1, 2, 3, 4].flatMap((n) => [row(`old-${n}`, { createdAt: "2026-11-08T12:00:00.000Z" }), row(`new-${n}`, { status: "FAILED" })]);
  assert.equal(value(runAnalytics("flag_anomalies", {}, snapshot(rows), "t"), "spikes"), 0);
});
test("dateTo includes the full UTC day, search is capped, and empty rates are finite", () => {
  const result = runAnalytics("search_transactions", { dateTo: "2026-11-10", limit: 1 }, snapshot([row("a"), row("b", { createdAt: "2026-11-10T23:59:59.000Z" })]), "t");
  assert.equal(value(result, "matches"), 2); assert.equal((result.data as { truncated: boolean }).truncated, true);
  assert.equal(value(runAnalytics("get_summary", {}, snapshot([]), "t"), "failure_rate"), 0);
});
test("tool arguments reject invalid dates, extra fields and arbitrary tools", () => {
  for (const input of [{ dateFrom: "2026-02-30" }, { sql: "DROP TABLE" }, { limit: 1000 }, { dateFrom: "2026-11-12", dateTo: "2026-11-10" }]) assert.throws(() => parseScope(input));
  assert.throws(() => runAnalytics("delete_transactions", {}, snapshot([]), "t"));
});
test("snapshot scope is immutable across calls and refuses partial data", async () => {
  const local = [validateRow({ transactionId: "demo", amount: "1.01", currency: "SEK", status: "SUCCESS", createdAt: "2026-11-10" }, 2)];
  const snap = await loadSnapshot(null, local);
  local[0].amount = 9; assert.equal(snap.rows[0].amount, "1.01");
  await assert.rejects(loadSnapshot(null, Array(10001).fill(local[0])), /exceeds/);
  assert.equal((await loadSnapshot(null, local, "missing-import")).rows.length, 0);
});
test("CSV money rejects silent rounding and optional merchants preserve legacy rows", () => {
  const record = { transactionId: "demo", amount: "1.005", currency: "SEK", status: "SUCCESS", createdAt: "2026-11-10" };
  assert.throws(() => validateRow(record, 2), /two decimals/);
  assert.equal(validateRow({ ...record, amount: "1.01" }, 2).merchantId, null);
});
