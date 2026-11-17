import type {
  ExtractorManifest,
  ExtractorProgressEvent,
} from "@shared/types/extractors";
import { runWTTJ, type WTTJProgressEvent } from "./src/run";

function toProgress(event: WTTJProgressEvent): ExtractorProgressEvent {
  switch (event.type) {
    case "sitemap_progress":
      return {
        phase: "list",
        listPagesProcessed: event.filesDone,
        listPagesTotal: event.filesTotal,
        jobCardsFound: event.listingsFound,
        detail: `WTTJ: reading the job index ${event.filesDone}/${event.filesTotal} (${event.listingsFound} offers listed)`,
      };
    case "term_start":
      return {
        phase: "job",
        termsProcessed: Math.max(event.termIndex - 1, 0),
        termsTotal: event.termTotal,
        currentUrl: event.searchTerm,
        detail: `WTTJ: term ${event.termIndex}/${event.termTotal} (${event.searchTerm}): ${event.matches} matching offers`,
      };
    case "job_fetched":
      return {
        phase: "job",
        termsProcessed: Math.max(event.termIndex - 1, 0),
        termsTotal: event.termTotal,
        currentUrl: event.searchTerm,
        jobPagesEnqueued: event.total,
        jobPagesProcessed: event.processed,
        detail: `WTTJ: term ${event.termIndex}/${event.termTotal}, ${event.processed}/${event.total} offers checked (${event.collected} kept)`,
      };
    case "term_complete":
      return {
        phase: "job",
        termsProcessed: event.termIndex,
        termsTotal: event.termTotal,
        detail: `WTTJ: completed term ${event.termIndex}/${event.termTotal} (${event.jobsFoundTerm} jobs)`,
      };
  }
}

export const manifest: ExtractorManifest = {
  id: "wttj",
  displayName: "Welcome to the Jungle",
  providesSources: ["wttj"],
  capabilities: { locationEvidence: true },
  async run(context) {
    if (context.shouldCancel?.()) return { success: true, jobs: [] };

    // Same per-term cap as the other sources; runWTTJ falls back to its own
    // default when the setting is empty or not a positive number.
    const maxJobsPerTerm = Number.parseInt(
      context.settings.jobspyResultsWanted ?? "",
      10,
    );

    const result = await runWTTJ({
      searchTerms: context.searchTerms,
      country: context.selectedCountry,
      maxJobsPerTerm: Number.isFinite(maxJobsPerTerm)
        ? maxJobsPerTerm
        : undefined,
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
