import type { AiProvider } from "./ai-account";

/**
 * One line of the candidate's CV, numbered by Boussole ("L1", "L2", …). The
 * CV is the dictionary: the review may only talk about these lines.
 */
export interface CvCheckLine {
  ref: string;
  /** Section key of the CV ("headline", "summary", "experience", …) or a custom section id. */
  section: string;
  sectionTitle: string;
  /** The entry the line belongs to, e.g. "Acme — Data Engineer". Empty for headline/summary. */
  entry: string;
  /** CV item id, when the line belongs to an item. */
  itemId: string | null;
  text: string;
}

/** keep: helps for this job · reword: useful, but say it differently · cut: not it for this job. */
export type CvCheckVerdict = "keep" | "reword" | "cut";

export interface CvCheckLineReview extends CvCheckLine {
  verdict: CvCheckVerdict;
  reason: string;
  /** Rewording built only from what the CV already says; empty unless "reword". */
  suggestion: string;
  /**
   * Numbers, tools or names in the suggestion that appear nowhere in the CV.
   * Use the suggestion only if they are true.
   */
  newTerms: string[];
}

export interface CvCheckGap {
  requirement: string;
  /** Closest CV line, if any ("L12"). */
  closestRef: string | null;
  note: string;
}

export interface CvCheckResult {
  overall: string;
  priorities: string[];
  lines: CvCheckLineReview[];
  missing: CvCheckGap[];
  /** Lines the AI did not answer for; they are shown as "keep". */
  unreviewedCount?: number;
  /** Lines beyond the review limit, not sent at all. */
  skippedLineCount?: number;
}

export type CvCheckStatus = "running" | "done" | "failed";

export interface CvCheck {
  id: string;
  jobId: string;
  status: CvCheckStatus;
  provider: AiProvider;
  model: string | null;
  /** The CV variant behind `result` (the last successful check). */
  cvId: string | null;
  cvTitle: string | null;
  cvLanguage: string | null;
  cvRevision: number | null;
  /** True when that CV has been edited (or another variant now applies) since the check. */
  cvChanged: boolean;
  result: CvCheckResult | null;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
}
