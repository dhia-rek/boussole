import { existsSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "..");
const extractorsDir = join(repoRoot, "extractors");

/**
 * Every extractor workspace with a manifest must ship in Docker images and
 * sync in compose dev mode; otherwise the source shows in the UI but fails at
 * runtime as "not available" (see AGENTS.md → Deployment Note). Discovered
 * from disk so a newly added extractor cannot be forgotten.
 */
const extractorsWithManifest = readdirSync(extractorsDir, {
  withFileTypes: true,
})
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter(
    (name) =>
      existsSync(join(extractorsDir, name, "manifest.ts")) ||
      existsSync(join(extractorsDir, name, "src", "manifest.ts")),
  )
  .sort();

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("extractor deployment config", () => {
  it("discovers the extractor workspaces", () => {
    expect(extractorsWithManifest).toEqual(
      expect.arrayContaining(["jobspy", "wttj", "companyats", "adzuna"]),
    );
    // Sources outside France were removed together with their workspaces.
    for (const removed of [
      "gradcracker",
      "ukvisajobs",
      "seek",
      "naukri",
      "jobindex",
      "golangjobs",
      "remoteco",
      "weworkremotely",
      "workingnomads",
    ]) {
      expect(extractorsWithManifest).not.toContain(removed);
    }
  });

  it.each(
    extractorsWithManifest,
  )("ships the %s extractor in both Docker build stages", async (name) => {
    const dockerfile = await readFile(join(repoRoot, "Dockerfile"), "utf8");

    if (existsSync(join(extractorsDir, name, "package.json"))) {
      expect(
        countOccurrences(
          dockerfile,
          `COPY extractors/${name}/package*.json ./extractors/${name}/`,
        ),
      ).toBeGreaterThanOrEqual(2);
    }
    expect(
      countOccurrences(
        dockerfile,
        `COPY extractors/${name} ./extractors/${name}\n`,
      ),
    ).toBeGreaterThanOrEqual(2);
  });

  it.each(
    extractorsWithManifest,
  )("syncs the %s extractor in compose development mode", async (name) => {
    const composeFile = await readFile(
      join(repoRoot, "docker-compose.yml"),
      "utf8",
    );

    expect(composeFile).toMatch(
      new RegExp(`path: \\./extractors/${name}(/src)?\\n`),
    );
    expect(composeFile).toMatch(
      new RegExp(`target: /app/extractors/${name}(/src)?\\n`),
    );
  });
});
