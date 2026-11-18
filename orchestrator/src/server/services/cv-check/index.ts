/**
 * CV check for one job: the CV variant in the job's language becomes a
 * numbered dictionary of lines, the person's AI account reviews each line
 * against the job (keep / reword / cut + what's missing), and Boussole cleans
 * the answer up. Advisory only: the CV itself is never changed.
 */
import { unprocessableEntity } from "@infra/errors";
import { logger } from "@infra/logger";
import { sanitizeUnknown } from "@infra/sanitize";
import * as cvChecksRepo from "@server/repositories/cv-checks";
import {
  type CvCheck,
  DESIGN_RESUME_AI_SECTION_KEYS,
  type DesignResumeAiGuidance,
  type DesignResumeDocument,
  type Job,
} from "@shared/types";
import { getDesignResumeForJobLanguage } from "../design-resume";
import { createJobRunTracker } from "../job-runs";
import { LlmService } from "../llm/service";
import {
  resolveActiveAiProvider,
  resolveModelForProvider,
} from "../modelSelection";
import { buildCvDictionary } from "./dictionary";
import {
  buildCvReviewPrompt,
  CV_REVIEW_SCHEMA,
  normalizeCvReview,
} from "./review";

export const INTERRUPTED_MESSAGE =
  "The CV check was interrupted (the server restarted). Run it again.";
export const NO_CV_MESSAGE =
  "Import or create your CV first (Design Resume), then run the CV check.";

const runs = createJobRunTracker("A CV check is already running for this job.");

type ReviewLlm = Pick<LlmService, "callJson">;
let testLlm: ReviewLlm | null = null;
/** Test hook: replaces the AI account call. */
export function __setCvCheckLlmForTests(llm: ReviewLlm | null) {
  testLlm = llm;
}

const SECTION_NAMES: Partial<Record<string, string>> = {
  headline: "headline",
  summary: "summary",
  skills: "skills",
  projects: "projects",
};

/** The candidate's own rules from Design Resume → AI guidance, in plain words. */
export function formatCandidateRules(
  guidance: DesignResumeAiGuidance | null | undefined,
): string {
  if (!guidance) return "";
  const lines: string[] = [];
  for (const key of DESIGN_RESUME_AI_SECTION_KEYS) {
    const section = guidance.sections?.[key];
    if (!section || section.share === false) continue;
    const name = SECTION_NAMES[key] ?? key;
    if (key === "headline" && section.prefix.trim()) {
      lines.push(
        `- The headline must start with "${section.prefix.trim()}". Keep that prefix in any suggestion.`,
      );
    }
    if (key in SECTION_NAMES && section.mode === "keep") {
      lines.push(
        `- The candidate keeps the ${name} identical for every job. Only mark its lines "reword" or "cut" if they clearly hurt for this job.`,
      );
    }
    if (section.notes.trim()) {
      lines.push(`- Note about ${name}: ${section.notes.trim().slice(0, 400)}`);
    }
  }
  return lines.length
    ? [
        "CANDIDATE RULES (they override the instructions below):",
        ...lines,
      ].join("\n")
    : "";
}

function isCvChanged(
  check: cvChecksRepo.StoredCvCheck,
  current: DesignResumeDocument | null,
): boolean {
  if (check.status !== "done" || !check.cvId) return false;
  if (!current) return true;
  return current.id !== check.cvId || current.revision !== check.cvRevision;
}

/** The job's latest check; a "running" row with no live run is failed. */
export async function getCvCheckForJob(job: Job): Promise<CvCheck | null> {
  let check = await cvChecksRepo.getCvCheck(job.id);
  if (!check) return null;
  if (check.status === "running" && !runs.isRunning(job.id)) {
    await cvChecksRepo.finishCvCheckRow(check.id, {
      status: "failed",
      error: INTERRUPTED_MESSAGE,
    });
    check = (await cvChecksRepo.getCvCheck(job.id)) ?? check;
  }
  const current =
    check.status === "done"
      ? await getDesignResumeForJobLanguage(job.jobDescription)
      : null;
  return { ...check, cvChanged: isCvChanged(check, current) };
}

async function reviewCv(
  job: Job,
  check: cvChecksRepo.StoredCvCheck,
  cv: DesignResumeDocument,
): Promise<void> {
  const startedAt = Date.now();
  try {
    const lines = buildCvDictionary(cv.resumeJson, cv.aiGuidance);
    if (lines.length === 0) throw new Error("Your CV has no lines to check.");
    const llm = testLlm ?? new LlmService();
    const response = await llm.callJson<unknown>({
      model: check.model ?? "",
      messages: [
        {
          role: "user",
          content: buildCvReviewPrompt({
            job,
            lines,
            guidance: cv.aiGuidance,
            candidateRules: formatCandidateRules(cv.aiGuidance),
          }),
        },
      ],
      jsonSchema: CV_REVIEW_SCHEMA,
      maxRetries: 1,
      bypassCache: true,
      jobId: job.id,
    });
    if (!response.success) throw new Error(response.error);
    const result = normalizeCvReview(response.data, lines);
    await cvChecksRepo.finishCvCheckRow(check.id, { status: "done", result });
    logger.info("CV check finished", {
      jobId: job.id,
      lineCount: lines.length,
      reword: result.lines.filter((line) => line.verdict === "reword").length,
      cut: result.lines.filter((line) => line.verdict === "cut").length,
      missing: result.missing.length,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "The CV check failed.";
    logger.warn("CV check failed", {
      jobId: job.id,
      durationMs: Date.now() - startedAt,
      error: sanitizeUnknown(message),
    });
    await cvChecksRepo
      .finishCvCheckRow(check.id, {
        status: "failed",
        error: message.slice(0, 500),
      })
      .catch((saveError: unknown) => {
        logger.error("Could not save CV check failure", {
          jobId: job.id,
          error: sanitizeUnknown(saveError),
        });
      });
  }
}

/**
 * Starts a CV check and returns the "running" record. 422 when there is no
 * CV yet; CONFLICT when one is already running for this job.
 */
export async function startCvCheck(job: Job): Promise<CvCheck> {
  const cv = await getDesignResumeForJobLanguage(job.jobDescription);
  if (!cv) throw unprocessableEntity(NO_CV_MESSAGE);
  const check = await runs.start(
    job.id,
    async () => {
      const provider = await resolveActiveAiProvider();
      const model = (await resolveModelForProvider(provider)) || null;
      return cvChecksRepo.startCvCheckRow({
        jobId: job.id,
        provider,
        model,
        cvId: cv.id,
        cvTitle: cv.title,
        cvLanguage: cv.language,
        cvRevision: cv.revision,
      });
    },
    (started) => reviewCv(job, started, cv),
  );
  logger.info("CV check started", { jobId: job.id, cvLanguage: cv.language });
  return { ...check, cvChanged: false };
}

export async function waitForCvCheck(jobId: string): Promise<void> {
  await runs.wait(jobId);
}
