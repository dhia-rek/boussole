import type {
  ExtractorManifest,
  ExtractorProgressEvent,
} from "@shared/types/extractors";
import { runWTTJ, type WTTJProgressEvent } from "./src/run";

function toProgress(event: WTTJProgressEvent): ExtractorProgressEvent {
  if (event.type === "term_start") {
    return {
      phase: "list",
      termsProcessed: Math.max(event.termIndex - 1, 0),
      termsTotal: event.termTotal,
      currentUrl: event.searchTerm,
      detail: `WTTJ: term ${event.termIndex}/${event.termTotal} (${event.searchTerm})`,
    };
  }
  if (event.type === "page_fetched") {
    return {
      phase: "list",
      termsProcessed: Math.max(event.termIndex - 1, 0),
      termsTotal: event.termTotal,
      listPagesProcessed: event.pageNo,
      jobPagesEnqueued: event.totalCollected,
      jobPagesProcessed: event.totalCollected,
      currentUrl: `page ${event.pageNo}`,
      detail: `WTTJ: term ${event.termIndex}/${event.termTotal}, page ${event.pageNo} (${event.totalCollected} collected)`,
    };
  }
  return {
    phase: "list",
    termsProcessed: event.termIndex,
    termsTotal: event.termTotal,
    detail: `WTTJ: completed term ${event.termIndex}/${event.termTotal} (${event.jobsFoundTerm} jobs)`,
  };
}

export const manifest: ExtractorManifest = {
  id: "wttj",
  displayName: "Welcome to the Jungle",
  providesSources: ["wttj"],
  capabilities: { locationEvidence: true },
  async run(context) {
    if (context.shouldCancel?.()) return { success: true, jobs: [] };

    const maxJobsPerTerm = context.settings.jobspyResultsWanted
      ? parseInt(context.settings.jobspyResultsWanted, 10)
      : 100;

    const result = await runWTTJ({
      searchTerms: context.searchTerms,
      country: context.selectedCountry,
      maxJobsPerTerm,
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
