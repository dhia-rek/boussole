import { asyncRoute, ok, okWithMeta } from "@infra/http";
import { isDemoMode } from "@server/config/demo";
import { getAiAccountStatus } from "@server/services/ai-accounts/status";
import { getDesignResumeStatus } from "@server/services/design-resume";
import { resolveActiveAiProvider } from "@server/services/modelSelection";
import { suggestOnboardingSearchTerms } from "@server/services/onboarding-search-terms";
import { getActiveTenantId } from "@server/tenancy/context";
import { AI_PROVIDER_LABELS } from "@shared/types";
import { type Request, type Response, Router } from "express";

export const onboardingRouter = Router();

type ValidationResponse = {
  valid: boolean;
  message: string | null;
  status?: number | null;
};

/** Claude Code CLI is installed and signed in (runs a tiny prompt). */
/** The workspace's chosen AI account (Claude or ChatGPT) is signed in. */
async function validateLlm(): Promise<ValidationResponse> {
  const provider = await resolveActiveAiProvider();
  const status = await getAiAccountStatus(getActiveTenantId(), provider, {
    fresh: true,
  });
  if (status.signedIn) return { valid: true, message: null };
  return {
    valid: false,
    message:
      status.message ??
      `Sign in with your ${AI_PROVIDER_LABELS[provider]} account to use the AI features.`,
  };
}

/** The CV editor holds a CV (uploaded, imported or created). */
async function validateResumeConfig(): Promise<ValidationResponse> {
  try {
    const localStatus = await getDesignResumeStatus();
    if (localStatus.exists) {
      return { valid: true, message: null };
    }
    return {
      valid: false,
      message:
        "No CV yet. Upload a PDF or DOCX CV, or create one in the CV editor.",
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "CV validation failed.";
    return { valid: false, message };
  }
}

onboardingRouter.post("/validate/llm", async (_req: Request, res: Response) => {
  if (isDemoMode()) {
    return okWithMeta(
      res,
      {
        valid: true,
        message: "Demo mode: LLM validation is simulated.",
      },
      { simulated: true },
    );
  }

  ok(res, await validateLlm());
});

onboardingRouter.get(
  "/validate/resume",
  async (_req: Request, res: Response) => {
    if (isDemoMode()) {
      return okWithMeta(
        res,
        {
          valid: true,
          message: "Demo mode: resume validation is simulated.",
        },
        { simulated: true },
      );
    }

    const result = await validateResumeConfig();
    ok(res, result);
  },
);

onboardingRouter.post(
  "/search-terms/suggest",
  asyncRoute(async (_req: Request, res: Response) => {
    if (isDemoMode()) {
      return okWithMeta(
        res,
        {
          terms: [
            "Product Engineer",
            "Full Stack Engineer",
            "Frontend Engineer",
            "Backend Engineer",
            "Software Engineer",
          ],
          source: "fallback",
        },
        { simulated: true },
      );
    }

    const result = await suggestOnboardingSearchTerms();
    ok(res, result);
  }),
);
