import type {
  DesignResumeAiGuidance,
  DesignResumeJson,
  Job,
} from "@shared/types";
import { describe, expect, it } from "vitest";
import {
  buildCvDictionary,
  buildCvDictionaryWithStats,
  richTextLines,
} from "./dictionary";
import { formatCandidateRules } from "./index";
import {
  applyHeadlinePrefix,
  buildCvReviewPrompt,
  findNewTerms,
  normalizeCvReview,
} from "./review";

function section(items: unknown[], extra: Record<string, unknown> = {}) {
  return { title: "", columns: 1, hidden: false, items, ...extra };
}

const sampleCv = {
  basics: {
    name: "Sam Doe",
    headline: "Data Engineer",
    email: "sam@example.com",
  },
  summary: {
    title: "Profile",
    hidden: false,
    content: "<p>Data engineer with <strong>3 years</strong> of Python.</p>",
  },
  sections: {
    profiles: section([
      { id: "p1", hidden: false, network: "GitHub", username: "sam" },
    ]),
    experience: section(
      [
        {
          id: "e1",
          hidden: false,
          company: "Acme",
          position: "Data Engineer",
          period: "2022–2025",
          description:
            "<ul><li><p>Built <strong>Airflow</strong> pipelines in Python</p></li><li><p>Ran the office football club</p></li></ul>",
        },
        {
          id: "e2",
          hidden: true,
          company: "Hidden Co",
          position: "Intern",
          description: "<p>Should not appear</p>",
        },
      ],
      { title: "Experience" },
    ),
    skills: section(
      [{ id: "s1", hidden: false, name: "Data", keywords: ["SQL", "dbt"] }],
      { title: "Skills" },
    ),
    interests: section(
      [{ id: "i1", hidden: false, name: "Chess", keywords: [] }],
      {
        title: "Interests",
      },
    ),
    references: section([
      { id: "r1", hidden: false, name: "Jane", description: "<p>Ref</p>" },
    ]),
    volunteer: section([{ id: "v1", hidden: false, organization: "Club" }], {
      title: "Volunteering",
      hidden: true,
    }),
  },
  customSections: [],
} as unknown as DesignResumeJson;

const job = {
  id: "job-1",
  title: "Data Engineer",
  employer: "Beta",
  location: "Paris",
  jobDescription: "We need Airflow, dbt and PostgreSQL.",
} as unknown as Job;

describe("CV dictionary", () => {
  it("numbers every visible line and leaves contact, references and hidden content out", () => {
    const lines = buildCvDictionary(sampleCv);
    expect(lines.map((line) => [line.ref, line.section, line.text])).toEqual([
      ["L1", "headline", "Data Engineer"],
      ["L2", "summary", "Data engineer with 3 years of Python."],
      ["L3", "experience", "Built Airflow pipelines in Python"],
      ["L4", "experience", "Ran the office football club"],
      ["L5", "skills", "Data: SQL, dbt"],
      ["L6", "interests", "Chess"],
    ]);
    expect(lines[2]).toMatchObject({
      entry: "Acme — Data Engineer",
      itemId: "e1",
    });
    expect(JSON.stringify(lines)).not.toContain("sam@example.com");
  });

  it("skips sections the candidate does not share with the AI", () => {
    const guidance = {
      version: 1,
      sections: {
        interests: { mode: "keep", share: false, notes: "", prefix: "" },
      },
      items: {},
    } as unknown as DesignResumeAiGuidance;
    const lines = buildCvDictionary(sampleCv, guidance);
    expect(lines.some((line) => line.section === "interests")).toBe(false);
  });

  it("splits rich text into paragraphs and bullets", () => {
    expect(
      richTextLines("<p>One &amp; two</p><ul><li><p>Three</p></li></ul>"),
    ).toEqual(["One & two", "Three"]);
  });
});

describe("CV review", () => {
  const lines = buildCvDictionary(sampleCv);

  it("keeps the CV as the only vocabulary: unknown refs dropped, silent lines kept", () => {
    const result = normalizeCvReview(
      {
        overall: "Good fit.",
        priorities: ["Reword L3"],
        lines: [
          {
            ref: "L3",
            verdict: "reword",
            reason: "Name the orchestration",
            suggestion: "Built and ran Airflow pipelines in Python",
          },
          { ref: "l4", verdict: "cut", reason: "Off-topic", suggestion: "" },
          { ref: "L5", verdict: "reword", reason: "x", suggestion: "" },
          {
            ref: "L99",
            verdict: "cut",
            reason: "invented line",
            suggestion: "",
          },
        ],
        missing: [
          { requirement: "PostgreSQL", closest_ref: "L5", note: "Real gap" },
          { requirement: "Kafka", closest_ref: "L77", note: "Real gap" },
        ],
      },
      lines,
    );
    expect(result.lines).toHaveLength(lines.length);
    expect(result.lines.map((line) => line.verdict)).toEqual([
      "keep",
      "keep",
      "reword",
      "cut",
      "keep",
      "keep",
    ]);
    expect(result.lines[2]?.newTerms).toEqual([]);
    expect(result.missing).toEqual([
      { requirement: "PostgreSQL", closestRef: "L5", note: "Real gap" },
      { requirement: "Kafka", closestRef: null, note: "Real gap" },
    ]);
  });

  it("flags suggestions that bring in facts the CV never states", () => {
    const cvText = lines.map((line) => line.text).join("\n");
    expect(
      findNewTerms(
        "Built Airflow pipelines in Python for 40 data sources",
        cvText,
      ),
    ).toEqual(["40"]);
    expect(
      findNewTerms("Built Airflow and Kafka pipelines in Python", cvText),
    ).toEqual(["Kafka"]);
    expect(
      findNewTerms("Data engineer with 3 years of Python and dbt", cvText),
    ).toEqual([]);
  });

  it("sends the job and the numbered CV, with the candidate's notes and rules", () => {
    const guidance = {
      version: 1,
      sections: {
        headline: { mode: "tailor", share: true, notes: "", prefix: "Senior" },
        summary: { mode: "keep", share: true, notes: "", prefix: "" },
      },
      items: { e1: { notes: "Biggest project" } },
    } as unknown as DesignResumeAiGuidance;
    const prompt = buildCvReviewPrompt({
      job,
      lines,
      guidance,
      candidateRules: formatCandidateRules(guidance),
    });
    expect(prompt).toContain(
      "L3 [Acme — Data Engineer]: Built Airflow pipelines in Python",
    );
    expect(prompt).toContain("(candidate note: Biggest project)");
    expect(prompt).toContain('must start with "Senior"');
    expect(prompt).toContain("keeps the summary identical");
    expect(prompt).not.toContain("sam@example.com");
  });
});

describe("CV check edge cases", () => {
  const lines = buildCvDictionary(sampleCv);

  it("never cuts the headline and keeps the candidate's required start", () => {
    const cut = normalizeCvReview(
      {
        lines: [
          { ref: "L1", verdict: "cut", reason: "Too vague", suggestion: "" },
        ],
      },
      lines,
    );
    expect(cut.lines[0]).toMatchObject({
      verdict: "keep",
      reason: "Too vague",
    });

    const reworded = normalizeCvReview(
      {
        lines: [
          {
            ref: "L1",
            verdict: "cut",
            reason: "Name the stack",
            suggestion: "Data Engineer — Airflow & dbt",
          },
        ],
      },
      lines,
      { headlinePrefix: "Senior" },
    );
    expect(reworded.lines[0]).toMatchObject({
      verdict: "reword",
      suggestion: "Senior Data Engineer — Airflow & dbt",
    });
    expect(applyHeadlinePrefix("senior data engineer", "Senior")).toBe(
      "senior data engineer",
    );
  });

  it("counts lines the AI skipped and lines over the limit", () => {
    const result = normalizeCvReview(
      { lines: [{ ref: "L1", verdict: "keep", reason: "", suggestion: "" }] },
      lines,
      { skippedLineCount: 4 },
    );
    expect(result.unreviewedCount).toBe(lines.length - 1);
    expect(result.skippedLineCount).toBe(4);

    const bullets = Array.from(
      { length: 160 },
      (_, index) => `<li><p>Bullet number ${index + 1}</p></li>`,
    ).join("");
    const longCv = structuredClone(sampleCv) as unknown as {
      sections: { experience: { items: Array<{ description: string }> } };
    };
    const firstJob = longCv.sections.experience.items[0];
    if (firstJob) firstJob.description = `<ul>${bullets}</ul>`;
    const stats = buildCvDictionaryWithStats(
      longCv as unknown as DesignResumeJson,
    );
    expect(stats.lines).toHaveLength(150);
    expect(stats.skipped).toBe(2 + 160 + 2 - 150);
  });

  it("drops suggestions on lines that are kept or cut", () => {
    const result = normalizeCvReview(
      {
        lines: [
          {
            ref: "L3",
            verdict: "keep",
            reason: "",
            suggestion: "Something else",
          },
          {
            ref: "L4",
            verdict: "cut",
            reason: "Off-topic",
            suggestion: "Other",
          },
        ],
      },
      lines,
    );
    expect(result.lines[2]?.suggestion).toBe("");
    expect(result.lines[3]?.suggestion).toBe("");
  });
});
