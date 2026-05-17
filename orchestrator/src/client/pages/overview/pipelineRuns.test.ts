import type { PipelineRun } from "@shared/types";
import { describe, expect, it } from "vitest";
import {
  formatPipelineDuration,
  getPipelineRunDisplayStatus,
  getPipelineRunStatusLabel,
} from "./pipelineRuns";

function makeRun(overrides: Partial<PipelineRun> = {}): PipelineRun {
  return {
    id: "run-1",
    status: "completed",
    startedAt: Date.now(),
    completedAt: Date.now(),
    durationMs: 5000,
    jobsDiscovered: 10,
    jobsProcessed: 10,
    triggeredBy: "manual",
    ...overrides,
  } as PipelineRun;
}

describe("getPipelineRunDisplayStatus", () => {
  it("returns 'running' for an active running run", () => {
    const run = makeRun({ status: "running", completedAt: null });
    expect(getPipelineRunDisplayStatus(run, { isActive: true })).toBe(
      "running",
    );
  });

  it("returns 'incomplete' for a stale running run (no completedAt, not active)", () => {
    const run = makeRun({ status: "running", completedAt: null });
    expect(getPipelineRunDisplayStatus(run, { isActive: false })).toBe(
      "incomplete",
    );
  });

  it("returns 'incomplete' when isActive is omitted and run has no completedAt", () => {
    const run = makeRun({ status: "running", completedAt: null });
    expect(getPipelineRunDisplayStatus(run)).toBe("incomplete");
  });

  it("returns 'completed' for a completed run", () => {
    const run = makeRun({ status: "completed" });
    expect(getPipelineRunDisplayStatus(run)).toBe("completed");
  });

  it("returns 'failed' for a failed run", () => {
    const run = makeRun({ status: "failed" });
    expect(getPipelineRunDisplayStatus(run)).toBe("failed");
  });

  it("returns 'cancelled' for a cancelled run", () => {
    const run = makeRun({ status: "cancelled" });
    expect(getPipelineRunDisplayStatus(run)).toBe("cancelled");
  });
});

describe("getPipelineRunStatusLabel", () => {
  it("returns the correct label for each status", () => {
    expect(getPipelineRunStatusLabel("running")).toBe("Running");
    expect(getPipelineRunStatusLabel("completed")).toBe("Completed");
    expect(getPipelineRunStatusLabel("failed")).toBe("Failed");
    expect(getPipelineRunStatusLabel("cancelled")).toBe("Cancelled");
    expect(getPipelineRunStatusLabel("incomplete")).toBe("Incomplete");
  });
});

describe("formatPipelineDuration", () => {
  it("returns em-dash for null duration", () => {
    expect(formatPipelineDuration(null)).toBe("—");
  });

  it("formats sub-minute durations as seconds", () => {
    expect(formatPipelineDuration(45_000)).toBe("45s");
    expect(formatPipelineDuration(1_000)).toBe("1s");
  });

  it("formats minute-range durations as 'Xm Ys'", () => {
    expect(formatPipelineDuration(90_000)).toBe("1m 30s");
    expect(formatPipelineDuration(60_000)).toBe("1m 0s");
  });

  it("formats hour-range durations as 'Xh Ym'", () => {
    expect(formatPipelineDuration(3_660_000)).toBe("1h 1m");
    expect(formatPipelineDuration(7_200_000)).toBe("2h 0m");
  });

  it("clamps negative durations to 0s", () => {
    expect(formatPipelineDuration(-5_000)).toBe("0s");
  });
});
