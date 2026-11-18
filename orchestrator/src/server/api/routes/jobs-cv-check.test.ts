import type { Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startServer, stopServer } from "./test-utils";

async function createCv(headline: string) {
  const { buildDefaultReactiveResumeDocument } = await import(
    "@server/services/resume-data/document"
  );
  const { replaceCurrentDesignResumeDocument } = await import(
    "@server/services/design-resume"
  );
  const resumeJson = buildDefaultReactiveResumeDocument() as Record<
    string,
    Record<string, unknown>
  >;
  resumeJson.basics = { ...resumeJson.basics, headline };
  resumeJson.summary = {
    ...resumeJson.summary,
    content: "<p>Built Airflow pipelines in Python.</p>",
  };
  return replaceCurrentDesignResumeDocument({
    resumeJson: resumeJson as never,
    sourceResumeId: null,
    sourceMode: "v5",
  });
}

async function waitUntilSettled(
  baseUrl: string,
  jobId: string,
  headers: Record<string, string> = {},
) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const body = await fetch(`${baseUrl}/api/jobs/${jobId}/cv-check`, {
      headers,
    }).then((res) => res.json());
    if (body.data?.status !== "running") return body;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("CV check did not finish");
}

const REVIEW = {
  overall: "Close fit.",
  priorities: ["Reword L1"],
  lines: [
    {
      ref: "L1",
      verdict: "reword",
      reason: "Say pipelines",
      suggestion: "Data Engineer, Airflow pipelines",
    },
    { ref: "L2", verdict: "keep", reason: "", suggestion: "" },
  ],
  missing: [{ requirement: "dbt", closest_ref: "", note: "Real gap" }],
};

describe.sequential("CV check API", () => {
  let server: Server;
  let baseUrl: string;
  let closeDb: () => void;
  let tempDir: string;

  afterEach(async () => {
    const { __setCvCheckLlmForTests } = await import(
      "@server/services/cv-check"
    );
    __setCvCheckLlmForTests(null);
    await stopServer({ server, closeDb, tempDir });
  });

  it("asks for a CV first, then reviews it line by line", async () => {
    ({ server, baseUrl, closeDb, tempDir } = await startServer());
    const callJson = vi.fn().mockResolvedValue({ success: true, data: REVIEW });
    const { __setCvCheckLlmForTests } = await import(
      "@server/services/cv-check"
    );
    __setCvCheckLlmForTests({ callJson } as never);
    const { createJob } = await import("@server/repositories/jobs");
    const job = await createJob({
      source: "manual",
      title: "Data Engineer",
      employer: "Beta",
      jobUrl: "https://example.com/job/beta",
      jobDescription: "We need Airflow and dbt.",
    });

    const noCv = await fetch(`${baseUrl}/api/jobs/${job.id}/cv-check`, {
      method: "POST",
    });
    expect(noCv.status).toBe(422);
    expect((await noCv.json()).error.code).toBe("UNPROCESSABLE_ENTITY");

    await createCv("Data Engineer");
    const started = await fetch(`${baseUrl}/api/jobs/${job.id}/cv-check`, {
      method: "POST",
    });
    expect(started.status).toBe(202);
    const done = await waitUntilSettled(baseUrl, job.id);
    expect(done.data).toMatchObject({
      status: "done",
      cvChanged: false,
      result: {
        overall: "Close fit.",
        missing: [{ requirement: "dbt", closestRef: null }],
      },
    });
    expect(
      done.data.result.lines.map((line: { ref: string; verdict: string }) => [
        line.ref,
        line.verdict,
      ]),
    ).toEqual([
      ["L1", "reword"],
      ["L2", "keep"],
    ]);
    const prompt = callJson.mock.calls[0]?.[0].messages[0].content as string;
    expect(prompt).toContain("L2: Built Airflow pipelines in Python.");

    await createCv("Senior Data Engineer");
    const later = await fetch(`${baseUrl}/api/jobs/${job.id}/cv-check`).then(
      (res) => res.json(),
    );
    expect(later.data.cvChanged).toBe(true);
  });

  it("keeps CV checks private to each workspace", async () => {
    ({ server, baseUrl, closeDb, tempDir } = await startServer({
      env: {
        BASIC_AUTH_USER: "admin",
        BASIC_AUTH_PASSWORD: "secret",
        JWT_SECRET: "an-explicit-jwt-secret-with-at-least-32-chars",
        FORSA_TEST_AUTH_BYPASS: "0",
      },
    }));
    const { __setCvCheckLlmForTests } = await import(
      "@server/services/cv-check"
    );
    __setCvCheckLlmForTests({
      callJson: vi.fn().mockResolvedValue({ success: true, data: REVIEW }),
    } as never);

    const login = async (username: string, password: string) => {
      const body = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      }).then((res) => res.json());
      return { Authorization: `Bearer ${body.data.token as string}` };
    };
    const admin = await login("admin", "secret");
    await createCv("Data Engineer");
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
          employer: "Beta",
          jobUrl: "https://example.com/admin-job",
          jobDescription: "Role",
        },
      }),
    }).then((res) => res.json());
    const jobId = imported.data.id as string;

    const started = await fetch(`${baseUrl}/api/jobs/${jobId}/cv-check`, {
      method: "POST",
      headers: admin,
    });
    expect(started.status).toBe(202);
    expect((await waitUntilSettled(baseUrl, jobId, admin)).data.status).toBe(
      "done",
    );

    for (const method of ["GET", "POST"]) {
      const res = await fetch(`${baseUrl}/api/jobs/${jobId}/cv-check`, {
        method,
        headers: adam,
      });
      expect(res.status).toBe(404);
    }
  });
});
