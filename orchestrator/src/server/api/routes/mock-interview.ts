import { asyncRoute, fail, ok } from "@infra/http";
import { runWithRequestContext } from "@infra/request-context";
import { badRequest } from "@server/infra/errors";
import * as mockInterviewService from "@server/services/mock-interview";
import { MOCK_INTERVIEW_ROUNDS } from "@shared/types";
import { type Request, Router } from "express";
import { z } from "zod";

export const mockInterviewRouter = Router({ mergeParams: true });

const turnSchema = z.object({
  role: z.enum(["interviewer", "candidate"]),
  content: z.string().trim().min(1).max(8000),
});

const requestTurnSchema = z.object({
  round: z.enum(MOCK_INTERVIEW_ROUNDS),
  transcript: z.array(turnSchema).max(80).default([]),
});

const requestReportSchema = z.object({
  round: z.enum(MOCK_INTERVIEW_ROUNDS),
  transcript: z.array(turnSchema).min(2).max(80),
});

function getJobId(req: Request): string {
  const jobId = req.params.id;
  if (!jobId) {
    throw badRequest("Missing job id");
  }
  return jobId;
}

mockInterviewRouter.post(
  "/turn",
  asyncRoute(async (req, res) => {
    const jobId = getJobId(req);
    const parsed = requestTurnSchema.safeParse(req.body);
    if (!parsed.success) {
      return fail(
        res,
        badRequest(parsed.error.message, parsed.error.flatten()),
      );
    }

    await runWithRequestContext({ jobId }, async () => {
      const result = await mockInterviewService.generateInterviewerTurn({
        jobId,
        round: parsed.data.round,
        transcript: parsed.data.transcript,
      });
      ok(res, result);
    });
  }),
);

mockInterviewRouter.post(
  "/report",
  asyncRoute(async (req, res) => {
    const jobId = getJobId(req);
    const parsed = requestReportSchema.safeParse(req.body);
    if (!parsed.success) {
      return fail(
        res,
        badRequest(parsed.error.message, parsed.error.flatten()),
      );
    }

    await runWithRequestContext({ jobId }, async () => {
      const report = await mockInterviewService.generateReport({
        jobId,
        round: parsed.data.round,
        transcript: parsed.data.transcript,
      });
      ok(res, report);
    });
  }),
);
