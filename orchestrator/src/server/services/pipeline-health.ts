import { sql } from "drizzle-orm";
import { db } from "../db/index";
import { PREFILTER_SCORE } from "./scoring-prefilter";

/**
 * Read-only snapshot of pipeline state so it's visible at a glance instead of
 * needing manual SQLite queries: discovery yield per source, how much work is
 * scored vs pending, how many jobs the cheap pre-filter saved LLM calls on,
 * how many AI responses are cached, and the last run.
 */
export interface PipelineHealth {
  totalJobs: number;
  scoredJobs: number;
  pendingJobs: number;
  prefilteredJobs: number;
  cachedAiResponses: number;
  jobsBySource: Array<{ source: string; count: number }>;
  lastRun: { status: string; startedAt: string | null } | null;
}

function count(query: ReturnType<typeof sql>): number {
  try {
    const row = db.get<{ c: number }>(sql`SELECT ${query} AS c`);
    return Number(row?.c ?? 0);
  } catch {
    return 0;
  }
}

export function getPipelineHealth(): PipelineHealth {
  const totalJobs = count(sql`(SELECT COUNT(*) FROM jobs)`);
  const scoredJobs = count(
    sql`(SELECT COUNT(*) FROM jobs WHERE suitability_score IS NOT NULL)`,
  );
  const prefilteredJobs = count(
    sql`(SELECT COUNT(*) FROM jobs WHERE suitability_score = ${PREFILTER_SCORE})`,
  );
  // The cache table is created lazily; treat "missing" as zero.
  let cachedAiResponses = 0;
  try {
    const row = db.get<{ c: number }>(
      sql`SELECT COUNT(*) AS c FROM llm_response_cache`,
    );
    cachedAiResponses = Number(row?.c ?? 0);
  } catch {
    cachedAiResponses = 0;
  }

  let jobsBySource: Array<{ source: string; count: number }> = [];
  try {
    jobsBySource = db
      .all<{ source: string; count: number }>(
        sql`SELECT source, COUNT(*) AS count FROM jobs GROUP BY source ORDER BY count DESC`,
      )
      .map((r) => ({ source: String(r.source), count: Number(r.count) }));
  } catch {
    jobsBySource = [];
  }

  let lastRun: PipelineHealth["lastRun"] = null;
  try {
    const row = db.get<{ status: string; started_at: string | null }>(
      sql`SELECT status, started_at FROM pipeline_runs ORDER BY started_at DESC LIMIT 1`,
    );
    if (row?.status) {
      lastRun = {
        status: String(row.status),
        startedAt: row.started_at ?? null,
      };
    }
  } catch {
    lastRun = null;
  }

  return {
    totalJobs,
    scoredJobs,
    pendingJobs: Math.max(0, totalJobs - scoredJobs),
    prefilteredJobs,
    cachedAiResponses,
    jobsBySource,
    lastRun,
  };
}
