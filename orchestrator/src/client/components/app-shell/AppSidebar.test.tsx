import * as api from "@client/api";
import { renderWithQueryClient } from "@client/test/renderWithQueryClient";
import { fireEvent, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppSidebar, SIDEBAR_COLLAPSED_STORAGE_KEY } from "./AppSidebar";

vi.mock("@client/api", () => ({
  getJobs: vi.fn(),
  logout: vi.fn(),
}));

vi.mock("@client/hooks/useVersionCheck", () => ({
  useVersionCheck: () => ({ version: "1.2.3", updateAvailable: false }),
}));

function renderSidebar(path = "/jobs/ready/42") {
  return renderWithQueryClient(
    <MemoryRouter initialEntries={[path]}>
      <TooltipProvider>
        <AppSidebar />
      </TooltipProvider>
    </MemoryRouter>,
  );
}

describe("AppSidebar", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.mocked(api.getJobs).mockResolvedValue({
      jobs: [],
      total: 0,
      revision: "r1",
      byStatus: {
        discovered: 254,
        processing: 0,
        ready: 86,
        applied: 4,
        in_progress: 3,
        skipped: 10,
        expired: 0,
      },
    });
  });

  it("groups pages, highlights the current one and shows live counts", async () => {
    renderSidebar();
    const nav = screen.getByRole("navigation", { name: "Main" });
    for (const heading of ["Find", "Apply", "Profile", "Insights"]) {
      expect(within(nav).getByText(heading)).toBeInTheDocument();
    }
    const jobs = within(nav).getByRole("link", { name: /Jobs/ });
    expect(jobs).toHaveAttribute("aria-current", "page");
    expect(
      within(nav).getByRole("link", { name: /Today/ }),
    ).not.toHaveAttribute("aria-current");
    expect(await within(jobs).findByText("86")).toBeInTheDocument();
    expect(
      within(within(nav).getByRole("link", { name: /Applications/ })).getByText(
        "3",
      ),
    ).toBeInTheDocument();
  });

  it("collapses to icons and remembers the choice", () => {
    const { unmount } = renderSidebar("/today");
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY)).toBe(
      "1",
    );
    expect(screen.queryByText("Find")).not.toBeInTheDocument();
    // Labels stay available to screen readers.
    expect(screen.getByRole("link", { name: /Today/ })).toBeInTheDocument();
    unmount();

    renderSidebar("/today");
    expect(
      screen.getByRole("button", { name: "Expand sidebar" }),
    ).toBeInTheDocument();
  });
});
