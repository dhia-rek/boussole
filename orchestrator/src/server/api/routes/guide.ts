import { toAppError } from "@infra/errors";
import { fail, ok } from "@infra/http";
import { logger } from "@infra/logger";
import {
  getApplyProgress,
  getNextSteps,
  getReviewQueue,
} from "@server/services/guide";
import { type Response, Router } from "express";

export const guideRouter = Router();

function failGuide(res: Response, route: string, error: unknown) {
  const err = toAppError(error);
  logger.warn("Guide route failed", {
    route,
    requestId: String(res.getHeader("x-request-id") || "unknown"),
    status: err.status,
    code: err.code,
  });
  fail(res, err);
}

/** GET /api/guide/next-steps: the next thing to do, then a few after it. */
guideRouter.get("/next-steps", async (_req, res) => {
  try {
    ok(res, await getNextSteps());
  } catch (error) {
    failGuide(res, "GET /api/guide/next-steps", error);
  }
});

/** GET /api/guide/review: good fresh matches to choose from, best first. */
guideRouter.get("/review", async (_req, res) => {
  try {
    ok(res, await getReviewQueue());
  } catch (error) {
    failGuide(res, "GET /api/guide/review", error);
  }
});

/** GET /api/guide/progress/:jobId: which guided steps one job went through. */
guideRouter.get("/progress/:jobId", async (req, res) => {
  try {
    ok(res, await getApplyProgress(req.params.jobId));
  } catch (error) {
    failGuide(res, "GET /api/guide/progress/:jobId", error);
  }
});
