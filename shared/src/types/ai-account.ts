/**
 * Per-person AI accounts. Every workspace signs in with its own Claude or
 * ChatGPT account through the provider's own sign-in page; Boussole runs the
 * official CLI with that person's credentials and the model they picked.
 */

export const AI_PROVIDERS = ["claude", "chatgpt"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export const AI_PROVIDER_LABELS: Record<AiProvider, string> = {
  claude: "Claude",
  chatgpt: "ChatGPT",
};

/** Claude sign-in offers the two account kinds Claude Code supports. */
export const CLAUDE_SIGN_IN_MODES = ["subscription", "console"] as const;
export type ClaudeSignInMode = (typeof CLAUDE_SIGN_IN_MODES)[number];

export type AiAccountStatus = {
  provider: AiProvider;
  /** The CLI for this provider is installed on the server. */
  available: boolean;
  signedIn: boolean;
  /** Email or account name reported by the CLI, when it tells us. */
  accountLabel: string | null;
  /** Plan or auth method, e.g. "Claude Max", "ChatGPT", "API key". */
  planLabel: string | null;
  /** Owner workspace using the server's own Claude login (no per-person sign-in). */
  usesServerLogin: boolean;
  message: string | null;
};

export type AiSignInState =
  | "starting"
  | "waiting_for_code"
  | "waiting_for_approval"
  | "completing"
  | "completed"
  | "failed"
  | "cancelled";

export type AiSignInSession = {
  provider: AiProvider;
  state: AiSignInState;
  /** Page on the provider's site where the person signs in. */
  verificationUrl: string | null;
  /** ChatGPT: one-time code to type on OpenAI's page. */
  userCode: string | null;
  /** Claude: the person pastes back the code Anthropic shows after sign-in. */
  needsCode: boolean;
  startedAt: string;
  expiresAt: string | null;
  message: string | null;
};

export type AiModelEffort = {
  id: string;
  description: string | null;
};

export type AiModelOption = {
  /** Value sent to the CLI, e.g. "opus" or "gpt-6.1-sol". */
  id: string;
  label: string;
  description: string | null;
  efforts: AiModelEffort[];
  defaultEffort: string | null;
};

export type AiAccountOverview = {
  activeProvider: AiProvider;
  accounts: Record<AiProvider, AiAccountStatus>;
  models: Record<AiProvider, AiModelOption[]>;
  /** Saved choice per provider, "<model>" or "<model>:<effort>"; "" = provider default. */
  selectedModels: Record<AiProvider, string>;
  signIn: AiSignInSession | null;
};

/** Splits "<model>:<effort>" (effort optional). */
export function parseAiModelChoice(value: string | null | undefined): {
  model: string | null;
  effort: string | null;
} {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return { model: null, effort: null };
  const index = trimmed.lastIndexOf(":");
  if (index <= 0) return { model: trimmed, effort: null };
  return {
    model: trimmed.slice(0, index).trim() || null,
    effort: trimmed.slice(index + 1).trim() || null,
  };
}

export function formatAiModelChoice(
  model: string | null | undefined,
  effort: string | null | undefined,
): string {
  const m = (model ?? "").trim();
  if (!m) return "";
  const e = (effort ?? "").trim();
  return e ? `${m}:${e}` : m;
}
