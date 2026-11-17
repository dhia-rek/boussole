export function shouldRetryAttempt(args: {
  message: string;
  status?: number;
}): boolean {
  return (
    args.message.includes("parse") ||
    args.status === 429 ||
    (args.status !== undefined && args.status >= 500 && args.status <= 599) ||
    args.message.toLowerCase().includes("timeout") ||
    args.message.toLowerCase().includes("timed out") ||
    args.message.toLowerCase().includes("fetch failed")
  );
}

export function getRetryDelayMs(baseDelayMs: number, attempt: number): number {
  return baseDelayMs * attempt;
}

/** Rate-limit waits beyond this are not worth blocking a request for. */
export const MAX_RATE_LIMIT_WAIT_MS = 60_000;
/** Rate-limited requests are retried at most this many extra times. */
export const MAX_RATE_LIMIT_RETRIES = 2;

function durationToMs(value: string): number | null {
  let total = 0;
  let matched = false;
  for (const match of value.matchAll(/([\d.]+)\s*(ms|h|m|s)/gi)) {
    const amount = Number.parseFloat(match[1] ?? "");
    if (!Number.isFinite(amount)) continue;
    matched = true;
    const unit = (match[2] ?? "s").toLowerCase();
    total +=
      unit === "ms"
        ? amount
        : unit === "h"
          ? amount * 3_600_000
          : unit === "m"
            ? amount * 60_000
            : amount * 1000;
  }
  return matched ? Math.ceil(total) : null;
}

/**
 * How long a provider asked us to wait after a 429: the `Retry-After` header
 * (seconds or HTTP date) or a "try again in 9.85s" / "retry in 1m2s" hint in
 * the error body (Groq, OpenAI, Gemini). Null when unknown.
 */
export function parseRateLimitDelayMs(args: {
  retryAfterHeader?: string | null;
  body?: string | null;
  now?: number;
}): number | null {
  const header = args.retryAfterHeader?.trim();
  if (header) {
    if (/^\d+(\.\d+)?$/.test(header)) {
      return Math.ceil(Number.parseFloat(header) * 1000);
    }
    const date = Date.parse(header);
    if (Number.isFinite(date)) {
      return Math.max(0, date - (args.now ?? Date.now()));
    }
  }
  const hint =
    /(?:try again|retry)\s+(?:in|after)\s+((?:[\d.]+\s*(?:ms|h|m|s)\s*)+)/i.exec(
      args.body ?? "",
    );
  return hint?.[1] ? durationToMs(hint[1]) : null;
}
