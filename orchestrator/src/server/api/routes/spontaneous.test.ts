import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startServer, stopServer } from "./test-utils";

describe.sequential("Spontaneous applications API routes", () => {
  let server: Server;
  let baseUrl: string;
  let closeDb: () => void;
  let tempDir: string;

  beforeEach(async () => {
    ({ server, baseUrl, closeDb, tempDir } = await startServer());
  });

  afterEach(async () => {
    await stopServer({ server, closeDb, tempDir });
  });

  it("rejects a lookup with a missing domain (400, structured error, echoed request id)", async () => {
    const res = await fetch(`${baseUrl}/api/spontaneous/lookup`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-request-id": "req-spont-missing-domain",
      },
      body: JSON.stringify({}),
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(res.headers.get("x-request-id")).toBe("req-spont-missing-domain");
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("INVALID_REQUEST");
    expect(body.meta.requestId).toBe("req-spont-missing-domain");
  });

  it("rejects a lookup with an over-length domain (input boundary)", async () => {
    const res = await fetch(`${baseUrl}/api/spontaneous/lookup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain: "a".repeat(201) }),
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("INVALID_REQUEST");
  });

  it("blocks a valid lookup when the Hunter.io key is not configured (400, actionable message)", async () => {
    const res = await fetch(`${baseUrl}/api/spontaneous/lookup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain: "https://stripe.com/jobs" }),
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("INVALID_REQUEST");
    expect(String(body.error.message)).toMatch(/hunter\.io api key/i);
    expect(String(body.error.message)).toMatch(/settings/i);
  });

  it("rejects email generation with a missing company (400)", async () => {
    const res = await fetch(`${baseUrl}/api/spontaneous/generate-email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-request-id": "req-spont-missing-company",
      },
      body: JSON.stringify({ language: "en" }),
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(res.headers.get("x-request-id")).toBe("req-spont-missing-company");
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("INVALID_REQUEST");
  });

  it("rejects email generation with an invalid language enum (400)", async () => {
    const res = await fetch(`${baseUrl}/api/spontaneous/generate-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company: "Stripe", language: "de" }),
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("INVALID_REQUEST");
  });

  it("returns a structured error (never a 200) when the LLM cannot fulfil generation", async () => {
    // The route tests point CLAUDE_CLI_BIN at a missing binary, so the Claude
    // call fails. The contract guarantee is: structured envelope, never a
    // fabricated 200.
    const res = await fetch(`${baseUrl}/api/spontaneous/generate-email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-request-id": "req-spont-llm",
      },
      body: JSON.stringify({
        company: "Stripe",
        targetRole: "Software Engineer",
        language: "fr",
      }),
    });
    const body = await res.json();

    expect(res.ok).toBe(false);
    expect(res.status).toBe(502);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("UPSTREAM_ERROR");
    expect(body.meta.requestId).toBe("req-spont-llm");
    expect(typeof body.error.message).toBe("string");
    expect(body.error.message.length).toBeGreaterThan(0);
  });
});
