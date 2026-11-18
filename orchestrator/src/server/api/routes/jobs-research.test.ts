import type { Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startServer, stopServer } from "./test-utils";

const RESEARCH_OUTPUT = {
  summary: "Acme builds payment software for European banks.",
  facts: [
    {
      topic: "company",
      claim: "Acme serves banks.",
      source_url: "https://acme.example/about",
      quote: "Acme serves 300 European banks",
    },
    {
      topic: "size",
      claim: "Acme is huge.",
      source_url: "https://acme.example/about",
      quote: "Acme employs 90,000 people worldwide",
    },
    {
      topic: "product",
      claim: "Acme sells an instant payments API.",
      source_url: "https://acme.example/product",
      quote: "our instant payments API settles in seconds",
    },
    {
      topic: "news",
      claim: "Acme opened a Lyon office.",
      source_url: "https://press.example/acme-lyon",
      quote: "Acme opens a new engineering office in Lyon",
    },
  ],
  talking_points: ["Instant payments experience"],
  questions_to_ask: ["How does the data team work with risk?"],
};

const PAGES: Record<string, string> = {
  "https://acme.example/about": "Today Acme serves 300 European banks.",
  "https://acme.example/product":
    "With our instant payments API settles in seconds, banks move faster.",
  "https://press.example/acme-lyon":
    "Paris, 2026. Acme opens a new engineering office in Lyon this spring.",
};

async function useFakeResearch(
  options: { webResearch?: () => Promise<unknown> } = {},
) {
  const { __setCompanyResearchDepsForTests } = await import(
    "@server/services/company-research"
  );
  __setCompanyResearchDepsForTests({
    webResearch: options.webResearch ?? (async () => RESEARCH_OUTPUT),
    readPage: async (url) => PAGES[url] ?? null,
    judgeLlm: {
      callJson: vi.fn().mockResolvedValue({
        success: true,
        data: {
          relevance: 4,
          specificity: 4,
          wrong_company: false,
          issues: [],
        },
      }),
    } as never,
  });
}

async function waitUntilSettled(
  baseUrl: string,
  jobId: string,
  headers: Record<string, string> = {},
) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const body = await fetch(`${baseUrl}/api/jobs/${jobId}/research`, {
      headers,
    }).then((res) => res.json());
    if (body.data?.status !== "running") return body;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("research did not finish");
}

describe.sequential("Company research API", () => {
  let server: Server;
  let baseUrl: string;
  let closeDb: () => void;
  let tempDir: string;

  afterEach(async () => {
    await stopServer({ server, closeDb, tempDir });
  });

  it("researches, checks quotes, judges and feeds only confirmed facts to Ghostwriter", async () => {
    ({ server, baseUrl, closeDb, tempDir } = await startServer());
    let finishResearch: (value: unknown) => void = () => undefined;
    await useFakeResearch({
      webResearch: () =>
        new Promise((resolve) => {
          finishResearch = resolve;
        }),
    });
    const { createJob } = await import("@server/repositories/jobs");
    const job = await createJob({
      source: "manual",
      title: "Data Engineer",
      employer: "Acme",
      jobUrl: "https://example.com/job/acme",
      jobDescription: "Payments data role",
    });

    const empty = await fetch(`${baseUrl}/api/jobs/${job.id}/research`).then(
      (res) => res.json(),
    );
    expect(empty).toMatchObject({ ok: true, data: null });

    const startRes = await fetch(`${baseUrl}/api/jobs/${job.id}/research`, {
      method: "POST",
    });
    expect(startRes.status).toBe(202);
    expect((await startRes.json()).data.status).toBe("running");

    const again = await fetch(`${baseUrl}/api/jobs/${job.id}/research`, {
      method: "POST",
    });
    expect(again.status).toBe(409);
    expect((await again.json()).error.code).toBe("CONFLICT");

    finishResearch(RESEARCH_OUTPUT);
    const done = await waitUntilSettled(baseUrl, job.id);
    expect(done.data).toMatchObject({
      status: "done",
      verdict: "passed",
      judgement: { factCount: 4, verifiedCount: 3, relevance: 4 },
    });
    expect(
      done.data.brief.facts.map((fact: { check: string }) => fact.check),
    ).toEqual(["verified", "not_found", "verified", "verified"]);

    const { buildJobChatPromptContext } = await import(
      "@server/services/ghostwriter-context"
    );
    const context = await buildJobChatPromptContext(job.id);
    expect(context.jobSnapshot).toContain("Acme serves banks.");
    expect(context.jobSnapshot).toContain("Acme opened a Lyon office.");
    expect(context.jobSnapshot).not.toContain("Acme is huge.");
  });

  it("records a failed run with its message", async () => {
    ({ server, baseUrl, closeDb, tempDir } = await startServer());
    await useFakeResearch({
      webResearch: async () => {
        throw new Error("Claude is not signed in for this workspace.");
      },
    });
    const { createJob } = await import("@server/repositories/jobs");
    const job = await createJob({
      source: "manual",
      title: "Data Engineer",
      employer: "Acme",
      jobUrl: "https://example.com/job/fail",
    });
    await fetch(`${baseUrl}/api/jobs/${job.id}/research`, { method: "POST" });
    const failed = await waitUntilSettled(baseUrl, job.id);
    expect(failed.data).toMatchObject({
      status: "failed",
      error: "Claude is not signed in for this workspace.",
    });
  });

  it("keeps research private to each workspace", async () => {
    ({ server, baseUrl, closeDb, tempDir } = await startServer({
      env: {
        BASIC_AUTH_USER: "admin",
        BASIC_AUTH_PASSWORD: "secret",
        JWT_SECRET: "an-explicit-jwt-secret-with-at-least-32-chars",
        BOUSSOLE_TEST_AUTH_BYPASS: "0",
      },
    }));
    await useFakeResearch();

    const login = async (username: string, password: string) => {
      const body = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      }).then((res) => res.json());
      return { Authorization: `Bearer ${body.data.token as string}` };
    };
    const admin = await login("admin", "secret");
    const created = await fetch(`${baseUrl}/api/workspaces/users`, {
      method: "POST",
      headers: { ...admin, "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "adam",
        displayName: "Adam",
        password: "adam-secret",
      }),
    });
    expect(created.status).toBe(201);
    const adam = await login("adam", "adam-secret");

    const imported = await fetch(`${baseUrl}/api/manual-jobs/import`, {
      method: "POST",
      headers: { ...admin, "Content-Type": "application/json" },
      body: JSON.stringify({
        job: {
          title: "Admin Role",
          employer: "Acme",
          jobUrl: "https://example.com/admin-job",
          jobDescription: "Role",
        },
      }),
    }).then((res) => res.json());
    const jobId = imported.data.id as string;

    const started = await fetch(`${baseUrl}/api/jobs/${jobId}/research`, {
      method: "POST",
      headers: admin,
    });
    expect(started.status).toBe(202);
    const done = await waitUntilSettled(baseUrl, jobId, admin);
    expect(done.data.status).toBe("done");

    const adamRead = await fetch(`${baseUrl}/api/jobs/${jobId}/research`, {
      headers: adam,
    });
    expect(adamRead.status).toBe(404);
    const adamStart = await fetch(`${baseUrl}/api/jobs/${jobId}/research`, {
      method: "POST",
      headers: adam,
    });
    expect(adamStart.status).toBe(404);

    const { getCompanyResearch } = await import(
      "@server/repositories/company-research"
    );
    const { runWithRequestContext } = await import("@infra/request-context");
    const fromAdamTenant = await runWithRequestContext(
      { tenantId: "some-other-tenant" },
      () => getCompanyResearch(jobId),
    );
    expect(fromAdamTenant).toBeNull();
  });
});
