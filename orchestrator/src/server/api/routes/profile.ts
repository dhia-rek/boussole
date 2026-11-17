import { toAppError } from "@infra/errors";
import { fail, ok } from "@infra/http";
import { isDemoMode } from "@server/config/demo";
import { DEMO_PROJECT_CATALOG } from "@server/config/demo-defaults";
import { getDesignResumeStatus } from "@server/services/design-resume";
import { clearProfileCache, getProfile } from "@server/services/profile";
import { extractProjectsFromProfile } from "@server/services/resumeProjects";
import { type Request, type Response, Router } from "express";

export const profileRouter = Router();

/**
 * GET /api/profile/projects - Get all projects available in the base resume
 */
profileRouter.get("/projects", async (_req: Request, res: Response) => {
  try {
    if (isDemoMode()) {
      ok(res, DEMO_PROJECT_CATALOG);
      return;
    }
    const profile = await getProfile();
    const { catalog } = extractProjectsFromProfile(profile);
    ok(res, catalog);
  } catch (error) {
    fail(res, toAppError(error));
  }
});

/**
 * GET /api/profile - Get the full base resume profile
 */
profileRouter.get("/", async (_req: Request, res: Response) => {
  try {
    const profile = await getProfile();
    ok(res, profile);
  } catch (error) {
    fail(res, toAppError(error));
  }
});

/**
 * GET /api/profile/status - Whether the CV editor holds a CV
 */
profileRouter.get("/status", async (_req: Request, res: Response) => {
  try {
    const localStatus = await getDesignResumeStatus();
    ok(res, {
      exists: localStatus.exists,
      error: localStatus.exists
        ? null
        : "No CV yet. Upload a PDF or DOCX CV, or create one in the CV editor.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    ok(res, { exists: false, error: message });
  }
});

/**
 * POST /api/profile/refresh - Clear the profile cache and reload the CV
 */
profileRouter.post("/refresh", async (_req: Request, res: Response) => {
  try {
    clearProfileCache();
    const profile = await getProfile(true);
    ok(res, profile);
  } catch (error) {
    fail(res, toAppError(error));
  }
});
