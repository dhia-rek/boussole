/**
 * The shape the web research must return, the prompt that asks for it, and
 * the clean-up applied to whatever comes back.
 *
 * The schema is written for both CLIs' strict structured output: every
 * property required, no additional properties, no length keywords (limits are
 * stated in the prompt and enforced in `normalizeResearchOutput`).
 */
import {
  COMPANY_RESEARCH_TOPICS,
  type CompanyResearchTopic,
  type Job,
} from "@shared/types";

export const MAX_FACTS = 12;
export const MAX_TALKING_POINTS = 5;
export const MAX_QUESTIONS = 5;
const MAX_JOB_DESCRIPTION_CHARS = 3500;
const MAX_CLAIM_CHARS = 400;
const MAX_QUOTE_CHARS = 400;
const MAX_LINE_CHARS = 400;
const MAX_SUMMARY_CHARS = 900;

export const RESEARCH_JSON_SCHEMA = {
  type: "object",
  properties: {
    summary: {
      type: "string",
      description:
        "Two or three sentences: what the company does, for whom, and where this role fits.",
    },
    facts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          topic: { type: "string", enum: [...COMPANY_RESEARCH_TOPICS] },
          claim: {
            type: "string",
            description: "One factual sentence in your own words.",
          },
          source_url: {
            type: "string",
            description: "The exact address of the page you opened.",
          },
          quote: {
            type: "string",
            description:
              "Words copied exactly from that page that support the claim.",
          },
        },
        required: ["topic", "claim", "source_url", "quote"],
        additionalProperties: false,
      },
    },
    talking_points: { type: "array", items: { type: "string" } },
    questions_to_ask: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "facts", "talking_points", "questions_to_ask"],
  additionalProperties: false,
} as const;

export type RawResearchFact = {
  topic: CompanyResearchTopic;
  claim: string;
  sourceUrl: string;
  quote: string;
};

export type RawResearch = {
  summary: string;
  facts: RawResearchFact[];
  talkingPoints: string[];
  questionsToAsk: string[];
};

function clip(value: string, max: number): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

/**
 * Only the job fields the research needs. No candidate data is sent: the
 * research is about the company, not the person.
 */
export function buildResearchPrompt(job: Job): string {
  const description = clip(job.jobDescription ?? "", MAX_JOB_DESCRIPTION_CHARS);
  const posting = [
    `Job title: ${job.title}`,
    `Company: ${job.employer}`,
    job.employerUrl
      ? `Company website (from the posting): ${job.employerUrl}`
      : "",
    job.location ? `Location: ${job.location}` : "",
    job.jobUrl ? `Job posting address: ${job.jobUrl}` : "",
    description ? `Job description:\n${description}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return `
You are researching a company for someone preparing a job application. Search the web and open the pages you rely on.

${posting}

Find out what the company does, its products and customers, its market, size, recent news, how it works, and what this role really involves there.

Rules:
- Every fact must come from a page you opened yourself. Prefer the company's own website, reputable press, official company registries (for French companies: Pappers, societe.com, Infogreffe) and the job posting itself.
- "quote" must be copied character for character from that page, in the page's own language: one sentence or phrase of 8 to 40 words. Never quote a search-result snippet, never translate or shorten inside the quote.
- "source_url" is the exact address of the page the quote comes from.
- If several companies share this name, use the job posting to pick the right one. If you cannot tell, say so in the summary and keep only facts you are sure about.
- Between 4 and ${MAX_FACTS} facts. Fewer, solid facts beat many weak ones. Never guess.
- Topics: company, product, market, size, news, culture, role.
- talking_points: up to ${MAX_TALKING_POINTS} short ideas for the cover letter or interview, each built only on the facts above.
- questions_to_ask: up to ${MAX_QUESTIONS} specific questions the candidate could ask in an interview.
- Write summary, claims, talking points and questions in the language of the job description.
- Answer with the JSON object only.
`.trim();
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asStringList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => clip(asString(item), MAX_LINE_CHARS))
    .filter(Boolean)
    .slice(0, max);
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/** Accepts both the snake_case wire format and camelCase; drops bad facts. */
export function normalizeResearchOutput(value: unknown): RawResearch {
  if (!value || typeof value !== "object") {
    throw new Error("The research did not return a brief.");
  }
  const record = value as Record<string, unknown>;
  const rawFacts = Array.isArray(record.facts) ? record.facts : [];
  const facts: RawResearchFact[] = [];
  for (const item of rawFacts) {
    if (!item || typeof item !== "object") continue;
    const fact = item as Record<string, unknown>;
    const topic = asString(fact.topic) as CompanyResearchTopic;
    const sourceUrl = asString(fact.source_url ?? fact.sourceUrl).trim();
    const claim = clip(asString(fact.claim), MAX_CLAIM_CHARS);
    const quote = clip(asString(fact.quote), MAX_QUOTE_CHARS);
    if (!claim || !quote || !isHttpUrl(sourceUrl)) continue;
    facts.push({
      topic: COMPANY_RESEARCH_TOPICS.includes(topic) ? topic : "company",
      claim,
      sourceUrl,
      quote,
    });
    if (facts.length >= MAX_FACTS) break;
  }
  return {
    summary: clip(asString(record.summary), MAX_SUMMARY_CHARS),
    facts,
    talkingPoints: asStringList(
      record.talking_points ?? record.talkingPoints,
      MAX_TALKING_POINTS,
    ),
    questionsToAsk: asStringList(
      record.questions_to_ask ?? record.questionsToAsk,
      MAX_QUESTIONS,
    ),
  };
}
