/**
 * The single place that turns a candidate profile into what an LLM may see.
 *
 * Design Resume profiles carry candidate-authored AI guidance (see
 * `@shared/design-resume-ai-guidance`). Every prompt builder (scoring,
 * tailoring, project selection, cover letters) goes through these helpers so
 * that sections marked private never leave the server and the candidate's
 * notes and rules reach every AI step consistently.
 */
import {
  createDefaultDesignResumeAiSectionGuidance,
  getDesignResumeAiItemGuidance,
} from "@shared/design-resume-ai-guidance";
import type {
  DesignResumeAiGuidance,
  DesignResumeAiSectionGuidance,
  DesignResumeAiSectionKey,
  ResumeProfile,
} from "@shared/types";

type MutableRecord = Record<string, unknown>;

/** Guidance section → `profile.sections.<key>` holding its items. */
const ITEM_SECTION_KEYS = [
  "skills",
  "projects",
  "experience",
  "education",
  "languages",
  "certifications",
  "awards",
  "publications",
  "volunteer",
  "interests",
  "references",
] as const satisfies readonly DesignResumeAiSectionKey[];

const SECTION_LABELS: Record<DesignResumeAiSectionKey, string> = {
  headline: "Headline",
  summary: "Summary",
  skills: "Skills",
  projects: "Projects",
  experience: "Experience",
  education: "Education",
  languages: "Languages",
  certifications: "Certifications",
  awards: "Awards",
  publications: "Publications",
  volunteer: "Volunteering",
  interests: "Interests",
  references: "References",
  profiles: "Profiles",
};

function asRecord(value: unknown): MutableRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as MutableRecord)
    : null;
}

export function getSectionGuidance(
  profile: ResumeProfile | null | undefined,
  key: DesignResumeAiSectionKey,
): DesignResumeAiSectionGuidance {
  return (
    profile?.aiGuidance?.sections?.[key] ??
    createDefaultDesignResumeAiSectionGuidance(key)
  );
}

export function getItemNotes(
  guidance: DesignResumeAiGuidance | null | undefined,
  itemId: unknown,
): string {
  return typeof itemId === "string"
    ? (getDesignResumeAiItemGuidance(guidance, itemId)?.notes ?? "").trim()
    : "";
}

const STREET_WORDS =
  /\b(rue|avenue|av|boulevard|bd|chemin|all[ée]e|impasse|place|quai|route|cours|street|st|road|rd|lane|ln|drive|dr|way|strasse|straße|calle|via)\b/i;
const HOUSE_NUMBER = /^\d+[a-z]?(\s*(bis|ter|quater))?$/i;

/**
 * Reduces a postal address to its locality ("3 bis, rue X, 95120 Ermont" →
 * "95120 Ermont"). The AI needs the area for commute/remote fit, never the
 * street.
 */
export function toLocality(address: string): string {
  const segments = address
    .split(/[,\n]/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const kept = segments.filter(
    (segment) => !HOUSE_NUMBER.test(segment) && !STREET_WORDS.test(segment),
  );
  return kept.join(", ");
}

/**
 * AI-facing copy of a profile: contact details are dropped (the address is
 * reduced to its locality), private sections are removed, and candidate notes
 * are attached inline as `aiNotes` on sections and items.
 */
export function buildAiProfileView(profile: ResumeProfile): ResumeProfile {
  const guidance = profile.aiGuidance;
  const view = structuredClone(profile) as ResumeProfile & MutableRecord;
  delete view.aiGuidance;

  const basics = asRecord(view.basics);
  const sections = asRecord(view.sections);

  if (basics) {
    delete basics.email;
    delete basics.phone;
    delete basics.image;
    const location = asRecord(basics.location);
    if (location && typeof location.address === "string") {
      location.address = toLocality(location.address);
    }
  }

  if (!guidance) return view;

  if (!guidance.sections.headline.share && basics) {
    delete basics.label;
    delete basics.headline;
  }
  if (!guidance.sections.summary.share) {
    if (basics) delete basics.summary;
    if (sections) delete sections.summary;
  }
  if (!guidance.sections.profiles.share && basics) {
    delete basics.profiles;
  }

  if (sections) {
    for (const key of ITEM_SECTION_KEYS) {
      const sectionGuidance = guidance.sections[key];
      if (!sectionGuidance.share) {
        delete sections[key];
        continue;
      }
      const section = asRecord(sections[key]);
      if (!section) continue;
      if (sectionGuidance.notes.trim()) {
        section.aiNotes = sectionGuidance.notes.trim();
      }
      if (Array.isArray(section.items)) {
        for (const item of section.items) {
          const record = asRecord(item);
          if (!record) continue;
          const notes = getItemNotes(guidance, record.id);
          if (notes) record.aiNotes = notes;
        }
      }
    }
  }

  return view;
}

/**
 * Section-level notes the candidate wrote, as prompt-ready bullet lines.
 * Private sections are skipped. Returns "" when there is nothing to say.
 */
export function formatCandidateNotes(
  profile: ResumeProfile | null | undefined,
): string {
  const guidance = profile?.aiGuidance;
  if (!guidance) return "";
  const lines: string[] = [];
  for (const key of Object.keys(SECTION_LABELS) as DesignResumeAiSectionKey[]) {
    const section = guidance.sections[key];
    const notes = section?.notes.trim();
    if (!section?.share || !notes) continue;
    lines.push(`- ${SECTION_LABELS[key]}: ${notes.replace(/\s*\n+\s*/g, " ")}`);
  }
  return lines.join("\n");
}

export type TailoringRule = {
  mode: "tailor" | "keep";
  prefix: string;
  notes: string;
};

export type TailoringRules = {
  headline: TailoringRule;
  summary: TailoringRule;
  skills: TailoringRule;
  projects: TailoringRule;
};

export function resolveTailoringRules(
  profile: ResumeProfile | null | undefined,
): TailoringRules {
  const rule = (
    key: "headline" | "summary" | "skills" | "projects",
  ): TailoringRule => {
    const section = getSectionGuidance(profile, key);
    return {
      mode: section.mode,
      prefix: key === "headline" ? section.prefix.trim() : "",
      notes: section.share ? section.notes.trim() : "",
    };
  };
  return {
    headline: rule("headline"),
    summary: rule("summary"),
    skills: rule("skills"),
    projects: rule("projects"),
  };
}

/**
 * Plain-language block of the candidate's tailoring rules for the prompt.
 * Deterministic post-processing enforces `keep` and `prefix` regardless; this
 * block keeps the model's output aligned so little needs correcting.
 */
export function formatTailoringRulesForPrompt(rules: TailoringRules): string {
  const lines: string[] = [];

  if (rules.headline.mode === "keep") {
    lines.push(
      '- "headline": the candidate locked it. Return their current headline unchanged.',
    );
  } else if (rules.headline.prefix) {
    lines.push(
      `- "headline": must start with "${rules.headline.prefix}", followed by the job title from the JD (drop words such as "Stage", "Internship", "Alternance" and markers like "(H/F)" from the title).`,
    );
  }
  if (rules.headline.notes) {
    lines.push(`- Headline notes from the candidate: ${rules.headline.notes}`);
  }

  if (rules.summary.mode === "keep") {
    lines.push(
      '- "summary": the candidate locked it. Return their current summary unchanged.',
    );
  }
  if (rules.summary.notes) {
    lines.push(`- Summary notes from the candidate: ${rules.summary.notes}`);
  }

  if (rules.skills.mode === "keep") {
    lines.push(
      '- "skills": the candidate locked them. Return the skill groups unchanged.',
    );
  }
  if (rules.skills.notes) {
    lines.push(`- Skills notes from the candidate: ${rules.skills.notes}`);
  }

  if (lines.length === 0) return "";
  return [
    "CANDIDATE RULES (written by the candidate; they override the instructions above):",
    ...lines,
  ].join("\n");
}
