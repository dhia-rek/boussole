import { readFile } from "node:fs/promises";
import type { Server } from "node:http";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startServer, stopServer } from "./test-utils";

describe.sequential("Auth routes", () => {
  let server: Server;
  let baseUrl: string;
  let closeDb: () => void;
  let tempDir: string;

  const AUTH_ENV = {
    BASIC_AUTH_USER: "admin",
    BASIC_AUTH_PASSWORD: "secret",
    JWT_SECRET: "an-explicit-jwt-secret-with-at-least-32-chars",
    FORSA_TEST_AUTH_BYPASS: "0",
  };

  afterEach(async () => {
    await stopServer({ server, closeDb, tempDir });
  });

  describe("POST /api/auth/login", () => {
    beforeEach(async () => {
      ({ server, baseUrl, closeDb, tempDir } = await startServer({
        env: AUTH_ENV,
      }));
    });

    it("returns a JWT for valid credentials", async () => {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "secret" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.data.token).toBeTruthy();
      expect(body.data.expiresIn).toBeGreaterThan(0);
    });

    it("locks sign-in with 429 after repeated failures, even for the right password", async () => {
      const attempt = (password: string) =>
        fetch(`${baseUrl}/api/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: "admin", password }),
        });

      for (let index = 0; index < 10; index += 1) {
        expect((await attempt(`wrong-${index}`)).status).toBe(401);
      }

      const locked = await attempt("secret");
      expect(locked.status).toBe(429);
      expect(Number(locked.headers.get("retry-after"))).toBeGreaterThan(0);
      const body = await locked.json();
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe("TOO_MANY_REQUESTS");
      expect(body.error.message).toMatch(/Too many sign-in attempts/);
      expect(body.meta.requestId).toBeTruthy();
    });

    it("sends security headers and no open CORS", async () => {
      const res = await fetch(`${baseUrl}/health`, {
        headers: { Origin: "https://evil.example" },
      });
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
      expect(res.headers.get("referrer-policy")).toBe(
        "strict-origin-when-cross-origin",
      );
      expect(res.headers.get("permissions-policy")).toContain("camera=(self)");
      expect(res.headers.get("strict-transport-security")).toBeNull();
      expect(res.headers.get("access-control-allow-origin")).toBeNull();

      const viaTunnel = await fetch(`${baseUrl}/health`, {
        headers: { "X-Forwarded-Proto": "https" },
      });
      expect(viaTunnel.headers.get("strict-transport-security")).toContain(
        "max-age=",
      );
    });

    it("returns 401 for invalid credentials", async () => {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "wrong" }),
      });

      expect(res.status).toBe(401);
    });

    it("returns 400 for missing fields", async () => {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin" }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 400 when auth is disabled", async () => {
      await stopServer({ server, closeDb, tempDir });
      ({ server, baseUrl, closeDb, tempDir } = await startServer());

      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "secret" }),
      });

      expect(res.status).toBe(400);
    });

    it("generates and persists a local JWT secret when none is configured", async () => {
      await stopServer({ server, closeDb, tempDir });
      ({ server, baseUrl, closeDb, tempDir } = await startServer({
        env: {
          BASIC_AUTH_USER: "admin",
          BASIC_AUTH_PASSWORD: "secret",
          FORSA_TEST_AUTH_BYPASS: "0",
        },
      }));

      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "secret" }),
      });

      expect(res.status).toBe(200);
      const persistedSecret = (
        await readFile(join(tempDir, "jwt-secret"), "utf8")
      ).trim();
      expect(persistedSecret.length).toBeGreaterThanOrEqual(32);
    });
  });

  describe("JWT-authenticated requests", () => {
    beforeEach(async () => {
      ({ server, baseUrl, closeDb, tempDir } = await startServer({
        env: AUTH_ENV,
      }));
    });

    it("accepts a valid JWT on protected routes", async () => {
      // Get a token.
      const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "secret" }),
      });
      const { data } = await loginRes.json();

      // Use it on a protected route.
      const protectedRes = await fetch(`${baseUrl}/api/settings`, {
        headers: { Authorization: `Bearer ${data.token}` },
      });

      expect(protectedRes.status).not.toBe(401);
    });

    it("rejects an invalid JWT", async () => {
      const res = await fetch(`${baseUrl}/api/settings`, {
        headers: { Authorization: "Bearer invalid.token.here" },
      });

      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/auth/setup", () => {
    beforeEach(async () => {
      ({ server, baseUrl, closeDb, tempDir } = await startServer());
    });

    it("rejects a short first-admin password", async () => {
      const res = await fetch(`${baseUrl}/api/auth/setup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "short" }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe("public demo auth behavior", () => {
    beforeEach(async () => {
      ({ server, baseUrl, closeDb, tempDir } = await startServer({
        env: {
          DEMO_MODE: "true",
          FORSA_TEST_AUTH_BYPASS: "0",
          BASIC_AUTH_USER: "",
          BASIC_AUTH_PASSWORD: "",
        },
      }));
    });

    it("allows anonymous read access to demo-backed APIs", async () => {
      const res = await fetch(`${baseUrl}/api/profile/projects`);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBeGreaterThan(0);
    });

    it("does not allow creating the first admin in demo mode", async () => {
      const bootstrapRes = await fetch(`${baseUrl}/api/auth/bootstrap-status`);
      expect(bootstrapRes.status).toBe(200);
      const bootstrapBody = await bootstrapRes.json();
      expect(bootstrapBody.ok).toBe(true);
      expect(bootstrapBody.data.setupRequired).toBe(false);

      const setupRes = await fetch(`${baseUrl}/api/auth/setup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "admin",
          password: "super-secret-password",
        }),
      });

      expect(setupRes.status).toBe(503);
      const setupBody = await setupRes.json();
      expect(setupBody.ok).toBe(false);
      expect(setupBody.error.message).toContain("disabled in the public demo");
    });
  });

  describe("POST /api/auth/logout", () => {
    beforeEach(async () => {
      ({ server, baseUrl, closeDb, tempDir } = await startServer({
        env: AUTH_ENV,
      }));
    });

    it("invalidates the token", async () => {
      // Login.
      const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "secret" }),
      });
      const { data } = await loginRes.json();
      const token = data.token;

      // Verify token works.
      const before = await fetch(`${baseUrl}/api/settings`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(before.status).not.toBe(401);

      // Logout.
      const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(logoutRes.status).toBe(200);

      // Token should now be rejected.
      const after = await fetch(`${baseUrl}/api/settings`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(after.status).toBe(401);
    });

    it("is idempotent — logout without token returns 200", async () => {
      const res = await fetch(`${baseUrl}/api/auth/logout`, {
        method: "POST",
      });
      expect(res.status).toBe(200);
    });
  });

  describe("backward compatibility", () => {
    beforeEach(async () => {
      ({ server, baseUrl, closeDb, tempDir } = await startServer({
        env: AUTH_ENV,
      }));
    });

    it("rejects Basic headers on protected routes while still allowing login with credentials", async () => {
      const credentials = Buffer.from("admin:secret").toString("base64");
      const res = await fetch(`${baseUrl}/api/settings`, {
        headers: { Authorization: `Basic ${credentials}` },
      });

      expect(res.status).toBe(401);

      const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "secret" }),
      });

      expect(loginRes.status).toBe(200);
    });
  });
});
