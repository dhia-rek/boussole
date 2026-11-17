import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AtsCompany } from "../src/companies";
import {
  createRoleRanker,
  mentionsInternship,
  resolveCountryCode,
  runCompanyAts,
  SMARTRECRUITERS_MAX_DETAILS,
  stripHtml,
} from "../src/run";

// The manifest runs against the default company list: keep it to two boards
// so manifest tests stay fast and only hit routes defined below.
vi.mock("../src/companies", () => ({
  ATS_COMPANIES: [
    { name: "Hugging Face", ats: "workable", slug: "huggingface" },
    { name: "Devoteam", ats: "smartrecruiters", slug: "Devoteam" },
  ],
}));

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), "utf-8"));
}

/** Greenhouse board payload: `content` is entity-escaped HTML (real format). */
const GREENHOUSE_BOARD = loadFixture("greenhouse-board.json");
/** Lever postings payload (mode=json). */
const LEVER_POSTINGS = loadFixture("lever-postings.json");
/** Trimmed copy of Alan's real Ashby job board (Nov 2026). */
const ASHBY_BOARD = loadFixture("ashby-alan.json");

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

/** Routes each ATS API URL to its fixture; anything else is a 404. */
function createAtsFetch() {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.startsWith("https://boards-api.greenhouse.io/v1/boards/datadog/")) {
      return jsonResponse(GREENHOUSE_BOARD);
    }
    if (url.startsWith("https://api.lever.co/v0/postings/contentsquare")) {
      return jsonResponse(LEVER_POSTINGS);
    }
    if (url === "https://api.ashbyhq.com/posting-api/job-board/alan") {
      return jsonResponse(ASHBY_BOARD);
    }
    return jsonResponse({ error: "Not Found" }, 404);
  });
}

const COMPANIES: AtsCompany[] = [
  { name: "Datadog", ats: "greenhouse", slug: "datadog" },
  { name: "Mistral AI", ats: "lever", slug: "mistral" },
  { name: "Contentsquare", ats: "lever", slug: "contentsquare" },
  { name: "Alan", ats: "ashby", slug: "alan" },
];

describe("stripHtml", () => {
  it("decodes Greenhouse's entity-escaped markup before stripping tags", () => {
    const text = stripHtml(
      "&lt;p&gt;&lt;strong&gt;The Role&lt;/strong&gt;&lt;/p&gt;\n&lt;p&gt;&amp;nbsp;&lt;/p&gt;\n&lt;p&gt;Build R&amp;amp;D models.&amp;nbsp;&lt;/p&gt;",
    );

    expect(text).toBe("The Role\n\nBuild R&D models.");
  });

  it("still handles plain HTML", () => {
    expect(stripHtml("<div>Hello <b>world</b></div>")).toBe("Hello world");
  });
});

describe("runCompanyAts", () => {
  it("collects AI roles from Greenhouse, Lever and Ashby boards", async () => {
    const fetchMock = createAtsFetch();

    const result = await runCompanyAts({
      companies: COMPANIES,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(result.success).toBe(true);
    expect(result.jobs.map((job) => [job.employer, job.title])).toEqual([
      ["Datadog", "Machine Learning Engineer Intern"],
      ["Contentsquare", "Data Scientist Intern"],
      ["Alan", "Data Associate - Internship (6 months, flexible start)"],
      ["Alan", "Founding engineer- Mo team (AI Health Companion)"],
    ]);

    const greenhouseJob = result.jobs[0];
    expect(greenhouseJob?.jobDescription).toBe(
      "The Role\n\nJoin our Machine Learning team as an intern & build anomaly detection models.",
    );
    expect(greenhouseJob?.datePosted).toBe("2026-11-02T09:00:00-05:00");

    const ashbyIntern = result.jobs[2];
    expect(ashbyIntern).toEqual(
      expect.objectContaining({
        source: "companyats",
        location: "Paris, France",
        jobType: "Internship",
        jobUrl: expect.stringMatching(/^https:\/\/jobs\.ashbyhq\.com\/alan\//),
        applicationLink: expect.stringMatching(/\/application$/),
      }),
    );
    // Unlisted Ashby postings are skipped even when they match.
    expect(result.jobs.map((job) => job.title)).not.toContain(
      "Machine Learning Intern (unlisted)",
    );
  });

  it("reports dead boards instead of silently returning nothing for them", async () => {
    const fetchMock = createAtsFetch();
    const progress: Array<{ companyName: string; boardError?: string }> = [];

    const result = await runCompanyAts({
      companies: COMPANIES,
      fetchImpl: fetchMock as unknown as typeof fetch,
      onProgress: (event) => progress.push(event),
    });

    expect(result.failedBoards).toEqual([
      { company: "Mistral AI", ats: "lever", reason: "HTTP 404" },
    ]);
    expect(
      progress.find((event) => event.companyName === "Mistral AI"),
    ).toEqual(expect.objectContaining({ boardError: "HTTP 404" }));
  });

  it("fails loudly when every board is unavailable", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, 503));

    await expect(
      runCompanyAts({
        companies: COMPANIES,
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toThrow(
      /All 4 company job boards failed to load: Datadog \(HTTP 503\)/,
    );
  });
});

describe("companyats manifest", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a clear error when no board can be read", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("getaddrinfo ENOTFOUND");
      }),
    );
    const { manifest } = await import("../manifest");

    const result = await manifest.run({
      source: "companyats",
      selectedSources: ["companyats"],
      settings: {},
      searchTerms: ["machine learning intern"],
      selectedCountry: "france",
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/company job boards failed to load/);
    expect(result.error).toMatch(/ENOTFOUND/);
  });
});

describe("internship-focused searches", () => {
  it("recognizes internship-type titles across languages", async () => {
    const { isInternshipTitle } = await import("../src/run");
    for (const title of [
      "Machine Learning Intern",
      "Data Science Internship (6 months)",
      "Stage - Data Scientist (H/F)",
      "Stagiaire IA",
      "Alternance Data Engineer",
      "Werkstudent Machine Learning",
      "AI Industrial Placement",
      "Graduate AI Engineer",
    ]) {
      expect(isInternshipTitle(title)).toBe(true);
    }
    for (const title of [
      "Senior Machine Learning Engineer",
      "Staff Data Scientist",
      "Internal Tools Engineer",
    ]) {
      expect(isInternshipTitle(title)).toBe(false);
    }
  });

  it("only filters when every search term asks for an internship", async () => {
    const { searchTermsWantInternships } = await import("../src/run");
    expect(
      searchTermsWantInternships(["Stage IA", "Machine Learning Intern"]),
    ).toBe(true);
    expect(
      searchTermsWantInternships(["Stage IA", "Machine Learning Engineer"]),
    ).toBe(false);
    expect(searchTermsWantInternships([])).toBe(false);
    expect(searchTermsWantInternships(["  "])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Workable, SmartRecruiters and Teamtailor boards, search-term filtering
// ---------------------------------------------------------------------------

type Route = () => Response;

function routeFetch(routes: Record<string, Route>) {
  return vi.fn(async (input: string | URL | Request) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const route = routes[url];
    return route ? route() : new Response("Not Found", { status: 404 });
  });
}

const json =
  (body: unknown, status = 200): Route =>
  () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
const text =
  (body: string, status = 200): Route =>
  () =>
    new Response(body, { status });

function calledUrls(fetchMock: ReturnType<typeof routeFetch>): string[] {
  return fetchMock.mock.calls.map(([input]) => String(input));
}

/** The owner's CDI search terms (Nov 2026). */
const CDI_TERMS = [
  "Data Quality",
  "Qualité des données",
  "Data Steward",
  "Data Governance",
  "Gouvernance des données",
  "AI Engineer",
  "Ingénieur IA",
  "Agentic AI",
  "Agents IA",
  "AI Agent",
  "IA Générative",
  "Generative AI",
  "LLM Engineer",
  "AI Automation",
  "Automatisation IA",
  "n8n",
  "Consultant IA",
  "Forward Deployed Engineer",
];

const WORKABLE_HF =
  "https://apply.workable.com/api/v1/widget/accounts/huggingface?details=true";

function workableJob(overrides: Record<string, unknown>) {
  return {
    title: "Data Quality Analyst",
    shortcode: "SHORT1",
    employment_type: "Full-time",
    telecommuting: false,
    url: "https://apply.workable.com/j/SHORT1",
    application_url: "https://apply.workable.com/j/SHORT1/apply",
    published_on: "2026-11-10",
    country: "France",
    city: "Paris",
    locations: [{ country: "France", countryCode: "FR", city: "Paris" }],
    description: "<p>Own data quality.</p>",
    ...overrides,
  };
}

describe("Workable boards", () => {
  it("maps widget jobs and reports missing boards", async () => {
    const fetchMock = routeFetch({
      [WORKABLE_HF]: json({
        name: "Hugging Face",
        jobs: [
          workableJob({
            title: "Open-Source Machine Learning Engineer - EMEA Remote",
            shortcode: "81B46579FE",
            telecommuting: true,
            url: "https://apply.workable.com/j/81B46579FE",
            application_url: "https://apply.workable.com/j/81B46579FE/apply",
            published_on: "2026-05-29",
            experience: "Mid-Senior level",
            locations: [
              { country: "France", countryCode: "FR", city: "Paris" },
              {
                country: "Germany",
                countryCode: "DE",
                city: "Berlin",
                hidden: true,
              },
            ],
            description:
              "<p>Build <strong>open-source</strong> ML.</p><ul><li>Python</li><li>PyTorch</li></ul>",
            requirements: "<p>3+ years with transformers</p>",
          }),
          workableJob({
            title: "Office Manager",
            shortcode: "X1",
            url: "https://apply.workable.com/j/X1",
            description: "<p>Run the office.</p>",
          }),
        ],
      }),
      "https://apply.workable.com/api/v1/widget/accounts/emptyco?details=true":
        json({ name: "Empty Co", jobs: [] }),
    });

    const result = await runCompanyAts({
      companies: [
        { name: "Hugging Face", ats: "workable", slug: "huggingface" },
        { name: "Empty Co", ats: "workable", slug: "emptyco" },
        { name: "Gone Co", ats: "workable", slug: "goneco" },
      ],
      pauseMs: 0,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]).toMatchObject({
      source: "companyats",
      title: "Open-Source Machine Learning Engineer - EMEA Remote",
      employer: "Hugging Face",
      jobUrl: "https://apply.workable.com/j/81B46579FE",
      applicationLink: "https://apply.workable.com/j/81B46579FE/apply",
      location: "Paris, France",
      isRemote: true,
      datePosted: "2026-05-29",
      jobType: "Full-time",
      jobLevel: "Mid-Senior level",
      sourceJobId: "81B46579FE",
    });
    expect(result.jobs[0]?.jobDescription).toContain(
      "Build open-source ML.\n- Python\n- PyTorch",
    );
    expect(result.jobs[0]?.jobDescription).toContain(
      "3+ years with transformers",
    );
    // An empty board is fine; a missing one is reported, not fatal.
    expect(result.failedBoards).toEqual([
      { company: "Gone Co", ats: "workable", reason: "HTTP 404" },
    ]);
  });
});

describe("SmartRecruiters boards", () => {
  const base = "https://api.smartrecruiters.com/v1/companies/Devoteam/postings";
  const posting = (
    id: string,
    name: string,
    releasedDate = "2026-11-10T08:00:00.000Z",
  ) => ({
    id,
    name,
    releasedDate,
    company: { identifier: "Devoteam", name: "Devoteam" },
    location: {
      city: "Paris",
      country: "fr",
      remote: false,
      fullLocation: "Paris, IDF, France",
    },
    typeOfEmployment: { id: "permanent", label: "Full-time" },
    experienceLevel: { id: "entry_level", label: "Entry Level" },
  });

  it("pages postings for the selected country and fetches details only for kept roles", async () => {
    const page1 = Array.from({ length: 100 }, (_, index) =>
      posting(
        `p${index}`,
        index === 5
          ? "Consultant Data Quality (H/F)"
          : `Chef de projet SAP ${index}`,
      ),
    );
    const page2 = [
      posting("q1", "Ingénieur IA Générative F/H", "2026-11-12T08:00:00.000Z"),
      posting("q2", "Stage Data Quality"),
    ];
    const fetchMock = routeFetch({
      [`${base}?limit=100&offset=0&country=fr`]: json({
        offset: 0,
        limit: 100,
        totalFound: 102,
        content: page1,
      }),
      [`${base}?limit=100&offset=100&country=fr`]: json({
        offset: 100,
        limit: 100,
        totalFound: 102,
        content: page2,
      }),
      [`${base}/p5`]: json({
        id: "p5",
        applyUrl:
          "https://jobs.smartrecruiters.com/Devoteam/p5-consultant?oga=true",
        jobAd: {
          sections: {
            companyDescription: {
              title: "Company",
              text: "<p>Devoteam is a consulting firm.</p>",
            },
            jobDescription: {
              title: "Description du poste",
              text: "<p>Contrôles qualité des données.</p>",
            },
            qualifications: {
              title: "Qualifications",
              text: "<ul><li>SQL</li></ul>",
            },
          },
        },
      }),
      [`${base}/q1`]: json({
        id: "q1",
        jobAd: { sections: { jobDescription: { text: "<p>Agents LLM.</p>" } } },
      }),
    });

    const result = await runCompanyAts({
      companies: [
        { name: "Devoteam", ats: "smartrecruiters", slug: "Devoteam" },
      ],
      searchTerms: ["Data Quality", "Ingénieur IA", "IA Générative"],
      country: "france",
      pauseMs: 0,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(result.failedBoards).toEqual([]);
    expect(result.jobs.map((job) => job.title)).toEqual([
      "Consultant Data Quality (H/F)",
      "Ingénieur IA Générative F/H",
    ]);
    expect(result.jobs[0]).toMatchObject({
      employer: "Devoteam",
      jobUrl: "https://jobs.smartrecruiters.com/Devoteam/p5",
      applicationLink:
        "https://jobs.smartrecruiters.com/Devoteam/p5-consultant?oga=true",
      location: "Paris, IDF, France",
      isRemote: false,
      jobType: "Full-time",
      jobLevel: "Entry Level",
      datePosted: "2026-11-10T08:00:00.000Z",
      companyDescription: "Devoteam is a consulting firm.",
    });
    expect(result.jobs[0]?.jobDescription).toBe(
      "Description du poste\nContrôles qualité des données.\n\nQualifications\n- SQL",
    );
    expect(result.jobs[1]?.jobDescription).toBe("Agents LLM.");

    const detailCalls = calledUrls(fetchMock).filter(
      (url) => !url.includes("?"),
    );
    expect(detailCalls).toEqual([`${base}/p5`, `${base}/q1`]);
  });

  it("caps detail requests per company", async () => {
    const postings = Array.from(
      { length: SMARTRECRUITERS_MAX_DETAILS + 5 },
      (_, index) => posting(`d${index}`, `Data Quality Analyst ${index}`),
    );
    const fetchMock = routeFetch({
      [`${base}?limit=100&offset=0`]: json({
        offset: 0,
        limit: 100,
        totalFound: postings.length,
        content: postings,
      }),
    });

    const result = await runCompanyAts({
      companies: [
        { name: "Devoteam", ats: "smartrecruiters", slug: "Devoteam" },
      ],
      searchTerms: ["Data Quality"],
      pauseMs: 0,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    // Every kept role is returned; only the first ones get a description call.
    expect(result.jobs).toHaveLength(SMARTRECRUITERS_MAX_DETAILS + 5);
    expect(
      calledUrls(fetchMock).filter((url) => !url.includes("?")),
    ).toHaveLength(SMARTRECRUITERS_MAX_DETAILS);
  });

  it("treats an unknown company (200, nothing found) as an empty board", async () => {
    const fetchMock = routeFetch({
      [`${base}?limit=100&offset=0&country=fr`]: json({
        offset: 0,
        limit: 100,
        totalFound: 0,
        content: [],
      }),
    });

    const result = await runCompanyAts({
      companies: [
        { name: "Devoteam", ats: "smartrecruiters", slug: "Devoteam" },
      ],
      searchTerms: ["Data Quality"],
      country: "france",
      pauseMs: 0,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(result).toEqual({ success: true, jobs: [], failedBoards: [] });
  });
});

describe("Teamtailor boards", () => {
  const SPENDESK_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:tt="https://teamtailor.com/locations">
  <channel>
    <title>Spendesk</title>
    <item>
      <title>AI Engineer</title>
      <description>&lt;h2&gt;Mission&lt;/h2&gt;&lt;p&gt;Build AI agents &amp;amp; evals.&lt;/p&gt;</description>
      <pubDate>Fri, 13 Nov 2026 15:00:11 +0100</pubDate>
      <link>https://career.spendesk.com/jobs/1-ai-engineer</link>
      <remoteStatus>hybrid</remoteStatus>
      <guid>guid-1</guid>
      <tt:locations>
        <tt:location>
          <tt:name>Paris HQ</tt:name>
          <tt:city>Paris</tt:city>
          <tt:country>France</tt:country>
        </tt:location>
      </tt:locations>
    </item>
    <item>
      <title>Account Executive</title>
      <description>&lt;p&gt;Sell our AI agents to finance teams.&lt;/p&gt;</description>
      <pubDate>Fri, 12 Dec 2025 19:18:07 +0100</pubDate>
      <link>https://career.spendesk.com/jobs/2-account-executive</link>
      <remoteStatus>none</remoteStatus>
      <guid>guid-2</guid>
      <tt:locations><tt:location><tt:city>Paris</tt:city><tt:country>France</tt:country></tt:location></tt:locations>
    </item>
    <item>
      <title><![CDATA[Data Quality Analyst]]></title>
      <description><![CDATA[<p>Own data quality.</p>]]></description>
      <pubDate>Mon, 16 Nov 2026 09:00:00 +0000</pubDate>
      <link>https://career.spendesk.com/jobs/3-data-quality-analyst</link>
      <remoteStatus>fully</remoteStatus>
      <guid>guid-3</guid>
    </item>
  </channel>
</rss>`;

  it("reads the feed from a custom careers domain and keeps matching roles", async () => {
    const fetchMock = routeFetch({
      "https://career.spendesk.com/jobs.rss": text(SPENDESK_RSS),
      "https://modjo.teamtailor.com/jobs.rss": text("<html>Maintenance</html>"),
    });

    const result = await runCompanyAts({
      companies: [
        {
          name: "Spendesk",
          ats: "teamtailor",
          slug: "spendesk",
          host: "career.spendesk.com",
        },
        { name: "Modjo", ats: "teamtailor", slug: "modjo" },
      ],
      searchTerms: ["AI Engineer", "Data Quality"],
      pauseMs: 0,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(calledUrls(fetchMock)).toEqual([
      "https://career.spendesk.com/jobs.rss",
      "https://modjo.teamtailor.com/jobs.rss",
    ]);
    // The sales role is dropped even though its description mentions AI.
    expect(result.jobs.map((job) => job.title)).toEqual([
      "AI Engineer",
      "Data Quality Analyst",
    ]);
    expect(result.jobs[0]).toEqual({
      source: "companyats",
      title: "AI Engineer",
      employer: "Spendesk",
      jobUrl: "https://career.spendesk.com/jobs/1-ai-engineer",
      location: "Paris, France",
      isRemote: false,
      jobDescription: "Mission\nBuild AI agents & evals.",
      datePosted: "2026-11-13T14:00:11.000Z",
      sourceJobId: "guid-1",
    });
    expect(result.jobs[1]).toMatchObject({
      isRemote: true,
      jobDescription: "Own data quality.",
      sourceJobId: "guid-3",
    });
    expect(result.jobs[1]?.location).toBeUndefined();
    expect(result.failedBoards).toEqual([
      {
        company: "Modjo",
        ats: "teamtailor",
        reason: "unexpected payload (not an RSS feed)",
      },
    ]);
  });
});

describe("search-term role filter", () => {
  const rank = createRoleRanker(CDI_TERMS);

  it("ranks titles that contain a whole search term highest", () => {
    expect(rank("Data Quality Analyst", "")).toBe(2);
    expect(rank("Analyste Qualité des Données (H/F)", "")).toBe(2);
    expect(rank("Junior AI Consultant", "")).toBe(2);
    expect(
      rank(
        "Applied AI, Forward Deployed Machine Learning Engineer - Paris",
        "",
      ),
    ).toBe(2);
    expect(rank("Développeur n8n / Make", "")).toBe(2);
  });

  it("keeps related technical roles and drops unrelated ones", () => {
    expect(rank("Junior Data & Automation Engineer", "")).toBe(1);
    expect(rank("Senior Machine Learning Engineer", "")).toBe(1);
    expect(
      rank("Account Executive", "We build AI agents for finance teams"),
    ).toBe(0);
    expect(rank("Enterprise Sales Manager AI", "")).toBe(0);
    expect(rank("Head of Finance", "AI everywhere")).toBe(0);
    expect(rank("Chef de projet SAP", "")).toBe(0);
  });

  it("falls back to the broad AI keyword check without search terms", () => {
    const legacy = createRoleRanker([]);
    expect(legacy("Office Manager", "We build machine learning tools")).toBe(1);
    expect(legacy("Office Manager", "We sell furniture")).toBe(0);
  });

  it("recognises internship wording but not graduate programmes", () => {
    expect(mentionsInternship("Stage - Data Quality (H/F)")).toBe(true);
    expect(mentionsInternship("Alternance Data Engineer")).toBe(true);
    expect(mentionsInternship("Data Quality Intern Internship")).toBe(true);
    expect(mentionsInternship("Graduate Data Engineer")).toBe(false);
    expect(mentionsInternship("Data Steward")).toBe(false);
  });

  it("maps supported countries to ISO codes", () => {
    expect(resolveCountryCode("france")).toBe("fr");
    expect(resolveCountryCode("United Kingdom")).toBe("gb");
    expect(resolveCountryCode("Atlantis")).toBeUndefined();
  });
});

describe("internships, caps and failures across platforms", () => {
  const board = (jobs: unknown[]) =>
    routeFetch({ [WORKABLE_HF]: json({ name: "Hugging Face", jobs }) });
  const HF: AtsCompany[] = [
    { name: "Hugging Face", ats: "workable", slug: "huggingface" },
  ];
  const internshipBoard = [
    workableJob({
      title: "Data Quality Analyst",
      url: "https://apply.workable.com/j/A",
    }),
    workableJob({
      title: "Stage - Data Quality (H/F)",
      url: "https://apply.workable.com/j/B",
    }),
    workableJob({
      title: "Data Quality Intern",
      employment_type: "Internship",
      url: "https://apply.workable.com/j/C",
    }),
  ];

  it("skips internships unless a search term asks for one", async () => {
    const withoutInternshipTerm = await runCompanyAts({
      companies: HF,
      searchTerms: ["Data Quality"],
      pauseMs: 0,
      fetchImpl: board(internshipBoard) as unknown as typeof fetch,
    });
    expect(withoutInternshipTerm.jobs.map((job) => job.title)).toEqual([
      "Data Quality Analyst",
    ]);

    const withInternshipTerm = await runCompanyAts({
      companies: HF,
      searchTerms: ["Data Quality", "Stage Data"],
      pauseMs: 0,
      fetchImpl: board(internshipBoard) as unknown as typeof fetch,
    });
    expect(withInternshipTerm.jobs).toHaveLength(3);

    const internshipsOnly = await runCompanyAts({
      companies: HF,
      searchTerms: ["Stage Data Quality"],
      internshipsOnly: true,
      pauseMs: 0,
      fetchImpl: board(internshipBoard) as unknown as typeof fetch,
    });
    expect(internshipsOnly.jobs.map((job) => job.title)).toEqual([
      "Stage - Data Quality (H/F)",
      "Data Quality Intern",
    ]);
  });

  it("keeps the best-matching, newest roles when a per-company cap is set", async () => {
    const result = await runCompanyAts({
      companies: HF,
      searchTerms: ["Data Quality"],
      maxJobsPerCompany: 2,
      pauseMs: 0,
      fetchImpl: board([
        workableJob({
          title: "Senior Machine Learning Engineer",
          url: "https://apply.workable.com/j/ML",
          published_on: "2026-11-16",
        }),
        workableJob({
          title: "Data Quality Engineer",
          url: "https://apply.workable.com/j/OLD",
          published_on: "2026-10-01",
        }),
        workableJob({
          title: "Data Quality Lead",
          url: "https://apply.workable.com/j/NEW",
          published_on: "2026-11-15",
        }),
      ]) as unknown as typeof fetch,
    });

    expect(result.jobs.map((job) => job.title)).toEqual([
      "Data Quality Lead",
      "Data Quality Engineer",
    ]);
  });

  it("fails loudly when every board of every platform is unavailable", async () => {
    const fetchMock = routeFetch({
      "https://api.smartrecruiters.com/v1/companies/Devoteam/postings?limit=100&offset=0":
        json({ message: "unavailable" }, 503),
      "https://career.spendesk.com/jobs.rss": text("error", 500),
    });

    await expect(
      runCompanyAts({
        companies: [
          { name: "Gone Co", ats: "workable", slug: "goneco" },
          { name: "Devoteam", ats: "smartrecruiters", slug: "Devoteam" },
          {
            name: "Spendesk",
            ats: "teamtailor",
            slug: "spendesk",
            host: "career.spendesk.com",
          },
        ],
        pauseMs: 0,
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toThrow(
      "All 3 company job boards failed to load: Gone Co (HTTP 404), Devoteam (HTTP 503), Spendesk (HTTP 500)",
    );
  });
});

describe("unresponsive platforms", () => {
  it("skips the rest of a platform after consecutive timeouts or server errors", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith("https://api.lever.co/")) {
        throw new Error("The operation was aborted due to timeout");
      }
      return new Response(JSON.stringify({ jobs: [] }));
    });
    const lever = (slug: string): AtsCompany => ({
      name: slug,
      ats: "lever",
      slug,
    });

    const result = await runCompanyAts({
      // Batches of four: the first two Lever boards fail, the next ones are skipped.
      companies: [
        lever("one"),
        lever("two"),
        { name: "Alan", ats: "ashby", slug: "alan" },
        { name: "Datadog", ats: "greenhouse", slug: "datadog" },
        lever("three"),
        lever("four"),
      ],
      pauseMs: 0,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const leverCalls = fetchMock.mock.calls.filter(([input]) =>
      String(input).startsWith("https://api.lever.co/"),
    );
    expect(leverCalls).toHaveLength(2);
    expect(
      result.failedBoards.map((board) => [board.company, board.reason]),
    ).toEqual([
      ["one", "The operation was aborted due to timeout"],
      ["two", "The operation was aborted due to timeout"],
      ["three", "skipped: lever is not responding (2 consecutive failures)"],
      ["four", "skipped: lever is not responding (2 consecutive failures)"],
    ]);
  });

  it("does not count a missing board (404) against its platform", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) =>
      String(input).includes("/gone")
        ? new Response("Not Found", { status: 404 })
        : new Response(JSON.stringify([])),
    );

    const result = await runCompanyAts({
      companies: ["gone", "gone-too", "alive", "alive-too", "fine"].map(
        (slug): AtsCompany => ({ name: slug, ats: "lever", slug }),
      ),
      pauseMs: 0,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(result.failedBoards.map((board) => board.reason)).toEqual([
      "HTTP 404",
      "HTTP 404",
    ]);
  });
});

describe("companyats manifest with search terms", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("passes search terms, the selected country and the per-company cap", async () => {
    const smartRecruitersCalls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url === WORKABLE_HF) {
          return new Response(
            JSON.stringify({
              jobs: [
                workableJob({
                  title: "Data Quality Engineer",
                  url: "https://apply.workable.com/j/A",
                  published_on: "2026-11-10",
                }),
                workableJob({
                  title: "Data Quality Analyst",
                  url: "https://apply.workable.com/j/B",
                  published_on: "2026-11-12",
                }),
                workableJob({
                  title: "Account Executive",
                  url: "https://apply.workable.com/j/C",
                }),
              ],
            }),
          );
        }
        if (url.startsWith("https://api.smartrecruiters.com/")) {
          smartRecruitersCalls.push(url);
          return new Response(
            JSON.stringify({
              offset: 0,
              limit: 100,
              totalFound: 0,
              content: [],
            }),
          );
        }
        return new Response("Not Found", { status: 404 });
      }),
    );
    const { manifest } = await import("../manifest");

    const result = await manifest.run({
      source: "companyats",
      selectedSources: ["companyats"],
      settings: { jobspyResultsWanted: "1" },
      searchTerms: ["Data Quality"],
      selectedCountry: "france",
    });

    expect(result.success).toBe(true);
    expect(result.jobs.map((job) => job.title)).toEqual([
      "Data Quality Analyst",
    ]);
    expect(smartRecruitersCalls).toEqual([
      "https://api.smartrecruiters.com/v1/companies/Devoteam/postings?limit=100&offset=0&country=fr",
    ]);
  });
});
