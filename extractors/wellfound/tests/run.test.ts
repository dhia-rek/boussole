import { describe, expect, it, vi } from "vitest";
import { runWellfound } from "../src/run";

function textResponse(body: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  } as Response;
}

const RSS_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <item>
    <title><![CDATA[ML Engineer Intern @ Acme AI (Paris)]]></title>
    <link>https://wellfound.com/jobs/1-ml-engineer-intern</link>
    <description><![CDATA[<p>Train models.</p>]]></description>
    <pubDate>Mon, 16 Nov 2026 10:00:00 +0000</pubDate>
  </item>
</channel></rss>`;

describe("runWellfound", () => {
  it("explains that the public RSS feed is gone on HTTP 404", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(textResponse("<html>Not found</html>", 404));

    const result = await runWellfound({
      searchTerms: ["machine learning"],
      fetchImpl: fetchMock,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Wellfound RSS feed returned HTTP 404/);
    expect(result.error).toMatch(/no longer exists/);
  });

  it("rejects non-RSS bodies such as bot-protection pages", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        textResponse("<html><title>Just a moment...</title></html>"),
      );

    const result = await runWellfound({
      searchTerms: ["machine learning"],
      fetchImpl: fetchMock,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/non-RSS response/);
  });

  it("parses RSS items when the feed is available", async () => {
    const fetchMock = vi.fn().mockResolvedValue(textResponse(RSS_FEED));

    const result = await runWellfound({
      searchTerms: ["ml engineer"],
      fetchImpl: fetchMock,
    });

    expect(result.success).toBe(true);
    expect(result.jobs).toEqual([
      expect.objectContaining({
        source: "wellfound",
        title: "ML Engineer Intern",
        employer: "Acme AI",
        location: "Paris",
        jobUrl: "https://wellfound.com/jobs/1-ml-engineer-intern",
      }),
    ]);
  });
});
