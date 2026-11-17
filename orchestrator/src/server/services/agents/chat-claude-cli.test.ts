// @vitest-environment node
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import { tool } from "langchain";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  AgentProtocolError,
  ChatClaudeCli,
  type ClaudeCliRunner,
  extractFirstJsonObject,
  parseAgentReply,
  renderTranscript,
  toAgentToolSpec,
} from "./chat-claude-cli";

const lookupJob = tool(async () => "{}", {
  name: "lookup_job",
  description: "Look up a job by id.",
  schema: z.object({ jobId: z.string() }),
});

function scripted(replies: string[]) {
  const prompts: string[] = [];
  const runner: ClaudeCliRunner = vi.fn(async ({ prompt }) => {
    prompts.push(prompt);
    const next = replies.shift();
    if (next === undefined) throw new Error("no scripted reply left");
    return next;
  });
  return { runner, prompts };
}

describe("ChatClaudeCli", () => {
  it("returns plain text when no tools are bound", async () => {
    const { runner, prompts } = scripted(["  Hello there  "]);
    const model = new ChatClaudeCli({ model: "opus:medium", runner });

    const reply = await model.invoke([
      new SystemMessage("Be brief."),
      new HumanMessage("Hi"),
    ]);

    expect(reply.content).toBe("Hello there");
    expect(prompts[0]).toContain("# Instructions\nBe brief.");
    expect(prompts[0]).toContain("### User\nHi");
    expect(runner).toHaveBeenCalledWith(
      expect.objectContaining({ model: "opus:medium" }),
    );
  });

  it("turns a tool_calls reply into AIMessage tool calls with unique ids", async () => {
    const { runner, prompts } = scripted([
      '```json\n{"tool_calls":[{"name":"lookup_job","args":{"jobId":"a"}},{"name":"lookup_job","args":{"jobId":"b"}}]}\n```',
    ]);
    const model = new ChatClaudeCli({ runner }).bindTools([lookupJob]);

    const reply = await model.invoke([new HumanMessage("Find jobs a and b")]);

    expect(reply.tool_calls?.map((call) => call.args)).toEqual([
      { jobId: "a" },
      { jobId: "b" },
    ]);
    const ids = reply.tool_calls?.map((call) => call.id);
    expect(new Set(ids).size).toBe(2);
    expect(prompts[0]).toContain('"name": "lookup_job"');
    expect(prompts[0]).toContain('{"tool_calls":[');
  });

  it("returns the final answer and renders previous tool calls and results", async () => {
    const { runner, prompts } = scripted(['{"final":"Job a is in Paris."}']);
    const model = new ChatClaudeCli({ runner }).bindTools([lookupJob]);

    const reply = await model.invoke([
      new HumanMessage("Where is job a?"),
      new AIMessage({
        content: "",
        tool_calls: [
          { id: "call_1", name: "lookup_job", args: { jobId: "a" } },
        ],
      }),
      new ToolMessage({
        content: '{"city":"Paris"}',
        tool_call_id: "call_1",
        name: "lookup_job",
      }),
    ]);

    expect(reply.content).toBe("Job a is in Paris.");
    expect(reply.tool_calls ?? []).toHaveLength(0);
    expect(prompts[0]).toContain(
      'Tool calls: [{"id":"call_1","name":"lookup_job","args":{"jobId":"a"}}]',
    );
    expect(prompts[0]).toContain(
      '### Tool result (lookup_job, call call_1)\n{"city":"Paris"}',
    );
  });

  it("repairs a reply that breaks the protocol once", async () => {
    const { runner, prompts } = scripted([
      "Sure! I will look it up.",
      '{"tool_calls":[{"name":"lookup_job","args":{"jobId":"a"}}]}',
    ]);
    const calls: boolean[] = [];
    const model = new ChatClaudeCli({
      runner,
      onCliCall: ({ ok }) => calls.push(ok),
    }).bindTools([lookupJob]);

    const reply = await model.invoke([new HumanMessage("Find job a")]);

    expect(reply.tool_calls?.[0]?.name).toBe("lookup_job");
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("# Your previous reply was rejected");
    expect(prompts[1]).toContain("no JSON object found");
    expect(calls).toEqual([true, true]);
  });

  it("fails clearly when the repaired reply is still invalid", async () => {
    const { runner } = scripted([
      '{"tool_calls":[{"name":"delete_everything","args":{}}]}',
      '{"tool_calls":[{"name":"lookup_job","args":{}}]}',
    ]);
    const model = new ChatClaudeCli({ runner }).bindTools([lookupJob]);

    await expect(model.invoke([new HumanMessage("Go")])).rejects.toThrow(
      /did not follow the agent reply protocol after a retry: tool "lookup_job" is missing required argument\(s\): jobId/,
    );
  });

  it("requires a tool call when tool_choice demands one", async () => {
    const { runner, prompts } = scripted([
      '{"final":"done"}',
      '{"tool_calls":[{"name":"lookup_job","args":{"jobId":"z"}}]}',
    ]);
    const model = new ChatClaudeCli({ runner }).bindTools([lookupJob], {
      tool_choice: "any",
    });

    const reply = await model.invoke([new HumanMessage("Go")]);

    expect(reply.tool_calls?.[0]?.args).toEqual({ jobId: "z" });
    expect(prompts[0]).toContain("You must call at least one tool");
    expect(prompts[1]).toContain("a tool call is required");
  });

  it("propagates CLI failures", async () => {
    const runner: ClaudeCliRunner = async () => {
      throw new Error("Claude CLI timed out after 10ms.");
    };
    const model = new ChatClaudeCli({ runner });
    await expect(model.invoke([new HumanMessage("Hi")])).rejects.toThrow(
      "timed out",
    );
  });
});

describe("agent reply parsing", () => {
  const specs = [toAgentToolSpec(lookupJob)];

  it("converts LangChain tools to JSON-schema specs", () => {
    expect(specs[0]).toMatchObject({
      name: "lookup_job",
      description: "Look up a job by id.",
      parameters: { type: "object", required: ["jobId"] },
    });
  });

  it("finds the first balanced object, ignoring braces inside strings", () => {
    expect(
      extractFirstJsonObject('Here: {"final":"use { and } freely"} trailing {'),
    ).toEqual({ final: "use { and } freely" });
    expect(() => extractFirstJsonObject("no json")).toThrow(AgentProtocolError);
    expect(() => extractFirstJsonObject('{"final": "x"')).toThrow(
      "unterminated",
    );
  });

  it("accepts stringified args and non-string finals", () => {
    expect(
      parseAgentReply(
        '{"tool_calls":[{"name":"lookup_job","args":"{\\"jobId\\":\\"q\\"}"}]}',
        specs,
        false,
      ),
    ).toEqual({
      kind: "tools",
      calls: [{ name: "lookup_job", args: { jobId: "q" } }],
    });
    expect(parseAgentReply('{"final":{"ok":true}}', specs, false)).toEqual({
      kind: "final",
      text: '{"ok":true}',
    });
  });

  it("rejects unknown tools and replies without an action", () => {
    expect(() =>
      parseAgentReply('{"tool_calls":[{"name":"rm","args":{}}]}', specs, false),
    ).toThrow('"rm" is not one of: lookup_job');
    expect(() => parseAgentReply('{"answer":"x"}', specs, false)).toThrow(
      'expected a "tool_calls" array or a "final" string',
    );
  });

  it("puts system content blocks in the instructions", () => {
    const { system, transcript } = renderTranscript([
      new SystemMessage({
        content: [
          { type: "text", text: "Part one." },
          { type: "text", text: "Part two." },
        ],
      }),
      new HumanMessage("Question"),
    ]);
    expect(system).toBe("Part one.\nPart two.");
    expect(transcript).toBe("### User\nQuestion");
  });
});
