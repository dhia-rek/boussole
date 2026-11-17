import { createHash } from "node:crypto";
import type { Job, JobPdfFreshness } from "@shared/types";
import { getCurrentDesignResumeOrNullOnLegacy } from "./design-resume";

/**
 * Bump when the payload or the CV layout changes, so PDFs made before are
 * reported stale and re-rendered. v2: single Boussole LaTeX layout.
 */
const PDF_FINGERPRINT_VERSION = "v2";
type JobPdfFingerprintInput = Pick<
  Job,
  | "tailoredSummary"
  | "tailoredHeadline"
  | "tailoredSkills"
  | "selectedProjectIds"
  | "jobDescription"
  | "tracerLinksEnabled"
  | "employer"
>;

type JobPdfFreshnessInput = JobPdfFingerprintInput &
  Pick<Job, "pdfPath" | "pdfSource" | "pdfRegenerating" | "pdfFingerprint">;

export interface PdfFingerprintContext {
  version: typeof PDF_FINGERPRINT_VERSION;
  designResumeDocumentId: string | null;
  designResumeRevision: number | null;
  designResumeUpdatedAt: string | null;
}

export async function resolvePdfFingerprintContext(): Promise<PdfFingerprintContext> {
  const designResume = await getCurrentDesignResumeOrNullOnLegacy();
  return {
    version: PDF_FINGERPRINT_VERSION,
    designResumeDocumentId: designResume?.id ?? null,
    designResumeRevision: designResume?.revision ?? null,
    designResumeUpdatedAt: designResume?.updatedAt ?? null,
  };
}

export function createJobPdfFingerprint(
  job: JobPdfFingerprintInput,
  context: PdfFingerprintContext,
): string {
  const payload = {
    version: context.version,
    designResumeDocumentId: context.designResumeDocumentId,
    designResumeRevision: context.designResumeRevision,
    designResumeUpdatedAt: context.designResumeUpdatedAt,
    job: {
      tailoredSummary: job.tailoredSummary ?? null,
      tailoredHeadline: job.tailoredHeadline ?? null,
      tailoredSkills: job.tailoredSkills ?? null,
      selectedProjectIds: job.selectedProjectIds ?? null,
      jobDescription: job.jobDescription ?? null,
      tracerLinksEnabled: Boolean(job.tracerLinksEnabled),
      employer: job.employer ?? null,
    },
  };

  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function getJobPdfFreshness(
  job: JobPdfFreshnessInput,
  context: PdfFingerprintContext,
): JobPdfFreshness {
  if (job.pdfRegenerating) return "regenerating";
  if (!job.pdfPath) return "missing";
  if (job.pdfSource === "uploaded") return "uploaded";

  const nextFingerprint = createJobPdfFingerprint(job, context);
  return job.pdfFingerprint === nextFingerprint ? "current" : "stale";
}

export function applyJobPdfFreshness<T extends JobPdfFreshnessInput>(
  job: T,
  context: PdfFingerprintContext,
): T & { pdfFreshness: JobPdfFreshness } {
  return {
    ...job,
    pdfFreshness: getJobPdfFreshness(job, context),
  };
}

export function applyJobsPdfFreshness<T extends JobPdfFreshnessInput>(
  jobs: T[],
  context: PdfFingerprintContext,
): Array<T & { pdfFreshness: JobPdfFreshness }> {
  return jobs.map((job) => applyJobPdfFreshness(job, context));
}
