import type { Server } from "node:http";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startServer, stopServer } from "./test-utils";

const TESTING = join(__dirname, "../../services/ai-accounts/testing");

async function waitForSignIn(baseUrl: string, states: string[]) {
  for (let i = 0; i < 100; i++) {
    const body = await (await fetch(`${baseUrl}/api/ai-account`)).json();
    const state = body.data.signIn?.state;
    if (states.includes(state)) return body.data;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`sign-in never reached ${states.join("/")}`);
}

function post(baseUrl: string, path: string, body: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe.sequential("AI account API", () => {
  let server: Server;
  let baseUrl: string;
  let closeDb: () => void;
  let tempDir: string;

  beforeEach(async () => {
    ({ server, baseUrl, closeDb, tempDir } = await startServer({
      env: {
        CLAUDE_CLI_BIN: join(TESTING, "fake-claude.mjs"),
        CODEX_CLI_BIN: join(TESTING, "fake-codex.mjs"),
      },
    }));
    const { __resetAiSignInsForTests } = await import(
      "@server/services/ai-accounts/sign-in"
    );
    const { __setAiStatusSpawnForTests } = await import(
      "@server/services/ai-accounts/status"
    );
    const { __resetAiSignInRateLimitForTests } = await import("./ai-account");
    __resetAiSignInsForTests();
    __setAiStatusSpawnForTests(undefined);
    __resetAiSignInRateLimitForTests();
  });

  afterEach(async () => {
    const { __resetAiSignInsForTests } = await import(
      "@server/services/ai-accounts/sign-in"
    );
    __resetAiSignInsForTests();
    await stopServer({ server, closeDb, tempDir });
  });

  it("describes both accounts and the model choices", async () => {
    const res = await fetch(`${baseUrl}/api/ai-account`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.meta.requestId).toBeTruthy();
    expect(body.data.activeProvider).toBe("claude");
    expect(body.data.accounts.claude).toMatchObject({
      available: true,
      signedIn: true,
      usesServerLogin: true,
    });
    expect(body.data.accounts.chatgpt.signedIn).toBe(false);
    expect(body.data.models.claude.map((m: { id: string }) => m.id)).toEqual([
      "opus",
      "sonnet",
      "haiku",
    ]);
    expect(body.data.models.chatgpt.map((m: { id: string }) => m.id)).toEqual([
      "gpt-a",
      "gpt-b",
    ]);
    expect(body.data.selectedModels).toEqual({
      claude: "test-model",
      chatgpt: "",
    });
  });

  it("signs in with ChatGPT and switches the workspace to it", async () => {
    const start = await post(baseUrl, "/api/ai-account/sign-in", {
      provider: "chatgpt",
    });
    expect(start.status).toBe(200);
    const started = (await start.json()).data;
    expect(started).toMatchObject({
      state: "waiting_for_approval",
      userCode: "ABCD-12345",
      verificationUrl: "https://auth.openai.com/codex/device",
    });

    const done = await waitForSignIn(baseUrl, ["completed", "failed"]);
    expect(done.signIn.state).toBe("completed");

    const patch = await fetch(`${baseUrl}/api/settings`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        aiProvider: "chatgpt",
        chatgptModel: "gpt-a:high",
      }),
    });
    expect(patch.status).toBe(200);

    const overview = (
      await (await fetch(`${baseUrl}/api/ai-account?fresh=1`)).json()
    ).data;
    expect(overview.activeProvider).toBe("chatgpt");
    expect(overview.accounts.chatgpt.signedIn).toBe(true);
    expect(overview.selectedModels.chatgpt).toBe("gpt-a:high");

    const validation = await post(baseUrl, "/api/onboarding/validate/llm", {});
    expect((await validation.json()).data.valid).toBe(true);

    const out = await post(baseUrl, "/api/ai-account/sign-out", {
      provider: "chatgpt",
    });
    expect(out.status).toBe(200);
    const after = await post(baseUrl, "/api/onboarding/validate/llm", {});
    const afterBody = (await after.json()).data;
    expect(afterBody.valid).toBe(false);
    expect(afterBody.message).toMatch(/ChatGPT/);
  });

  it("signs in with Claude using the pasted code", async () => {
    const started = (
      await (
        await post(baseUrl, "/api/ai-account/sign-in", {
          provider: "claude",
          mode: "subscription",
        })
      ).json()
    ).data;
    expect(started.state).toBe("waiting_for_code");
    expect(started.verificationUrl).toMatch(/^https:\/\/claude\.com\//);

    const code = await post(baseUrl, "/api/ai-account/sign-in/code", {
      code: "good-code#state",
    });
    expect(code.status).toBe(200);
    const done = await waitForSignIn(baseUrl, ["completed", "failed"]);
    expect(done.signIn.state).toBe("completed");
    const overview = (
      await (await fetch(`${baseUrl}/api/ai-account?fresh=1`)).json()
    ).data;
    expect(overview.accounts.claude).toMatchObject({
      signedIn: true,
      usesServerLogin: false,
      accountLabel: "friend@example.com",
    });
  });

  it("rejects a code when nothing waits for one", async () => {
    const res = await post(baseUrl, "/api/ai-account/sign-in/code", {
      code: "good-code#state",
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("CONFLICT");
  });

  it("validates the request", async () => {
    const res = await post(baseUrl, "/api/ai-account/sign-in", {
      provider: "gemini",
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_REQUEST");
  });

  it("limits sign-in attempts", async () => {
    for (let i = 0; i < 10; i++) {
      const res = await post(baseUrl, "/api/ai-account/sign-in", {
        provider: "chatgpt",
      });
      expect(res.status).toBe(200);
    }
    const limited = await post(baseUrl, "/api/ai-account/sign-in", {
      provider: "chatgpt",
    });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    await fetch(`${baseUrl}/api/ai-account/sign-in`, { method: "DELETE" });
  });
});
