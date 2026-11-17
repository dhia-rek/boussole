import type { Server } from "node:http";
import type { DesignResumeJson } from "@shared/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startServer, stopServer } from "./test-utils";

const AUTH_ENV = {
  BASIC_AUTH_USER: "admin",
  BASIC_AUTH_PASSWORD: "secret",
  JWT_SECRET: "an-explicit-jwt-secret-with-at-least-32-chars",
  BOUSSOLE_TEST_AUTH_BYPASS: "0",
};

async function login(baseUrl: string, username: string, password: string) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const body = await res.json();
  expect(res.status).toBe(200);
  const token = body.data.token as string;
  const me = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json());
  return { token, tenantId: me.data.user.workspaceId as string };
}

function headers(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function api(
  baseUrl: string,
  token: string,
  method: string,
  path: string,
  body?: unknown,
) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: headers(token),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: await res.json() };
}

async function buildResume(args: {
  name: string;
  headline: string;
  projectIds?: string[];
}): Promise<DesignResumeJson> {
  const { buildDefaultReactiveResumeDocument } = await import(
    "@server/services/resume-data/document"
  );
  const resume = buildDefaultReactiveResumeDocument() as DesignResumeJson;
  resume.basics.name = args.name;
  resume.basics.headline = args.headline;
  resume.sections.projects.items = (args.projectIds ?? []).map((id, index) => ({
    id,
    hidden: false,
    name: `Project ${index + 1}`,
    period: "2026",
    website: { url: "", label: "" },
    description: "<p>Built something</p>",
  }));
  return resume;
}

/** Seeds a CV variant for a tenant through the service layer. */
async function seedVariant(args: {
  tenantId: string;
  language: string | null;
  resumeJson: DesignResumeJson;
}) {
  const { runWithRequestContext } = await import("@infra/request-context");
  const { replaceCurrentDesignResumeDocument } = await import(
    "@server/services/design-resume"
  );
  return runWithRequestContext({ tenantId: args.tenantId }, () =>
    replaceCurrentDesignResumeDocument({
      resumeJson: args.resumeJson,
      sourceResumeId: null,
      sourceMode: null,
      language: args.language,
    }),
  );
}

describe.sequential("Design Resume language variants", () => {
  let server: Server;
  let baseUrl: string;
  let closeDb: () => void;
  let tempDir: string;

  beforeEach(async () => {
    ({ server, baseUrl, closeDb, tempDir } = await startServer({
      env: AUTH_ENV,
    }));
  });

  afterEach(async () => {
    await stopServer({ server, closeDb, tempDir });
  });

  it("serves each language variant and keeps the first CV as primary", async () => {
    const admin = await login(baseUrl, "admin", "secret");
    await seedVariant({
      tenantId: admin.tenantId,
      language: "fr",
      resumeJson: await buildResume({ name: "Dhia", headline: "Stagiaire IA" }),
    });
    await seedVariant({
      tenantId: admin.tenantId,
      language: "en",
      resumeJson: await buildResume({ name: "Dhia", headline: "AI Intern" }),
    });

    const status = await api(
      baseUrl,
      admin.token,
      "GET",
      "/api/design-resume/status",
    );
    expect(status.status).toBe(200);
    expect(
      status.body.data.variants.map(
        (v: { language: string; isPrimary: boolean }) =>
          `${v.language}:${v.isPrimary}`,
      ),
    ).toEqual(["fr:true", "en:false"]);

    const primary = await api(
      baseUrl,
      admin.token,
      "GET",
      "/api/design-resume",
    );
    expect(primary.body.data.language).toBe("fr");
    expect(primary.body.data.resumeJson.basics.headline).toBe("Stagiaire IA");

    const english = await api(
      baseUrl,
      admin.token,
      "GET",
      "/api/design-resume?language=en",
    );
    expect(english.body.data.isPrimary).toBe(false);
    expect(english.body.data.resumeJson.basics.headline).toBe("AI Intern");

    // Editing the English CV keeps its language tag and never changes which
    // CV is primary (the pre-fix bug reset the tag to null on every save).
    const patched = await api(
      baseUrl,
      admin.token,
      "PATCH",
      "/api/design-resume?language=en",
      {
        baseRevision: english.body.data.revision,
        document: {
          ...english.body.data.resumeJson,
          basics: {
            ...english.body.data.resumeJson.basics,
            headline: "Machine Learning Intern",
          },
        },
        aiGuidance: { sections: { summary: { mode: "keep" } } },
      },
    );
    expect(patched.status).toBe(200);
    expect(patched.body.data.language).toBe("en");
    expect(patched.body.data.aiGuidance.sections.summary.mode).toBe("keep");

    const afterPatch = await api(
      baseUrl,
      admin.token,
      "GET",
      "/api/design-resume",
    );
    expect(afterPatch.body.data.language).toBe("fr");
    expect(afterPatch.body.data.aiGuidance.sections.summary.mode).toBe(
      "tailor",
    );

    expect(
      (await api(baseUrl, admin.token, "GET", "/api/design-resume?language=zz"))
        .status,
    ).toBe(400);
    expect(
      (await api(baseUrl, admin.token, "GET", "/api/design-resume?language=de"))
        .status,
    ).toBe(404);
  });

  it("rejects invalid guidance and stale revisions", async () => {
    const admin = await login(baseUrl, "admin", "secret");
    const seeded = await seedVariant({
      tenantId: admin.tenantId,
      language: null,
      resumeJson: await buildResume({ name: "Dhia", headline: "AI Intern" }),
    });

    const invalid = await api(
      baseUrl,
      admin.token,
      "PATCH",
      "/api/design-resume",
      {
        baseRevision: seeded.revision,
        aiGuidance: { sections: { hobbies: { notes: "x" } } },
      },
    );
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe("INVALID_REQUEST");

    const ok = await api(baseUrl, admin.token, "PATCH", "/api/design-resume", {
      baseRevision: seeded.revision,
      aiGuidance: { sections: { headline: { prefix: "Stagiaire" } } },
    });
    expect(ok.status).toBe(200);

    const stale = await api(
      baseUrl,
      admin.token,
      "PATCH",
      "/api/design-resume",
      {
        baseRevision: seeded.revision,
        aiGuidance: {},
      },
    );
    expect(stale.status).toBe(409);
  });

  it("deletes a secondary variant but never the primary", async () => {
    const admin = await login(baseUrl, "admin", "secret");
    await seedVariant({
      tenantId: admin.tenantId,
      language: "fr",
      resumeJson: await buildResume({ name: "Dhia", headline: "Stagiaire" }),
    });
    await seedVariant({
      tenantId: admin.tenantId,
      language: "en",
      resumeJson: await buildResume({ name: "Dhia", headline: "Intern" }),
    });

    const deletePrimary = await api(
      baseUrl,
      admin.token,
      "DELETE",
      "/api/design-resume/variants/fr",
    );
    expect(deletePrimary.status).toBe(409);

    const deleteEnglish = await api(
      baseUrl,
      admin.token,
      "DELETE",
      "/api/design-resume/variants/en",
    );
    expect(deleteEnglish.status).toBe(200);
    expect(
      deleteEnglish.body.data.map((v: { language: string }) => v.language),
    ).toEqual(["fr"]);
  });

  it("repairs empty item ids once and keeps them stable", async () => {
    const admin = await login(baseUrl, "admin", "secret");
    const seeded = await seedVariant({
      tenantId: admin.tenantId,
      language: null,
      resumeJson: await buildResume({
        name: "Dhia",
        headline: "Intern",
        projectIds: ["p1"],
      }),
    });

    // Simulate a legacy row whose items were stored without ids.
    const { runWithRequestContext } = await import("@infra/request-context");
    const repo = await import("@server/repositories/design-resume");
    const legacy = structuredClone(seeded.resumeJson);
    legacy.sections.projects.items = legacy.sections.projects.items.map(
      (item) => ({ ...item, id: "" }),
    );
    await runWithRequestContext({ tenantId: admin.tenantId }, () =>
      repo.upsertDesignResumeDocument({
        id: seeded.id,
        title: seeded.title,
        resumeJson: legacy,
        revision: seeded.revision,
        sourceResumeId: null,
        sourceMode: null,
        importedAt: seeded.importedAt,
        updatedAt: seeded.updatedAt,
      }),
    );

    const first = await api(baseUrl, admin.token, "GET", "/api/design-resume");
    const second = await api(baseUrl, admin.token, "GET", "/api/design-resume");
    const firstId = first.body.data.resumeJson.sections.projects.items[0].id;
    expect(firstId).toEqual(expect.any(String));
    expect(firstId.length).toBeGreaterThan(0);
    expect(second.body.data.resumeJson.sections.projects.items[0].id).toBe(
      firstId,
    );
    // Repairing ids is not an edit: the revision is unchanged.
    expect(second.body.data.revision).toBe(seeded.revision);
  });

  it("isolates CV variants and AI guidance between workspaces", async () => {
    const admin = await login(baseUrl, "admin", "secret");
    await seedVariant({
      tenantId: admin.tenantId,
      language: "fr",
      resumeJson: await buildResume({ name: "Admin", headline: "Admin CV" }),
    });
    await seedVariant({
      tenantId: admin.tenantId,
      language: "en",
      resumeJson: await buildResume({ name: "Admin", headline: "Admin EN" }),
    });

    const created = await api(
      baseUrl,
      admin.token,
      "POST",
      "/api/workspaces/users",
      { username: "adam", displayName: "Adam", password: "adam-secret" },
    );
    expect(created.status).toBe(201);
    const adam = await login(baseUrl, "adam", "adam-secret");
    expect(adam.tenantId).not.toBe(admin.tenantId);

    const adamStatus = await api(
      baseUrl,
      adam.token,
      "GET",
      "/api/design-resume/status",
    );
    expect(adamStatus.body.data).toMatchObject({ exists: false, variants: [] });
    expect(
      (await api(baseUrl, adam.token, "GET", "/api/design-resume?language=en"))
        .status,
    ).toBe(404);
    expect(
      (
        await api(
          baseUrl,
          adam.token,
          "PATCH",
          "/api/design-resume?language=en",
          {
            baseRevision: 1,
            aiGuidance: {},
          },
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await api(
          baseUrl,
          adam.token,
          "DELETE",
          "/api/design-resume/variants/en",
        )
      ).status,
    ).toBe(404);

    // Adam's own English CV is independent from the admin's.
    await seedVariant({
      tenantId: adam.tenantId,
      language: "en",
      resumeJson: await buildResume({ name: "Adam", headline: "Adam EN" }),
    });
    const adamEnglish = await api(
      baseUrl,
      adam.token,
      "GET",
      "/api/design-resume?language=en",
    );
    expect(adamEnglish.body.data.resumeJson.basics.headline).toBe("Adam EN");
    expect(adamEnglish.body.data.isPrimary).toBe(true);

    const adminEnglish = await api(
      baseUrl,
      admin.token,
      "GET",
      "/api/design-resume?language=en",
    );
    expect(adminEnglish.body.data.resumeJson.basics.headline).toBe("Admin EN");
    expect(adminEnglish.body.data.isPrimary).toBe(false);
  });
});
