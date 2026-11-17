import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildClaudeCliEnv,
  ClaudeCliClient,
  type ClaudeCliSpawnFn,
  parseClaudeCliModelSpec,
} from "./client";

function fakeSpawn(stdout: string) {
  const calls: Array<{
    args: string[];
    env: NodeJS.ProcessEnv;
    stdin: string;
  }> = [];
  const spawnFn = vi.fn((_bin: string, args: string[], options) => {
    const child = new EventEmitter() as EventEmitter & {
      stdin: PassThrough;
      stdout: PassThrough;
      stderr: PassThrough;
      kill: () => void;
    };
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = vi.fn();
    let stdin = "";
    child.stdin.on("data", (chunk) => {
      stdin += String(chunk);
    });
    child.stdin.on("finish", () => {
      calls.push({ args, env: options?.env ?? {}, stdin });
      child.stdout.write(stdout);
      child.stdout.end();
      setImmediate(() => child.emit("close", 0));
    });
    return child;
  }) as unknown as ClaudeCliSpawnFn;
  return { spawnFn, calls };
}

describe("Claude CLI client", () => {
  afterEach(() => {
    delete process.env.CLAUDE_CLI_EFFORT;
  });

  it("parses model aliases with an optional effort suffix", () => {
    expect(parseClaudeCliModelSpec("opus:medium")).toEqual({
      model: "opus",
      effort: "medium",
    });
    expect(parseClaudeCliModelSpec("claude-opus-5-5:HIGH")).toEqual({
      model: "claude-opus-5-5",
      effort: "high",
    });
    expect(parseClaudeCliModelSpec("sonnet")).toEqual({
      model: "sonnet",
      effort: null,
    });
    // Models of other providers are ignored so the CLI default applies.
    expect(parseClaudeCliModelSpec("google/gemini-2.5-flash")).toEqual({
      model: null,
      effort: null,
    });
  });

  it("falls back to CLAUDE_CLI_EFFORT when the model has no suffix", () => {
    process.env.CLAUDE_CLI_EFFORT = "low";
    expect(parseClaudeCliModelSpec("opus").effort).toBe("low");
    process.env.CLAUDE_CLI_EFFORT = "turbo";
    expect(parseClaudeCliModelSpec("opus").effort).toBeNull();
  });

  it("drops the parent Claude Code session but keeps auth variables", () => {
    const env = buildClaudeCliEnv({
      CLAUDECODE: "1",
      CLAUDE_CODE_SESSION_ID: "abc",
      CLAUDE_CODE_MESSAGING_TOKEN: "secret",
      CLAUDE_CODE_OAUTH_TOKEN: "keep-me",
      ANTHROPIC_API_KEY: "keep-me-too",
      PATH: "/usr/bin",
    });
    expect(env).toEqual({
      CLAUDE_CODE_OAUTH_TOKEN: "keep-me",
      ANTHROPIC_API_KEY: "keep-me-too",
      PATH: "/usr/bin",
    });
  });

  it("passes model, effort and a tool-less prompt over stdin", async () => {
    const { spawnFn, calls } = fakeSpawn('{"value":"ok"}');
    const client = new ClaudeCliClient({ spawnFn });

    const result = await client.callJson({
      model: "opus:medium",
      messages: [{ role: "user", content: "Score this job" }],
      jsonSchema: {
        name: "test",
        schema: {
          type: "object",
          properties: {},
          required: [],
          additionalProperties: false,
        },
      },
    });

    expect(result.text).toBe('{"value":"ok"}');
    const args = calls[0]?.args ?? [];
    expect(args).toEqual(
      expect.arrayContaining(["-p", "--model", "opus", "--effort", "medium"]),
    );
    expect(args).toContain("--disallowedTools");
    expect(calls[0]?.stdin).toContain("Score this job");
    expect(calls[0]?.env.CLAUDECODE).toBeUndefined();
  });

  it("validates quickly with low effort", async () => {
    const { spawnFn, calls } = fakeSpawn('{"ok":true}');
    const result = await new ClaudeCliClient({ spawnFn }).validateCredentials();
    expect(result.valid).toBe(true);
    expect(calls[0]?.args).toEqual(expect.arrayContaining(["--effort", "low"]));
  });
});
