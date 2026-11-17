import { describe, expect, it } from "vitest";
import { formatDuration, formatRelativeTime } from "./relative-time";

const NOW = Date.parse("2026-11-17T12:00:00Z");

describe("formatRelativeTime", () => {
  it("describes past and future times", () => {
    expect(formatRelativeTime("2026-11-17T11:59:40Z", NOW)).toBe("just now");
    expect(formatRelativeTime("2026-11-17T09:00:00Z", NOW)).toBe("3 hours ago");
    expect(formatRelativeTime("2026-11-16T12:00:00Z", NOW)).toBe("yesterday");
    expect(formatRelativeTime("2026-11-19T12:00:00Z", NOW)).toBe("in 2 days");
    expect(formatRelativeTime("2026-06-23T09:31:05Z", NOW)).toBe(
      "5 months ago",
    );
  });

  it("returns an empty string for missing or invalid dates", () => {
    expect(formatRelativeTime(null, NOW)).toBe("");
    expect(formatRelativeTime("not a date", NOW)).toBe("");
  });
});

describe("formatDuration", () => {
  it("uses seconds, minutes and hours", () => {
    expect(formatDuration(42_000)).toBe("42 s");
    expect(formatDuration(11 * 60_000)).toBe("11 min");
    expect(formatDuration(65 * 60_000)).toBe("1 h 5 min");
    expect(formatDuration(2 * 3_600_000)).toBe("2 h");
    expect(formatDuration(-1)).toBe("");
    expect(formatDuration(null)).toBe("");
  });
});
