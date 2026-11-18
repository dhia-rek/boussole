import type { Server } from "node:http";
import { FOLLOW_UP_REASON_CODE } from "@shared/types";
import { afterEach, describe, expect, it } from "vitest";
import { startServer, stopServer } from "./test-utils";

const DAY_MS = 86_400_000;
const daysAgo = (days: number) =>
  new Date(Date.now() - days * DAY_MS).toISOString();

describe.sequential("Guide API routes", () => {
  let server: Server;
  let baseUrl: string;
  let closeDb: () => void;
  let tempDir: string;

  afterEach(async () => {
    await stopServer({ server, closeDb, tempDir });
  });

  async function addJob(input: {
    title: string;
    employer: string;
    status: "discovered" | "ready" | "applied";
    score: number;
    appliedDaysAgo?: number;
  }) {
    const { createJob, updateJob } = await import("@server/repositories/jobs");
    const job = await createJob({
      source: "manual",
      title: input.title,
      employer: input.employer,
      jobUrl: `https://example.com/${encodeURIComponent(input.title)}`,
    });
    await updateJob(job.id, {
      status: input.status,
      suitabilityScore: input.score,
      suitabilityReason: "Strong match: data quality and automation.",
      jobBrief: JSON.stringify({
        role_summary: "Build data quality checks for the risk team.",
      }),
      ...(input.appliedDaysAgo !== undefined
        ? { appliedAt: daysAgo(input.appliedDaysAgo) }
        : {}),
    });
    return job.id;
  }

  it("returns the next steps and the review list, and drops a sent follow-up", async () => {
    ({ server, baseUrl, closeDb, tempDir } = await startServer());
    const goodId = await addJob({
      title: "Data Quality Engineer",
      employer: "Acme",
      status: "ready",
      score: 86,
    });
    await addJob({
      title: "Weak",
      employer: "Other",
      status: "ready",
      score: 30,
    });
    const appliedId = await addJob({
      title: "Automation Engineer",
      employer: "Alan",
      status: "applied",
      score: 80,
      appliedDaysAgo: 10,
    });

    const res = await fetch(`${baseUrl}/api/guide/next-steps`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.meta.requestId).toBe("string");
    const kinds = body.data.steps.map((step: { kind: string }) => step.kind);
    // No CV in a fresh workspace, a follow-up is due, never searched, one good match.
    expect(kinds).toEqual(["add_cv", "follow_up", "find_jobs", "choose_job"]);
    expect(body.data.steps[1]).toMatchObject({
      title: "Follow up with Alan",
      jobId: appliedId,
      secondary: { action: "log_follow_up" },
    });

    const review = await fetch(`${baseUrl}/api/guide/review`).then((r) =>
      r.json(),
    );
    expect(review.data).toEqual([
      expect.objectContaining({
        id: goodId,
        employer: "Acme",
        score: 86,
        roleSummary: "Build data quality checks for the risk team.",
      }),
    ]);

    const progress = await fetch(
      `${baseUrl}/api/guide/progress/${goodId}`,
    ).then((r) => r.json());
    expect(progress.data).toEqual({
      jobId: goodId,
      done: { cv: false, company: false, message: false },
      applied: false,
      nextStep: "cv",
    });
    const appliedProgress = await fetch(
      `${baseUrl}/api/guide/progress/${appliedId}`,
    ).then((r) => r.json());
    expect(appliedProgress.data.applied).toBe(true);
    const missing = await fetch(`${baseUrl}/api/guide/progress/nope`);
    expect(missing.status).toBe(404);
    expect((await missing.json()).error.code).toBe("NOT_FOUND");

    // "I've sent it" logs a timeline note without changing the status.
    const logged = await fetch(`${baseUrl}/api/jobs/${appliedId}/stages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toStage: "no_change",
        metadata: {
          eventType: "note",
          eventLabel: "Followed up",
          reasonCode: FOLLOW_UP_REASON_CODE,
          actor: "user",
        },
      }),
    });
    expect(logged.status).toBe(200);
    const after = await fetch(`${baseUrl}/api/guide/next-steps`).then((r) =>
      r.json(),
    );
    expect(after.data.steps.map((step: { kind: string }) => step.kind)).toEqual(
      ["add_cv", "find_jobs", "choose_job"],
    );
    const job = await fetch(`${baseUrl}/api/jobs/${appliedId}`).then((r) =>
      r.json(),
    );
    expect(job.data.status).toBe("applied");
  });

  it("keeps each workspace's guide private", async () => {
    ({ server, baseUrl, closeDb, tempDir } = await startServer({
      env: {
        BASIC_AUTH_USER: "admin",
        BASIC_AUTH_PASSWORD: "secret",
        JWT_SECRET: "an-explicit-jwt-secret-with-at-least-32-chars",
        BOUSSOLE_TEST_AUTH_BYPASS: "0",
      },
    }));
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

    const { runWithRequestContext } = await import("@infra/request-context");
    const { getActiveTenantId } = await import("@server/tenancy/context");
    const me = await fetch(`${baseUrl}/api/auth/me`, { headers: admin }).then(
      (r) => r.json(),
    );
    const adminTenant = me.data?.user?.workspaceId as string | undefined;
    expect(adminTenant).toBeTruthy();
    const adminJobId = await runWithRequestContext(
      { tenantId: adminTenant as string },
      async () => {
        expect(getActiveTenantId()).toBe(adminTenant);
        return addJob({
          title: "Secret Admin Job",
          employer: "Acme",
          status: "ready",
          score: 90,
        });
      },
    );

    const adminReview = await fetch(`${baseUrl}/api/guide/review`, {
      headers: admin,
    }).then((r) => r.json());
    expect(adminReview.data.map((item: { id: string }) => item.id)).toEqual([
      adminJobId,
    ]);

    const adamReview = await fetch(`${baseUrl}/api/guide/review`, {
      headers: adam,
    }).then((r) => r.json());
    expect(adamReview.data).toEqual([]);
    const adamProgress = await fetch(
      `${baseUrl}/api/guide/progress/${adminJobId}`,
      { headers: adam },
    );
    expect(adamProgress.status).toBe(404);
    const adamSteps = await fetch(`${baseUrl}/api/guide/next-steps`, {
      headers: adam,
    }).then((r) => r.json());
    expect(JSON.stringify(adamSteps.data)).not.toContain("Acme");
    expect(
      adamSteps.data.steps.some(
        (step: { kind: string }) => step.kind === "choose_job",
      ),
    ).toBe(false);
  });
});
