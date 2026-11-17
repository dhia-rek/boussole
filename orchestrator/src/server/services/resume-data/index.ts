/**
 * The CV data format (Reactive Resume's open v5 JSON, which the CV editor
 * stores) and the per-job preparation applied before rendering a PDF.
 */
import { getSetting } from "@server/repositories/settings";
import { selectProjectIdsForJob } from "@server/services/projectSelection";
import { resolveStoredProjectSelection } from "@server/services/resumeProjects";
import {
  resolveTracerPublicBaseUrl,
  rewriteResumeLinksWithTracer,
} from "@server/services/tracer-links";
import type {
  DesignResumeAiGuidance,
  ResumeProjectCatalogItem,
} from "@shared/types";
import {
  getResumeSchemaValidationMessage,
  safeParseV5ResumeData,
} from "./schema";
import {
  applyProjectVisibility,
  applyTailoredChunks,
  cloneResumeData,
  extractProjectsFromResume as extractProjectsFromResumeV5,
  type TailoredSkillsInput,
} from "./tailoring";

export type PreparedResumePdfPayload = {
  mode: "v5";
  data: Record<string, unknown>;
  projectCatalog: ResumeProjectCatalogItem[];
  selectedProjectIds: string[];
};

export function extractProjectsFromResume(resumeData: unknown): {
  mode: "v5";
  catalog: ResumeProjectCatalogItem[];
} {
  const parsed = safeParseV5ResumeData(resumeData);
  if (!parsed.success) {
    throw new Error(getResumeSchemaValidationMessage(parsed.error));
  }
  const { catalog } = extractProjectsFromResumeV5(
    parsed.data as Record<string, unknown>,
  );
  return { mode: "v5", catalog };
}

export async function prepareTailoredResumeForPdf(args: {
  resumeData: unknown;
  tailoredContent: {
    summary?: string | null;
    headline?: string | null;
    skills?: TailoredSkillsInput;
  };
  jobDescription: string;
  selectedProjectIds?: string | null;
  tracerLinks?: {
    enabled: boolean;
    requestOrigin?: string | null;
    companyName?: string | null;
  };
  forceVisibleProjectsSection?: boolean;
  jobId?: string;
  /** Guidance of the CV being rendered: locked sections are left verbatim. */
  aiGuidance?: DesignResumeAiGuidance | null;
}): Promise<PreparedResumePdfPayload> {
  const parsed = safeParseV5ResumeData(args.resumeData);
  if (!parsed.success) {
    throw new Error(getResumeSchemaValidationMessage(parsed.error));
  }

  const workingCopy = cloneResumeData(parsed.data as Record<string, unknown>);
  const sections = args.aiGuidance?.sections;
  applyTailoredChunks({
    resumeData: workingCopy,
    tailoredContent: {
      headline:
        sections?.headline.mode === "keep"
          ? null
          : args.tailoredContent.headline,
      summary:
        sections?.summary.mode === "keep" ? null : args.tailoredContent.summary,
      skills:
        sections?.skills.mode === "keep" ? null : args.tailoredContent.skills,
    },
  });

  const { catalog, selectionItems } = extractProjectsFromResumeV5(workingCopy);

  // A locked projects section always renders exactly as written; otherwise a
  // usable per-job selection wins, and a missing or stale one is recomputed.
  const storedSelection =
    sections?.projects.mode === "keep"
      ? null
      : resolveStoredProjectSelection(args.selectedProjectIds, catalog);
  const selectedIds =
    storedSelection ??
    (await selectProjectIdsForJob({
      jobDescription: args.jobDescription,
      selectionItems,
      overrideRaw: await getSetting("resumeProjects"),
      guidance: args.aiGuidance,
    }));

  applyProjectVisibility({
    resumeData: workingCopy,
    selectedProjectIds: new Set(selectedIds),
    forceVisibleProjectsSection: args.forceVisibleProjectsSection,
  });

  if (args.tracerLinks?.enabled) {
    const tracerBaseUrl = resolveTracerPublicBaseUrl({
      requestOrigin: args.tracerLinks.requestOrigin,
    });
    if (!tracerBaseUrl) {
      throw new Error(
        "Tracer links are enabled but no public base URL is available. Set FORSA_PUBLIC_BASE_URL.",
      );
    }
    if (!args.jobId) {
      throw new Error(
        "Tracer links are enabled but jobId was not provided for resume tailoring.",
      );
    }

    await rewriteResumeLinksWithTracer({
      jobId: args.jobId,
      resumeData: workingCopy,
      publicBaseUrl: tracerBaseUrl,
      companyName: args.tracerLinks.companyName ?? null,
    });
  }

  return {
    mode: "v5",
    data: workingCopy,
    projectCatalog: catalog,
    selectedProjectIds: selectedIds,
  };
}
