/**
 * Sign-in through the providers' own flows, one at a time per workspace.
 *
 * Claude: `claude auth login` prints an Anthropic URL; after signing in there,
 * the person pastes back the code Anthropic shows and the CLI finishes.
 * ChatGPT: `codex login --device-auth` prints an OpenAI URL and a one-time
 * code to enter there; the CLI finishes on its own once approved.
 *
 * The CLIs store the credentials in the workspace's private folder. Boussole
 * never sees a password or token; it only relays the URL, the device code and
 * (Claude) the pasted authorization code to the CLI's stdin.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { logger } from "@infra/logger";
import type {
  AiProvider,
  AiSignInSession,
  AiSignInState,
  ClaudeSignInMode,
} from "@shared/types";
import { ensureAiAccountDir, writeAiAccountMarker } from "./paths";
import { type CliSpawnFn, lastLines, stripAnsi } from "./process";
import {
  CODEX_FILE_STORE_OVERRIDE,
  claudeBin,
  codexCommand,
  personalClaudeEnv,
  personalCodexEnv,
} from "./runtime";
import { checkAiAccountStatus, invalidateAiAccountStatus } from "./status";

const SIGN_IN_TIMEOUT_MS = 15 * 60_000;
const START_TIMEOUT_MS = 30_000;
const KEEP_FINISHED_MS = 10 * 60_000;
const MAX_OUTPUT_CHARS = 20_000;

/** Sign-in pages may only point at the providers' own sites. */
const ALLOWED_SIGN_IN_HOSTS: Record<AiProvider, RegExp> = {
  claude: /(^|\.)(claude\.ai|claude\.com|anthropic\.com)$/i,
  chatgpt: /(^|\.)(openai\.com|chatgpt\.com)$/i,
};
const URL_PATTERN = /https:\/\/[^\s"'<>]+/g;
const DEVICE_CODE_PATTERN = /\b[A-Z0-9]{4,}-[A-Z0-9]{4,}\b/;
const PASTED_CODE_PATTERN = /^[A-Za-z0-9#_.~+/=-]{4,2048}$/;

type Session = {
  tenantId: string;
  provider: AiProvider;
  state: AiSignInState;
  verificationUrl: string | null;
  userCode: string | null;
  needsCode: boolean;
  startedAtMs: number;
  expiresAtMs: number | null;
  finishedAtMs: number | null;
  message: string | null;
  child: ChildProcess | null;
  output: string;
  timers: NodeJS.Timeout[];
};

/** One sign-in per workspace, keyed by tenant id. */
const sessions = new Map<string, Session>();

export class AiSignInError extends Error {
  readonly status: 400 | 409;

  constructor(message: string, status: 400 | 409 = 409) {
    super(message);
    this.name = "AiSignInError";
    this.status = status;
  }
}

function toSnapshot(session: Session): AiSignInSession {
  return {
    provider: session.provider,
    state: session.state,
    verificationUrl: session.verificationUrl,
    userCode: session.userCode,
    needsCode: session.needsCode && session.state === "waiting_for_code",
    startedAt: new Date(session.startedAtMs).toISOString(),
    expiresAt: session.expiresAtMs
      ? new Date(session.expiresAtMs).toISOString()
      : null,
    message: session.message,
  };
}

function isActive(session: Session): boolean {
  return (
    session.state === "starting" ||
    session.state === "waiting_for_code" ||
    session.state === "waiting_for_approval" ||
    session.state === "completing"
  );
}

function stopSession(session: Session): void {
  for (const timer of session.timers) clearTimeout(timer);
  session.timers = [];
  if (session.child && session.child.exitCode === null) {
    session.child.kill("SIGTERM");
  }
  session.child = null;
}

function finish(
  session: Session,
  state: "completed" | "failed" | "cancelled",
  message: string,
): void {
  session.state = state;
  session.message = message;
  session.finishedAtMs = Date.now();
  stopSession(session);
  logger.info("AI sign-in finished", {
    tenantId: session.tenantId,
    provider: session.provider,
    state,
  });
}

function firstAllowedUrl(text: string, provider: AiProvider): string | null {
  for (const match of text.matchAll(URL_PATTERN)) {
    const candidate = match[0].replace(/[).,;]+$/, "");
    try {
      const url = new URL(candidate);
      if (ALLOWED_SIGN_IN_HOSTS[provider].test(url.hostname)) {
        return url.toString();
      }
    } catch {
      // not a URL
    }
  }
  return null;
}

function friendlyFailure(provider: AiProvider, detail: string): string {
  if (/enable device code/i.test(detail)) {
    return "Device sign-in is turned off for this ChatGPT account. Turn on device code sign-in in ChatGPT → Settings → Security, then try again.";
  }
  if (/ENOENT|not found|not installed/i.test(detail)) {
    return provider === "claude"
      ? "Claude Code is not installed on this server."
      : "ChatGPT (Codex) is not installed on this server.";
  }
  if (/invalid code|invalid_grant|expired/i.test(detail)) {
    return "That code was not accepted or has expired. Start the sign-in again.";
  }
  return "The sign-in did not finish. Start it again.";
}

function absorbOutput(session: Session, chunk: Buffer | string): void {
  const text = stripAnsi(
    typeof chunk === "string" ? chunk : chunk.toString("utf8"),
  );
  session.output = (session.output + text).slice(-MAX_OUTPUT_CHARS);
  if (!session.verificationUrl) {
    session.verificationUrl = firstAllowedUrl(session.output, session.provider);
  }
  if (session.provider === "chatgpt" && !session.userCode) {
    session.userCode = session.output.match(DEVICE_CODE_PATTERN)?.[0] ?? null;
  }
  if (session.state !== "starting") return;
  if (session.provider === "claude" && session.verificationUrl) {
    session.state = "waiting_for_code";
    session.needsCode = true;
    session.message =
      "Open the sign-in page, sign in with your Claude account, then paste the code it shows.";
  } else if (
    session.provider === "chatgpt" &&
    session.verificationUrl &&
    session.userCode
  ) {
    session.state = "waiting_for_approval";
    session.message =
      "Open the sign-in page, sign in with your ChatGPT account and enter the code.";
  }
}

async function completeSession(session: Session): Promise<void> {
  session.state = "completing";
  session.message = "Checking the sign-in…";
  const status = await checkAiAccountStatus(
    session.tenantId,
    session.provider,
    {
      personal: true,
    },
  ).catch(() => null);
  if (session.state !== "completing") return; // cancelled meanwhile
  if (!status?.signedIn) {
    finish(session, "failed", "The sign-in did not finish. Start it again.");
    return;
  }
  await writeAiAccountMarker(session.tenantId, {
    provider: session.provider,
    signedInAt: new Date().toISOString(),
    accountLabel: status.accountLabel,
    planLabel: status.planLabel,
  });
  invalidateAiAccountStatus(session.tenantId, session.provider);
  finish(session, "completed", "Signed in.");
}

export async function startAiSignIn(
  tenantId: string,
  provider: AiProvider,
  options: { claudeMode?: ClaudeSignInMode; spawnFn?: CliSpawnFn } = {},
): Promise<AiSignInSession> {
  const previous = sessions.get(tenantId);
  if (previous && isActive(previous)) {
    finish(previous, "cancelled", "Replaced by a new sign-in.");
  }

  const dir = await ensureAiAccountDir(tenantId, provider);
  const now = Date.now();
  const session: Session = {
    tenantId,
    provider,
    state: "starting",
    verificationUrl: null,
    userCode: null,
    needsCode: false,
    startedAtMs: now,
    expiresAtMs: now + SIGN_IN_TIMEOUT_MS,
    finishedAtMs: null,
    message: "Starting the sign-in…",
    child: null,
    output: "",
    timers: [],
  };
  sessions.set(tenantId, session);

  let command: string;
  let args: string[];
  let env: NodeJS.ProcessEnv;
  if (provider === "claude") {
    command = claudeBin();
    args = [
      "auth",
      "login",
      options.claudeMode === "console" ? "--console" : "--claudeai",
    ];
    env = personalClaudeEnv(dir);
  } else {
    const codex = codexCommand();
    command = codex.command;
    args = [
      ...codex.prefixArgs,
      "login",
      "--device-auth",
      "-c",
      CODEX_FILE_STORE_OVERRIDE,
    ];
    env = personalCodexEnv(dir);
  }

  const spawnFn = options.spawnFn ?? spawn;
  let child: ChildProcess;
  try {
    child = spawnFn(command, args, {
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
  } catch (error) {
    finish(session, "failed", friendlyFailure(provider, String(error)));
    return toSnapshot(session);
  }
  session.child = child;
  logger.info("AI sign-in started", { tenantId, provider });

  child.stdout?.on("data", (chunk) => absorbOutput(session, chunk));
  child.stderr?.on("data", (chunk) => absorbOutput(session, chunk));
  child.on("error", (error) => {
    if (!isActive(session)) return;
    finish(session, "failed", friendlyFailure(provider, error.message));
  });
  child.on("close", (code) => {
    if (!isActive(session)) return;
    session.child = null;
    if (code === 0) {
      void completeSession(session);
      return;
    }
    finish(
      session,
      "failed",
      friendlyFailure(provider, lastLines(session.output)),
    );
  });

  session.timers.push(
    setTimeout(() => {
      if (session.state === "starting") {
        finish(
          session,
          "failed",
          "The sign-in page did not open in time. Try again.",
        );
      }
    }, START_TIMEOUT_MS),
    setTimeout(() => {
      if (isActive(session)) {
        finish(session, "failed", "The sign-in timed out. Start it again.");
      }
    }, SIGN_IN_TIMEOUT_MS),
  );
  for (const timer of session.timers) timer.unref();

  // Give the CLI a moment to print the sign-in page before answering.
  await new Promise<void>((resolve) => {
    const started = Date.now();
    const poll = () => {
      if (session.state !== "starting" || Date.now() - started > 5_000) {
        resolve();
        return;
      }
      setTimeout(poll, 100).unref();
    };
    poll();
  });
  return toSnapshot(session);
}

export function submitAiSignInCode(
  tenantId: string,
  rawCode: string,
): AiSignInSession {
  const session = sessions.get(tenantId);
  if (!session || session.state !== "waiting_for_code" || !session.child) {
    throw new AiSignInError("There is no Claude sign-in waiting for a code.");
  }
  const code = rawCode.trim();
  if (!PASTED_CODE_PATTERN.test(code)) {
    throw new AiSignInError(
      "That does not look like the code from the sign-in page. Copy it again.",
      400,
    );
  }
  session.state = "completing";
  session.message = "Checking the code…";
  session.child.stdin?.write(`${code}\n`);
  return toSnapshot(session);
}

export function cancelAiSignIn(tenantId: string): AiSignInSession | null {
  const session = sessions.get(tenantId);
  if (!session) return null;
  if (isActive(session)) finish(session, "cancelled", "Sign-in cancelled.");
  return toSnapshot(session);
}

export function getAiSignInSnapshot(tenantId: string): AiSignInSession | null {
  const session = sessions.get(tenantId);
  if (!session) return null;
  if (
    session.finishedAtMs &&
    Date.now() - session.finishedAtMs > KEEP_FINISHED_MS
  ) {
    sessions.delete(tenantId);
    return null;
  }
  return toSnapshot(session);
}

export function __resetAiSignInsForTests(): void {
  for (const session of sessions.values()) stopSession(session);
  sessions.clear();
}
