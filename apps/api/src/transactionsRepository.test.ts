import test from "node:test";
import assert from "node:assert/strict";
import { getTransactionsSummary, listTransactions } from "./transactionsRepository.js";

const fixture = [
  { id: "1", transactionId: "TXN-1", amount: 100, currency: "USD", status: "SUCCESS", failureReason: null, createdAt: new Date("2026-08-01") },
  { id: "2", transactionId: "TXN-2", amount: 50, currency: "USD", status: "SUCCESS", failureReason: null, createdAt: new Date("2026-08-02") },
  { id: "3", transactionId: "TXN-3", amount: 30, currency: "EUR", status: "FAILED", failureReason: "insufficient funds", createdAt: new Date("2026-08-03") },
  { id: "4", transactionId: "TXN-4", amount: 20, currency: "EUR", status: "PENDING", failureReason: null, createdAt: new Date("2026-08-04") },
  { id: "5", transactionId: "TXN-5", amount: 200, currency: "GBP", status: "FAILED", failureReason: "card declined", createdAt: new Date("2026-08-05") },
];

// --- getTransactionsSummary ---

test("getTransactionsSummary: computes correct counts and total processed amount", async () => {
  const summary = await getTransactionsSummary(null, fixture);
  assert.equal(summary.totalTransactions, 5);
  assert.equal(summary.successfulTransactions, 2);
  assert.equal(summary.failedTransactions, 2);
  assert.equal(summary.pendingTransactions, 1);
  assert.deepEqual(summary.processedAmountsByCurrency, [{ currency: "USD", amount: "150.00" }]); // only SUCCESS: 100 + 50
});

test("getTransactionsSummary: computes success rate as a percentage", async () => {
  const summary = await getTransactionsSummary(null, fixture);
  assert.equal(summary.successRate, 40); // 2/5 = 40%
});

test("getTransactionsSummary: returns zeros for an empty dataset, not NaN or an error", async () => {
  const summary = await getTransactionsSummary(null, []);
  assert.equal(summary.totalTransactions, 0);
  assert.equal(summary.successRate, 0);
  assert.deepEqual(summary.processedAmountsByCurrency, []);
});

// --- listTransactions (filtering, search, sort, pagination) ---

test("listTransactions: returns all transactions with default pagination", async () => {
  const result = await listTransactions(null, fixture, {});
  assert.equal(result.total, 5);
});

test("listTransactions: filters by status", async () => {
  const result = await listTransactions(null, fixture, { status: "FAILED" });
  assert.equal(result.total, 2);
  assert.ok(result.data.every((t) => t.status === "FAILED"));
});

test("listTransactions: filters by currency", async () => {
  const result = await listTransactions(null, fixture, { currency: "EUR" });
  assert.equal(result.total, 2);
  assert.ok(result.data.every((t) => t.currency === "EUR"));
});

test("listTransactions: search matches transactionId (partial, case-insensitive)", async () => {
  const result = await listTransactions(null, fixture, { search: "txn-3" });
  assert.equal(result.total, 1);
  assert.equal(result.data[0].transactionId, "TXN-3");
});

test("listTransactions: date range filter is inclusive on both ends", async () => {
  const result = await listTransactions(null, fixture, {
    dateFrom: "2026-08-02",
    dateTo: "2026-08-04",
  });
  assert.equal(result.total, 3); // TXN-2, TXN-3, TXN-4
});

test("listTransactions: sorts by amount descending", async () => {
  const result = await listTransactions(null, fixture, { sortBy: "amount", sortOrder: "desc" });
  assert.equal(result.data[0].transactionId, "TXN-5"); // 200
  assert.equal(result.data[result.data.length - 1].transactionId, "TXN-4"); // 20
});

test("listTransactions: paginates correctly", async () => {
  const result = await listTransactions(null, fixture, { page: 2, pageSize: 2 });
  assert.equal(result.data.length, 2);
  assert.equal(result.page, 2);
  assert.equal(result.total, 5);
});

test("listTransactions: combined filters (status + currency) narrow correctly", async () => {
  const result = await listTransactions(null, fixture, { status: "FAILED", currency: "GBP" });
  assert.equal(result.total, 1);
  assert.equal(result.data[0].transactionId, "TXN-5");
});
