import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Message, MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages";
import { investigate, renderReport, type Completion } from "./copilot.js";
import { runAnalytics, type Snapshot } from "./analytics.js";
import { createOpsRouter } from "./routes.js";
const snapshot: Snapshot = { source: "memory", asOf: "2026-11-12T12:00:00Z", importId: null, rows: [] };
const message = (content: Message["content"], stop: Message["stop_reason"] = "end_turn"): Message => ({ id: "msg_test", type: "message", role: "assistant", model: "test", content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } } as Message);
const report = (changes = {}) => ({ status: "answer", answerTemplate: "The selected scope contains {{e1.total}}.", factIds: ["e1.total"], findingIds: [], ...changes });
const final = (changes = {}) => message([{ type: "text", text: JSON.stringify(report(changes)), citations: null }]);
const call = (name = "get_summary", input = {}) => message([{ type: "tool_use", caller: { type: "direct" }, id: "call_1", name, input }], "tool_use");
const options = (complete: Completion) => ({ question: "Summarize payments", model: "test", snapshot, complete, signal: new AbortController().signal });

test("tool loop returns evidence-rendered numbers and preserves protocol messages", async () => {
  const requests: MessageCreateParamsNonStreaming[] = [];
  const events: string[] = [];
  const result = await investigate({ ...options(async (request) => { requests.push(structuredClone(request)); return requests.length === 1 ? call() : final(); }), onProgress: (event) => events.push(event.message) });
  assert.equal(result.report.answer, "The selected scope contains 0 transactions.");
  assert.equal(result.usage.toolCalls, 1);
  assert.equal(requests[1].messages[1].role, "assistant");
  const response = requests[1].messages[2].content;
  assert.ok(Array.isArray(response)); assert.equal(response[0].type, "tool_result");
  assert.ok(events.includes("Running get_summary…"));
});
test("parallel tool calls receive matching IDs in one results message", async () => {
  let round = 0;
  await investigate(options(async (request) => {
    if (!round++) return message([{ type: "tool_use", caller: { type: "direct" }, id: "a", name: "get_summary", input: {} }, { type: "tool_use", caller: { type: "direct" }, id: "b", name: "find_duplicates", input: {} }], "tool_use");
    const result = request.messages[2].content;
    assert.ok(Array.isArray(result)); assert.equal(result.length, 2);
    assert.equal((result[1] as { tool_use_id: string }).tool_use_id, "b");
    return final();
  }));
});
test("rejects invented amounts, evidence references and answers without tools", () => {
  const results = [runAnalytics("get_summary", {}, snapshot, "e1")];
  for (const raw of [report({ answerTemplate: "The total is 500 SEK" }), report({ answerTemplate: "There were five failures" }), report({ factIds: ["invented"] }), report({ findingIds: ["invented"] }), report({ answerTemplate: "{{e99.total}}" })]) assert.throws(() => renderReport(raw, results, snapshot));
  assert.throws(() => renderReport(report(), [], snapshot));
});
test("clarification is allowed without tools", async () => {
  const result = await investigate(options(async () => final({ status: "needs_clarification", answerTemplate: "Which calendar date do you mean?", factIds: [] })));
  assert.equal(result.report.status, "needs_clarification");
});
test("unknown tools return an error to Claude, then known tools can recover", async () => {
  let round = 0;
  const result = await investigate(options(async (request) => {
    round++;
    if (round === 1) return call("delete_transactions");
    if (round === 2) {
      assert.match(JSON.stringify(request.messages.at(-1)), /is_error/);
      return call();
    }
    return final({ answerTemplate: "Found {{e2.total}}.", factIds: ["e2.total"] });
  }));
  assert.equal(result.usage.toolCalls, 2);
});
test("max_tokens, refusal, endless tool requests and cancellation fail closed", async () => {
  for (const stop of ["max_tokens", "refusal"] as const) await assert.rejects(investigate(options(async () => message([], stop))), /stopped/);
  let rounds = 0;
  await assert.rejects(investigate(options(async () => { rounds++; return call(); })), /round limit/);
  assert.equal(rounds, 6);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(investigate({ ...options(async () => final()), signal: controller.signal }));
});
test("HTTP endpoint validates input, configuration and streams a complete report", async () => {
  const app = express(); app.use(express.json());
  let round = 0;
  app.use("/api", createOpsRouter({ snapshot: async () => snapshot, model: "test", complete: async () => ++round === 1 ? call() : final() }));
  app.use("/unconfigured", createOpsRouter({ snapshot: async () => snapshot }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`;
  const post = (path: string, body: unknown) => fetch(url + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  try {
    assert.equal((await post("/api/ask", { question: "" })).status, 400);
    assert.equal((await post("/unconfigured/ask", { question: "Summary" })).status, 503);
    const response = await post("/api/ask", { question: "Summary" });
    assert.match(response.headers.get("Content-Type") ?? "", /text\/event-stream/);
    const text = await response.text(); assert.match(text, /"type":"progress"/); assert.match(text, /"type":"report"/); assert.match(text, /0 transactions/);
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
});
