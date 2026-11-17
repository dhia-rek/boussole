/**
 * Whether a workspace's AI accounts are signed in, as reported by the CLIs
 * themselves (`claude auth status --json`, `codex login status`).
 */
import type { AiAccountStatus, AiProvider } from "@shared/types";
import { buildClaudeCliEnv } from "../llm/claude-cli/client";
import {
  aiAccountDir,
  isOwnerWorkspace,
  readAiAccountMarker,
  removeAiAccount,
} from "./paths";
import { type CliSpawnFn, runCli, stripAnsi } from "./process";
import {
  CODEX_FILE_STORE_OVERRIDE,
  claudeBin,
  codexCommand,
  personalClaudeEnv,
  personalCodexEnv,
} from "./runtime";

const STATUS_TIMEOUT_MS = 20_000;
const STATUS_TTL_MS = 30_000;
const AVAILABILITY_TTL_MS = 10 * 60_000;

/** Cached per workspace and provider. */
const statusCache = new Map<string, { at: number; value: AiAccountStatus }>();
/** Server-level fact: is the CLI installed at all. */
const availabilityCache = new Map<AiProvider, { at: number; value: boolean }>();

let spawnOverride: CliSpawnFn | undefined;
export function __setAiStatusSpawnForTests(fn: CliSpawnFn | undefined): void {
  spawnOverride = fn;
  statusCache.clear();
  availabilityCache.clear();
}

function cacheKey(tenantId: string, provider: AiProvider): string {
  return `${tenantId}:${provider}`;
}

export function invalidateAiAccountStatus(
  tenantId: string,
  provider?: AiProvider,
): void {
  for (const p of provider ? [provider] : (["claude", "chatgpt"] as const)) {
    statusCache.delete(cacheKey(tenantId, p));
  }
}

function isMissingBinary(error: unknown): boolean {
  return error instanceof Error && /ENOENT/.test(error.message);
}

async function isCliAvailable(provider: AiProvider): Promise<boolean> {
  const cached = availabilityCache.get(provider);
  if (cached && Date.now() - cached.at < AVAILABILITY_TTL_MS)
    return cached.value;
  let available = false;
  try {
    const { command, prefixArgs } =
      provider === "claude"
        ? { command: claudeBin(), prefixArgs: [] as string[] }
        : codexCommand();
    const result = await runCli(command, [...prefixArgs, "--version"], {
      env: process.env,
      timeoutMs: STATUS_TIMEOUT_MS,
      spawnFn: spawnOverride,
    });
    available = result.code === 0;
  } catch {
    available = false;
  }
  availabilityCache.set(provider, { at: Date.now(), value: available });
  return available;
}

function titleCase(value: string): string {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(" ");
}

function signedOut(
  provider: AiProvider,
  available: boolean,
  message: string | null = null,
): AiAccountStatus {
  return {
    provider,
    available,
    signedIn: false,
    accountLabel: null,
    planLabel: null,
    usesServerLogin: false,
    message,
  };
}

async function checkClaude(
  tenantId: string,
  personal: boolean,
): Promise<AiAccountStatus> {
  const env = personal
    ? personalClaudeEnv(aiAccountDir(tenantId, "claude"))
    : buildClaudeCliEnv();
  let stdout = "";
  try {
    const result = await runCli(claudeBin(), ["auth", "status", "--json"], {
      env,
      timeoutMs: STATUS_TIMEOUT_MS,
      spawnFn: spawnOverride,
    });
    stdout = result.stdout;
  } catch (error) {
    if (isMissingBinary(error)) {
      return signedOut(
        "claude",
        false,
        "Claude Code is not installed on this server.",
      );
    }
    return signedOut("claude", true, "Could not check the Claude sign-in.");
  }
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(stdout) as Record<string, unknown>;
  } catch {
    return signedOut(
      "claude",
      true,
      "Could not read the Claude sign-in status.",
    );
  }
  const loggedIn = parsed.loggedIn === true;
  const authMethod = String(parsed.authMethod ?? "");
  const subscription =
    typeof parsed.subscriptionType === "string" ? parsed.subscriptionType : "";
  return {
    provider: "claude",
    available: true,
    signedIn: loggedIn,
    accountLabel:
      typeof parsed.email === "string"
        ? parsed.email
        : typeof parsed.orgName === "string"
          ? parsed.orgName
          : null,
    planLabel: !loggedIn
      ? null
      : authMethod === "claude.ai"
        ? `Claude ${titleCase(subscription) || "subscription"}`.trim()
        : "Anthropic Console (API billing)",
    usesServerLogin: !personal,
    message: loggedIn
      ? null
      : personal
        ? "Your Claude sign-in has expired. Sign in again."
        : null,
  };
}

async function checkChatgpt(tenantId: string): Promise<AiAccountStatus> {
  const { command, prefixArgs } = codexCommand();
  let text = "";
  try {
    const result = await runCli(
      command,
      [...prefixArgs, "login", "status", "-c", CODEX_FILE_STORE_OVERRIDE],
      {
        env: personalCodexEnv(aiAccountDir(tenantId, "chatgpt")),
        timeoutMs: STATUS_TIMEOUT_MS,
        spawnFn: spawnOverride,
      },
    );
    text = stripAnsi(`${result.stdout}\n${result.stderr}`);
  } catch (error) {
    if (isMissingBinary(error)) {
      return signedOut(
        "chatgpt",
        false,
        "ChatGPT (Codex) is not installed on this server.",
      );
    }
    return signedOut("chatgpt", true, "Could not check the ChatGPT sign-in.");
  }
  const loggedIn = /logged in/i.test(text) && !/not logged in/i.test(text);
  return {
    provider: "chatgpt",
    available: true,
    signedIn: loggedIn,
    accountLabel: null,
    planLabel: !loggedIn
      ? null
      : /api key/i.test(text)
        ? "OpenAI API key"
        : "ChatGPT plan",
    usesServerLogin: false,
    message: loggedIn
      ? null
      : "Your ChatGPT sign-in has expired. Sign in again.",
  };
}

/**
 * Asks the CLI directly. `personal` checks the workspace's own folder even
 * without a marker (used while a sign-in completes).
 */
export async function checkAiAccountStatus(
  tenantId: string,
  provider: AiProvider,
  options: { personal?: boolean } = {},
): Promise<AiAccountStatus> {
  const marker = await readAiAccountMarker(tenantId, provider);
  const personal = options.personal === true || marker !== null;
  if (provider === "claude") {
    if (!personal && !isOwnerWorkspace(tenantId)) {
      return signedOut("claude", await isCliAvailable("claude"));
    }
    const status = await checkClaude(tenantId, personal);
    return {
      ...status,
      accountLabel: status.accountLabel ?? marker?.accountLabel ?? null,
    };
  }
  if (!personal) return signedOut("chatgpt", await isCliAvailable("chatgpt"));
  const status = await checkChatgpt(tenantId);
  return {
    ...status,
    accountLabel: status.accountLabel ?? marker?.accountLabel ?? null,
  };
}

/** Cached status for the settings screen (30 s), `fresh` to re-check. */
export async function getAiAccountStatus(
  tenantId: string,
  provider: AiProvider,
  options: { fresh?: boolean } = {},
): Promise<AiAccountStatus> {
  const key = cacheKey(tenantId, provider);
  const cached = statusCache.get(key);
  if (!options.fresh && cached && Date.now() - cached.at < STATUS_TTL_MS) {
    return cached.value;
  }
  const value = await checkAiAccountStatus(tenantId, provider);
  statusCache.set(key, { at: Date.now(), value });
  return value;
}

/** Logs the CLI out (best effort) and deletes the workspace's stored login. */
export async function signOutAiAccount(
  tenantId: string,
  provider: AiProvider,
): Promise<void> {
  if (await readAiAccountMarker(tenantId, provider)) {
    const dir = aiAccountDir(tenantId, provider);
    const run =
      provider === "claude"
        ? {
            command: claudeBin(),
            args: ["auth", "logout"],
            env: personalClaudeEnv(dir),
          }
        : (() => {
            const { command, prefixArgs } = codexCommand();
            return {
              command,
              args: [...prefixArgs, "logout", "-c", CODEX_FILE_STORE_OVERRIDE],
              env: personalCodexEnv(dir),
            };
          })();
    await runCli(run.command, run.args, {
      env: run.env,
      timeoutMs: STATUS_TIMEOUT_MS,
      spawnFn: spawnOverride,
    }).catch(() => undefined);
  }
  await removeAiAccount(tenantId, provider);
  invalidateAiAccountStatus(tenantId, provider);
}
