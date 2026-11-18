import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchPublicUrl = vi.fn();
vi.mock("@infra/public-url", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@infra/public-url")>();
  return { ...actual, fetchPublicUrl };
});

const { startServer, stopServer } = await import("./test-utils");

const html = (body: string, status = 200) =>
  new Response(body, { status, headers: { "Content-Type": "text/html" } });

describe.sequential("POST /api/manual-jobs/fetch reads job pages", () => {
  let server: Server;
  let baseUrl: string;
  let closeDb: () => void;
  let tempDir: string;

  beforeEach(async () => {
    fetchPublicUrl.mockReset();
    ({ server, baseUrl, closeDb, tempDir } = await startServer());
  });

  afterEach(async () => {
    await stopServer({ server, closeDb, tempDir });
  });

  const fetchJob = (url: string) =>
    fetch(`${baseUrl}/api/manual-jobs/fetch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });

  it("uses the posting embedded in the page (schema.org JobPosting)", async () => {
    fetchPublicUrl.mockResolvedValue(
      html(`<html><head><title>Careers</title>
        <script type="application/ld+json">${JSON.stringify({
          "@type": "JobPosting",
          title: "Data Engineer",
          hiringOrganization: { name: "Acme" },
          description: "<p>Build pipelines and data quality checks.</p>",
        })}</script></head><body><div id="app"></div></body></html>`),
    );
    const res = await fetchJob("https://careers.example.com/jobs/1");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.content).toMatch(
      /^Job Title: Data Engineer\nCompany: Acme\n/,
    );
    expect(body.data.content).toContain(
      "Build pipelines and data quality checks.",
    );
  });

  it("explains a page that shows no job instead of returning an empty form", async () => {
    fetchPublicUrl.mockResolvedValue(
      html(
        "<html><body><script>challenge()</script><p>Please wait…</p></body></html>",
        202,
      ),
    );
    const res = await fetchJob("https://careers.example.com/jobs/2");
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.message).toContain("didn't show the job to Boussole");
    expect(body.error.message).toContain("Paste the job description manually");
  });

  it("still reads ordinary pages from their text", async () => {
    const text =
      "We are hiring a data engineer to build reliable pipelines. ".repeat(10);
    fetchPublicUrl.mockResolvedValue(
      html(
        `<html><head><title>Data Engineer - Acme</title></head><body><main><p>${text}</p></main></body></html>`,
      ),
    );
    const res = await fetchJob("https://careers.example.com/jobs/3");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.content).toContain("Page Title: Data Engineer - Acme");
    expect(body.data.content).toContain("reliable pipelines");
  });

  it("reads Welcome to the Jungle links from its public job feed", async () => {
    fetchPublicUrl.mockResolvedValue(
      new Response(
        JSON.stringify({
          job: {
            name: "Project Quality Manager",
            organization: { name: "B-HIVE" },
            description: "<p>Lead quality on data center projects.</p>",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const res = await fetchJob(
      "https://www.welcometothejungle.com/fr/companies/b-hive-engineering/jobs/project-quality-manager_paris",
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.content).toContain("Company: B-HIVE");
    expect(fetchPublicUrl).toHaveBeenCalledTimes(1);
  });
});
