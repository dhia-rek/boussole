/**
 * Guided mode data: the workspace's jobs, how far each application got, the
 * last search, and whether a CV exists. Always scoped to the active
 * workspace.
 */
import { notFound } from "@infra/errors";
import { db, schema } from "@server/db/index";
import { getPipelineStatus } from "@server/pipeline/index";
import * as pipelineRepo from "@server/repositories/pipeline";
import { getActiveTenantId } from "@server/tenancy/context";
import {
  type ApplicationStage,
  FOLLOW_UP_REASON_CODE,
  type GuideApplyProgress,
  type GuideNextSteps,
  type GuideReviewItem,
  type JobStatus,
  type StageEventMetadata,
} from "@shared/types";
import { and, eq, inArray, max } from "drizzle-orm";
import { getCurrentDesignResumeOrNullOnLegacy } from "../design-resume";
import {
  chooseCandidates,
  computeNextSteps,
  type GuideInput,
  type GuideJob,
  nextApplyStep,
} from "./next-steps";

const GUIDE_STATUSES: JobStatus[] = [
  "discovered",
  "ready",
  "applied",
  "in_progress",
];
const REVIEW_LIMIT = 50;

/** ISO string from an ISO or SQLite "YYYY-MM-DD HH:MM:SS" (UTC) timestamp. */
export function toIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
  const time = Date.parse(normalized);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

function latest(...values: Array<string | null | undefined>): string | null {
  let result: string | null = null;
  for (const value of values) {
    const iso = toIso(value);
    if (iso && (!result || iso > result)) result = iso;
  }
  return result;
}

function roleSummaryOf(jobBrief: string | null): string | null {
  if (!jobBrief) return null;
  try {
    const parsed = JSON.parse(jobBrief) as { role_summary?: unknown };
    return typeof parsed.role_summary === "string" && parsed.role_summary.trim()
      ? parsed.role_summary.trim()
      : null;
  } catch {
    return null;
  }
}

async function loadGuideJobs(): Promise<
  Array<GuideJob & { location: string | null; jobBrief: string | null }>
> {
  const tenantId = getActiveTenantId();
  const { jobs, companyResearch, cvChecks, jobChatMessages, stageEvents } =
    schema;
  const rows = await db
    .select({
      id: jobs.id,
      title: jobs.title,
      employer: jobs.employer,
      status: jobs.status,
      score: jobs.suitabilityScore,
      reason: jobs.suitabilityReason,
      discoveredAt: jobs.discoveredAt,
      updatedAt: jobs.updatedAt,
      appliedAt: jobs.appliedAt,
      location: jobs.location,
      jobBrief: jobs.jobBrief,
    })
    .from(jobs)
    .where(
      and(eq(jobs.tenantId, tenantId), inArray(jobs.status, GUIDE_STATUSES)),
    );

  const [researched, checked, messaged, events] = await Promise.all([
    db
      .select({ jobId: companyResearch.jobId, at: companyResearch.completedAt })
      .from(companyResearch)
      .where(
        and(
          eq(companyResearch.tenantId, tenantId),
          eq(companyResearch.status, "done"),
        ),
      ),
    db
      .select({ jobId: cvChecks.jobId, at: cvChecks.completedAt })
      .from(cvChecks)
      .where(and(eq(cvChecks.tenantId, tenantId), eq(cvChecks.status, "done"))),
    db
      .select({
        jobId: jobChatMessages.jobId,
        at: max(jobChatMessages.createdAt),
      })
      .from(jobChatMessages)
      .where(eq(jobChatMessages.tenantId, tenantId))
      .groupBy(jobChatMessages.jobId),
    db
      .select({
        jobId: stageEvents.applicationId,
        toStage: stageEvents.toStage,
        occurredAt: stageEvents.occurredAt,
        metadata: stageEvents.metadata,
      })
      .from(stageEvents)
      .where(eq(stageEvents.tenantId, tenantId)),
  ]);

  const toMap = (list: Array<{ jobId: string; at: string | null }>) => {
    const map = new Map<string, string | null>();
    for (const row of list)
      map.set(row.jobId, latest(map.get(row.jobId), row.at));
    return map;
  };
  const researchedAt = toMap(researched);
  const checkedAt = toMap(checked);
  const messagedAt = toMap(messaged);
  const latestStage = new Map<
    string,
    { stage: ApplicationStage; at: number }
  >();
  const followedUp = new Set<string>();
  for (const event of events) {
    const current = latestStage.get(event.jobId);
    if (!current || event.occurredAt >= current.at) {
      latestStage.set(event.jobId, {
        stage: event.toStage as ApplicationStage,
        at: event.occurredAt,
      });
    }
    const metadata = event.metadata as StageEventMetadata | null;
    if (metadata?.reasonCode === FOLLOW_UP_REASON_CODE) {
      followedUp.add(event.jobId);
    }
  }

  return rows.map((row) => {
    const stage = latestStage.get(row.id);
    return {
      id: row.id,
      title: row.title,
      employer: row.employer,
      status: row.status as JobStatus,
      score: row.score ?? null,
      reason: row.reason ?? null,
      discoveredAt: row.discoveredAt,
      updatedAt: row.updatedAt,
      appliedAt: row.appliedAt ?? null,
      latestStage: stage?.stage ?? null,
      lastEventAt: stage ? new Date(stage.at * 1000).toISOString() : null,
      followedUp: followedUp.has(row.id),
      prep: {
        cvCheck: checkedAt.has(row.id),
        research: researchedAt.has(row.id),
        message: messagedAt.has(row.id),
      },
      lastPrepAt: latest(
        checkedAt.get(row.id),
        researchedAt.get(row.id),
        messagedAt.get(row.id),
      ),
      location: row.location ?? null,
      jobBrief: row.jobBrief ?? null,
    };
  });
}

export async function loadGuideInput(): Promise<GuideInput> {
  const [jobs, cv, lastCompleted, latest] = await Promise.all([
    loadGuideJobs(),
    getCurrentDesignResumeOrNullOnLegacy(),
    pipelineRepo.getLatestCompletedPipelineRun(),
    pipelineRepo.getLatestPipelineRun(),
  ]);
  const searchRunning = getPipelineStatus().isRunning;
  const unfinished =
    !searchRunning &&
    latest &&
    latest.status !== "completed" &&
    latest.status !== "running" &&
    latest.id !== lastCompleted?.id
      ? latest
      : null;
  return {
    hasCv: Boolean(cv),
    searchRunning,
    lastSearchAt: toIso(lastCompleted?.startedAt) ?? null,
    unfinishedSearchAt: toIso(unfinished?.startedAt) ?? null,
    jobs,
  };
}

export async function getNextSteps(now = new Date()): Promise<GuideNextSteps> {
  return { steps: computeNextSteps(await loadGuideInput(), now) };
}

/** Good, fresh, untouched matches to choose from, one at a time. */
export async function getReviewQueue(
  now = new Date(),
): Promise<GuideReviewItem[]> {
  const jobs = await loadGuideJobs();
  const byId = new Map(jobs.map((job) => [job.id, job]));
  return chooseCandidates(jobs, now)
    .slice(0, REVIEW_LIMIT)
    .map((job) => {
      const full = byId.get(job.id);
      return {
        id: job.id,
        title: job.title,
        employer: job.employer,
        location: full?.location ?? null,
        score: job.score ?? 0,
        reason: job.reason,
        roleSummary: roleSummaryOf(full?.jobBrief ?? null),
        status: job.status as "discovered" | "ready",
        discoveredAt: job.discoveredAt,
      };
    });
}

/** Which guided steps one job already went through. */
export async function getApplyProgress(
  jobId: string,
): Promise<GuideApplyProgress> {
  const tenantId = getActiveTenantId();
  const { jobs, companyResearch, cvChecks, jobChatMessages } = schema;
  const [job] = await db
    .select({ id: jobs.id, status: jobs.status })
    .from(jobs)
    .where(and(eq(jobs.tenantId, tenantId), eq(jobs.id, jobId)))
    .limit(1);
  if (!job) throw notFound("Job not found");

  const [research, check, message] = await Promise.all([
    db
      .select({ id: companyResearch.jobId })
      .from(companyResearch)
      .where(
        and(
          eq(companyResearch.tenantId, tenantId),
          eq(companyResearch.jobId, jobId),
          eq(companyResearch.status, "done"),
        ),
      )
      .limit(1),
    db
      .select({ id: cvChecks.jobId })
      .from(cvChecks)
      .where(
        and(
          eq(cvChecks.tenantId, tenantId),
          eq(cvChecks.jobId, jobId),
          eq(cvChecks.status, "done"),
        ),
      )
      .limit(1),
    db
      .select({ id: jobChatMessages.id })
      .from(jobChatMessages)
      .where(
        and(
          eq(jobChatMessages.tenantId, tenantId),
          eq(jobChatMessages.jobId, jobId),
        ),
      )
      .limit(1),
  ]);
  const prep = {
    cvCheck: check.length > 0,
    research: research.length > 0,
    message: message.length > 0,
  };
  return {
    jobId,
    done: { cv: prep.cvCheck, company: prep.research, message: prep.message },
    applied: job.status === "applied" || job.status === "in_progress",
    nextStep: nextApplyStep({ prep }),
  };
}
