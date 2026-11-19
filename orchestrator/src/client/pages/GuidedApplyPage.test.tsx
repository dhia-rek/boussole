import type { GuideApplyProgress, Job } from "@shared/types";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api";
import { renderWithQueryClient } from "../test/renderWithQueryClient";
import { EMAIL_PROMPT, GuidedApplyPage } from "./GuidedApplyPage";

vi.mock("../api", () => ({
  getJob: vi.fn(),
  getGuideApplyProgress: vi.fn(),
  skipJob: vi.fn(),
  processJob: vi.fn(),
  generateJobPdf: vi.fn(),
}));

vi.mock("@shared/apply-route", () => ({
  detectApplyRoutes: () => ({
    primary: { channel: "email", label: "Email", email: "jobs@acme.fr" },
    alternatives: [],
  }),
}));

// The cards inside each step have their own tests.
vi.mock("./job-page/CvCheckCard", () => ({
  CvCheckCard: () => <div>cv check card</div>,
}));
vi.mock("./job-page/CompanyResearchCard", () => ({
  CompanyResearchCard: () => <div>company research card</div>,
}));
vi.mock("./job-page/HowToApplyCard", () => ({
  HowToApplyCard: () => <div>how to apply card</div>,
}));
vi.mock("../components/JobBriefPane", () => ({
  JobBriefPane: () => <div>job brief</div>,
  parseJobBrief: () => null,
}));
vi.mock("../components/agents/AgentTeamPanel", () => ({
  AgentTeamPanel: ({ jobId }: { jobId: string }) => (
    <div data-testid="agent-team">agent team for {jobId}</div>
  ),
}));
vi.mock("../components/ghostwriter/GhostwriterPanel", () => ({
  GhostwriterPanel: ({ initialPrompt }: { initialPrompt?: string | null }) => (
    <div data-testid="ghostwriter">{initialPrompt ?? "no prompt"}</div>
  ),
}));

const JOB = {
  id: "j1",
  title: "Data Quality Engineer",
  employer: "Acme",
  jobUrl: "https://example.com/j1",
  status: "discovered",
  pdfPath: null,
  pdfFreshness: "missing",
  pdfRegenerating: false,
  appliedAt: null,
} as unknown as Job;

function progress(
  overrides: Partial<GuideApplyProgress> = {},
): GuideApplyProgress {
  return {
    jobId: "j1",
    done: { cv: false, company: false, message: false },
    applied: false,
    nextStep: "cv",
    ...overrides,
  };
}

const LocationProbe = () => {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
};

function renderApply(path = "/apply/j1") {
  return renderWithQueryClient(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/apply/:id" element={<GuidedApplyPage />} />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

const stepper = () =>
  screen.getByRole("navigation", { name: "Application steps" });

describe("GuidedApplyPage", () => {
  beforeEach(() => {
    // jsdom has no scrolling.
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
    vi.mocked(api.getJob).mockResolvedValue(JOB);
    vi.mocked(api.getGuideApplyProgress).mockResolvedValue(progress());
    vi.mocked(api.processJob).mockResolvedValue({
      ...JOB,
      status: "ready",
    } as never);
    vi.mocked(api.skipJob).mockResolvedValue(JOB as never);
  });

  it("starts at the job, then walks to the CV step and prepares the CV", async () => {
    renderApply();

    expect(
      await screen.findByRole("heading", { name: "Is this job for you?" }),
    ).toBeInTheDocument();
    expect(
      within(stepper()).getByRole("button", { current: "step" }),
    ).toHaveTextContent("The job");

    fireEvent.click(screen.getByRole("button", { name: /Next: your cv/i }));
    expect(
      await screen.findByRole("heading", { name: "Your CV for this job" }),
    ).toBeInTheDocument();
    expect(screen.getByText("cv check card")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Prepare my CV for this job" }),
    );
    await waitFor(() => expect(api.processJob).toHaveBeenCalledWith("j1"));
  });

  it("resumes at the first step still to do", async () => {
    vi.mocked(api.getGuideApplyProgress).mockResolvedValue(
      progress({
        done: { cv: true, company: false, message: false },
        nextStep: "company",
      }),
    );
    renderApply();
    expect(
      await screen.findByRole("heading", { name: "Get to know the company" }),
    ).toBeInTheDocument();
    expect(within(stepper()).getAllByLabelText("done")).toHaveLength(2);
  });

  it("writes the application email when the posting asks for email", async () => {
    renderApply("/apply/j1?step=message");
    expect(
      await screen.findByRole("heading", {
        name: "Write your application email",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/jobs@acme\.fr/)).toBeInTheDocument();
    expect(screen.getByTestId("ghostwriter")).toHaveTextContent("no prompt");
    fireEvent.click(screen.getByRole("button", { name: /Write my email/ }));
    expect(screen.getByTestId("ghostwriter")).toHaveTextContent(EMAIL_PROMPT);
  });

  it("lets the agent team write instead of Ghostwriter", async () => {
    renderApply("/apply/j1?step=message&with=agents");
    expect(await screen.findByTestId("agent-team")).toHaveTextContent(
      "agent team for j1",
    );
    expect(screen.queryByTestId("ghostwriter")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ghostwriter (chat)" }));
    expect(screen.getByTestId("ghostwriter")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Agent team (full pack)" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("shows the done screen once applied", async () => {
    vi.mocked(api.getJob).mockResolvedValue({
      ...JOB,
      status: "applied",
      appliedAt: "2026-11-18T10:00:00Z",
    } as Job);
    vi.mocked(api.getGuideApplyProgress).mockResolvedValue(
      progress({ applied: true }),
    );
    renderApply();
    expect(
      await screen.findByRole("heading", { name: /You applied to Acme/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Today will remind you to follow up/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Back to Today/ })).toHaveAttribute(
      "href",
      "/today",
    );
  });

  it("shows the job description when there is no summary yet", async () => {
    vi.mocked(api.getJob).mockResolvedValue({
      ...JOB,
      jobDescription: "## Missions\n\nBuild data quality checks.",
    } as Job);
    renderApply();
    expect(
      await screen.findByRole("region", { name: "Job description" }),
    ).toHaveTextContent("Build data quality checks.");
  });

  it("skips a job that's not for you and goes back to Today", async () => {
    renderApply();
    fireEvent.click(await screen.findByRole("button", { name: "Not for me" }));
    await waitFor(() => expect(api.skipJob).toHaveBeenCalledWith("j1"));
    expect(await screen.findByTestId("location")).toHaveTextContent("/today");
  });
});
