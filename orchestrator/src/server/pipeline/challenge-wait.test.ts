import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolveChallengeWaitTimeoutMs,
  waitForChallengesSolved,
} from "./orchestrator";

describe("challenge wait", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("defaults to 10 minutes and accepts a positive override", () => {
    expect(resolveChallengeWaitTimeoutMs(undefined)).toBe(600_000);
    expect(resolveChallengeWaitTimeoutMs("")).toBe(600_000);
    expect(resolveChallengeWaitTimeoutMs("-5")).toBe(600_000);
    expect(resolveChallengeWaitTimeoutMs("abc")).toBe(600_000);
    expect(resolveChallengeWaitTimeoutMs("90000")).toBe(90_000);
  });

  it("resolves true as soon as the challenges are solved", async () => {
    vi.useFakeTimers();
    let solve: (() => void) | null = null;
    const waiting = waitForChallengesSolved({
      timeoutMs: 1_000,
      register: (resolve) => {
        solve = resolve;
      },
    });
    (solve as unknown as () => void)();
    await expect(waiting).resolves.toBe(true);
  });

  it("gives up after the timeout so unattended runs never hang", async () => {
    vi.useFakeTimers();
    const waiting = waitForChallengesSolved({
      timeoutMs: 1_000,
      register: () => {},
    });
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(waiting).resolves.toBe(false);
  });

  it("ends the wait immediately when the person skips", async () => {
    vi.useFakeTimers();
    let skip: (() => void) | null = null;
    const waiting = waitForChallengesSolved({
      timeoutMs: 600_000,
      register: (_resolve, onSkip) => {
        skip = onSkip;
      },
    });
    (skip as unknown as () => void)();
    await expect(waiting).resolves.toBe(false);
  });
});
