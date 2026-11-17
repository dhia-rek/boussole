import { describe, expect, it } from "vitest";
import { getRetryDelayMs, shouldRetryAttempt } from "./retry-policy";

describe("retry-policy", () => {
  it("retries parse errors", () => {
    expect(
      shouldRetryAttempt({ message: "Failed to parse JSON", status: 200 }),
    ).toBe(true);
  });

  it("retries on 429 and 5xx", () => {
    expect(shouldRetryAttempt({ message: "rate limited", status: 429 })).toBe(
      true,
    );
    expect(shouldRetryAttempt({ message: "server error", status: 503 })).toBe(
      true,
    );
  });

  it("retries timeout and fetch failures", () => {
    expect(
      shouldRetryAttempt({ message: "Request timeout occurred", status: 0 }),
    ).toBe(true);
    expect(
      shouldRetryAttempt({ message: "TypeError: fetch failed", status: 0 }),
    ).toBe(true);
  });

  it("does not retry non-retryable 4xx", () => {
    expect(
      shouldRetryAttempt({
        message: "LLM API error: 400 bad request",
        status: 400,
      }),
    ).toBe(false);
  });

  it("preserves backoff multiplier behavior", () => {
    expect(getRetryDelayMs(500, 1)).toBe(500);
    expect(getRetryDelayMs(500, 2)).toBe(1000);
  });
});

describe("parseRateLimitDelayMs", () => {
  it("reads Retry-After seconds and dates", async () => {
    const { parseRateLimitDelayMs } = await import("./retry-policy");
    expect(parseRateLimitDelayMs({ retryAfterHeader: "7" })).toBe(7000);
    expect(
      parseRateLimitDelayMs({
        retryAfterHeader: new Date(10_000).toUTCString(),
        now: 4_000,
      }),
    ).toBe(6000);
  });

  it("reads provider hints from the error body", async () => {
    const { parseRateLimitDelayMs } = await import("./retry-policy");
    expect(
      parseRateLimitDelayMs({
        body: "Rate limit reached ... Please try again in 9.855s. Need more tokens?",
      }),
    ).toBe(9855);
    expect(parseRateLimitDelayMs({ body: "Please try again in 1m2.5s." })).toBe(
      62_500,
    );
    expect(parseRateLimitDelayMs({ body: "Please retry in 20ms" })).toBe(20);
    expect(parseRateLimitDelayMs({ body: "quota exceeded" })).toBeNull();
    expect(parseRateLimitDelayMs({})).toBeNull();
  });
});
