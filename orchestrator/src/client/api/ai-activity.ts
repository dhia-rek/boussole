import { fetchApi } from "./core";

/** One request Boussole sent to the person's AI account. */
export type AiActivityItem = {
  id: string;
  label: string;
  provider: "claude" | "codex" | string;
  model: string | null;
  jobId: string | null;
  jobTitle: string | null;
  jobEmployer: string | null;
  status: "running" | "ok" | "error";
  promptChars: number;
  responseChars: number | null;
  promptPreview: string;
  responsePreview: string | null;
  error: string | null;
  startedAt: string;
  durationMs: number | null;
};

export function getAiActivity(limit = 100): Promise<AiActivityItem[]> {
  return fetchApi<AiActivityItem[]>(`/ai-activity?limit=${limit}`);
}
