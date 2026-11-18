import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  trackCanonicalActivationEvent: vi.fn(),
}));

vi.mock("@server/services/activation-funnel", () => ({
  trackCanonicalActivationEvent: mocks.trackCanonicalActivationEvent,
}));

import { trackApplicationAcceptedIfNeeded } from "./analytics";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("trackApplicationAcceptedIfNeeded", () => {
  it("fires the activation event when outcome transitions to offer_accepted", () => {
    trackApplicationAcceptedIfNeeded({
      nextOutcome: "offer_accepted",
      previousOutcome: null,
      source: "linkedin",
    });
    expect(mocks.trackCanonicalActivationEvent).toHaveBeenCalledOnce();
    expect(mocks.trackCanonicalActivationEvent).toHaveBeenCalledWith(
      "application_accepted",
      { source: "linkedin" },
      expect.objectContaining({ urlPath: "/applications/in-progress" }),
    );
  });

  it("does not fire when outcome is already offer_accepted (no re-trigger)", () => {
    trackApplicationAcceptedIfNeeded({
      nextOutcome: "offer_accepted",
      previousOutcome: "offer_accepted",
      source: "linkedin",
    });
    expect(mocks.trackCanonicalActivationEvent).not.toHaveBeenCalled();
  });

  it("does not fire for other outcome transitions", () => {
    trackApplicationAcceptedIfNeeded({
      nextOutcome: "rejected",
      previousOutcome: null,
      source: "linkedin",
    });
    expect(mocks.trackCanonicalActivationEvent).not.toHaveBeenCalled();
  });

  it("does not fire when nextOutcome is null", () => {
    trackApplicationAcceptedIfNeeded({
      nextOutcome: null,
      previousOutcome: null,
      source: "linkedin",
    });
    expect(mocks.trackCanonicalActivationEvent).not.toHaveBeenCalled();
  });

  it("uses closedAt timestamp when provided", () => {
    const closedAt = 1_700_000_000;
    trackApplicationAcceptedIfNeeded({
      nextOutcome: "offer_accepted",
      previousOutcome: null,
      source: "manual",
      closedAt,
    });
    expect(mocks.trackCanonicalActivationEvent).toHaveBeenCalledWith(
      "application_accepted",
      expect.anything(),
      expect.objectContaining({ occurredAt: closedAt * 1000 }),
    );
  });

  it("falls back to Date.now() when closedAt is null", () => {
    vi.useFakeTimers();
    const now = 1_700_000_000_000;
    vi.setSystemTime(now);

    trackApplicationAcceptedIfNeeded({
      nextOutcome: "offer_accepted",
      previousOutcome: null,
      source: "manual",
      closedAt: null,
    });

    const call = mocks.trackCanonicalActivationEvent.mock.calls[0];
    const occurredAt = (call?.[2] as { occurredAt: number }).occurredAt;
    expect(occurredAt).toBe(now);

    vi.useRealTimers();
  });

  it("passes requestOrigin through to the event", () => {
    trackApplicationAcceptedIfNeeded({
      nextOutcome: "offer_accepted",
      previousOutcome: null,
      source: "adzuna",
      requestOrigin: "https://boussole.example.com",
    });
    expect(mocks.trackCanonicalActivationEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        requestOrigin: "https://boussole.example.com",
      }),
    );
  });

  it("defaults requestOrigin to null when omitted", () => {
    trackApplicationAcceptedIfNeeded({
      nextOutcome: "offer_accepted",
      previousOutcome: null,
      source: "adzuna",
    });
    expect(mocks.trackCanonicalActivationEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ requestOrigin: null }),
    );
  });
});
