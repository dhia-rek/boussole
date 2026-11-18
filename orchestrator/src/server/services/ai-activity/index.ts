/**
 * AI activity: every request Boussole sends to the person's AI account
 * (what for, which job, what was sent, what came back, how long), so they
 * can follow and check what the AI does. Stored only in this Boussole's
 * database, per workspace, last MAX_KEPT requests. Recording never breaks
 * the AI request itself.
 */
import { randomUUID } from "node:crypto";
import { logger } from "@infra/logger";
import { getRequestContext } from "@infra/request-context";
import { db, schema } from "@server/db/index";
import { getActiveTenantId } from "@server/tenancy/context";
import { and, desc, eq, notInArray } from "drizzle-orm";

export const MAX_KEPT = 300;
/** Enough to read what was sent and answered; prompts can be long. */
const PREVIEW_HEAD = 6_000;
const PREVIEW_TAIL = 2_000;

/** Plain-language names for the features' request names. */
const LABELS: Record<string, string> = {
  job_suitability_score: "Match score",
  job_brief: "Job summary",
  resume_tailoring: "Tailor the CV",
  project_selection: "Pick CV projects",
  cv_check: "CV check",
  company_research_review: "Check company research",
  company_research_web: "Company research (web search)",
  job_chat_response: "Ghostwriter answer",
  mock_interview_turn: "Interview question",
  mock_interview_report: "Interview feedback",
  post_application_email_router: "Sort a job email",
  manual_job_details: "Read a job link",
  design_resume_import: "Import a CV",
  spontaneous_email: "Spontaneous email",
  onboarding_search_terms: "Suggest search terms",
  agent_step: "Deep Agents step",
};

export function labelFor(name: string): string {
  return LABELS[name] ?? name.replace(/_/g, " ");
}

/** Head and tail of long text, with a marker of what was left out. */
export function preview(text: string): string {
  if (text.length <= PREVIEW_HEAD + PREVIEW_TAIL) return text;
  const skipped = text.length - PREVIEW_HEAD - PREVIEW_TAIL;
  return `${text.slice(0, PREVIEW_HEAD)}\n\n[… ${skipped} characters not shown …]\n\n${text.slice(-PREVIEW_TAIL)}`;
}

export type AiCallInfo = {
  /** A feature's request name (for example "job_brief"). */
  name: string;
  provider: "claude" | "codex";
  model: string | null;
  /** Exactly what is sent to the AI. */
  prompt: string;
  jobId?: string | null;
};

async function start(info: AiCallInfo): Promise<string | null> {
  try {
    const id = randomUUID();
    const tenantId = getActiveTenantId();
    const jobId = info.jobId ?? getRequestContext()?.jobId ?? null;
    await db.insert(schema.aiActivity).values({
      id,
      tenantId,
      label: labelFor(info.name),
      provider: info.provider,
      model: info.model,
      jobId,
      status: "running",
      promptChars: info.prompt.length,
      promptPreview: preview(info.prompt),
      startedAt: new Date().toISOString(),
    });
    // Keep the newest MAX_KEPT of this workspace.
    const keep = db
      .select({ id: schema.aiActivity.id })
      .from(schema.aiActivity)
      .where(eq(schema.aiActivity.tenantId, tenantId))
      .orderBy(desc(schema.aiActivity.startedAt))
      .limit(MAX_KEPT);
    await db
      .delete(schema.aiActivity)
      .where(
        and(
          eq(schema.aiActivity.tenantId, tenantId),
          notInArray(schema.aiActivity.id, keep),
        ),
      );
    return id;
  } catch (error) {
    logger.warn("AI activity could not be recorded", { error });
    return null;
  }
}

async function finish(
  id: string | null,
  startedAt: number,
  outcome: { text: string } | { error: string },
): Promise<void> {
  if (!id) return;
  try {
    await db
      .update(schema.aiActivity)
      .set(
        "text" in outcome
          ? {
              status: "ok",
              responseChars: outcome.text.length,
              responsePreview: preview(outcome.text),
              durationMs: Date.now() - startedAt,
            }
          : {
              status: "error",
              error: outcome.error.slice(0, 2_000),
              durationMs: Date.now() - startedAt,
            },
      )
      .where(eq(schema.aiActivity.id, id));
  } catch (error) {
    logger.warn("AI activity could not be updated", { error });
  }
}

/** Runs one AI request and records it. `run` must return the AI's text. */
export async function trackAiCall<T extends { text: string }>(
  info: AiCallInfo,
  run: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  const id = await start(info);
  try {
    const result = await run();
    await finish(id, startedAt, { text: result.text });
    return result;
  } catch (error) {
    await finish(id, startedAt, {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Startup maintenance across workspaces: a request still "running" when
 * the server starts was cut off by the restart.
 */
export function markInterruptedAiCalls(): number {
  return db
    .update(schema.aiActivity)
    .set({ status: "error", error: "Interrupted: Boussole restarted." })
    .where(eq(schema.aiActivity.status, "running"))
    .run().changes;
}

export type AiActivityItem = typeof schema.aiActivity.$inferSelect & {
  jobTitle: string | null;
  jobEmployer: string | null;
};

export async function listAiActivity(limit = 100): Promise<AiActivityItem[]> {
  const tenantId = getActiveTenantId();
  const { aiActivity, jobs } = schema;
  const rows = await db
    .select({
      activity: aiActivity,
      jobTitle: jobs.title,
      jobEmployer: jobs.employer,
    })
    .from(aiActivity)
    .leftJoin(
      jobs,
      and(eq(jobs.id, aiActivity.jobId), eq(jobs.tenantId, tenantId)),
    )
    .where(eq(aiActivity.tenantId, tenantId))
    .orderBy(desc(aiActivity.startedAt))
    .limit(Math.max(1, Math.min(limit, MAX_KEPT)));
  return rows.map((row) => ({
    ...row.activity,
    jobTitle: row.jobTitle ?? null,
    jobEmployer: row.jobEmployer ?? null,
  }));
}
