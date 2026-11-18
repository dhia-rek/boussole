import { badRequest, forbidden, toAppError } from "@infra/errors";
import { fail, ok } from "@infra/http";
import { logger } from "@infra/logger";
import { isDemoMode } from "@server/config/demo";
import {
  getOutreachOrThrow,
  listOutreachHistory,
  listOutreachSuggestions,
  logOutreachSent,
  startOutreach,
  writeEmail,
} from "@server/services/spontaneous";
import { type Request, type Response, Router } from "express";
import { z } from "zod";

export const spontaneousRouter = Router();

function requestId(res: Response): string {
  return String(res.getHeader("x-request-id") || "unknown");
}

function failRoute(res: Response, route: string, error: unknown): void {
  const err = toAppError(error);
  logger.warn("Spontaneous route failed", {
    route,
    requestId: requestId(res),
    status: err.status,
    code: err.code,
  });
  fail(res, err);
}

function refuseInDemo(res: Response, route: string): boolean {
  if (!isDemoMode()) return false;
  failRoute(
    res,
    route,
    forbidden("Spontaneous applications are not available in the demo."),
  );
  return true;
}

const startSchema = z.object({
  company: z.string().trim().min(1).max(200),
  website: z.string().trim().max(300).optional().nullable(),
});

const emailSchema = z.object({
  recipient: z.string().trim().max(320).optional().nullable(),
  recipientName: z.string().trim().max(120).optional().nullable(),
  targetRole: z.string().trim().max(200).optional().nullable(),
  language: z.enum(["fr", "en"]).default("fr"),
});

const sentSchema = z.object({
  recipient: z.string().trim().max(320).optional().nullable(),
  subject: z.string().trim().min(1).max(300),
  body: z.string().trim().min(1).max(10_000),
});

spontaneousRouter.get("/suggestions", async (_req, res) => {
  try {
    ok(res, await listOutreachSuggestions());
  } catch (error) {
    failRoute(res, "GET /api/spontaneous/suggestions", error);
  }
});

spontaneousRouter.get("/outreach", async (_req, res) => {
  try {
    ok(res, await listOutreachHistory());
  } catch (error) {
    failRoute(res, "GET /api/spontaneous/outreach", error);
  }
});

spontaneousRouter.post("/outreach", async (req: Request, res: Response) => {
  const route = "POST /api/spontaneous/outreach";
  if (refuseInDemo(res, route)) return;
  const parsed = startSchema.safeParse(req.body);
  if (!parsed.success) {
    return failRoute(
      res,
      route,
      badRequest("Enter a company name or website."),
    );
  }
  try {
    ok(res, await startOutreach(parsed.data), 202);
  } catch (error) {
    failRoute(res, route, error);
  }
});

spontaneousRouter.get("/outreach/:id", async (req, res) => {
  try {
    ok(res, await getOutreachOrThrow(req.params.id));
  } catch (error) {
    failRoute(res, "GET /api/spontaneous/outreach/:id", error);
  }
});

spontaneousRouter.post("/outreach/:id/email", async (req, res) => {
  const route = "POST /api/spontaneous/outreach/:id/email";
  if (refuseInDemo(res, route)) return;
  const parsed = emailSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return failRoute(res, route, badRequest("Invalid email request"));
  }
  try {
    ok(
      res,
      await writeEmail(req.params.id, {
        recipient: parsed.data.recipient || null,
        recipientName: parsed.data.recipientName || null,
        targetRole: parsed.data.targetRole || null,
        language: parsed.data.language,
      }),
    );
  } catch (error) {
    failRoute(res, route, error);
  }
});

spontaneousRouter.post("/outreach/:id/sent", async (req, res) => {
  const route = "POST /api/spontaneous/outreach/:id/sent";
  if (refuseInDemo(res, route)) return;
  const parsed = sentSchema.safeParse(req.body);
  if (!parsed.success) {
    return failRoute(res, route, badRequest("Invalid sent request"));
  }
  try {
    ok(
      res,
      await logOutreachSent(req.params.id, {
        recipient: parsed.data.recipient || null,
        subject: parsed.data.subject,
        body: parsed.data.body,
      }),
    );
  } catch (error) {
    failRoute(res, route, error);
  }
});
