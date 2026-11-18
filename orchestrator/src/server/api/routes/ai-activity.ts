import { toAppError } from "@infra/errors";
import { fail, ok } from "@infra/http";
import { listAiActivity } from "@server/services/ai-activity";
import { Router } from "express";

export const aiActivityRouter = Router();

/** GET /api/ai-activity?limit=100: this workspace's AI requests, newest first. */
aiActivityRouter.get("/", async (req, res) => {
  try {
    const limit = Number.parseInt(String(req.query.limit ?? "100"), 10);
    ok(res, await listAiActivity(Number.isFinite(limit) ? limit : 100));
  } catch (error) {
    fail(res, toAppError(error));
  }
});
