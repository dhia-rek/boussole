/**
 * The judge. Quote checks are deterministic (quote-check.ts); this adds an AI
 * review of relevance and specificity, then applies a fixed verdict rule.
 */
import { logger } from "@infra/logger";
import type {
  CompanyResearchBrief,
  CompanyResearchJudgement,
  CompanyResearchVerdict,
  Job,
} from "@shared/types";
import { LlmService } from "../llm/service";
import type { JsonSchemaDefinition } from "../llm/types";

export const MIN_VERIFIED_FACTS = 3;
export const MIN_VERIFIED_RATIO = 0.6;
export const MIN_SCORE = 3;
const MAX_ISSUES = 5;

const JUDGE_SCHEMA: JsonSchemaDefinition = {
  name: "company_research_review",
  schema: {
    type: "object",
    properties: {
      relevance: {
        type: "integer",
        description:
          "1-5: are these facts about the right company and useful for applying to this job?",
      },
      specificity: {
        type: "integer",
        description:
          "1-5: are the facts and talking points concrete (names, numbers, products) rather than generic?",
      },
      wrong_company: {
        type: "boolean",
        description:
          "True if the facts seem to describe a different company than the one hiring.",
      },
      issues: {
        type: "array",
        items: { type: "string" },
        description: "Up to 5 short problems a reader should know about.",
      },
    },
    required: ["relevance", "specificity", "wrong_company", "issues"],
    additionalProperties: false,
  },
};

type JudgeAnswer = {
  relevance: number;
  specificity: number;
  wrong_company: boolean;
  issues: string[];
};

export type JudgeLlm = Pick<LlmService, "callJson">;

function toScore(value: unknown): number | null {
  const number = typeof value === "number" ? Math.round(value) : Number.NaN;
  return Number.isFinite(number) ? Math.min(5, Math.max(1, number)) : null;
}

function buildJudgePrompt(job: Job, brief: CompanyResearchBrief): string {
  const facts = brief.facts
    .map(
      (fact, index) =>
        `${index + 1}. [${fact.topic}] ${fact.claim} (source: ${fact.sourceUrl}; quote check: ${fact.check})`,
    )
    .join("\n");
  return `
Review a company research brief written for someone applying to this job.

Job: ${job.title} at ${job.employer}${job.location ? ` (${job.location})` : ""}

Summary: ${brief.summary || "(none)"}

Facts:
${facts || "(none)"}

Talking points:
${brief.talkingPoints.map((point) => `- ${point}`).join("\n") || "(none)"}

Questions to ask:
${brief.questionsToAsk.map((question) => `- ${question}`).join("\n") || "(none)"}

Score strictly. "quote check: verified" means Boussole found the quote on the cited page; "not_found" or "unreachable" means it could not confirm it.
Flag talking points that rest on unverified facts, generic filler, or facts about a different company with the same name.
Write the issues in the language of the summary.
`.trim();
}

/** Counts plus the AI review; the AI part degrades to nulls if it fails. */
export async function judgeBrief(
  job: Job,
  brief: CompanyResearchBrief,
  options: { model: string; llm?: JudgeLlm },
): Promise<CompanyResearchJudgement> {
  const factCount = brief.facts.length;
  const verifiedCount = brief.facts.filter(
    (fact) => fact.check === "verified",
  ).length;
  const base: CompanyResearchJudgement = {
    factCount,
    verifiedCount,
    relevance: null,
    specificity: null,
    wrongCompany: false,
    issues: [],
  };
  if (factCount === 0) {
    return { ...base, issues: ["The research returned no usable facts."] };
  }

  const llm = options.llm ?? new LlmService();
  const result = await llm.callJson<JudgeAnswer>({
    model: options.model,
    messages: [{ role: "user", content: buildJudgePrompt(job, brief) }],
    jsonSchema: JUDGE_SCHEMA,
    maxRetries: 1,
    jobId: job.id,
  });
  if (!result.success) {
    logger.warn("Company research review failed", {
      jobId: job.id,
      error: result.error,
    });
    return {
      ...base,
      issues: [
        "The AI quality check could not run, so read the brief yourself.",
      ],
    };
  }
  const answer = result.data;
  return {
    ...base,
    relevance: toScore(answer.relevance),
    specificity: toScore(answer.specificity),
    wrongCompany: answer.wrong_company === true,
    issues: (Array.isArray(answer.issues) ? answer.issues : [])
      .filter((issue): issue is string => typeof issue === "string")
      .map((issue) => issue.trim())
      .filter(Boolean)
      .slice(0, MAX_ISSUES),
  };
}

/**
 * "passed" needs: at least 3 verified facts, at least 60% of facts verified,
 * relevance and specificity of 3 or more, and no sign of a wrong company.
 */
export function decideVerdict(
  judgement: CompanyResearchJudgement,
): CompanyResearchVerdict {
  const ratio =
    judgement.factCount === 0
      ? 0
      : judgement.verifiedCount / judgement.factCount;
  const passed =
    judgement.verifiedCount >= MIN_VERIFIED_FACTS &&
    ratio >= MIN_VERIFIED_RATIO &&
    (judgement.relevance ?? 0) >= MIN_SCORE &&
    (judgement.specificity ?? 0) >= MIN_SCORE &&
    !judgement.wrongCompany;
  return passed ? "passed" : "needs_review";
}
