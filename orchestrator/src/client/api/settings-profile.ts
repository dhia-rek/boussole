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
  ProfileStatusResponse,
  ResumeProfile,
  ResumeProjectCatalogItem,
  SearchTermsSuggestionResponse,
  ValidationResult,
} from "@shared/types";
import type { CodexAuthStatusResponse } from "./auth";
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

export async function importDesignResumeFromRxResume(): Promise<DesignResumeDocument> {
  return fetchApi<DesignResumeDocument>("/design-resume/import/rxresume", {
    method: "POST",
  });
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

export async function getProfileStatus(): Promise<ProfileStatusResponse> {
  return fetchApi<ProfileStatusResponse>("/profile/status");
}

export async function refreshProfile(): Promise<ResumeProfile> {
  return fetchApi<ResumeProfile>("/profile/refresh", {
    method: "POST",
  });
}

export async function validateLlm(input: {
  provider?: string;
  baseUrl?: string;
  apiKey?: string;
}): Promise<ValidationResult> {
  return fetchApi<ValidationResult>("/onboarding/validate/llm", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getLlmModels(input?: {
  provider?: string;
  baseUrl?: string;
  apiKey?: string;
}): Promise<string[]> {
  const data = await fetchApi<{ models: string[] }>("/settings/llm-models", {
    method: "POST",
    body: JSON.stringify(input ?? {}),
  });
  return data.models;
}

export async function getCodexAuthStatus(): Promise<CodexAuthStatusResponse> {
  return fetchApi<CodexAuthStatusResponse>("/settings/codex-auth");
}

export async function startCodexAuth(input?: {
  forceRestart?: boolean;
}): Promise<CodexAuthStatusResponse> {
  return fetchApi<CodexAuthStatusResponse>("/settings/codex-auth/start", {
    method: "POST",
    body: JSON.stringify({
      forceRestart: input?.forceRestart ?? false,
    }),
  });
}

export async function disconnectCodexAuth(): Promise<CodexAuthStatusResponse> {
  return fetchApi<CodexAuthStatusResponse>("/settings/codex-auth/disconnect", {
    method: "POST",
  });
}

export async function validateRxresume(input?: {
  apiKey?: string;
  baseUrl?: string;
}): Promise<ValidationResult> {
  return fetchApi<ValidationResult>("/onboarding/validate/rxresume", {
    method: "POST",
    body: JSON.stringify(input ?? {}),
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

export async function getRxResumes(): Promise<{ id: string; name: string }[]> {
  const data = await fetchApi<{ resumes: { id: string; name: string }[] }>(
    `/settings/rx-resumes`,
  );
  return data.resumes;
}

export async function getRxResumeProjects(
  resumeId: string,
  signal?: AbortSignal,
): Promise<ResumeProjectCatalogItem[]> {
  const data = await fetchApi<{ projects: ResumeProjectCatalogItem[] }>(
    `/settings/rx-resumes/${encodeURIComponent(resumeId)}/projects`,
    { signal },
  );
  return data.projects;
}
