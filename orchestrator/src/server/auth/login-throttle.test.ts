import { describe, expect, it } from "vitest";
import {
  clientAddress,
  createLoginThrottle,
  LOGIN_WINDOW_MS,
  MAX_FAILURES_PER_IP,
  MAX_FAILURES_PER_USERNAME,
} from "./login-throttle";

function clock(start = 1_000_000) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("login throttle", () => {
  it("locks a username after repeated failures until the window passes", () => {
    const time = clock();
    const throttle = createLoginThrottle(time.now);
    for (let attempt = 0; attempt < MAX_FAILURES_PER_USERNAME; attempt += 1) {
      expect(throttle.retryAfterSeconds("1.1.1.1", "Admin")).toBe(0);
      throttle.recordFailure("1.1.1.1", "Admin");
    }
    // Same user from another address is still locked (case-insensitive).
    expect(throttle.retryAfterSeconds("2.2.2.2", "admin")).toBe(
      LOGIN_WINDOW_MS / 1000,
    );
    time.advance(LOGIN_WINDOW_MS - 60_000);
    expect(throttle.retryAfterSeconds("2.2.2.2", "admin")).toBe(60);
    time.advance(60_001);
    expect(throttle.retryAfterSeconds("2.2.2.2", "admin")).toBe(0);
  });

  it("limits one address trying many usernames", () => {
    const throttle = createLoginThrottle(clock().now);
    for (let attempt = 0; attempt < MAX_FAILURES_PER_IP; attempt += 1) {
      throttle.recordFailure("6.6.6.6", `user-${attempt}`);
    }
    expect(
      throttle.retryAfterSeconds("6.6.6.6", "someone-new"),
    ).toBeGreaterThan(0);
    expect(throttle.retryAfterSeconds("7.7.7.7", "someone-new")).toBe(0);
  });

  it("clears the username counter after a successful sign-in", () => {
    const throttle = createLoginThrottle(clock().now);
    for (
      let attempt = 0;
      attempt < MAX_FAILURES_PER_USERNAME - 1;
      attempt += 1
    ) {
      throttle.recordFailure("1.1.1.1", "admin");
    }
    throttle.recordSuccess("1.1.1.1", "admin");
    throttle.recordFailure("1.1.1.1", "admin");
    expect(throttle.retryAfterSeconds("1.1.1.1", "admin")).toBe(0);
  });
});

describe("clientAddress", () => {
  it("trusts the Cloudflare header only from a local tunnel", () => {
    expect(
      clientAddress("127.0.0.1", { "cf-connecting-ip": "203.0.113.9" }),
    ).toBe("203.0.113.9");
    expect(clientAddress("::1", { "cf-connecting-ip": "203.0.113.9" })).toBe(
      "203.0.113.9",
    );
    expect(
      clientAddress("198.51.100.4", { "cf-connecting-ip": "203.0.113.9" }),
    ).toBe("198.51.100.4");
    expect(clientAddress(undefined, {})).toBe("unknown");
  });
});
