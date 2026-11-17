import { createJob } from "@shared/testing/factories";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as settingsRepo from "../repositories/settings";
import { ClaudeCliClient } from "./llm/claude-cli/client";
import { pickProjectIdsForJob } from "./projectSelection";
import { scoreJobSuitability } from "./scorer";

// --- Mocks ---
vi.mock("../repositories/settings", () => ({
  getSetting: vi.fn().mockResolvedValue(null),
  getAllSettings: vi.fn().mockResolvedValue({}),
}));

/**
 * Only the Claude CLI process is faked: the real LlmService still parses,
 * retries and reports errors, so these tests cover the full resilience path.
 */
function mockClaudeCli() {
  return vi.spyOn(ClaudeCliClient.prototype, "callJson");
}

const mockJob = createJob({
  id: "test-job",
  source: "wttj",
  title: "Senior Engineer",
  employer: "Test Corp",
  jobDescription: "Looking for a TypeScript and React expert.",
  status: "discovered",
  suitabilityScore: null,
  suitabilityReason: null,
});

const mockProfile = { name: "Test User" };

describe("AI Service Resilience", () => {
  beforeEach(() => {
    vi.mocked(settingsRepo.getAllSettings).mockResolvedValue({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("scoreJobSuitability (Scorer)", () => {
    it("should return parsed score when Claude returns valid JSON", async () => {
      const claude = mockClaudeCli().mockResolvedValue({
        text: JSON.stringify({ score: 85, reason: "Great match" }),
      });

      const result = await scoreJobSuitability(mockJob, mockProfile);

      expect(result.score).toBe(85);
      expect(result.reason).toBe("Great match");
      expect(claude).toHaveBeenCalledOnce();
    });

    it("should fallback to mock scoring if the Claude CLI is not installed", async () => {
      const claude = mockClaudeCli().mockRejectedValue(
        new Error("spawn claude ENOENT"),
      );

      const result = await scoreJobSuitability(mockJob, mockProfile);

      // Not a transient failure, so it is not retried.
      expect(claude).toHaveBeenCalledOnce();
      expect(typeof result.score).toBe("number");
      expect(result.reason).toContain("keyword matching");
    });

    it("should handle Claude CLI errors gracefully (fallback)", async () => {
      mockClaudeCli().mockRejectedValue(
        new Error("Claude CLI exited with code 1."),
      );

      const result = await scoreJobSuitability(mockJob, mockProfile);

      expect(result.score).toBeDefined(); // Fallback score
      expect(result.reason).toContain("keyword matching"); // Fallback reason
    });

    it("should handle Malformed/Invalid JSON in Claude's answer", async () => {
      const claude = mockClaudeCli().mockResolvedValue({
        text: "This is not JSON at all, just text.",
      });

      const result = await scoreJobSuitability(mockJob, mockProfile);

      // Parse failures are retried (maxRetries: 2) before falling back.
      expect(claude).toHaveBeenCalledTimes(3);
      expect(result.reason).toContain("keyword matching"); // Fell back
    });

    it("should extract JSON from markdown code blocks", async () => {
      mockClaudeCli().mockResolvedValue({
        text: 'Here is the score: ```json\n{ "score": 90, "reason": "Good" }\n```',
      });

      const result = await scoreJobSuitability(mockJob, mockProfile);
      expect(result.score).toBe(90);
    });
  });

  describe("pickProjectIdsForJob (Project Selection)", () => {
    const mockProjects = [
      {
        id: "p1",
        name: "React App",
        description: "Used React",
        date: "2022",
        summaryText: "React stuff",
        isVisibleInBase: true,
      },
      {
        id: "p2",
        name: "Python Script",
        description: "Used Python",
        date: "2023",
        summaryText: "Python stuff",
        isVisibleInBase: true,
      },
    ];

    it("should return projects selected by AI", async () => {
      mockClaudeCli().mockResolvedValue({
        text: JSON.stringify({ selectedProjectIds: ["p1"] }),
      });

      const result = await pickProjectIdsForJob({
        jobDescription: "React dev",
        eligibleProjects: mockProjects,
        desiredCount: 1,
      });

      expect(result).toEqual(["p1"]);
    });

    it("should fallback if the Claude CLI fails", async () => {
      mockClaudeCli().mockRejectedValue(
        new Error("Claude CLI exited with code 1."),
      );

      const result = await pickProjectIdsForJob({
        jobDescription: "React dev", // Should match p1 due to keyword 'React'
        eligibleProjects: mockProjects,
        desiredCount: 1,
      });

      // It should fall back to keyword matching
      // p1 has 'React', p2 has 'Python'. 'React dev' matches p1.
      expect(result).toEqual(["p1"]);
    });

    it("should fallback if AI returns garbage", async () => {
      mockClaudeCli().mockResolvedValue({ text: "No valid JSON here" });

      const result = await pickProjectIdsForJob({
        jobDescription: "Python dev", // Should match p2
        eligibleProjects: mockProjects,
        desiredCount: 1,
      });

      expect(result).toEqual(["p2"]);
    });

    it("should validate returned IDs exist in eligible list", async () => {
      // AI returns an ID that doesn't exist ('p999')
      mockClaudeCli().mockResolvedValue({
        text: JSON.stringify({ selectedProjectIds: ["p999", "p1"] }),
      });

      const result = await pickProjectIdsForJob({
        jobDescription: "stuff",
        eligibleProjects: mockProjects,
        desiredCount: 2,
      });

      // Should strip p999 and only return p1
      expect(result).toEqual(["p1"]);
    });
  });
});
