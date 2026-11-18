import { describe, expect, it } from "vitest";
import { shouldRetryQuery } from "./queryClient";

describe("shouldRetryQuery", () => {
  it("retries network and server errors once", () => {
    expect(shouldRetryQuery(0, new Error("network"))).toBe(true);
    expect(shouldRetryQuery(0, { status: 502 })).toBe(true);
    expect(shouldRetryQuery(1, { status: 502 })).toBe(false);
  });

  it("never retries a definite client answer", () => {
    for (const status of [400, 403, 404, 409, 422]) {
      expect(shouldRetryQuery(0, { status })).toBe(false);
    }
  });
});
