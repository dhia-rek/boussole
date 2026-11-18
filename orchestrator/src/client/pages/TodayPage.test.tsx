import type {
  AppSettings,
  GuideNextSteps,
  PipelineRunInsights,
} from "@shared/types";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api";
import { renderWithQueryClient } from "../test/renderWithQueryClient";
import { firstNameOf, TodayPage } from "./TodayPage";

vi.mock("../api", () => ({
  getGuideNextSteps: vi.fn(),
  rescoreJob: vi.fn(),
  logFollowUpSent: vi.fn(),
  getPipelineStatus: vi.fn(),
  getPipelineProgressSnapshot: vi.fn(),
  getPipelineRunInsights: vi.fn(),
  getSettings: vi.fn(),
  getProfile: vi.fn(),
}));

const STEPS: GuideNextSteps = {
  steps: [
    {
      kind: "follow_up",
      title: "Follow up with Alan",
      detail: "You applied to Data Engineer 10 days ago, no answer yet.",
      cta: {
        label: "Write the follow-up",
        href: "/job/j1/ghostwriter?prompt=x",
      },
      secondary: { label: "I've sent it", action: "log_follow_up" },
      jobId: "j1",
    },
    {
      kind: "find_jobs",
      title: "Find new jobs",
      detail: "Your last search was 5 months ago.",
      cta: { label: "Search now", href: "/jobs/ready?run=automatic" },
    },
    {
      kind: "recalculate_scores",
      title: "Recalculate 2 match scores",
      detail: "These jobs only have a keyword estimate.",
      cta: {
        label: "Recalculate now",
        action: "recalculate",
        jobIds: ["a", "b"],
      },
    },
  ],
};

const LocationProbe = () => {
  const location = useLocation();
  return (
    <div data-testid="location">{`${location.pathname}${location.search}`}</div>
  );
};

function renderToday() {
  return renderWithQueryClient(
    <MemoryRouter initialEntries={["/today"]}>
      <Routes>
        <Route path="/today" element={<TodayPage />} />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("firstNameOf", () => {
  it("takes the first word of the CV name and ignores the placeholder", () => {
    expect(firstNameOf("Alex Martin")).toBe("Alex");
    expect(firstNameOf("Resume")).toBeNull();
    expect(firstNameOf("  ")).toBeNull();
    expect(firstNameOf(undefined)).toBeNull();
  });
});

describe("TodayPage", () => {
  beforeEach(() => {
    vi.mocked(api.getProfile).mockResolvedValue({
      basics: { name: "Alex Martin" },
    } as never);
    vi.mocked(api.getGuideNextSteps).mockResolvedValue(STEPS);
    vi.mocked(api.rescoreJob).mockResolvedValue({
      requested: 2,
      succeeded: 2,
      failed: 0,
      results: [],
    } as never);
    vi.mocked(api.logFollowUpSent).mockResolvedValue({} as never);
    vi.mocked(api.getPipelineStatus).mockResolvedValue({
      isRunning: false,
      nextScheduledRun: null,
      lastRun: {
        id: "run-1",
        startedAt: "2026-11-17T08:00:00Z",
        completedAt: "2026-11-17T08:11:00Z",
        status: "completed",
        jobsDiscovered: 54,
        jobsProcessed: 12,
        errorMessage: null,
        configSnapshot: { sources: ["wttj", "linkedin"] } as never,
      },
    });
    vi.mocked(api.getPipelineRunInsights).mockResolvedValue({
      savedDetails: {
        resultSummary: {
          stage: "completed",
          jobsScored: 54,
          jobsSelected: 12,
          sourceErrors: ["indeed: HTTP 403 from upstream"],
        },
      },
    } as unknown as PipelineRunInsights);
    vi.mocked(api.getSettings).mockResolvedValue({
      searchTerms: {
        value: Array.from({ length: 14 }, (_, index) => `Term ${index + 1}`),
      },
      jobspyCountryIndeed: { value: "france" },
      searchCities: { value: "" },
    } as unknown as AppSettings);
  });

  it("shows one next step first, then a short list, with search details folded away", async () => {
    renderToday();

    expect(
      await screen.findByRole("heading", { name: /, Alex\./ }),
    ).toBeInTheDocument();
    const next = (
      await screen.findByRole("heading", { name: "Follow up with Alan" })
    ).closest("section") as HTMLElement;
    expect(within(next).getByText("Your next step")).toBeInTheDocument();
    expect(
      within(next).getByRole("link", { name: /Write the follow-up/ }),
    ).toHaveAttribute("href", "/job/j1/ghostwriter?prompt=x");

    const after = screen
      .getByRole("heading", { name: "After that" })
      .closest("section") as HTMLElement;
    expect(within(after).getByText("Find new jobs")).toBeInTheDocument();
    expect(
      within(after).getByRole("link", { name: /Search now/ }),
    ).toHaveAttribute("href", "/jobs/ready?run=automatic");

    // The old dashboard is still there, folded under "Search details".
    const details = screen.getByText("Search details").closest("details");
    expect(details).not.toHaveAttribute("open");
    expect(
      await screen.findByText("1 source had problems"),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(/14 search terms · France/),
    ).toBeInTheDocument();
  });

  it("logs a sent follow-up and recalculates estimates in place", async () => {
    renderToday();

    fireEvent.click(
      await screen.findByRole("button", { name: "I've sent it" }),
    );
    await waitFor(() => expect(api.logFollowUpSent).toHaveBeenCalledWith("j1"));

    fireEvent.click(screen.getByRole("button", { name: "Recalculate now" }));
    await waitFor(() =>
      expect(api.rescoreJob).toHaveBeenCalledWith(["a", "b"]),
    );
    // The steps reload so the finished step disappears.
    await waitFor(() =>
      expect(
        vi.mocked(api.getGuideNextSteps).mock.calls.length,
      ).toBeGreaterThan(2),
    );
  });

  it("still lets you start a search from the folded details", async () => {
    renderToday();
    fireEvent.click(await screen.findByText("Search details"));
    fireEvent.click(
      await screen.findByRole("button", { name: /run pipeline/i }),
    );
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/jobs/ready?run=automatic",
    );
  });
});
