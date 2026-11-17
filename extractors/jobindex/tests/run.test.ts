import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  buildJobindexSearchUrl,
  extractJobindexSearchResponse,
  extractJobindexStoreData,
  mapJobindexResult,
  resolveGeoareaIds,
  runJobindex,
} from "../src/run";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

/**
 * Trimmed copy of a real jobindex.dk search page (Nov 2026): the Stash is
 * wrapped in `//<![CDATA[ ... //]]>`, followed by another script, and the
 * result app lives under `jobsearch/result_app/list`. Stored as .txt so the
 * linter/formatter leaves the page's `\/` escapes and inline scripts intact.
 */
const CDATA_LIST_PAGE = readFileSync(
  join(FIXTURES_DIR, "search-page-cdata-list.html.txt"),
  "utf-8",
);

function createHtml(
  results: unknown[],
  totalPages = 1,
  extraStoreData: Record<string, unknown> = {},
): string {
  return `<script>
    var Stash = {"jobsearch/result_app":{"storeData":${JSON.stringify({
      ...extraStoreData,
      searchResponse: { results, total_pages: totalPages, page_size: 20 },
    })}}};
  </script>`;
}

function createResponse(html: string): Response {
  return {
    ok: true,
    status: 200,
    text: async () => html,
  } as Response;
}

describe("Jobindex Stash parsing", () => {
  it("extracts embedded storeData values beyond searchResponse", () => {
    const storeData = extractJobindexStoreData(
      createHtml([], 1, {
        geoareaOptions: [{ id: 74, text: "Odsherred", typeid: 30 }],
      }),
    );

    expect(storeData.geoareaOptions).toEqual([
      { id: 74, text: "Odsherred", typeid: 30 },
    ]);
  });

  it("extracts the embedded searchResponse payload", () => {
    const response = extractJobindexSearchResponse(
      createHtml([{ tid: "h1", headline: "Software Engineer" }], 2),
    );

    expect(response.total_pages).toBe(2);
    expect(response.results).toEqual([
      { tid: "h1", headline: "Software Engineer" },
    ]);
  });

  it("parses Stash payloads without relying on lf-only semicolon endings", () => {
    const html =
      '<script>var Stash = {"jobsearch/result_app":{"storeData":{"searchResponse":{"results":[{"tid":"h1"}],"total_pages":1}}}};</script>';

    const response = extractJobindexSearchResponse(html);

    expect(response.results).toEqual([{ tid: "h1" }]);
  });

  it("parses the CDATA-wrapped Stash published under jobsearch/result_app/list", () => {
    const response = extractJobindexSearchResponse(CDATA_LIST_PAGE);

    expect(response.total_pages).toBe(3);
    expect(Array.isArray(response.results)).toBe(true);
    const results = response.results as Array<{ tid?: string }>;
    expect(results.map((result) => result.tid)).toEqual([
      "h1715301",
      "h1715907",
    ]);
  });

  it("reads geoarea options from the renamed result app", () => {
    const storeData = extractJobindexStoreData(CDATA_LIST_PAGE);

    expect(storeData.geoareaOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 56, text: "København", typeid: 30 }),
      ]),
    );
  });

  it("ignores statements that follow the Stash object in the same script", () => {
    const html =
      '<script>var Stash = {"jobsearch/result_app":{"storeData":{"searchResponse":{"results":[{"tid":"h9","headline":"a } b"}],"total_pages":1}}}};\nvar Other = {"x":1};\n</script>';

    const response = extractJobindexSearchResponse(html);

    expect(response.results).toEqual([{ tid: "h9", headline: "a } b" }]);
  });

  it("reports a clear error when the Stash object is truncated", () => {
    expect(() =>
      extractJobindexStoreData(
        '<script>var Stash = {"jobsearch/result_app":{"storeData":{</script>',
      ),
    ).toThrow("Jobindex Stash JSON end was not found.");
  });

  it("reports a clear error when no result app carries storeData", () => {
    expect(() =>
      extractJobindexStoreData('<script>var Stash = {"common":{}};</script>'),
    ).toThrow("Jobindex storeData payload was not found.");
  });

  it("builds query-only search URLs and adds page after the first page", () => {
    expect(buildJobindexSearchUrl("software engineering", 1)).toBe(
      "https://www.jobindex.dk/jobsoegning?q=software+engineering",
    );
    expect(buildJobindexSearchUrl("software engineering", 2)).toBe(
      "https://www.jobindex.dk/jobsoegning?q=software+engineering&page=2",
    );
  });

  it("builds location-aware search URLs with repeated geoareaid filters", () => {
    expect(buildJobindexSearchUrl("software engineering", 1, [74, 56])).toBe(
      "https://www.jobindex.dk/jobsoegning?q=software+engineering&geoareaid=74&geoareaid=56",
    );
  });
});

describe("resolveGeoareaIds", () => {
  it("prefers kommune entries and matches diacritic-insensitively", () => {
    expect(
      resolveGeoareaIds(
        ["odsherred", "Kobenhavn"],
        [
          { id: 15182, text: "Storkobenhavn", typeid: 0 },
          { id: 56, text: "Kobenhavn", typeid: 30 },
          { id: 74, text: "Odsherred", typeid: 30 },
        ],
      ),
    ).toEqual([74, 56]);
  });

  it("matches common Danish transliterations", () => {
    expect(
      resolveGeoareaIds(
        ["Kobenhavn", "Sonderborg", "Aabenraa"],
        [
          { id: 56, text: "København", typeid: 30 },
          { id: 87, text: "Sønderborg", typeid: 30 },
          { id: 6, text: "Aabenraa", typeid: 30 },
        ],
      ),
    ).toEqual([56, 87, 6]);
  });
});

describe("mapJobindexResult", () => {
  it("maps Stash result rows into normalized jobs", () => {
    const mapped = mapJobindexResult({
      tid: "h1661330",
      headline: "Software Engineer",
      companytext: "Karnov Group Denmark A/S",
      share_url: "https://www.jobindex.dk/vis-job/h1661330",
      url: "https://www.jobindex.dk/c?t=h1661330&ctx=w",
      firstdate: "2026-05-01",
      lastdate: "2026-05-29",
      area: "Copenhagen",
      home_workplace: false,
      addresses: [
        {
          city: "Kobenhavn K",
          coordinates: { latitude: 55.68065234, longitude: 12.5703325 },
          simple_string: "Sankt Petri Passage 5, 1165 Kobenhavn K",
        },
      ],
      company: {
        homeurl: "https://www.karnovgroup.dk/",
        logo: "https://www.jobindex.dk/img/logo/karnov.gif",
        name: "Karnov Group Denmark A/S",
      },
      html: '<h4><a href="https://example.com/apply?x=1&amp;y=2">Software Engineer</a></h4><p>You&rsquo;ll build pipelines.</p>',
      rating: { ratings: 10, score: 4.5 },
    });

    expect(mapped).toEqual(
      expect.objectContaining({
        source: "jobindex",
        sourceJobId: "h1661330",
        title: "Software Engineer",
        employer: "Karnov Group Denmark A/S",
        jobUrl: "https://www.jobindex.dk/vis-job/h1661330",
        applicationLink: "https://example.com/apply?x=1&y=2",
        location: "Sankt Petri Passage 5, 1165 Kobenhavn K",
        datePosted: "2026-05-01",
        deadline: "2026-05-29",
        jobDescription: "You'll build pipelines.",
        companyRating: 4.5,
        companyReviewsCount: 10,
      }),
    );
    expect(mapped?.locationEvidence).toEqual(
      expect.objectContaining({
        country: "denmark",
        city: "Kobenhavn K",
        sourceNotes: ["coordinates:55.68065234,12.5703325"],
      }),
    );
  });
});

describe("runJobindex", () => {
  it("fetches Denmark query results and respects the per-term cap", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      createResponse(
        createHtml(
          [
            {
              tid: "h1",
              headline: "Backend Engineer",
              companytext: "Acme",
              share_url: "https://www.jobindex.dk/vis-job/h1",
            },
            {
              tid: "h2",
              headline: "Frontend Engineer",
              companytext: "Beta",
              share_url: "https://www.jobindex.dk/vis-job/h2",
            },
          ],
          2,
        ),
      ),
    );

    const result = await runJobindex({
      selectedCountry: "denmark",
      searchTerms: ["software engineering"],
      maxJobsPerTerm: 1,
      fetchImpl: fetchMock,
    });

    expect(result.success).toBe(true);
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]?.sourceJobId).toBe("h1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("resolves city locations into geoareaid filters", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createResponse(
          createHtml([], 1, {
            geoareaOptions: [{ id: 74, text: "Odsherred", typeid: 30 }],
          }),
        ),
      )
      .mockResolvedValueOnce(
        createResponse(
          createHtml([
            {
              tid: "h1",
              headline: "Backend Engineer",
              companytext: "Acme",
              share_url: "https://www.jobindex.dk/vis-job/h1",
            },
          ]),
        ),
      );

    const result = await runJobindex({
      selectedCountry: "denmark",
      searchTerms: ["software engineering"],
      cityLocations: ["Odsherred"],
      fetchImpl: fetchMock,
    });

    expect(result.success).toBe(true);
    expect(result.jobs).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://www.jobindex.dk/jobsoegning?q=software+engineering&geoareaid=74",
    );
  });

  it("returns mapped jobs from the current jobindex.dk page format", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createResponse(CDATA_LIST_PAGE));

    const result = await runJobindex({
      selectedCountry: "denmark",
      searchTerms: ["machine learning"],
      maxJobsPerTerm: 2,
      fetchImpl: fetchMock,
    });

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.jobs).toHaveLength(2);
    expect(result.jobs[0]).toEqual(
      expect.objectContaining({
        source: "jobindex",
        sourceJobId: "h1715301",
        employer: "DTU, Danmarks Tekniske Universitet",
        jobUrl: "https://www.jobindex.dk/vis-job/h1715301",
        location: "DTU Compute, Matematiktorvet 303B, 2800 Kongens Lyngby",
      }),
    );
    expect(result.jobs[0]?.title).toMatch(/machine learning/i);
    expect(result.jobs[0]?.applicationLink).toMatch(/^https:\/\//);
    expect(result.jobs[0]?.jobDescription).toMatch(/machine learning/i);
  });

  it("does not run outside Denmark", async () => {
    const fetchMock = vi.fn();

    const result = await runJobindex({
      selectedCountry: "united kingdom",
      searchTerms: ["software engineering"],
      fetchImpl: fetchMock,
    });

    expect(result.success).toBe(true);
    expect(result.jobs).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
