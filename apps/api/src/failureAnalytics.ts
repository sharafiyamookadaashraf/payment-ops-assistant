import type { PrismaClient } from "../../../generated/prisma/client.js";
import { isSupportedCurrency } from "./importValidation.js";

const DAY_MS = 86_400_000;
export const MAX_ANALYTICS_DAYS = 31;

export class AnalyticsQueryError extends Error {}

export type FailureAnalyticsQuery = {
  from: Date;
  to: Date;
  currency?: string;
};

export type FailureAnalyticsRow = {
  currency: string;
  status: string;
  failureReason: string | null;
  createdAt: Date;
};

type Counts = {
  totalTransactions: number;
  successfulTransactions: number;
  failedTransactions: number;
  pendingTransactions: number;
  otherTransactions: number;
};

type Metrics = Counts & { failureRatePct: number | null };
type Group = Omit<FailureAnalyticsRow, "createdAt"> & { count: number };

export type FailureAnalytics = {
  scope: {
    fromInclusive: string;
    toExclusive: string;
    timezone: "UTC";
    currency: string | null;
  };
  dataSource: "postgres" | "memory";
  totals: Metrics;
  byCurrency: (Metrics & { currency: string })[];
  failureReasons: { reason: string | null; failedTransactions: number }[];
};

function parseDate(value: unknown, field: string): Date {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new AnalyticsQueryError(`${field} must be a YYYY-MM-DD date.`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new AnalyticsQueryError(`${field} must be a valid calendar date.`);
  }
  return date;
}

// Shared boundary for HTTP now and model tool arguments later. Reject unknown
// filters rather than silently answering a broader question than requested.
export function parseFailureAnalyticsQuery(input: Record<string, unknown>): FailureAnalyticsQuery {
  if (Object.keys(input).some((key) => !["from", "to", "currency"].includes(key))) {
    throw new AnalyticsQueryError("Supported filters are from, to and currency.");
  }
  const from = parseDate(input.from, "from");
  const to = parseDate(input.to, "to");
  const days = (to.getTime() - from.getTime()) / DAY_MS;
  if (days <= 0 || days > MAX_ANALYTICS_DAYS) {
    throw new AnalyticsQueryError(`to must be after from, with a maximum range of ${MAX_ANALYTICS_DAYS} days.`);
  }
  let currency: string | undefined;
  if (input.currency !== undefined) {
    if (typeof input.currency !== "string" || !isSupportedCurrency(input.currency)) {
      throw new AnalyticsQueryError("currency must be a supported currency code.");
    }
    currency = input.currency.toUpperCase();
  }
  return { from, to, currency };
}

function emptyCounts(): Counts {
  return {
    totalTransactions: 0,
    successfulTransactions: 0,
    failedTransactions: 0,
    pendingTransactions: 0,
    otherTransactions: 0,
  };
}

function addCount(counts: Counts, group: Group): void {
  counts.totalTransactions += group.count;
  if (group.status === "SUCCESS") counts.successfulTransactions += group.count;
  else if (group.status === "FAILED") counts.failedTransactions += group.count;
  else if (group.status === "PENDING") counts.pendingTransactions += group.count;
  else counts.otherTransactions += group.count;
}

function metrics(counts: Counts): Metrics {
  return {
    ...counts,
    // Denominator includes pending and any legacy/unknown statuses. No data is
    // different from a measured zero failure rate, so return null when empty.
    failureRatePct: counts.totalTransactions === 0
      ? null
      : Math.round((counts.failedTransactions / counts.totalTransactions) * 1000) / 10,
  };
}

function summarize(
  groups: Group[],
  query: FailureAnalyticsQuery,
  dataSource: FailureAnalytics["dataSource"],
): FailureAnalytics {
  const totals = emptyCounts();
  const currencies = new Map<string, Counts>();
  const reasons = new Map<string | null, number>();
  for (const group of groups) {
    addCount(totals, group);
    const counts = currencies.get(group.currency) ?? emptyCounts();
    addCount(counts, group);
    currencies.set(group.currency, counts);
    if (group.status === "FAILED") {
      const reason = group.failureReason?.trim() || null;
      reasons.set(reason, (reasons.get(reason) ?? 0) + group.count);
    }
  }
  return {
    scope: {
      fromInclusive: query.from.toISOString(),
      toExclusive: query.to.toISOString(),
      timezone: "UTC",
      currency: query.currency ?? null,
    },
    dataSource,
    totals: metrics(totals),
    byCurrency: [...currencies]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, counts]) => ({ currency, ...metrics(counts) })),
    failureReasons: [...reasons]
      .map(([reason, failedTransactions]) => ({ reason, failedTransactions }))
      .sort((a, b) => b.failedTransactions - a.failedTransactions || (a.reason ?? "").localeCompare(b.reason ?? "")),
  };
}

export async function getFailureAnalytics(
  prisma: PrismaClient | null,
  localTransactions: readonly FailureAnalyticsRow[],
  input: Record<string, unknown>,
): Promise<FailureAnalytics> {
  const query = parseFailureAnalyticsQuery(input);
  if (!prisma) {
    const groups = localTransactions
      .filter((row) => row.createdAt >= query.from && row.createdAt < query.to && (!query.currency || row.currency === query.currency))
      .map((row) => ({ ...row, count: 1 }));
    return summarize(groups, query, "memory");
  }

  // One aggregation query gives counts and reasons from the same DB snapshot.
  // No amounts or individual transaction records are sent to the caller.
  const groups = await prisma.transaction.groupBy({
    by: ["currency", "status", "failureReason"],
    where: {
      createdAt: { gte: query.from, lt: query.to },
      ...(query.currency ? { currency: query.currency } : {}),
    },
    _count: { _all: true },
  });
  return summarize(
    groups.map((row) => ({
      currency: row.currency,
      status: row.status,
      failureReason: row.failureReason,
      count: row._count._all,
    })),
    query,
    "postgres",
  );
}
