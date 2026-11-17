import type {
  AppSettings,
  JobListItem,
  PipelineRunInsights,
} from "@shared/types";
import { fireEvent, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api";
import { renderWithQueryClient } from "../test/renderWithQueryClient";
import { firstNameOf, pickTopMatches, TodayPage } from "./TodayPage";

vi.mock("../api", () => ({
  getJobs: vi.fn(),
  getPipelineStatus: vi.fn(),
  getPipelineProgressSnapshot: vi.fn(),
  getPipelineRunInsights: vi.fn(),
  getSettings: vi.fn(),
  getProfile: vi.fn(),
}));

const BY_STATUS = {
  discovered: 254,
  processing: 0,
  ready: 3,
  applied: 4,
  in_progress: 1,
  skipped: 10,
  expired: 0,
};

function job(overrides: Partial<JobListItem>): JobListItem {
  return {
    id: "job",
    source: "wttj",
    title: "Job",
    employer: "Acme",
    jobUrl: "https://example.com",
    status: "ready",
    suitabilityScore: 50,
    readyAt: "2026-11-16T10:00:00Z",
    discoveredAt: "2026-11-16T09:00:00Z",
    ...overrides,
  } as JobListItem;
}

const READY_JOBS = [
  job({ id: "low", title: "Sales Engineer", suitabilityScore: 41 }),
  job({
    id: "top",
    title: "Data Quality Analyst",
    employer: "skiils",
    location: "Lille, France",
    jobType: "Full-time permanent (CDI)",
    suitabilityScore: 92,
  }),
  job({ id: "mid", title: "AI Engineer", suitabilityScore: 77 }),
];

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

describe("pickTopMatches", () => {
  it("orders by score, puts unscored jobs last and breaks ties by recency", () => {
    const picked = pickTopMatches([
      job({ id: "none", suitabilityScore: null }),
      job({ id: "old", suitabilityScore: 80, readyAt: "2026-11-01T00:00:00Z" }),
      job({ id: "new", suitabilityScore: 80, readyAt: "2026-11-10T00:00:00Z" }),
      job({ id: "best", suitabilityScore: 95 }),
    ]);
    expect(picked.map((item) => item.id)).toEqual([
      "best",
      "new",
      "old",
      "none",
    ]);
  });
});

describe("firstNameOf", () => {
  it("takes the first word of the CV name and ignores the placeholder", () => {
    expect(firstNameOf("Dhia Rekik")).toBe("Dhia");
    expect(firstNameOf("Resume")).toBeNull();
    expect(firstNameOf("  ")).toBeNull();
    expect(firstNameOf(undefined)).toBeNull();
  });
});

describe("TodayPage", () => {
  beforeEach(() => {
    vi.mocked(api.getProfile).mockResolvedValue({
      basics: { name: "Dhia Rekik" },
    } as never);
    vi.mocked(api.getJobs).mockResolvedValue({
      jobs: READY_JOBS,
      total: READY_JOBS.length,
      byStatus: BY_STATUS,
      revision: "r1",
    } as unknown as Awaited<ReturnType<typeof api.getJobs>>);
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

  it("shows next actions, the last run with source problems and the best matches", async () => {
    renderToday();

    expect(await screen.findByText("Data Quality Analyst")).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", {
        name: /, Dhia\. 3 jobs are ready for you\./,
      }),
    ).toBeInTheDocument();
    const nextActions = screen.getByRole("heading", { name: "Next actions" })
      .parentElement?.parentElement as HTMLElement;
    expect(
      within(nextActions).getByRole("link", { name: /New to review.*254/ }),
    ).toHaveAttribute("href", "/jobs/discovered");

    const matches = screen.getAllByRole("link", { name: /Engineer|Analyst/ });
    expect(matches.map((link) => link.getAttribute("href"))).toEqual([
      "/jobs/ready/top",
      "/jobs/ready/mid",
      "/jobs/ready/low",
    ]);
    expect(
      screen.getByText("skiils · Lille, France · Full-time permanent (CDI)"),
    ).toBeInTheDocument();

    expect(
      await screen.findByText("1 source had problems"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("indeed: HTTP 403 from upstream"),
    ).toBeInTheDocument();
    expect(screen.getByText("Welcome to the Jungle")).toBeInTheDocument();

    expect(
      await screen.findByText(/14 search terms · France/),
    ).toBeInTheDocument();
    expect(screen.getByText("+2 more")).toBeInTheDocument();
  });

  it("invites a run when nothing is ready", async () => {
    vi.mocked(api.getJobs).mockResolvedValue({
      jobs: [],
      total: 0,
      byStatus: { ...BY_STATUS, ready: 0 },
      revision: "r2",
    });
    renderToday();

    expect(
      await screen.findByText(/No jobs are ready yet/),
    ).toBeInTheDocument();
    const runButtons = screen.getAllByRole("button", { name: /run pipeline/i });
    fireEvent.click(runButtons[runButtons.length - 1] as HTMLElement);
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/jobs/ready?run=automatic",
    );
  });
});
