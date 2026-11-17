/**
 * Settings → AI account: each workspace signs in with its own Claude or
 * ChatGPT account through the provider's own sign-in page.
 */
import { AppError, badRequest } from "@infra/errors";
import { asyncRoute, fail, ok } from "@infra/http";
import { isDemoMode, sendDemoBlocked } from "@server/config/demo";
import {
  AiSignInError,
  cancelAiSignIn,
  getAiAccountOverview,
  signOutAiAccount,
  startAiSignIn,
  submitAiSignInCode,
} from "@server/services/ai-accounts";
import { getActiveTenantId } from "@server/tenancy/context";
import { AI_PROVIDERS, CLAUDE_SIGN_IN_MODES } from "@shared/types";
import { type Request, type Response, Router } from "express";
import { z } from "zod";

export const aiAccountRouter = Router();

/** Sign-in starts allowed per workspace per hour. */
const SIGN_IN_STARTS_PER_HOUR = 10;
const signInStarts = new Map<string, number[]>();

function consumeSignInStart(tenantId: string, now = Date.now()): number {
  const recent = (signInStarts.get(tenantId) ?? []).filter(
    (at) => now - at < 60 * 60_000,
  );
  if (recent.length >= SIGN_IN_STARTS_PER_HOUR) {
    signInStarts.set(tenantId, recent);
    const oldest = recent[0] ?? now;
    return Math.max(1, Math.ceil((oldest + 60 * 60_000 - now) / 1000));
  }
  recent.push(now);
  signInStarts.set(tenantId, recent);
  return 0;
}

export function __resetAiSignInRateLimitForTests(): void {
  signInStarts.clear();
}

const startSchema = z.object({
  provider: z.enum(AI_PROVIDERS),
  mode: z.enum(CLAUDE_SIGN_IN_MODES).optional(),
});
const codeSchema = z.object({ code: z.string().trim().min(1).max(2048) });
const providerSchema = z.object({ provider: z.enum(AI_PROVIDERS) });

function failSignIn(res: Response, error: unknown): void {
  if (error instanceof AiSignInError) {
    fail(
      res,
      new AppError({
        status: error.status,
        code: error.status === 400 ? "INVALID_REQUEST" : "CONFLICT",
        message: error.message,
      }),
    );
    return;
  }
  throw error;
}

aiAccountRouter.get(
  "/",
  asyncRoute(async (req: Request, res: Response) => {
    ok(res, await getAiAccountOverview({ fresh: req.query.fresh === "1" }));
  }),
);

aiAccountRouter.post(
  "/sign-in",
  asyncRoute(async (req: Request, res: Response) => {
    if (isDemoMode()) {
      return sendDemoBlocked(
        res,
        "AI sign-in is disabled in the public demo.",
        {
          route: "POST /api/ai-account/sign-in",
        },
      );
    }
    const parsed = startSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      fail(res, badRequest("Invalid request body", parsed.error.flatten()));
      return;
    }
    const tenantId = getActiveTenantId();
    const retryAfter = consumeSignInStart(tenantId);
    if (retryAfter > 0) {
      res.setHeader("Retry-After", String(retryAfter));
      fail(
        res,
        new AppError({
          status: 429,
          code: "TOO_MANY_REQUESTS",
          message: "Too many sign-in attempts. Try again later.",
        }),
      );
      return;
    }
    ok(
      res,
      await startAiSignIn(tenantId, parsed.data.provider, {
        claudeMode: parsed.data.mode,
      }),
    );
  }),
);

aiAccountRouter.post(
  "/sign-in/code",
  asyncRoute(async (req: Request, res: Response) => {
    const parsed = codeSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      fail(res, badRequest("Paste the code from the sign-in page."));
      return;
    }
    try {
      ok(res, submitAiSignInCode(getActiveTenantId(), parsed.data.code));
    } catch (error) {
      failSignIn(res, error);
    }
  }),
);

aiAccountRouter.delete(
  "/sign-in",
  asyncRoute(async (_req: Request, res: Response) => {
    ok(res, cancelAiSignIn(getActiveTenantId()));
  }),
);

aiAccountRouter.post(
  "/sign-out",
  asyncRoute(async (req: Request, res: Response) => {
    if (isDemoMode()) {
      return sendDemoBlocked(
        res,
        "AI sign-out is disabled in the public demo.",
        {
          route: "POST /api/ai-account/sign-out",
        },
      );
    }
    const parsed = providerSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      fail(res, badRequest("Invalid request body", parsed.error.flatten()));
      return;
    }
    await signOutAiAccount(getActiveTenantId(), parsed.data.provider);
    ok(res, { signedOut: true });
  }),
);
