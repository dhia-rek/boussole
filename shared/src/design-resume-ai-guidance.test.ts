import { describe, expect, it } from "vitest";
import {
  applyDesignResumeHeadlinePrefix,
  collectDesignResumeItemIds,
  createDefaultDesignResumeAiGuidance,
  DESIGN_RESUME_AI_LIMITS,
  designResumeAiGuidanceInputSchema,
  hasCustomDesignResumeAiGuidance,
  normalizeDesignResumeAiGuidance,
  pruneDesignResumeAiGuidanceItems,
  stripJobTitleGenderMarkers,
} from "./design-resume-ai-guidance";

describe("design resume AI guidance", () => {
  describe("defaults", () => {
    it("tailors the four tailorable sections and keeps everything else", () => {
      const guidance = createDefaultDesignResumeAiGuidance();
      expect(guidance.sections.headline.mode).toBe("tailor");
      expect(guidance.sections.summary.mode).toBe("tailor");
      expect(guidance.sections.skills.mode).toBe("tailor");
      expect(guidance.sections.projects.mode).toBe("tailor");
      expect(guidance.sections.experience.mode).toBe("keep");
      expect(guidance.sections.education.mode).toBe("keep");
    });

    it("keeps third-party and link sections private by default", () => {
      const guidance = createDefaultDesignResumeAiGuidance();
      expect(guidance.sections.references.share).toBe(false);
      expect(guidance.sections.profiles.share).toBe(false);
      expect(guidance.sections.experience.share).toBe(true);
      expect(hasCustomDesignResumeAiGuidance(guidance)).toBe(false);
    });
  });

  describe("normalizeDesignResumeAiGuidance", () => {
    it("returns defaults for garbage input", () => {
      for (const input of [null, undefined, "x", 42, [], { sections: "no" }]) {
        expect(normalizeDesignResumeAiGuidance(input)).toEqual(
          createDefaultDesignResumeAiGuidance(),
        );
      }
    });

    it("cannot switch a verbatim-only section to tailor", () => {
      const guidance = normalizeDesignResumeAiGuidance({
        sections: { experience: { mode: "tailor" } },
      });
      expect(guidance.sections.experience.mode).toBe("keep");
    });

    it("only keeps a prefix on the headline", () => {
      const guidance = normalizeDesignResumeAiGuidance({
        sections: {
          headline: { prefix: "Stagiaire" },
          summary: { prefix: "Nope" },
        },
      });
      expect(guidance.sections.headline.prefix).toBe("Stagiaire");
      expect(guidance.sections.summary.prefix).toBe("");
    });

    it("preserves typed whitespace but treats blank notes as empty", () => {
      const guidance = normalizeDesignResumeAiGuidance({
        sections: {
          summary: { notes: "Mention my availability " },
          skills: { notes: "   \n  " },
        },
      });
      expect(guidance.sections.summary.notes).toBe("Mention my availability ");
      expect(guidance.sections.skills.notes).toBe("");
    });

    it("clamps overly long notes and prunes empty item entries", () => {
      const guidance = normalizeDesignResumeAiGuidance({
        sections: {
          summary: {
            notes: "x".repeat(DESIGN_RESUME_AI_LIMITS.sectionNotes + 50),
          },
        },
        items: {
          a: { include: "always" },
          b: { notes: "  " },
          c: { include: "sometimes", notes: "" },
          "": { notes: "no id" },
        },
      });
      expect(guidance.sections.summary.notes).toHaveLength(
        DESIGN_RESUME_AI_LIMITS.sectionNotes,
      );
      expect(guidance.items).toEqual({ a: { include: "always" } });
    });
  });

  describe("designResumeAiGuidanceInputSchema", () => {
    it("accepts a normalized guidance object round-trip", () => {
      const guidance = normalizeDesignResumeAiGuidance({
        sections: { headline: { prefix: "Intern" } },
        items: { p1: { include: "never", notes: "old project" } },
      });
      expect(
        designResumeAiGuidanceInputSchema.safeParse(guidance).success,
      ).toBe(true);
    });

    it("rejects unknown sections, unknown keys and invalid modes", () => {
      expect(
        designResumeAiGuidanceInputSchema.safeParse({
          sections: { hobbies: {} },
        }).success,
      ).toBe(false);
      expect(
        designResumeAiGuidanceInputSchema.safeParse({
          sections: { summary: { mode: "rewrite" } },
        }).success,
      ).toBe(false);
      expect(
        designResumeAiGuidanceInputSchema.safeParse({
          items: { p1: { pinned: true } },
        }).success,
      ).toBe(false);
    });
  });

  describe("item pruning", () => {
    const resumeJson = {
      sections: {
        projects: { items: [{ id: "p1" }, { id: "p2" }] },
        experience: { items: [{ id: "e1" }, { id: "" }] },
      },
    };

    it("collects ids from every list section", () => {
      expect([...collectDesignResumeItemIds(resumeJson)].sort()).toEqual([
        "e1",
        "p1",
        "p2",
      ]);
    });

    it("drops guidance for entries that no longer exist", () => {
      const guidance = normalizeDesignResumeAiGuidance({
        items: {
          p1: { notes: "keep" },
          gone: { notes: "deleted entry" },
        },
      });
      expect(
        pruneDesignResumeAiGuidanceItems(guidance, resumeJson).items,
      ).toEqual({ p1: { notes: "keep" } });
    });
  });

  describe("applyDesignResumeHeadlinePrefix", () => {
    it.each([
      ["Data Scientist", "Stagiaire", "Stagiaire Data Scientist"],
      ["Stagiaire Data Scientist", "Stagiaire", "Stagiaire Data Scientist"],
      ["stagiaire data scientist", "Stagiaire", "stagiaire data scientist"],
      ["Stage - Data Scientist", "Stagiaire", "Stagiaire Data Scientist"],
      ["Stage : Ingénieur IA", "Stagiaire", "Stagiaire Ingénieur IA"],
      ["Internship: ML Engineer", "Stagiaire", "Stagiaire ML Engineer"],
      ["Alternance – Data Engineer", "Alternant", "Alternant Data Engineer"],
      ["Stage", "Stagiaire", "Stagiaire Stage"],
      ["Data Scientist", "", "Data Scientist"],
      ["", "Stagiaire", "Stagiaire"],
    ])("%s + %s → %s", (headline, prefix, expected) => {
      expect(applyDesignResumeHeadlinePrefix(headline, prefix)).toBe(expected);
    });

    it("ignores accents when checking for an existing prefix", () => {
      expect(
        applyDesignResumeHeadlinePrefix("Developpeur IA", "Développeur"),
      ).toBe("Developpeur IA");
    });
  });

  describe("stripJobTitleGenderMarkers", () => {
    it.each([
      ["Data Scientist (H/F)", "Data Scientist"],
      ["Data Scientist (F/H)", "Data Scientist"],
      ["Ingénieur IA (H/F/X)", "Ingénieur IA"],
      ["ML Engineer (m/w/d) - Berlin", "ML Engineer - Berlin"],
      ["Stage Data [F/H] Paris", "Stage Data Paris"],
      ["Data Analyst H/F", "Data Analyst"],
      ["Research (NLP/CV) Intern", "Research (NLP/CV) Intern"],
    ])("%s → %s", (title, expected) => {
      expect(stripJobTitleGenderMarkers(title)).toBe(expected);
    });
  });
});
