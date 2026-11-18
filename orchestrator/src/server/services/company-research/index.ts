/**
 * Company research for one job: web research on the person's own AI account,
 * then the judge (quote checks + AI review), saved per workspace and job.
 *
 * Runs in the background; the job page polls GET until it is done. A run is
 * tracked in memory by workspace + job, so a run cut short by a server restart
 * shows up as "interrupted" instead of "running" forever.
 */
import { logger } from "@infra/logger";
import { sanitizeUnknown } from "@infra/sanitize";
import * as researchRepo from "@server/repositories/company-research";
import type {
  CompanyResearch,
  CompanyResearchBrief,
  CompanyResearchFact,
  Job,
} from "@shared/types";
import { resolveReadyAiAccount } from "../job-run-preflight";
import { createJobRunTracker } from "../job-runs";
import {
  buildResearchPrompt,
  normalizeResearchOutput,
  RESEARCH_JSON_SCHEMA,
} from "./brief";
import {
  decideVerdict,
  explainVerdict,
  type JudgeLlm,
  judgeBrief,
} from "./judge";
import { checkFactQuotes, type PageReader } from "./quote-check";
import { runWebResearch, type WebResearchRequest } from "./web-research";

export const INTERRUPTED_MESSAGE =
  "The research was interrupted (the server restarted). Run it again.";

const runs = createJobRunTracker("Research is already running for this job.");

export type CompanyResearchDeps = {
  webResearch?: (request: WebResearchRequest) => Promise<unknown>;
  readPage?: PageReader;
  judgeLlm?: JudgeLlm;
};

let testDeps: CompanyResearchDeps = {};
/** Test hook: replaces the CLI, page reader and judge model. */
export function __setCompanyResearchDepsForTests(deps: CompanyResearchDeps) {
  testDeps = deps;
}

export function isCompanyResearchRunning(jobId: string): boolean {
  return runs.isRunning(jobId);
}

/** The job's latest research; a "running" row with no live run is failed. */
export async function getCompanyResearchForJob(
  jobId: string,
): Promise<CompanyResearch | null> {
  const research = await researchRepo.getCompanyResearch(jobId);
  if (research?.status === "running" && !isCompanyResearchRunning(jobId)) {
    await researchRepo.finishCompanyResearchRow(research.id, {
      status: "failed",
      error: INTERRUPTED_MESSAGE,
    });
    return researchRepo.getCompanyResearch(jobId);
  }
  return research;
}

async function researchJob(
  job: Job,
  research: CompanyResearch,
  deps: CompanyResearchDeps,
): Promise<void> {
  const startedAt = Date.now();
  try {
    const raw = await (deps.webResearch ?? runWebResearch)({
      provider: research.provider,
      model: research.model,
      prompt: buildResearchPrompt(job),
      jsonSchema: RESEARCH_JSON_SCHEMA,
    });
    const output = normalizeResearchOutput(raw);
    const checks = await checkFactQuotes(output.facts, job, deps.readPage);
    const facts: CompanyResearchFact[] = output.facts.map((fact, index) => ({
      ...fact,
      check: checks[index] ?? "unreachable",
    }));
    const brief: CompanyResearchBrief = {
      summary: output.summary,
      facts,
      talkingPoints: output.talkingPoints,
      questionsToAsk: output.questionsToAsk,
    };
    const reviewed = await judgeBrief(job, brief, {
      model: research.model ?? "",
      llm: deps.judgeLlm,
    });
    const verdict = decideVerdict(reviewed);
    const judgement =
      verdict === "passed"
        ? reviewed
        : {
            ...reviewed,
            issues: Array.from(
              new Set([...explainVerdict(reviewed), ...reviewed.issues]),
            ).slice(0, 7),
          };
    await researchRepo.finishCompanyResearchRow(research.id, {
      status: "done",
      verdict,
      brief,
      judgement,
    });
    logger.info("Company research finished", {
      jobId: job.id,
      verdict,
      factCount: judgement.factCount,
      verifiedCount: judgement.verifiedCount,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "The research failed.";
    logger.warn("Company research failed", {
      jobId: job.id,
      provider: research.provider,
      durationMs: Date.now() - startedAt,
      error: sanitizeUnknown(message),
    });
    await researchRepo
      .finishCompanyResearchRow(research.id, {
        status: "failed",
        error: message.slice(0, 500),
      })
      .catch((saveError: unknown) => {
        logger.error("Could not save company research failure", {
          jobId: job.id,
          error: sanitizeUnknown(saveError),
        });
      });
  }
}

/**
 * Starts a research run for the job and returns the "running" record.
 * UNPROCESSABLE_ENTITY when no AI account is signed in; CONFLICT when a run
 * is already going for this workspace and job. The previous brief stays
 * readable until the new run succeeds, so a failed re-run loses nothing.
 */
export async function startCompanyResearch(
  job: Job,
  deps: CompanyResearchDeps = testDeps,
): Promise<CompanyResearch> {
  const research = await runs.start(
    job.id,
    async () => {
      const { provider, model } = await resolveReadyAiAccount();
      return researchRepo.startCompanyResearchRow({
        jobId: job.id,
        provider,
        model,
      });
    },
    (started) => researchJob(job, started, deps),
  );
  logger.info("Company research started", {
    jobId: job.id,
    provider: research.provider,
  });
  return research;
}

/** Waits for a running research (tests). */
export async function waitForCompanyResearch(jobId: string): Promise<void> {
  await runs.wait(jobId);
}

/**
 * Facts Boussole confirmed on their source page, for cover letters, from the
 * latest successful brief (still valid while a re-run is going or after a
 * failed one). Nothing when the review says the facts are about another
 * company.
 */
export async function getVerifiedResearchFacts(
  jobId: string,
): Promise<Array<{ claim: string; source: string }>> {
  const research = await researchRepo.getCompanyResearch(jobId);
  if (!research?.brief) return [];
  if (research.judgement?.wrongCompany) return [];
  return research.brief.facts
    .filter((fact) => fact.check === "verified")
    .map((fact) => ({ claim: fact.claim, source: fact.sourceUrl }));
}
