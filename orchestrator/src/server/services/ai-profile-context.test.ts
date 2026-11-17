import { normalizeDesignResumeAiGuidance } from "@shared/design-resume-ai-guidance";
import type { ResumeProfile } from "@shared/types";
import { describe, expect, it } from "vitest";
import {
  buildAiProfileView,
  formatCandidateNotes,
  formatTailoringRulesForPrompt,
  resolveTailoringRules,
  toLocality,
} from "./ai-profile-context";

function makeProfile(guidanceInput?: unknown): ResumeProfile {
  return {
    basics: {
      name: "Nora Petit",
      label: "Stagiaire IA",
      headline: "Stagiaire IA",
      email: "nora@example.com",
      phone: "+33 7 00 00 00 00",
      summary: "<p>MSc AI student</p>",
      location: { address: "3 bis, rue Saint-Flaive, 95120 Ermont" },
      profiles: [{ network: "LinkedIn", url: "https://linkedin.com/in/x" }],
    },
    sections: {
      summary: { id: "summary", content: "<p>MSc AI student</p>" },
      experience: {
        id: "experience",
        items: [
          {
            id: "exp-1",
            company: "KPIT",
            position: "Test Engineer",
            location: "Sfax",
            date: "2024",
            summary: "Validation",
            visible: true,
          },
        ],
      },
      projects: {
        id: "projects",
        items: [
          {
            id: "proj-1",
            name: "Smart Parking AI",
            description: "Zero-shot detection",
            date: "2026",
            summary: "Zero-shot detection",
            visible: true,
          },
        ],
      },
      references: {
        id: "references",
        items: [{ id: "ref-1", name: "Jane Doe", position: "Manager" }],
      },
    },
    ...(guidanceInput === undefined
      ? {}
      : { aiGuidance: normalizeDesignResumeAiGuidance(guidanceInput) }),
  };
}

describe("buildAiProfileView", () => {
  it("drops contact details and reduces the address to its locality", () => {
    const view = buildAiProfileView(makeProfile());
    expect(view.basics?.email).toBeUndefined();
    expect(view.basics?.phone).toBeUndefined();
    expect(view.basics?.location?.address).toBe("95120 Ermont");
    expect(view.aiGuidance).toBeUndefined();
  });

  it("does not mutate the original profile", () => {
    const profile = makeProfile({ sections: { experience: { share: false } } });
    buildAiProfileView(profile);
    expect(profile.basics?.email).toBe("nora@example.com");
    expect(profile.sections?.experience).toBeDefined();
  });

  it("removes private sections, including private-by-default references", () => {
    const view = buildAiProfileView(
      makeProfile({
        sections: {
          experience: { share: false },
          summary: { share: false },
          headline: { share: false },
        },
      }),
    );
    expect(view.sections?.experience).toBeUndefined();
    expect(view.sections?.summary).toBeUndefined();
    expect(view.sections?.references).toBeUndefined();
    expect(view.basics?.summary).toBeUndefined();
    expect(view.basics?.headline).toBeUndefined();
    expect(view.basics?.profiles).toBeUndefined();
    expect(view.sections?.projects).toBeDefined();
  });

  it("attaches trimmed section and item notes", () => {
    const view = buildAiProfileView(
      makeProfile({
        sections: { projects: { notes: "  Best for GenAI roles " } },
        items: { "proj-1": { notes: " Flagship project " } },
      }),
    );
    const projects = view.sections?.projects as Record<string, unknown> & {
      items: Array<Record<string, unknown>>;
    };
    expect(projects.aiNotes).toBe("Best for GenAI roles");
    expect(projects.items[0]?.aiNotes).toBe("Flagship project");
  });

  it("never attaches notes of a private section", () => {
    const view = buildAiProfileView(
      makeProfile({
        sections: { references: { notes: "secret" } },
      }),
    );
    expect(JSON.stringify(view)).not.toContain("secret");
  });

  it.each([
    ["3 bis, rue Saint-Flaive, 95120 Ermont", "95120 Ermont"],
    ["Paris, France", "Paris, France"],
    ["221B Baker Street, London", "London"],
    ["", ""],
  ])("toLocality(%s) → %s", (address, expected) => {
    expect(toLocality(address)).toBe(expected);
  });
});

describe("candidate notes and tailoring rules", () => {
  it("formats only shared, non-empty section notes", () => {
    const notes = formatCandidateNotes(
      makeProfile({
        sections: {
          experience: { notes: "BMW EV charging\nvalidation" },
          references: { notes: "private" },
          skills: { notes: "   " },
        },
      }),
    );
    expect(notes).toBe("- Experience: BMW EV charging validation");
  });

  it("returns empty output for profiles without guidance", () => {
    expect(formatCandidateNotes(makeProfile())).toBe("");
    const rules = resolveTailoringRules(makeProfile());
    expect(rules.headline.mode).toBe("tailor");
    expect(formatTailoringRulesForPrompt(rules)).toBe("");
  });

  it("describes locks and the headline prefix for the prompt", () => {
    const rules = resolveTailoringRules(
      makeProfile({
        sections: {
          headline: { prefix: " Stagiaire " },
          summary: { mode: "keep", notes: "Mention availability" },
          skills: { mode: "keep" },
        },
      }),
    );
    expect(rules.headline.prefix).toBe("Stagiaire");
    const text = formatTailoringRulesForPrompt(rules);
    expect(text).toContain('must start with "Stagiaire"');
    expect(text).toContain('"summary": the candidate locked it');
    expect(text).toContain('"skills": the candidate locked them');
    expect(text).toContain(
      "Summary notes from the candidate: Mention availability",
    );
  });
});
