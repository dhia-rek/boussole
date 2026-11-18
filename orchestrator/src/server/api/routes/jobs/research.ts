import { forbidden, notFound } from "@infra/errors";
import { fail, ok } from "@infra/http";
import { logger } from "@infra/logger";
import { isDemoMode } from "@server/config/demo";
import * as jobsRepo from "@server/repositories/jobs";
import {
  getCompanyResearchForJob,
  startCompanyResearch,
} from "@server/services/company-research";
import { type Request, type Response, Router } from "express";
import { toJobsRouteError } from "./shared";

export const jobsResearchRouter = Router();

function getRequestId(res: Response): string {
  return String(res.getHeader("x-request-id") || "unknown");
}

function failResearchRoute(
  req: Request,
  res: Response,
  route: string,
  error: unknown,
): void {
  const err = toJobsRouteError(error);
  logger.warn("Company research route failed", {
    route,
    jobId: req.params.id,
    requestId: getRequestId(res),
    status: err.status,
    code: err.code,
  });
  fail(res, err);
}

jobsResearchRouter.get("/:id/research", async (req: Request, res: Response) => {
  const route = "GET /api/jobs/:id/research";
  try {
    const job = await jobsRepo.getJobById(req.params.id);
    if (!job)
      return failResearchRoute(req, res, route, notFound("Job not found"));
    ok(res, await getCompanyResearchForJob(job.id));
  } catch (error) {
    failResearchRoute(req, res, route, error);
  }
});

jobsResearchRouter.post(
  "/:id/research",
  async (req: Request, res: Response) => {
    const route = "POST /api/jobs/:id/research";
    try {
      if (isDemoMode()) {
        return failResearchRoute(
          req,
          res,
          route,
          forbidden("Company research is not available in the demo."),
        );
      }
      const job = await jobsRepo.getJobById(req.params.id);
      if (!job) {
        return failResearchRoute(req, res, route, notFound("Job not found"));
      }
      const research = await startCompanyResearch(job);
      logger.info("Company research requested", {
        route,
        jobId: job.id,
        requestId: getRequestId(res),
      });
      ok(res, research, 202);
    } catch (error) {
      failResearchRoute(req, res, route, error);
    }
  },
);
