import { resolveSearchCities } from "@shared/search-cities.js";
import type {
  ExtractorManifest,
  ExtractorProgressEvent,
} from "@shared/types/extractors";
import { type BraveSearchProgressEvent, runBraveSearch } from "./src/run";

function toProgress(event: BraveSearchProgressEvent): ExtractorProgressEvent {
  if (event.type === "term_start") {
    return {
      phase: "list",
      termsProcessed: Math.max(event.termIndex - 1, 0),
      termsTotal: event.termTotal,
      currentUrl: event.searchTerm,
      detail: `Brave Search: searching "${event.searchTerm}" (${event.termIndex}/${event.termTotal})`,
    };
  }
  if (event.type === "rate_limit") {
    return {
      phase: "list",
      termsProcessed: event.termIndex,
      termsTotal: event.termTotal,
      detail: `Brave Search: RATE LIMIT — ${event.message}`,
    };
  }
  if (event.type === "api_error") {
    return {
      phase: "list",
      termsProcessed: event.termIndex,
      termsTotal: event.termTotal,
      detail: `Brave Search: ERROR ${event.status} — ${event.message}`,
    };
  }
  return {
    phase: "list",
    termsProcessed: event.termIndex,
    termsTotal: event.termTotal,
    detail: `Brave Search: done "${event.searchTerm}" — ${event.jobsFoundTerm} jobs found`,
  };
}

export const manifest: ExtractorManifest = {
  id: "bravesearch",
  displayName: "Brave Search",
  providesSources: ["bravesearch"],
  capabilities: { locationEvidence: false },
  requiredEnvVars: ["BRAVE_SEARCH_API_KEY"],
  async run(context) {
    if (context.shouldCancel?.()) return { success: true, jobs: [] };

    const apiKey = process.env.BRAVE_SEARCH_API_KEY ?? "";

    const maxJobsPerTerm = context.settings.jobspyResultsWanted
      ? parseInt(context.settings.jobspyResultsWanted, 10)
      : 20;

    const result = await runBraveSearch({
      apiKey,
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
