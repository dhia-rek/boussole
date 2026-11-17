/**
 * Types for Boussole's LangChain Deep Agents layer (application agent and
 * preference learner). Runs are stored per tenant in `agent_runs`.
 */

export const AGENT_RUN_KINDS = ["application", "learn"] as const;
export type AgentRunKind = (typeof AGENT_RUN_KINDS)[number];

export const AGENT_RUN_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
] as const;
export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];

export const AGENT_RUN_EVENT_TYPES = [
  "run_started",
  "subagent_started",
  "subagent_finished",
  "tool_called",
  "model_call",
  "note",
  "run_finished",
] as const;
export type AgentRunEventType = (typeof AGENT_RUN_EVENT_TYPES)[number];

export interface AgentRunEvent {
  /** ISO timestamp. */
  at: string;
  type: AgentRunEventType;
  /** Agent that produced the event ("orchestrator" or a subagent name). */
  agent: string;
  /** Short human-readable label, e.g. "job-analyst started". */
  label: string;
  /** Optional extra detail (truncated, never raw prompts or CV data). */
  detail?: string;
}

export interface ApplicationPackEmphasis {
  section: string;
  guidance: string;
}

export interface ApplicationPack {
  /** Job analysis from the job-analyst subagent. */
  analysis: string;
  /** Proposed CV headline (tailoring rules enforced). */
  headline: string;
  /** Per-section emphasis advice; never new experience. */
  emphasis: ApplicationPackEmphasis[];
  /** Cover letter in the job's language. */
  coverLetter: string;
  /** Language of the cover letter ("fr", "en", …). */
  coverLetterLanguage: string;
  /** Critic's verdict on unsupported claims, after fixes. */
  critique: string;
  /** Claims the critic flagged and the orchestrator removed or reworded. */
  unsupportedClaimsFixed: string[];
  /** Remaining risks or gaps the candidate should know about. */
  remainingRisks: string[];
}

export interface PreferenceLearnerOutput {
  updated: boolean;
  /** Why nothing was updated (e.g. not enough decisions yet). */
  reason?: string;
  decisionsConsidered: number;
  preferences: string | null;
}

export type AgentRunOutput =
  | { kind: "application"; pack: ApplicationPack }
  | { kind: "learn"; result: PreferenceLearnerOutput };

export interface AgentRunStats {
  modelCalls: number;
  toolCalls: number;
  durationMs: number | null;
}

export interface AgentRun {
  id: string;
  kind: AgentRunKind;
  status: AgentRunStatus;
  jobId: string | null;
  model: string | null;
  events: AgentRunEvent[];
  output: AgentRunOutput | null;
  error: string | null;
  stats: AgentRunStats;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface AgentMemory {
  /** Path of the memory file as the agents see it. */
  path: string;
  content: string | null;
  updatedAt: string | null;
}

/** Message shape sent on `GET /api/agents/runs/:runId/events` (SSE). */
export type AgentRunStreamMessage =
  | { type: "event"; runId: string; event: AgentRunEvent }
  | { type: "run"; run: AgentRun };
