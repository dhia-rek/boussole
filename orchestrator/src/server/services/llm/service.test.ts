import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CLAUDE_CLI_SUGGESTED_MODELS,
  ClaudeCliClient,
  type ClaudeCliSpawnFn,
} from "./claude-cli/client";
import { LlmService } from "./service";
import type { JsonSchemaDefinition, LlmRequestOptions } from "./types";

const schema: JsonSchemaDefinition = {
  name: "test",
  schema: {
    type: "object",
    properties: { value: { type: "string" } },
    required: ["value"],
    additionalProperties: false,
  },
};

function request(
  overrides: Partial<LlmRequestOptions<{ value: string }>> = {},
): LlmRequestOptions<{ value: string }> {
  return {
    model: "opus:medium",
    messages: [{ role: "user", content: "Return JSON." }],
    jsonSchema: schema,
    ...overrides,
  };
}

/** A Claude CLI client whose calls never spawn a real `claude` process. */
function createClient() {
  const client = new ClaudeCliClient({
    spawnFn: (() => {
      throw new Error("The Claude CLI must not run in unit tests.");
    }) as unknown as ClaudeCliSpawnFn,
  });
  const callJson = vi.spyOn(client, "callJson");
  const validateCredentials = vi.spyOn(client, "validateCredentials");
  return { client, callJson, validateCredentials };
}

describe("LlmService (Claude CLI)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("always reports the Claude CLI provider", () => {
    expect(new LlmService().getProvider()).toBe("claude_cli");
    expect(new LlmService(createClient().client).getProvider()).toBe(
      "claude_cli",
    );
  });

  it("delegates JSON calls to the Claude CLI client and parses the answer", async () => {
    const { client, callJson } = createClient();
    callJson.mockResolvedValue({ text: '{"value":"ok"}' });
    const controller = new AbortController();

    const result = await new LlmService(client).callJson<{ value: string }>(
      request({ jobId: "job-1", signal: controller.signal }),
    );

    expect(result).toEqual({ success: true, data: { value: "ok" } });
    expect(callJson).toHaveBeenCalledOnce();
    expect(callJson).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "opus:medium",
        messages: [{ role: "user", content: "Return JSON." }],
        jsonSchema: schema,
        jobId: "job-1",
        signal: controller.signal,
      }),
    );
  });

  it("extracts JSON wrapped in markdown fences or surrounding prose", async () => {
    const { client, callJson } = createClient();
    callJson
      .mockResolvedValueOnce({ text: '```json\n{"value":"fenced"}\n```' })
      .mockResolvedValueOnce({
        text: 'Here is the answer: {"value":"inline"} as requested.',
      });
    const llm = new LlmService(client);

    await expect(llm.callJson<{ value: string }>(request())).resolves.toEqual({
      success: true,
      data: { value: "fenced" },
    });
    await expect(llm.callJson<{ value: string }>(request())).resolves.toEqual({
      success: true,
      data: { value: "inline" },
    });
  });

  it("returns a parse error when the answer is not JSON and retries are off", async () => {
    const { client, callJson } = createClient();
    callJson.mockResolvedValue({ text: "not json at all" });

    const result = await new LlmService(client).callJson(request());

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("Failed to parse JSON response");
    }
    expect(callJson).toHaveBeenCalledOnce();
  });

  it("retries JSON parsing failures and succeeds on a later attempt", async () => {
    const { client, callJson } = createClient();
    callJson
      .mockResolvedValueOnce({ text: "not-json" })
      .mockResolvedValueOnce({ text: "still not json" })
      .mockResolvedValueOnce({ text: '{"value":"ok"}' });

    const result = await new LlmService(client).callJson<{ value: string }>(
      request({ maxRetries: 2, retryDelayMs: 1 }),
    );

    expect(result).toEqual({ success: true, data: { value: "ok" } });
    expect(callJson).toHaveBeenCalledTimes(3);
  });

  it("retries Claude CLI timeouts", async () => {
    const { client, callJson } = createClient();
    callJson
      .mockRejectedValueOnce(new Error("Claude CLI timed out after 180000ms."))
      .mockResolvedValueOnce({ text: '{"value":"after-timeout"}' });

    const result = await new LlmService(client).callJson<{ value: string }>(
      request({ maxRetries: 1, retryDelayMs: 1 }),
    );

    expect(result).toEqual({ success: true, data: { value: "after-timeout" } });
    expect(callJson).toHaveBeenCalledTimes(2);
  });

  it("gives up after the last retry and returns the final error", async () => {
    const { client, callJson } = createClient();
    callJson.mockResolvedValue({ text: "never json" });

    const result = await new LlmService(client).callJson(
      request({ maxRetries: 1, retryDelayMs: 1 }),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("Failed to parse JSON response");
    }
    expect(callJson).toHaveBeenCalledTimes(2);
  });

  it("does not retry errors that a retry cannot fix", async () => {
    const { client, callJson } = createClient();
    callJson.mockRejectedValue(
      new Error("Claude CLI exited with code 1: not logged in"),
    );

    const result = await new LlmService(client).callJson(
      request({ maxRetries: 3, retryDelayMs: 1 }),
    );

    expect(result).toEqual({
      success: false,
      error: "Claude CLI exited with code 1: not logged in",
    });
    expect(callJson).toHaveBeenCalledOnce();
  });

  it("stringifies non-Error failures from the client", async () => {
    const { client, callJson } = createClient();
    callJson.mockRejectedValue("spawn failed");

    const result = await new LlmService(client).callJson(request());

    expect(result).toEqual({ success: false, error: "spawn failed" });
  });

  it("delegates credential validation to the Claude CLI client", async () => {
    const { client, validateCredentials } = createClient();
    validateCredentials.mockResolvedValue({
      valid: false,
      message: "Claude CLI was not found in PATH.",
      username: null,
    });

    const result = await new LlmService(client).validateCredentials();

    expect(result).toEqual({
      valid: false,
      message: "Claude CLI was not found in PATH.",
      username: null,
    });
    expect(validateCredentials).toHaveBeenCalledOnce();
  });

  it("lists the Claude model aliases without calling the CLI", async () => {
    const { client, callJson } = createClient();
    const llm = new LlmService(client);

    const models = await llm.listModels();

    expect(models).toEqual(CLAUDE_CLI_SUGGESTED_MODELS);
    expect(models[0]).toBe("opus:medium");
    expect(models).toEqual(expect.arrayContaining(["opus", "sonnet", "haiku"]));
    // Callers get a copy, so they cannot mutate the shared list.
    models.push("custom");
    expect(await llm.listModels()).not.toContain("custom");
    expect(callJson).not.toHaveBeenCalled();
  });
});
