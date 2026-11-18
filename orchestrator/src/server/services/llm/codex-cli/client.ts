/**
 * ChatGPT through the official Codex CLI (`codex exec`), signed in with the
 * workspace's own ChatGPT account. Each call runs read-only in an empty
 * temporary folder with no saved session; Boussole only needs text back.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logger } from "@infra/logger";
import { trackAiCall } from "@server/services/ai-activity";
import { parseAiModelChoice } from "@shared/types";
import { type CliSpawnFn, lastLines, runCli } from "../../ai-accounts/process";
import {
  AiAccountNotSignedInError,
  CODEX_FILE_STORE_OVERRIDE,
  codexCommand,
  resolveCodexRuntime,
} from "../../ai-accounts/runtime";
import {
  getLlmMessageText,
  type JsonSchemaDefinition,
  type LlmRequestOptions,
  type LlmValidationResult,
} from "../types";
import { truncate } from "../utils/string";

const DEFAULT_REQUEST_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_VALIDATION_TIMEOUT_MS = 90_000;
const MODEL_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;
const EFFORT_PATTERN = /^[a-z]{1,20}$/;
const SIGN_IN_PATTERN =
  /not logged in|login required|please (?:re-?)?log ?in|unauthorized|401|refresh token|token (?:has )?expired|sign in again/i;

function positiveIntEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** "<slug>[:<effort>]" with anything unexpected dropped (falls back to defaults). */
export function parseCodexModelSpec(value: string | null | undefined): {
  model: string | null;
  effort: string | null;
} {
  const { model, effort } = parseAiModelChoice(value);
  return {
    model: model && MODEL_PATTERN.test(model) ? model : null,
    effort: effort && EFFORT_PATTERN.test(effort) ? effort : null,
  };
}

export function formatCodexStructuredPrompt(args: {
  messages: LlmRequestOptions<unknown>["messages"];
  jsonSchema: JsonSchemaDefinition;
}): string {
  const transcript = args.messages
    .map(
      (message, index) =>
        `Message ${index + 1} (${message.role.toUpperCase()}):\n${getLlmMessageText(message.content).trim()}`,
    )
    .join("\n\n");
  return [
    "You are generating a structured JSON response for Boussole, a job-search app.",
    "Do not run commands, read files or browse. Answer directly from the transcript.",
    "Return only valid JSON with no markdown fences or extra text.",
    "The response must follow this schema exactly:",
    JSON.stringify(args.jsonSchema.schema, null, 2),
    "",
    "Transcript:",
    transcript,
  ].join("\n");
}

export type CodexCliClientOptions = {
  spawnFn?: CliSpawnFn;
  /** Workspace's Codex environment; injectable for tests. */
  resolveRuntime?: () => Promise<{ env: NodeJS.ProcessEnv }>;
};

export class CodexCliClient {
  private readonly spawnFn?: CliSpawnFn;
  private readonly resolveRuntime: () => Promise<{ env: NodeJS.ProcessEnv }>;

  constructor(options: CodexCliClientOptions = {}) {
    this.spawnFn = options.spawnFn;
    this.resolveRuntime =
      options.resolveRuntime ?? (() => resolveCodexRuntime());
  }

  private async exec(args: {
    prompt: string;
    model: string | null;
    timeoutMs: number;
    signal?: AbortSignal;
  }): Promise<string> {
    const { env } = await this.resolveRuntime();
    const { model, effort } = parseCodexModelSpec(args.model);
    const workDir = await mkdtemp(join(tmpdir(), "boussole-codex-"));
    const answerFile = join(workDir, "answer.txt");
    const { command, prefixArgs } = codexCommand();
    const procArgs = [
      ...prefixArgs,
      "exec",
      "--skip-git-repo-check",
      "--ephemeral",
      "--sandbox",
      "read-only",
      "--color",
      "never",
      "-C",
      workDir,
      "-o",
      answerFile,
      "-c",
      CODEX_FILE_STORE_OVERRIDE,
    ];
    if (model) procArgs.push("-m", model);
    if (effort) procArgs.push("-c", `model_reasoning_effort="${effort}"`);
    procArgs.push("-");

    try {
      const result = await runCli(command, procArgs, {
        env,
        cwd: workDir,
        input: args.prompt,
        timeoutMs: args.timeoutMs,
        signal: args.signal,
        spawnFn: this.spawnFn,
      }).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          message.includes("ENOENT")
            ? "ChatGPT (Codex) is not installed on this server."
            : truncate(message, 300),
        );
      });
      if (args.signal?.aborted) throw new Error("Request aborted");
      if (result.timedOut) {
        throw new Error(
          `ChatGPT did not answer within ${Math.round(args.timeoutMs / 1000)} seconds (timeout).`,
        );
      }
      const answer = (
        await readFile(answerFile, "utf8").catch(() => "")
      ).trim();
      if (result.code !== 0 || !answer) {
        const detail = lastLines(`${result.stderr}\n${result.stdout}`, 3);
        if (SIGN_IN_PATTERN.test(detail)) {
          throw new Error(
            "Your ChatGPT account is not signed in or its sign-in expired. Sign in again under Settings → AI account.",
          );
        }
        throw new Error(
          `ChatGPT (Codex CLI) failed${result.code === null ? "" : ` with exit code ${result.code}`}: ${truncate(detail || "no output", 300)}`,
        );
      }
      return answer;
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
  }

  async complete(options: {
    prompt: string;
    model: string | null;
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<{ text: string }> {
    return trackAiCall(
      {
        name: "agent_step",
        provider: "codex",
        model: options.model,
        prompt: options.prompt,
      },
      async () => ({ text: await this.completeText(options) }),
    );
  }

  private async completeText(options: {
    prompt: string;
    model: string | null;
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<string> {
    const text = await this.exec({
      prompt: options.prompt,
      model: options.model,
      timeoutMs:
        options.timeoutMs ??
        positiveIntEnv(
          "CODEX_CLI_REQUEST_TIMEOUT_MS",
          DEFAULT_REQUEST_TIMEOUT_MS,
        ),
      signal: options.signal,
    });
    return text;
  }

  async callJson(
    options: LlmRequestOptions<unknown>,
  ): Promise<{ text: string }> {
    const prompt = formatCodexStructuredPrompt({
      messages: options.messages,
      jsonSchema: options.jsonSchema,
    });
    const model = options.model ?? null;
    return trackAiCall(
      {
        name: options.jsonSchema.name,
        provider: "codex",
        model,
        prompt,
        jobId: options.jobId ?? null,
      },
      async () => ({
        text: await this.exec({
          prompt,
          model,
          timeoutMs: positiveIntEnv(
            "CODEX_CLI_REQUEST_TIMEOUT_MS",
            DEFAULT_REQUEST_TIMEOUT_MS,
          ),
          signal: options.signal,
        }),
      }),
    );
  }

  async validateCredentials(
    signal?: AbortSignal,
  ): Promise<LlmValidationResult> {
    try {
      const { text } = await this.complete({
        prompt: 'Return only this JSON and nothing else: {"ok":true}',
        model: null,
        timeoutMs: positiveIntEnv(
          "CODEX_CLI_VALIDATION_TIMEOUT_MS",
          DEFAULT_VALIDATION_TIMEOUT_MS,
        ),
        signal,
      });
      if (!text.includes("{")) {
        return {
          valid: false,
          message: "ChatGPT answered, but not with the expected JSON.",
        };
      }
      return { valid: true, message: null };
    } catch (error) {
      if (error instanceof AiAccountNotSignedInError) {
        return { valid: false, message: error.message };
      }
      const message = error instanceof Error ? error.message : String(error);
      logger.warn("ChatGPT credential validation failed", {
        message: truncate(message, 200),
      });
      return { valid: false, message };
    }
  }
}
