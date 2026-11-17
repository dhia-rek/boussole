// @vitest-environment node
import { randomUUID } from "node:crypto";
import { runWithRequestContext } from "@infra/request-context";
import { beforeAll, describe, expect, it } from "vitest";
import { ChatClaudeCli } from "./chat-claude-cli";
import { createScriptedCli } from "./testing/scripted-cli";

type LearnerModule = typeof import("./preference-learner");
type StoreModule = typeof import("./memory-store");
let learner: LearnerModule;
let store: StoreModule;

beforeAll(async () => {
  await import("@server/db/migrate");
  learner = await import("./preference-learner");
  store = await import("./memory-store");
});

/** Creates the tenant row (foreign keys are enforced) and returns its id. */
async function createTenant(): Promise<string> {
  const { db, schema } = await import("@server/db");
  const id = `tenant-${randomUUID()}`;
  await db.insert(schema.tenants).values({ id, name: id, slug: id });
  return id;
}

const asTenant = <T>(tenantId: string, fn: () => Promise<T>) =>
  runWithRequestContext({ tenantId }, fn);

async function seedJob(
  tenantId: string,
  overrides: {
    title: string;
    status: "applied" | "skipped" | "ready" | "in_progress";
    jobType?: string;
    score?: number;
    outcome?: "rejected" | "offer_accepted";
  },
) {
  const { db, schema } = await import("@server/db");
  const id = randomUUID();
  await db.insert(schema.jobs).values({
    id,
    tenantId,
    title: overrides.title,
    employer: "Acme",
    jobUrl: `https://example.com/${id}`,
    location: "Paris, France",
    status: overrides.status,
    jobType: overrides.jobType ?? "Full-time permanent (CDI)",
    suitabilityScore: overrides.score ?? 80,
    outcome: overrides.outcome ?? null,
  });
  return id;
}

describe("preference learner", () => {
  it("does not call the model before there is enough evidence", async () => {
    const tenant = await createTenant();
    await seedJob(tenant, { title: "Data Steward", status: "applied" });
    await seedJob(tenant, { title: "Ignored ready job", status: "ready" });
    const cli = createScriptedCli(() => "unused");

    const result = await asTenant(tenant, () =>
      learner.runPreferenceLearner({
        model: new ChatClaudeCli({ runner: cli.runner }),
      }),
    );

    expect(result).toMatchObject({
      updated: false,
      decisionsConsidered: 1,
      preferences: null,
    });
    expect(result.reason).toContain("needs 3");
    expect(cli.prompts).toHaveLength(0);
  });

  it("rewrites the memory file from decisions and outcomes, per tenant", async () => {
    const tenant = await createTenant();
    const other = await createTenant();
    const appliedId = await seedJob(tenant, {
      title: "Data Quality Analyst",
      status: "in_progress",
      score: 91,
    });
    await seedJob(tenant, {
      title: "AI Engineer",
      status: "applied",
      score: 85,
    });
    await seedJob(tenant, {
      title: "Stage Data",
      status: "skipped",
      jobType: "Internship (stage)",
      score: 40,
    });
    await seedJob(other, { title: "Other tenant job", status: "applied" });
    const { db, schema } = await import("@server/db");
    await db.insert(schema.stageEvents).values({
      id: randomUUID(),
      tenantId: tenant,
      applicationId: appliedId,
      title: "Recruiter screen",
      toStage: "recruiter_screen",
      occurredAt: Date.now(),
    });

    const cli = createScriptedCli(() =>
      [
        "Sure! Here is the updated file:",
        "```markdown",
        "## Prefers",
        "- Permanent data quality and AI roles (applied 2, skipped 0)",
        "## Avoids",
        "- Internships (applied 0, skipped 1)",
        "```",
        "Let me know if you need more.",
      ].join("\n"),
    );

    const result = await asTenant(tenant, () =>
      learner.runPreferenceLearner({
        model: new ChatClaudeCli({ runner: cli.runner }),
      }),
    );

    expect(result.updated).toBe(true);
    expect(result.decisionsConsidered).toBe(3);
    expect(result.preferences).toBe(
      "## Prefers\n- Permanent data quality and AI roles (applied 2, skipped 0)\n## Avoids\n- Internships (applied 0, skipped 1)",
    );
    expect(cli.prompts).toHaveLength(1);
    const prompt = cli.prompts[0] ?? "";
    expect(prompt).toContain(
      "by contract: Full-time permanent (CDI): applied 2, skipped 0; Internship (stage): applied 0, skipped 1",
    );
    expect(prompt).toContain("recruiter_screen");
    expect(prompt).not.toContain("Other tenant job");

    expect(
      (await asTenant(tenant, () => store.readPreferences()))?.content,
    ).toBe(result.preferences);
    expect(await asTenant(other, () => store.readPreferences())).toBeNull();
  });

  it("bounds and cleans the memory file", () => {
    const long = Array.from(
      { length: 200 },
      (_, index) =>
        `- Preference number ${index} with some evidence (applied 1, skipped 0)`,
    ).join("\n");
    const cleaned = learner.sanitizePreferences(`## Prefers\n${long}`);
    expect(cleaned.length).toBeLessThanOrEqual(learner.MAX_PREFERENCES_CHARS);
    expect(cleaned.startsWith("## Prefers\n- Preference number 0")).toBe(true);
    expect(learner.sanitizePreferences("No bullets at all")).toBe("");
  });
});
