/**
 * Error helpers shared by the Hiring Cafe child process (main.ts) and the
 * orchestrator-side runner (run.ts). Kept free of browser imports so they can
 * be unit tested without launching Playwright.
 */

/** Prefix main.ts prints (on stderr) right before exiting with code 1. */
export const HIRING_CAFE_FAILURE_PREFIX = "Hiring Cafe extractor failed: ";

const MAX_FAILURE_REASON_LENGTH = 300;

/**
 * Thrown when hiring.cafe serves a Cloudflare challenge the headless browser
 * could not pass. Needs a human (the pipeline's challenge prompt), not a
 * retry: the challenge is deterministic for a given browser fingerprint.
 */
export class CloudflareChallengeError extends Error {
  readonly url: string;

  constructor(url: string) {
    super(
      `Cloudflare challenge at ${url} could not be passed by the headless browser`,
    );
    this.name = "CloudflareChallengeError";
    this.url = url;
  }
}

/**
 * Only browser start-up/navigation problems justify retrying with vanilla
 * Firefox. Retrying a Cloudflare challenge with another browser just hits the
 * same wall again — and when Playwright's own Firefox build is not installed
 * it replaces the real cause with an "Executable doesn't exist" launch error.
 */
export function shouldRetryWithVanillaFirefox(error: unknown): boolean {
  return !(error instanceof CloudflareChallengeError);
}

/** Extracts the failure reason from a child output line, if it is one. */
export function parseHiringCafeFailureLine(line: string): string | null {
  const index = line.indexOf(HIRING_CAFE_FAILURE_PREFIX);
  if (index < 0) return null;
  const reason = line
    .slice(index + HIRING_CAFE_FAILURE_PREFIX.length)
    .replace(/\s+/g, " ")
    .trim();
  if (!reason) return null;
  return reason.length > MAX_FAILURE_REASON_LENGTH
    ? `${reason.slice(0, MAX_FAILURE_REASON_LENGTH)}…`
    : reason;
}

/** Error message for a non-zero child exit, including the reason if known. */
export function describeHiringCafeExit(args: {
  code: number | null;
  failureReason?: string | null;
  challengeUrl?: string;
}): string {
  if (args.challengeUrl) {
    return `Hiring Cafe is behind a Cloudflare challenge (${args.challengeUrl}) that the headless browser could not pass; a human needs to solve it before this source can run.`;
  }
  const base = `Hiring Cafe extractor exited with code ${args.code ?? "unknown"}`;
  return args.failureReason ? `${base}: ${args.failureReason}` : base;
}
