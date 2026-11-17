import { formatRelativeTime } from "@client/lib/relative-time";
import { isExtractorSourceId, sourceLabel } from "@shared/extractors";
import type {
  PipelineProgressState,
  PipelineProgressStep,
  PipelineRun,
} from "@shared/types";

/** Opens the run dialog on the jobs page (see OrchestratorPage). */
export const RUN_PIPELINE_PATH = "/jobs/ready?run=automatic";

export const STEP_LABELS: Partial<Record<PipelineProgressStep, string>> = {
  crawling: "Searching job boards",
  challenge_required: "Waiting for you: security check",
  importing: "Saving new jobs",
  scoring: "Scoring jobs",
  processing: "Tailoring CVs",
};

export const RUN_STATUS_LABELS: Record<PipelineRun["status"], string> = {
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

export const RUN_STATUS_DOT: Record<PipelineRun["status"], string> = {
  running: "bg-primary",
  completed: "bg-emerald-500",
  failed: "bg-red-500",
  cancelled: "bg-muted-foreground/60",
};

export function displaySource(source: string | null | undefined): string {
  if (!source) return "";
  return isExtractorSourceId(source) ? sourceLabel(source) : source;
}

/** One line describing what an active run is doing. */
export function describeProgress(progress: PipelineProgressState): string {
  const parts: string[] = [];
  switch (progress.step) {
    case "crawling": {
      const source = displaySource(progress.crawlingSource);
      if (source) parts.push(source);
      if (progress.crawlingTermsTotal > 0) {
        const term = Math.min(
          progress.crawlingTermsProcessed + 1,
          progress.crawlingTermsTotal,
        );
        parts.push(`term ${term}/${progress.crawlingTermsTotal}`);
      }
      if (progress.crawlingSourcesTotal > 0) {
        parts.push(
          `${progress.crawlingSourcesCompleted}/${progress.crawlingSourcesTotal} sources done`,
        );
      }
      parts.push(`${progress.jobsDiscovered} found`);
      break;
    }
    case "challenge_required": {
      const names = (progress.pendingChallenges ?? []).map(
        (challenge) => challenge.extractorName,
      );
      parts.push(
        names.length > 0
          ? `${names.join(", ")} asks for a check`
          : "a source asks for a check",
      );
      break;
    }
    case "importing":
      parts.push(`${progress.jobsDiscovered} found`);
      break;
    case "scoring":
      parts.push(`${progress.jobsScored}/${progress.jobsDiscovered} scored`);
      break;
    case "processing":
      parts.push(`${progress.jobsProcessed}/${progress.totalToProcess} done`);
      if (progress.currentJob) {
        parts.push(
          `${progress.currentJob.title} · ${progress.currentJob.employer}`,
        );
      }
      break;
    default:
      break;
  }
  return parts.join(" · ");
}

/** Share of the current step that is done, or null when unknown. */
export function progressFraction(
  progress: PipelineProgressState,
): number | null {
  const ratio = (done: number, total: number) =>
    total > 0 ? Math.min(1, Math.max(0, done / total)) : null;
  switch (progress.step) {
    case "crawling":
      return ratio(
        progress.crawlingSourcesCompleted,
        progress.crawlingSourcesTotal,
      );
    case "scoring":
      return ratio(progress.jobsScored, progress.jobsDiscovered);
    case "processing":
      return ratio(progress.jobsProcessed, progress.totalToProcess);
    default:
      return null;
  }
}

/** "Last run 3 hours ago · 54 found · 12 tailored" (or failed/cancelled wording). */
export function describeLastRun(run: PipelineRun, now = Date.now()): string {
  const when = formatRelativeTime(run.completedAt ?? run.startedAt, now);
  switch (run.status) {
    case "failed":
      return run.errorMessage
        ? `Last run failed ${when} · ${run.errorMessage}`
        : `Last run failed ${when}`;
    case "cancelled":
      return `Last run cancelled ${when} · ${run.jobsDiscovered} found`;
    case "running":
      return `Run started ${when}`;
    default:
      return `Last run ${when} · ${run.jobsDiscovered} found · ${run.jobsProcessed} tailored`;
  }
}
