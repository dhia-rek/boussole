/**
 * Web research on the workspace's own AI account. Unlike every other AI call
 * in Boussole, this one may use the web, and only the web:
 *
 * - Claude: `claude -p --restricted --tools WebSearch,WebFetch` with
 *   `--json-schema` structured output.
 * - ChatGPT: `codex --search exec --sandbox read-only --output-schema`.
 *
 * Both run in an empty temporary folder with no saved session.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { trackAiCall } from "@server/services/ai-activity";
import type { AiProvider } from "@shared/types";
import { type CliSpawnFn, lastLines, runCli } from "../ai-accounts/process";
import {
  CODEX_FILE_STORE_OVERRIDE,
  claudeBin,
  codexCommand,
  resolveClaudeRuntime,
  resolveCodexRuntime,
} from "../ai-accounts/runtime";
import { parseClaudeCliModelSpec } from "../llm/claude-cli/client";
import { parseCodexModelSpec } from "../llm/codex-cli/client";
import { truncate } from "../llm/utils/string";

const DEFAULT_TIMEOUT_MS = 8 * 60_000;
const WEB_TOOLS = "WebSearch,WebFetch";

export function researchTimeoutMs(): number {
  const parsed = Number.parseInt(
    process.env.COMPANY_RESEARCH_TIMEOUT_MS ?? "",
    10,
  );
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

export type WebResearchRequest = {
  provider: AiProvider;
  model: string | null;
  prompt: string;
  jsonSchema: object;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type WebResearchDeps = {
  spawnFn?: CliSpawnFn;
  claudeEnv?: () => Promise<NodeJS.ProcessEnv>;
  codexEnv?: () => Promise<NodeJS.ProcessEnv>;
};

export function buildClaudeResearchArgs(
  model: string | null,
  jsonSchema: object,
): string[] {
  const spec = parseClaudeCliModelSpec(model);
  const args = [
    "-p",
    "--restricted",
    "--tools",
    WEB_TOOLS,
    "--allowedTools",
    WEB_TOOLS,
    "--output-format",
    "json",
    "--json-schema",
    JSON.stringify(jsonSchema),
    "--no-session-persistence",
  ];
  if (spec.model) args.push("--model", spec.model);
  if (spec.effort) args.push("--effort", spec.effort);
  return args;
}

export function buildCodexResearchArgs(input: {
  prefixArgs: string[];
  model: string | null;
  workDir: string;
  answerFile: string;
  schemaFile: string;
}): string[] {
  const { model, effort } = parseCodexModelSpec(input.model);
  const args = [
    ...input.prefixArgs,
    "--search",
    "exec",
    "--skip-git-repo-check",
    "--ephemeral",
    "--sandbox",
    "read-only",
    "--color",
    "never",
    "-C",
    input.workDir,
    "-o",
    input.answerFile,
    "--output-schema",
    input.schemaFile,
    "-c",
    CODEX_FILE_STORE_OVERRIDE,
  ];
  if (model) args.push("-m", model);
  if (effort) args.push("-c", `model_reasoning_effort="${effort}"`);
  args.push("-");
  return args;
}

function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error("The research answer was not valid JSON.");
  }
}

/** Reads `claude -p --output-format json` output: the structured answer. */
export function parseClaudeResearchOutput(stdout: string): unknown {
  const envelope = parseJsonObject(stdout) as Record<string, unknown>;
  if (envelope.is_error === true) {
    const message =
      typeof envelope.result === "string" ? envelope.result : "unknown error";
    throw new Error(
      `Claude could not finish the research: ${truncate(message, 300)}`,
    );
  }
  if (
    envelope.structured_output &&
    typeof envelope.structured_output === "object"
  ) {
    return envelope.structured_output;
  }
  if (typeof envelope.result === "string") {
    return parseJsonObject(envelope.result);
  }
  throw new Error("Claude finished the research without returning a brief.");
}

function timeoutMessage(timeoutMs: number): string {
  return `The research did not finish within ${Math.round(timeoutMs / 60_000)} minutes. Try again, or pick a faster model in Settings → AI account.`;
}

async function runClaudeResearch(
  request: WebResearchRequest,
  deps: WebResearchDeps,
  timeoutMs: number,
): Promise<unknown> {
  const env = await (
    deps.claudeEnv ?? (async () => (await resolveClaudeRuntime()).env)
  )();
  const workDir = await mkdtemp(join(tmpdir(), "boussole-research-"));
  try {
    const result = await runCli(
      claudeBin(),
      buildClaudeResearchArgs(request.model, request.jsonSchema),
      {
        env,
        cwd: workDir,
        input: request.prompt,
        timeoutMs,
        signal: request.signal,
        spawnFn: deps.spawnFn,
      },
    ).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        message.includes("ENOENT")
          ? "Claude Code is not installed on this server."
          : truncate(message, 300),
      );
    });
    if (result.timedOut) throw new Error(timeoutMessage(timeoutMs));
    if (result.code !== 0 && !result.stdout.trim()) {
      throw new Error(
        `Claude research failed: ${truncate(lastLines(result.stderr, 3) || "no output", 300)}`,
      );
    }
    return parseClaudeResearchOutput(result.stdout);
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function runCodexResearch(
  request: WebResearchRequest,
  deps: WebResearchDeps,
  timeoutMs: number,
): Promise<unknown> {
  const env = await (
    deps.codexEnv ?? (async () => (await resolveCodexRuntime()).env)
  )();
  const workDir = await mkdtemp(join(tmpdir(), "boussole-research-"));
  const answerFile = join(workDir, "answer.json");
  const schemaFile = join(workDir, "schema.json");
  try {
    await writeFile(schemaFile, JSON.stringify(request.jsonSchema), "utf8");
    const { command, prefixArgs } = codexCommand();
    const result = await runCli(
      command,
      buildCodexResearchArgs({
        prefixArgs,
        model: request.model,
        workDir,
        answerFile,
        schemaFile,
      }),
      {
        env,
        cwd: workDir,
        input: request.prompt,
        timeoutMs,
        signal: request.signal,
        spawnFn: deps.spawnFn,
      },
    ).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        message.includes("ENOENT")
          ? "ChatGPT (Codex) is not installed on this server."
          : truncate(message, 300),
      );
    });
    if (result.timedOut) throw new Error(timeoutMessage(timeoutMs));
    const answer = (await readFile(answerFile, "utf8").catch(() => "")).trim();
    if (result.code !== 0 || !answer) {
      throw new Error(
        `ChatGPT research failed: ${truncate(lastLines(`${result.stderr}\n${result.stdout}`, 3) || "no output", 300)}`,
      );
    }
    return parseJsonObject(answer);
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Runs the research and returns the CLI's structured answer (unvalidated). */
export async function runWebResearch(
  request: WebResearchRequest,
  deps: WebResearchDeps = {},
): Promise<unknown> {
  const timeoutMs = request.timeoutMs ?? researchTimeoutMs();
  const { data } = await trackAiCall(
    {
      name: "company_research_web",
      provider: request.provider === "chatgpt" ? "codex" : "claude",
      model: request.model ?? null,
      prompt: request.prompt,
    },
    async () => {
      const answer =
        request.provider === "chatgpt"
          ? await runCodexResearch(request, deps, timeoutMs)
          : await runClaudeResearch(request, deps, timeoutMs);
      return { data: answer, text: JSON.stringify(answer, null, 2) };
    },
  );
  return data;
}
