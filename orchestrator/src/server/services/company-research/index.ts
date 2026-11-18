/**
 * Company research for one job: web research on the person's own AI account,
 * then the judge (quote checks + AI review), saved per workspace and job.
 *
 * Runs in the background; the job page polls GET until it is done. A run is
 * tracked in memory by workspace + job, so a run cut short by a server restart
 * shows up as "interrupted" instead of "running" forever.
 */
import { conflict } from "@infra/errors";
import { logger } from "@infra/logger";
import { runWithRequestContext } from "@infra/request-context";
import { sanitizeUnknown } from "@infra/sanitize";
import * as researchRepo from "@server/repositories/company-research";
import { getActiveTenantId } from "@server/tenancy/context";
import type {
  CompanyResearch,
  CompanyResearchBrief,
  CompanyResearchFact,
  Job,
} from "@shared/types";
import {
  resolveActiveAiProvider,
  resolveModelForProvider,
} from "../modelSelection";
import {
  buildResearchPrompt,
  normalizeResearchOutput,
  RESEARCH_JSON_SCHEMA,
} from "./brief";
import { decideVerdict, type JudgeLlm, judgeBrief } from "./judge";
import { checkFactQuotes, type PageReader } from "./quote-check";
import { runWebResearch, type WebResearchRequest } from "./web-research";

export const INTERRUPTED_MESSAGE =
  "The research was interrupted (the server restarted). Run it again.";

const activeRuns = new Map<string, Promise<void>>();
const runKey = (tenantId: string, jobId: string) => `${tenantId}:${jobId}`;

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
  return activeRuns.has(runKey(getActiveTenantId(), jobId));
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
    const judgement = await judgeBrief(job, brief, {
      model: research.model ?? "",
      llm: deps.judgeLlm,
    });
    const verdict = decideVerdict(judgement);
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
 * Starts a research run for the job and returns the "running" record. Throws
 * CONFLICT if one is already running for this workspace and job. Problems
 * during the run (e.g. no AI account signed in) end as a "failed" record.
 */
export async function startCompanyResearch(
  job: Job,
  deps: CompanyResearchDeps = testDeps,
): Promise<CompanyResearch> {
  const tenantId = getActiveTenantId();
  const key = runKey(tenantId, job.id);
  if (activeRuns.has(key)) {
    throw conflict("Research is already running for this job.");
  }
  // Claim the slot before the first await so a double click cannot start two.
  let release: () => void = () => undefined;
  activeRuns.set(
    key,
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );

  let research: CompanyResearch;
  try {
    const provider = await resolveActiveAiProvider();
    const model = (await resolveModelForProvider(provider)) || null;
    research = await researchRepo.startCompanyResearchRow({
      jobId: job.id,
      provider,
      model,
    });
  } catch (error) {
    activeRuns.delete(key);
    release();
    throw error;
  }

  const run = runWithRequestContext({ tenantId, jobId: job.id }, () =>
    researchJob(job, research, deps),
  ).finally(() => {
    activeRuns.delete(key);
    release();
  });
  activeRuns.set(key, run);
  logger.info("Company research started", {
    jobId: job.id,
    provider: research.provider,
  });
  return research;
}

/** Waits for a running research (tests and graceful shutdown). */
export async function waitForCompanyResearch(jobId: string): Promise<void> {
  await activeRuns.get(runKey(getActiveTenantId(), jobId));
}

/**
 * Facts Boussole confirmed on their source page, for cover letters. Nothing
 * when the review says the facts are about another company.
 */
export async function getVerifiedResearchFacts(
  jobId: string,
): Promise<Array<{ claim: string; source: string }>> {
  const research = await researchRepo.getCompanyResearch(jobId);
  if (research?.status !== "done" || !research.brief) return [];
  if (research.judgement?.wrongCompany) return [];
  return research.brief.facts
    .filter((fact) => fact.check === "verified")
    .map((fact) => ({ claim: fact.claim, source: fact.sourceUrl }));
}
