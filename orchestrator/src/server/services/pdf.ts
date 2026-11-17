/**
 * Generates PDF CVs from the CV editor's document (Design Resume), in the
 * Boussole LaTeX layout.
 */

import { existsSync } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import { AppError, type AppErrorCode } from "@infra/errors";
import { logger } from "@infra/logger";
import { getDesignResumeAssetById } from "@server/repositories/design-resume";
import { writingLanguageFromDesignResumeLanguage } from "@shared/design-resume-variants";
import type {
  DesignResumeAiGuidance,
  DesignResumePdfResponse,
} from "@shared/types";
import {
  getDesignResumeForJobLanguage,
  requireCurrentDesignResume,
} from "./design-resume";
import { resolveWritingOutputLanguageForResumeJson } from "./output-language";
import {
  getLegacyJobPdfPath,
  getTenantDesignResumePdfPath,
  getTenantJobPdfPath,
  getTenantPdfDir,
} from "./pdf-storage";
import { prepareTailoredResumeForPdf } from "./resume-data";
import { parseV5ResumeData } from "./resume-data/schema/v5";
import { renderResumePdf } from "./resume-renderer";
import { getWritingStyle } from "./writing-style";

export interface PdfResult {
  success: boolean;
  pdfPath?: string;
  error?: string;
  errorCode?: AppErrorCode;
}

export interface TailoredPdfContent {
  summary?: string | null;
  headline?: string | null;
  skills?: Array<{ name: string; keywords: string[] }> | null;
}

export interface GeneratePdfOptions {
  tracerLinksEnabled?: boolean;
  requestOrigin?: string | null;
  tracerCompanyName?: string | null;
}

async function ensureOutputDir(): Promise<void> {
  const outputDir = getTenantPdfDir();
  if (!existsSync(outputDir)) {
    await mkdir(outputDir, { recursive: true });
  }
}

function sanitizePdfFileName(value: string): string {
  const base = value
    .trim()
    .replace(/\.pdf$/i, "")
    .replace(/[^a-z0-9._-]+/gi, "_")
    .replace(/^_+|_+$/g, "");
  return `${base || "Design_Resume"}.pdf`;
}

const PICTURE_ASSET_URL = /\/api\/design-resume\/assets\/([^/?#]+)\/content/;

/**
 * Local file of the CV picture when it is a stored, visible asset of the
 * active workspace.
 */
async function resolveResumePhotoPath(
  resumeJson: Record<string, unknown>,
): Promise<string | null> {
  const picture = resumeJson.picture as
    | { url?: unknown; hidden?: unknown }
    | undefined;
  if (!picture || picture.hidden === true || typeof picture.url !== "string") {
    return null;
  }
  const match = PICTURE_ASSET_URL.exec(picture.url);
  if (!match?.[1]) return null;
  let assetId: string;
  try {
    assetId = decodeURIComponent(match[1]);
  } catch {
    return null; // A malformed picture URL renders the CV without a photo.
  }
  const asset = await getDesignResumeAssetById(assetId);
  return asset?.storagePath ?? null;
}

/**
 * Language of the LaTeX section titles: the CV variant's own language tag
 * wins (a French CV gets "Expérience", whatever the AI writing settings);
 * untagged CVs fall back to the writing style / detection.
 */
async function resolveLatexResumeLanguage(
  resumeJson: Record<string, unknown>,
  variantLanguage?: string | null,
) {
  const fromVariant = writingLanguageFromDesignResumeLanguage(variantLanguage);
  if (fromVariant) return fromVariant;
  const writingStyle = await getWritingStyle();
  return resolveWritingOutputLanguageForResumeJson({
    style: writingStyle,
    resumeJson,
  }).language;
}

function classifyPdfGenerationError(error: unknown): AppErrorCode {
  if (error instanceof AppError) {
    return error.code;
  }

  if (error instanceof Error && error.name === "AbortError") {
    return "REQUEST_TIMEOUT";
  }

  return "INTERNAL_ERROR";
}

/** The CV (in the job's language when a variant exists) used as the base. */
async function loadBaseResume(jobDescription?: string | null): Promise<{
  data: Record<string, unknown>;
  aiGuidance: DesignResumeAiGuidance | null;
  language: string | null;
}> {
  const designResume = await getDesignResumeForJobLanguage(jobDescription);
  if (!designResume?.resumeJson) {
    throw new AppError({
      status: 409,
      code: "CONFLICT",
      message: "No CV yet. Create or import your CV in the CV editor first.",
    });
  }
  return {
    data: parseV5ResumeData(
      designResume.resumeJson as Record<string, unknown>,
    ) as Record<string, unknown>,
    aiGuidance: designResume.aiGuidance,
    language: designResume.language,
  };
}

/**
 * Generate a tailored PDF CV for a job.
 *
 * Flow:
 * 1. Prepare the CV data with tailored content and project selection
 * 2. Normalize it into the LaTeX document model
 * 3. Render the PDF (one page, Boussole layout, photo when the CV has one)
 */
export async function generatePdf(
  jobId: string,
  tailoredContent: TailoredPdfContent,
  jobDescription: string,
  _baseResumePath?: string, // Deprecated: the CV editor's document is always the base
  selectedProjectIds?: string | null,
  options?: GeneratePdfOptions,
): Promise<PdfResult> {
  try {
    logger.info("Generating PDF resume", { jobId });

    await ensureOutputDir();

    const baseResume = await loadBaseResume(jobDescription);

    let preparedResume: Awaited<
      ReturnType<typeof prepareTailoredResumeForPdf>
    > | null = null;
    try {
      preparedResume = await prepareTailoredResumeForPdf({
        resumeData: baseResume.data,
        tailoredContent,
        jobDescription,
        selectedProjectIds,
        aiGuidance: baseResume.aiGuidance,
        jobId,
        tracerLinks: {
          enabled: Boolean(options?.tracerLinksEnabled),
          requestOrigin: options?.requestOrigin ?? null,
          companyName: options?.tracerCompanyName ?? null,
        },
      });
    } catch (err) {
      logger.warn("Resume tailoring step failed during PDF generation", {
        jobId,
        error: err,
      });
      throw err;
    }

    const outputPath = getTenantJobPdfPath(jobId);
    await renderResumePdf({
      resumeJson: preparedResume.data,
      outputPath,
      jobId,
      language: await resolveLatexResumeLanguage(
        preparedResume.data,
        baseResume.language,
      ),
      photoPath: await resolveResumePhotoPath(preparedResume.data),
    });

    logger.info("PDF generated successfully", { jobId, outputPath });
    return { success: true, pdfPath: outputPath };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("PDF generation failed", { jobId, error });
    return {
      success: false,
      error: message,
      errorCode: classifyPdfGenerationError(error),
    };
  }
}

export async function generateDesignResumePdf(options?: {
  requestOrigin?: string | null;
  /** CV variant to render (e.g. "en"); omitted → the primary CV. */
  language?: string | null;
}): Promise<DesignResumePdfResponse> {
  const document = await requireCurrentDesignResume({
    language: options?.language ?? null,
  });
  const data = parseV5ResumeData(
    document.resumeJson as Record<string, unknown>,
  ) as Record<string, unknown>;
  const generatedAt = new Date().toISOString();
  const languageParam = options?.language ?? null;
  const outputPath = getTenantDesignResumePdfPath(languageParam);

  await ensureOutputDir();

  logger.info("Generating Design Resume PDF", { documentId: document.id });

  await renderResumePdf({
    resumeJson: data,
    outputPath,
    jobId: "design-resume",
    language: await resolveLatexResumeLanguage(data, document.language),
    photoPath: await resolveResumePhotoPath(data),
  });

  const query = new URLSearchParams({ v: generatedAt });
  if (languageParam) query.set("language", languageParam);
  return {
    fileName: sanitizePdfFileName(
      document.language
        ? `${document.title}_${document.language}`
        : document.title,
    ),
    pdfUrl: `/api/design-resume/pdf?${query.toString()}`,
    generatedAt,
  };
}

/**
 * Check if a PDF exists for a job.
 */
export async function pdfExists(jobId: string): Promise<boolean> {
  const pdfPath = getTenantJobPdfPath(jobId);
  try {
    await access(pdfPath);
    return true;
  } catch {
    try {
      await access(getLegacyJobPdfPath(jobId));
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Get the path to a job's PDF.
 */
export function getPdfPath(jobId: string): string {
  const pdfPath = getTenantJobPdfPath(jobId);
  if (existsSync(pdfPath)) return pdfPath;
  return getLegacyJobPdfPath(jobId);
}
