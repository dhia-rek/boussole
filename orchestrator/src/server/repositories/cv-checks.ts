/** CV checks, one per job (the latest run), scoped to the active workspace. */
import { randomUUID } from "node:crypto";
import type { AiProvider, CvCheckResult } from "@shared/types";
import { and, eq } from "drizzle-orm";
import { db, schema } from "../db/index";
import type { CvCheckRow } from "../db/schema";
import { getActiveTenantId } from "../tenancy/context";

const { cvChecks } = schema;

export type StoredCvCheck = Omit<import("@shared/types").CvCheck, "cvChanged">;

function mapRow(row: CvCheckRow): StoredCvCheck {
  let result: CvCheckResult | null = null;
  if (row.resultJson) {
    try {
      result = JSON.parse(row.resultJson) as CvCheckResult;
    } catch {
      result = null;
    }
  }
  return {
    id: row.id,
    jobId: row.jobId,
    status: row.status,
    provider: row.provider as AiProvider,
    model: row.model ?? null,
    cvId: row.cvId ?? null,
    cvTitle: row.cvTitle ?? null,
    cvLanguage: row.cvLanguage ?? null,
    cvRevision: row.cvRevision ?? null,
    result,
    error: row.error ?? null,
    startedAt: row.startedAt,
    completedAt: row.completedAt ?? null,
  };
}

export async function getCvCheck(jobId: string): Promise<StoredCvCheck | null> {
  const tenantId = getActiveTenantId();
  const [row] = await db
    .select()
    .from(cvChecks)
    .where(and(eq(cvChecks.tenantId, tenantId), eq(cvChecks.jobId, jobId)));
  return row ? mapRow(row) : null;
}

/**
 * Marks the job's check as running under a new run id. The previous result
 * (and the CV it was made from) stays until the new run succeeds.
 */
export async function startCvCheckRow(input: {
  jobId: string;
  provider: AiProvider;
  model: string | null;
}): Promise<StoredCvCheck> {
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
    .insert(cvChecks)
    .values({ ...fields, tenantId, jobId: input.jobId })
    .onConflictDoUpdate({
      target: [cvChecks.tenantId, cvChecks.jobId],
      set: fields,
    });
  const saved = await getCvCheck(input.jobId);
  if (!saved) throw new Error("Failed to save CV check");
  return saved;
}

export type CheckedCv = {
  cvId: string;
  cvTitle: string;
  cvLanguage: string | null;
  cvRevision: number;
};

/** Saves the outcome of run `id`; ignored if a newer run replaced it. */
export async function finishCvCheckRow(
  id: string,
  outcome:
    | { status: "done"; result: CvCheckResult; cv: CheckedCv }
    | { status: "failed"; error: string },
): Promise<void> {
  const tenantId = getActiveTenantId();
  await db
    .update(cvChecks)
    .set(
      outcome.status === "done"
        ? {
            status: "done",
            resultJson: JSON.stringify(outcome.result),
            ...outcome.cv,
            error: null,
            completedAt: new Date().toISOString(),
          }
        : {
            status: "failed",
            error: outcome.error,
            completedAt: new Date().toISOString(),
          },
    )
    .where(and(eq(cvChecks.tenantId, tenantId), eq(cvChecks.id, id)));
}
