/**
 * Tenant-scoped persistence for Deep Agents runs.
 */
import { randomUUID } from "node:crypto";
import { db, schema } from "@server/db";
import { getActiveTenantId } from "@server/tenancy/context";
import type {
  AgentRun,
  AgentRunEvent,
  AgentRunKind,
  AgentRunOutput,
  AgentRunStatus,
} from "@shared/types";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

const { agentRuns } = schema;

/** Oldest events are dropped beyond this many per run. */
export const MAX_AGENT_RUN_EVENTS = 300;

type AgentRunRow = typeof agentRuns.$inferSelect;

function durationMs(row: AgentRunRow): number | null {
  if (!row.startedAt || !row.finishedAt) return null;
  const started = Date.parse(row.startedAt);
  const finished = Date.parse(row.finishedAt);
  return Number.isFinite(started) && Number.isFinite(finished)
    ? Math.max(0, finished - started)
    : null;
}

function mapRow(row: AgentRunRow): AgentRun {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    jobId: row.jobId,
    model: row.model,
    events: Array.isArray(row.events) ? (row.events as AgentRunEvent[]) : [],
    output: (row.output as AgentRunOutput | null) ?? null,
    error: row.error,
    stats: {
      modelCalls: row.modelCalls,
      toolCalls: row.toolCalls,
      durationMs: durationMs(row),
    },
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}

export async function createAgentRun(input: {
  kind: AgentRunKind;
  jobId: string | null;
  model: string | null;
  requestId?: string | null;
}): Promise<AgentRun> {
  const row: typeof agentRuns.$inferInsert = {
    id: randomUUID(),
    tenantId: getActiveTenantId(),
    jobId: input.jobId,
    kind: input.kind,
    status: "queued",
    model: input.model,
    events: [],
    requestId: input.requestId ?? null,
    createdAt: new Date().toISOString(),
  };
  await db.insert(agentRuns).values(row);
  const created = await getAgentRunById(row.id);
  if (!created) throw new Error("Agent run was not persisted");
  return created;
}

export async function getAgentRunById(id: string): Promise<AgentRun | null> {
  const [row] = await db
    .select()
    .from(agentRuns)
    .where(
      and(eq(agentRuns.tenantId, getActiveTenantId()), eq(agentRuns.id, id)),
    );
  return row ? mapRow(row) : null;
}

export async function listAgentRuns(input: {
  jobId?: string | null;
  limit?: number;
}): Promise<AgentRun[]> {
  const tenantId = getActiveTenantId();
  const rows = await db
    .select()
    .from(agentRuns)
    .where(
      input.jobId
        ? and(
            eq(agentRuns.tenantId, tenantId),
            eq(agentRuns.jobId, input.jobId),
          )
        : eq(agentRuns.tenantId, tenantId),
    )
    .orderBy(desc(agentRuns.createdAt))
    .limit(Math.min(Math.max(input.limit ?? 20, 1), 100));
  return rows.map(mapRow);
}

export async function listActiveAgentRuns(): Promise<AgentRun[]> {
  const rows = await db
    .select()
    .from(agentRuns)
    .where(
      and(
        eq(agentRuns.tenantId, getActiveTenantId()),
        inArray(agentRuns.status, ["queued", "running"]),
      ),
    );
  return rows.map(mapRow);
}

export async function updateAgentRun(
  id: string,
  patch: Partial<{
    status: AgentRunStatus;
    output: AgentRunOutput | null;
    error: string | null;
    startedAt: string | null;
    finishedAt: string | null;
    modelCalls: number;
    toolCalls: number;
  }>,
): Promise<void> {
  await db
    .update(agentRuns)
    .set(patch)
    .where(
      and(eq(agentRuns.tenantId, getActiveTenantId()), eq(agentRuns.id, id)),
    );
}

/**
 * Appends one event atomically (a single UPDATE, so parallel subagents can't
 * overwrite each other's events) and drops the oldest beyond the cap.
 */
export async function appendAgentRunEvent(
  id: string,
  event: AgentRunEvent,
): Promise<void> {
  const payload = JSON.stringify(event);
  await db.run(sql`
    UPDATE agent_runs
    SET events = CASE
      WHEN json_array_length(events) >= ${MAX_AGENT_RUN_EVENTS}
        THEN json_insert(json_remove(events, '$[0]'), '$[#]', json(${payload}))
      ELSE json_insert(events, '$[#]', json(${payload}))
    END
    WHERE id = ${id} AND tenant_id = ${getActiveTenantId()}
  `);
}
