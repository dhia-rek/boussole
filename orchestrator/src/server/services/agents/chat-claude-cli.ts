/**
 * LangChain chat model backed by the Claude Code CLI.
 *
 * Forsa runs every AI task through the owner's own `claude` login (no API
 * key). LangChain / Deep Agents need a chat model with tool calling, so this
 * class adds tool calling on top of plain CLI text generation with a strict
 * JSON protocol:
 *
 *   {"tool_calls":[{"name":"<tool>","args":{…}}]}   or   {"final":"<answer>"}
 *
 * The conversation (system, user, assistant turns with their tool calls, and
 * tool results) and the bound tools' JSON schemas are rendered into one
 * prompt per model turn. A reply that breaks the protocol gets one repair
 * attempt, then fails with a clear error.
 *
 * Swapping this for an API-backed model (e.g. ChatAnthropic) is a one-line
 * change where the agents are built; nothing else depends on it.
 */
import { randomUUID } from "node:crypto";
import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import type { BaseLanguageModelInput } from "@langchain/core/language_models/base";
import {
  BaseChatModel,
  type BaseChatModelCallOptions,
  type BaseChatModelParams,
  type BindToolsInput,
} from "@langchain/core/language_models/chat_models";
import {
  AIMessage,
  type AIMessageChunk,
  type BaseMessage,
} from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";
import type { Runnable } from "@langchain/core/runnables";
import { convertToOpenAITool } from "@langchain/core/utils/function_calling";
import { ClaudeCliClient } from "@server/services/llm/claude-cli/client";
import { CodexCliClient } from "@server/services/llm/codex-cli/client";
import { resolveActiveAiProvider } from "@server/services/modelSelection";

const DEFAULT_AGENT_CLI_TIMEOUT_MS = 300_000;
/** Longest single transcript entry sent to the CLI (tool results can be big). */
const MAX_ENTRY_CHARS = 30_000;
/** How much of a rejected reply is echoed back in the repair prompt. */
const MAX_REPAIR_ECHO_CHARS = 2_000;

export type AgentToolSpec = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type ChatClaudeCliCallOptions = BaseChatModelCallOptions & {
  tools?: AgentToolSpec[];
};

export type ClaudeCliRunner = (args: {
  prompt: string;
  model: string | null;
  timeoutMs: number;
  signal?: AbortSignal;
}) => Promise<string>;

export type ChatClaudeCliFields = BaseChatModelParams & {
  /** Model spec as configured in Forsa, e.g. "opus:medium". */
  model?: string | null;
  /** Per CLI call. Defaults to AGENT_CLI_TIMEOUT_MS or 5 minutes. */
  timeoutMs?: number;
  /** Injectable for tests; defaults to the real Claude CLI. */
  runner?: ClaudeCliRunner;
  /** Called after every CLI round trip (repairs included). */
  onCliCall?: (info: { durationMs: number; ok: boolean }) => void;
};

export class AgentProtocolError extends Error {}

/** Runs on the workspace's own AI account: Claude or ChatGPT. */
const defaultRunner: ClaudeCliRunner = async (args) => {
  const client =
    (await resolveActiveAiProvider()) === "chatgpt"
      ? new CodexCliClient()
      : new ClaudeCliClient();
  const { text } = await client.complete(args);
  return text;
};

function resolveTimeoutMs(explicit?: number): number {
  if (explicit && explicit > 0) return explicit;
  const raw = Number.parseInt(process.env.AGENT_CLI_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_AGENT_CLI_TIMEOUT_MS;
}

function truncateText(value: string, max: number): string {
  return value.length > max
    ? `${value.slice(0, max)}\n…[truncated ${value.length - max} characters]`
    : value;
}

// ---------------------------------------------------------------------------
// Prompt rendering
// ---------------------------------------------------------------------------

/** Plain text of a message content (string or LangChain content blocks). */
export function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === "string") return block;
        if (block && typeof block === "object") {
          const record = block as Record<string, unknown>;
          if (typeof record.text === "string") return record.text;
          return `[${String(record.type ?? "content")} omitted]`;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (content === null || content === undefined) return "";
  return JSON.stringify(content);
}

function renderEntry(message: BaseMessage): string {
  const type = message.getType();
  const text = truncateText(
    contentToText(message.content).trim(),
    MAX_ENTRY_CHARS,
  );
  if (type === "human") return `### User\n${text}`;
  if (type === "ai") {
    const calls = (message as AIMessage).tool_calls ?? [];
    const callText =
      calls.length > 0
        ? `\nTool calls: ${JSON.stringify(
            calls.map((call) => ({
              id: call.id,
              name: call.name,
              args: call.args,
            })),
          )}`
        : "";
    return `### Assistant\n${text || "(no text)"}${callText}`;
  }
  if (type === "tool") {
    const toolMessage = message as BaseMessage & {
      tool_call_id?: string;
      name?: string;
    };
    return `### Tool result (${toolMessage.name ?? "tool"}, call ${toolMessage.tool_call_id ?? "?"})\n${text}`;
  }
  return `### ${type}\n${text}`;
}

export function renderTranscript(messages: BaseMessage[]): {
  system: string;
  transcript: string;
} {
  const system: string[] = [];
  const entries: string[] = [];
  for (const message of messages) {
    if (message.getType() === "system") {
      const text = contentToText(message.content).trim();
      if (text) system.push(text);
      continue;
    }
    entries.push(renderEntry(message));
  }
  return { system: system.join("\n\n"), transcript: entries.join("\n\n") };
}

const REPLY_PROTOCOL = [
  "Reply with exactly ONE JSON object and nothing else (no markdown fences, no commentary):",
  '- To call tools: {"tool_calls":[{"name":"<tool name>","args":{…}}]}. List several calls when they are independent; they run in parallel.',
  '- To finish: {"final":"<your complete answer as a string>"}',
  "Use only the tools listed above, with arguments that match their JSON schema.",
].join("\n");

export function buildToolPrompt(
  messages: BaseMessage[],
  tools: AgentToolSpec[],
  requireTool: boolean,
): string {
  const { system, transcript } = renderTranscript(messages);
  return [
    "You are the reasoning engine of an AI agent running inside Forsa, a personal job-search app.",
    "You cannot run commands or use built-in tools. You act only by replying with JSON as described at the end.",
    system ? `\n# Instructions\n${system}` : "",
    `\n# Tools\n${JSON.stringify(tools, null, 2)}`,
    `\n# Conversation\n${transcript || "(empty)"}`,
    `\n# Your reply\n${REPLY_PROTOCOL}${
      requireTool ? "\nYou must call at least one tool in this reply." : ""
    }`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildPlainPrompt(messages: BaseMessage[]): string {
  const { system, transcript } = renderTranscript(messages);
  return [
    system ? `# Instructions\n${system}\n` : "",
    `# Conversation\n${transcript || "(empty)"}`,
    "\nReply to the last message directly with plain text. Do not run commands or use tools.",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildRepairPrompt(
  prompt: string,
  rejected: string,
  error: string,
): string {
  return [
    prompt,
    "\n# Your previous reply was rejected",
    `Problem: ${error}`,
    `Previous reply:\n${truncateText(rejected, MAX_REPAIR_ECHO_CHARS)}`,
    "Reply again with ONLY the JSON object described above.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Reply parsing
// ---------------------------------------------------------------------------

function stripOuterFence(text: string): string {
  let trimmed = text.trim();
  if (trimmed.startsWith("```")) {
    const newline = trimmed.indexOf("\n");
    trimmed = newline >= 0 ? trimmed.slice(newline + 1) : "";
  }
  if (trimmed.endsWith("```")) trimmed = trimmed.slice(0, -3);
  return trimmed.trim();
}

/** Parses the first balanced JSON object in `text`. */
export function extractFirstJsonObject(text: string): unknown {
  const cleaned = stripOuterFence(text);
  const start = cleaned.indexOf("{");
  if (start < 0) throw new AgentProtocolError("no JSON object found");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < cleaned.length; index += 1) {
    const char = cleaned[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(cleaned.slice(start, index + 1));
        } catch (error) {
          throw new AgentProtocolError(
            `invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
  }
  throw new AgentProtocolError("unterminated JSON object");
}

export type AgentReply =
  | { kind: "final"; text: string }
  | {
      kind: "tools";
      calls: Array<{ name: string; args: Record<string, unknown> }>;
    };

function requiredArgs(spec: AgentToolSpec): string[] {
  const required = spec.parameters.required;
  return Array.isArray(required)
    ? required.filter((key): key is string => typeof key === "string")
    : [];
}

function parseArgs(raw: unknown, toolName: string): Record<string, unknown> {
  let value = raw ?? {};
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      throw new AgentProtocolError(`args of "${toolName}" are not valid JSON`);
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AgentProtocolError(`args of "${toolName}" must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

export function parseAgentReply(
  text: string,
  tools: AgentToolSpec[],
  requireTool: boolean,
): AgentReply {
  const value = extractFirstJsonObject(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AgentProtocolError("reply is not a JSON object");
  }
  const record = value as Record<string, unknown>;
  const byName = new Map(tools.map((spec) => [spec.name, spec]));

  if (Array.isArray(record.tool_calls) && record.tool_calls.length > 0) {
    const calls = record.tool_calls.map((entry, index) => {
      if (!entry || typeof entry !== "object") {
        throw new AgentProtocolError(`tool_calls[${index}] is not an object`);
      }
      const call = entry as Record<string, unknown>;
      const name = typeof call.name === "string" ? call.name.trim() : "";
      const spec = byName.get(name);
      if (!spec) {
        throw new AgentProtocolError(
          `tool_calls[${index}].name "${name}" is not one of: ${[...byName.keys()].join(", ")}`,
        );
      }
      const args = parseArgs(call.args ?? call.arguments, name);
      const missing = requiredArgs(spec).filter((key) => !(key in args));
      if (missing.length > 0) {
        throw new AgentProtocolError(
          `tool "${name}" is missing required argument(s): ${missing.join(", ")}`,
        );
      }
      return { name, args };
    });
    return { kind: "tools", calls };
  }

  if ("final" in record) {
    if (requireTool) {
      throw new AgentProtocolError("a tool call is required in this reply");
    }
    const final = record.final;
    return {
      kind: "final",
      text: typeof final === "string" ? final : JSON.stringify(final),
    };
  }

  throw new AgentProtocolError(
    'expected a "tool_calls" array or a "final" string',
  );
}

function isToolRequired(toolChoice: unknown): boolean {
  if (toolChoice === undefined || toolChoice === null) return false;
  if (typeof toolChoice === "string") {
    return toolChoice !== "auto" && toolChoice !== "none";
  }
  return true;
}

export function toAgentToolSpec(input: BindToolsInput): AgentToolSpec {
  const converted = convertToOpenAITool(
    input as Parameters<typeof convertToOpenAITool>[0],
  );
  const fn = converted.function;
  return {
    name: fn.name,
    description: fn.description ?? "",
    parameters: (fn.parameters as Record<string, unknown> | undefined) ?? {
      type: "object",
      properties: {},
    },
  };
}

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export class ChatClaudeCli extends BaseChatModel<ChatClaudeCliCallOptions> {
  static lc_name(): string {
    return "ChatClaudeCli";
  }

  readonly modelSpec: string | null;
  private readonly timeoutMs: number;
  private readonly runner: ClaudeCliRunner;
  private readonly onCliCall?: ChatClaudeCliFields["onCliCall"];

  constructor(fields: ChatClaudeCliFields = {}) {
    super(fields);
    this.modelSpec = fields.model?.trim() || null;
    this.timeoutMs = resolveTimeoutMs(fields.timeoutMs);
    this.runner = fields.runner ?? defaultRunner;
    this.onCliCall = fields.onCliCall;
  }

  _llmType(): string {
    return "claude-cli";
  }

  override bindTools(
    tools: BindToolsInput[],
    kwargs?: Partial<ChatClaudeCliCallOptions>,
  ): Runnable<
    BaseLanguageModelInput,
    AIMessageChunk,
    ChatClaudeCliCallOptions
  > {
    return this.withConfig({
      tools: tools.map(toAgentToolSpec),
      ...(kwargs?.tool_choice !== undefined
        ? { tool_choice: kwargs.tool_choice }
        : {}),
    } as Partial<ChatClaudeCliCallOptions>);
  }

  private async callCli(prompt: string, signal?: AbortSignal): Promise<string> {
    const startedAt = Date.now();
    try {
      const text = await this.runner({
        prompt,
        model: this.modelSpec,
        timeoutMs: this.timeoutMs,
        signal,
      });
      this.onCliCall?.({ durationMs: Date.now() - startedAt, ok: true });
      return text;
    } catch (error) {
      this.onCliCall?.({ durationMs: Date.now() - startedAt, ok: false });
      throw error;
    }
  }

  async _generate(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    _runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    const tools = options.tools ?? [];
    const signal = options.signal;

    if (tools.length === 0) {
      const text = (
        await this.callCli(buildPlainPrompt(messages), signal)
      ).trim();
      return {
        generations: [{ text, message: new AIMessage({ content: text }) }],
      };
    }

    const requireTool = isToolRequired(options.tool_choice);
    const prompt = buildToolPrompt(messages, tools, requireTool);
    let raw = await this.callCli(prompt, signal);
    let reply: AgentReply;
    try {
      reply = parseAgentReply(raw, tools, requireTool);
    } catch (error) {
      const problem = error instanceof Error ? error.message : String(error);
      raw = await this.callCli(buildRepairPrompt(prompt, raw, problem), signal);
      try {
        reply = parseAgentReply(raw, tools, requireTool);
      } catch (retryError) {
        const detail =
          retryError instanceof Error ? retryError.message : String(retryError);
        throw new AgentProtocolError(
          `Claude CLI did not follow the agent reply protocol after a retry: ${detail}`,
        );
      }
    }

    const message =
      reply.kind === "final"
        ? new AIMessage({ content: reply.text })
        : new AIMessage({
            content: "",
            tool_calls: reply.calls.map((call) => ({
              id: `call_${randomUUID()}`,
              name: call.name,
              args: call.args,
              type: "tool_call" as const,
            })),
          });
    return {
      generations: [
        { text: reply.kind === "final" ? reply.text : "", message },
      ],
    };
  }
}
