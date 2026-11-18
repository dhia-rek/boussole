/**
 * Preference learner: turns the tenant's recent apply/skip decisions and
 * application outcomes into `/memories/preferences.md`, the Deep Agents
 * memory file the application agent reads.
 *
 * Design choice: one LangChain model call (ChatClaudeCli.invoke), not a
 * multi-step deep agent. The input is a bounded table we build ourselves and
 * the output is a single file we validate and write deterministically — an
 * agent loop would add CLI round trips and failure modes without adding
 * information. "Learning" here means rewriting memory from evidence; no model
 * is trained.
 */
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { db, schema } from "@server/db";
import { getActiveTenantId } from "@server/tenancy/context";
import type { PreferenceLearnerOutput } from "@shared/types";
import { and, desc, eq, inArray, isNotNull, or } from "drizzle-orm";
import { contentToText } from "./chat-claude-cli";
import { readPreferences, writePreferences } from "./memory-store";

const { jobs, stageEvents } = schema;

export const MIN_DECISIONS_TO_LEARN = 3;
const MAX_DECISIONS = 150;
export const MAX_PREFERENCES_CHARS = 2_500;

export interface DecisionRecord {
  title: string;
  employer: string;
  location: string | null;
  contract: string | null;
  remote: boolean | null;
  score: number | null;
  decision: "applied" | "skipped";
  stage: string | null;
  outcome: string | null;
}

/** Recent decisions of the current tenant, newest first. */
export async function collectRecentDecisions(
  limit = MAX_DECISIONS,
): Promise<DecisionRecord[]> {
  const tenantId = getActiveTenantId();
  const rows = await db
    .select({
      id: jobs.id,
      title: jobs.title,
      employer: jobs.employer,
      location: jobs.location,
      jobType: jobs.jobType,
      isRemote: jobs.isRemote,
      score: jobs.suitabilityScore,
      status: jobs.status,
      outcome: jobs.outcome,
    })
    .from(jobs)
    .where(
      and(
        eq(jobs.tenantId, tenantId),
        or(
          inArray(jobs.status, ["applied", "in_progress", "skipped"]),
          isNotNull(jobs.outcome),
        ),
      ),
    )
    .orderBy(desc(jobs.updatedAt))
    .limit(limit);

  const ids = rows.map((row) => row.id);
  const latestStage = new Map<string, { stage: string; at: number }>();
  if (ids.length > 0) {
    const events = await db
      .select({
        applicationId: stageEvents.applicationId,
        toStage: stageEvents.toStage,
        occurredAt: stageEvents.occurredAt,
      })
      .from(stageEvents)
      .where(
        and(
          eq(stageEvents.tenantId, tenantId),
          inArray(stageEvents.applicationId, ids),
        ),
      );
    for (const event of events) {
      const current = latestStage.get(event.applicationId);
      if (!current || event.occurredAt > current.at) {
        latestStage.set(event.applicationId, {
          stage: event.toStage,
          at: event.occurredAt,
        });
      }
    }
  }

  return rows.map((row) => ({
    title: row.title,
    employer: row.employer,
    location: row.location,
    contract: row.jobType,
    remote: row.isRemote,
    score: row.score,
    decision: row.status === "skipped" ? "skipped" : "applied",
    stage: latestStage.get(row.id)?.stage ?? null,
    outcome: row.outcome,
  }));
}

function countBy(
  records: DecisionRecord[],
  key: (record: DecisionRecord) => string,
): string {
  const counts = new Map<string, { applied: number; skipped: number }>();
  for (const record of records) {
    const bucket = key(record);
    const entry = counts.get(bucket) ?? { applied: 0, skipped: 0 };
    entry[record.decision] += 1;
    counts.set(bucket, entry);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1].applied + b[1].skipped - (a[1].applied + a[1].skipped))
    .slice(0, 8)
    .map(
      ([bucket, entry]) =>
        `${bucket}: applied ${entry.applied}, skipped ${entry.skipped}`,
    )
    .join("; ");
}

function scoreBucket(score: number | null): string {
  if (score === null) return "unscored";
  if (score >= 80) return "score 80+";
  if (score >= 60) return "score 60-79";
  return "score <60";
}

/** Deterministic evidence table + aggregates handed to the model. */
export function buildDecisionEvidence(records: DecisionRecord[]): string {
  const lines = records.map((record) =>
    [
      record.decision.toUpperCase(),
      record.title,
      record.employer,
      record.location ?? "-",
      record.contract ?? "-",
      record.remote === true ? "remote" : "-",
      record.score === null ? "-" : String(Math.round(record.score)),
      record.stage ?? "-",
      record.outcome ?? "-",
    ].join(" | "),
  );
  return [
    "Aggregates:",
    `- by contract: ${countBy(records, (r) => r.contract ?? "unknown")}`,
    `- by remote: ${countBy(records, (r) => (r.remote ? "remote" : "on-site/hybrid/unknown"))}`,
    `- by score: ${countBy(records, (r) => scoreBucket(r.score))}`,
    `- by location: ${countBy(records, (r) => r.location?.split(",")[0]?.trim() || "unknown")}`,
    "",
    "Decisions (decision | title | employer | location | contract | remote | score | stage | outcome):",
    ...lines,
  ].join("\n");
}

const LEARNER_SYSTEM_PROMPT = `You maintain Boussole's memory of a job seeker's preferences. You get their recent decisions on job postings (APPLIED or SKIPPED, with outcomes when known) and the current memory file.
Rewrite the memory file as Markdown bullet points under two headings, "## Prefers" and "## Avoids", plus "## Signals from outcomes" only when outcomes exist.
- Each bullet states one concrete preference (role type, domain, seniority, contract, location/remote, company type) and ends with its evidence in parentheses, e.g. "(applied 5, skipped 0)".
- Only state what the evidence supports; drop bullets of the current memory that the evidence no longer supports.
- No names of people, no contact details, at most 12 bullets, at most 2,000 characters.
Reply with the Markdown file only.`;

/** Keeps the model's file bounded and free of chatter before it is saved. */
export function sanitizePreferences(text: string): string {
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```[a-z]*\n?/i, "").replace(/```\s*$/, "");
  }
  const lines = cleaned
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => /^(#{1,3} |[-*] )/.test(line.trim()) || line === "");
  let result = lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (result.length > MAX_PREFERENCES_CHARS) {
    const kept: string[] = [];
    let size = 0;
    for (const line of result.split("\n")) {
      if (size + line.length + 1 > MAX_PREFERENCES_CHARS) break;
      kept.push(line);
      size += line.length + 1;
    }
    result = kept.join("\n").trim();
  }
  return result;
}

export async function runPreferenceLearner(args: {
  model: BaseChatModel;
  signal?: AbortSignal;
  minDecisions?: number;
}): Promise<PreferenceLearnerOutput> {
  const records = await collectRecentDecisions();
  const current = await readPreferences();
  const minDecisions = args.minDecisions ?? MIN_DECISIONS_TO_LEARN;

  if (records.length < minDecisions) {
    return {
      updated: false,
      reason: `Not enough decisions yet: ${records.length} (needs ${minDecisions}). Apply to or skip a few jobs first.`,
      decisionsConsidered: records.length,
      preferences: current?.content ?? null,
    };
  }

  const response = await args.model.invoke(
    [
      new SystemMessage(LEARNER_SYSTEM_PROMPT),
      new HumanMessage(
        [
          `Current memory file:\n${current?.content ?? "(empty)"}`,
          "",
          buildDecisionEvidence(records),
        ].join("\n"),
      ),
    ],
    { signal: args.signal },
  );

  const preferences = sanitizePreferences(contentToText(response.content));
  if (!preferences) {
    throw new Error("The preference learner returned an empty memory file.");
  }
  await writePreferences(preferences);
  return {
    updated: true,
    decisionsConsidered: records.length,
    preferences,
  };
}
