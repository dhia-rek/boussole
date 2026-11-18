import { forbidden, notFound } from "@infra/errors";
import { fail, ok } from "@infra/http";
import { logger } from "@infra/logger";
import { isDemoMode } from "@server/config/demo";
import * as jobsRepo from "@server/repositories/jobs";
import { getCvCheckForJob, startCvCheck } from "@server/services/cv-check";
import { type Request, type Response, Router } from "express";
import { toJobsRouteError } from "./shared";

export const jobsCvCheckRouter = Router();

function getRequestId(res: Response): string {
  return String(res.getHeader("x-request-id") || "unknown");
}

function failCvCheckRoute(
  req: Request,
  res: Response,
  route: string,
  error: unknown,
): void {
  const err = toJobsRouteError(error);
  logger.warn("CV check route failed", {
    route,
    jobId: req.params.id,
    requestId: getRequestId(res),
    status: err.status,
    code: err.code,
  });
  fail(res, err);
}

jobsCvCheckRouter.get("/:id/cv-check", async (req: Request, res: Response) => {
  const route = "GET /api/jobs/:id/cv-check";
  try {
    const job = await jobsRepo.getJobById(req.params.id);
    if (!job) {
      return failCvCheckRoute(req, res, route, notFound("Job not found"));
    }
    ok(res, await getCvCheckForJob(job));
  } catch (error) {
    failCvCheckRoute(req, res, route, error);
  }
});

jobsCvCheckRouter.post("/:id/cv-check", async (req: Request, res: Response) => {
  const route = "POST /api/jobs/:id/cv-check";
  try {
    if (isDemoMode()) {
      return failCvCheckRoute(
        req,
        res,
        route,
        forbidden("The CV check is not available in the demo."),
      );
    }
    const job = await jobsRepo.getJobById(req.params.id);
    if (!job) {
      return failCvCheckRoute(req, res, route, notFound("Job not found"));
    }
    const check = await startCvCheck(job);
    logger.info("CV check requested", {
      route,
      jobId: job.id,
      requestId: getRequestId(res),
    });
    ok(res, check, 202);
  } catch (error) {
    failCvCheckRoute(req, res, route, error);
  }
});
