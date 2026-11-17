import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  extractEmployerFromUrl,
  isListingPage,
  isListingTitle,
  runBraveSearch,
} from "../src/run";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

/**
 * Brave web-search payload for "stage data science jobs Paris": the two
 * Indeed listing pages are what the live API returned in Nov 2026; the rest
 * are typical individual postings from ATSs and boards.
 */
const SEARCH_PAYLOAD = JSON.parse(
  readFileSync(
    join(FIXTURES_DIR, "web-search-stage-data-science.json"),
    "utf-8",
  ),
) as unknown;

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("extractEmployerFromUrl", () => {
  it("reads the company slug from ATS paths", () => {
    expect(
      extractEmployerFromUrl("https://jobs.lever.co/mistral/0d6c0a1e"),
    ).toBe("Mistral");
    expect(
      extractEmployerFromUrl("https://boards.greenhouse.io/datadog/jobs/1"),
    ).toBe("Datadog");
    expect(
      extractEmployerFromUrl("https://jobs.ashbyhq.com/eleven-labs/abc"),
    ).toBe("Eleven Labs");
    expect(
      extractEmployerFromUrl(
        "https://www.welcometothejungle.com/fr/companies/hugging-face/jobs/x",
      ),
    ).toBe("Hugging Face");
    expect(extractEmployerFromUrl("https://acme.teamtailor.com/jobs/1")).toBe(
      "Acme",
    );
  });

  it("skips generic and country subdomains instead of returning them", () => {
    expect(
      extractEmployerFromUrl("https://careers.withings.com/jobs/stage"),
    ).toBe("Withings");
    expect(extractEmployerFromUrl("https://jobs.example.co.uk/role/1")).toBe(
      "Example",
    );
  });

  it("returns undefined for job boards rather than the board's name", () => {
    expect(
      extractEmployerFromUrl("https://fr.indeed.com/viewjob?jk=1"),
    ).toBeUndefined();
    expect(
      extractEmployerFromUrl("https://www.linkedin.com/jobs/view/1"),
    ).toBeUndefined();
    expect(extractEmployerFromUrl("not a url")).toBeUndefined();
  });
});

describe("listing page detection", () => {
  it("flags aggregator search pages", () => {
    expect(
      isListingTitle(
        "Stage Data Scientist, Paris (75) : plus de 200 emplois | Indeed",
      ),
    ).toBe(true);
    expect(
      isListingTitle("2,000+ Data Science Intern jobs in France (95 new)"),
    ).toBe(true);
    expect(isListingTitle("Stage 2027 Data Science - 150 offres")).toBe(true);
    expect(isListingTitle("2 000 offres de stage")).toBe(true);
    expect(
      isListingPage("https://www.linkedin.com/jobs/search?keywords=ml", "x"),
    ).toBe(true);
  });

  it("flags localized LinkedIn listing pages (live result, Nov 2026)", () => {
    const title =
      "Offres d’emploi “575 Stage Data Scientist” - Paris, Île-de-France, France (26 nouvelles)";
    const url =
      "https://fr.linkedin.com/jobs/stage-data-scientist-emplois-paris-08-a8?trk=guest_job_details_jd_jserp_more_jobs_link";

    expect(isListingTitle(title)).toBe(true);
    expect(isListingPage(url, "Stage Data Scientist")).toBe(true);
    expect(
      isListingPage(
        "https://fr.linkedin.com/jobs/view/product-data-scientist-intern-at-criteo-4390810974",
        "Criteo hiring Product Data Scientist Intern in Paris | LinkedIn",
      ),
    ).toBe(false);
  });

  it("keeps individual postings that merely contain numbers", () => {
    expect(isListingTitle("Stage - Data Scientist (2 postes) - Withings")).toBe(
      false,
    );
    expect(
      isListingTitle("Job Application for Data Science Intern 2027 at Datadog"),
    ).toBe(false);
    expect(isListingTitle("Stage Data Scientist 6 mois - Paris")).toBe(false);
  });
});

describe("runBraveSearch", () => {
  it("maps postings with real employers and drops listing pages", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(SEARCH_PAYLOAD));

    const result = await runBraveSearch({
      apiKey: "test-key",
      searchTerms: ["stage data science"],
      locations: ["Paris"],
      maxJobsPerTerm: 20,
      fetchImpl: fetchMock,
    });

    expect(result.success).toBe(true);
    expect(
      result.jobs.map((job) => [job.employer, job.title, job.location]),
    ).toEqual([
      [
        "Criteo",
        "Product Data Scientist Intern",
        "Paris, Île-de-France, France",
      ],
      ["Mistral", "Mistral AI - Stage Machine Learning Engineer", undefined],
      [
        "Datadog",
        "Job Application for Data Science Intern 2027 at Datadog",
        undefined,
      ],
      ["Withings", "Stage - Data Scientist (2 postes) - Withings", undefined],
      [
        "Unknown Employer",
        "Stage Data Scientist F/H - Groupe BPCE - Paris (75)",
        undefined,
      ],
      ["Hugging Face", "Stage - ML Research - Hugging Face", undefined],
    ]);
    expect(result.jobs.map((job) => job.employer)).not.toContain("fr");
    const requestedUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(requestedUrl).toContain("q=stage+data+science+jobs+Paris");
  });

  it("surfaces an invalid API key as an error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 401));

    const result = await runBraveSearch({
      apiKey: "bad",
      searchTerms: ["stage data science"],
      fetchImpl: fetchMock,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/invalid or missing/);
  });
});
