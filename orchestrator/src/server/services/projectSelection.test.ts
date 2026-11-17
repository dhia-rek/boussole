import { normalizeDesignResumeAiGuidance } from "@shared/design-resume-ai-guidance";
import { beforeEach, describe, expect, it, vi } from "vitest";

const callJsonMock = vi.fn();

vi.mock("./modelSelection", () => ({
  resolveLlmModel: vi.fn().mockResolvedValue("test-model"),
  createConfiguredLlmService: vi.fn().mockResolvedValue({
    callJson: (...args: unknown[]) => callJsonMock(...args),
  }),
}));

import { selectProjectIdsForJob } from "./projectSelection";
import {
  resolveProjectSelectionPlan,
  resolveStoredProjectSelection,
} from "./resumeProjects";

const catalog = [
  {
    id: "p1",
    name: "RAG assistant",
    description: "LangChain retrieval",
    date: "2026",
    isVisibleInBase: true,
    summaryText: "LangChain retrieval augmented generation",
  },
  {
    id: "p2",
    name: "Smart parking",
    description: "Computer vision",
    date: "2026",
    isVisibleInBase: true,
    summaryText: "YOLO CLIP zero-shot video",
  },
  {
    id: "p3",
    name: "Old WordPress site",
    description: "PHP shop",
    date: "2024",
    isVisibleInBase: false,
    summaryText: "WooCommerce PHP",
  },
];

describe("resolveProjectSelectionPlan", () => {
  it("matches the legacy settings behaviour when no guidance is set", () => {
    expect(resolveProjectSelectionPlan({ catalog, overrideRaw: null })).toEqual(
      {
        mode: "tailor",
        lockedIds: ["p1", "p2"],
        eligibleIds: ["p3"],
        desiredCount: 1,
      },
    );
  });

  it("keeps exactly the visible projects when the section is locked", () => {
    expect(
      resolveProjectSelectionPlan({
        catalog,
        overrideRaw: null,
        guidance: normalizeDesignResumeAiGuidance({
          sections: { projects: { mode: "keep" } },
        }),
      }),
    ).toEqual({ mode: "keep", selectedIds: ["p1", "p2"] });
  });

  it("lets per-project pins override the settings", () => {
    const plan = resolveProjectSelectionPlan({
      catalog,
      overrideRaw: null,
      guidance: normalizeDesignResumeAiGuidance({
        items: {
          p1: { include: "auto" },
          p2: { include: "never" },
          p3: { include: "always" },
        },
      }),
    });
    expect(plan).toEqual({
      mode: "tailor",
      lockedIds: ["p3"],
      eligibleIds: ["p1"],
      desiredCount: 1,
    });
  });
});

describe("resolveStoredProjectSelection", () => {
  it("distinguishes missing, explicit-empty, usable and stale selections", () => {
    expect(resolveStoredProjectSelection(null, catalog)).toBeNull();
    expect(resolveStoredProjectSelection(undefined, catalog)).toBeNull();
    expect(resolveStoredProjectSelection("", catalog)).toEqual([]);
    expect(resolveStoredProjectSelection(" p2, ghost ,p1", catalog)).toEqual([
      "p2",
      "p1",
    ]);
    // Ids from another CV variant match nothing: recompute instead of hiding
    // every project.
    expect(resolveStoredProjectSelection("proj-1,proj-2", catalog)).toBeNull();
  });
});

describe("selectProjectIdsForJob", () => {
  beforeEach(() => {
    callJsonMock.mockReset();
  });

  it("does not call the AI when projects are locked", async () => {
    const ids = await selectProjectIdsForJob({
      jobDescription: "LLM engineer",
      selectionItems: catalog,
      overrideRaw: null,
      guidance: normalizeDesignResumeAiGuidance({
        sections: { projects: { mode: "keep" } },
      }),
    });
    expect(ids).toEqual(["p1", "p2"]);
    expect(callJsonMock).not.toHaveBeenCalled();
  });

  it("sends candidate notes for eligible projects and keeps CV order", async () => {
    callJsonMock.mockResolvedValue({
      success: true,
      data: { selectedProjectIds: ["p1"] },
    });

    const ids = await selectProjectIdsForJob({
      jobDescription: "GenAI internship with LangChain",
      selectionItems: catalog,
      overrideRaw: JSON.stringify({
        maxProjects: 2,
        lockedProjectIds: ["p2"],
        aiSelectableProjectIds: ["p1", "p3"],
      }),
      guidance: normalizeDesignResumeAiGuidance({
        sections: { projects: { notes: "Prefer GenAI work" } },
        items: { p1: { notes: "Flagship GenAI project" } },
      }),
    });

    expect(ids).toEqual(["p1", "p2"]);
    const prompt = callJsonMock.mock.calls[0]?.[0]?.messages?.[0]?.content;
    expect(prompt).toContain("Flagship GenAI project");
    expect(prompt).toContain("Prefer GenAI work");
  });

  it("does not leak notes when the projects section is private", async () => {
    callJsonMock.mockResolvedValue({
      success: true,
      data: { selectedProjectIds: ["p3"] },
    });

    await selectProjectIdsForJob({
      jobDescription: "PHP developer",
      selectionItems: catalog,
      overrideRaw: null,
      guidance: normalizeDesignResumeAiGuidance({
        sections: { projects: { share: false, notes: "hidden note" } },
        items: { p3: { notes: "hidden item note" } },
      }),
    });

    const prompt = callJsonMock.mock.calls[0]?.[0]?.messages?.[0]?.content;
    expect(prompt).not.toContain("hidden note");
    expect(prompt).not.toContain("hidden item note");
  });

  it("falls back to keyword overlap when the AI fails", async () => {
    callJsonMock.mockResolvedValue({ success: false, error: "quota" });

    const ids = await selectProjectIdsForJob({
      jobDescription: "Computer vision role: YOLO, CLIP and zero-shot video",
      selectionItems: catalog,
      overrideRaw: JSON.stringify({
        maxProjects: 1,
        lockedProjectIds: [],
        aiSelectableProjectIds: ["p1", "p2", "p3"],
      }),
    });

    expect(ids).toEqual(["p2"]);
  });
});
