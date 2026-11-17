import { gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import {
  buildTermMatcher,
  listingMatchesTerm,
  mentionsInternship,
  parseJobListingsSitemap,
  parseSitemapIndex,
  resolveCountryCode,
  runWTTJ,
  tokenize,
  WTTJ_SITEMAP_INDEX_URL,
} from "../src/run";

const SITE = "https://www.welcometothejungle.com";
const API = "https://api.welcometothejungle.com/api/v1";

type Entry = { org: string; slug: string; lang?: string; lastmod?: string };
type Route = () => Response;

function listingUrl(entry: Entry): string {
  return `${SITE}/${entry.lang ?? "fr"}/companies/${entry.org}/jobs/${entry.slug}`;
}

function detailUrl(entry: Entry): string {
  return `${API}/organizations/${entry.org}/jobs/${entry.slug}`;
}

function sitemapIndexXml(files: string[]): string {
  const locs = [
    ...files.map((file) => `${SITE}/sitemaps/${file}`),
    `${SITE}/sitemaps/articles.0.xml.gz`,
    "https://other.example.com/sitemaps/job-listings.9.xml.gz",
  ];
  return `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs
    .map((loc) => `<sitemap><loc>${loc}</loc></sitemap>`)
    .join("")}</sitemapindex>`;
}

function urlsetXml(entries: Entry[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries
    .map(
      (entry) =>
        `<url><loc>${listingUrl(entry)}</loc>${
          entry.lastmod ? `<lastmod>${entry.lastmod}</lastmod>` : ""
        }<changefreq>daily</changefreq><priority>1.0</priority></url>`,
    )
    .join("")}</urlset>`;
}

const gz =
  (text: string): Route =>
  () =>
    new Response(new Uint8Array(gzipSync(text)));
const plain =
  (text: string): Route =>
  () =>
    new Response(text);
const json =
  (body: unknown, status = 200): Route =>
  () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
const failWith =
  (status: number): Route =>
  () =>
    new Response("error", { status });

function jobDetail(overrides: Record<string, unknown> = {}) {
  return {
    job: {
      name: "Data Quality Analyst (F/H)",
      reference: "ACME_abc123",
      language: "fr",
      contract_type: "full_time",
      remote: "partial",
      experience_level: "LESS_THAN_1_YEAR",
      published_at: "2026-11-15T09:00:00Z",
      archived_at: null,
      apply_url: "https://jobs.acme.example/apply/123",
      description:
        "<p>Vous garantissez la qualité des données.</p><ul><li>Contrôles</li><li>Dictionnaire de données</li></ul>",
      profile: "<p>Python &amp; SQL</p>",
      recruitment_process: null,
      key_missions: ["Ignored when a description exists"],
      salary_min: 42000,
      salary_max: 50000,
      salary_currency: "eur",
      salary_period: "yearly",
      office: {
        city: "Paris",
        country_code: "FR",
        address: "1 rue X, 75002 Paris, France",
      },
      offices: [],
      organization: {
        name: "Acme",
        media_website_url: "https://acme.example",
        description: "<p>Acme builds things.</p>",
        industry: "SaaS",
        nb_employees: 120,
      },
      ...overrides,
    },
  };
}

/** Sitemap files alternate between gzip (as WTTJ serves them) and plain XML. */
function buildRoutes(
  files: Record<string, Entry[]>,
  details: Array<[Entry, Route]>,
): Map<string, Route> {
  const routes = new Map<string, Route>();
  const names = Object.keys(files);
  routes.set(WTTJ_SITEMAP_INDEX_URL, gz(sitemapIndexXml(names)));
  for (const [index, name] of names.entries()) {
    const xml = urlsetXml(files[name] ?? []);
    routes.set(
      `${SITE}/sitemaps/${name}`,
      index % 2 === 0 ? gz(xml) : plain(xml),
    );
  }
  for (const [entry, route] of details) routes.set(detailUrl(entry), route);
  return routes;
}

function createFetch(routes: Map<string, Route>) {
  return vi.fn(async (input: string | URL | Request) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const route = routes.get(url);
    return route ? route() : new Response("missing", { status: 404 });
  });
}

function requestedUrls(fetchMock: ReturnType<typeof createFetch>): string[] {
  return fetchMock.mock.calls.map(([input]) => String(input));
}

const DQ_PARIS: Entry = {
  org: "acme",
  slug: "data-quality-analyst-f-h_paris_ACME_abc123",
  lastmod: "2026-11-16T04:00:00+00:00",
};
const DQ_STAGE: Entry = {
  org: "acme",
  slug: "stage-data-quality-f-h_paris_ACME_def456",
  lastmod: "2026-11-16T05:00:00+00:00",
};
const QD_LYON: Entry = {
  org: "beta",
  slug: "analyste-qualite-des-donnees-h-f_lyon_BETA_x1",
  lastmod: "2026-11-10T04:00:00+00:00",
};
const BAKER: Entry = {
  org: "boulangerie",
  slug: "boulanger-h-f_lyon",
  lastmod: "2026-11-16T06:00:00+00:00",
};

describe("WTTJ sitemap parsing", () => {
  it("keeps only job-listings sitemaps hosted by WTTJ", () => {
    expect(
      parseSitemapIndex(
        sitemapIndexXml(["job-listings.0.xml.gz", "job-listings.1.xml.gz"]),
      ),
    ).toEqual([
      `${SITE}/sitemaps/job-listings.0.xml.gz`,
      `${SITE}/sitemaps/job-listings.1.xml.gz`,
    ]);
  });

  it("parses offers with title words, language and last modification", () => {
    const xml = `${urlsetXml([DQ_PARIS, { org: "x", slug: "uuid-only-slug", lang: "en" }])}<url><loc>${SITE}/fr/companies/acme/jobs/data?query=1</loc></url><url><loc>${SITE}/fr/companies/acme</loc></url>`;
    const listings = parseJobListingsSitemap(xml);
    expect(listings).toHaveLength(2);
    expect(listings[0]).toMatchObject({
      url: listingUrl(DQ_PARIS),
      language: "fr",
      orgSlug: "acme",
      jobSlug: DQ_PARIS.slug,
      titleText: "data quality analyst f h",
      lastModified: Date.parse("2026-11-16T04:00:00+00:00"),
    });
    expect(listings[1]).toMatchObject({ language: "en", lastModified: 0 });
  });
});

describe("WTTJ search-term matching", () => {
  const titleOf = (text: string) => ({ titleTokens: new Set(tokenize(text)) });
  const matches = (term: string, title: string) => {
    const matcher = buildTermMatcher(term);
    return matcher ? listingMatchesTerm(titleOf(title), matcher) : false;
  };

  it("needs every word of the term, in any order, accents and plurals folded", () => {
    expect(matches("Data Quality", "senior data quality analyst")).toBe(true);
    expect(matches("Data Quality", "data engineer")).toBe(false);
    expect(
      matches("Qualité des données", "analyste qualite des donnees h f"),
    ).toBe(true);
    expect(matches("Agents IA", "developpeur agent ia")).toBe(true);
  });

  it("treats AI / IA / spelled-out forms and ML as equivalent", () => {
    expect(
      matches("Ingénieur IA", "ingenieur intelligence artificielle h f"),
    ).toBe(true);
    expect(matches("Generative AI", "ingenieur ia generative")).toBe(true);
    expect(matches("ML Engineer", "machine learning engineer")).toBe(true);
  });

  it("ignores terms made only of stop words", () => {
    expect(buildTermMatcher("de la")).toBeNull();
  });

  it("recognises internship and apprenticeship wording", () => {
    expect(mentionsInternship("Stage IA")).toBe(true);
    expect(mentionsInternship("Stagiaire data")).toBe(true);
    expect(mentionsInternship("Alternance data analyst")).toBe(true);
    expect(mentionsInternship("Machine Learning Intern")).toBe(true);
    expect(mentionsInternship("Data Steward")).toBe(false);
    expect(mentionsInternship("Ingénieur IA")).toBe(false);
  });

  it("maps supported countries to ISO codes", () => {
    expect(resolveCountryCode("france")).toBe("FR");
    expect(resolveCountryCode("United Kingdom")).toBe("GB");
    expect(resolveCountryCode("Atlantis")).toBeUndefined();
    expect(resolveCountryCode(undefined)).toBeUndefined();
  });
});

describe("runWTTJ", () => {
  it("matches terms against sitemap titles and maps the full offers", async () => {
    const fetchMock = createFetch(
      buildRoutes(
        {
          "job-listings.0.xml.gz": [DQ_PARIS, DQ_STAGE, BAKER],
          "job-listings.1.xml.gz": [QD_LYON],
        },
        [
          [DQ_PARIS, json(jobDetail())],
          [
            QD_LYON,
            json(
              jobDetail({
                name: "Analyste qualité des données",
                reference: "BETA_x1",
                remote: "fulltime",
                office: { city: "Lyon", country_code: "FR" },
                salary_min: null,
                salary_max: null,
                organization: { name: "Beta" },
              }),
            ),
          ],
        ],
      ),
    );

    const result = await runWTTJ({
      searchTerms: ["Data Quality", "Qualité des données"],
      country: "france",
      delayMs: 0,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(result).toMatchObject({ success: true });
    expect(result.jobs.map((job) => job.title)).toEqual([
      "Data Quality Analyst (F/H)",
      "Analyste qualité des données",
    ]);
    const [first, second] = result.jobs;
    expect(first).toMatchObject({
      source: "wttj",
      sourceJobId: "ACME_abc123",
      employer: "Acme",
      employerUrl: "https://acme.example",
      jobUrl: listingUrl(DQ_PARIS),
      jobUrlDirect: "https://jobs.acme.example/apply/123",
      location: "Paris, France",
      isRemote: false,
      jobType: "Full-time permanent (CDI)",
      jobLevel: "less than 1 year",
      datePosted: "2026-11-15T09:00:00Z",
      salary: "42000–50000 EUR / year",
      salaryMinAmount: 42000,
      salaryMaxAmount: 50000,
      salaryCurrency: "EUR",
      salaryInterval: "yearly",
      companyIndustry: "SaaS",
      companyNumEmployees: "120",
      companyDescription: "Acme builds things.",
    });
    expect(first?.jobDescription).toContain(
      "Vous garantissez la qualité des données.",
    );
    expect(first?.jobDescription).toContain("- Dictionnaire de données");
    expect(first?.jobDescription).toContain("Profil recherché\nPython & SQL");
    expect(first?.jobDescription).not.toContain("Ignored when");
    expect(second).toMatchObject({
      employer: "Beta",
      employerUrl: `${SITE}/fr/companies/beta`,
      location: "Lyon, France",
      isRemote: true,
    });
    expect(second?.salary).toBeUndefined();

    const urls = requestedUrls(fetchMock);
    expect(urls).not.toContain(detailUrl(DQ_STAGE));
    expect(urls).not.toContain(detailUrl(BAKER));
  });

  it("keeps internships when a search term asks for them", async () => {
    const fetchMock = createFetch(
      buildRoutes({ "job-listings.0.xml.gz": [DQ_PARIS, DQ_STAGE] }, [
        [
          DQ_STAGE,
          json(
            jobDetail({
              name: "Stage Data Quality",
              contract_type: "internship",
            }),
          ),
        ],
        [DQ_PARIS, json(jobDetail())],
      ]),
    );

    const result = await runWTTJ({
      searchTerms: ["Stage Data Quality"],
      delayMs: 0,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(result.jobs.map((job) => job.title)).toEqual(["Stage Data Quality"]);
    expect(result.jobs[0]?.jobType).toBe("Internship (stage)");
  });

  it("skips internship contracts, archived or expired offers and on-site offers abroad", async () => {
    const entry = (id: string, day: number): Entry => ({
      org: "acme",
      slug: `data-quality-lead_paris_ACME_${id}`,
      lastmod: `2026-11-${String(day).padStart(2, "0")}T00:00:00+00:00`,
    });
    const internship = entry("intern", 16);
    const archived = entry("archived", 15);
    const expired = entry("expired", 14);
    const abroad = entry("abroad", 13);
    const remoteAbroad = entry("remote", 12);
    const multiOffice = entry("multi", 11);

    const fetchMock = createFetch(
      buildRoutes(
        {
          "job-listings.0.xml.gz": [
            internship,
            archived,
            expired,
            abroad,
            remoteAbroad,
            multiOffice,
          ],
        },
        [
          [
            internship,
            json(
              jobDetail({ reference: "intern", contract_type: "internship" }),
            ),
          ],
          [
            archived,
            json(
              jobDetail({
                reference: "archived",
                archived_at: "2026-11-15T00:00:00Z",
              }),
            ),
          ],
          [
            abroad,
            json(
              jobDetail({
                reference: "abroad",
                office: { city: "London", country_code: "GB" },
              }),
            ),
          ],
          [
            remoteAbroad,
            json(
              jobDetail({
                reference: "remote",
                remote: "fulltime",
                office: { city: "London", country_code: "GB" },
              }),
            ),
          ],
          [
            multiOffice,
            json(
              jobDetail({
                reference: "multi",
                office: { city: "Berlin", country_code: "DE" },
                offices: [{ city: "Paris", country_code: "FR" }],
              }),
            ),
          ],
        ],
      ),
    );

    const result = await runWTTJ({
      searchTerms: ["Data Quality"],
      country: "france",
      delayMs: 0,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(result.success).toBe(true);
    expect(result.jobs.map((job) => job.sourceJobId)).toEqual([
      "remote",
      "multi",
    ]);
    expect(result.jobs[0]).toMatchObject({
      location: "London, United Kingdom",
      isRemote: true,
    });
    expect(result.jobs[1]?.location).toBe("Paris, France");
  });

  it("requests the newest matches first, caps each term and never requests an offer twice", async () => {
    const entries = [1, 2, 3, 4, 5].map((n) => ({
      org: "acme",
      slug: `ai-engineer_paris_ACME_${n}`,
      lastmod: `2026-11-0${n}T00:00:00+00:00`,
    }));
    const fetchMock = createFetch(
      buildRoutes(
        { "job-listings.0.xml.gz": entries },
        entries.map((entry, index) => [
          entry,
          json(
            jobDetail({
              name: `AI Engineer ${index + 1}`,
              reference: `ai-${index + 1}`,
            }),
          ),
        ]),
      ),
    );

    const result = await runWTTJ({
      searchTerms: ["AI Engineer", "Engineer AI"],
      maxJobsPerTerm: 2,
      delayMs: 0,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(result.jobs.map((job) => job.sourceJobId)).toEqual([
      "ai-5",
      "ai-4",
      "ai-3",
      "ai-2",
    ]);
    const detailCalls = requestedUrls(fetchMock).filter((url) =>
      url.startsWith(API),
    );
    expect(detailCalls).toHaveLength(4);
    expect(new Set(detailCalls).size).toBe(4);
  });

  it("stops requesting offers once the per-run budget is spent", async () => {
    const entries = [1, 2, 3].map((n) => ({
      org: "acme",
      slug: `data-quality-analyst_paris_ACME_${n}`,
    }));
    const fetchMock = createFetch(
      buildRoutes(
        { "job-listings.0.xml.gz": entries },
        entries.map((entry, index) => [
          entry,
          json(jobDetail({ reference: `dq-${index}` })),
        ]),
      ),
    );

    const result = await runWTTJ({
      searchTerms: ["Data Quality"],
      maxDetailRequests: 1,
      delayMs: 0,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(result.jobs).toHaveLength(1);
    expect(
      requestedUrls(fetchMock).filter((url) => url.startsWith(API)),
    ).toHaveLength(1);
  });

  it("returns partial results when only some offers fail to load", async () => {
    const failing: Entry = {
      org: "acme",
      slug: "data-quality-analyst_paris_ACME_9",
      lastmod: "2026-11-17T00:00:00+00:00",
    };
    const fetchMock = createFetch(
      buildRoutes({ "job-listings.0.xml.gz": [failing, DQ_PARIS] }, [
        [failing, failWith(500)],
        [DQ_PARIS, json(jobDetail())],
      ]),
    );

    const result = await runWTTJ({
      searchTerms: ["Data Quality"],
      delayMs: 0,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(result.success).toBe(true);
    expect(result.jobs.map((job) => job.sourceJobId)).toEqual(["ACME_abc123"]);
  });

  it("fails with a clear error when every offer request fails", async () => {
    const fetchMock = createFetch(
      buildRoutes({ "job-listings.0.xml.gz": [DQ_PARIS] }, [
        [DQ_PARIS, failWith(500)],
      ]),
    );

    const result = await runWTTJ({
      searchTerms: ["Data Quality"],
      delayMs: 0,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("job details could not be fetched");
    expect(result.error).toContain("HTTP 500");
  });

  it("fails with a clear error when the sitemap index is unavailable", async () => {
    const routes = new Map<string, Route>([
      [WTTJ_SITEMAP_INDEX_URL, failWith(503)],
    ]);
    const result = await runWTTJ({
      searchTerms: ["Data Quality"],
      delayMs: 0,
      fetchImpl: createFetch(routes) as unknown as typeof fetch,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("sitemap index returned HTTP 503");
  });

  it("fails with a clear error when the index lists no job sitemaps", async () => {
    const routes = new Map<string, Route>([
      [WTTJ_SITEMAP_INDEX_URL, plain(sitemapIndexXml([]))],
    ]);
    const result = await runWTTJ({
      searchTerms: ["Data Quality"],
      delayMs: 0,
      fetchImpl: createFetch(routes) as unknown as typeof fetch,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("lists no job-listings sitemaps");
  });

  it("fails with a clear error when no job sitemap can be read", async () => {
    const routes = new Map<string, Route>([
      [
        WTTJ_SITEMAP_INDEX_URL,
        plain(sitemapIndexXml(["job-listings.0.xml.gz"])),
      ],
      [`${SITE}/sitemaps/job-listings.0.xml.gz`, failWith(500)],
    ]);
    const result = await runWTTJ({
      searchTerms: ["Data Quality"],
      delayMs: 0,
      fetchImpl: createFetch(routes) as unknown as typeof fetch,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("could not be read");
  });

  it("makes no request when cancelled or without search terms", async () => {
    const fetchMock = createFetch(new Map());
    await expect(
      runWTTJ({
        searchTerms: ["Data Quality"],
        shouldCancel: () => true,
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
    ).resolves.toEqual({ success: true, jobs: [] });
    await expect(
      runWTTJ({
        searchTerms: ["  "],
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
    ).resolves.toEqual({ success: true, jobs: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
