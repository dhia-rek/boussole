/**
 * How to launch each provider's CLI for the active workspace: which binary,
 * which credentials folder, and an environment stripped of the server's own
 * tokens so one person's calls can never run on someone else's account.
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { getActiveTenantId } from "@server/tenancy/context";
import { AI_PROVIDER_LABELS, type AiProvider } from "@shared/types";
import { buildClaudeCliEnv } from "../llm/claude-cli/client";
import { aiAccountDir, isOwnerWorkspace, readAiAccountMarker } from "./paths";

/** Server-wide credentials that must never reach a personal sign-in. */
const CLAUDE_SERVER_CREDENTIAL_KEYS = [
  "CLAUDE_CODE_OAUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CONFIG_DIR",
];
const OPENAI_SERVER_CREDENTIAL_KEYS = [
  "OPENAI_API_KEY",
  "CODEX_API_KEY",
  "CODEX_ACCESS_TOKEN",
  "CODEX_HOME",
];

/** Forces Codex to keep credentials in auth.json inside CODEX_HOME. */
export const CODEX_FILE_STORE_OVERRIDE = 'cli_auth_credentials_store="file"';

export class AiAccountNotSignedInError extends Error {
  readonly provider: AiProvider;

  constructor(provider: AiProvider) {
    super(
      `${AI_PROVIDER_LABELS[provider]} is not signed in for this workspace. Sign in under Settings → AI account.`,
    );
    this.name = "AiAccountNotSignedInError";
    this.provider = provider;
  }
}

export function claudeBin(): string {
  return process.env.CLAUDE_CLI_BIN?.trim() || "claude";
}

/** Codex ships as an npm dependency; CODEX_CLI_BIN overrides it. */
export function codexCommand(): { command: string; prefixArgs: string[] } {
  const configured = process.env.CODEX_CLI_BIN?.trim();
  if (configured) return { command: configured, prefixArgs: [] };
  try {
    const require = createRequire(import.meta.url);
    const script = require.resolve("@openai/codex/bin/codex.js");
    if (existsSync(script)) {
      return { command: process.execPath, prefixArgs: [script] };
    }
  } catch {
    // Not installed as a dependency: fall back to PATH.
  }
  return { command: "codex", prefixArgs: [] };
}

export function personalClaudeEnv(
  configDir: string,
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env = buildClaudeCliEnv(source);
  for (const key of CLAUDE_SERVER_CREDENTIAL_KEYS) delete env[key];
  env.CLAUDE_CONFIG_DIR = configDir;
  return env;
}

export function personalCodexEnv(
  codexHome: string,
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env = { ...source };
  for (const key of OPENAI_SERVER_CREDENTIAL_KEYS) delete env[key];
  env.CODEX_HOME = codexHome;
  return env;
}

export type ClaudeRuntime =
  | { mode: "personal"; configDir: string; env: NodeJS.ProcessEnv }
  | { mode: "server"; env: NodeJS.ProcessEnv };

/**
 * Claude credentials for the active workspace: its own sign-in when there is
 * one, else (owner workspace only) the server's login.
 */
export async function resolveClaudeRuntime(
  tenantId: string = getActiveTenantId(),
): Promise<ClaudeRuntime> {
  if (await readAiAccountMarker(tenantId, "claude")) {
    const configDir = aiAccountDir(tenantId, "claude");
    return { mode: "personal", configDir, env: personalClaudeEnv(configDir) };
  }
  if (isOwnerWorkspace(tenantId)) {
    return { mode: "server", env: buildClaudeCliEnv() };
  }
  throw new AiAccountNotSignedInError("claude");
}

/** ChatGPT always needs the workspace's own sign-in. */
export async function resolveCodexRuntime(
  tenantId: string = getActiveTenantId(),
): Promise<{ codexHome: string; env: NodeJS.ProcessEnv }> {
  if (!(await readAiAccountMarker(tenantId, "chatgpt"))) {
    throw new AiAccountNotSignedInError("chatgpt");
  }
  const codexHome = aiAccountDir(tenantId, "chatgpt");
  return { codexHome, env: personalCodexEnv(codexHome) };
}

/**
 * Throws AiAccountNotSignedInError when the workspace cannot run AI work on
 * `provider`, without starting the CLI. Lets long background runs refuse up
 * front instead of failing a minute later.
 */
export async function assertAiAccountReady(
  provider: AiProvider,
  tenantId: string = getActiveTenantId(),
): Promise<void> {
  if (provider === "chatgpt") await resolveCodexRuntime(tenantId);
  else await resolveClaudeRuntime(tenantId);
}
