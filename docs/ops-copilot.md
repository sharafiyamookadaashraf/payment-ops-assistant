# Ops Copilot

Extend this repository as each course finishes: Claude API → MCP → Agent Skills → Claude Code.
Use **synthetic CSVs only**. This is a single-user portfolio demo, not a production payment system.

## Progress

- [x] Stage 5 foundation: currency-separated exact totals, merchant metadata, duplicate candidates, daily failure-spike rules.
- [ ] Claude API: validated tools, bounded loop, React streaming, structured findings, ten-question eval set.
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
