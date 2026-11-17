import type { PipelineProgressState, PipelineRun } from "@shared/types";
import { describe, expect, it } from "vitest";
import {
  describeLastRun,
  describeProgress,
  progressFraction,
} from "./pipeline-status";

function progress(
  overrides: Partial<PipelineProgressState>,
): PipelineProgressState {
  return {
    step: "crawling",
    message: "",
    crawlingSource: null,
    crawlingSourcesCompleted: 0,
    crawlingSourcesTotal: 0,
    crawlingTermsProcessed: 0,
    crawlingTermsTotal: 0,
    crawlingListPagesProcessed: 0,
    crawlingListPagesTotal: 0,
    crawlingJobCardsFound: 0,
    crawlingJobPagesEnqueued: 0,
    crawlingJobPagesSkipped: 0,
    crawlingJobPagesProcessed: 0,
    jobsDiscovered: 0,
    jobsScored: 0,
    jobsProcessed: 0,
    totalToProcess: 0,
    ...overrides,
  };
}

function run(overrides: Partial<PipelineRun>): PipelineRun {
  return {
    id: "run-1",
    startedAt: "2026-11-17T09:00:00Z",
    completedAt: "2026-11-17T09:11:00Z",
    status: "completed",
    jobsDiscovered: 54,
    jobsProcessed: 12,
    errorMessage: null,
    ...overrides,
  };
}

const NOW = Date.parse("2026-11-17T12:00:00Z");

describe("describeProgress", () => {
  it("names the source, term and totals while searching", () => {
    expect(
      describeProgress(
        progress({
          crawlingSource: "wttj",
          crawlingTermsProcessed: 2,
          crawlingTermsTotal: 18,
          crawlingSourcesCompleted: 1,
          crawlingSourcesTotal: 4,
          jobsDiscovered: 42,
        }),
      ),
    ).toBe("Welcome to the Jungle · term 3/18 · 1/4 sources done · 42 found");
  });

  it("shows scoring and tailoring counts", () => {
    expect(
      describeProgress(
        progress({ step: "scoring", jobsScored: 5, jobsDiscovered: 20 }),
      ),
    ).toBe("5/20 scored");
    expect(
      describeProgress(
        progress({
          step: "processing",
          jobsProcessed: 1,
          totalToProcess: 3,
          currentJob: { id: "j", title: "Data Steward", employer: "Acme" },
        }),
      ),
    ).toBe("1/3 done · Data Steward · Acme");
  });

  it("says which source needs a manual check", () => {
    expect(
      describeProgress(
        progress({
          step: "challenge_required",
          pendingChallenges: [
            { extractorId: "x", extractorName: "Indeed", url: "", sources: [] },
          ],
        }),
      ),
    ).toBe("Indeed asks for a check");
  });
});

describe("progressFraction", () => {
  it("follows the active step and is null when unknown", () => {
    expect(
      progressFraction(
        progress({ crawlingSourcesCompleted: 1, crawlingSourcesTotal: 4 }),
      ),
    ).toBe(0.25);
    expect(
      progressFraction(
        progress({ step: "scoring", jobsScored: 30, jobsDiscovered: 20 }),
      ),
    ).toBe(1);
    expect(progressFraction(progress({ step: "importing" }))).toBeNull();
    expect(progressFraction(progress({}))).toBeNull();
  });
});

describe("describeLastRun", () => {
  it("summarises completed, failed and cancelled runs", () => {
    expect(describeLastRun(run({}), NOW)).toBe(
      "Last run 3 hours ago · 54 found · 12 tailored",
    );
    expect(
      describeLastRun(
        run({ status: "failed", errorMessage: "No sources" }),
        NOW,
      ),
    ).toBe("Last run failed 3 hours ago · No sources");
    expect(describeLastRun(run({ status: "cancelled" }), NOW)).toBe(
      "Last run cancelled 3 hours ago · 54 found",
    );
  });
});
