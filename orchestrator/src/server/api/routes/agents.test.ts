// @vitest-environment node
import type { Server } from "node:http";
import type {
  AgentRun,
  AgentRunStreamMessage,
  CreateJobInput,
} from "@shared/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startServer, stopServer } from "./test-utils";

const AUTH_ENV = {
  BASIC_AUTH_USER: "admin",
  BASIC_AUTH_PASSWORD: "secret",
  JWT_SECRET: "an-explicit-jwt-secret-with-at-least-32-chars",
  BOUSSOLE_TEST_AUTH_BYPASS: "0",
  LLM_PROVIDER: "claude_cli",
};

async function login(baseUrl: string, username: string, password: string) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const body = await res.json();
  expect(res.status).toBe(200);
  const token = body.data.token as string;
  const me = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json());
  return { token, tenantId: me.data.user.workspaceId as string };
}

async function api(
  baseUrl: string,
  token: string,
  method: string,
  path: string,
  body?: unknown,
) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: await res.json() };
}

async function seedJob(tenantId: string, input: Partial<CreateJobInput> = {}) {
  const { runWithRequestContext } = await import("@infra/request-context");
  const { createJob } = await import("@server/repositories/jobs");
  return runWithRequestContext({ tenantId }, () =>
    createJob({
      source: "manual",
      title: "Data Quality Analyst (H/F)",
      employer: "Acme",
      jobUrl: `https://example.com/jobs/${Math.random().toString(36).slice(2)}`,
      jobDescription: "Analyste qualité des données. Python, SQL.",
      ...input,
    }),
  );
}

async function setDecision(
  tenantId: string,
  jobId: string,
  status: "applied" | "skipped",
) {
  const { runWithRequestContext } = await import("@infra/request-context");
  const { updateJob } = await import("@server/repositories/jobs");
  await runWithRequestContext({ tenantId }, () => updateJob(jobId, { status }));
}

async function useScriptedModel(
  reply?: (prompt: string) => string,
  options: { block?: boolean } = {},
) {
  const agents = await import("@server/services/agents");
  const { ChatClaudeCli } = await import(
    "@server/services/agents/chat-claude-cli"
  );
  const { scriptedApplicationReply } = await import(
    "@server/services/agents/testing/scripted-cli"
  );
  const answer = reply ?? scriptedApplicationReply;
  agents.__setAgentModelFactoryForTests(
    ({ onCliCall }) =>
      new ChatClaudeCli({
        onCliCall,
        runner: ({ prompt, signal }) =>
          options.block
            ? new Promise<string>((_resolve, reject) => {
                signal?.addEventListener("abort", () =>
                  reject(new Error("Claude CLI invocation was aborted.")),
                );
              })
            : Promise.resolve(answer(prompt)),
      }),
  );
}

async function waitForRun(
  baseUrl: string,
  token: string,
  runId: string,
): Promise<AgentRun> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const { body } = await api(
      baseUrl,
      token,
      "GET",
      `/api/agents/runs/${runId}`,
    );
    const run = body.data as AgentRun;
    if (["succeeded", "failed", "cancelled"].includes(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`run ${runId} did not finish`);
}

async function readStream(
  baseUrl: string,
  token: string,
  runId: string,
): Promise<AgentRunStreamMessage[]> {
  const res = await fetch(`${baseUrl}/api/agents/runs/${runId}/events`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/event-stream");
  const text = await res.text();
  return text
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice("data: ".length)));
}

describe.sequential("AI agents API", () => {
  let server: Server;
  let baseUrl: string;
  let closeDb: () => void;
  let tempDir: string;

  beforeEach(async () => {
    ({ server, baseUrl, closeDb, tempDir } = await startServer({
      env: AUTH_ENV,
    }));
  });

  afterEach(async () => {
    const agents = await import("@server/services/agents");
    agents.__setAgentModelFactoryForTests(null);
    await stopServer({ server, closeDb, tempDir });
  });

  it("runs the application agents for a job and streams their progress", async () => {
    const admin = await login(baseUrl, "admin", "secret");
    const job = await seedJob(admin.tenantId);
    await useScriptedModel();

    const started = await api(
      baseUrl,
      admin.token,
      "POST",
      `/api/agents/application/${job.id}`,
    );
    expect(started.status).toBe(202);
    expect(started.body.ok).toBe(true);
    expect(started.body.meta.requestId).toBeTruthy();
    const runId = started.body.data.runId as string;
    expect(started.body.data.run).toMatchObject({
      kind: "application",
      jobId: job.id,
    });

    const messages = await readStream(baseUrl, admin.token, runId);
    const last = messages.at(-1);
    expect(last?.type).toBe("run");
    const run = (last as { type: "run"; run: AgentRun }).run;
    expect(run.status).toBe("succeeded");
    expect(run.output).toMatchObject({
      kind: "application",
      pack: { headline: "Data Quality Analyst", coverLetterLanguage: "fr" },
    });
    expect(run.stats.modelCalls).toBe(13);
    expect(run.stats.toolCalls).toBeGreaterThanOrEqual(10);

    const subagents = messages
      .filter(
        (
          message,
        ): message is Extract<AgentRunStreamMessage, { type: "event" }> =>
          message.type === "event" && message.event.type === "subagent_started",
      )
      .map((message) => message.event.agent);
    expect(subagents.sort()).toEqual(
      ["cover-letter-writer", "critic", "cv-tailor", "job-analyst"].sort(),
    );

    const listed = await api(
      baseUrl,
      admin.token,
      "GET",
      `/api/agents/runs?jobId=${job.id}`,
    );
    expect(listed.body.data.map((item: AgentRun) => item.id)).toEqual([runId]);
  });

  it("allows one run per workspace and cancels a running one", async () => {
    const admin = await login(baseUrl, "admin", "secret");
    const job = await seedJob(admin.tenantId);
    await useScriptedModel(undefined, { block: true });

    const first = await api(
      baseUrl,
      admin.token,
      "POST",
      `/api/agents/application/${job.id}`,
    );
    expect(first.status).toBe(202);
    const runId = first.body.data.runId as string;

    const second = await api(baseUrl, admin.token, "POST", "/api/agents/learn");
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("CONFLICT");

    const cancelled = await api(
      baseUrl,
      admin.token,
      "POST",
      `/api/agents/runs/${runId}/cancel`,
    );
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe("cancelled");
    expect(cancelled.body.data.error).toBeNull();

    const messages = await readStream(baseUrl, admin.token, runId);
    expect(messages.at(-1)).toMatchObject({
      type: "run",
      run: { status: "cancelled" },
    });
  });

  it("learns preferences from decisions and serves the memory file", async () => {
    const admin = await login(baseUrl, "admin", "secret");
    const memoryBefore = await api(
      baseUrl,
      admin.token,
      "GET",
      "/api/agents/memory",
    );
    expect(memoryBefore.body.data).toEqual({
      path: "/memories/preferences.md",
      content: null,
      updatedAt: null,
    });

    for (const [title, status] of [
      ["Data Steward", "applied"],
      ["AI Engineer", "applied"],
      ["Stage Data", "skipped"],
    ] as const) {
      const job = await seedJob(admin.tenantId, { title });
      await setDecision(admin.tenantId, job.id, status);
    }
    await useScriptedModel(
      () => "## Prefers\n- Data governance roles (applied 2, skipped 0)",
    );

    const started = await api(
      baseUrl,
      admin.token,
      "POST",
      "/api/agents/learn",
    );
    expect(started.status).toBe(202);
    const run = await waitForRun(baseUrl, admin.token, started.body.data.runId);
    expect(run.status).toBe("succeeded");
    expect(run.output).toMatchObject({
      kind: "learn",
      result: { updated: true, decisionsConsidered: 3 },
    });

    const memory = await api(baseUrl, admin.token, "GET", "/api/agents/memory");
    expect(memory.body.data.content).toBe(
      "## Prefers\n- Data governance roles (applied 2, skipped 0)",
    );
  });

  it("keeps runs, memory and jobs private to their workspace", async () => {
    const admin = await login(baseUrl, "admin", "secret");
    const job = await seedJob(admin.tenantId);
    await useScriptedModel();
    const started = await api(
      baseUrl,
      admin.token,
      "POST",
      `/api/agents/application/${job.id}`,
    );
    const runId = started.body.data.runId as string;
    await waitForRun(baseUrl, admin.token, runId);

    const created = await api(
      baseUrl,
      admin.token,
      "POST",
      "/api/workspaces/users",
      {
        username: "adam",
        displayName: "Adam",
        password: "adam-secret",
      },
    );
    expect(created.status).toBe(201);
    const adam = await login(baseUrl, "adam", "adam-secret");
    expect(adam.tenantId).not.toBe(admin.tenantId);

    for (const [method, path] of [
      ["GET", `/api/agents/runs/${runId}`],
      ["POST", `/api/agents/runs/${runId}/cancel`],
      ["POST", `/api/agents/application/${job.id}`],
    ] as const) {
      const res = await api(baseUrl, adam.token, method, path);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    }
    const events = await fetch(`${baseUrl}/api/agents/runs/${runId}/events`, {
      headers: { Authorization: `Bearer ${adam.token}` },
    });
    expect(events.status).toBe(404);
    expect(
      (await api(baseUrl, adam.token, "GET", "/api/agents/runs")).body.data,
    ).toEqual([]);
  });

  it("validates input and requires the Claude CLI provider", async () => {
    const admin = await login(baseUrl, "admin", "secret");
    expect(
      (await api(baseUrl, admin.token, "GET", "/api/agents/runs?limit=0"))
        .status,
    ).toBe(400);
    expect(
      (await api(baseUrl, admin.token, "GET", "/api/agents/runs/missing"))
        .status,
    ).toBe(404);

    const patched = await api(baseUrl, admin.token, "PATCH", "/api/settings", {
      llmProvider: "openrouter",
    });
    expect(patched.status).toBe(200);
    const refused = await api(
      baseUrl,
      admin.token,
      "POST",
      "/api/agents/learn",
    );
    expect(refused.status).toBe(409);
    expect(refused.body.error.message).toContain("Claude (CLI)");
  });
});
