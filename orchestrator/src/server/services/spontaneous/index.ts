/**
 * Spontaneous applications, start to finish: pick a company, find verified
 * contacts (web research on the person's AI account + optional Hunter.io),
 * write the email from the CV and verified facts, and log it on the
 * Applications board once sent.
 */
import { badRequest, conflict, notFound } from "@infra/errors";
import { logger } from "@infra/logger";
import { sanitizeUnknown } from "@infra/sanitize";
import * as jobsRepo from "@server/repositories/jobs";
import { getSetting } from "@server/repositories/settings";
import * as outreachRepo from "@server/repositories/spontaneous";
import type { AiProvider, SpontaneousOutreach } from "@shared/types";
import { transitionStage } from "../applicationTracking";
import type { PageReader } from "../company-research/quote-check";
import {
  runWebResearch,
  type WebResearchRequest,
} from "../company-research/web-research";
import { resolveReadyAiAccount } from "../job-run-preflight";
import { createJobRunTracker } from "../job-runs";
import type { LlmService } from "../llm/service";
import {
  buildContactsPrompt,
  CONTACTS_JSON_SCHEMA,
  normalizeContactsOutput,
  rankContacts,
  verifyContacts,
} from "./contacts";
import { type EmailRequest, writeOutreachEmail } from "./email";
import { domainOf, lookupHunterContacts } from "./hunter";

export const INTERRUPTED_MESSAGE =
  "The search was interrupted (the server restarted). Search again.";

const runs = createJobRunTracker("This company is already being searched.");

type Deps = {
  webResearch?: (request: WebResearchRequest) => Promise<unknown>;
  readPage?: PageReader;
  hunterFetch?: typeof fetch;
  emailLlm?: Pick<LlmService, "callJson">;
};
let testDeps: Deps = {};
/** Test hook: replaces the CLI, page reader, Hunter and email model. */
export function __setSpontaneousDepsForTests(deps: Deps) {
  testDeps = deps;
}

export { listOutreachSuggestions } from "@server/repositories/spontaneous";

export async function listOutreachHistory(): Promise<SpontaneousOutreach[]> {
  const items = await outreachRepo.listOutreach();
  return Promise.all(items.map(markInterrupted));
}

async function markInterrupted(
  outreach: SpontaneousOutreach,
): Promise<SpontaneousOutreach> {
  if (outreach.status === "researching" && !runs.isRunning(outreach.id)) {
    return (
      (await outreachRepo.updateOutreach(outreach.id, {
        status: "failed",
        error: INTERRUPTED_MESSAGE,
      })) ?? outreach
    );
  }
  return outreach;
}

export async function getOutreachOrThrow(
  id: string,
): Promise<SpontaneousOutreach> {
  const outreach = await outreachRepo.getOutreach(id);
  if (!outreach) throw notFound("Spontaneous application not found");
  return markInterrupted(outreach);
}

function normalizeWebsite(value: string | null | undefined): string | null {
  const domain = domainOf(value?.trim() || null);
  return domain ? `https://${domain}` : null;
}

async function findContacts(
  outreach: SpontaneousOutreach,
  account: { provider: AiProvider; model: string | null },
  deps: Deps,
): Promise<void> {
  const startedAt = Date.now();
  try {
    const raw = normalizeContactsOutput(
      await (deps.webResearch ?? runWebResearch)({
        provider: account.provider,
        model: account.model,
        prompt: buildContactsPrompt(outreach.company, outreach.website),
        jsonSchema: CONTACTS_JSON_SCHEMA,
      }),
    );
    const { contacts, facts } = await verifyContacts(raw, deps.readPage);
    const website = outreach.website ?? normalizeWebsite(raw.website);
    const hunterKey = (await getSetting("hunterApiKey"))?.trim();
    const domain = domainOf(website);
    const hunter =
      hunterKey && domain
        ? await lookupHunterContacts(domain, hunterKey, deps.hunterFetch)
        : [];
    const known = new Set(contacts.map((contact) => contact.value));
    const merged = rankContacts([
      ...contacts,
      ...hunter.filter((contact) => !known.has(contact.value)),
    ]);
    await outreachRepo.updateOutreach(outreach.id, {
      status: "ready",
      website,
      summary: raw.summary || null,
      facts,
      contacts: merged,
      error: null,
    });
    logger.info("Spontaneous contacts found", {
      outreachId: outreach.id,
      contacts: merged.length,
      verifiedEmails: merged.filter(
        (contact) => contact.kind === "email" && contact.check === "verified",
      ).length,
      hunter: hunter.length,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "The search failed.";
    logger.warn("Spontaneous contact search failed", {
      outreachId: outreach.id,
      error: sanitizeUnknown(message),
    });
    await outreachRepo
      .updateOutreach(outreach.id, {
        status: "failed",
        error: message.slice(0, 500),
      })
      .catch(() => undefined);
  }
}

/** Starts the contact search for a company; returns the "researching" record. */
export async function startOutreach(
  input: { company: string; website?: string | null },
  deps: Deps = testDeps,
): Promise<SpontaneousOutreach> {
  const company = input.company.trim();
  if (!company) throw badRequest("Enter a company name or website.");
  const account = await resolveReadyAiAccount();
  const outreach = await outreachRepo.createOutreach({
    company,
    website: normalizeWebsite(input.website),
  });
  await runs.start(
    outreach.id,
    async () => outreach,
    (started) => findContacts(started, account, deps),
  );
  logger.info("Spontaneous contact search started", {
    outreachId: outreach.id,
  });
  return outreach;
}

export async function waitForOutreach(id: string): Promise<void> {
  await runs.wait(id);
}

export async function writeEmail(
  id: string,
  request: EmailRequest,
  deps: Deps = testDeps,
): Promise<SpontaneousOutreach> {
  const outreach = await getOutreachOrThrow(id);
  if (outreach.jobId) {
    throw conflict("This application was already sent and logged.");
  }
  const email = await writeOutreachEmail(outreach, request, {
    llm: deps.emailLlm,
  });
  const updated = await outreachRepo.updateOutreach(id, { email });
  if (!updated) throw notFound("Spontaneous application not found");
  return updated;
}

/**
 * Logs a sent spontaneous application: a job on the Applications board in
 * "Applied", with the recipient and the email on record for follow-ups.
 */
export async function logOutreachSent(
  id: string,
  sent: { recipient: string | null; subject: string; body: string },
): Promise<SpontaneousOutreach> {
  const outreach = await getOutreachOrThrow(id);
  if (outreach.jobId) return outreach;
  const role = outreach.email?.targetRole?.trim();
  const french = (outreach.email?.language ?? "fr") === "fr";
  const title = `${french ? "Candidature spontanée" : "Spontaneous application"}${role ? ` – ${role}` : ""}`;
  const jobUrl = `${outreach.website ?? `https://duckduckgo.com/?q=${encodeURIComponent(outreach.company)}`}#spontaneous-${outreach.id.slice(0, 8)}`;
  const job = await jobsRepo.createJob({
    source: "manual",
    title,
    employer: outreach.company,
    employerUrl: outreach.website ?? undefined,
    jobUrl,
    jobDescription: [
      `${french ? "Candidature spontanée envoyée" : "Spontaneous application sent"}${sent.recipient ? ` ${french ? "à" : "to"} ${sent.recipient}` : ""}.`,
      "",
      `${french ? "Objet" : "Subject"}: ${sent.subject}`,
      "",
      sent.body,
    ].join("\n"),
  });
  const appliedAt = new Date();
  transitionStage(
    job.id,
    "applied",
    Math.floor(appliedAt.getTime() / 1000),
    {
      eventLabel: "Spontaneous application via email",
      note: sent.recipient ? `to ${sent.recipient}` : null,
      actor: "user",
    },
    null,
  );
  await jobsRepo.updateJob(job.id, {
    status: "applied",
    appliedAt: appliedAt.toISOString(),
  });
  const updated = await outreachRepo.updateOutreach(id, { jobId: job.id });
  logger.info("Spontaneous application logged", {
    outreachId: id,
    jobId: job.id,
  });
  return updated ?? outreach;
}
