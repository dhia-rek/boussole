import type {
  ExtractorManifest,
  ExtractorProgressEvent,
} from "@shared/types/extractors";
import { type RemoteCoProgressEvent, runRemoteCo } from "./src/run";

function toProgress(event: RemoteCoProgressEvent): ExtractorProgressEvent {
  if (event.type === "term_start") {
    return {
      phase: "list",
      termsProcessed: Math.max(event.termIndex - 1, 0),
      termsTotal: event.termTotal,
      currentUrl: event.searchTerm,
      detail: `Remote.co: term ${event.termIndex}/${event.termTotal} (${event.searchTerm})`,
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
      detail: `Remote.co: term ${event.termIndex}/${event.termTotal}, page ${event.pageNo} (${event.totalCollected} found)`,
    };
  }
  return {
    phase: "list",
    termsProcessed: event.termIndex,
    termsTotal: event.termTotal,
    detail: `Remote.co: completed term ${event.termIndex}/${event.termTotal} (${event.jobsFoundTerm} jobs)`,
  };
}

export const manifest: ExtractorManifest = {
  id: "remoteco",
  displayName: "Remote.co",
  providesSources: ["remoteco"],
  capabilities: { locationEvidence: false },
  async run(context) {
    if (context.shouldCancel?.()) return { success: true, jobs: [] };

    const maxJobsPerTerm = context.settings.jobspyResultsWanted
      ? parseInt(context.settings.jobspyResultsWanted, 10)
      : 100;

    const result = await runRemoteCo({
      searchTerms: context.searchTerms,
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
