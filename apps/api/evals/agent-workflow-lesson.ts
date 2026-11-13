import assert from "node:assert/strict";
import type { Message, MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages";
import { evalSnapshot } from "./fixture.js";
import type { ToolResult } from "../src/ops/analytics.js";
import { investigate, renderReport, type Completion } from "../src/ops/copilot.js";

// A teaching double replaces only the model boundary. The application loop,
// CSV parser, analytics and report validator are the existing implementation.
// No API key, network request or database connection is used by this lesson.
const snapshot = await evalSnapshot();
const question = "Why did failures spike on 2026-11-10?";
const evidence: ToolResult[] = [];
const selectedTools: string[] = [];
let round = 0;

function message(content: Message["content"], stop: Message["stop_reason"]): Message {
  return {
    id: `lesson_message_${round}`, type: "message", role: "assistant",
    model: "scripted-lesson-no-llm", content, stop_reason: stop, stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  } as Message;
}

function requestTool(name: string, input: Record<string, string>): Message {
  selectedTools.push(name);
  console.log(`\nScripted model requests: ${name}(${JSON.stringify(input)})`);
  return message([{
    type: "tool_use", caller: { type: "direct" }, id: `lesson_call_${round}`, name, input,
  }], "tool_use");
}

function readToolResult(request: MessageCreateParamsNonStreaming): ToolResult {
  const response = request.messages.at(-1);
  assert.equal(response?.role, "user", "Tool results travel in a user-role message");
  assert.ok(Array.isArray(response?.content));
  const block = response.content[0];
  assert.equal(block.type, "tool_result");
  if (block.type !== "tool_result") throw new Error("Expected a tool result");
  assert.equal(block.tool_use_id, `lesson_call_${round - 1}`, "Match result to request ID");
  assert.notEqual(block.is_error, true);
  assert.equal(typeof block.content, "string");
  const result = JSON.parse(block.content as string) as ToolResult;
  evidence.push(result);
  console.log(`Backend returned evidence from ${result.tool}:`);
  console.log(JSON.stringify({ scope: result.scope, facts: result.facts, findings: result.findings }, null, 2));
  return result;
}

const draft = {
  status: "answer",
  answerTemplate: "The failure rate rose from {{e1.baseline_2026-11-10}} to {{e1.rate_2026-11-10}}, an increase of {{e1.change_2026-11-10}}. On the affected day, {{e2.failed}} failed. The recorded issuer_timeout reason appears in {{e2.reason_0}}. These records support investigation but do not establish an issuer outage or root cause.",
  factIds: ["e1.baseline_2026-11-10", "e1.rate_2026-11-10", "e1.change_2026-11-10", "e2.failed", "e2.reason_0"],
  findingIds: ["e1.spike_2026-11-10"],
};

const scriptedCompletion: Completion = async (request) => {
  round++;
  console.log(`\nMODEL ROUND ${round} — ${request.messages.length} conversation messages`);
  if (round === 1) {
    assert.equal(request.messages[0].content, question);
    return requestTool("flag_anomalies", { dateFrom: "2026-11-10", dateTo: "2026-11-10" });
  }
  const result = readToolResult(request);
  if (round === 2) {
    // Read the affected day from returned evidence before requesting more detail.
    const day = result.findings.find((finding) => finding.rule === "failure_spike")?.evidence.day;
    assert.equal(typeof day, "string");
    return requestTool("get_summary", { dateFrom: day as string, dateTo: day as string });
  }
  assert.equal(round, 3, "This lesson expects two tool calls and a final answer");
  assert.equal(result.facts.find((fact) => fact.id === "e2.reason_0")?.label, "Recorded reason: issuer_timeout");
  console.log("\nScripted final report uses fact references, before rendering:");
  console.log(JSON.stringify(draft, null, 2));
  return message([{ type: "text", text: JSON.stringify(draft), citations: null }], "end_turn");
};

console.log("OPS COPILOT — AGENT WORKFLOW LESSON");
console.log("OFFLINE REPLAY: model responses are scripted; no live Claude call or model-quality evaluation.");
console.log(`Question: ${question}`);
const result = await investigate({
  question, snapshot, model: "scripted-lesson-no-llm", complete: scriptedCompletion,
  signal: AbortSignal.timeout(10000),
  onProgress: (event) => console.log(`Application: ${event.message}`),
});

// These expectations are an independent oracle for this synthetic CSV.
assert.deepEqual(selectedTools, ["flag_anomalies", "get_summary"]);
assert.equal(result.usage.rounds, 3);
assert.equal(result.usage.toolCalls, 2);
for (const toolResult of evidence) {
  assert.deepEqual(toolResult.scope, { dateFrom: "2026-11-10", dateTo: "2026-11-10" });
}
for (const [id, expected] of Object.entries({
  "e1.baseline_2026-11-10": 20, "e1.rate_2026-11-10": 60,
  "e1.change_2026-11-10": 40, "e2.failed": 6, "e2.reason_0": 4,
})) {
  assert.equal(result.report.facts.find((fact) => fact.id === id)?.value, expected, id);
}
assert.equal(result.report.findings[0].rule, "failure_spike");
assert.match(result.report.answer, /from 20% to 60%, an increase of 40 percentage points/);
console.log(`\nVALIDATED REPORT\n${result.report.answer}`);
console.log("PASS: real tool execution, conversation pairing, fixture facts and report rendering.");

console.log("\nBREAK THE REPORT");
for (const [label, answerTemplate, expectedError] of [
  ["Invented number", "The failure rate is 99%.", /ungrounded numeric value/],
  ["Unknown evidence", "The failure rate is {{made_up.rate}}.", /unknown evidence/],
] as const) {
  assert.throws(() => renderReport({ ...draft, answerTemplate }, evidence, snapshot), expectedError);
  console.log(`PASS: ${label} rejected by the existing validator.`);
}

// Deliberately demonstrate what grounding cannot prove. A real failure-rate
// fact can still be mislabeled as success. This is not a production fix/eval.
const misleading = renderReport({
  status: "answer", answerTemplate: "The success rate is {{e2.failure_rate}}.",
  factIds: ["e2.failure_rate"], findingIds: [],
}, evidence, snapshot);
const actualSuccess = evidence[1].facts.find((fact) => fact.id === "e2.success_rate");
assert.equal(misleading.answer, "The success rate is 60%.");
assert.equal(actualSuccess?.value, 40);
console.log(`\nKNOWN LIMIT: the renderer accepts this misleading sentence: "${misleading.answer}"`);
console.log(`The same tool reports an actual success rate of ${actualSuccess.value}%. A valid reference does not prove the claim uses it correctly.`);
console.log("\nLesson complete. Offline mechanics passed; live tool selection and interpretation remain untested.");
