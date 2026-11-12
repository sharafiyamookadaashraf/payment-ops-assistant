import { Router } from "express";
import rateLimit from "express-rate-limit";
import type { Snapshot } from "./analytics.js";
import { createClaudeCompletion, investigate, type Completion } from "./copilot.js";

export function createOpsRouter(dependencies: {
  snapshot: (importId?: string) => Promise<Snapshot>;
  apiKey?: string; model?: string; complete?: Completion;
}) {
  const router = Router();
  router.post("/ask", rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: "draft-8", legacyHeaders: false,
    message: { message: "Too many investigations. Please try again later." } }), async (req, res) => {
    const body = req.body as Record<string, unknown> | null;
    if (!body || typeof body.question !== "string" || !body.question.trim() || body.question.length > 2000
      || (body.importId !== undefined && (typeof body.importId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(body.importId)))
      || Object.keys(body).some((key) => !["question", "importId"].includes(key))) {
      res.status(400).json({ message: "Provide a question (max 2000 characters) and an optional importId." }); return;
    }
    if ((!dependencies.apiKey && !dependencies.complete) || !dependencies.model) {
      res.status(503).json({ message: "Ops Copilot is not configured. Set ANTHROPIC_API_KEY and ANTHROPIC_MODEL on the API server." }); return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("Investigation timed out")), 90000);
    res.on("close", () => controller.abort());
    res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "Connection": "keep-alive", "X-Accel-Buffering": "no" });
    res.flushHeaders();
    const send = (event: unknown) => { if (!res.destroyed && !res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`); };
    const heartbeat = setInterval(() => { if (!res.destroyed) res.write(": heartbeat\n\n"); }, 15000);
    try {
      send({ type: "progress", message: "Reading payment snapshot…" });
      const snapshot = await dependencies.snapshot(body.importId as string | undefined);
      controller.signal.throwIfAborted();
      const result = await investigate({ question: body.question.trim(), model: dependencies.model, snapshot,
        complete: dependencies.complete ?? createClaudeCompletion(dependencies.apiKey!), signal: controller.signal, onProgress: send });
      send({ type: "report", ...result });
    } catch (error) {
      // SDK exceptions may contain provider payloads. Never forward them or keys.
      const status = typeof error === "object" && error !== null && "status" in error ? error.status : undefined;
      const message = status === 401 ? "Claude authentication failed. Check the API server configuration."
        : status === 429 ? "Claude rate limit reached. Please try again later."
        : status === 400 || status === 402 ? "Claude rejected the request. Check the configured model and API credit balance."
        : controller.signal.aborted ? "Investigation cancelled or timed out."
        : "Unable to produce a verified report. Check the dataset size, database connection, model access and question, then try again.";
      send({ type: "error", message });
    } finally {
      clearTimeout(timer); clearInterval(heartbeat); res.end();
    }
  });
  return router;
}
