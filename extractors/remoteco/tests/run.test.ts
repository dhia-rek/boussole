import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { runRemoteCo } from "../src/run";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

/** HTML body served by remote.co/wp-json/wp/v2/job_listing since late 2026. */
const NOT_FOUND_PAGE = readFileSync(
  join(FIXTURES_DIR, "job-listing-404.html"),
  "utf-8",
);

function htmlResponse(body: string, status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(body),
    text: async () => body,
  } as Response;
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("runRemoteCo", () => {
  it("fails with a clear error when the job_listing endpoint is gone", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(htmlResponse(NOT_FOUND_PAGE, 404));

    const result = await runRemoteCo({
      searchTerms: ["machine learning"],
      fetchImpl: fetchMock,
    });

    expect(result.success).toBe(false);
    expect(result.jobs).toEqual([]);
    expect(result.error).toMatch(/HTTP 404/);
    expect(result.error).toMatch(/no longer exists/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails when the feed does not return a JSON array", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ code: "rest_no_route" }));

    const result = await runRemoteCo({
      searchTerms: ["machine learning"],
      fetchImpl: fetchMock,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/unexpected payload/);
  });

  it("keeps first-page jobs when WordPress rejects a page past the end", async () => {
    const items = Array.from({ length: 50 }, (_, index) => ({
      id: index,
      link: `https://remote.co/job/ml-engineer-${index}/`,
      title: { rendered: `Machine Learning Engineer ${index}` },
      content: { rendered: "<p>Build ML systems.</p>" },
      date: "2026-11-01T10:00:00",
      meta: { _company_name: "Acme" },
    }));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(items))
      .mockResolvedValueOnce(
        jsonResponse({ code: "rest_post_invalid_page_number" }, 400),
      );

    const result = await runRemoteCo({
      searchTerms: ["machine learning"],
      maxJobsPerTerm: 2,
      fetchImpl: fetchMock,
    });

    expect(result.success).toBe(true);
    expect(result.jobs).toHaveLength(2);
    expect(result.jobs[0]).toEqual(
      expect.objectContaining({
        source: "remoteco",
        employer: "Acme",
        title: "Machine Learning Engineer 0",
        isRemote: true,
      }),
    );
  });
});
