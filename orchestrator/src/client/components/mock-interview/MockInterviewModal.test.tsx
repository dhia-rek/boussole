import { createJob } from "@shared/testing/factories";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockInterviewButton } from "./MockInterviewModal";

const mocks = vi.hoisted(() => ({
  turn: vi.fn(),
  report: vi.fn(),
}));

vi.mock("@client/api/mock-interview", () => ({
  requestMockInterviewTurn: mocks.turn,
  requestMockInterviewReport: mocks.report,
}));

describe("MockInterview", () => {
  beforeEach(() => {
    mocks.turn.mockResolvedValue({
      message: "Bonjour, merci d'être là. Parlez-moi de votre projet avec n8n.",
      ended: false,
    });
    mocks.report.mockResolvedValue({
      overallScore: 64,
      recommendation: "Lean hire",
      summary: "Clear answers.",
      competencies: [],
      strengths: ["Concrete"],
      improvements: ["More numbers"],
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockRejectedValue(new Error("NotAllowedError")),
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("starts without camera or microphone and can finish early with feedback", async () => {
    render(
      <MockInterviewButton
        job={createJob({
          id: "job-1",
          title: "Ingénieur IA",
          employer: "SII",
          jobDescription:
            "Nous recherchons un ingénieur pour la DSI avec n8n et des agents.",
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Mock interview/ }));
    fireEvent.click(screen.getByRole("button", { name: "Start interview" }));

    expect(
      await screen.findByText(/Camera and microphone are off/),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(/Parlez-moi de votre projet/),
    ).toBeInTheDocument();
    expect(screen.getByText("Camera off")).toBeInTheDocument();

    const finish = screen.getByRole("button", {
      name: "Finish and get feedback",
    });
    expect(finish).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "J'ai construit un assistant RAG avec n8n." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send answer" }));
    await waitFor(() => expect(mocks.turn).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(finish).not.toBeDisabled());
    fireEvent.click(finish);

    expect(await screen.findByText("64")).toBeInTheDocument();
    expect(mocks.report).toHaveBeenCalledWith("job-1", {
      round: "full",
      transcript: expect.arrayContaining([
        expect.objectContaining({ role: "candidate" }),
      ]),
    });
  });
});
