import { describe, expect, it } from "vitest";
import {
  buildProfileKeywords,
  prefilterJob,
  resolveMinOverlap,
} from "./scoring-prefilter";

const aiProfile = {
  basics: { headline: "AI Engineer", label: "Machine Learning" },
  sections: {
    skills: {
      items: [
        { name: "ML", keywords: ["pytorch", "tensorflow", "nlp"] },
        { name: "Lang", keywords: ["python"] },
      ],
    },
    experience: {
      items: [{ position: "Data Scientist", summary: "Built computer vision" }],
    },
  },
};

describe("buildProfileKeywords", () => {
  it("extracts domain keywords from skills/headline/experience", () => {
    const kw = buildProfileKeywords(aiProfile);
    expect(kw.has("pytorch")).toBe(true);
    expect(kw.has("python")).toBe(true);
    expect(kw.has("computer")).toBe(true);
    // stopwords/short tokens excluded
    expect(kw.has("the")).toBe(false);
    expect(kw.has("ml")).toBe(false);
  });

  it("returns an empty set for an empty profile", () => {
    expect(buildProfileKeywords({}).size).toBe(0);
  });
});

describe("resolveMinOverlap", () => {
  it("defaults to 2 when unset/blank", () => {
    expect(resolveMinOverlap(undefined)).toBe(2);
    expect(resolveMinOverlap("")).toBe(2);
    expect(resolveMinOverlap("not-a-number")).toBe(2);
  });
  it("honors a valid override and 0 (disabled)", () => {
    expect(resolveMinOverlap("4")).toBe(4);
    expect(resolveMinOverlap("0")).toBe(0);
  });
});

describe("prefilterJob", () => {
  const profileKeywords = buildProfileKeywords(aiProfile);

  it("passes a clearly-relevant AI job", () => {
    const r = prefilterJob({
      title: "Machine Learning Engineer Intern",
      description: "Work with PyTorch and Python on NLP models.",
      profileKeywords,
      minOverlap: 2,
    });
    expect(r.pass).toBe(true);
    expect(r.overlap).toBeGreaterThanOrEqual(2);
  });

  it("filters an irrelevant job (no overlap)", () => {
    const r = prefilterJob({
      title: "Pastry Chef",
      description: "Bake croissants and manage a kitchen brigade.",
      profileKeywords,
      minOverlap: 2,
    });
    expect(r.pass).toBe(false);
    expect(r.reason).toContain("Pre-filtered");
  });

  it("fails open when the profile has no keywords", () => {
    const r = prefilterJob({
      title: "Pastry Chef",
      description: "Bake croissants.",
      profileKeywords: new Set(),
      minOverlap: 2,
    });
    expect(r.pass).toBe(true);
  });

  it("is disabled when minOverlap is 0", () => {
    const r = prefilterJob({
      title: "Pastry Chef",
      description: "Bake croissants.",
      profileKeywords,
      minOverlap: 0,
    });
    expect(r.pass).toBe(true);
  });

  it("filters a borderline job below the threshold", () => {
    const r = prefilterJob({
      title: "Marketing Manager",
      description: "Drive campaigns; some Python scripting a plus.",
      profileKeywords,
      minOverlap: 2,
    });
    // only "python" overlaps -> 1 < 2 -> filtered
    expect(r.pass).toBe(false);
    expect(r.overlap).toBe(1);
  });
});
