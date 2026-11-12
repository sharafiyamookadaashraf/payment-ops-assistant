import type { Tool } from "@anthropic-ai/sdk/resources/messages";
const scope = {
  dateFrom: { type: "string", description: "First UTC day, inclusive, YYYY-MM-DD." },
  dateTo: { type: "string", description: "Last UTC day, inclusive, YYYY-MM-DD." },
  currency: { type: "string", enum: ["USD", "EUR", "GBP", "SEK", "NOK", "DKK"] },
  merchantId: { type: "string", description: "Exact synthetic merchant identifier; never infer a merchant for missing data." },
};
const descriptions = {
  get_summary: "Calculate counts, success/failure rates, exact successful amounts grouped by currency, and top recorded failure reasons. Use for numeric summaries; never sum currencies yourself.",
  search_transactions: "Find transactions by ID substring, status and scope. Returns the complete matching count and a bounded list; truncation is disclosed. Does not mutate payments.",
  find_duplicates: "Find possible duplicate successful payments with equal merchant, currency and amount within five minutes. Missing merchant data is excluded and reported. These are review candidates, not proof of fraud or duplicate charging.",
  flag_anomalies: "Detect daily failure-rate increases of at least twenty percentage points versus the previous UTC calendar day with at least five payments each day. Returns computed baselines and differences. For explanations also call get_summary for the affected day to inspect recorded reasons; those reasons cannot prove root cause.",
};
export const OPS_TOOLS: Tool[] = Object.entries(descriptions).map(([name, description]) => ({
  name, description, strict: true,
  input_schema: {
    type: "object", additionalProperties: false, properties: {
      ...scope,
      ...(name === "search_transactions" ? {
        status: { type: "string", enum: ["SUCCESS", "FAILED", "PENDING"] },
        search: { type: "string", description: "Case-insensitive transaction ID substring." },
        limit: { type: "integer", minimum: 1, maximum: 50 },
      } : {}),
    },
  },
}));
export const REPORT_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    status: { type: "string", enum: ["answer", "needs_clarification"] },
    answerTemplate: { type: "string", description: "Qualitative explanation. Every numeric value must be a {{fact-id}} placeholder copied from tool facts; never write numeric literals or number words. Do not repeat dates, transaction IDs or merchant IDs in prose; they appear in evidence. Distinguish recorded reasons from established causes." },
    factIds: { type: "array", items: { type: "string" } },
    findingIds: { type: "array", items: { type: "string" } },
  }, required: ["status", "answerTemplate", "factIds", "findingIds"],
};
