/**
 * Turns LangChain callbacks into small, UI-friendly agent run events.
 *
 * Events never carry prompts, CV content or tool outputs — only which agent
 * is working, which tool it called, and short task descriptions.
 */
import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { Serialized } from "@langchain/core/load/serializable";
import type { BaseMessage } from "@langchain/core/messages";
import type { AgentRunEvent } from "@shared/types";

export type AgentEventInput = Omit<AgentRunEvent, "at">;

const MAX_DETAIL_CHARS = 200;

function agentNameFrom(metadata: Record<string, unknown> | undefined): string {
  const name = metadata?.lc_agent_name;
  return typeof name === "string" && name.trim() ? name : "orchestrator";
}

function shortDetail(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text.length > MAX_DETAIL_CHARS
    ? `${text.slice(0, MAX_DETAIL_CHARS - 1)}…`
    : text;
}

function parseToolInput(input: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(input);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export class AgentProgressHandler extends BaseCallbackHandler {
  name = "boussole_agent_progress";
  toolCalls = 0;
  private readonly taskRuns = new Map<string, string>();

  constructor(private readonly emit: (event: AgentEventInput) => void) {
    super();
  }

  override handleToolStart(
    _tool: Serialized,
    input: string,
    runId: string,
    _parentRunId?: string,
    _tags?: string[],
    metadata?: Record<string, unknown>,
    runName?: string,
  ): void {
    this.toolCalls += 1;
    const toolName = runName ?? "tool";
    if (toolName === "task") {
      const parsed = parseToolInput(input);
      const subagent =
        typeof parsed?.subagent_type === "string"
          ? parsed.subagent_type
          : "subagent";
      this.taskRuns.set(runId, subagent);
      this.emit({
        type: "subagent_started",
        agent: subagent,
        label: `${subagent} started`,
        detail: shortDetail(parsed?.description),
      });
      return;
    }
    const agent = agentNameFrom(metadata);
    this.emit({
      type: "tool_called",
      agent,
      label: `${agent} called ${toolName}`,
    });
  }

  override handleToolEnd(_output: unknown, runId: string): void {
    const subagent = this.taskRuns.get(runId);
    if (!subagent) return;
    this.taskRuns.delete(runId);
    this.emit({
      type: "subagent_finished",
      agent: subagent,
      label: `${subagent} finished`,
    });
  }

  override handleToolError(error: Error, runId: string): void {
    const subagent = this.taskRuns.get(runId);
    if (!subagent) return;
    this.taskRuns.delete(runId);
    this.emit({
      type: "subagent_finished",
      agent: subagent,
      label: `${subagent} failed`,
      detail: shortDetail(error.message),
    });
  }

  override handleChatModelStart(
    _llm: Serialized,
    _messages: BaseMessage[][],
    _runId: string,
    _parentRunId?: string,
    _extraParams?: Record<string, unknown>,
    _tags?: string[],
    metadata?: Record<string, unknown>,
  ): void {
    const agent = agentNameFrom(metadata);
    this.emit({
      type: "model_call",
      agent,
      label: `${agent} is thinking`,
    });
  }
}
