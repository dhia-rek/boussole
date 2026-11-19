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

/** Sources of every Dockerfile `COPY` that reads from the build context. */
function dockerfileCopySources(dockerfile: string): string[] {
  const sources: string[] = [];
  for (const line of dockerfile.replace(/\\\n/g, " ").split("\n")) {
    const match = /^\s*COPY\s+(.+)$/i.exec(line);
    if (!match?.[1] || line.includes("--from=")) continue;
    const args = match[1]
      .split(/\s+/)
      .filter((arg) => arg && !arg.startsWith("--"));
    sources.push(...args.slice(0, -1));
  }
  return sources;
}

function existsInRepo(source: string): boolean {
  if (!source.includes("*")) return existsSync(join(repoRoot, source));
  const slash = source.lastIndexOf("/");
  const dir = join(repoRoot, slash === -1 ? "." : source.slice(0, slash));
  const name = source.slice(slash + 1);
  const pattern = new RegExp(
    `^${name.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`,
  );
  return (
    existsSync(dir) && readdirSync(dir).some((entry) => pattern.test(entry))
  );
}

describe("Docker build inputs", () => {
  // CI doesn't build the image, so a removed folder still listed here only
  // shows up when a server builds it.
  it("copies only files and folders that exist", async () => {
    const dockerfile = await readFile(join(repoRoot, "Dockerfile"), "utf8");
    const sources = dockerfileCopySources(dockerfile);
    expect(sources.length).toBeGreaterThan(10);
    expect(sources.filter((source) => !existsInRepo(source))).toEqual([]);
  });

  it("ships a Playwright Firefox for when Camoufox is unavailable", async () => {
    const dockerfile = await readFile(join(repoRoot, "Dockerfile"), "utf8");
    expect(dockerfile).toContain("npx --no-install playwright install firefox");
    expect(dockerfile).toContain(
      "COPY --from=node-deps /ms-playwright /ms-playwright",
    );
    const fetchScript = await readFile(
      join(repoRoot, "scripts", "camoufox-fetch.mjs"),
      "utf8",
    );
    expect(fetchScript).toMatch(
      /try \{\s*await new CamoufoxFetcher\(\)\.install\(\);/,
    );
  });

  it("syncs only folders that exist in compose dev mode", async () => {
    const compose = await readFile(
      join(repoRoot, "docker-compose.yml"),
      "utf8",
    );
    // Only the develop.watch list: env_file paths may be optional.
    const watch = compose.slice(compose.indexOf("watch:"));
    const paths = [...watch.matchAll(/^\s*- path: (\S+)/gm)].map(
      (match) => match[1] ?? "",
    );
    expect(paths.length).toBeGreaterThan(3);
    expect(paths.filter((path) => !existsSync(join(repoRoot, path)))).toEqual(
      [],
    );
  });
});
