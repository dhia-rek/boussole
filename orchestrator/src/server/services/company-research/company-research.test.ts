import type { CompanyResearchJudgement, Job } from "@shared/types";
import { describe, expect, it, vi } from "vitest";
import { buildResearchPrompt, normalizeResearchOutput } from "./brief";
import { decideVerdict, judgeBrief } from "./judge";
import {
  checkFactQuotes,
  extractPageText,
  normalizeForMatch,
  quoteAppearsIn,
} from "./quote-check";
import {
  buildClaudeResearchArgs,
  buildCodexResearchArgs,
  parseClaudeResearchOutput,
} from "./web-research";

const job = {
  id: "job-1",
  title: "Data Quality Engineer",
  employer: "Acme",
  employerUrl: "https://acme.example",
  location: "Paris",
  jobUrl: "https://jobs.example/acme/42",
  jobUrlDirect: null,
  applicationLink: null,
  jobDescription:
    "Nous recherchons un ingénieur qualité des données pour fiabiliser nos pipelines.",
} as unknown as Job;

describe("quote matching", () => {
  it("ignores typography differences", () => {
    const page =
      "Acme compte aujourd’hui plus de 1 200 clients : banques, assureurs.";
    expect(
      quoteAppearsIn("Acme compte aujourd'hui plus de 1 200 clients :", page),
    ).toBe(true);
    expect(normalizeForMatch("« Bonjour »")).toBe('"bonjour"');
  });

  it("rejects quotes that are not on the page or too short", () => {
    const page = "Acme builds payment software for European banks.";
    expect(
      quoteAppearsIn("Acme builds payment software for US banks", page),
    ).toBe(false);
    expect(quoteAppearsIn("Acme", page)).toBe(false);
  });

  it("accepts an elided quote only when every part appears in order", () => {
    const page =
      "Founded in 2012, Acme builds payment software. Today it serves 300 European banks.";
    expect(
      quoteAppearsIn("Founded in 2012, Acme … serves 300 European banks", page),
    ).toBe(true);
    expect(
      quoteAppearsIn("serves 300 European banks ... Founded in 2012", page),
    ).toBe(false);
  });

  it("reads visible text and metadata, not scripts", () => {
    const text = extractPageText(
      '<html><head><title>Acme</title><meta name="description" content="Payments for banks"></head><body><p>First block</p><p>Second block</p><script>var secret = "hidden words here";</script></body></html>',
    );
    expect(text).toContain("Payments for banks");
    expect(quoteAppearsIn("First block Second block", text)).toBe(true);
    expect(text).not.toContain("hidden words");
  });

  it("checks each page once and falls back to the stored job description", async () => {
    const readPage = vi.fn(async (url: string) =>
      url === "https://acme.example/about"
        ? "Acme serves 300 European banks from Paris."
        : null,
    );
    const checks = await checkFactQuotes(
      [
        {
          topic: "company",
          claim: "Serves banks",
          sourceUrl: "https://acme.example/about",
          quote: "Acme serves 300 European banks",
        },
        {
          topic: "size",
          claim: "Made up",
          sourceUrl: "https://acme.example/about",
          quote: "Acme employs 90,000 people worldwide",
        },
        {
          topic: "role",
          claim: "Pipelines",
          sourceUrl: "https://www.jobs.example/acme/42/",
          quote: "fiabiliser nos pipelines",
        },
        {
          topic: "news",
          claim: "Blocked",
          sourceUrl: "https://blocked.example/news",
          quote: "Acme raised a series B round",
        },
      ],
      job,
      readPage,
    );
    expect(checks).toEqual([
      "verified",
      "not_found",
      "verified",
      "unreachable",
    ]);
    expect(
      readPage.mock.calls.filter(
        ([url]) => url === "https://acme.example/about",
      ),
    ).toHaveLength(1);
  });
});

describe("research brief", () => {
  it("sends only job fields, never candidate data", () => {
    const prompt = buildResearchPrompt(job);
    expect(prompt).toContain("Data Quality Engineer");
    expect(prompt).toContain("Acme");
    expect(prompt).not.toMatch(/candidate's (cv|resume|profile)/i);
  });

  it("drops facts without an http source or quote and caps lists", () => {
    const brief = normalizeResearchOutput({
      summary: "  Acme   builds payments. ",
      facts: [
        {
          topic: "company",
          claim: "ok",
          source_url: "https://a.example",
          quote: "q",
        },
        {
          topic: "weird",
          claim: "ok",
          source_url: "https://b.example",
          quote: "q",
        },
        {
          topic: "company",
          claim: "x",
          source_url: "javascript:alert(1)",
          quote: "q",
        },
        {
          topic: "company",
          claim: "x",
          source_url: "https://c.example",
          quote: "",
        },
      ],
      talking_points: ["a", "b", "c", "d", "e", "f"],
      questions_to_ask: [],
    });
    expect(brief.summary).toBe("Acme builds payments.");
    expect(brief.facts.map((fact) => fact.sourceUrl)).toEqual([
      "https://a.example",
      "https://b.example",
    ]);
    expect(brief.facts[1]?.topic).toBe("company");
    expect(brief.talkingPoints).toHaveLength(5);
  });
});

describe("web research commands", () => {
  it("gives Claude web tools only, with structured output", () => {
    const args = buildClaudeResearchArgs("opus:medium", { type: "object" });
    expect(args).toEqual(
      expect.arrayContaining(["-p", "--restricted", "--json-schema"]),
    );
    expect(args[args.indexOf("--tools") + 1]).toBe("WebSearch,WebFetch");
    expect(args[args.indexOf("--allowedTools") + 1]).toBe("WebSearch,WebFetch");
    expect(args).toEqual(
      expect.arrayContaining(["--model", "opus", "--effort", "medium"]),
    );
    expect(args.join(" ")).not.toMatch(/Bash|Edit|Write|Read/);
  });

  it("runs Codex with search, read-only and an output schema", () => {
    const args = buildCodexResearchArgs({
      prefixArgs: ["codex.js"],
      model: "gpt-5:high",
      workDir: "/tmp/w",
      answerFile: "/tmp/w/answer.json",
      schemaFile: "/tmp/w/schema.json",
    });
    expect(args.slice(0, 3)).toEqual(["codex.js", "--search", "exec"]);
    expect(args[args.indexOf("--sandbox") + 1]).toBe("read-only");
    expect(args[args.indexOf("--output-schema") + 1]).toBe(
      "/tmp/w/schema.json",
    );
    expect(args.at(-1)).toBe("-");
  });

  it("reads Claude's structured output and surfaces errors", () => {
    expect(
      parseClaudeResearchOutput(
        JSON.stringify({
          is_error: false,
          structured_output: { summary: "s" },
        }),
      ),
    ).toEqual({ summary: "s" });
    expect(
      parseClaudeResearchOutput(
        JSON.stringify({ is_error: false, result: '{"summary":"t"}' }),
      ),
    ).toEqual({ summary: "t" });
    expect(() =>
      parseClaudeResearchOutput(
        JSON.stringify({ is_error: true, result: "Not logged in" }),
      ),
    ).toThrow(/Not logged in/);
  });
});

describe("judge", () => {
  const judgement = (
    overrides: Partial<CompanyResearchJudgement>,
  ): CompanyResearchJudgement => ({
    factCount: 5,
    verifiedCount: 4,
    relevance: 4,
    specificity: 4,
    wrongCompany: false,
    issues: [],
    ...overrides,
  });

  it("passes only well-sourced, relevant, specific briefs", () => {
    expect(decideVerdict(judgement({}))).toBe("passed");
    expect(decideVerdict(judgement({ verifiedCount: 2 }))).toBe("needs_review");
    expect(decideVerdict(judgement({ factCount: 10, verifiedCount: 5 }))).toBe(
      "needs_review",
    );
    expect(decideVerdict(judgement({ relevance: 2 }))).toBe("needs_review");
    expect(decideVerdict(judgement({ specificity: null }))).toBe(
      "needs_review",
    );
    expect(decideVerdict(judgement({ wrongCompany: true }))).toBe(
      "needs_review",
    );
  });

  it("keeps the counts when the AI review fails", async () => {
    const llm = {
      callJson: vi.fn().mockResolvedValue({ success: false, error: "boom" }),
    };
    const result = await judgeBrief(
      job,
      {
        summary: "s",
        facts: [
          {
            topic: "company",
            claim: "c",
            sourceUrl: "https://a.example",
            quote: "q",
            check: "verified",
          },
        ],
        talkingPoints: [],
        questionsToAsk: [],
      },
      { model: "opus", llm },
    );
    expect(result).toMatchObject({
      factCount: 1,
      verifiedCount: 1,
      relevance: null,
      specificity: null,
    });
    expect(result.issues[0]).toMatch(/could not run/);
  });
});
