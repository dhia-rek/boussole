/**
 * Tests for the shared LLM JSON helpers. The Claude CLI service itself is
 * covered in ./llm/service.test.ts.
 */

import { describe, expect, it, vi } from "vitest";
import type { JsonSchemaDefinition } from "./llm/types";
import { parseJsonContent } from "./llm/utils/json";

describe("parseJsonContent", () => {
  it("parses clean JSON", () => {
    const result = parseJsonContent<{ foo: string }>('{"foo": "bar"}');
    expect(result.foo).toBe("bar");
  });

  it("handles markdown code fences", () => {
    const result = parseJsonContent<{ foo: string }>(
      '```json\n{"foo": "bar"}\n```',
    );
    expect(result.foo).toBe("bar");
  });

  it("handles json without language specifier", () => {
    const result = parseJsonContent<{ foo: string }>(
      '```\n{"foo": "bar"}\n```',
    );
    expect(result.foo).toBe("bar");
  });

  it("extracts JSON from surrounding text", () => {
    const result = parseJsonContent<{ foo: string }>(
      'Here is the result: {"foo": "bar"} as requested.',
    );
    expect(result.foo).toBe("bar");
  });

  it("throws on completely invalid content", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => parseJsonContent("not json at all")).toThrow();
  });
});

describe("computeLlmCacheKey", () => {
  it("never shares a cache entry between workspaces", async () => {
    const { computeLlmCacheKey } = await import("./llm/cache");
    const base = {
      provider: "claude_cli",
      model: "opus:medium",
      messages: [{ role: "user" as const, content: "same prompt" }],
      jsonSchema: {
        name: "s",
        schema: { type: "object" as const, properties: {} },
      } as JsonSchemaDefinition,
    };
    expect(computeLlmCacheKey({ ...base, tenantId: "tenant-a" })).not.toBe(
      computeLlmCacheKey({ ...base, tenantId: "tenant-b" }),
    );
    expect(computeLlmCacheKey({ ...base, tenantId: "tenant-a" })).toBe(
      computeLlmCacheKey({ ...base, tenantId: "tenant-a" }),
    );
  });
});
