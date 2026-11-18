/**
 * Guided mode: from the workspace's state, decide the one most useful thing
 * to do now, then a few after it. Pure and deterministic; the data comes
 * from ./index.ts.
 */
import { isKeywordEstimate } from "@shared/scoring";
import {
  type ApplicationStage,
  FRESH_JOB_DAYS,
  GUIDED_APPLY_STEP_LABELS,
  GUIDED_APPLY_STEPS,
  type GuidedApplyStep,
  type GuideStep,
  type JobStatus,
  STAGE_LABELS,
} from "@shared/types";

export const MAX_STEPS = 4;
export const SEARCH_STALE_DAYS = 7;
export const FOLLOW_UP_AFTER_DAYS = 7;
/** After a month without an answer, a follow-up rarely helps. */
export const FOLLOW_UP_UNTIL_DAYS = 30;
export const GOOD_MATCH_SCORE = 60;
export const MAX_RECALCULATE = 100;
/** A started application untouched this long is treated as abandoned. */
export const ABANDONED_AFTER_DAYS = 14;
/** Opens the search window (same link as "Run pipeline" elsewhere). */
export const RUN_SEARCH_PATH = "/jobs/ready?run=automatic";

const DAY_MS = 86_400_000;
const INTERVIEW_STAGES = new Set<ApplicationStage>([
  "recruiter_screen",
  "assessment",
  "hiring_manager_screen",
  "technical_interview",
  "onsite",
]);

export const FOLLOW_UP_PROMPT =
  "Write a short, polite follow-up email about my application to this job, in the language of the job posting. Mention when I applied, restate my interest in one sentence, and ask whether they need anything else from me.";

export interface GuideJob {
  id: string;
  title: string;
  employer: string;
  status: JobStatus;
  score: number | null;
  reason: string | null;
  discoveredAt: string;
  updatedAt: string;
  appliedAt: string | null;
  /** Latest application stage. */
  latestStage: ApplicationStage | null;
  /** When the latest timeline event happened (ISO), if any. */
  lastEventAt: string | null;
  /** A follow-up was logged with "I've sent it". */
  followedUp: boolean;
  prep: { cvCheck: boolean; research: boolean; message: boolean };
  /** Latest CV check, research or Ghostwriter message (ISO), if any. */
  lastPrepAt: string | null;
}

export interface GuideInput {
  hasCv: boolean;
  searchRunning: boolean;
  /** When the last search that finished started. */
  lastSearchAt: string | null;
  /** A newer search that failed, was cancelled or was cut off. */
  unfinishedSearchAt: string | null;
  jobs: GuideJob[];
}

const daysBetween = (from: string, now: Date) =>
  Math.floor((now.getTime() - Date.parse(from)) / DAY_MS);

function agoText(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days >= 60) return `${Math.round(days / 30)} months ago`;
  return `${days} days ago`;
}

const isFresh = (job: GuideJob, now: Date) =>
  daysBetween(job.discoveredAt, now) <= FRESH_JOB_DAYS;

const isOpen = (job: GuideJob) =>
  job.status === "discovered" || job.status === "ready";

const hasPrep = (job: GuideJob) =>
  job.prep.cvCheck || job.prep.research || job.prep.message;

/** The first guided step this job still needs (the job step is just reading). */
export function nextApplyStep(job: Pick<GuideJob, "prep">): GuidedApplyStep {
  if (!job.prep.cvCheck) return "cv";
  if (!job.prep.research) return "company";
  if (!job.prep.message) return "message";
  return "send";
}

const stepNumber = (step: GuidedApplyStep) =>
  GUIDED_APPLY_STEPS.indexOf(step) + 1;

/** Fresh, AI-scored, good matches nobody has started on, best first. */
export function chooseCandidates(jobs: GuideJob[], now: Date): GuideJob[] {
  return jobs
    .filter(
      (job) =>
        isOpen(job) &&
        !hasPrep(job) &&
        job.score !== null &&
        job.score >= GOOD_MATCH_SCORE &&
        !isKeywordEstimate(job.reason) &&
        isFresh(job, now),
    )
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

export function computeNextSteps(input: GuideInput, now: Date): GuideStep[] {
  const steps: GuideStep[] = [];

  if (!input.hasCv) {
    steps.push({
      kind: "add_cv",
      title: "Add your CV",
      detail:
        "Everything else (match scores, tailored CVs, letters) starts from your CV.",
      cta: { label: "Add my CV", href: "/design-resume" },
    });
  }

  for (const job of input.jobs
    .filter(
      (job) =>
        job.status === "in_progress" &&
        job.latestStage !== null &&
        INTERVIEW_STAGES.has(job.latestStage),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
    const stage = job.latestStage as ApplicationStage;
    steps.push({
      kind: "prepare_interview",
      title: `Prepare your ${STAGE_LABELS[stage].toLowerCase()} with ${job.employer}`,
      detail:
        "Practice with a mock interview built from this job and your CV, then read its feedback.",
      cta: { label: "Practice now", href: `/interview/${job.id}` },
      jobId: job.id,
    });
  }

  for (const job of input.jobs
    .filter((job) => {
      if (job.status !== "applied" || !job.appliedAt || job.followedUp) {
        return false;
      }
      const days = daysBetween(job.appliedAt, now);
      const quietDays = job.lastEventAt
        ? Math.min(days, daysBetween(job.lastEventAt, now))
        : days;
      return quietDays >= FOLLOW_UP_AFTER_DAYS && days <= FOLLOW_UP_UNTIL_DAYS;
    })
    .sort((a, b) => (a.appliedAt ?? "").localeCompare(b.appliedAt ?? ""))) {
    const days = daysBetween(job.appliedAt as string, now);
    steps.push({
      kind: "follow_up",
      title: `Follow up with ${job.employer}`,
      detail: `You applied to "${job.title}" ${days} days ago and haven't heard back. A short, polite follow-up often gets a reply.`,
      cta: {
        label: "Write the follow-up",
        href: `/job/${job.id}/ghostwriter?prompt=${encodeURIComponent(FOLLOW_UP_PROMPT)}`,
      },
      secondary: { label: "I've sent it", action: "log_follow_up" },
      jobId: job.id,
    });
  }

  for (const job of input.jobs
    .filter(
      (job) =>
        isOpen(job) &&
        hasPrep(job) &&
        job.lastPrepAt !== null &&
        daysBetween(job.lastPrepAt, now) < ABANDONED_AFTER_DAYS,
    )
    .sort((a, b) => (b.lastPrepAt ?? "").localeCompare(a.lastPrepAt ?? ""))) {
    const next = nextApplyStep(job);
    steps.push({
      kind: "continue_application",
      title: `Finish your application to ${job.employer}`,
      detail: `${job.title}. Next: ${GUIDED_APPLY_STEP_LABELS[next].toLowerCase()} (step ${stepNumber(next)} of ${GUIDED_APPLY_STEPS.length}).`,
      cta: { label: "Continue", href: `/apply/${job.id}?step=${next}` },
      jobId: job.id,
    });
  }

  if (input.searchRunning) {
    steps.push({
      kind: "search_running",
      title: "Your job search is running",
      detail: "New jobs show up in Jobs as they are found and scored.",
      cta: { label: "Watch it", href: "/jobs/discovered" },
    });
  } else {
    const days = input.lastSearchAt
      ? daysBetween(input.lastSearchAt, now)
      : null;
    const unfinished = input.unfinishedSearchAt
      ? `Your last search (${agoText(daysBetween(input.unfinishedSearchAt, now))}) didn't finish. `
      : "";
    if (days === null || days >= SEARCH_STALE_DAYS || unfinished) {
      steps.push({
        kind: "find_jobs",
        title: unfinished ? "Run your search again" : "Find new jobs",
        detail:
          days === null
            ? `${unfinished}Boussole searches the job sites with your search terms and scores every job for you.`
            : `${unfinished}Your last complete search was ${agoText(days)}. New postings appear every day, and older ones close.`,
        cta: { label: "Search now", href: RUN_SEARCH_PATH },
      });
    }
  }

  // Older postings are mostly closed: not worth an AI call each.
  const estimated = input.jobs
    .filter(
      (job) =>
        isOpen(job) && isKeywordEstimate(job.reason) && isFresh(job, now),
    )
    .sort((a, b) =>
      a.status === b.status ? 0 : a.status === "ready" ? -1 : 1,
    );
  if (estimated.length > 0) {
    steps.push({
      kind: "recalculate_scores",
      title: `Recalculate ${estimated.length} match ${estimated.length === 1 ? "score" : "scores"}`,
      detail:
        "These jobs only have a keyword estimate, not a real AI score, so their order in your list can't be trusted.",
      cta: {
        label: "Recalculate now",
        action: "recalculate",
        jobIds: estimated.slice(0, MAX_RECALCULATE).map((job) => job.id),
      },
    });
  }

  const candidates = chooseCandidates(input.jobs, now);
  const best = candidates[0];
  if (best) {
    steps.push({
      kind: "choose_job",
      title: "Choose your next application",
      detail: `${candidates.length} good ${candidates.length === 1 ? "match" : "matches"} from your recent searches. Best: ${best.title} at ${best.employer} (${best.score}).`,
      cta: { label: "Review them", href: "/review" },
    });
  }

  if (steps.length === 0) {
    steps.push({
      kind: "caught_up",
      title: "You're all caught up",
      detail:
        "Nothing urgent. Search again in a few days, or look at your applications.",
      cta: { label: "See applications", href: "/applications/in-progress" },
    });
  }

  return steps.slice(0, MAX_STEPS);
}
