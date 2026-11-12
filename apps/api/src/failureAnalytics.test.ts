import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import express from "express";
import type { PrismaClient } from "../../../generated/prisma/client.js";
import { parseCsvText, validateRow } from "./csvProcessing.js";
import { AnalyticsQueryError, getFailureAnalytics, parseFailureAnalyticsQuery } from "./failureAnalytics.js";
import { createFailureAnalyticsRouter } from "./failureAnalyticsRoutes.js";

const fixture = parseCsvText(readFileSync(new URL("../../../sample-data/ops-copilot-failures.csv", import.meta.url), "utf8"))
  .map((row, index) => validateRow(row, index + 2));
const day = { from: "2026-11-10", to: "2026-11-11" };

test("failure analytics: synthetic CSV produces known counts, rates and recorded reasons", async () => {
  assert.equal(fixture.length, 8);
  const result = await getFailureAnalytics(null, fixture, day);
  assert.deepEqual(result.scope, { fromInclusive: "2026-11-10T00:00:00.000Z", toExclusive: "2026-11-11T00:00:00.000Z", timezone: "UTC", currency: null });
  assert.equal(result.dataSource, "memory");
  assert.deepEqual(result.totals, { totalTransactions: 6, successfulTransactions: 2, failedTransactions: 3, pendingTransactions: 1, otherTransactions: 0, failureRatePct: 50 });
  assert.deepEqual(result.byCurrency, [
    { currency: "EUR", totalTransactions: 2, successfulTransactions: 1, failedTransactions: 1, pendingTransactions: 0, otherTransactions: 0, failureRatePct: 50 },
    { currency: "SEK", totalTransactions: 4, successfulTransactions: 1, failedTransactions: 2, pendingTransactions: 1, otherTransactions: 0, failureRatePct: 50 },
  ]);
  assert.deepEqual(result.failureReasons, [{ reason: "issuer_declined", failedTransactions: 2 }, { reason: null, failedTransactions: 1 }]);
  assert.equal("amount" in result.totals, false);
});

test("failure analytics: currency filter applies before calculating the denominator", async () => {
  const result = await getFailureAnalytics(null, fixture, { ...day, currency: "sek" });
  assert.equal(result.scope.currency, "SEK");
  assert.equal(result.totals.totalTransactions, 4);
  assert.equal(result.totals.failedTransactions, 2);
  assert.equal(result.byCurrency.length, 1);
  assert.deepEqual(result.failureReasons, [{ reason: "issuer_declined", failedTransactions: 2 }]);
});

test("failure analytics: UTC range includes start and excludes the next midnight", async () => {
  const rows = [
    { ...fixture[0], createdAt: new Date("2026-11-10T01:00:00+01:00") },
    { ...fixture[1], createdAt: new Date("2026-11-11T00:00:00Z") },
    { ...fixture[2], createdAt: new Date("2026-11-09T23:59:59.999Z") },
  ];
  const result = await getFailureAnalytics(null, rows, day);
  assert.equal(result.totals.totalTransactions, 1);
  assert.equal(result.totals.failureRatePct, 0);
});

test("failure analytics: no matching data returns null rate, not a measured zero", async () => {
  const result = await getFailureAnalytics(null, fixture, { ...day, currency: "GBP" });
  assert.equal(result.totals.totalTransactions, 0);
  assert.equal(result.totals.failureRatePct, null);
  assert.deepEqual(result.byCurrency, []);
  assert.deepEqual(result.failureReasons, []);
});

test("failure analytics: denominator includes pending and legacy statuses; rounds to one decimal", async () => {
  const result = await getFailureAnalytics(null, [fixture[1], fixture[3], { ...fixture[0], status: "LEGACY" }], day);
  assert.equal(result.totals.failureRatePct, 33.3);
  assert.equal(result.totals.otherTransactions, 1);
  assert.equal(result.totals.pendingTransactions, 1);
});

test("failure analytics: blank failure reasons remain unknown; non-failed reasons are ignored", async () => {
  const result = await getFailureAnalytics(null, [fixture[5], { ...fixture[1], failureReason: "  " }, { ...fixture[0], failureReason: "not a failure" }], day);
  assert.deepEqual(result.failureReasons, [{ reason: null, failedTransactions: 2 }]);
});

test("failure analytics: invalid, repeated, unsupported and overly broad filters are rejected", () => {
  for (const query of [
    {}, { from: day.from }, { ...day, from: [day.from] }, { ...day, to: 42 },
    { ...day, from: "2026-02-30" }, { ...day, from: "2026-13-01" },
    { ...day, from: "2026-11-10T00:00:00Z" }, { ...day, to: day.from },
    { ...day, from: "2026-11-12" }, { from: "2026-01-01", to: "2026-02-02" },
    { ...day, currency: "BTC" }, { ...day, currency: ["SEK", "EUR"] },
    { ...day, currency: { code: "SEK" } }, { ...day, status: "FAILED" },
  ]) assert.throws(() => parseFailureAnalyticsQuery(query), AnalyticsQueryError);
  assert.doesNotThrow(() => parseFailureAnalyticsQuery({ from: "2026-01-01", to: "2026-02-01" }));
  assert.doesNotThrow(() => parseFailureAnalyticsQuery({ from: "2024-02-29", to: "2024-03-01" }));
});

test("failure analytics: Prisma aggregation contract matches demo results, including null reasons", async () => {
  let calls = 0;
  const prisma = {
    transaction: {
      groupBy: async (args: unknown) => {
        calls += 1;
        assert.deepEqual(args, {
          by: ["currency", "status", "failureReason"],
          where: { createdAt: { gte: new Date("2026-11-10T00:00:00Z"), lt: new Date("2026-11-11T00:00:00Z") } },
          _count: { _all: true },
        });
        return [
          { currency: "SEK", status: "SUCCESS", failureReason: null, _count: { _all: 1 } },
          { currency: "SEK", status: "FAILED", failureReason: "issuer_declined", _count: { _all: 2 } },
          { currency: "SEK", status: "PENDING", failureReason: null, _count: { _all: 1 } },
          { currency: "EUR", status: "SUCCESS", failureReason: null, _count: { _all: 1 } },
          { currency: "EUR", status: "FAILED", failureReason: null, _count: { _all: 1 } },
        ];
      },
    },
  } as unknown as PrismaClient;
  const result = await getFailureAnalytics(prisma, [], day);
  const demo = await getFailureAnalytics(null, fixture, day);
  assert.equal(calls, 1);
  assert.deepEqual(result, { ...demo, dataSource: "postgres" });
});

test("failure analytics: currency is sent to Prisma; invalid inputs never query the database", async () => {
  let calls = 0;
  const prisma = { transaction: { groupBy: async (args: { where: { currency: string } }) => {
    calls += 1;
    assert.equal(args.where.currency, "SEK");
    return [];
  } } } as unknown as PrismaClient;
  await getFailureAnalytics(prisma, [], { ...day, currency: "sek" });
  await assert.rejects(getFailureAnalytics(prisma, [], { ...day, from: "invalid" }), AnalyticsQueryError);
  assert.equal(calls, 1);
});

async function startServer(t: TestContext, getSummary: Parameters<typeof createFailureAnalyticsRouter>[0]): Promise<string> {
  const app = express();
  app.use("/api/analytics", createFailureAnalyticsRouter(getSummary));
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  await once(server, "listening");
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/analytics/failures`;
}

test("failure analytics HTTP: returns scoped JSON and 400 for repeated or unknown filters", async (t) => {
  const url = await startServer(t, (query) => getFailureAnalytics(null, fixture, query));
  const response = await fetch(`${url}?from=2026-11-10&to=2026-11-11&currency=SEK`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).totals.failedTransactions, 2);
  for (const suffix of ["", "?from=2026-11-10&to=2026-11-11&currency=SEK&currency=EUR", "?from=2026-11-10&to=2026-11-11&merchantId=123"]) {
    const invalid = await fetch(url + suffix);
    assert.equal(invalid.status, 400);
    assert.equal(typeof (await invalid.json()).message, "string");
  }
});

test("failure analytics HTTP: DB errors return 503 rather than empty or fallback metrics", async (t) => {
  const prisma = { transaction: { groupBy: async () => { throw new Error("private DB detail"); } } } as unknown as PrismaClient;
  const url = await startServer(t, (query) => getFailureAnalytics(prisma, fixture, query));
  const response = await fetch(`${url}?from=2026-11-10&to=2026-11-11`);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { message: "Failure analytics are temporarily unavailable." });
});
