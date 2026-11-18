import type { GuideReviewItem } from "@shared/types";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api";
import { renderWithQueryClient } from "../test/renderWithQueryClient";
import { ReviewPage } from "./ReviewPage";

vi.mock("../api", () => ({
  getGuideReview: vi.fn(),
  skipJob: vi.fn(),
}));

function item(overrides: Partial<GuideReviewItem>): GuideReviewItem {
  return {
    id: "a",
    title: "Data Quality Engineer",
    employer: "Acme",
    location: "Paris",
    score: 86,
    reason: "Strong match on data quality checks.",
    roleSummary: "Build data quality checks for the risk team.",
    status: "ready",
    discoveredAt: "2026-11-16T09:00:00Z",
    ...overrides,
  };
}

const LocationProbe = () => {
  const location = useLocation();
  return (
    <div data-testid="location">{`${location.pathname}${location.search}`}</div>
  );
};

function renderReview() {
  return renderWithQueryClient(
    <MemoryRouter initialEntries={["/review"]}>
      <Routes>
        <Route path="/review" element={<ReviewPage />} />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ReviewPage", () => {
  beforeEach(() => {
    vi.mocked(api.getGuideReview).mockResolvedValue([
      item({}),
      item({
        id: "b",
        title: "Automation Engineer",
        employer: "Alan",
        score: 72,
      }),
    ]);
    vi.mocked(api.skipJob).mockImplementation(
      async (id) => ({ id, employer: "Alan" }) as never,
    );
  });

  it("shows one job at a time and goes through later and skip", async () => {
    renderReview();

    expect(
      await screen.findByRole("heading", { name: "Data Quality Engineer" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Job 1 of 2")).toBeInTheDocument();
    expect(screen.getByText("Why it matches you")).toBeInTheDocument();
    expect(
      screen.getByText("Build data quality checks for the risk team."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Read the whole job/ }),
    ).toHaveAttribute("href", "/job/a");

    fireEvent.click(screen.getByRole("button", { name: "Decide later" }));
    expect(
      screen.getByRole("heading", { name: "Automation Engineer" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Job 2 of 2")).toBeInTheDocument();
    expect(api.skipJob).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Not for me" }));
    await waitFor(() => expect(api.skipJob).toHaveBeenCalledWith("b"));
    expect(
      screen.getByRole("heading", { name: "That's all of them" }),
    ).toBeInTheDocument();
  });

  it("opens the guided application at the CV step", async () => {
    renderReview();
    fireEvent.click(
      await screen.findByRole("button", { name: /Apply to this one/ }),
    );
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/apply/a?step=cv",
    );
  });

  it("explains an empty list and offers a search", async () => {
    vi.mocked(api.getGuideReview).mockResolvedValue([]);
    renderReview();
    expect(
      await screen.findByRole("heading", {
        name: "No good new matches right now",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Search for more jobs" }),
    ).toHaveAttribute("href", "/jobs/ready?run=automatic");
  });
});
