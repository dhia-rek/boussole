import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveDesignResumeAssetPath } from "./asset-path";

describe("resolveDesignResumeAssetPath", () => {
  let dataDir: string;
  const previousDataDir = process.env.DATA_DIR;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "boussole-assets-"));
    process.env.DATA_DIR = dataDir;
    mkdirSync(join(dataDir, "design-resume", "assets"), { recursive: true });
    writeFileSync(join(dataDir, "design-resume", "assets", "photo1.jpg"), "x");
  });

  afterEach(() => {
    process.env.DATA_DIR = previousDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("finds a picture whose saved path points at a folder that moved", () => {
    expect(
      resolveDesignResumeAssetPath(
        "/Users/someone/Downloads/old-folder/orchestrator/data/design-resume/assets/photo1.jpg",
      ),
    ).toBe(join(dataDir, "design-resume", "assets", "photo1.jpg"));
  });

  it("keeps a saved path that still exists, and one that can't be found", () => {
    const current = join(dataDir, "design-resume", "assets", "photo1.jpg");
    expect(resolveDesignResumeAssetPath(current)).toBe(current);
    expect(resolveDesignResumeAssetPath("/nowhere/assets/missing.jpg")).toBe(
      "/nowhere/assets/missing.jpg",
    );
  });

  it("never leaves the asset folder", () => {
    writeFileSync(join(dataDir, "secret.txt"), "x");
    expect(
      resolveDesignResumeAssetPath(
        "/old/data/design-resume/assets/../../secret.txt",
      ),
    ).toBe("/old/data/design-resume/assets/../../secret.txt");
  });
});
