import { beforeEach, describe, expect, it, vi } from "vitest";

const { callJsonMock, resolveLlmModelMock } = vi.hoisted(() => ({
  callJsonMock: vi.fn(),
  resolveLlmModelMock: vi.fn(),
}));

vi.mock("./modelSelection", () => ({
  resolveLlmModel: resolveLlmModelMock,
}));

// Never spawn the real Claude CLI from unit tests.
vi.mock("@server/services/llm/service", () => ({
  LlmService: class {
    callJson = callJsonMock;
  },
}));

import { inferManualJobDetails } from "./manualJob";

describe("manual job inference", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resolveLlmModelMock.mockResolvedValue("opus:medium");
  });

  it("asks Claude with the configured model and keeps only non-empty, trimmed fields", async () => {
    callJsonMock.mockResolvedValue({
      success: true,
      data: {
        title: "Backend Engineer",
        employer: "Acme",
        location: "",
        salary: " 100k ",
        deadline: "   ",
        jobUrl: "",
        applicationLink: "",
        jobType: "",
        jobLevel: "",
        jobFunction: "",
        disciplines: "",
        degreeRequired: "",
        starting: "",
        jobDescription: "",
      },
    });

    const result = await inferManualJobDetails("JD text");

    expect(result.warning).toBeUndefined();
    expect(result.job).toEqual({
      title: "Backend Engineer",
      employer: "Acme",
      salary: "100k",
    });
    expect(callJsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "opus:medium",
        jsonSchema: expect.objectContaining({ name: "manual_job_details" }),
        messages: [
          expect.objectContaining({
            role: "user",
            content: expect.stringContaining("JD text"),
          }),
        ],
      }),
    );
  });

  it("returns a warning when Claude reports an authentication problem", async () => {
    callJsonMock.mockResolvedValue({
      success: false,
      error: "Invalid API key · Please run /login",
    });

    const result = await inferManualJobDetails("JD text");

    expect(result.job).toEqual({});
    expect(result.warning).toContain("AI account is not signed in");
  });

  it("returns a warning when the Claude call fails", async () => {
    callJsonMock.mockResolvedValue({
      success: false,
      error: "Claude CLI exited with code 1.",
    });

    const result = await inferManualJobDetails("JD text");

    expect(result.job).toEqual({});
    expect(result.warning).toContain("AI inference failed");
  });
});
