import { fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { OrchestratorHeader } from "./OrchestratorHeader";

const renderHeader = (
  overrides: Partial<React.ComponentProps<typeof OrchestratorHeader>> = {},
) => {
  const props: React.ComponentProps<typeof OrchestratorHeader> = {
    isPipelineRunning: false,
    isCancelling: false,
    pipelineSources: ["wttj"],
    onOpenAutomaticRun: vi.fn(),
    onCancelPipeline: vi.fn(),
    ...overrides,
  };

  return {
    props,
    ...render(
      <MemoryRouter>
        <OrchestratorHeader {...props} />
      </MemoryRouter>,
    ),
  };
};

describe("OrchestratorHeader", () => {
  it("titles the page Jobs", () => {
    renderHeader();
    expect(screen.getByRole("heading", { name: "Jobs" })).toBeInTheDocument();
  });

  it("opens automatic run from the navbar button", () => {
    const { props } = renderHeader();
    fireEvent.click(screen.getByRole("button", { name: /run pipeline/i }));
    expect(props.onOpenAutomaticRun).toHaveBeenCalled();
  });

  it("does not render manual import button", () => {
    renderHeader();
    expect(
      screen.queryByRole("button", { name: /manual import/i }),
    ).not.toBeInTheDocument();
  });

  it("renders cancel button while running and triggers cancel", () => {
    const { props } = renderHeader({ isPipelineRunning: true });
    fireEvent.click(screen.getByRole("button", { name: /cancel run/i }));
    expect(props.onCancelPipeline).toHaveBeenCalled();
  });
});
