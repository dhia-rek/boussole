import { fireEvent, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import * as api from "../api";
import { renderWithQueryClient } from "../test/renderWithQueryClient";
import { AiActivityPage } from "./AiActivityPage";

vi.mock("../api", () => ({ getAiActivity: vi.fn() }));

const base = {
  provider: "claude",
  model: "sonnet",
  jobId: null,
  jobTitle: null,
  jobEmployer: null,
  promptChars: 40,
  responseChars: 30,
  error: null,
  startedAt: new Date().toISOString(),
  durationMs: 2400,
};

describe("AiActivityPage", () => {
  it("lists requests and shows what was sent and answered", async () => {
    vi.mocked(api.getAiActivity).mockResolvedValue([
      {
        ...base,
        id: "a",
        label: "Match score",
        status: "ok",
        jobId: "job-1",
        jobTitle: "Data Engineer",
        jobEmployer: "Acme",
        promptPreview: "Score this job for the candidate.",
        responsePreview: '{"score":82,"reason":"Strong SQL"}',
      },
      {
        ...base,
        id: "b",
        label: "CV check",
        status: "error",
        promptPreview: "Check the CV.",
        responsePreview: null,
        error: "Your AI account hit its usage limit.",
      },
    ] as never);
    renderWithQueryClient(
      <MemoryRouter>
        <AiActivityPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Match score")).toBeInTheDocument();
    expect(screen.getByText("Data Engineer · Acme")).toBeInTheDocument();
    expect(screen.getByText("2 recent · 1 failed")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Match score"));
    expect(
      screen.getByText("Score this job for the candidate."),
    ).toBeInTheDocument();
    // JSON answers are indented for reading.
    expect(screen.getByText(/"score": 82/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the job" })).toHaveAttribute(
      "href",
      "/job/job-1",
    );

    fireEvent.click(screen.getByLabelText("Only failed"));
    expect(screen.queryByText("Match score")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("CV check"));
    expect(
      screen.getByText("Your AI account hit its usage limit."),
    ).toBeInTheDocument();
  });
});
