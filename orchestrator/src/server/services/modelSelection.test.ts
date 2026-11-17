// src/server/services/modelSelection.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { callJsonMock } = vi.hoisted(() => ({
  callJsonMock: vi.fn(),
}));

vi.mock("../repositories/settings", () => ({
  getAllSettings: vi.fn(),
  getSetting: vi.fn(),
}));

vi.mock("./settings", () => ({
  getEffectiveSettings: vi.fn(),
}));

// Never spawn the real Claude CLI from unit tests.
vi.mock("./llm/service", () => ({
  LlmService: class {
    callJson = callJsonMock;
    getProvider = () => "claude_cli";
  },
}));

import * as settingsRepo from "../repositories/settings";
import { resolveLlmModel } from "./modelSelection";
import { pickProjectIdsForJob } from "./projectSelection";
import { scoreJobSuitability } from "./scorer";
import { getEffectiveSettings } from "./settings";
import { generateTailoring } from "./summary";

function mockEffectiveSettings(model: unknown): void {
  vi.mocked(getEffectiveSettings).mockResolvedValue({
    model: { value: model, default: "opus:medium", override: null },
    scoringInstructions: { value: "", default: "", override: null },
    penalizeMissingSalary: { value: false, default: false, override: null },
    missingSalaryPenalty: { value: 10, default: 10, override: null },
  } as any);
}

describe("Model Selection Logic", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(settingsRepo.getAllSettings).mockResolvedValue({});
    vi.mocked(settingsRepo.getSetting).mockResolvedValue(null);
    mockEffectiveSettings("sonnet");
    callJsonMock.mockResolvedValue({
      success: true,
      data: {
        score: 50,
        reason: "ok",
        summary: "sum",
        headline: "head",
        skills: [],
        selectedProjectIds: ["1"],
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("resolveLlmModel", () => {
    it("uses the model configured in settings", async () => {
      mockEffectiveSettings("  claude-opus-5-5:high  ");

      await expect(resolveLlmModel()).resolves.toBe("claude-opus-5-5:high");
    });

    it("falls back to opus with medium effort when no model is configured", async () => {
      mockEffectiveSettings("   ");
      await expect(resolveLlmModel()).resolves.toBe("opus:medium");

      mockEffectiveSettings(null);
      await expect(resolveLlmModel()).resolves.toBe("opus:medium");

      vi.mocked(getEffectiveSettings).mockResolvedValue({} as any);
      await expect(resolveLlmModel()).resolves.toBe("opus:medium");
    });
  });

  describe("every AI task uses the one configured Claude model", () => {
    it("scores jobs with the configured model", async () => {
      await scoreJobSuitability(
        { title: "Test Job", jobDescription: "desc" } as any,
        {},
      );

      expect(callJsonMock).toHaveBeenCalledTimes(1);
      expect(callJsonMock.mock.calls[0]?.[0]?.model).toBe("sonnet");
    });

    it("tailors CVs with the configured model", async () => {
      await generateTailoring("job desc", {});

      expect(callJsonMock).toHaveBeenCalledTimes(1);
      expect(callJsonMock.mock.calls[0]?.[0]?.model).toBe("sonnet");
    });

    it("selects projects with the configured model", async () => {
      await pickProjectIdsForJob({
        jobDescription: "desc",
        eligibleProjects: [
          {
            id: "1",
            name: "p1",
            description: "d1",
            summaryText: "summary",
          } as any,
        ],
        desiredCount: 1,
      });

      expect(callJsonMock).toHaveBeenCalledTimes(1);
      expect(callJsonMock.mock.calls[0]?.[0]?.model).toBe("sonnet");
    });

    it("uses the default model for scoring when none is configured", async () => {
      mockEffectiveSettings("");

      await scoreJobSuitability({ title: "Test Job" } as any, {});

      expect(callJsonMock.mock.calls[0]?.[0]?.model).toBe("opus:medium");
    });
  });
});
