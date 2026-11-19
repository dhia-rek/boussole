import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchPublicUrl = vi.fn();
vi.mock("@infra/public-url", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@infra/public-url")>()),
  fetchPublicUrl,
}));

const {
  formatJobPosting,
  jobPostingFromJsonLd,
  needsFinalUrl,
  readJobFromKnownFeed,
} = await import("./job-link-reader");

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("jobPostingFromJsonLd", () => {
  it("reads a JobPosting nested in @graph, with location, salary and contract", () => {
    const posting = jobPostingFromJsonLd([
      "not json",
      JSON.stringify({
        "@context": "https://schema.org",
        "@graph": [
          { "@type": "Organization", name: "Ignored" },
          {
            "@type": ["JobPosting"],
            title: "Data Quality Engineer",
            hiringOrganization: { name: "Acme" },
            jobLocation: [
              {
                address: {
                  addressLocality: "Paris",
                  addressCountry: { name: "France" },
                },
              },
            ],
            employmentType: ["FULL_TIME"],
            jobLocationType: "TELECOMMUTE",
            baseSalary: {
              currency: "EUR",
              value: { minValue: 45000, maxValue: 55000, unitText: "YEAR" },
            },
            datePosted: "2026-11-10",
            description:
              "<p>Build <b>data quality</b> checks.</p><ul><li>SQL</li></ul>",
          },
        ],
      }),
    ]);
    expect(posting).toMatchObject({
      title: "Data Quality Engineer",
      company: "Acme",
      location: "Paris, France",
      contract: "FULL_TIME",
      remote: "Remote",
      salary: "45000–55000 EUR per YEAR",
      postedAt: "2026-11-10",
    });
    expect(posting?.description).toContain("Build data quality checks.");
    expect(posting?.description).toContain("SQL");
    expect(formatJobPosting(posting as never)).toMatch(
      /^Job Title: Data Quality Engineer\nCompany: Acme\n/,
    );
  });

  it("ignores pages without a usable posting", () => {
    expect(
      jobPostingFromJsonLd([JSON.stringify({ "@type": "WebPage" })]),
    ).toBeNull();
    expect(
      jobPostingFromJsonLd([
        JSON.stringify({ "@type": "JobPosting", title: "No text" }),
      ]),
    ).toBeNull();
  });
});

describe("readJobFromKnownFeed", () => {
  beforeEach(() => fetchPublicUrl.mockReset());

  it("reads Welcome to the Jungle from its public job feed", async () => {
    fetchPublicUrl.mockResolvedValue(
      json({
        job: {
          name: "Project Quality Manager",
          organization: { name: "B-HIVE" },
          office: { city: "Nanterre", country: "France" },
          contract_type: "full_time",
          remote: "punctual",
          description: "<p>Lead quality on data center projects.</p>",
          profile: "<p>5 years of experience.</p>",
          apply_url: "https://example.com/apply",
        },
      }),
    );
    const posting = await readJobFromKnownFeed(
      "https://www.welcometothejungle.com/fr/companies/b-hive-engineering/jobs/project-quality-manager_paris",
    );
    expect(fetchPublicUrl).toHaveBeenCalledWith(
      "https://api.welcometothejungle.com/api/v1/organizations/b-hive-engineering/jobs/project-quality-manager_paris",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Accept-Language": expect.stringContaining("fr"),
        }),
      }),
    );
    expect(posting).toMatchObject({
      title: "Project Quality Manager",
      company: "B-HIVE",
      location: "Nanterre, France",
      contract: "CDI (permanent, full-time)",
      remote: "Occasional remote",
    });
    expect(posting?.description).toContain("Profile:\n5 years of experience.");
  });

  it("reads Workable through its careers feed, using the final address for short links", async () => {
    fetchPublicUrl.mockResolvedValue(
      json({
        name: "Hugging Face",
        jobs: [
          { shortcode: "OTHER", title: "Other", description: "<p>x</p>" },
          {
            shortcode: "9E2A4C02C7",
            title: "ML Engineer, Voice Agents",
            description: "<p>Build voice agents.</p>",
            requirements: "<p>Python</p>",
            locations: [{ city: "Paris", country: "France" }],
            employment_type: "Full-time",
            telecommuting: true,
          },
        ],
      }),
    );
    expect(needsFinalUrl("https://apply.workable.com/j/9E2A4C02C7")).toBe(true);
    const posting = await readJobFromKnownFeed(
      "https://apply.workable.com/j/9E2A4C02C7",
      {
        finalUrl: "https://apply.workable.com/huggingface/j/9E2A4C02C7",
      },
    );
    expect(fetchPublicUrl).toHaveBeenCalledWith(
      "https://apply.workable.com/api/v1/widget/accounts/huggingface?details=true",
      expect.anything(),
    );
    expect(posting).toMatchObject({
      title: "ML Engineer, Voice Agents",
      company: "Hugging Face",
      location: "Paris, France",
      remote: "Remote",
    });
    expect(posting?.description).toContain("Python");
  });

  it("returns null for other sites and empty feeds", async () => {
    expect(await readJobFromKnownFeed("https://example.com/jobs/1")).toBeNull();
    fetchPublicUrl.mockResolvedValue(json({ job: {} }));
    expect(
      await readJobFromKnownFeed(
        "https://www.welcometothejungle.com/en/companies/acme/jobs/gone",
      ),
    ).toBeNull();
  });
});
