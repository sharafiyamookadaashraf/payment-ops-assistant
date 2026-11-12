# Ops Copilot build sequence

This extends Payment Ops Assistant as the courses are completed. Only the first analytics increment below is implemented. All fixtures are synthetic; never use real payment data.

| Course | Deliverable | Status |
| --- | --- | --- |
| Claude API | Tested analytics/rules, then validated tools, `/api/ask`, streaming UI, structured findings and 10 answer evaluations | Failure-summary foundation implemented; remaining work planned |
| MCP | Expose the same tool implementations through an MCP server with a read-only database role | Planned |
| Agent Skills | Failed-payment triage and batch-reconciliation runbooks | Planned |
| Claude Code | Reviewed development workflow, `CLAUDE.md`, a command or subagent, and honest build notes | Planned |

## First increment: failure analysis

`GET /api/analytics/failures`

| Parameter | Contract |
| --- | --- |
| `from` | Required real calendar date, `YYYY-MM-DD`; inclusive UTC midnight |
| `to` | Required real calendar date, `YYYY-MM-DD`; exclusive UTC midnight, after `from` |
| `currency` | Optional supported currency: USD, EUR, GBP, SEK, NOK or DKK; case-insensitive |

The range may cover at most 31 days. Duplicate query parameters, unknown filters, malformed dates and unsupported currencies return HTTP 400. A query failure returns HTTP 503 without database details or fabricated zero metrics.

The response contains:

- `scope`: exact ISO time boundaries, UTC timezone and currency filter.
- `dataSource`: `postgres` or `memory`, so a demo fallback is visible.
- `totals`: total, successful, failed, pending and other-status transaction counts, plus `failureRatePct`.
- `byCurrency`: the same counts/rate for each currency with matching transactions.
- `failureReasons`: recorded reasons from FAILED transactions, ordered by count, then reason for ties. Blank or missing reasons are `null`.

Failure rate is `FAILED / all stored transactions in scope × 100`, rounded to one decimal. Pending and legacy statuses remain in the denominator. Zero transactions gives a `null` rate; transactions with no failures give `0`. Rejected import rows are not stored payment transactions and are excluded. There is no amount field or currency conversion in this API.

The PostgreSQL path uses one `groupBy` query with date and currency filters. The memory path applies the same filters. Both use the same backend summarizer. HTTP only adapts requests and errors; the future Claude tools can call `getFailureAnalytics` directly without making internal HTTP requests.

Recorded failure reasons are untrusted CSV data, not independently verified causes. They must never become instructions when passed to a future model. A high failure rate alone does not prove fraud, a provider incident or a causal explanation.

## Reproduce the demo

Start the existing API using the README instructions. Use an empty demo dataset, because other imported transactions in this date range will affect the counts. From the repository root:

```bash
curl -F 'file=@sample-data/ops-copilot-failures.csv' http://localhost:3001/api/imports
curl 'http://localhost:3001/api/analytics/failures?from=2026-11-10&to=2026-11-11'
curl 'http://localhost:3001/api/analytics/failures?from=2026-11-10&to=2026-11-11&currency=SEK'
```

The fixture has eight valid rows, with two outside Tuesday's UTC window. The six Tuesday transactions produce:

| Scope | Total | Success | Failed | Pending | Failure rate |
| --- | ---: | ---: | ---: | ---: | ---: |
| All currencies | 6 | 2 | 3 | 1 | 50% |
| EUR | 2 | 1 | 1 | 0 | 50% |
| SEK | 4 | 1 | 2 | 1 | 50% |

The all-currency failure reasons are `issuer_declined: 2` and unknown (`null`): `1`. The start boundary is included; the next midnight is excluded. Reuploading the fixture should hit the existing duplicate-ID validation rather than add more transactions.

## Verify and understand the change

```bash
npx prisma generate
npm --prefix apps/api test
npm --prefix apps/api run build
```

Read the code in this order:

1. `apps/api/src/failureAnalytics.ts`: validated query, scoped DB aggregation, deterministic counts and percentages.
2. `apps/api/src/failureAnalyticsRoutes.ts`: HTTP adapter with 400/503 error handling.
3. `apps/api/src/failureAnalytics.test.ts`: known fixture answers, date boundaries, denominator rules, empty results, invalid filters, Prisma query contract and HTTP behavior.

The tests exercise the memory path and HTTP server and mock the Prisma boundary. They do not replace a live PostgreSQL integration test. Existing dashboard endpoints retain their previous contracts.

## Next increments within the API course

1. Define and test duplicate-candidate and anomaly rules with explicit thresholds and minimum sample sizes. Import-time duplicate-ID rejection already exists; economic duplicate detection is a separate feature.
2. Add a merchant identifier and suitable payment reference to the schema/import contract before claiming merchant-level or economic-duplicate analysis. Migrate `amount` from `Float` to exact decimal storage and separate currencies before exposing monetary analytics. Revisit the existing dashboard's combined-currency amount at that point.
3. Wrap the tested functions as validated, allow-listed tools, beginning with `get_summary`. Bound tool calls, result sizes, request duration and token usage; handle tool errors explicitly. No generated SQL or payment mutations.
4. Add `/api/ask`, then streaming and structured findings referencing backend evidence. Render financial figures from tool results and validate references; a prompt alone cannot guarantee grounded output.
5. Add 10 fixed question/answer evaluations, including empty data, missing evidence, unsupported merchant questions and instruction-like text in CSV fields. These answer evaluations are separate from backend unit tests.

MCP, runbook skills and Claude Code conventions are deferred until their courses. Build notes must describe the tools actually used; this increment does not demonstrate Claude Code usage.

## Current limitations

The app still has its existing startup fallback to memory, no authentication and no merchant field. This endpoint reports the storage source and never falls back after an active database query fails. The shared analytics function has no writes, but that is not a database permission boundary: the MCP milestone must use a separate read-only role. Review these limits before any public deployment.
