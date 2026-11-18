import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { startServer, stopServer } from "./test-utils";

const PASSWORD = "abcd-efgh-ijkl-mnop";

class FakeSession {
  constructor(private readonly refuse: boolean) {}
  async connect() {
    if (this.refuse) {
      throw Object.assign(new Error("AUTHENTICATIONFAILED"), {
        authenticationFailed: true,
      });
    }
  }
  async logout() {}
  close() {}
  async getMailboxLock() {
    return { release() {} };
  }
  async search() {
    return [];
  }
  async *fetch() {}
}

describe.sequential("IMAP (iCloud) provider routes", () => {
  let server: Server;
  let baseUrl: string;
  let closeDb: () => void;
  let tempDir: string;

  afterEach(async () => {
    const imap = await import(
      "@server/services/post-application/ingestion/imap-sync"
    );
    imap.__setImapTestHooks(null);
    await stopServer({ server, closeDb, tempDir });
  });

  async function useFakeMailServer() {
    const imap = await import(
      "@server/services/post-application/ingestion/imap-sync"
    );
    imap.__setImapTestHooks({
      resolveHost: async () => ["17.57.152.5"],
      createSession: (credentials) =>
        new FakeSession(credentials.password !== PASSWORD) as never,
    });
  }

  const action = (
    name: string,
    body: unknown,
    headers: Record<string, string> = {},
  ) =>
    fetch(`${baseUrl}/api/post-application/providers/imap/actions/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });

  it("connects, never returns the password, and disconnects", async () => {
    ({ server, baseUrl, closeDb, tempDir } = await startServer());
    await useFakeMailServer();

    const refused = await action("connect", {
      payload: { email: "me@icloud.com", appPassword: "wrong-pass" },
    });
    expect(refused.status).toBe(400);
    const refusedBody = await refused.json();
    expect(refusedBody.error.code).toBe("INVALID_REQUEST");
    expect(refusedBody.error.message).toContain("app-specific password");

    const notIcloud = await action("connect", {
      payload: { email: "me@example.org", appPassword: PASSWORD },
    });
    expect(notIcloud.status).toBe(400);
    expect((await notIcloud.json()).error.message).toContain("IMAP server");

    const connected = await action("connect", {
      payload: {
        email: "Me@iCloud.com",
        appPassword: " abcd-efgh-ijkl-mnop\n",
      },
    });
    expect(connected.status).toBe(200);
    const connectedText = await connected.text();
    expect(connectedText).not.toContain(PASSWORD);
    expect(connectedText).not.toContain("abcd");
    const connectedBody = JSON.parse(connectedText);
    expect(connectedBody.data.status).toMatchObject({
      provider: "imap",
      connected: true,
      integration: {
        credentials: {
          email: "me@icloud.com",
          host: "imap.mail.me.com",
          port: 993,
          hasPassword: true,
        },
      },
    });

    const status = await action("status", {});
    const statusText = await status.text();
    expect(statusText).not.toContain(PASSWORD);
    expect(JSON.parse(statusText).data.status.connected).toBe(true);

    const disconnected = await action("disconnect", {});
    expect((await disconnected.json()).data.status.connected).toBe(false);
    const { getPostApplicationIntegration } = await import(
      "@server/repositories/post-application-integrations"
    );
    const stored = await getPostApplicationIntegration("imap", "default");
    expect(stored?.credentials).toBeNull();
  });

  it("keeps each workspace's mailbox private", async () => {
    ({ server, baseUrl, closeDb, tempDir } = await startServer({
      env: {
        BASIC_AUTH_USER: "admin",
        BASIC_AUTH_PASSWORD: "secret",
        JWT_SECRET: "an-explicit-jwt-secret-with-at-least-32-chars",
        BOUSSOLE_TEST_AUTH_BYPASS: "0",
      },
    }));
    await useFakeMailServer();
    const login = async (username: string, password: string) => {
      const body = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      }).then((res) => res.json());
      return { Authorization: `Bearer ${body.data.token as string}` };
    };
    const admin = await login("admin", "secret");
    const created = await fetch(`${baseUrl}/api/workspaces/users`, {
      method: "POST",
      headers: { ...admin, "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "adam",
        displayName: "Adam",
        password: "adam-secret",
      }),
    });
    expect(created.status).toBe(201);
    const adam = await login("adam", "adam-secret");

    const connected = await action(
      "connect",
      { payload: { email: "me@icloud.com", appPassword: PASSWORD } },
      admin,
    );
    expect(connected.status).toBe(200);

    const adminStatus = await action("status", {}, admin).then((r) => r.json());
    expect(adminStatus.data.status.connected).toBe(true);
    const adamStatus = await action("status", {}, adam).then((r) => r.json());
    expect(adamStatus.data.status.connected).toBe(false);
    expect(JSON.stringify(adamStatus)).not.toContain("me@icloud.com");
  });
});
