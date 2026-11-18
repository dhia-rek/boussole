/**
 * A "keyword estimate" is the fallback score Boussole stores when the AI
 * account could not score a job during a pipeline run. It is not an AI
 * judgement of fit and must be shown as an estimate.
 */
export const KEYWORD_ESTIMATE_REASON =
  "Keyword estimate, not an AI score: your AI account could not score this job when it was found. Rescore it to get a real score.";

/** Earlier wordings of the same fallback, still stored on older jobs. */
const KEYWORD_ESTIMATE_MARKERS = [
  "keyword estimate, not an ai score",
  "scored using keyword matching",
  "scored by keyword matching",
];

export function isKeywordEstimate(reason: string | null | undefined): boolean {
  if (!reason) return false;
  const normalized = reason.trim().toLowerCase();
  return KEYWORD_ESTIMATE_MARKERS.some((marker) =>
    normalized.startsWith(marker),
  );
}
