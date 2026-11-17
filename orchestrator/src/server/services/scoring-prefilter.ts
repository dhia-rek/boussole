/**
 * Cheap, deterministic pre-filter that runs BEFORE the LLM scoring call.
 *
 * Free-tier LLMs are rate-limited, and broad sources (e.g. the company-ATS
 * extractor) can surface hundreds of clearly-irrelevant roles per run. Spending
 * an LLM call to score a job that shares almost nothing with the candidate's
 * profile is wasted quota. This gate keeps such jobs (they stay in the DB and
 * are visible) but assigns them a deterministic low score WITHOUT an LLM call.
 *
 * It is intentionally conservative — it only filters jobs with essentially no
 * keyword overlap, so genuine borderline matches still reach the LLM. It also
 * fails open: if the profile yields no usable keywords, every job passes.
 */

const DEFAULT_MIN_OVERLAP = 2;

/** Score assigned to a pre-filtered job — low enough to rank below anything the
 *  LLM scored, distinct from 0 (which signals an error/mock elsewhere). */
export const PREFILTER_SCORE = 12;

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "you",
  "your",
  "our",
  "are",
  "will",
  "have",
  "this",
  "that",
  "from",
  "into",
  "job",
  "role",
  "team",
  "work",
  "years",
  "year",
  "experience",
  "skills",
  "ability",
  "strong",
  "company",
  "candidate",
  "responsibilities",
  "requirements",
  "including",
  "etc",
  "new",
  "using",
  "across",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9+#.]+/)
    .map((t) => t.replace(/^\.+|\.+$/g, ""))
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

function collectStrings(value: unknown, out: string[], depth = 0): void {
  if (depth > 6 || value == null) return;
  if (typeof value === "string") {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectStrings(v, out, depth + 1);
    return;
  }
  if (typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      collectStrings(v, out, depth + 1);
    }
  }
}

/** Domain keyword set drawn from the candidate's skills/headline/experience. */
export function buildProfileKeywords(
  profile: Record<string, unknown>,
): Set<string> {
  const basics =
    profile.basics && typeof profile.basics === "object"
      ? (profile.basics as Record<string, unknown>)
      : {};
  const sections =
    profile.sections && typeof profile.sections === "object"
      ? (profile.sections as Record<string, unknown>)
      : {};

  const strings: string[] = [];
  for (const k of ["label", "headline", "summary"]) {
    if (typeof basics[k] === "string") strings.push(basics[k] as string);
  }
  for (const key of ["skills", "experience", "projects"]) {
    collectStrings(sections[key], strings);
    collectStrings((profile as Record<string, unknown>)[key], strings);
  }

  const keywords = new Set<string>();
  for (const s of strings) for (const t of tokenize(s)) keywords.add(t);
  return keywords;
}

export interface PrefilterResult {
  pass: boolean;
  overlap: number;
  reason: string;
}

export function resolveMinOverlap(envValue?: string | null): number {
  const raw = (envValue ?? "").trim();
  if (!raw) return DEFAULT_MIN_OVERLAP;
  const parsed = Number.parseInt(raw, 10);
  // 0 disables the pre-filter entirely (everything reaches the LLM).
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_MIN_OVERLAP;
  return parsed;
}

/**
 * Decide whether a job is relevant enough to spend an LLM scoring call on.
 * Pure and side-effect free.
 */
export function prefilterJob(args: {
  title: string;
  description: string;
  profileKeywords: Set<string>;
  minOverlap: number;
}): PrefilterResult {
  // Fail open: no usable profile keywords, or pre-filter disabled.
  if (args.profileKeywords.size === 0 || args.minOverlap <= 0) {
    return { pass: true, overlap: 0, reason: "" };
  }

  const jobTokens = new Set(tokenize(`${args.title} ${args.description}`));
  let overlap = 0;
  for (const kw of args.profileKeywords) {
    if (jobTokens.has(kw)) overlap += 1;
  }

  if (overlap >= args.minOverlap) {
    return { pass: true, overlap, reason: "" };
  }
  return {
    pass: false,
    overlap,
    reason: `Pre-filtered: only ${overlap} keyword${
      overlap === 1 ? "" : "s"
    } overlap with your profile — AI scoring skipped to conserve quota.`,
  };
}
