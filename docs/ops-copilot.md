# Ops Copilot

Extend this repository as each course finishes: Claude API → MCP → Agent Skills → Claude Code.
Use **synthetic CSVs only**. This is a single-user portfolio demo, not a production payment system.

## Progress

- [x] Stage 5 foundation: currency-separated exact totals, merchant metadata, duplicate candidates, daily failure-spike rules.
- [x] Claude API implementation (live validation pending): validated tools, bounded loop, React streaming, structured findings, ten-question eval set.
- [ ] MCP course: expose the same tool handlers over MCP with a dedicated read-only database role.
- [ ] Agent Skills course: failed-payment-triage and batch-reconciliation runbooks.
- [ ] Claude Code course: project conventions, a custom command, and an honest account of directed/reviewed work.

## Analytics contract

Amounts use PostgreSQL Decimal(16,2), with exact integer minor-unit arithmetic in the rule engine. Supported currencies all have two decimal places. Import amounts must be positive, have at most two decimals, and be at most 9999999999.99. Totals are grouped by currency; no implicit FX conversion. The dashboard summary now returns `processedAmountsByCurrency` instead of the misleading cross-currency `totalProcessedAmount`.

The migration rejects old values that would need rounding. Review and correct synthetic rows before retrying; it does not silently alter their monetary meaning. `merchantId` is an optional CSV column, so old CSVs still import. Missing merchant information is disclosed and excluded from merchant duplicate checks.

A question reads one snapshot, capped at 10,000 transactions. Larger datasets fail explicitly; select an import to narrow scope. A database read failure is an error, never a mid-investigation switch to an empty in-memory store. The source, capture time, import and filters accompany every result. This bounded rule-engine approach is appropriate for the demo; large installations should push the rules into indexed database aggregations.

- `get_summary`: counts, rates, successful amounts per currency and recorded failure reasons.
- `search_transactions`: explicit filters, matching count and at most 50 returned rows.
- `find_duplicates`: successful payments with equal merchant, currency and amount within five minutes of the first payment in a group. These are candidates for review, not proven duplicate charges. Group membership is capped in the response and truncation is disclosed.
- `flag_anomalies`: at least a 20 percentage-point increase in failure rate against the preceding UTC calendar day, with at least five transactions on both days. A missing calendar day is not skipped. The previous day may lie outside the requested range, but keeps merchant/currency filters. Counts include all statuses; the denominator is total payment attempts.

All date filters include the entire UTC day. Findings never prove fraud or root cause. A recorded reason such as `issuer_timeout` indicates what the export says, not that an issuer outage has been established.

## Run the API milestone

1. Follow the root README setup; `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL` belong only in the server `.env`.
2. Upload `sample-data/ops-copilot-synthetic.csv`. All merchants and transactions are fictional; the last failure reason intentionally contains an instruction to test untrusted-data handling.
3. Open **Ops Copilot**. The just-uploaded import is selected automatically; expand **Investigation scope** to clear it or enter another import ID.
4. Try the summary, dated failure investigation and duplicate-check prompts. Inspect the facts and expand each finding's rule evidence.
5. Review the commits in order, then run the live evals when your API account has available credits.

With no model configuration, `/api/ask` returns 503 with a setup message. No fake answer is substituted. API errors, invalid model output, truncation, cancellation and exhausted budgets never become a completed report.

## Read the code alongside your API course

Start with [Lesson 1: explain and validate an agent workflow](agent-workflow-lesson-1.md). Run `npm --prefix apps/api run learn:agent` for an offline, scripted model replay through the real tool loop, including evidence checks and a demonstration of their semantic limits. It requires no API credits and does not evaluate Claude.

| Course concept | File | What to inspect |
| --- | --- | --- |
| Deterministic business logic | `apps/api/src/ops/analytics.ts` | A bounded snapshot, filters, rule thresholds and explicit missing data. |
| Tool definitions | `apps/api/src/ops/tools.ts` | Names, descriptions, JSON input schemas and the report schema. |
| Messages and tool use | `apps/api/src/ops/copilot.ts` | Claude returns `tool_use`; our backend executes it; `tool_result` is appended before the next model call. |
| Grounding output | `renderReport` in `copilot.ts` | The model references facts with `{{e1.total}}`; the server checks the ID and inserts the real value. |
| Streaming and cancellation | `apps/api/src/ops/routes.ts` | SSE progress, a request deadline, rate limiting and disconnect handling. |
| React state and streaming | `apps/web/src/OpsCopilot.tsx`, `copilotApi.ts` | Loading/error/complete states, AbortController, partial SSE frames and evidence rendering. |
| Evals | `apps/api/evals/cases.ts`, `run.ts` | Expected facts, tool selection, ambiguity, injection attempts and a qualitative review rubric. |

The SDK uses its streaming message accumulator internally. The browser receives progress events immediately, then the completed validated report. Raw, unvalidated model text is deliberately buffered instead of displayed token by token.

Explain this loop in your own words before moving to MCP: **request → tool choice → validated backend call → tool result → explanation with evidence**.

## Verification and limits

The synthetic fixture contains 20 payments: 12 successful and 8 failed. Successful amounts are 1300.10 SEK and 75.00 EUR, kept separate. The failure rate is 20% on 2026-11-09 and 60% on 2026-11-10, an increase of 40 percentage points. DEMO-T01 and DEMO-T02 form the only duplicate candidate group. A row without merchant information is excluded from merchant grouping.

`npm --prefix apps/api run eval` checks nine deterministic oracle cases and skips the ambiguous-date model case. It does **not** measure model quality or prove prompt-injection resistance. `npm --prefix apps/api run eval:live` runs all ten questions against Claude, checks expected facts and tool selection, and leaves the qualitative rubric for human review. Do not claim ten passing live evals from an offline run.

Unit/HTTP tests cover exact money, mixed currencies, empty data, unknown tools, unsupported arguments, output references, parallel tool-result pairing, refusal, token truncation, budgets and cancellation. Frontend tests cover SSE frames, evidence display, configuration errors and cancellation. The money migration was also exercised against embedded PostgreSQL (PGlite), including the full existing migration chain and refusal to round a pre-existing amount. An HTTP smoke check exercises real CSV upload, dashboard totals and missing-key errors. A full browser visual check could not run in the build environment because Chromium could not create its required socket; rendering is covered by React tests, but desktop/mobile visual review remains pending.

Numeric literals and common number words in model prose are rejected; numeric references and structured evidence come from backend output. This does **not** prevent every qualitative hallucination or incorrect choice of evidence. The model can still misinterpret a real fact. Evals and human review remain necessary, and recorded reasons do not establish root cause.

The API currently has a six-round/twelve-tool-call budget, a per-process request rate limit and a ninety-second investigation deadline. These are demo controls, not multi-tenant production controls. Tool handlers expose no mutation or arbitrary-SQL operation. A database-enforced read-only role is planned for the MCP milestone; do not describe the current application DB credentials as read-only.

## Implementation history

This API milestone was implemented with ChatGPT/Codex following the user's proposed scope and incremental commit request. It was not built with Claude Code. The Claude Code course milestone should later document its own actual usage and what the developer directed, reviewed and learned; do not retroactively claim it built this work.

Official references: [tool-use protocol](https://platform.claude.com/docs/en/agents-and-tools/tool-use/how-tool-use-works), [structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs), [streaming](https://platform.claude.com/docs/en/build-with-claude/streaming).
