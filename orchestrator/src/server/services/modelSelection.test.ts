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
import { resolveActiveAiProvider, resolveLlmModel } from "./modelSelection";
import { pickProjectIdsForJob } from "./projectSelection";
import { scoreJobSuitability } from "./scorer";
import { getEffectiveSettings } from "./settings";
import { generateTailoring } from "./summary";

function mockStoredSettings(values: Record<string, string | null>): void {
  vi.mocked(settingsRepo.getSetting).mockImplementation(
    async (key) => values[key] ?? null,
  );
}

function mockEffectiveSettings(model: unknown): void {
  mockStoredSettings({ model: typeof model === "string" ? model : null });
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

  describe("AI account choice", () => {
    it("uses the ChatGPT model when the workspace picked ChatGPT", async () => {
      mockStoredSettings({
        aiProvider: "chatgpt",
        chatgptModel: " gpt-6.1-sol:low ",
      });
      await expect(resolveActiveAiProvider()).resolves.toBe("chatgpt");
      await expect(resolveLlmModel()).resolves.toBe("gpt-6.1-sol:low");
    });

    it("lets ChatGPT use its own default model when none is picked", async () => {
      mockStoredSettings({ aiProvider: "chatgpt" });
      await expect(resolveLlmModel()).resolves.toBe("");
    });

    it("falls back to Claude for an unknown provider value", async () => {
      mockStoredSettings({ aiProvider: "gemini", model: "sonnet" });
      await expect(resolveActiveAiProvider()).resolves.toBe("claude");
      await expect(resolveLlmModel()).resolves.toBe("sonnet");
    });
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
