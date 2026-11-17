import type { UpdateSettingsInput } from "@shared/settings-schema";
import type {
  AppSettings,
  DesignResumeDocument,
  DesignResumeExportResponse,
  DesignResumeJson,
  DesignResumePatchRequest,
  DesignResumePdfResponse,
  DesignResumeStatusResponse,
  DesignResumeVariantSummary,
  ResumeProfile,
  ResumeProjectCatalogItem,
  SearchTermsSuggestionResponse,
  ValidationResult,
} from "@shared/types";
import { fetchApi, fetchBlobApi, normalizeApiPath } from "./core";

let settingsPromise: Promise<AppSettings> | null = null;

export async function getSettings(): Promise<AppSettings> {
  if (settingsPromise) return settingsPromise;

  settingsPromise = fetchApi<AppSettings>("/settings").finally(() => {
    setTimeout(() => {
      settingsPromise = null;
    }, 100);
  });

  return settingsPromise;
}

export async function getProfileProjects(): Promise<
  ResumeProjectCatalogItem[]
> {
  return fetchApi<ResumeProjectCatalogItem[]>("/profile/projects");
}

export async function getResumeProjectsCatalog(): Promise<
  ResumeProjectCatalogItem[]
> {
  return getProfileProjects();
}

export async function getProfile(): Promise<ResumeProfile> {
  return fetchApi<ResumeProfile>("/profile");
}

/** Appends `?language=` so a request targets one CV variant (omit → primary). */
function withDesignResumeLanguage(
  path: string,
  language?: string | null,
): string {
  if (!language) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}language=${encodeURIComponent(language)}`;
}

export async function getDesignResume(
  language?: string | null,
): Promise<DesignResumeDocument> {
  return fetchApi<DesignResumeDocument>(
    withDesignResumeLanguage("/design-resume", language),
  );
}

export async function getDesignResumeStatus(): Promise<DesignResumeStatusResponse> {
  return fetchApi<DesignResumeStatusResponse>("/design-resume/status");
}

export async function importDesignResumeFromFile(input: {
  fileName: string;
  mediaType?: string;
  dataBase64: string;
  /** Creates/replaces that language variant (e.g. "en"); omit for the primary CV. */
  language?: string;
}): Promise<DesignResumeDocument> {
  return fetchApi<DesignResumeDocument>("/design-resume/import/file", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateDesignResume(
  input: DesignResumePatchRequest,
  language?: string | null,
): Promise<DesignResumeDocument> {
  return fetchApi<DesignResumeDocument>(
    withDesignResumeLanguage("/design-resume", language),
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );
}

export async function uploadDesignResumePictureFile(input: {
  file: File;
  baseRevision?: number;
  language?: string | null;
}): Promise<DesignResumeDocument> {
  return fetchApi<DesignResumeDocument>(
    withDesignResumeLanguage("/design-resume/assets", input.language),
    {
      method: "POST",
      headers: {
        "Content-Type": input.file.type || "application/octet-stream",
        "x-file-name": encodeURIComponent(input.file.name || "picture"),
        ...(input.baseRevision
          ? { "x-base-revision": String(input.baseRevision) }
          : {}),
      },
      body: await input.file.arrayBuffer(),
    },
  );
}

export async function deleteDesignResumePicture(
  input?: {
    baseRevision?: number;
    document?: DesignResumeJson;
  },
  language?: string | null,
): Promise<DesignResumeDocument> {
  return fetchApi<DesignResumeDocument>(
    withDesignResumeLanguage("/design-resume/assets/picture", language),
    {
      method: "DELETE",
      body: JSON.stringify(input ?? {}),
    },
  );
}

export async function exportDesignResume(
  language?: string | null,
): Promise<DesignResumeExportResponse> {
  return fetchApi<DesignResumeExportResponse>(
    withDesignResumeLanguage("/design-resume/export", language),
  );
}

export async function generateDesignResumePdf(
  language?: string | null,
): Promise<DesignResumePdfResponse> {
  return fetchApi<DesignResumePdfResponse>(
    withDesignResumeLanguage("/design-resume/generate-pdf", language),
    {
      method: "POST",
    },
  );
}

export async function getDesignResumePdfBlob(pdfUrl?: string): Promise<Blob> {
  return fetchBlobApi(
    pdfUrl ? normalizeApiPath(pdfUrl) : "/design-resume/pdf",
    { cache: "no-store" },
  );
}

/** Deletes a non-primary language variant; returns the remaining variants. */
export async function deleteDesignResumeVariant(
  language: string,
): Promise<DesignResumeVariantSummary[]> {
  return fetchApi<DesignResumeVariantSummary[]>(
    `/design-resume/variants/${encodeURIComponent(language)}`,
    { method: "DELETE" },
  );
}

export async function refreshProfile(): Promise<ResumeProfile> {
  return fetchApi<ResumeProfile>("/profile/refresh", {
    method: "POST",
  });
}

/** Checks that the Claude Code CLI is installed and signed in. */
export async function validateLlm(): Promise<ValidationResult> {
  return fetchApi<ValidationResult>("/onboarding/validate/llm", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function validateResumeConfig(): Promise<ValidationResult> {
  return fetchApi<ValidationResult>("/onboarding/validate/resume");
}

export async function suggestOnboardingSearchTerms(): Promise<SearchTermsSuggestionResponse> {
  return fetchApi<SearchTermsSuggestionResponse>(
    "/onboarding/search-terms/suggest",
    {
      method: "POST",
    },
  );
}

export async function updateSettings(
  update: Partial<UpdateSettingsInput>,
): Promise<AppSettings> {
  return fetchApi<AppSettings>("/settings", {
    method: "PATCH",
    body: JSON.stringify(update),
  });
}
