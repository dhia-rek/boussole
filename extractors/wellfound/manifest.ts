import { resolveSearchCities } from "@shared/search-cities.js";
import type {
  ExtractorManifest,
  ExtractorProgressEvent,
} from "@shared/types/extractors";
import { runWellfound, type WellfoundProgressEvent } from "./src/run";

function toProgress(event: WellfoundProgressEvent): ExtractorProgressEvent {
  if (event.type === "term_start") {
    return {
      phase: "list",
      termsProcessed: Math.max(event.termIndex - 1, 0),
      termsTotal: event.termTotal,
      currentUrl: event.searchTerm,
      detail: `Wellfound: term ${event.termIndex}/${event.termTotal} (${event.searchTerm})`,
    };
  }
  return {
    phase: "list",
    termsProcessed: event.termIndex,
    termsTotal: event.termTotal,
    detail: `Wellfound: completed term ${event.termIndex}/${event.termTotal} (${event.jobsFoundTerm} jobs)`,
  };
}

export const manifest: ExtractorManifest = {
  id: "wellfound",
  displayName: "Wellfound",
  providesSources: ["wellfound"],
  capabilities: { locationEvidence: true },
  async run(context) {
    if (context.shouldCancel?.()) return { success: true, jobs: [] };

    const maxJobsPerTerm = context.settings.jobspyResultsWanted
      ? parseInt(context.settings.jobspyResultsWanted, 10)
      : 100;

    const result = await runWellfound({
      searchTerms: context.searchTerms,
      locations: resolveSearchCities({
        single:
          context.settings.searchCities ?? context.settings.jobspyLocation,
      }),
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
