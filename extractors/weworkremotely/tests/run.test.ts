import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { parseRssItem, runWWR, splitCompanyFromTitle } from "../src/run";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

/** Trimmed copy of the real remote-programming-jobs.rss feed (Nov 2026). */
const PROGRAMMING_FEED = readFileSync(
  join(FIXTURES_DIR, "programming-jobs.rss"),
  "utf-8",
);

function createTextResponse(body: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  } as Response;
}

describe("We Work Remotely RSS parsing", () => {
  it("splits the company out of 'Company: Role' titles", () => {
    expect(
      splitCompanyFromTitle("Bybit: Blockchain Risk Control Lead"),
    ).toEqual({ company: "Bybit", title: "Blockchain Risk Control Lead" });
    expect(
      splitCompanyFromTitle("Acme: Senior Engineer: Payments", "Ignored"),
    ).toEqual({ company: "Acme", title: "Senior Engineer: Payments" });
    expect(splitCompanyFromTitle("Senior Engineer", "Acme Corp")).toEqual({
      company: "Acme Corp",
      title: "Senior Engineer",
    });
  });

  it("decodes entity-escaped HTML descriptions into plain text", () => {
    const item = PROGRAMMING_FEED.match(/<item>[\s\S]*?<\/item>/)?.[0] ?? "";

    const parsed = parseRssItem(item);

    expect(parsed).toEqual(
      expect.objectContaining({
        company: "Bybit",
        title: "Blockchain Risk Control Lead",
        region: "Anywhere in the World",
        link: "https://weworkremotely.com/remote-jobs/bybit-blockchain-risk-control-lead",
      }),
    );
    expect(parsed?.description).toMatch(/^Headquarters: Europe - Remote/);
    expect(parsed?.description).not.toMatch(/&lt;|&gt;|&amp;|<\/?\w/);
  });
});

describe("runWWR", () => {
  it("maps feed items with real employers, titles and regions", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createTextResponse(PROGRAMMING_FEED))
      .mockResolvedValue(createTextResponse("", 404));

    const result = await runWWR({
      searchTerms: ["engineer"],
      fetchImpl: fetchMock,
    });

    expect(result.success).toBe(true);
    expect(result.jobs).toEqual([
      expect.objectContaining({
        source: "weworkremotely",
        title: "AI Engineer - Agentic Systems",
        employer: "Toptal",
        location: "Remote (USA Only)",
        isRemote: true,
        jobUrl: expect.stringMatching(
          /^https:\/\/weworkremotely\.com\/remote-jobs\//,
        ),
      }),
    ]);
    expect(result.jobs[0]?.jobDescription).not.toMatch(/&lt;|<\/?\w/);
  });

  it("never reports 'Unknown' when the title carries the company", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createTextResponse(PROGRAMMING_FEED))
      .mockResolvedValue(createTextResponse("", 404));

    const result = await runWWR({ searchTerms: [], fetchImpl: fetchMock });

    expect(result.jobs).toHaveLength(3);
    expect(result.jobs.map((job) => job.employer)).toEqual([
      "Bybit",
      "Toptal",
      "Bybit",
    ]);
    expect(result.jobs.filter((job) => job.title.includes(":"))).toEqual([]);
  });
});
