import * as api from "@client/api";
import { renderWithQueryClient } from "@client/test/renderWithQueryClient";
import type { AgentRun } from "@shared/types";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentTeamPanel, plainWords, teamProgress } from "./AgentTeamPanel";

vi.mock("@client/api", () => ({
  listAgentRuns: vi.fn(),
  getAgentRun: vi.fn(),
  startApplicationAgents: vi.fn(),
  cancelAgentRun: vi.fn(),
}));

const at = "2026-11-19T10:00:00.000Z";

function run(overrides: Partial<AgentRun>): AgentRun {
  return {
    id: "run-1",
    kind: "application",
    status: "running",
    jobId: "job-1",
    model: "opus:medium",
    events: [],
    output: null,
    error: null,
    stats: { modelCalls: 0, toolCalls: 0, durationMs: null },
    createdAt: at,
    startedAt: at,
    finishedAt: null,
    ...overrides,
  };
}

const PACK = {
  analysis: "CDI, junior to mid. Must-have: Python, SQL.",
  headline: "Consultant Data & IA",
  emphasis: [{ section: "Projets", guidance: "Put the RAG project first." }],
  coverLetter: "Madame, Monsieur,\nJe souhaite rejoindre votre équipe.",
  coverLetterLanguage: "fr",
  critique: "Verdict: fix needed, minor. Two claims fixed.",
  unsupportedClaimsFixed: ["Removed '5 years of Spark'"],
  remainingRisks: ["Fluent English is required; your CV says B2."],
};

const renderPanel = () =>
  renderWithQueryClient(
    <MemoryRouter>
      <AgentTeamPanel jobId="job-1" />
    </MemoryRouter>,
  );

describe("teamProgress", () => {
  it("shows who is waiting, working and done, with what they're doing", () => {
    const progress = teamProgress(
      run({
        events: [
          {
            at,
            type: "run_started",
            agent: "orchestrator",
            label: "Run started",
          },
          {
            at,
            type: "subagent_started",
            agent: "job-analyst",
            label: "job-analyst started",
            detail: "Analyse the job posting.",
          },
          {
            at,
            type: "subagent_finished",
            agent: "job-analyst",
            label: "job-analyst finished",
          },
          {
            at,
            type: "subagent_started",
            agent: "cv-tailor",
            label: "cv-tailor started",
            detail: "Propose the headline.",
          },
          {
            at,
            type: "tool_called",
            agent: "cv-tailor",
            label: "get_cv_profile",
          },
        ],
      }),
    );
    expect(progress["job-analyst"]?.state).toBe("done");
    expect(progress["cv-tailor"]).toEqual({
      state: "working",
      now: "Reading your CV",
    });
    expect(progress["cover-letter-writer"]?.state).toBe("waiting");
    expect(progress.critic?.state).toBe("waiting");
    expect(progress.orchestrator?.state).toBe("working");
  });
});

describe("plainWords", () => {
  it("names the team and its tools in plain words", () => {
    expect(plainWords("job-analyst is thinking")).toBe(
      "Job analyst is thinking",
    );
    expect(plainWords("orchestrator is thinking")).toBe(
      "Team lead is thinking",
    );
    expect(plainWords("get_tailoring_rules")).toBe("Reading your CV rules");
  });
});

describe("AgentTeamPanel", () => {
  beforeEach(() => {
    vi.mocked(api.listAgentRuns).mockResolvedValue([]);
  });

  it("starts the team and shows the finished pack", async () => {
    vi.mocked(api.startApplicationAgents).mockResolvedValue(
      run({ id: "run-2", status: "running" }),
    );
    vi.mocked(api.getAgentRun).mockResolvedValue(
      run({
        id: "run-2",
        status: "succeeded",
        finishedAt: "2026-11-19T10:02:24.000Z",
        stats: { modelCalls: 14, toolCalls: 14, durationMs: 144_000 },
        output: { kind: "application", pack: PACK },
      }),
    );
    renderPanel();

    const startButton = await screen.findByRole("button", {
      name: "Prepare with the agent team",
    });
    await waitFor(() => expect(startButton).not.toBeDisabled());
    fireEvent.click(startButton);
    await waitFor(() =>
      expect(api.startApplicationAgents).toHaveBeenCalledWith("job-1"),
    );
    expect(
      await screen.findByText(/Je souhaite rejoindre votre équipe/),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Done in 2 min 24 s · 14 AI calls"),
    ).toBeInTheDocument();
    expect(screen.getByText("Removed '5 years of Spark'")).toBeInTheDocument();
    expect(
      screen.getByText("Fluent English is required; your CV says B2."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Copy the letter/ }),
    ).toBeInTheDocument();
    expect(screen.getAllByLabelText("done")).toHaveLength(5);
    expect(
      screen.getByRole("button", { name: "Run the team again" }),
    ).toBeInTheDocument();
  });

  it("shows why a run failed", async () => {
    const failed = run({
      status: "failed",
      error: "Your AI account hit its usage limit.",
      finishedAt: at,
    });
    vi.mocked(api.listAgentRuns).mockResolvedValue([failed]);
    vi.mocked(api.getAgentRun).mockResolvedValue(failed);
    renderPanel();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your AI account hit its usage limit.",
    );
    expect(screen.getByText(/The team couldn't finish/)).toBeInTheDocument();
  });
});
