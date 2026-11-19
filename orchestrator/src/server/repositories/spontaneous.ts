/** Spontaneous applications, scoped to the active workspace. */
import { randomUUID } from "node:crypto";
import { isKeywordEstimate } from "@shared/scoring";
import { companyWebsiteOrNull } from "@shared/spontaneous";
import type {
  OutreachContact,
  OutreachEmail,
  OutreachFact,
  SpontaneousOutreach,
} from "@shared/types";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "../db/index";
import type { SpontaneousOutreachRow } from "../db/schema";
import { getActiveTenantId } from "../tenancy/context";

/** Same freshness rule as Today and the Jobs list. */
const RECENT_DAYS = 45;
const DAY_MS = 86_400_000;

const { spontaneousOutreach } = schema;
const HISTORY_LIMIT = 30;

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function mapRow(row: SpontaneousOutreachRow): SpontaneousOutreach {
  return {
    id: row.id,
    company: row.company,
    website: row.website ?? null,
    status: row.status,
    summary: row.summary ?? null,
    facts: parseJson<OutreachFact[]>(row.factsJson, []),
    contacts: parseJson<OutreachContact[]>(row.contactsJson, []),
    error: row.error ?? null,
    email: parseJson<OutreachEmail | null>(row.emailJson, null),
    jobId: row.jobId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const scoped = (id: string) =>
  and(
    eq(spontaneousOutreach.tenantId, getActiveTenantId()),
    eq(spontaneousOutreach.id, id),
  );

export async function getOutreach(
  id: string,
): Promise<SpontaneousOutreach | null> {
  const [row] = await db.select().from(spontaneousOutreach).where(scoped(id));
  return row ? mapRow(row) : null;
}

export async function listOutreach(): Promise<SpontaneousOutreach[]> {
  const rows = await db
    .select()
    .from(spontaneousOutreach)
    .where(eq(spontaneousOutreach.tenantId, getActiveTenantId()))
    .orderBy(desc(spontaneousOutreach.updatedAt))
    .limit(HISTORY_LIMIT);
  return rows.map(mapRow);
}

export async function createOutreach(input: {
  company: string;
  website: string | null;
}): Promise<SpontaneousOutreach> {
  const now = new Date().toISOString();
  const id = randomUUID();
  await db.insert(spontaneousOutreach).values({
    id,
    tenantId: getActiveTenantId(),
    company: input.company,
    website: input.website,
    status: "researching",
    createdAt: now,
    updatedAt: now,
  });
  const created = await getOutreach(id);
  if (!created) throw new Error("Failed to save the spontaneous application");
  return created;
}

export async function updateOutreach(
  id: string,
  changes: Partial<{
    status: SpontaneousOutreach["status"];
    website: string | null;
    summary: string | null;
    facts: OutreachFact[];
    contacts: OutreachContact[];
    error: string | null;
    email: OutreachEmail | null;
    jobId: string | null;
  }>,
): Promise<SpontaneousOutreach | null> {
  const set: Partial<typeof spontaneousOutreach.$inferInsert> = {
    updatedAt: new Date().toISOString(),
  };
  if (changes.status !== undefined) set.status = changes.status;
  if (changes.website !== undefined) set.website = changes.website;
  if (changes.summary !== undefined) set.summary = changes.summary;
  if (changes.facts !== undefined)
    set.factsJson = JSON.stringify(changes.facts);
  if (changes.contacts !== undefined) {
    set.contactsJson = JSON.stringify(changes.contacts);
  }
  if (changes.error !== undefined) set.error = changes.error;
  if (changes.email !== undefined) {
    set.emailJson = changes.email ? JSON.stringify(changes.email) : null;
  }
  if (changes.jobId !== undefined) set.jobId = changes.jobId;
  await db.update(spontaneousOutreach).set(set).where(scoped(id));
  return getOutreach(id);
}

const SUGGESTION_LIMIT = 12;
const UNKNOWN_EMPLOYER =
  /^(unknown|unknown employer|confidential|confidentiel|n\/a)$/i;

/**
 * Companies from the person's own jobs worth a spontaneous application: the
 * employers of their best-scored open jobs, minus companies they already
 * applied to or already contacted.
 */
export async function listOutreachSuggestions(): Promise<
  import("@shared/types").SpontaneousSuggestion[]
> {
  const tenantId = getActiveTenantId();
  const rows = await db
    .select({
      employer: schema.jobs.employer,
      employerUrl: schema.jobs.employerUrl,
      status: schema.jobs.status,
      score: schema.jobs.suitabilityScore,
      reason: schema.jobs.suitabilityReason,
      discoveredAt: schema.jobs.discoveredAt,
    })
    .from(schema.jobs)
    .where(eq(schema.jobs.tenantId, tenantId));
  const contacted = new Set(
    (
      await db
        .select({ company: spontaneousOutreach.company })
        .from(spontaneousOutreach)
        .where(eq(spontaneousOutreach.tenantId, tenantId))
    ).map((row) => row.company.trim().toLowerCase()),
  );

  const byCompany = new Map<
    string,
    {
      company: string;
      website: string | null;
      jobCount: number;
      bestScore: number | null;
      /** Best real score among postings found in the last RECENT_DAYS. */
      bestRecentScore: number | null;
      /** Has an open posting found in the last RECENT_DAYS. */
      recent: boolean;
      applied: boolean;
    }
  >();
  const now = Date.now();
  for (const row of rows) {
    const company = row.employer?.trim();
    if (!company || UNKNOWN_EMPLOYER.test(company)) continue;
    const key = company.toLowerCase();
    const entry = byCompany.get(key) ?? {
      company,
      website: null,
      jobCount: 0,
      bestScore: null,
      bestRecentScore: null,
      recent: false,
      applied: false,
    };
    if (row.status === "applied" || row.status === "in_progress") {
      entry.applied = true;
    }
    if (row.status === "ready" || row.status === "discovered") {
      entry.jobCount += 1;
      const found = Date.parse(row.discoveredAt);
      const isRecent =
        Number.isFinite(found) && now - found <= RECENT_DAYS * DAY_MS;
      if (isRecent) entry.recent = true;
      // Keyword estimates aren't real scores: they don't rank companies.
      if (row.score != null && !isKeywordEstimate(row.reason)) {
        if (entry.bestScore == null || row.score > entry.bestScore) {
          entry.bestScore = row.score;
        }
        if (
          isRecent &&
          (entry.bestRecentScore == null || row.score > entry.bestRecentScore)
        ) {
          entry.bestRecentScore = row.score;
        }
      }
    }
    // Job sources often store a LinkedIn or job-board page, or a broken link.
    entry.website = entry.website ?? companyWebsiteOrNull(row.employerUrl);
    byCompany.set(key, entry);
  }
  return (
    Array.from(byCompany.entries())
      .filter(
        ([key, entry]) =>
          !entry.applied && entry.jobCount > 0 && !contacted.has(key),
      )
      // A company hiring now is ranked by its recent postings only.
      .map(([, entry]) => ({
        ...entry,
        bestScore: entry.recent ? entry.bestRecentScore : entry.bestScore,
      }))
      // Companies hiring now first, then by best real match score.
      .sort(
        (a, b) =>
          Number(b.recent) - Number(a.recent) ||
          (b.bestScore ?? -1) - (a.bestScore ?? -1) ||
          b.jobCount - a.jobCount,
      )
      .slice(0, SUGGESTION_LIMIT)
      .map((entry) => ({
        company: entry.company,
        website: entry.website,
        jobCount: entry.jobCount,
        bestScore: entry.bestScore,
      }))
  );
}
