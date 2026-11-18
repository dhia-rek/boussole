/**
 * Company research briefs, one per job (the latest run), always scoped to the
 * active workspace.
 */
import { randomUUID } from "node:crypto";
import type {
  AiProvider,
  CompanyResearch,
  CompanyResearchBrief,
  CompanyResearchJudgement,
  CompanyResearchVerdict,
} from "@shared/types";
import { and, eq } from "drizzle-orm";
import { db, schema } from "../db/index";
import type { CompanyResearchRow } from "../db/schema";
import { getActiveTenantId } from "../tenancy/context";

const { companyResearch } = schema;

function parseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function mapRow(row: CompanyResearchRow): CompanyResearch {
  return {
    id: row.id,
    jobId: row.jobId,
    status: row.status,
    verdict: row.verdict ?? null,
    provider: row.provider as AiProvider,
    model: row.model ?? null,
    brief: parseJson<CompanyResearchBrief>(row.briefJson),
    judgement: parseJson<CompanyResearchJudgement>(row.judgementJson),
    error: row.error ?? null,
    startedAt: row.startedAt,
    completedAt: row.completedAt ?? null,
  };
}

export async function getCompanyResearch(
  jobId: string,
): Promise<CompanyResearch | null> {
  const tenantId = getActiveTenantId();
  const [row] = await db
    .select()
    .from(companyResearch)
    .where(
      and(
        eq(companyResearch.tenantId, tenantId),
        eq(companyResearch.jobId, jobId),
      ),
    );
  return row ? mapRow(row) : null;
}

/**
 * Marks the job's research as running under a new run id. The previous brief,
 * judgement and verdict are kept until the new run succeeds.
 */
export async function startCompanyResearchRow(input: {
  jobId: string;
  provider: AiProvider;
  model: string | null;
}): Promise<CompanyResearch> {
  const tenantId = getActiveTenantId();
  const fields = {
    id: randomUUID(),
    status: "running" as const,
    provider: input.provider,
    model: input.model,
    error: null,
    startedAt: new Date().toISOString(),
    completedAt: null,
  };
  await db
    .insert(companyResearch)
    .values({ ...fields, tenantId, jobId: input.jobId })
    .onConflictDoUpdate({
      target: [companyResearch.tenantId, companyResearch.jobId],
      set: fields,
    });
  const saved = await getCompanyResearch(input.jobId);
  if (!saved) throw new Error("Failed to save company research");
  return saved;
}

/** Saves the outcome of run `id`; ignored if a newer run replaced it. */
export async function finishCompanyResearchRow(
  id: string,
  outcome:
    | {
        status: "done";
        verdict: CompanyResearchVerdict;
        brief: CompanyResearchBrief;
        judgement: CompanyResearchJudgement;
      }
    | { status: "failed"; error: string },
): Promise<void> {
  const tenantId = getActiveTenantId();
  await db
    .update(companyResearch)
    .set(
      outcome.status === "done"
        ? {
            status: "done",
            verdict: outcome.verdict,
            briefJson: JSON.stringify(outcome.brief),
            judgementJson: JSON.stringify(outcome.judgement),
            error: null,
            completedAt: new Date().toISOString(),
          }
        : {
            status: "failed",
            error: outcome.error,
            completedAt: new Date().toISOString(),
          },
    )
    .where(
      and(eq(companyResearch.tenantId, tenantId), eq(companyResearch.id, id)),
    );
}
