/**
 * Settings page helpers.
 */

import type { ResumeProjectsSettings } from "@shared/types";
import { arraysEqual } from "@/lib/utils";

export function resumeProjectsEqual(
  a: ResumeProjectsSettings,
  b: ResumeProjectsSettings,
) {
  return (
    a.maxProjects === b.maxProjects &&
    arraysEqual(a.lockedProjectIds, b.lockedProjectIds) &&
    arraysEqual(a.aiSelectableProjectIds, b.aiSelectableProjectIds)
  );
}

export const formatSecretHint = (hint: string | null) =>
  hint ? `${hint}********` : "Not set";

export const LLM_PROVIDERS = [
  "openrouter",
  "openai",
  "openai_compatible",
  "gemini",
  "gemini_cli",
  "claude_cli",
  "codex",
] as const;

export type LlmProviderId = (typeof LLM_PROVIDERS)[number];
export const LLM_MODEL_SUGGESTION_PROVIDERS = [
  "openai",
  "gemini",
  "gemini_cli",
  "claude_cli",
] as const;

export const LLM_PROVIDER_LABELS: Record<LlmProviderId, string> = {
  openrouter: "OpenRouter",
  openai: "OpenAI",
  openai_compatible: "OpenAI-compatible",
  gemini: "Gemini",
  gemini_cli: "Gemini (CLI)",
  claude_cli: "Claude (CLI)",
  codex: "Codex",
};

const PROVIDERS_WITH_API_KEY = new Set<LlmProviderId>([
  "openrouter",
  "openai",
  "openai_compatible",
  "gemini",
]);

const PROVIDERS_WITH_BASE_URL = new Set<LlmProviderId>(["openai_compatible"]);

const PROVIDER_HINTS: Record<LlmProviderId, string> = {
  openrouter:
    "OpenRouter uses your API key and supports model routing across providers.",
  openai: "OpenAI uses the Responses API with structured outputs.",
  openai_compatible:
    "Use a bearer token with any chat-completions-compatible endpoint.",
  gemini: "Gemini uses the native AI Studio API and requires a key.",
  gemini_cli:
    "Gemini (CLI) runs the official Google Gemini CLI on this host using your OAuth session or CLI API key — no Forsa LLM key.",
  claude_cli:
    'Claude (CLI) runs Claude Code on this host with your Claude subscription — no API key. Add an effort with a suffix, e.g. "opus:medium".',
  codex:
    "Codex runs through a local app-server process and uses your Codex login session.",
};

const PROVIDER_KEY_HELPERS: Record<
  LlmProviderId,
  { text: string; href?: string }
> = {
  openrouter: {
    text: "Create a key at openrouter.ai",
    href: "https://openrouter.ai/keys",
  },
  openai: {
    text: "Create a key at platform.openai.com",
    href: "https://platform.openai.com/api-keys",
  },
  openai_compatible: {
    text: "Use the bearer token issued by your compatible provider",
  },
  gemini: {
    text: "Create a key at aistudio.google.com/api-keys",
    href: "https://aistudio.google.com/app/apikey",
  },
  gemini_cli: {
    text: "Authenticate with the Gemini CLI (gemini login / OAuth); see docs link below",
  },
  claude_cli: {
    text: "No API key required when Claude Code is logged in (run `claude` once)",
  },
  codex: { text: "No API key required when Codex is authenticated locally" },
};

const BASE_URL_PROVIDERS = ["openai_compatible"] as const;
type BaseUrlProviderId = (typeof BASE_URL_PROVIDERS)[number];

const PROVIDER_BASE_URLS: Record<BaseUrlProviderId, string> = {
  openai_compatible: "https://api.example.com/v1/chat/completions",
};

export function normalizeLlmProvider(
  value: string | null | undefined,
): LlmProviderId {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return "openrouter";
  if (normalized === "openai-compatible") return "openai_compatible";
  return (LLM_PROVIDERS as readonly string[]).includes(normalized)
    ? (normalized as LlmProviderId)
    : "openrouter";
}

export function supportsLlmModelSuggestions(
  provider: string | null | undefined,
): boolean {
  const normalizedProvider = normalizeLlmProvider(provider);
  return (LLM_MODEL_SUGGESTION_PROVIDERS as readonly string[]).includes(
    normalizedProvider,
  );
}

export function getLlmProviderConfig(provider: string | null | undefined) {
  const normalizedProvider = normalizeLlmProvider(provider);
  const showApiKey = PROVIDERS_WITH_API_KEY.has(normalizedProvider);
  const showBaseUrl = PROVIDERS_WITH_BASE_URL.has(normalizedProvider);
  const baseUrlPlaceholder = showBaseUrl
    ? PROVIDER_BASE_URLS[normalizedProvider as BaseUrlProviderId]
    : "";
  const baseUrlHelper = showBaseUrl
    ? normalizedProvider === "openai_compatible"
      ? "Enter a base URL or a full /v1/chat/completions endpoint."
      : `Default: ${baseUrlPlaceholder}`
    : "";
  const providerHint = PROVIDER_HINTS[normalizedProvider];
  const keyHelper = PROVIDER_KEY_HELPERS[normalizedProvider];

  return {
    normalizedProvider,
    label: LLM_PROVIDER_LABELS[normalizedProvider],
    showApiKey,
    showBaseUrl,
    requiresApiKey: showApiKey,
    baseUrlPlaceholder,
    baseUrlHelper,
    providerHint,
    keyHelperText: keyHelper.text,
    keyHelperHref: keyHelper.href ?? null,
  };
}
