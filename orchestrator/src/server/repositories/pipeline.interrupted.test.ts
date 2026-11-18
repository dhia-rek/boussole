import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe.sequential("pipeline runs cut off by a restart", () => {
  let tempDir: string;
  let pipelineRepo: Awaited<typeof import("./pipeline")>;
  let runWithRequestContext: Awaited<
    typeof import("@infra/request-context")
  >["runWithRequestContext"];

  beforeEach(async () => {
    vi.resetModules();
    tempDir = await mkdtemp(join(tmpdir(), "boussole-pipeline-runs-"));
    process.env.DATA_DIR = tempDir;
    process.env.NODE_ENV = "test";
    await import("../db/migrate");
    pipelineRepo = await import("./pipeline");
    ({ runWithRequestContext } = await import("@infra/request-context"));
  });

  afterEach(async () => {
    const { closeDb } = await import("../db/index");
    closeDb();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("marks every workspace's leftover running runs as failed at startup", async () => {
    const inWorkspace = <T>(tenantId: string, fn: () => Promise<T>) =>
      runWithRequestContext({ tenantId }, fn);
    const { db, schema } = await import("../db/index");
    for (const id of ["tenant-a", "tenant-b"]) {
      await db.insert(schema.tenants).values({ id, name: id, slug: id });
    }

    const done = await inWorkspace("tenant-a", async () => {
      const run = await pipelineRepo.createPipelineRun();
      await pipelineRepo.updatePipelineRun(run.id, {
        status: "completed",
        completedAt: new Date().toISOString(),
      });
      return run;
    });
    const cutA = await inWorkspace("tenant-a", () =>
      pipelineRepo.createPipelineRun(),
    );
    const cutB = await inWorkspace("tenant-b", () =>
      pipelineRepo.createPipelineRun(),
    );

    expect(pipelineRepo.markInterruptedPipelineRuns()).toBe(2);

    const runsA = await inWorkspace("tenant-a", () =>
      pipelineRepo.getRecentPipelineRuns(),
    );
    const byId = new Map(runsA.map((run) => [run.id, run]));
    expect(byId.get(cutA.id)).toMatchObject({
      status: "failed",
      errorMessage: pipelineRepo.INTERRUPTED_RUN_MESSAGE,
    });
    // When it really stopped is unknown, so "Last run … ago" uses its start.
    expect(byId.get(cutA.id)?.completedAt).toBeNull();
    expect(byId.get(done.id)?.status).toBe("completed");
    const [runB] = await inWorkspace("tenant-b", () =>
      pipelineRepo.getRecentPipelineRuns(),
    );
    expect(runB).toMatchObject({ id: cutB.id, status: "failed" });

    // Nothing left to mark the second time.
    expect(pipelineRepo.markInterruptedPipelineRuns()).toBe(0);

    // The last finished search ignores failed runs and other workspaces.
    expect(
      await inWorkspace("tenant-a", () =>
        pipelineRepo.getLatestCompletedPipelineRun(),
      ),
    ).toMatchObject({ id: done.id });
    expect(
      await inWorkspace("tenant-b", () =>
        pipelineRepo.getLatestCompletedPipelineRun(),
      ),
    ).toBeNull();
  });
});
