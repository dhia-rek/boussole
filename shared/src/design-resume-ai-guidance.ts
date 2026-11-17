/**
 * AI guidance attached to a Design Resume ("CV metadata for the AI").
 *
 * The guidance lives next to the resume JSON (never inside it), so it is never
 * rendered into PDFs or exported to Reactive Resume. It tells every LLM step
 * (scoring, tailoring, project selection, cover letters) how to treat each
 * section: whether it may be rewritten per job, whether it may be shared at
 * all, and free-form notes/context written by the candidate.
 */
import { z } from "zod";
import {
  DESIGN_RESUME_AI_SECTION_KEYS,
  DESIGN_RESUME_AI_TAILORABLE_SECTION_KEYS,
  type DesignResumeAiGuidance,
  type DesignResumeAiItemGuidance,
  type DesignResumeAiItemInclusion,
  type DesignResumeAiSectionGuidance,
  type DesignResumeAiSectionKey,
  type DesignResumeAiTailorableSectionKey,
} from "./types/design-resume";

export const DESIGN_RESUME_AI_LIMITS = {
  sectionNotes: 1000,
  itemNotes: 500,
  prefix: 60,
  items: 500,
} as const;

/** Sections that are never shared with an LLM unless the candidate opts in. */
const PRIVATE_BY_DEFAULT = new Set<DesignResumeAiSectionKey>([
  "references",
  "profiles",
]);

const TAILORABLE = new Set<DesignResumeAiSectionKey>(
  DESIGN_RESUME_AI_TAILORABLE_SECTION_KEYS,
);

const ITEM_INCLUSIONS = new Set<DesignResumeAiItemInclusion>([
  "always",
  "auto",
  "never",
]);

export function isDesignResumeAiTailorableSection(
  key: DesignResumeAiSectionKey,
): key is DesignResumeAiTailorableSectionKey {
  return TAILORABLE.has(key);
}

export function createDefaultDesignResumeAiSectionGuidance(
  key: DesignResumeAiSectionKey,
): DesignResumeAiSectionGuidance {
  return {
    mode: TAILORABLE.has(key) ? "tailor" : "keep",
    share: !PRIVATE_BY_DEFAULT.has(key),
    notes: "",
    prefix: "",
  };
}

export function createDefaultDesignResumeAiGuidance(): DesignResumeAiGuidance {
  const sections = {} as DesignResumeAiGuidance["sections"];
  for (const key of DESIGN_RESUME_AI_SECTION_KEYS) {
    sections[key] = createDefaultDesignResumeAiSectionGuidance(key);
  }
  return { version: 1, sections, items: {} };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Stored text keeps the candidate's whitespace exactly as typed (the editor
 * autosaves mid-typing, so trimming here would eat a trailing space). A value
 * that is only whitespace counts as empty. Consumers trim when building prompts.
 */
function cleanText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  const normalized = value.replace(/\r\n?/g, "\n");
  if (!normalized.trim()) return "";
  return normalized.length > maxLength
    ? normalized.slice(0, maxLength)
    : normalized;
}

function cleanSingleLine(value: unknown, maxLength: number): string {
  return cleanText(value, maxLength).replace(/[\n\t]+/g, " ");
}

function normalizeSection(
  key: DesignResumeAiSectionKey,
  input: unknown,
): DesignResumeAiSectionGuidance {
  const defaults = createDefaultDesignResumeAiSectionGuidance(key);
  const record = asRecord(input);
  if (!record) return defaults;

  const mode =
    TAILORABLE.has(key) && (record.mode === "tailor" || record.mode === "keep")
      ? record.mode
      : defaults.mode;

  return {
    mode,
    share: typeof record.share === "boolean" ? record.share : defaults.share,
    notes: cleanText(record.notes, DESIGN_RESUME_AI_LIMITS.sectionNotes),
    prefix:
      key === "headline"
        ? cleanSingleLine(record.prefix, DESIGN_RESUME_AI_LIMITS.prefix)
        : "",
  };
}

function normalizeItem(input: unknown): DesignResumeAiItemGuidance | null {
  const record = asRecord(input);
  if (!record) return null;
  const notes = cleanText(record.notes, DESIGN_RESUME_AI_LIMITS.itemNotes);
  const include =
    typeof record.include === "string" &&
    ITEM_INCLUSIONS.has(record.include as DesignResumeAiItemInclusion)
      ? (record.include as DesignResumeAiItemInclusion)
      : undefined;

  if (!notes && !include) return null;
  return {
    ...(include ? { include } : {}),
    ...(notes ? { notes } : {}),
  };
}

/**
 * Tolerant normalizer for stored or client-provided guidance: unknown keys are
 * dropped, strings are trimmed/clamped, missing values fall back to defaults,
 * and empty item entries are pruned.
 */
export function normalizeDesignResumeAiGuidance(
  input: unknown,
): DesignResumeAiGuidance {
  const guidance = createDefaultDesignResumeAiGuidance();
  const record = asRecord(input);
  if (!record) return guidance;

  const sections = asRecord(record.sections);
  if (sections) {
    for (const key of DESIGN_RESUME_AI_SECTION_KEYS) {
      guidance.sections[key] = normalizeSection(key, sections[key]);
    }
  }

  const items = asRecord(record.items);
  if (items) {
    let count = 0;
    for (const [rawId, value] of Object.entries(items)) {
      const id = rawId.trim();
      if (!id || id.length > 200) continue;
      const item = normalizeItem(value);
      if (!item) continue;
      guidance.items[id] = item;
      count += 1;
      if (count >= DESIGN_RESUME_AI_LIMITS.items) break;
    }
  }

  return guidance;
}

const sectionInputSchema = z
  .object({
    mode: z.enum(["tailor", "keep"]).optional(),
    share: z.boolean().optional(),
    notes: z.string().max(DESIGN_RESUME_AI_LIMITS.sectionNotes).optional(),
    prefix: z.string().max(DESIGN_RESUME_AI_LIMITS.prefix).optional(),
  })
  .strict();

const itemInputSchema = z
  .object({
    include: z.enum(["always", "auto", "never"]).optional(),
    notes: z.string().max(DESIGN_RESUME_AI_LIMITS.itemNotes).optional(),
  })
  .strict();

const sectionsInputShape = Object.fromEntries(
  DESIGN_RESUME_AI_SECTION_KEYS.map((key) => [
    key,
    sectionInputSchema.optional(),
  ]),
) as Record<DesignResumeAiSectionKey, z.ZodOptional<typeof sectionInputSchema>>;

/** Strict schema for guidance sent to the API (rejects unknown sections/keys). */
export const designResumeAiGuidanceInputSchema = z
  .object({
    version: z.literal(1).optional(),
    sections: z.object(sectionsInputShape).strict().optional(),
    items: z
      .record(z.string().min(1).max(200), itemInputSchema)
      .refine(
        (items) => Object.keys(items).length <= DESIGN_RESUME_AI_LIMITS.items,
        {
          message: `At most ${DESIGN_RESUME_AI_LIMITS.items} item notes are allowed.`,
        },
      )
      .optional(),
  })
  .strict();

/** Collects every item id present in a resume's list sections. */
export function collectDesignResumeItemIds(resumeJson: unknown): Set<string> {
  const ids = new Set<string>();
  const sections = asRecord(asRecord(resumeJson)?.sections);
  if (!sections) return ids;
  for (const section of Object.values(sections)) {
    const items = asRecord(section)?.items;
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const id = asRecord(item)?.id;
      if (typeof id === "string" && id.trim()) ids.add(id);
    }
  }
  return ids;
}

/** Drops item guidance that points at entries no longer present in the CV. */
export function pruneDesignResumeAiGuidanceItems(
  guidance: DesignResumeAiGuidance,
  resumeJson: unknown,
): DesignResumeAiGuidance {
  const ids = collectDesignResumeItemIds(resumeJson);
  const items: DesignResumeAiGuidance["items"] = {};
  for (const [id, item] of Object.entries(guidance.items)) {
    if (ids.has(id)) items[id] = item;
  }
  return { ...guidance, items };
}

export function getDesignResumeAiItemGuidance(
  guidance: DesignResumeAiGuidance | null | undefined,
  itemId: string | null | undefined,
): DesignResumeAiItemGuidance | null {
  if (!guidance || !itemId) return null;
  return guidance.items[itemId] ?? null;
}

function normalizeForComparison(value: string): string {
  return value.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/**
 * Words job boards put in front of internship/apprenticeship titles
 * ("Stage - Data Scientist", "Internship: ML Engineer"). When the candidate
 * sets their own prefix, these are replaced by it instead of stacking.
 */
const CONTRACT_TYPE_LEADING_WORDS = new Set([
  "stage",
  "stagiaire",
  "internship",
  "intern",
  "alternance",
  "alternant",
  "alternante",
  "apprentissage",
  "apprenti",
  "apprentie",
  "apprenticeship",
  "apprentice",
  "praktikum",
  "praktikant",
  "practicas",
  "becario",
  "becaria",
]);

const SEPARATOR_PATTERN = /^[\s\-–—:|·/,]+/;

/** Removes gender-inclusive job-ad markers such as "(H/F)" or "(m/w/d)". */
export function stripJobTitleGenderMarkers(title: string): string {
  return title
    .replace(
      /\s*[([]\s*[hfmwdx]\s*\/\s*[hfmwdx](?:\s*\/\s*[hfmwdx])?\s*[)\]]/gi,
      "",
    )
    .replace(/\s+[hfmw]\s*\/\s*[hfmw](?:\s*\/\s*[dx])?\s*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Ensures a tailored headline starts with the candidate's required prefix
 * (e.g. "Stagiaire" + "Data Scientist" → "Stagiaire Data Scientist").
 * Case/accent-insensitive so "stagiaire data…" is not prefixed twice, and a
 * leading contract-type word from the job ad ("Stage - …") is replaced rather
 * than stacked ("Stagiaire Stage - …").
 */
export function applyDesignResumeHeadlinePrefix(
  headline: string,
  prefix: string,
): string {
  const cleanPrefix = prefix.trim();
  const cleanHeadline = headline.trim();
  if (!cleanPrefix) return cleanHeadline;
  if (!cleanHeadline) return cleanPrefix;
  if (
    normalizeForComparison(cleanHeadline).startsWith(
      normalizeForComparison(cleanPrefix),
    )
  ) {
    return cleanHeadline;
  }

  let rest = cleanHeadline.replace(SEPARATOR_PATTERN, "");
  const firstWord = /^([^\s\-–—:|·/,]+)/.exec(rest)?.[1] ?? "";
  if (
    firstWord &&
    CONTRACT_TYPE_LEADING_WORDS.has(normalizeForComparison(firstWord))
  ) {
    const remainder = rest
      .slice(firstWord.length)
      .replace(SEPARATOR_PATTERN, "");
    // Only drop the contract word when a real title follows it.
    if (remainder) rest = remainder;
  }
  return `${cleanPrefix} ${rest}`;
}

/** True when the candidate changed anything from the defaults. */
export function hasCustomDesignResumeAiGuidance(
  guidance: DesignResumeAiGuidance | null | undefined,
): boolean {
  if (!guidance) return false;
  if (Object.keys(guidance.items).length > 0) return true;
  return DESIGN_RESUME_AI_SECTION_KEYS.some((key) => {
    const current = guidance.sections[key];
    const defaults = createDefaultDesignResumeAiSectionGuidance(key);
    return (
      current.mode !== defaults.mode ||
      current.share !== defaults.share ||
      current.notes !== defaults.notes ||
      current.prefix !== defaults.prefix
    );
  });
}
