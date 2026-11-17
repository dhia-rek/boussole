import { createDefaultDesignResumeAiGuidance } from "@shared/design-resume-ai-guidance";
import type { DesignResumeAiGuidance, DesignResumeJson } from "@shared/types";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { DesignResumeAiGuidancePanel } from "./DesignResumeAiGuidancePanel";

const resumeJson = {
  sections: {
    projects: {
      items: [
        { id: "proj-1", name: "Smart Parking AI | Python", period: "2026" },
        { id: "", name: "Draft without id", period: "" },
      ],
    },
    experience: { items: [{ id: "exp-1", company: "KPIT", position: "QA" }] },
  },
} as unknown as DesignResumeJson;

function Harness({
  onGuidance,
}: {
  onGuidance: (guidance: DesignResumeAiGuidance) => void;
}) {
  const [guidance, setGuidance] = useState(createDefaultDesignResumeAiGuidance);
  return (
    <DesignResumeAiGuidancePanel
      guidance={guidance}
      resumeJson={resumeJson}
      onChange={(updater) => {
        setGuidance((current) => {
          const next = updater(current);
          onGuidance(next);
          return next;
        });
      }}
    />
  );
}

function openSection(name: RegExp) {
  fireEvent.click(screen.getByRole("button", { name }));
}

describe("DesignResumeAiGuidancePanel", () => {
  it("summarizes each section's AI rule in its header", () => {
    render(<Harness onGuidance={vi.fn()} />);
    expect(screen.getByRole("button", { name: /^Headline/ })).toHaveTextContent(
      "AI tailors",
    );
    expect(
      screen.getByRole("button", { name: /^Experience/ }),
    ).toHaveTextContent("Verbatim");
    expect(
      screen.getByRole("button", { name: /^References/ }),
    ).toHaveTextContent("Private");
  });

  it("locks a section and records the headline prefix", () => {
    const onGuidance = vi.fn();
    render(<Harness onGuidance={onGuidance} />);

    openSection(/^Headline/);
    fireEvent.change(screen.getByLabelText("Always start with"), {
      target: { value: "Stagiaire" },
    });
    expect(onGuidance).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sections: expect.objectContaining({
          headline: expect.objectContaining({ prefix: "Stagiaire" }),
        }),
      }),
    );

    openSection(/^Summary/);
    const keep = screen.getAllByRole("button", { name: "Keep as written" })[1];
    fireEvent.click(keep as HTMLElement);
    expect(keep).toHaveAttribute("aria-pressed", "true");
    expect(onGuidance.mock.lastCall?.[0].sections.summary.mode).toBe("keep");
    expect(screen.getByRole("button", { name: /^Summary/ })).toHaveTextContent(
      "Locked",
    );
  });

  it("stores per-entry notes keyed by item id and skips entries without ids", () => {
    const onGuidance = vi.fn();
    render(<Harness onGuidance={onGuidance} />);

    openSection(/^Projects/);
    expect(screen.queryByText("Draft without id")).not.toBeInTheDocument();
    const noteFields = screen.getAllByPlaceholderText(
      "What should the AI know about this entry?",
    );
    expect(noteFields).toHaveLength(1);
    fireEvent.change(noteFields[0] as HTMLElement, {
      target: { value: "Flagship GenAI project" },
    });
    expect(onGuidance.mock.lastCall?.[0].items).toEqual({
      "proj-1": { notes: "Flagship GenAI project" },
    });

    fireEvent.change(noteFields[0] as HTMLElement, { target: { value: "" } });
    expect(onGuidance.mock.lastCall?.[0].items).toEqual({});
  });

  it("disables notes and hides entries when a section is private", () => {
    render(<Harness onGuidance={vi.fn()} />);

    openSection(/^Experience/);
    const share = screen.getByRole("switch", { name: /Shared with the AI/ });
    fireEvent.click(share);

    expect(
      screen.getByRole("switch", { name: /Private — never sent/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(
        "Context the AI can use when scoring jobs and writing cover letters.",
      ),
    ).toBeDisabled();
    expect(screen.queryByText("Per entry")).not.toBeInTheDocument();
  });
});
