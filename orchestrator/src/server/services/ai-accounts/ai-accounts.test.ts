import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runWithRequestContext } from "@infra/request-context";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ClaudeCliClient } from "../llm/claude-cli/client";
import { CodexCliClient, parseCodexModelSpec } from "../llm/codex-cli/client";
import { parseCodexCatalog } from "./models";
import { aiAccountDir, readAiAccountMarker } from "./paths";
import { AiAccountNotSignedInError, resolveClaudeRuntime } from "./runtime";
import {
  __resetAiSignInsForTests,
  cancelAiSignIn,
  getAiSignInSnapshot,
  startAiSignIn,
  submitAiSignInCode,
} from "./sign-in";
import {
  __setAiStatusSpawnForTests,
  getAiAccountStatus,
  signOutAiAccount,
} from "./status";

const FAKE_CLAUDE = join(__dirname, "testing", "fake-claude.mjs");
const FAKE_CODEX = join(__dirname, "testing", "fake-codex.mjs");
const OWNER = "tenant_default";
const FRIEND_A = "tenant_friend_a";
const FRIEND_B = "tenant_friend_b";

const saved: Record<string, string | undefined> = {};
const ENV_KEYS = [
  "DATA_DIR",
  "CLAUDE_CLI_BIN",
  "CODEX_CLI_BIN",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "OPENAI_API_KEY",
  "FAKE_CLAUDE_LOGIN_URL",
  "FAKE_CODEX_DEVICE_DISABLED",
];
let dataDir: string;

function inWorkspace<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  return runWithRequestContext({ tenantId }, fn);
}

async function waitForState(tenantId: string, states: string[]) {
  for (let i = 0; i < 100; i++) {
    const snapshot = getAiSignInSnapshot(tenantId);
    if (snapshot && states.includes(snapshot.state)) return snapshot;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`sign-in never reached ${states.join("/")}`);
}

async function signInClaude(tenantId: string) {
  const started = await startAiSignIn(tenantId, "claude");
  expect(started.state).toBe("waiting_for_code");
  submitAiSignInCode(tenantId, "good-code#state");
  return waitForState(tenantId, ["completed", "failed"]);
}

beforeEach(() => {
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  dataDir = mkdtempSync(join(tmpdir(), "boussole-ai-accounts-"));
  process.env.DATA_DIR = dataDir;
  process.env.CLAUDE_CLI_BIN = FAKE_CLAUDE;
  process.env.CODEX_CLI_BIN = FAKE_CODEX;
  // The server owner's own credentials: must never reach a friend's calls.
  process.env.CLAUDE_CODE_OAUTH_TOKEN = "server-owner-token";
  process.env.OPENAI_API_KEY = "server-owner-key";
  delete process.env.FAKE_CLAUDE_LOGIN_URL;
  delete process.env.FAKE_CODEX_DEVICE_DISABLED;
  __setAiStatusSpawnForTests(undefined);
  __resetAiSignInsForTests();
});

afterEach(() => {
  __resetAiSignInsForTests();
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  rmSync(dataDir, { recursive: true, force: true });
});

describe("who runs the AI", () => {
  it("lets the owner workspace use the server's Claude login", async () => {
    const runtime = await resolveClaudeRuntime(OWNER);
    expect(runtime.mode).toBe("server");
  });

  it("refuses a friend's workspace until it signs in", async () => {
    await expect(resolveClaudeRuntime(FRIEND_A)).rejects.toBeInstanceOf(
      AiAccountNotSignedInError,
    );
    const status = await getAiAccountStatus(FRIEND_A, "claude");
    expect(status.signedIn).toBe(false);
    expect(status.usesServerLogin).toBe(false);
  });
});

describe("Claude sign-in", () => {
  it("shows Anthropic's page, takes the pasted code and keeps the login private", async () => {
    const started = await startAiSignIn(FRIEND_A, "claude");
    expect(started.verificationUrl).toMatch(/^https:\/\/claude\.com\//);
    expect(started.needsCode).toBe(true);

    submitAiSignInCode(FRIEND_A, "good-code#state");
    const done = await waitForState(FRIEND_A, ["completed", "failed"]);
    expect(done.state).toBe("completed");

    const marker = await readAiAccountMarker(FRIEND_A, "claude");
    expect(marker?.accountLabel).toBe("friend@example.com");
    const status = await getAiAccountStatus(FRIEND_A, "claude", {
      fresh: true,
    });
    expect(status).toMatchObject({ signedIn: true, planLabel: "Claude Pro" });

    // The friend's calls run on the friend's login, never the server token.
    const reply = await inWorkspace(FRIEND_A, () =>
      new ClaudeCliClient().complete({ prompt: "hi", model: null }),
    );
    const parsed = JSON.parse(reply.text);
    expect(parsed.configDir).toBe(aiAccountDir(FRIEND_A, "claude"));
    expect(parsed.hasServerToken).toBe(false);
  });

  it("keeps workspaces apart", async () => {
    expect((await signInClaude(FRIEND_A)).state).toBe("completed");
    await expect(
      inWorkspace(FRIEND_B, () =>
        new ClaudeCliClient().complete({ prompt: "hi", model: null }),
      ),
    ).rejects.toThrow("not signed in");
    expect((await getAiAccountStatus(FRIEND_B, "claude")).signedIn).toBe(false);
  });

  it("reports a rejected code", async () => {
    await startAiSignIn(FRIEND_A, "claude");
    submitAiSignInCode(FRIEND_A, "wrong-code");
    const done = await waitForState(FRIEND_A, ["completed", "failed"]);
    expect(done.state).toBe("failed");
    expect(done.message).toMatch(/not accepted|did not finish/);
    expect(await readAiAccountMarker(FRIEND_A, "claude")).toBeNull();
  });

  it("refuses codes with unexpected characters", async () => {
    await startAiSignIn(FRIEND_A, "claude");
    expect(() => submitAiSignInCode(FRIEND_A, "code\nrm -rf /")).toThrow(
      /does not look like/,
    );
    cancelAiSignIn(FRIEND_A);
  });

  it("never shows a sign-in link outside the provider's site", async () => {
    process.env.FAKE_CLAUDE_LOGIN_URL = "https://evil.example/oauth";
    const started = await startAiSignIn(FRIEND_A, "claude");
    expect(started.verificationUrl).toBeNull();
    expect(started.state).toBe("starting");
    expect(cancelAiSignIn(FRIEND_A)?.state).toBe("cancelled");
  });

  it("signs out and forgets the stored login", async () => {
    await signInClaude(FRIEND_A);
    await signOutAiAccount(FRIEND_A, "claude");
    expect(await readAiAccountMarker(FRIEND_A, "claude")).toBeNull();
    expect((await getAiAccountStatus(FRIEND_A, "claude")).signedIn).toBe(false);
  });
});

describe("ChatGPT sign-in", () => {
  it("shows OpenAI's page with a one-time code and finishes on approval", async () => {
    const started = await startAiSignIn(FRIEND_A, "chatgpt");
    expect(started.state).toBe("waiting_for_approval");
    expect(started.verificationUrl).toBe(
      "https://auth.openai.com/codex/device",
    );
    expect(started.userCode).toBe("ABCD-12345");

    const done = await waitForState(FRIEND_A, ["completed", "failed"]);
    expect(done.state).toBe("completed");
    const status = await getAiAccountStatus(FRIEND_A, "chatgpt", {
      fresh: true,
    });
    expect(status).toMatchObject({ signedIn: true, planLabel: "ChatGPT plan" });

    const reply = await inWorkspace(FRIEND_A, () =>
      new CodexCliClient().complete({ prompt: "hello", model: "gpt-a:medium" }),
    );
    const parsed = JSON.parse(reply.text);
    expect(parsed).toMatchObject({
      codexHome: aiAccountDir(FRIEND_A, "chatgpt"),
      hasOpenAiKey: false,
      model: "gpt-a",
      sandbox: "read-only",
      promptChars: 5,
    });
  });

  it("explains when device sign-in is turned off", async () => {
    process.env.FAKE_CODEX_DEVICE_DISABLED = "1";
    await startAiSignIn(FRIEND_A, "chatgpt");
    const done = await waitForState(FRIEND_A, ["failed"]);
    expect(done.message).toMatch(/Device sign-in is turned off/);
  });

  it("needs the workspace's own sign-in, even for the owner", async () => {
    await expect(
      inWorkspace(OWNER, () =>
        new CodexCliClient().complete({ prompt: "x", model: null }),
      ),
    ).rejects.toThrow("not signed in");
  });
});

describe("model choices", () => {
  it("lists only public ChatGPT models, best first", () => {
    const models = parseCodexCatalog(
      JSON.stringify({
        models: [
          { slug: "hidden", visibility: "hide", priority: 0 },
          { slug: "b", display_name: "B", visibility: "list", priority: 2 },
          {
            slug: "a",
            display_name: "A",
            visibility: "list",
            priority: 1,
            default_reasoning_level: "medium",
            supported_reasoning_levels: [
              { effort: "medium", description: "x" },
            ],
          },
        ],
      }),
    );
    expect(models.map((model) => model.id)).toEqual(["a", "b"]);
    expect(models[0]).toMatchObject({
      defaultEffort: "medium",
      efforts: [{ id: "medium" }],
    });
  });

  it("drops unsafe model or effort values", () => {
    expect(parseCodexModelSpec("gpt-6.1-sol:low")).toEqual({
      model: "gpt-6.1-sol",
      effort: "low",
    });
    expect(parseCodexModelSpec('x" --sandbox danger:high')).toEqual({
      model: null,
      effort: "high",
    });
    expect(parseCodexModelSpec("gpt:LOW;rm")).toEqual({
      model: "gpt",
      effort: null,
    });
  });
});
