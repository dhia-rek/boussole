import { EventEmitter, once } from "node:events";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CloudflareChallengeError,
  describeHiringCafeExit,
  parseHiringCafeFailureLine,
  shouldRetryWithVanillaFirefox,
} from "../src/errors";

const spawnMock = vi.fn();

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const overrides = {
    spawn: (...args: unknown[]) => spawnMock(...args),
    spawnSync: () => ({ status: 0 }),
  };
  return { ...actual, ...overrides, default: { ...actual, ...overrides } };
});

// Keep the runner away from the real storage directory.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const overrides = {
    mkdir: vi.fn(async () => undefined),
    rm: vi.fn(async () => undefined),
    readFile: vi.fn(async () => "[]"),
  };
  return { ...actual, ...overrides, default: { ...actual, ...overrides } };
});

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function fixtureLines(name: string): string[] {
  return readFileSync(join(FIXTURES_DIR, name), "utf-8").split("\n");
}

/** Fake child process that replays captured output, then exits. */
function createFakeChild(lines: string[], exitCode: number) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
  };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();

  setImmediate(async () => {
    for (const line of lines) {
      // main.ts prints failures with console.error and progress on stdout.
      const target =
        line.startsWith("FORSA_PROGRESS ") || line.startsWith(">")
          ? child.stdout
          : child.stderr;
      target.write(`${line}\n`);
    }
    child.stdout.end();
    child.stderr.end();
    await Promise.all([once(child.stdout, "end"), once(child.stderr, "end")]);
    setImmediate(() => child.emit("close", exitCode));
  });

  return child;
}

describe("hiring cafe error helpers", () => {
  it("never retries a Cloudflare challenge with another browser", () => {
    expect(
      shouldRetryWithVanillaFirefox(
        new CloudflareChallengeError("https://hiring.cafe"),
      ),
    ).toBe(false);
    expect(shouldRetryWithVanillaFirefox(new Error("net::ERR_TIMED_OUT"))).toBe(
      true,
    );
  });

  it("extracts the failure reason printed by the child process", () => {
    expect(
      parseHiringCafeFailureLine(
        "Hiring Cafe extractor failed: browserType.launch: Executable doesn't exist",
      ),
    ).toBe("browserType.launch: Executable doesn't exist");
    expect(parseHiringCafeFailureLine("npm error code 1")).toBeNull();
    expect(
      parseHiringCafeFailureLine(
        `Hiring Cafe extractor failed: ${"x".repeat(1000)}`,
      )?.length,
    ).toBeLessThanOrEqual(301);
  });

  it("describes exits with and without a known reason", () => {
    expect(describeHiringCafeExit({ code: 1 })).toBe(
      "Hiring Cafe extractor exited with code 1",
    );
    expect(describeHiringCafeExit({ code: 1, failureReason: "boom" })).toBe(
      "Hiring Cafe extractor exited with code 1: boom",
    );
    expect(
      describeHiringCafeExit({
        code: 1,
        challengeUrl: "https://hiring.cafe",
      }),
    ).toMatch(/Cloudflare challenge \(https:\/\/hiring\.cafe\)/);
  });
});

describe("runHiringCafe failure reporting", () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  it("reports a Cloudflare challenge instead of a bare exit code", async () => {
    spawnMock.mockImplementation(() =>
      createFakeChild(fixtureLines("child-output-challenge.txt"), 1),
    );
    const { runHiringCafe } = await import("../src/run");

    const result = await runHiringCafe({
      searchTerms: ["machine learning intern"],
      country: "france",
      countryKey: "france",
      maxJobsPerTerm: 3,
    });

    expect(result.success).toBe(false);
    expect(result.challengeRequired).toBe("https://hiring.cafe");
    expect(result.error).toMatch(/Cloudflare challenge/);
    expect(result.error).not.toMatch(/exited with code/);
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it("includes the child's failure reason for other errors", async () => {
    spawnMock.mockImplementation(() =>
      createFakeChild(fixtureLines("child-output-api-error.txt"), 1),
    );
    const { runHiringCafe } = await import("../src/run");

    const result = await runHiringCafe({
      searchTerms: ["machine learning intern"],
      country: "france",
      countryKey: "france",
    });

    expect(result.success).toBe(false);
    expect(result.challengeRequired).toBeUndefined();
    expect(result.error).toBe(
      "Hiring Cafe extractor exited with code 1: Hiring Cafe API /api/search-jobs failed (500 Internal Server Error): upstream unavailable",
    );
  });
});
