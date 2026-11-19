import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CamoufoxFetcher } from "camoufox-js/dist/pkgman.js";

const githubToken = process.env.GITHUB_TOKEN?.trim() || "";
const originalFetch = globalThis.fetch;

function getUrl(input) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  if (input && typeof input === "object" && "url" in input) {
    return String(input.url);
  }
  return "";
}

function shouldAttachGithubToken(url) {
  return (
    url.startsWith("https://api.github.com/") ||
    url.startsWith("https://github.com/") ||
    url.startsWith("https://objects.githubusercontent.com/")
  );
}

if (githubToken) {
  console.log("Using GITHUB_TOKEN for Camoufox GitHub downloads.");

  globalThis.fetch = async (input, init) => {
    const url = getUrl(input);
    if (!shouldAttachGithubToken(url)) {
      return originalFetch(input, init);
    }

    const headers = new Headers(
      init?.headers ??
        (input && typeof input === "object" && "headers" in input
          ? input.headers
          : undefined),
    );

    if (!headers.has("authorization")) {
      headers.set("authorization", `Bearer ${githubToken}`);
    }

    if (url.startsWith("https://api.github.com/")) {
      headers.set("accept", "application/vnd.github+json");
      headers.set("x-github-api-version", "2022-11-28");
    }

    return originalFetch(input, { ...init, headers });
  };
}

// Camoufox is optional: browser-utils falls back to Playwright's Firefox,
// which the image also ships. Its GitHub repository (daijro/camoufox) has
// disappeared, so a failed download must never stop the build.
try {
  await new CamoufoxFetcher().install();
} catch (error) {
  console.warn(
    `Camoufox not installed (${error instanceof Error ? error.message : String(error)}). Hiring Cafe will use Playwright's Firefox instead.`,
  );
  // The production stage copies this folder, so it must exist.
  mkdirSync(join(homedir(), ".cache", "camoufox"), { recursive: true });
}
