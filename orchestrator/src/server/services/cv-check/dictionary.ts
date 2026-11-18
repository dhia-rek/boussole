/**
 * Turns the candidate's CV into its "dictionary": every visible line
 * (headline, summary paragraphs, bullets, skill groups, entries) numbered
 * L1, L2, … The review may only talk about these lines, and suggestions are
 * checked against the words of this dictionary.
 *
 * Left out: contact details, profiles, references, hidden sections and items,
 * and sections the candidate marked as not shared with the AI.
 */

import type { CvCheckLine } from "@shared/types";
import {
  DESIGN_RESUME_AI_SECTION_KEYS,
  type DesignResumeAiGuidance,
  type DesignResumeAiSectionKey,
  type DesignResumeJson,
} from "@shared/types";
import { htmlToPlainText } from "@shared/utils/string";

export const MAX_LINES = 150;
const MAX_LINE_CHARS = 500;

type Rec = Record<string, unknown>;
const asRec = (value: unknown): Rec =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Rec)
    : {};
const asArr = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];
const str = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

/** Rich text → one string per paragraph or bullet. */
export function richTextLines(html: string): string[] {
  return htmlToPlainText(html)
    .split("\n")
    .map((line) => line.replace(/^-\s+/, "").trim())
    .filter(Boolean);
}

const join = (parts: string[], separator: string) =>
  parts.filter(Boolean).join(separator);

/** Label of an item, and the one-line summary used when it has no bullets. */
function describeItem(
  section: string,
  item: Rec,
): { entry: string; headline: string } {
  switch (section) {
    case "experience":
    case "volunteer": {
      const entry = join(
        [str(item.company) || str(item.organization), str(item.position)],
        " — ",
      );
      return { entry, headline: join([entry, str(item.period)], ", ") };
    }
    case "education": {
      const entry = join(
        [join([str(item.degree), str(item.area)], " "), str(item.school)],
        " — ",
      );
      return { entry, headline: join([entry, str(item.period)], ", ") };
    }
    case "projects":
      return { entry: str(item.name), headline: str(item.name) };
    case "skills": {
      const keywords = asArr(item.keywords).map(str).filter(Boolean);
      return {
        entry: str(item.name),
        headline: keywords.length
          ? `${str(item.name)}: ${keywords.join(", ")}`
          : join([str(item.name), str(item.proficiency)], ", "),
      };
    }
    case "languages":
      return {
        entry: str(item.language),
        headline: join([str(item.language), str(item.fluency)], ", "),
      };
    case "certifications":
    case "awards": {
      const entry = str(item.title);
      return {
        entry,
        headline: join(
          [entry, str(item.issuer) || str(item.awarder), str(item.date)],
          ", ",
        ),
      };
    }
    case "publications":
      return {
        entry: str(item.name) || str(item.title),
        headline: join(
          [str(item.name) || str(item.title), str(item.publisher)],
          ", ",
        ),
      };
    case "interests": {
      const keywords = asArr(item.keywords).map(str).filter(Boolean);
      return {
        entry: str(item.name),
        headline: join([str(item.name), keywords.join(", ")], ": "),
      };
    }
    default: {
      const entry =
        str(item.name) ||
        str(item.title) ||
        str(item.company) ||
        str(item.school);
      return { entry, headline: entry };
    }
  }
}

/** Sections whose items read best as one line (no bullet split). */
const ONE_LINE_SECTIONS = new Set(["skills", "languages", "interests"]);
const EXCLUDED_SECTIONS = new Set(["profiles", "references", "cover-letter"]);

function isShared(
  guidance: DesignResumeAiGuidance | null | undefined,
  key: string,
): boolean {
  if (!(DESIGN_RESUME_AI_SECTION_KEYS as readonly string[]).includes(key)) {
    return true;
  }
  return guidance?.sections?.[key as DesignResumeAiSectionKey]?.share !== false;
}

export function buildCvDictionary(
  resume: DesignResumeJson,
  guidance?: DesignResumeAiGuidance | null,
): CvCheckLine[] {
  return buildCvDictionaryWithStats(resume, guidance).lines;
}

/** Same as buildCvDictionary, plus how many lines were over the limit. */
export function buildCvDictionaryWithStats(
  resume: DesignResumeJson,
  guidance?: DesignResumeAiGuidance | null,
): { lines: CvCheckLine[]; skipped: number } {
  const lines: CvCheckLine[] = [];
  let skipped = 0;
  const push = (line: Omit<CvCheckLine, "ref">) => {
    const text = line.text.replace(/\s+/g, " ").trim();
    if (!text) return;
    if (lines.length >= MAX_LINES) {
      skipped += 1;
      return;
    }
    lines.push({
      ...line,
      text:
        text.length > MAX_LINE_CHARS
          ? `${text.slice(0, MAX_LINE_CHARS - 1)}…`
          : text,
      ref: `L${lines.length + 1}`,
    });
  };

  const source = resume as unknown as Rec;
  const basics = asRec(source.basics);
  if (isShared(guidance, "headline") && str(basics.headline)) {
    push({
      section: "headline",
      sectionTitle: "Headline",
      entry: "",
      itemId: null,
      text: str(basics.headline),
    });
  }

  const summary = asRec(source.summary);
  if (isShared(guidance, "summary") && summary.hidden !== true) {
    for (const text of richTextLines(str(summary.content))) {
      push({
        section: "summary",
        sectionTitle: str(summary.title) || "Summary",
        entry: "",
        itemId: null,
        text,
      });
    }
  }

  const addSection = (key: string, type: string, section: Rec) => {
    if (section.hidden === true || EXCLUDED_SECTIONS.has(type)) return;
    if (!isShared(guidance, type)) return;
    const sectionTitle = str(section.title) || key;
    for (const raw of asArr(section.items)) {
      const item = asRec(raw);
      if (item.hidden === true) continue;
      const itemId = str(item.id) || null;
      const { entry, headline } = describeItem(type, item);
      const bullets = ONE_LINE_SECTIONS.has(type)
        ? []
        : [
            ...richTextLines(str(item.description) || str(item.summary)),
            ...asArr(item.roles).flatMap((role) => {
              const r = asRec(role);
              return [
                join([str(r.position), str(r.period)], ", "),
                ...richTextLines(str(r.description)),
              ];
            }),
          ].filter(Boolean);
      if (
        bullets.length === 0 ||
        type === "education" ||
        type === "certifications"
      ) {
        push({ section: key, sectionTitle, entry, itemId, text: headline });
      }
      for (const text of bullets) {
        push({ section: key, sectionTitle, entry, itemId, text });
      }
    }
  };

  const sections = asRec(source.sections);
  for (const [key, section] of Object.entries(sections)) {
    addSection(key, key, asRec(section));
  }
  for (const raw of asArr(source.customSections)) {
    const section = asRec(raw);
    addSection(str(section.id) || "custom", str(section.type), section);
  }
  return { lines, skipped };
}
