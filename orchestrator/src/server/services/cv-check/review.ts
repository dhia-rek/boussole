/**
 * The AI review of the CV dictionary against one job, and the deterministic
 * clean-up around it: unknown line refs are dropped, missing ones count as
 * "keep", and suggestions that bring in words the CV never uses are flagged.
 */
import type {
  CvCheckGap,
  CvCheckLine,
  CvCheckLineReview,
  CvCheckResult,
  CvCheckVerdict,
  DesignResumeAiGuidance,
  Job,
} from "@shared/types";
import type { JsonSchemaDefinition } from "../llm/types";

const MAX_JOB_DESCRIPTION_CHARS = 6000;
const MAX_TEXT = 500;
const MAX_MISSING = 8;
const MAX_PRIORITIES = 3;
const VERDICTS: readonly CvCheckVerdict[] = ["keep", "reword", "cut"];

export const CV_REVIEW_SCHEMA: JsonSchemaDefinition = {
  name: "cv_check",
  schema: {
    type: "object",
    properties: {
      overall: { type: "string" },
      priorities: { type: "array", items: { type: "string" } },
      lines: {
        type: "array",
        items: {
          type: "object",
          properties: {
            ref: { type: "string" },
            verdict: { type: "string", enum: [...VERDICTS] },
            reason: { type: "string" },
            suggestion: { type: "string" },
          },
          required: ["ref", "verdict", "reason", "suggestion"],
          additionalProperties: false,
        },
      },
      missing: {
        type: "array",
        items: {
          type: "object",
          properties: {
            requirement: { type: "string" },
            closest_ref: { type: "string" },
            note: { type: "string" },
          },
          required: ["requirement", "closest_ref", "note"],
          additionalProperties: false,
        },
      },
    },
    required: ["overall", "priorities", "lines", "missing"],
    additionalProperties: false,
  },
};

function clip(value: unknown, max = MAX_TEXT): string {
  const text =
    typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function buildCvReviewPrompt(input: {
  job: Job;
  lines: CvCheckLine[];
  guidance?: DesignResumeAiGuidance | null;
  candidateRules?: string;
}): string {
  const { job, lines, guidance } = input;
  let currentSection = "";
  const cv: string[] = [];
  for (const line of lines) {
    if (line.sectionTitle !== currentSection) {
      currentSection = line.sectionTitle;
      cv.push(`\n## ${currentSection}`);
    }
    const note = line.itemId
      ? clip(guidance?.items?.[line.itemId]?.notes ?? "", 300)
      : "";
    cv.push(
      `${line.ref}${line.entry ? ` [${line.entry}]` : ""}: ${line.text}${note ? ` (candidate note: ${note})` : ""}`,
    );
  }
  const description = clip(job.jobDescription ?? "", MAX_JOB_DESCRIPTION_CHARS);

  return `
You review a candidate's CV against one job offer, line by line, like a demanding recruiter for this exact role.

JOB
Title: ${job.title}
Company: ${job.employer}${job.location ? `\nLocation: ${job.location}` : ""}
Description:
${description || "(no description)"}

CV (each line has a reference such as L3; the CV is the only source of truth about the candidate)
${cv.join("\n")}
${input.candidateRules ? `\n${input.candidateRules}\n` : ""}
For every line reference above, return one entry in "lines":
- "keep": the line helps for this job as written.
- "reword": the line is useful but undersells or blurs what matters for this job. Give "suggestion": the line rewritten for this job.
- "cut": the line does not help for this job (off-topic, outdated, noise). Say why in one sentence; dropping or moving it down is up to the candidate.
- "reason": one short sentence tied to the job description. Empty only for an obvious "keep".

Hard rules for suggestions:
- Use only facts already in the CV: rephrase, reorder, put the job's vocabulary on what the candidate really did. Never add a tool, number, employer, title, duty or result the CV does not state.
- Keep the line's language (a French line stays French).
- "suggestion" is empty unless the verdict is "reword".

"missing": up to ${MAX_MISSING} requirements of the job the CV does not show. "closest_ref" is the closest CV line (e.g. "L7") or "" if nothing is close. "note" says honestly whether it is a wording gap (the CV has it, under another name) or a real gap. Never suggest inventing experience.
"priorities": the ${MAX_PRIORITIES} changes that would matter most for this job, most important first, naming line references.
"overall": two sentences on how well this CV fits this job.
Write reasons, notes, priorities and overall in the language of the job description.
`.trim();
}

/** Numbers, acronyms, CamelCase/product names and tool-like tokens (C++, Node.js). */
const NOTABLE_TOKEN =
  /(?:\b\d[\d.,]*\s?[%kKmM€$]?|\b[A-Z][A-Z0-9]{1,}\b|\b[a-z]*[A-Z][a-z0-9]+[A-Z]\w*\b|\b\w+(?:\.js|\+\+|#)|(?<=[^.!?:\n]\s)[A-Z][\p{L}0-9-]{2,})/gu;

function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Words of `suggestion` that look like facts (numbers, names, tools) and occur
 * nowhere in the CV. A non-empty list means the suggestion may add something
 * the candidate never claimed.
 */
export function findNewTerms(suggestion: string, cvText: string): string[] {
  const haystack = normalize(cvText);
  const found = new Set<string>();
  for (const match of suggestion.matchAll(NOTABLE_TOKEN)) {
    const token = match[0].trim().replace(/[.,]+$/, "");
    if (token.length < 2) continue;
    const needle = normalize(token).replace(/\s/g, "");
    if (!haystack.replace(/\s/g, "").includes(needle)) found.add(token);
  }
  return Array.from(found).slice(0, 6);
}

export function normalizeCvReview(
  value: unknown,
  lines: CvCheckLine[],
): CvCheckResult {
  const record =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const byRef = new Map<string, Record<string, unknown>>();
  for (const raw of Array.isArray(record.lines) ? record.lines : []) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    const ref = clip(entry.ref, 10).toUpperCase();
    if (!byRef.has(ref)) byRef.set(ref, entry);
  }
  const cvText = lines.map((line) => `${line.entry} ${line.text}`).join("\n");
  const knownRefs = new Set(lines.map((line) => line.ref));

  const reviewed: CvCheckLineReview[] = lines.map((line) => {
    const entry = byRef.get(line.ref);
    const rawVerdict = clip(entry?.verdict, 10) as CvCheckVerdict;
    const verdict: CvCheckVerdict = VERDICTS.includes(rawVerdict)
      ? rawVerdict
      : "keep";
    let suggestion = verdict === "reword" ? clip(entry?.suggestion) : "";
    if (suggestion && normalize(suggestion) === normalize(line.text)) {
      suggestion = "";
    }
    return {
      ...line,
      verdict: verdict === "reword" && !suggestion ? "keep" : verdict,
      reason: clip(entry?.reason, 300),
      suggestion,
      newTerms: suggestion ? findNewTerms(suggestion, cvText) : [],
    };
  });

  const missing: CvCheckGap[] = [];
  for (const raw of Array.isArray(record.missing) ? record.missing : []) {
    if (!raw || typeof raw !== "object") continue;
    const gap = raw as Record<string, unknown>;
    const requirement = clip(gap.requirement, 200);
    if (!requirement) continue;
    const closest = clip(gap.closest_ref ?? gap.closestRef, 10).toUpperCase();
    missing.push({
      requirement,
      closestRef: knownRefs.has(closest) ? closest : null,
      note: clip(gap.note, 300),
    });
    if (missing.length >= MAX_MISSING) break;
  }

  return {
    overall: clip(record.overall, 600),
    priorities: (Array.isArray(record.priorities) ? record.priorities : [])
      .map((item) => clip(item, 300))
      .filter(Boolean)
      .slice(0, MAX_PRIORITIES),
    lines: reviewed,
    missing,
  };
}
