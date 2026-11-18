import { spawn } from "node:child_process";
import { logger } from "@infra/logger";
import { trackAiCall } from "@server/services/ai-activity";
import {
  AiAccountNotSignedInError,
  resolveClaudeRuntime,
} from "../../ai-accounts/runtime";
import {
  getLlmMessageText,
  type JsonSchemaDefinition,
  type LlmRequestOptions,
} from "../types";
import { truncate } from "../utils/string";

const DEFAULT_REQUEST_TIMEOUT_MS = 180_000;
const DEFAULT_VALIDATION_TIMEOUT_MS = 60_000;
const MAX_STDERR_LINES = 40;

/** Claude model aliases accepted by the CLI. Boussole stores `google/...` ids for
 *  other providers, which are meaningless here — we only pass `--model` when the
 *  configured value is actually a Claude model, otherwise the CLI default is used. */
export const CLAUDE_CLI_SUGGESTED_MODELS: string[] = [
  "opus:medium",
  "opus",
  "sonnet",
  "haiku",
];

function getPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function buildClaudeCliErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("ENOENT")) {
    return "Claude CLI was not found in PATH. Install Claude Code or set CLAUDE_CLI_BIN.";
  }
  return truncate(message, 500);
}

const CLAUDE_CLI_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type ClaudeCliEffort = (typeof CLAUDE_CLI_EFFORTS)[number];

function toEffort(value: string | null | undefined): ClaudeCliEffort | null {
  const normalized = value?.trim().toLowerCase();
  return normalized &&
    (CLAUDE_CLI_EFFORTS as readonly string[]).includes(normalized)
    ? (normalized as ClaudeCliEffort)
    : null;
}

/**
 * Splits a configured model like "opus:medium" into the CLI model ("opus") and
 * reasoning effort ("medium"). Without a suffix the effort comes from
 * CLAUDE_CLI_EFFORT, else the CLI's own default is used.
 */
export function parseClaudeCliModelSpec(model: string | null): {
  model: string | null;
  effort: ClaudeCliEffort | null;
} {
  const trimmed = model?.trim() ?? "";
  const match = /^(.*?):(low|medium|high|xhigh|max)$/i.exec(trimmed);
  const base = match ? (match[1]?.trim() ?? "") : trimmed;
  return {
    model: normalizeClaudeModel(base || null),
    effort: toEffort(match?.[2]) ?? toEffort(process.env.CLAUDE_CLI_EFFORT),
  };
}

/**
 * Environment of the Claude Code session that may have launched Boussole (e.g.
 * `npm run dev` started from Claude Code). A nested `claude -p` must not
 * attach to that session, so these are dropped; auth-related variables
 * (ANTHROPIC_*, CLAUDE_CODE_OAUTH_TOKEN, …) are kept.
 */
const PARENT_SESSION_ENV_KEYS = [
  "CLAUDECODE",
  "CLAUDE_PID",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_SSE_PORT",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_MESSAGING_TOKEN",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_SESSION_ATTENDED",
];

export function buildClaudeCliEnv(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env = { ...source };
  for (const key of PARENT_SESSION_ENV_KEYS) delete env[key];
  return env;
}

function normalizeClaudeModel(model: string | null): string | null {
  const trimmed = model?.trim().toLowerCase();
  if (!trimmed) return null;
  if (trimmed.startsWith("claude")) return model?.trim() ?? null;
  if (trimmed === "sonnet" || trimmed === "opus" || trimmed === "haiku") {
    return trimmed;
  }
  // Configured model belongs to another provider (e.g. "google/..."): let the
  // CLI use its default rather than passing an invalid --model.
  return null;
}

function formatStructuredPrompt(args: {
  messages: LlmRequestOptions<unknown>["messages"];
  jsonSchema: JsonSchemaDefinition;
}): string {
  const transcript = args.messages
    .map((message, index) => {
      return `Message ${index + 1} (${message.role.toUpperCase()}):\n${getLlmMessageText(message.content).trim()}`;
    })
    .join("\n\n");

  return [
    "You are generating a structured JSON response for Boussole.",
    "Do not run commands or tools. Answer directly.",
    "Return only valid JSON with no markdown fences or extra text.",
    "The response must follow this schema exactly:",
    JSON.stringify(args.jsonSchema.schema, null, 2),
    "",
    "Transcript:",
    transcript,
  ].join("\n");
}

export type ClaudeCliSpawnFn = typeof spawn;

async function runClaudeCliOnce(args: {
  spawnFn: ClaudeCliSpawnFn;
  prompt: string;
  model: string | null;
  /** Overrides the effort parsed from the model spec (e.g. fast validation). */
  effort?: ClaudeCliEffort | null;
  timeoutMs: number;
  signal?: AbortSignal;
  /** Environment for this workspace's Claude login (see ai-accounts/runtime). */
  env: NodeJS.ProcessEnv;
}): Promise<{ stdout: string; stderr: string }> {
  const bin = process.env.CLAUDE_CLI_BIN?.trim() || "claude";
  const spec = parseClaudeCliModelSpec(args.model);
  const model = spec.model;
  const effort = args.effort ?? spec.effort;
  const procArgs: string[] = [
    "-p",
    "--output-format",
    "text",
    "--no-session-persistence",
    // Boussole only needs text generation. Deny every tool so the CLI never tries
    // to read/write files or run commands in the workspace.
    "--disallowedTools",
    "Bash Edit Write Read Glob Grep WebFetch WebSearch Task NotebookEdit",
  ];
  if (model) {
    procArgs.push("--model", model);
  }
  if (effort) {
    procArgs.push("--effort", effort);
  }

  return await new Promise((resolve, reject) => {
    const stderrLines: string[] = [];
    const stdoutChunks: Buffer[] = [];
    let settled = false;

    const child = args.spawnFn(bin, procArgs, {
      stdio: ["pipe", "pipe", "pipe"],
      env: args.env,
      windowsHide: true,
    });

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    const onAbort = () => {
      child.kill("SIGTERM");
    };
    if (args.signal) {
      if (args.signal.aborted) {
        onAbort();
      } else {
        args.signal.addEventListener("abort", onAbort, { once: true });
      }
    }

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdoutChunks.push(
        typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk,
      );
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      for (const line of text.split(/\r?\n/)) {
        const t = line.trim();
        if (!t) continue;
        stderrLines.push(t);
        if (stderrLines.length > MAX_STDERR_LINES) {
          stderrLines.shift();
        }
      }
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(() => {
        reject(new Error(`Claude CLI timed out after ${args.timeoutMs}ms.`));
      });
    }, args.timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timer);
      finish(() => {
        reject(error);
      });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      finish(() => {
        if (args.signal?.aborted) {
          reject(new Error("Claude CLI invocation was aborted."));
          return;
        }
        const stdout = Buffer.concat(stdoutChunks).toString("utf8").trim();
        const stderr = stderrLines.join(" | ");
        if (code !== 0) {
          reject(
            new Error(
              stderr ||
                stdout ||
                `Claude CLI exited with code ${code ?? "unknown"}.`,
            ),
          );
          return;
        }
        resolve({ stdout, stderr });
      });
    });

    // The prompt can be large (CV + job description). Pass it via stdin to avoid
    // argv length limits and shell-escaping issues.
    child.stdin.write(args.prompt);
    child.stdin.end();
  });
}

export type ClaudeCliClientOptions = {
  spawnFn?: ClaudeCliSpawnFn;
  /** Environment of the active workspace's Claude login; injectable for tests. */
  resolveEnv?: () => Promise<NodeJS.ProcessEnv>;
};

const resolveActiveClaudeEnv = async (): Promise<NodeJS.ProcessEnv> =>
  (await resolveClaudeRuntime()).env;

export class ClaudeCliClient {
  private readonly spawnFn: ClaudeCliSpawnFn;
  private readonly resolveEnv: () => Promise<NodeJS.ProcessEnv>;

  constructor(options: ClaudeCliClientOptions = {}) {
    this.spawnFn = options.spawnFn ?? spawn;
    this.resolveEnv = options.resolveEnv ?? resolveActiveClaudeEnv;
  }

  async validateCredentials(signal?: AbortSignal): Promise<{
    valid: boolean;
    message: string | null;
    username?: string | null;
  }> {
    const timeoutMs = getPositiveIntEnv(
      "CLAUDE_CLI_VALIDATION_TIMEOUT_MS",
      DEFAULT_VALIDATION_TIMEOUT_MS,
    );
    try {
      const env = await this.resolveEnv();
      const { stdout } = await runClaudeCliOnce({
        spawnFn: this.spawnFn,
        env,
        prompt:
          'Return only valid JSON with no markdown or explanation: {"ok":true}',
        model: null,
        // A connectivity check: keep it fast whatever the configured effort.
        effort: "low",
        timeoutMs,
        signal,
      });
      if (!stdout.includes("{") || !stdout.includes("}")) {
        return {
          valid: false,
          message:
            "Claude CLI ran but returned an unexpected response. Check that Claude Code is authenticated (run `claude` once).",
          username: null,
        };
      }
      return { valid: true, message: null, username: null };
    } catch (error) {
      if (error instanceof AiAccountNotSignedInError) {
        return { valid: false, message: error.message, username: null };
      }
      if (error instanceof Error && error.message.includes("aborted")) {
        return {
          valid: false,
          message: "Claude CLI validation was cancelled.",
          username: null,
        };
      }
      const message = buildClaudeCliErrorMessage(error);
      logger.warn("Claude CLI credential validation failed", {
        message: truncate(message, 200),
      });
      return { valid: false, message, username: null };
    }
  }

  listModels(): Promise<string[]> {
    return Promise.resolve([...CLAUDE_CLI_SUGGESTED_MODELS]);
  }

  /**
   * Free-form completion: sends `prompt` as-is and returns the CLI's text.
   * Used by the LangChain agent model, which builds its own prompt protocol.
   */
  async complete(options: {
    prompt: string;
    model: string | null;
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<{ text: string }> {
    const timeoutMs =
      options.timeoutMs ??
      getPositiveIntEnv(
        "CLAUDE_CLI_REQUEST_TIMEOUT_MS",
        DEFAULT_REQUEST_TIMEOUT_MS,
      );
    const model = options.model?.trim() || null;
    return trackAiCall(
      { name: "agent_step", provider: "claude", model, prompt: options.prompt },
      async () => {
        const { stdout } = await runClaudeCliOnce({
          spawnFn: this.spawnFn,
          env: await this.resolveEnv(),
          prompt: options.prompt,
          model,
          timeoutMs,
          signal: options.signal,
        });
        if (!stdout) {
          throw new Error("Claude CLI returned an empty response.");
        }
        return { text: stdout };
      },
    );
  }

  async callJson(
    options: LlmRequestOptions<unknown>,
  ): Promise<{ text: string }> {
    const timeoutMs = getPositiveIntEnv(
      "CLAUDE_CLI_REQUEST_TIMEOUT_MS",
      DEFAULT_REQUEST_TIMEOUT_MS,
    );
    const prompt = formatStructuredPrompt({
      messages: options.messages,
      jsonSchema: options.jsonSchema,
    });
    const model = options.model?.trim() || null;
    return trackAiCall(
      {
        name: options.jsonSchema.name,
        provider: "claude",
        model,
        prompt,
        jobId: options.jobId ?? null,
      },
      async () => {
        const { stdout } = await runClaudeCliOnce({
          spawnFn: this.spawnFn,
          env: await this.resolveEnv(),
          prompt,
          model,
          timeoutMs,
          signal: options.signal,
        });
        if (!stdout) {
          throw new Error("Claude CLI returned an empty response.");
        }
        return { text: stdout };
      },
    );
  }
}
