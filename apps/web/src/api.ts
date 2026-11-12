export const API_BASE = (import.meta.env.VITE_API_URL || "http://localhost:3001").replace(/\/$/, "");

export type ImportStatus = "PROCESSING" | "COMPLETED" | "PARTIALLY_COMPLETED" | "FAILED";

export type ImportSummary = {
  id: string;
  filename: string;
  status: ImportStatus;
  totalRows: number;
  successfulRows: number;
  failedRows: number;
  createdAt: string;
};

export type ImportSortField =
  | "createdAt"
  | "filename"
  | "status"
  | "totalRows"
  | "successfulRows"
  | "failedRows";

export type ImportListQuery = {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: ImportStatus;
  sortBy?: ImportSortField;
  sortOrder?: "asc" | "desc";
};

export type PagedResult<T> = {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
};

export type ImportListResponse = PagedResult<ImportSummary>;

export async function fetchImports(
  query: ImportListQuery = {},
): Promise<ImportListResponse> {
  const params = new URLSearchParams();

  if (query.page) {
    params.set("page", String(query.page));
  }

  if (query.pageSize) {
    params.set("pageSize", String(query.pageSize));
  }

  if (query.search) {
    params.set("search", query.search);
  }

  if (query.status) {
    params.set("status", query.status);
  }

  if (query.sortBy) {
    params.set("sortBy", query.sortBy);
  }

  if (query.sortOrder) {
    params.set("sortOrder", query.sortOrder);
  }

  const url = `${API_BASE}/api/imports?${params.toString()}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error("Failed to load imports");
  }

  return response.json();
}

export type TransactionsSummary = {
  totalTransactions: number;
  successfulTransactions: number;
  failedTransactions: number;
  pendingTransactions: number;
  processedAmountsByCurrency: { currency: string; amount: string }[];
  successRate: number;
};

export async function fetchTransactionsSummary(): Promise<TransactionsSummary> {
  const response = await fetch(`${API_BASE}/api/transactions/summary`);
  if (!response.ok) {
    throw new Error("Failed to load dashboard summary");
  }
  return response.json();
}

export type TransactionRecord = {
  id: string;
  transactionId: string;
  amount: number;
  currency: string;
  status: string;
  failureReason: string | null;
  createdAt: string;
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

export type TransactionListResponse = PagedResult<TransactionRecord>;

export async function fetchTransactions(
  query: TransactionListQuery = {},
): Promise<TransactionListResponse> {
  const params = new URLSearchParams();
  if (query.page) params.set("page", String(query.page));
  if (query.pageSize) params.set("pageSize", String(query.pageSize));
  if (query.search) params.set("search", query.search);
  if (query.status) params.set("status", query.status);
  if (query.currency) params.set("currency", query.currency);
  if (query.dateFrom) params.set("dateFrom", query.dateFrom);
  if (query.dateTo) params.set("dateTo", query.dateTo);
  if (query.sortBy) params.set("sortBy", query.sortBy);
  if (query.sortOrder) params.set("sortOrder", query.sortOrder);
  const url = `${API_BASE}/api/transactions?${params.toString()}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Failed to load transactions");
  }
  return response.json();
}
