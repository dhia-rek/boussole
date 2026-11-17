/**
 * Runs Forsa's LangChain Deep Agents (application agent, preference learner)
 * as tenant-scoped background jobs with live progress.
 *
 * - One running agent per tenant (in-process lock + stale-row recovery).
 * - Overall timeout (AGENT_RUN_TIMEOUT_MS, default 20 min) and cancellation;
 *   both abort the LangGraph run and the Claude CLI process.
 * - Events are persisted on the run (bounded) and fanned out to SSE clients.
 *
 * The module-level maps hold only control objects (abort controllers, event
 * emitters) keyed by run id or tenant id; every lookup checks the tenant.
 */
import { EventEmitter } from "node:events";
import { conflict, notFound, serviceUnavailable } from "@infra/errors";
import { logger } from "@infra/logger";
import { getRequestId, runWithRequestContext } from "@infra/request-context";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import * as agentRunsRepo from "@server/repositories/agent-runs";
import * as jobsRepo from "@server/repositories/jobs";
import { resolveLlmRuntimeSettings } from "@server/services/modelSelection";
import { getProfileForJob } from "@server/services/profile";
import { getActiveTenantId } from "@server/tenancy/context";
import type {
  AgentMemory,
  AgentRun,
  AgentRunEvent,
  AgentRunKind,
  AgentRunOutput,
  AgentRunStreamMessage,
} from "@shared/types";
import { runApplicationAgent } from "./application-agent";
import { ChatClaudeCli } from "./chat-claude-cli";
import { PREFERENCES_PATH, readPreferences } from "./memory-store";
import { runPreferenceLearner } from "./preference-learner";
import { type AgentEventInput, AgentProgressHandler } from "./progress";

const DEFAULT_RUN_TIMEOUT_MS = 20 * 60 * 1000;
const CANCEL_WAIT_MS = 5_000;
const MAX_ERROR_CHARS = 500;

type ActiveRun = {
  tenantId: string;
  runId: string;
  controller: AbortController;
  emitter: EventEmitter;
  timedOut: boolean;
  done: Promise<void>;
};

const activeRuns = new Map<string, ActiveRun>();
/** tenantId → run id (or "pending" while the run row is being created). */
const tenantLocks = new Map<string, string>();

export type AgentModelFactory = (args: {
  modelSpec: string | null;
  onCliCall: () => void;
}) => BaseChatModel;

const defaultModelFactory: AgentModelFactory = ({ modelSpec, onCliCall }) =>
  new ChatClaudeCli({ model: modelSpec, onCliCall });

let modelFactory: AgentModelFactory = defaultModelFactory;

/** Test seam: replace the Claude CLI model with a scripted one. */
export function __setAgentModelFactoryForTests(
  factory: AgentModelFactory | null,
): void {
  modelFactory = factory ?? defaultModelFactory;
}

function resolveRunTimeoutMs(): number {
  const raw = Number.parseInt(process.env.AGENT_RUN_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_RUN_TIMEOUT_MS;
}

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > MAX_ERROR_CHARS
    ? `${message.slice(0, MAX_ERROR_CHARS - 1)}…`
    : message;
}

/** Live databases created before this feature need their migrations run. */
async function withAgentTables<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (errorText(error).includes("no such table: agent_")) {
      throw serviceUnavailable(
        "AI agents need a database update. Restart Boussole so its migrations run (`npm run dev` does this automatically).",
      );
    }
    throw error;
  }
}

async function resolveAgentModelSpec(): Promise<string | null> {
  const runtime = await resolveLlmRuntimeSettings("tailoring");
  if (runtime.provider !== "claude_cli") {
    throw conflict(
      "AI agents run on the Claude CLI provider. Switch Settings → AI provider to “Claude (CLI)” to use them.",
    );
  }
  return runtime.model?.trim() || null;
}

/** Marks queued/running rows without a live process (e.g. after a restart). */
async function recoverInterruptedRuns(): Promise<void> {
  for (const run of await agentRunsRepo.listActiveAgentRuns()) {
    if (activeRuns.has(run.id)) continue;
    await agentRunsRepo.updateAgentRun(run.id, {
      status: "failed",
      error: "Interrupted: Forsa restarted while this run was in progress.",
      finishedAt: new Date().toISOString(),
    });
  }
}

function emitEvent(active: ActiveRun, input: AgentEventInput): void {
  const event: AgentRunEvent = { ...input, at: new Date().toISOString() };
  active.emitter.emit("message", {
    type: "event",
    runId: active.runId,
    event,
  } satisfies AgentRunStreamMessage);
  // Callbacks may fire outside the request context: pin the tenant here.
  void runWithRequestContext({ tenantId: active.tenantId }, () =>
    agentRunsRepo.appendAgentRunEvent(active.runId, event),
  ).catch((error) => {
    logger.warn("Failed to persist agent run event", {
      runId: active.runId,
      error: errorText(error),
    });
  });
}

type RunWork = (context: {
  signal: AbortSignal;
  handler: AgentProgressHandler;
  onCliCall: () => void;
}) => Promise<AgentRunOutput>;

async function executeRun(
  active: ActiveRun,
  run: AgentRun,
  work: RunWork,
): Promise<void> {
  let modelCalls = 0;
  const handler = new AgentProgressHandler((event) => emitEvent(active, event));
  await agentRunsRepo.updateAgentRun(run.id, {
    status: "running",
    startedAt: new Date().toISOString(),
  });
  emitEvent(active, {
    type: "run_started",
    agent: "orchestrator",
    label:
      run.kind === "application"
        ? "Application agents started"
        : "Preference learner started",
  });

  try {
    const output = await work({
      signal: active.controller.signal,
      handler,
      onCliCall: () => {
        modelCalls += 1;
      },
    });
    await agentRunsRepo.updateAgentRun(run.id, {
      status: "succeeded",
      output,
      error: null,
      finishedAt: new Date().toISOString(),
      modelCalls,
      toolCalls: handler.toolCalls,
    });
    emitEvent(active, {
      type: "run_finished",
      agent: "orchestrator",
      label: "Finished",
    });
  } catch (error) {
    const cancelled = active.controller.signal.aborted && !active.timedOut;
    const message = active.timedOut
      ? `Timed out after ${Math.round(resolveRunTimeoutMs() / 60_000)} minutes.`
      : cancelled
        ? null
        : errorText(error);
    await agentRunsRepo.updateAgentRun(run.id, {
      status: cancelled ? "cancelled" : "failed",
      error: message,
      finishedAt: new Date().toISOString(),
      modelCalls,
      toolCalls: handler.toolCalls,
    });
    emitEvent(active, {
      type: "run_finished",
      agent: "orchestrator",
      label: cancelled ? "Cancelled" : "Failed",
      detail: message ?? undefined,
    });
    if (!cancelled) {
      logger.warn("Agent run failed", {
        runId: run.id,
        kind: run.kind,
        jobId: run.jobId,
        error: message,
      });
    }
  }

  const finished = await agentRunsRepo.getAgentRunById(run.id);
  if (finished) {
    active.emitter.emit("message", {
      type: "run",
      run: finished,
    } satisfies AgentRunStreamMessage);
  }
}

async function startRun(args: {
  kind: AgentRunKind;
  jobId: string | null;
  work: (modelSpec: string | null) => RunWork;
}): Promise<AgentRun> {
  const tenantId = getActiveTenantId();
  const modelSpec = await resolveAgentModelSpec();

  if (tenantLocks.has(tenantId)) {
    throw conflict(
      "An AI agent run is already in progress. Wait for it or cancel it.",
    );
  }
  tenantLocks.set(tenantId, "pending");

  let run: AgentRun;
  try {
    run = await withAgentTables(async () => {
      await recoverInterruptedRuns();
      return agentRunsRepo.createAgentRun({
        kind: args.kind,
        jobId: args.jobId,
        model: modelSpec,
        requestId: getRequestId() ?? null,
      });
    });
  } catch (error) {
    tenantLocks.delete(tenantId);
    throw error;
  }

  const controller = new AbortController();
  let resolveDone: () => void = () => undefined;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  const active: ActiveRun = {
    tenantId,
    runId: run.id,
    controller,
    emitter: new EventEmitter(),
    timedOut: false,
    done,
  };
  activeRuns.set(run.id, active);
  tenantLocks.set(tenantId, run.id);

  const timer = setTimeout(() => {
    active.timedOut = true;
    controller.abort();
  }, resolveRunTimeoutMs());
  timer.unref?.();

  void runWithRequestContext(
    { tenantId, jobId: args.jobId ?? undefined },
    async () => {
      try {
        await executeRun(active, run, args.work(modelSpec));
      } catch (error) {
        logger.error("Agent run crashed", {
          runId: run.id,
          error: errorText(error),
        });
      } finally {
        clearTimeout(timer);
        activeRuns.delete(run.id);
        if (tenantLocks.get(tenantId) === run.id) tenantLocks.delete(tenantId);
        active.emitter.removeAllListeners();
        resolveDone();
      }
    },
  );

  return run;
}

export async function startApplicationRun(jobId: string): Promise<AgentRun> {
  const job = await jobsRepo.getJobById(jobId);
  if (!job) throw notFound("Job not found");

  return startRun({
    kind: "application",
    jobId: job.id,
    work:
      (modelSpec) =>
      async ({ signal, handler, onCliCall }) => {
        const profile = await getProfileForJob(job.jobDescription);
        const preferences = (await readPreferences())?.content ?? null;
        const pack = await runApplicationAgent({
          input: { job, profile, preferences },
          model: modelFactory({ modelSpec, onCliCall }),
          signal,
          callbacks: [handler],
        });
        return { kind: "application", pack };
      },
  });
}

export async function startLearnRun(): Promise<AgentRun> {
  return startRun({
    kind: "learn",
    jobId: null,
    work:
      (modelSpec) =>
      async ({ signal, onCliCall }) => {
        const result = await runPreferenceLearner({
          model: modelFactory({ modelSpec, onCliCall }),
          signal,
        });
        return { kind: "learn", result };
      },
  });
}

export async function getAgentRun(runId: string): Promise<AgentRun> {
  const run = await withAgentTables(() => agentRunsRepo.getAgentRunById(runId));
  if (!run) throw notFound("Agent run not found");
  return run;
}

export async function listAgentRuns(input: {
  jobId?: string;
  limit?: number;
}): Promise<AgentRun[]> {
  return withAgentTables(() =>
    agentRunsRepo.listAgentRuns({ jobId: input.jobId, limit: input.limit }),
  );
}

export async function cancelAgentRun(runId: string): Promise<AgentRun> {
  const run = await getAgentRun(runId);
  const active = activeRuns.get(runId);
  if (active && active.tenantId === getActiveTenantId()) {
    active.controller.abort();
    await Promise.race([
      active.done,
      new Promise((resolve) => setTimeout(resolve, CANCEL_WAIT_MS)),
    ]);
  } else if (run.status === "queued" || run.status === "running") {
    await agentRunsRepo.updateAgentRun(runId, {
      status: "cancelled",
      finishedAt: new Date().toISOString(),
    });
  }
  return getAgentRun(runId);
}

export async function getAgentMemory(): Promise<AgentMemory> {
  const preferences = await withAgentTables(() => readPreferences());
  return {
    path: PREFERENCES_PATH,
    content: preferences?.content ?? null,
    updatedAt: preferences?.updatedAt ?? null,
  };
}

/**
 * Live messages for a run of the current tenant; null when the run is not
 * running in this process (the caller then sends the stored state only).
 */
export function subscribeToAgentRun(
  runId: string,
  listener: (message: AgentRunStreamMessage) => void,
): (() => void) | null {
  const active = activeRuns.get(runId);
  if (!active || active.tenantId !== getActiveTenantId()) return null;
  active.emitter.on("message", listener);
  return () => {
    active.emitter.off("message", listener);
  };
}
