import { Router } from "express";
import { AnalyticsQueryError, type FailureAnalytics } from "./failureAnalytics.js";

export function createFailureAnalyticsRouter(
  getSummary: (query: Record<string, unknown>) => Promise<FailureAnalytics>,
): Router {
  const router = Router();
  router.get("/failures", async (req, res) => {
    try {
      res.json(await getSummary(req.query));
    } catch (error) {
      if (error instanceof AnalyticsQueryError) {
        res.status(400).json({ message: error.message });
        return;
      }
      // Do not report an empty dataset (or reveal DB details) on query failure.
      res.status(503).json({ message: "Failure analytics are temporarily unavailable." });
    }
  });
  return router;
}
