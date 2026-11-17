import { notFound } from "@infra/errors";
import { fail, ok, okWithMeta } from "@infra/http";
import { logger } from "@infra/logger";
import { isDemoMode } from "@server/config/demo";
import { resolveRequestOrigin } from "@server/infra/request-origin";
import * as jobsRepo from "@server/repositories/jobs";
import { trackCanonicalActivationEvent } from "@server/services/activation-funnel";
import { transitionStage } from "@server/services/applicationTracking";
import { simulateApplyJob } from "@server/services/demo-simulator";
import { notifyJobCompleteWebhook } from "@server/services/jobs/webhooks";
import { type Request, type Response, Router } from "express";
import { hydrateJobPdfFreshness, requireJob, toJobsRouteError } from "./shared";

export const jobsApplicationRouter = Router();

jobsApplicationRouter.post(
  "/:id/apply",
  async (req: Request, res: Response) => {
    try {
      if (isDemoMode()) {
        const updatedJob = await simulateApplyJob(req.params.id);
        return okWithMeta(res, await hydrateJobPdfFreshness(updatedJob), {
          simulated: true,
        });
      }

      const job = await requireJob(req.params.id);

      const appliedAtDate = new Date();
      const appliedAt = appliedAtDate.toISOString();

      transitionStage(
        job.id,
        "applied",
        Math.floor(appliedAtDate.getTime() / 1000),
        {
          eventLabel: "Applied",
          actor: "system",
        },
        null,
      );

      const updatedJob = await jobsRepo.updateJob(job.id, {
        status: "applied",
        appliedAt,
      });

      if (updatedJob) {
        void trackCanonicalActivationEvent(
          "application_marked_applied",
          {
            source: "jobs_apply_route",
            had_pdf: Boolean(updatedJob.pdfPath),
            tracer_links_enabled: Boolean(updatedJob.tracerLinksEnabled),
          },
          {
            occurredAt: appliedAtDate,
            requestOrigin: resolveRequestOrigin(req),
            urlPath: "/jobs",
          },
        );
        notifyJobCompleteWebhook(updatedJob).catch((error) => {
          logger.warn("Job complete webhook dispatch failed", error);
        });
      }

      if (!updatedJob) {
        return fail(res, notFound("Job not found"));
      }

      ok(res, await hydrateJobPdfFreshness(updatedJob));
    } catch (error) {
      fail(res, toJobsRouteError(error));
    }
  },
);
