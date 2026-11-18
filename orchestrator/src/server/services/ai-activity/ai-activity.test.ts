import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe.sequential("AI activity", () => {
  let tempDir: string;
  let activity: Awaited<typeof import("./index")>;
  let runWithRequestContext: Awaited<
    typeof import("@infra/request-context")
  >["runWithRequestContext"];

  beforeEach(async () => {
    vi.resetModules();
    tempDir = await mkdtemp(join(tmpdir(), "boussole-ai-activity-"));
    process.env.DATA_DIR = tempDir;
    process.env.NODE_ENV = "test";
    await import("@server/db/migrate");
    activity = await import("./index");
    ({ runWithRequestContext } = await import("@infra/request-context"));
  });

  afterEach(async () => {
    const { closeDb } = await import("@server/db/index");
    closeDb();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("records what was sent and answered, and failures", async () => {
    const result = await activity.trackAiCall(
      {
        name: "job_brief",
        provider: "claude",
        model: "sonnet",
        prompt: "Summarise this job: Data Engineer at Acme.",
        jobId: "job-1",
      },
      async () => ({ text: '{"role_summary":"Data pipelines"}' }),
    );
    expect(result.text).toContain("Data pipelines");

    await expect(
      activity.trackAiCall(
        { name: "cv_check", provider: "codex", model: null, prompt: "Check" },
        async () => {
          throw new Error("rate limited");
        },
      ),
    ).rejects.toThrow("rate limited");

    const [failed, ok] = await activity.listAiActivity();
    expect(ok).toMatchObject({
      label: "Job summary",
      provider: "claude",
      model: "sonnet",
      jobId: "job-1",
      status: "ok",
      promptPreview: "Summarise this job: Data Engineer at Acme.",
      responsePreview: '{"role_summary":"Data pipelines"}',
    });
    expect(ok?.durationMs).toBeGreaterThanOrEqual(0);
    expect(failed).toMatchObject({
      label: "CV check",
      status: "error",
      error: "rate limited",
    });
  });

  it("keeps long prompts readable and only the newest requests", async () => {
    const long = `${"a".repeat(7000)}MIDDLE${"z".repeat(3000)}`;
    const preview = activity.preview(long);
    expect(preview.startsWith("a".repeat(100))).toBe(true);
    expect(preview).toContain("characters not shown");
    expect(preview.endsWith("z".repeat(100))).toBe(true);
    expect(preview).not.toContain("MIDDLE");

    for (let index = 0; index < activity.MAX_KEPT + 5; index += 1) {
      await activity.trackAiCall(
        {
          name: "job_brief",
          provider: "claude",
          model: null,
          prompt: `p${index}`,
        },
        async () => ({ text: "ok" }),
      );
    }
    const items = await activity.listAiActivity(1_000);
    expect(items).toHaveLength(activity.MAX_KEPT);
  });

  it("marks requests cut off by a restart and keeps workspaces apart", async () => {
    const { db, schema } = await import("@server/db/index");
    await db
      .insert(schema.tenants)
      .values({ id: "tenant-b", name: "b", slug: "b" });
    let release: () => void = () => {};
    const pending = activity.trackAiCall(
      { name: "job_brief", provider: "claude", model: null, prompt: "slow" },
      () =>
        new Promise<{ text: string }>((resolve) => {
          release = () => resolve({ text: "late" });
        }),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await activity.listAiActivity())[0]?.status).toBe("running");
    expect(activity.markInterruptedAiCalls()).toBe(1);
    expect((await activity.listAiActivity())[0]).toMatchObject({
      status: "error",
      error: "Interrupted: Boussole restarted.",
    });
    release();
    await pending;

    const other = await runWithRequestContext({ tenantId: "tenant-b" }, () =>
      activity.listAiActivity(),
    );
    expect(other).toEqual([]);
  });
});
