import type {
  ExtractorManifest,
  ExtractorProgressEvent,
} from "@shared/types/extractors";
import { runWWR, type WWRProgressEvent } from "./src/run";

function toProgress(event: WWRProgressEvent): ExtractorProgressEvent {
  if (event.type === "category_start") {
    return {
      phase: "list",
      termsProcessed: event.categoryIndex - 1,
      termsTotal: event.categoryTotal,
      currentUrl: event.category,
      detail: `We Work Remotely: category ${event.categoryIndex}/${event.categoryTotal} (${event.category})`,
    };
  }
  return {
    phase: "list",
    termsProcessed: event.categoryIndex,
    termsTotal: event.categoryTotal,
    jobPagesProcessed: event.jobs,
    detail: `We Work Remotely: done category ${event.categoryIndex}/${event.categoryTotal} (${event.jobs} jobs)`,
  };
}

export const manifest: ExtractorManifest = {
  id: "weworkremotely",
  displayName: "We Work Remotely",
  providesSources: ["weworkremotely"],
  capabilities: { locationEvidence: false },
  async run(context) {
    if (context.shouldCancel?.()) return { success: true, jobs: [] };

    const maxJobs = context.settings.jobspyResultsWanted
      ? parseInt(context.settings.jobspyResultsWanted, 10)
      : 200;

    const result = await runWWR({
      searchTerms: context.searchTerms,
      maxJobsPerTerm: maxJobs,
      onProgress: (event) => {
        if (context.shouldCancel?.()) return;
        context.onProgress?.(toProgress(event));
      },
      shouldCancel: context.shouldCancel,
    });

    return result;
  },
};

export default manifest;
