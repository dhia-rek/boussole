import type { Server } from "node:http";
import { getDefaultPromptTemplate } from "@shared/prompt-template-definitions.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startServer, stopServer } from "./test-utils";

describe.sequential("Settings API routes", () => {
  let server: Server;
  let baseUrl: string;
  let closeDb: () => void;
  let tempDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ server, baseUrl, closeDb, tempDir } = await startServer({
      env: {
        WEBHOOK_SECRET: "secret-key",
      },
    }));
  });

  afterEach(async () => {
    await stopServer({ server, closeDb, tempDir });
  });

  it("returns settings with defaults", async () => {
    const res = await fetch(`${baseUrl}/api/settings`);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.model.default).toBe("test-model");
    expect(Array.isArray(body.data.searchTerms.value)).toBe(true);
    expect(body.data.webhookSecretHint).toBe("secr");
    expect(JSON.stringify(body)).not.toContain("secret-key");
    expect(body.data.basicAuthPassword).toBeNull();
    expect(body.data.basicAuthActive).toBe(false);
    expect(body.data.ghostwriterSystemPromptTemplate.value).toBe(
      getDefaultPromptTemplate("ghostwriterSystemPromptTemplate"),
    );
    expect(body.data.tailoringPromptTemplate.value).toBe(
      getDefaultPromptTemplate("tailoringPromptTemplate"),
    );
    expect(body.data.scoringPromptTemplate.value).toBe(
      getDefaultPromptTemplate("scoringPromptTemplate"),
    );
  });

  it("does not expose the basic auth password when only the password is configured", async () => {
    const partialBasicAuth = await startServer({
      env: {
        BASIC_AUTH_PASSWORD: "secret-only",
        BASIC_AUTH_USER: "",
      },
    });

    try {
      const res = await fetch(`${partialBasicAuth.baseUrl}/api/settings`);
      const body = await res.json();

      expect(body.ok).toBe(true);
      expect(body.data.basicAuthActive).toBe(false);
      expect(body.data.basicAuthPassword).toBeNull();
      // A hint shows that a password exists without revealing any of it.
      expect(body.data.basicAuthPasswordHint).toBe("****");
    } finally {
      await stopServer(partialBasicAuth);
    }
  });

  it("defaults the Claude model to opus with medium effort when MODEL is unset", async () => {
    const claudeDefaults = await startServer({
      env: {
        MODEL: undefined,
      },
    });

    try {
      const res = await fetch(`${claudeDefaults.baseUrl}/api/settings`);
      const body = await res.json();

      expect(body.ok).toBe(true);
      expect(body.data.model.default).toBe("opus:medium");
      expect(body.data.model.value).toBe("opus:medium");
      expect(body.data.model.override).toBeNull();
    } finally {
      await stopServer(claudeDefaults);
    }
  });

  it("only exposes the Claude settings, not the removed AI provider ones", async () => {
    const res = await fetch(`${baseUrl}/api/settings`);
    const body = await res.json();

    expect(body.ok).toBe(true);
    for (const removedKey of [
      "llmProvider",
      "llmBaseUrl",
      "llmApiKeyHint",
      "modelScorer",
      "modelTailoring",
      "modelProjectSelection",
      "rxresumeBaseResumeId",
      "pdfRenderer",
      "showSponsorInfo",
      "apifyTokenHint",
    ]) {
      expect(body.data).not.toHaveProperty(removedKey);
    }
  });

  it("saves a model override and ignores settings that no longer exist", async () => {
    const patchRes = await fetch(`${baseUrl}/api/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "sonnet",
        llmProvider: "openai",
        modelTailoring: "google/gemini-3-flash-preview",
      }),
    });
    const patchBody = await patchRes.json();

    expect(patchRes.status).toBe(200);
    expect(patchBody.ok).toBe(true);
    expect(patchBody.data.model).toEqual({
      value: "sonnet",
      default: "test-model",
      override: "sonnet",
    });
    expect(patchBody.data).not.toHaveProperty("llmProvider");
    expect(patchBody.data).not.toHaveProperty("modelTailoring");

    const { getSetting } = await import("@server/repositories/settings");
    await expect(getSetting("model")).resolves.toBe("sonnet");
  });

  it("rejects invalid settings updates and persists overrides", async () => {
    const badPatch = await fetch(`${baseUrl}/api/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobspyResultsWanted: 9999 }),
    });
    expect(badPatch.status).toBe(400);

    const patchRes = await fetch(`${baseUrl}/api/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        searchTerms: ["engineer"],
        webhookSecret: "updated-secret",
        basicAuthUser: "admin",
        basicAuthPassword: "letmein",
        ghostwriterSystemPromptTemplate: "Custom Ghostwriter {{tone}}",
      }),
    });
    const patchBody = await patchRes.json();
    expect(patchBody.ok).toBe(true);
    expect(patchBody.data.searchTerms.value).toEqual(["engineer"]);
    expect(patchBody.data.searchTerms.override).toEqual(["engineer"]);
    expect(patchBody.data.webhookSecretHint).toBe("upda");
    expect(JSON.stringify(patchBody)).not.toContain("updated-secret");
    expect(patchBody.data.basicAuthUser).toBe("admin");
    expect(patchBody.data.basicAuthActive).toBe(true);
    // The login password is never echoed back nor stored in plain text.
    expect(patchBody.data.basicAuthPassword).toBeNull();
    expect(JSON.stringify(patchBody)).not.toContain("letmein");
    const { getSetting } = await import("@server/repositories/settings");
    const stored = await getSetting("basicAuthPassword");
    expect(stored).toMatch(/^scrypt:/);
    expect(stored).not.toContain("letmein");
    expect(patchBody.data.ghostwriterSystemPromptTemplate.override).toBe(
      "Custom Ghostwriter {{tone}}",
    );
  });

  it("validates basic auth requirements", async () => {
    const res = await fetch(`${baseUrl}/api/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enableBasicAuth: true,
        basicAuthUser: "",
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.message).toContain("Username is required");
  });

  it("handles salary penalty settings with validation", async () => {
    // Get initial settings
    const initialRes = await fetch(`${baseUrl}/api/settings`);
    const initialBody = await initialRes.json();
    expect(initialBody.ok).toBe(true);
    expect(initialBody.data.penalizeMissingSalary.value).toBe(false);
    expect(initialBody.data.missingSalaryPenalty.value).toBe(10);

    // Test invalid penalty values
    const invalidRes = await fetch(`${baseUrl}/api/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ missingSalaryPenalty: 150 }),
    });
    expect(invalidRes.status).toBe(400);

    const negativeRes = await fetch(`${baseUrl}/api/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ missingSalaryPenalty: -10 }),
    });
    expect(negativeRes.status).toBe(400);

    // Test valid settings update
    const validRes = await fetch(`${baseUrl}/api/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        penalizeMissingSalary: true,
        missingSalaryPenalty: 20,
      }),
    });
    const validBody = await validRes.json();
    expect(validBody.ok).toBe(true);
    expect(validBody.data.penalizeMissingSalary.value).toBe(true);
    expect(validBody.data.penalizeMissingSalary.override).toBe(true);
    expect(validBody.data.missingSalaryPenalty.value).toBe(20);
    expect(validBody.data.missingSalaryPenalty.override).toBe(20);

    // Verify persistence
    const getRes = await fetch(`${baseUrl}/api/settings`);
    const getBody = await getRes.json();
    expect(getBody.ok).toBe(true);
    expect(getBody.data.penalizeMissingSalary.value).toBe(true);
    expect(getBody.data.missingSalaryPenalty.value).toBe(20);
  });
});
