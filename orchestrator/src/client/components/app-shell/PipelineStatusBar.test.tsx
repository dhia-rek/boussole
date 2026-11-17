import * as api from "@client/api";
import { renderWithQueryClient } from "@client/test/renderWithQueryClient";
import type {
  PipelineProgressState,
  PipelineStatusResponse,
} from "@shared/types";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PipelineStatusBar } from "./PipelineStatusBar";

vi.mock("@client/api", () => ({
  getPipelineStatus: vi.fn(),
  getPipelineProgressSnapshot: vi.fn(),
  cancelPipeline: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { message: vi.fn(), error: vi.fn() },
}));

const LocationProbe = () => {
  const location = useLocation();
  return (
    <div data-testid="location">{`${location.pathname}${location.search}`}</div>
  );
};

function renderBar() {
  return renderWithQueryClient(
    <MemoryRouter initialEntries={["/today"]}>
      <PipelineStatusBar />
      <Routes>
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

const idleStatus: PipelineStatusResponse = {
  isRunning: false,
  nextScheduledRun: null,
  lastRun: {
    id: "run-1",
    startedAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
    completedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    status: "completed",
    jobsDiscovered: 54,
    jobsProcessed: 12,
    errorMessage: null,
  },
};

const crawling: PipelineProgressState = {
  step: "crawling",
  message: "Crawling",
  crawlingSource: "wttj",
  crawlingSourcesCompleted: 1,
  crawlingSourcesTotal: 4,
  crawlingTermsProcessed: 2,
  crawlingTermsTotal: 18,
  crawlingListPagesProcessed: 0,
  crawlingListPagesTotal: 0,
  crawlingJobCardsFound: 0,
  crawlingJobPagesEnqueued: 0,
  crawlingJobPagesSkipped: 0,
  crawlingJobPagesProcessed: 0,
  jobsDiscovered: 42,
  jobsScored: 0,
  jobsProcessed: 0,
  totalToProcess: 0,
};

describe("PipelineStatusBar", () => {
  beforeEach(() => {
    vi.mocked(api.getPipelineStatus).mockReset();
    vi.mocked(api.getPipelineProgressSnapshot).mockReset();
    vi.mocked(api.cancelPipeline).mockReset();
  });

  it("summarises the last run and opens the run dialog on the jobs page", async () => {
    vi.mocked(api.getPipelineStatus).mockResolvedValue(idleStatus);
    renderBar();

    expect(
      await screen.findByText("Last run 2 hours ago · 54 found · 12 tailored"),
    ).toBeInTheDocument();
    expect(api.getPipelineProgressSnapshot).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /run pipeline/i }));
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/jobs/ready?run=automatic",
    );
  });

  it("shows the live step while running and can stop the run", async () => {
    vi.mocked(api.getPipelineStatus).mockResolvedValue({
      ...idleStatus,
      isRunning: true,
    });
    vi.mocked(api.getPipelineProgressSnapshot).mockResolvedValue(crawling);
    vi.mocked(api.cancelPipeline).mockResolvedValue({
      message: "ok",
      pipelineRunId: "run-2",
      alreadyRequested: false,
    });
    renderBar();

    expect(await screen.findByText("Searching job boards")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Welcome to the Jungle · term 3/18 · 1/4 sources done · 42 found",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /run pipeline/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /stop/i }));
    await waitFor(() => expect(api.cancelPipeline).toHaveBeenCalledTimes(1));
  });

  it("explains a failed run", async () => {
    vi.mocked(api.getPipelineStatus).mockResolvedValue({
      ...idleStatus,
      lastRun: {
        ...idleStatus.lastRun,
        status: "failed",
        errorMessage: "No compatible sources",
      } as PipelineStatusResponse["lastRun"],
    });
    renderBar();
    expect(
      await screen.findByText(
        "Last run failed 2 hours ago · No compatible sources",
      ),
    ).toBeInTheDocument();
  });

  it("says when the pipeline never ran", async () => {
    vi.mocked(api.getPipelineStatus).mockResolvedValue({
      isRunning: false,
      lastRun: null,
      nextScheduledRun: null,
    });
    renderBar();
    expect(await screen.findByText("No pipeline run yet")).toBeInTheDocument();
  });
});

describe("PipelineStatusBar on the jobs page", () => {
  it("leaves run controls to the jobs page itself", async () => {
    vi.mocked(api.getPipelineStatus).mockResolvedValue(idleStatus);
    renderWithQueryClient(
      <MemoryRouter initialEntries={["/jobs/ready"]}>
        <PipelineStatusBar />
      </MemoryRouter>,
    );
    expect(
      await screen.findByText("Last run 2 hours ago · 54 found · 12 tailored"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /run pipeline/i })).toBeNull();
  });
});
