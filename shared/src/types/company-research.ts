import type { AiProvider } from "./ai-account";

/** What a researched fact is about. */
export type CompanyResearchTopic =
  | "company"
  | "product"
  | "market"
  | "size"
  | "news"
  | "culture"
  | "role";

export const COMPANY_RESEARCH_TOPICS: readonly CompanyResearchTopic[] = [
  "company",
  "product",
  "market",
  "size",
  "news",
  "culture",
  "role",
];

/**
 * Result of Boussole re-reading the cited page itself:
 * - verified: the quote is on the page
 * - not_found: the page loaded but the quote is not on it
 * - unreachable: the page could not be read (blocked, not public, not HTML…)
 */
export type CompanyResearchFactCheck = "verified" | "not_found" | "unreachable";

export interface CompanyResearchFact {
  topic: CompanyResearchTopic;
  claim: string;
  sourceUrl: string;
  quote: string;
  check: CompanyResearchFactCheck;
}

export interface CompanyResearchBrief {
  summary: string;
  facts: CompanyResearchFact[];
  talkingPoints: string[];
  questionsToAsk: string[];
}

export interface CompanyResearchJudgement {
  factCount: number;
  verifiedCount: number;
  /** 1–5, null when the AI quality check could not run. */
  relevance: number | null;
  /** 1–5, null when the AI quality check could not run. */
  specificity: number | null;
  /** The facts look like they describe a different company. */
  wrongCompany: boolean;
  issues: string[];
}

export type CompanyResearchStatus = "running" | "done" | "failed";
export type CompanyResearchVerdict = "passed" | "needs_review";

export interface CompanyResearch {
  id: string;
  jobId: string;
  status: CompanyResearchStatus;
  verdict: CompanyResearchVerdict | null;
  provider: AiProvider;
  model: string | null;
  brief: CompanyResearchBrief | null;
  judgement: CompanyResearchJudgement | null;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
}
