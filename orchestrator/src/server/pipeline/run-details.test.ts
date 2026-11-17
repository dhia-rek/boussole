import { beforeEach, describe, expect, it, vi } from "vitest";
import { getEffectiveSettings } from "../services/settings";
import { buildPipelineRunSavedDetails } from "./run-details";

vi.mock("../services/settings", () => ({
  getEffectiveSettings: vi.fn(),
}));

function makeSettings() {
  return {
    jobspyCountryIndeed: {
      value: "france",
      default: "",
      override: null,
    },
    searchCities: { value: "Paris", default: "Paris", override: null },
    searchTerms: { value: ["backend engineer"], default: [], override: null },
    workplaceTypes: { value: ["hybrid"], default: [], override: null },
    locationSearchScope: {
      value: "selected_plus_remote_worldwide",
      default: "selected_only",
      override: null,
    },
    locationMatchStrictness: {
      value: "flexible",
      default: "exact_only",
      override: null,
    },
    blockedCompanyKeywords: {
      value: ["contractor"],
      default: [],
      override: null,
    },
    adzunaMaxJobsPerTerm: { value: 40, default: 50, override: 40 },
    startupjobsMaxJobsPerTerm: { value: 50, default: 50, override: null },
    jobspyResultsWanted: { value: 20, default: 20, override: null },
    autoSkipScoreThreshold: { value: 65, default: 65, override: null },
    model: { value: "opus:medium", default: "opus:medium", override: null },
    resumeProjects: {
      value: {
        maxProjects: 3,
        lockedProjectIds: ["locked-project"],
        aiSelectableProjectIds: ["project-a", "project-b"],
      },
      default: {
        maxProjects: 3,
        lockedProjectIds: [],
        aiSelectableProjectIds: [],
      },
      override: null,
    },
  } as const;
}

describe("buildPipelineRunSavedDetails", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getEffectiveSettings).mockResolvedValue(makeSettings() as never);
  });

  it("uses the request location intent instead of persisted settings", async () => {
    const savedDetails = await buildPipelineRunSavedDetails({
      topN: 5,
      minSuitabilityScore: 60,
      sources: ["glassdoor", "linkedin", "adzuna"],
      outputDir: "/tmp",
      locationIntent: {
        selectedCountry: "japan",
        country: "japan",
        cityLocations: ["Tokyo"],
        workplaceTypes: ["remote"],
        geoScope: "selected_only",
        searchScope: "selected_only",
        matchStrictness: "exact_only",
      },
    } as never);

    expect(savedDetails.effectiveConfig.country).toBe("japan");
    expect(savedDetails.effectiveConfig.countryLabel).toBe("Japan");
    expect(savedDetails.effectiveConfig.searchCities).toEqual(["Tokyo"]);
    expect(savedDetails.effectiveConfig.workplaceTypes).toEqual(["remote"]);
    expect(savedDetails.effectiveConfig.locationSearchScope).toBe(
      "selected_only",
    );
    expect(savedDetails.effectiveConfig.locationMatchStrictness).toBe(
      "exact_only",
    );
    expect(savedDetails.effectiveConfig.compatibleSources).toEqual([
      "linkedin",
    ]);
    expect(savedDetails.effectiveConfig.skippedSources).toEqual([
      expect.objectContaining({
        source: "glassdoor",
        reason: expect.stringContaining("Japan is not supported"),
      }),
      expect.objectContaining({
        source: "adzuna",
      }),
    ]);
  });

  it("falls back to the saved French search when the request has no location", async () => {
    const savedDetails = await buildPipelineRunSavedDetails({
      topN: 5,
      minSuitabilityScore: 60,
      sources: ["wttj", "companyats", "linkedin", "indeed", "glassdoor"],
      outputDir: "/tmp",
    } as never);

    expect(savedDetails.requestedConfig).toEqual({
      topN: 5,
      minSuitabilityScore: 60,
      sources: ["wttj", "companyats", "linkedin", "indeed", "glassdoor"],
      enableCrawling: true,
      enableScoring: true,
      enableImporting: true,
      enableAutoTailoring: true,
    });
    expect(savedDetails.effectiveConfig).toMatchObject({
      country: "france",
      countryLabel: "France",
      searchCities: ["Paris"],
      searchTermsCount: 1,
      workplaceTypes: ["hybrid"],
      compatibleSources: [
        "wttj",
        "companyats",
        "linkedin",
        "indeed",
        "glassdoor",
      ],
      skippedSources: [],
      blockedCompanyKeywordsCount: 1,
      autoSkipScoreThreshold: 65,
    });
  });

  it("records the source limits and the single Claude model", async () => {
    const savedDetails = await buildPipelineRunSavedDetails({
      topN: 5,
      minSuitabilityScore: 60,
      sources: ["adzuna"],
      outputDir: "/tmp",
    } as never);

    expect(savedDetails.effectiveConfig.sourceLimits).toEqual({
      adzunaMaxJobsPerTerm: 40,
      startupjobsMaxJobsPerTerm: 50,
      jobspyResultsWanted: 20,
    });
    expect(savedDetails.effectiveConfig.model).toBe("opus:medium");
    expect(savedDetails.effectiveConfig.resumeProjects).toEqual({
      maxProjects: 3,
      lockedProjectCount: 1,
      aiSelectableProjectCount: 2,
    });
    expect(savedDetails.resultSummary).toEqual({
      stage: "started",
      jobsScored: null,
      jobsSelected: null,
      sourceErrors: [],
    });
  });
});
