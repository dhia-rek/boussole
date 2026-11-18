import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

describe.sequential("envSettings overrides", () => {
  let tempDir: string;
  let closeDb: (() => void) | null = null;

  beforeEach(async () => {
    vi.resetModules();
    tempDir = await mkdtemp(join(tmpdir(), "boussole-env-migration-test-"));
    process.env = {
      ...originalEnv,
      DATA_DIR: tempDir,
      NODE_ENV: "test",
      MODEL: "test-model",
      ADZUNA_APP_KEY: "adzuna-env-default",
    };

    await import("../db/migrate");
    const dbMod = await import("../db/index");
    closeDb = dbMod.closeDb;
  });

  afterEach(async () => {
    if (closeDb) closeDb();
    await rm(tempDir, { recursive: true, force: true });
    process.env = { ...originalEnv };
  });

  it("keeps stored secret overrides out of process env", async () => {
    const settingsRepo = await import("../repositories/settings");
    const { applyStoredEnvOverrides, getEnvSettingsData } = await import(
      "./envSettings"
    );

    await settingsRepo.setSetting("adzunaAppKey", "adzuna-db-override");

    await applyStoredEnvOverrides();

    expect(await settingsRepo.getSetting("adzunaAppKey")).toBe(
      "adzuna-db-override",
    );
    expect(process.env.ADZUNA_APP_KEY).toBe("adzuna-env-default");
    // The stored value wins for this workspace, shown only as a short hint.
    const data = await getEnvSettingsData();
    expect(data.adzunaAppKeyHint).toBe("adzu");
  });

  it("leaves process env unchanged when override is explicitly cleared", async () => {
    const settingsRepo = await import("../repositories/settings");
    const { applyStoredEnvOverrides } = await import("./envSettings");

    await settingsRepo.setSetting("adzunaAppKey", "");

    await applyStoredEnvOverrides();

    expect(process.env.ADZUNA_APP_KEY).toBe("adzuna-env-default");
  });
});
