import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { StartupJobRecord } from "startup-jobs-scraper";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("startup-jobs-scraper", () => ({
  scrapeStartupJobsViaAlgolia: vi.fn(),
}));

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function loadRecords(name: string): StartupJobRecord[] {
  return JSON.parse(
    readFileSync(join(FIXTURES_DIR, name), "utf-8"),
  ) as StartupJobRecord[];
}

describe("startup.jobs employer repair", () => {
  it("recognizes UI captions as placeholder employers", async () => {
    const { isPlaceholderEmployer } = await import("../src/run");

    expect(isPlaceholderEmployer("View company profile")).toBe(true);
    expect(isPlaceholderEmployer("  view   company profile ")).toBe(true);
    expect(isPlaceholderEmployer("Voir le profil de l'entreprise")).toBe(true);
    expect(isPlaceholderEmployer("Company profile")).toBe(true);
    expect(isPlaceholderEmployer("{{{company_name}}}")).toBe(true);
    expect(isPlaceholderEmployer("")).toBe(true);
    expect(isPlaceholderEmployer("Withings")).toBe(false);
    expect(isPlaceholderEmployer("Viewpoint Robotics")).toBe(false);
  });

  it("prefers the listing employer, then the company profile slug", async () => {
    const { repairStartupJobEmployers } = await import("../src/run");
    const enriched = loadRecords("enriched-records.json");

    const repaired = repairStartupJobEmployers(enriched, [
      loadRecords("listing-records.json")[0] as StartupJobRecord,
    ]);

    expect(repaired.map((record) => record.employer)).toEqual([
      "Withings",
      "Raidium",
      "Mirakl",
    ]);
  });
});

describe("runStartupJobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("falls back to the default max jobs per term when options.maxJobsPerTerm is NaN", async () => {
    const { scrapeStartupJobsViaAlgolia } = await import(
      "startup-jobs-scraper"
    );
    const scrapeMock = vi.mocked(scrapeStartupJobsViaAlgolia);
    scrapeMock.mockResolvedValueOnce([]);

    const { runStartupJobs } = await import("../src/run");

    await runStartupJobs({
      searchTerms: ["backend engineer"],
      maxJobsPerTerm: Number.NaN,
    });

    expect(scrapeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedCount: 50,
      }),
    );
  });

  it("drops broad location sentinels and falls back to selectedCountry behavior", async () => {
    const { scrapeStartupJobsViaAlgolia } = await import(
      "startup-jobs-scraper"
    );
    const scrapeMock = vi.mocked(scrapeStartupJobsViaAlgolia);
    scrapeMock.mockResolvedValueOnce([]);

    const { runStartupJobs } = await import("../src/run");

    await runStartupJobs({
      searchTerms: ["platform engineer"],
      selectedCountry: "worldwide",
      locations: ["Worldwide"],
    });

    expect(scrapeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        location: undefined,
      }),
    );
  });

  it("normalizes explicit city-country aliases before passing location to the scraper", async () => {
    const { scrapeStartupJobsViaAlgolia } = await import(
      "startup-jobs-scraper"
    );
    const scrapeMock = vi.mocked(scrapeStartupJobsViaAlgolia);
    scrapeMock.mockResolvedValueOnce([]);

    const { runStartupJobs } = await import("../src/run");

    await runStartupJobs({
      searchTerms: ["software engineer"],
      locations: ["UK"],
    });

    expect(scrapeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        location: "United Kingdom",
      }),
    );
  });

  it("passes workplaceType to the scraper", async () => {
    const { scrapeStartupJobsViaAlgolia } = await import(
      "startup-jobs-scraper"
    );
    const scrapeMock = vi.mocked(scrapeStartupJobsViaAlgolia);
    scrapeMock.mockResolvedValueOnce([]);

    const { runStartupJobs } = await import("../src/run");

    await runStartupJobs({
      searchTerms: ["software engineer"],
      workplaceTypes: ["remote", "hybrid"],
    });

    expect(scrapeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workplaceType: ["remote", "hybrid"],
      }),
    );
  });

  it("recovers real employer names when enrichment returns UI captions", async () => {
    const { scrapeStartupJobsViaAlgolia } = await import(
      "startup-jobs-scraper"
    );
    const scrapeMock = vi.mocked(scrapeStartupJobsViaAlgolia);
    scrapeMock
      .mockResolvedValueOnce(loadRecords("enriched-records.json"))
      .mockResolvedValueOnce(loadRecords("listing-records.json"));

    const { runStartupJobs } = await import("../src/run");

    const result = await runStartupJobs({
      searchTerms: ["machine learning intern"],
      selectedCountry: "france",
      maxJobsPerTerm: 3,
    });

    expect(result.success).toBe(true);
    expect(result.jobs.map((job) => job.employer)).toEqual([
      "Withings",
      "Raidium",
      "Mirakl",
    ]);
    // Detail-page data from the enriched pass is kept.
    expect(result.jobs[0]?.jobDescription).toContain("machine learning");
    expect(scrapeMock).toHaveBeenCalledTimes(2);
    expect(scrapeMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ enrichDetails: true, location: "France" }),
    );
    expect(scrapeMock.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        enrichDetails: false,
        query: "machine learning intern",
        requestedCount: 3,
        location: "France",
      }),
    );
  });

  it("skips the listing-only call when every employer is already valid", async () => {
    const { scrapeStartupJobsViaAlgolia } = await import(
      "startup-jobs-scraper"
    );
    const scrapeMock = vi.mocked(scrapeStartupJobsViaAlgolia);
    scrapeMock.mockResolvedValueOnce(loadRecords("listing-records.json"));

    const { runStartupJobs } = await import("../src/run");

    const result = await runStartupJobs({
      searchTerms: ["machine learning intern"],
    });

    expect(result.jobs.map((job) => job.employer)).toEqual([
      "Withings",
      "Raidium",
      "Mirakl",
    ]);
    expect(scrapeMock).toHaveBeenCalledTimes(1);
  });

  it("never emits a UI caption as employer when the listing call fails", async () => {
    const { scrapeStartupJobsViaAlgolia } = await import(
      "startup-jobs-scraper"
    );
    const scrapeMock = vi.mocked(scrapeStartupJobsViaAlgolia);
    scrapeMock
      .mockResolvedValueOnce(loadRecords("enriched-records.json"))
      .mockRejectedValueOnce(new Error("Algolia query failed: 503"));

    const { runStartupJobs } = await import("../src/run");

    const result = await runStartupJobs({
      searchTerms: ["machine learning intern"],
    });

    expect(result.success).toBe(true);
    expect(result.jobs.map((job) => job.employer)).toEqual([
      "Unknown Employer",
      "Raidium",
      "Mirakl",
    ]);
  });

  it("maps onsite workplaceType to the scraper's on-site value", async () => {
    const { scrapeStartupJobsViaAlgolia } = await import(
      "startup-jobs-scraper"
    );
    const scrapeMock = vi.mocked(scrapeStartupJobsViaAlgolia);
    scrapeMock.mockResolvedValueOnce([]);

    const { runStartupJobs } = await import("../src/run");

    await runStartupJobs({
      searchTerms: ["software engineer"],
      workplaceTypes: ["onsite"],
    });

    expect(scrapeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workplaceType: ["on-site"],
      }),
    );
  });
});
