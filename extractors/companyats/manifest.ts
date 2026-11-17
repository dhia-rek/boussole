import type {
  ExtractorManifest,
  ExtractorProgressEvent,
} from "@shared/types/extractors";
import {
  type CompanyAtsProgressEvent,
  runCompanyAts,
  searchTermsWantInternships,
} from "./src/run";

function toProgress(event: CompanyAtsProgressEvent): ExtractorProgressEvent {
  const boardNote = event.boardError
    ? ` — board unavailable (${event.boardError})`
    : "";
  return {
    phase: "list",
    termsProcessed: event.companyIndex,
    termsTotal: event.companyTotal,
    jobPagesProcessed: event.collected,
    currentUrl: event.companyName,
    detail: `Company ATS: ${event.companyIndex}/${event.companyTotal} (${event.companyName}) — ${event.collected} matching roles${boardNote}`,
  };
}

export const manifest: ExtractorManifest = {
  id: "companyats",
  displayName: "Company Career Pages",
  providesSources: ["companyats"],
  capabilities: { locationEvidence: false },
  async run(context) {
    if (context.shouldCancel?.()) {
      return { success: true, jobs: [] };
    }

    const searchTerms = context.searchTerms ?? [];
    // Same run budget as the other sources, applied per company here.
    const maxJobsPerCompany = Number.parseInt(
      context.settings.jobspyResultsWanted ?? "",
      10,
    );

    try {
      const result = await runCompanyAts({
        searchTerms,
        country: context.selectedCountry,
        internshipsOnly: searchTermsWantInternships(searchTerms),
        maxJobsPerCompany:
          Number.isFinite(maxJobsPerCompany) && maxJobsPerCompany > 0
            ? maxJobsPerCompany
            : undefined,
        shouldCancel: context.shouldCancel,
        onProgress: (event) => {
          if (context.shouldCancel?.()) return;
          context.onProgress?.(toProgress(event));
        },
      });
      if (result.failedBoards.length > 0 && !context.shouldCancel?.()) {
        context.onProgress?.({
          phase: "list",
          detail: `Company ATS: ${result.failedBoards.length} board(s) unavailable — ${result.failedBoards
            .map((board) => `${board.company} (${board.reason})`)
            .join(", ")}`,
        });
      }
      return { success: true, jobs: result.jobs };
    } catch (error) {
      return {
        success: false,
        jobs: [],
        error:
          error instanceof Error
            ? error.message
            : "Unexpected error while running the Company ATS extractor.",
      };
    }
  },
};

export default manifest;
