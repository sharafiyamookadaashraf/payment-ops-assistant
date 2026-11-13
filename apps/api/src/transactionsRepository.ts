// apps/api/src/transactionsRepository.ts
import type { PrismaClient } from "../../../generated/prisma/client.js";

import { sumByCurrency } from "./money.js";

export type TransactionForSummary = {
  amount: number;
  currency: string;
  status: string;
};

export type TransactionsSummary = {
  totalTransactions: number;
  successfulTransactions: number;
  failedTransactions: number;
  pendingTransactions: number;
  processedAmountsByCurrency: { currency: string; amount: string }[];
  successRate: number; // 0-100, rounded to 1 decimal
};

function summarize(transactions: TransactionForSummary[]): TransactionsSummary {
  const totalTransactions = transactions.length;
  let successfulTransactions = 0;
  let failedTransactions = 0;
  let pendingTransactions = 0;

  for (const t of transactions) {
    if (t.status === "SUCCESS") {
      successfulTransactions += 1;
    } else if (t.status === "FAILED") {
      failedTransactions += 1;
    } else if (t.status === "PENDING") {
      pendingTransactions += 1;
    }
  }

  const successRate =
    totalTransactions === 0 ? 0 : Math.round((successfulTransactions / totalTransactions) * 1000) / 10;

  return {
    totalTransactions,
    successfulTransactions,
    failedTransactions,
    pendingTransactions,
    processedAmountsByCurrency: sumByCurrency(transactions),
    successRate,
  };
}

export async function getTransactionsSummary(
  prisma: PrismaClient | null,
  localTransactions: TransactionForSummary[],
): Promise<TransactionsSummary> {
  if (!prisma) {
    return summarize(localTransactions);
  }

  const [totalTransactions, statusCounts, successSums] = await prisma.$transaction([
    prisma.transaction.count(),
    prisma.transaction.groupBy({ by: ["status"], _count: { status: true } }),
    prisma.transaction.groupBy({ by: ["currency"], where: { status: "SUCCESS" }, _sum: { amount: true }, orderBy: { currency: "asc" } }),
  ], { isolationLevel: "RepeatableRead" });

  const countByStatus = Object.fromEntries(statusCounts.map((row) => [row.status, row._count.status]));
  const successfulTransactions = countByStatus["SUCCESS"] ?? 0;
  const failedTransactions = countByStatus["FAILED"] ?? 0;
  const pendingTransactions = countByStatus["PENDING"] ?? 0;
  const processedAmountsByCurrency = successSums.map((row) => ({ currency: row.currency, amount: row._sum.amount?.toFixed(2) ?? "0.00" }));

  const successRate =
    totalTransactions === 0 ? 0 : Math.round((successfulTransactions / totalTransactions) * 1000) / 10;

  return {
    totalTransactions,
    successfulTransactions,
    failedTransactions,
    pendingTransactions,
    processedAmountsByCurrency,
    successRate,
  };
}

// --- Stage 3: paginated/filterable/sortable transaction listing ---

export type TransactionSummaryRow = {
  id: string;
  transactionId: string;
  amount: number;
  currency: string;
  status: string;
  failureReason: string | null;
  createdAt: Date;
};

export type TransactionSortField = "transactionId" | "amount" | "currency" | "status" | "createdAt";

export type TransactionListQuery = {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
  currency?: string;
  dateFrom?: string;
  dateTo?: string;
  sortBy?: TransactionSortField;
  sortOrder?: "asc" | "desc";
};

export type TransactionListResponse = {
  data: TransactionSummaryRow[];
  total: number;
  page: number;
  pageSize: number;
};

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 10;

export async function listTransactions(
  prisma: PrismaClient | null,
  localTransactions: (TransactionForSummary & { transactionId: string; createdAt: Date; failureReason: string | null })[],
  query: TransactionListQuery = {},
): Promise<TransactionListResponse> {
  const page = query.page && query.page > 0 ? query.page : DEFAULT_PAGE;
  const pageSize = query.pageSize && query.pageSize > 0 ? query.pageSize : DEFAULT_PAGE_SIZE;
  const skip = (page - 1) * pageSize;

  if (!prisma) {
    let result = [...localTransactions] as TransactionSummaryRow[];

    if (query.search) {
      const s = query.search.toLowerCase();
      result = result.filter((t) => t.transactionId.toLowerCase().includes(s));
    }
    if (query.status) {
      result = result.filter((t) => t.status === query.status);
    }
    if (query.currency) {
      result = result.filter((t) => t.currency === query.currency);
    }
    if (query.dateFrom) {
      const from = new Date(query.dateFrom);
      result = result.filter((t) => t.createdAt >= from);
    }
    if (query.dateTo) {
      const to = new Date(query.dateTo);
      result = result.filter((t) => t.createdAt <= to);
    }

    const sortBy = query.sortBy ?? "createdAt";
    const sortOrder = query.sortOrder ?? "desc";
    result.sort((a, b) => {
      const left = a[sortBy];
      const right = b[sortBy];
      if (left === right) return 0;
      const cmp = left < right ? -1 : 1;
      return sortOrder === "asc" ? cmp : -cmp;
    });

    const total = result.length;
    const data = result.slice(skip, skip + pageSize);
    return { data, total, page, pageSize };
  }

  const conditions: Record<string, unknown>[] = [];
  if (query.search) {
    conditions.push({ transactionId: { contains: query.search, mode: "insensitive" } });
  }
  if (query.status) {
    conditions.push({ status: query.status });
  }
  if (query.currency) {
    conditions.push({ currency: query.currency });
  }
  if (query.dateFrom || query.dateTo) {
    const range: Record<string, Date> = {};
    if (query.dateFrom) range.gte = new Date(query.dateFrom);
    if (query.dateTo) range.lte = new Date(query.dateTo);
    conditions.push({ createdAt: range });
  }
  const where = conditions.length > 0 ? { AND: conditions } : undefined;

  const sortBy = query.sortBy ?? "createdAt";
  const sortOrder = query.sortOrder ?? "desc";
  const orderBy = { [sortBy]: sortOrder } as Record<string, "asc" | "desc">;

  const [rows, total] = await Promise.all([
    prisma.transaction.findMany({ where, orderBy, skip, take: pageSize }),
    prisma.transaction.count({ where }),
  ]);

  const data: TransactionSummaryRow[] = rows.map((t) => ({
    id: t.id,
    transactionId: t.transactionId,
    amount: Number(t.amount),
    currency: t.currency,
    status: t.status,
    failureReason: t.failureReason,
    createdAt: t.createdAt,
  }));

  return { data, total, page, pageSize };
}
