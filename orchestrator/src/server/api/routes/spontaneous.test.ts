import type { Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startServer, stopServer } from "./test-utils";

const WEB_RESULT = {
  website: "https://acme.example",
  summary: "Acme builds payment software for banks.",
  facts: [
    {
      claim: "Acme serves 300 banks.",
      source_url: "https://acme.example/about",
      quote: "Acme serves 300 European banks",
    },
  ],
  contacts: [
    {
      kind: "email",
      value: "recrutement@acme.example",
      name: "",
      title: "",
      source_url: "https://acme.example/careers",
    },
  ],
};
const PAGES: Record<string, string> = {
  "https://acme.example/careers": "Send your CV to recrutement@acme.example",
  "https://acme.example/about": "Today Acme serves 300 European banks.",
};

async function createCv() {
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
  resumeJson.basics = {
    ...resumeJson.basics,
    name: "Sam Doe",
    headline: "Data Engineer",
  };
  resumeJson.summary = {
    ...resumeJson.summary,
    content: "<p>Built Airflow pipelines in Python.</p>",
  };
  await replaceCurrentDesignResumeDocument({
    resumeJson: resumeJson as never,
    sourceResumeId: null,
    sourceMode: "v5",
  });
}

async function useFakes() {
  const { __setSpontaneousDepsForTests } = await import(
    "@server/services/spontaneous"
  );
  const callJson = vi.fn().mockResolvedValue({
    success: true,
    data: {
      subject: "Candidature spontanée – Data Engineer",
      body: "Bonjour,\n\nAcme serves 300 banks. J'ai construit des pipelines Airflow en Python.\n\nVous trouverez mon CV en pièce jointe.\n\nSam Doe",
    },
  });
  __setSpontaneousDepsForTests({
    webResearch: async () => WEB_RESULT,
    readPage: async (url) => PAGES[url] ?? null,
    emailLlm: { callJson } as never,
  });
  return callJson;
}

async function waitReady(baseUrl: string, id: string, headers = {}) {
  for (let i = 0; i < 50; i++) {
    const body = await fetch(`${baseUrl}/api/spontaneous/outreach/${id}`, {
      headers,
    }).then((r) => r.json());
    if (body.data?.status !== "researching") return body.data;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("search did not finish");
}

describe.sequential("Spontaneous applications API", () => {
  let server: Server;
  let baseUrl: string;
  let closeDb: () => void;
  let tempDir: string;

  afterEach(async () => {
    const { __setSpontaneousDepsForTests } = await import(
      "@server/services/spontaneous"
    );
    __setSpontaneousDepsForTests({});
    await stopServer({ server, closeDb, tempDir });
  });

  it("finds verified contacts, writes the email and logs it on the board", async () => {
    ({ server, baseUrl, closeDb, tempDir } = await startServer());
    const callJson = await useFakes();
    await createCv();

    const { createJob, updateJob } = await import("@server/repositories/jobs");
    await createJob({
      source: "manual",
      title: "Data Engineer",
      employer: "Acme",
      employerUrl: "https://acme.example",
      jobUrl: "https://example.com/job/acme",
    });
    const applied = await createJob({
      source: "manual",
      title: "ML Engineer",
      employer: "Beta",
      jobUrl: "https://example.com/job/beta",
    });
    await updateJob(applied.id, { status: "applied" });
    const suggestions = await fetch(
      `${baseUrl}/api/spontaneous/suggestions`,
    ).then((r) => r.json());
    expect(suggestions.data.map((s: { company: string }) => s.company)).toEqual(
      ["Acme"],
    );

    const started = await fetch(`${baseUrl}/api/spontaneous/outreach`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company: "Acme", website: "acme.example" }),
    });
    expect(started.status).toBe(202);
    const { id } = (await started.json()).data;
    const ready = await waitReady(baseUrl, id);
    expect(ready).toMatchObject({
      status: "ready",
      website: "https://acme.example",
      contacts: [{ value: "recrutement@acme.example", check: "verified" }],
      facts: [{ check: "verified" }],
    });

    const written = await fetch(
      `${baseUrl}/api/spontaneous/outreach/${id}/email`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: "recrutement@acme.example",
          targetRole: "Data Engineer",
          language: "fr",
        }),
      },
    ).then((r) => r.json());
    expect(written.data.email.subject).toContain("Candidature spontanée");
    const prompt = callJson.mock.calls[0]?.[0].messages[0].content as string;
    expect(prompt).toContain("Built Airflow pipelines in Python.");
    expect(prompt).toContain("Acme serves 300 banks.");

    const sent = await fetch(`${baseUrl}/api/spontaneous/outreach/${id}/sent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: "recrutement@acme.example",
        subject: written.data.email.subject,
        body: written.data.email.body,
      }),
    }).then((r) => r.json());
    const jobId = sent.data.jobId as string;
    expect(jobId).toBeTruthy();

    const job = await fetch(`${baseUrl}/api/jobs/${jobId}`).then((r) =>
      r.json(),
    );
    expect(job.data).toMatchObject({
      status: "applied",
      employer: "Acme",
      title: "Candidature spontanée – Data Engineer",
    });
    const events = await fetch(`${baseUrl}/api/jobs/${jobId}/events`).then(
      (r) => r.json(),
    );
    expect(events.data[0]).toMatchObject({
      toStage: "applied",
      metadata: {
        eventLabel: "Spontaneous application via email",
        note: "to recrutement@acme.example",
      },
    });

    const again = await fetch(
      `${baseUrl}/api/spontaneous/outreach/${id}/email`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: "fr" }),
      },
    );
    expect(again.status).toBe(409);

    const history = await fetch(`${baseUrl}/api/spontaneous/outreach`).then(
      (r) => r.json(),
    );
    expect(history.data[0]).toMatchObject({ id, jobId });
  });

  it("rejects bad input with structured errors and never reports an AI failure as success", async () => {
    ({ server, baseUrl, closeDb, tempDir } = await startServer());
    const callJson = await useFakes();
    const post = (path: string, body: unknown) =>
      fetch(`${baseUrl}/api/spontaneous${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-request-id": "req-123",
        },
        body: JSON.stringify(body),
      });

    const missing = await post("/outreach", {});
    expect(missing.status).toBe(400);
    const missingBody = await missing.json();
    expect(missingBody).toMatchObject({
      ok: false,
      error: { code: "INVALID_REQUEST" },
      meta: { requestId: "req-123" },
    });
    expect((await post("/outreach", { company: "x".repeat(201) })).status).toBe(
      400,
    );

    const started = await (await post("/outreach", { company: "Acme" })).json();
    const id = started.data.id as string;
    expect(
      (await post(`/outreach/${id}/email`, { language: "de" })).status,
    ).toBe(400);
    await waitReady(baseUrl, id);

    await createCv();
    callJson.mockResolvedValueOnce({ success: false, error: "Not logged in" });
    const failed = await post(`/outreach/${id}/email`, { language: "fr" });
    expect(failed.status).toBe(502);
    expect((await failed.json()).error.code).toBe("UPSTREAM_ERROR");

    expect((await post(`/outreach/${id}/sent`, { subject: "" })).status).toBe(
      400,
    );
    expect(
      (await post("/outreach/missing/sent", { subject: "s", body: "b" }))
        .status,
    ).toBe(404);
  });

  it("keeps spontaneous applications private to each workspace", async () => {
    ({ server, baseUrl, closeDb, tempDir } = await startServer({
      env: {
        BASIC_AUTH_USER: "admin",
        BASIC_AUTH_PASSWORD: "secret",
        JWT_SECRET: "an-explicit-jwt-secret-with-at-least-32-chars",
        BOUSSOLE_TEST_AUTH_BYPASS: "0",
      },
    }));
    await useFakes();
    const login = async (username: string, password: string) => {
      const body = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      }).then((r) => r.json());
      return { Authorization: `Bearer ${body.data.token as string}` };
    };
    const admin = await login("admin", "secret");
    await fetch(`${baseUrl}/api/workspaces/users`, {
      method: "POST",
      headers: { ...admin, "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "adam",
        displayName: "Adam",
        password: "adam-secret",
      }),
    });
    const adam = await login("adam", "adam-secret");

    const started = await fetch(`${baseUrl}/api/spontaneous/outreach`, {
      method: "POST",
      headers: { ...admin, "Content-Type": "application/json" },
      body: JSON.stringify({ company: "Acme" }),
    }).then((r) => r.json());
    await waitReady(baseUrl, started.data.id, admin);

    const read = await fetch(
      `${baseUrl}/api/spontaneous/outreach/${started.data.id}`,
      { headers: adam },
    );
    expect(read.status).toBe(404);
    const adamHistory = await fetch(`${baseUrl}/api/spontaneous/outreach`, {
      headers: adam,
    }).then((r) => r.json());
    expect(adamHistory.data).toEqual([]);

    const adamStart = await fetch(`${baseUrl}/api/spontaneous/outreach`, {
      method: "POST",
      headers: { ...adam, "Content-Type": "application/json" },
      body: JSON.stringify({ company: "Acme" }),
    });
    expect(adamStart.status).toBe(422);
    expect((await adamStart.json()).error.message).toMatch(/not signed in/);
  });
});
