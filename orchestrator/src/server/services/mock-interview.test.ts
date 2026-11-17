import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildJobChatPromptContext: vi.fn(),
  resolveLlmModel: vi.fn(),
  llmCallJson: vi.fn(),
}));

vi.mock("@infra/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("./ghostwriter-context", () => ({
  buildJobChatPromptContext: mocks.buildJobChatPromptContext,
}));

vi.mock("./modelSelection", () => ({
  resolveLlmModel: mocks.resolveLlmModel,
}));

vi.mock("./llm/service", () => ({
  LlmService: class {
    callJson = mocks.llmCallJson;
  },
}));

import { generateInterviewerTurn, generateReport } from "./mock-interview";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.buildJobChatPromptContext.mockResolvedValue({
    jobSnapshot: '{"job":"snapshot"}',
    profileSnapshot: "Candidate profile",
  });
  mocks.resolveLlmModel.mockResolvedValue("test-model");
});

describe("generateInterviewerTurn", () => {
  it("returns the first question with questionNumber 1 for an empty transcript", async () => {
    mocks.llmCallJson.mockResolvedValue({
      success: true,
      data: { message: "Tell me about yourself.", ended: false },
    });

    const result = await generateInterviewerTurn({
      jobId: "job_1",
      round: "hr",
      transcript: [],
    });

    expect(result).toEqual({
      message: "Tell me about yourself.",
      ended: false,
      questionNumber: 1,
    });
    expect(mocks.resolveLlmModel).toHaveBeenCalled();
    expect(mocks.llmCallJson).toHaveBeenCalledWith(
      expect.objectContaining({ model: "test-model", jobId: "job_1" }),
    );
  });

  it("counts prior interviewer turns for questionNumber", async () => {
    mocks.llmCallJson.mockResolvedValue({
      success: true,
      data: { message: "Closing remarks.", ended: true },
    });

    const result = await generateInterviewerTurn({
      jobId: "job_1",
      round: "full",
      transcript: [
        { role: "interviewer", content: "Q1" },
        { role: "candidate", content: "A1" },
        { role: "interviewer", content: "Q2" },
        { role: "candidate", content: "A2" },
      ],
    });

    expect(result.questionNumber).toBe(3);
    expect(result.ended).toBe(true);
  });

  it("throws when the LLM call fails", async () => {
    mocks.llmCallJson.mockResolvedValue({
      success: false,
      error: "model down",
    });

    await expect(
      generateInterviewerTurn({
        jobId: "job_1",
        round: "technical",
        transcript: [],
      }),
    ).rejects.toThrow();
  });
});

describe("generateReport", () => {
  it("rejects a transcript that is too short to evaluate", async () => {
    await expect(
      generateReport({
        jobId: "job_1",
        round: "hr",
        transcript: [{ role: "interviewer", content: "Only one turn" }],
      }),
    ).rejects.toThrow();
  });

  it("clamps scores and normalizes arrays", async () => {
    mocks.llmCallJson.mockResolvedValue({
      success: true,
      data: {
        overallScore: 142,
        recommendation: "Lean hire — solid fundamentals",
        summary: "Good interview.",
        strengths: ["Clear communication", "", 123],
        improvements: ["Add metrics"],
        competencies: [
          { name: "Communication", score: -5, comment: "ok" },
          { name: "Depth", score: 80, comment: "strong" },
        ],
      },
    });

    const report = await generateReport({
      jobId: "job_1",
      round: "full",
      transcript: [
        { role: "interviewer", content: "Q1" },
        { role: "candidate", content: "A1" },
      ],
    });

    expect(report.overallScore).toBe(100);
    expect(report.strengths).toEqual(["Clear communication"]);
    expect(report.competencies[0]).toEqual({
      name: "Communication",
      score: 0,
      comment: "ok",
    });
    expect(report.competencies[1].score).toBe(80);
  });
});
