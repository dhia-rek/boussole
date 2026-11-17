import type { ResumeProfile } from "@shared/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const callJsonMock = vi.fn();
const getProviderMock = vi.fn();

vi.mock("../repositories/settings", () => ({
  getSetting: vi.fn(),
}));

vi.mock("./llm/service", () => ({
  LlmService: class {
    callJson = callJsonMock;
    getProvider = getProviderMock;
  },
}));

vi.mock("./writing-style", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./writing-style")>();

  return {
    ...actual,
    getWritingStyle: vi.fn(),
  };
});

import { normalizeDesignResumeAiGuidance } from "@shared/design-resume-ai-guidance";
import { getSetting } from "../repositories/settings";
import {
  enforceTailoringRules,
  generateTailoring,
  getOriginalTailoringValues,
} from "./summary";
import { getWritingStyle } from "./writing-style";

describe("generateTailoring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getProviderMock.mockReturnValue("claude_cli");
    callJsonMock.mockResolvedValue({
      success: true,
      data: {
        summary: "Tailored summary",
        headline: "Senior Engineer",
        skills: [],
      },
    });
    vi.mocked(getSetting).mockResolvedValue(null);
    vi.mocked(getWritingStyle).mockResolvedValue({
      tone: "friendly",
      formality: "low",
      constraints: "Keep it under 90 words",
      doNotUse: "synergy",
      languageMode: "manual",
      manualLanguage: "german",
      summaryMaxWords: null,
      maxKeywordsPerSkill: null,
    });
  });

  it("passes shared writing-style and language instructions into tailoring prompts", async () => {
    const profile: ResumeProfile = {
      basics: {
        name: "Test User",
        label: "Engineer",
        summary: "Existing summary",
      },
    };

    await generateTailoring("Build APIs", profile);

    expect(callJsonMock).toHaveBeenCalledTimes(1);

    const request = callJsonMock.mock.calls[0]?.[0];
    expect(request?.messages?.[0]?.content).toContain(
      "WRITING STYLE PREFERENCES:",
    );
    expect(request?.messages?.[0]?.content).toContain("Tone: friendly");
    expect(request?.messages?.[0]?.content).toContain("Formality: low");
    expect(request?.messages?.[0]?.content).toContain(
      "Additional constraints: Keep it under 90 words",
    );
    expect(request?.messages?.[0]?.content).toContain(
      "Avoid these words or phrases: synergy",
    );
    expect(request?.messages?.[0]?.content).toContain(
      "Output language for summary and skills: German",
    );
    expect(request?.messages?.[0]?.content).toContain(
      "Do NOT translate, localize, or paraphrase the headline, even if the rest of the output is in German.",
    );
    expect(request?.messages?.[0]?.content).toContain(
      'Keep "headline" in the exact original job-title wording from the JD.',
    );
  });

  it("removes language directives from constraints so explicit language settings win", async () => {
    vi.mocked(getWritingStyle).mockResolvedValue({
      tone: "friendly",
      formality: "low",
      constraints: "Always respond in French. Keep it under 90 words.",
      doNotUse: "synergy",
      languageMode: "manual",
      manualLanguage: "german",
      summaryMaxWords: null,
      maxKeywordsPerSkill: null,
    });

    await generateTailoring("Build APIs", {
      basics: {
        name: "Test User",
        label: "Engineer",
      },
    });

    const request = callJsonMock.mock.calls.at(-1)?.[0];
    expect(request?.messages?.[0]?.content).toContain(
      "Additional constraints: Keep it under 90 words",
    );
    expect(request?.messages?.[0]?.content).not.toContain(
      "Always respond in French",
    );
    expect(request?.messages?.[0]?.content).toContain(
      "Output language for summary and skills: German",
    );
  });

  it("uses a stored tailoring prompt template override", async () => {
    vi.mocked(getSetting).mockImplementation(async (key) =>
      key === "tailoringPromptTemplate"
        ? "Tailor {{tone}} {{outputLanguage}} {{unknownToken}}"
        : null,
    );

    await generateTailoring("Build APIs", {
      basics: {
        name: "Test User",
        label: "Engineer",
      },
    });

    const request = callJsonMock.mock.calls.at(-1)?.[0];
    expect(request?.messages?.[0]?.content).toContain(
      "Tailor friendly German {{unknownToken}}",
    );
  });

  it("includes word limit when summaryMaxWords is set", async () => {
    vi.mocked(getWritingStyle).mockResolvedValue({
      tone: "friendly",
      formality: "low",
      constraints: "",
      doNotUse: "",
      languageMode: "manual",
      manualLanguage: "english",
      summaryMaxWords: 35,
      maxKeywordsPerSkill: null,
    });

    await generateTailoring("Build APIs", {
      basics: { name: "Test User", label: "Engineer" },
    });

    const prompt = callJsonMock.mock.calls.at(-1)?.[0]?.messages?.[0]?.content;
    expect(prompt).toContain("Maximum 35 words.");
  });

  it("uses singular 'word' when summaryMaxWords is 1", async () => {
    vi.mocked(getWritingStyle).mockResolvedValue({
      tone: "friendly",
      formality: "low",
      constraints: "",
      doNotUse: "",
      languageMode: "manual",
      manualLanguage: "english",
      summaryMaxWords: 1,
      maxKeywordsPerSkill: null,
    });

    await generateTailoring("Build APIs", {
      basics: { name: "Test User", label: "Engineer" },
    });

    const prompt = callJsonMock.mock.calls.at(-1)?.[0]?.messages?.[0]?.content;
    expect(prompt).toContain("Maximum 1 word.");
  });

  it("omits word limit line when summaryMaxWords is null", async () => {
    vi.mocked(getWritingStyle).mockResolvedValue({
      tone: "friendly",
      formality: "low",
      constraints: "",
      doNotUse: "",
      languageMode: "manual",
      manualLanguage: "english",
      summaryMaxWords: null,
      maxKeywordsPerSkill: null,
    });

    await generateTailoring("Build APIs", {
      basics: { name: "Test User", label: "Engineer" },
    });

    const prompt = callJsonMock.mock.calls.at(-1)?.[0]?.messages?.[0]?.content;
    expect(prompt).not.toContain("Maximum");
  });

  it("includes keyword limit when maxKeywordsPerSkill is set", async () => {
    vi.mocked(getWritingStyle).mockResolvedValue({
      tone: "friendly",
      formality: "low",
      constraints: "",
      doNotUse: "",
      languageMode: "manual",
      manualLanguage: "english",
      summaryMaxWords: null,
      maxKeywordsPerSkill: 8,
    });

    await generateTailoring("Build APIs", {
      basics: { name: "Test User", label: "Engineer" },
    });

    const prompt = callJsonMock.mock.calls.at(-1)?.[0]?.messages?.[0]?.content;
    expect(prompt).toContain("Maximum 8 keywords per category");
  });

  it("omits keyword limit when maxKeywordsPerSkill is null", async () => {
    vi.mocked(getWritingStyle).mockResolvedValue({
      tone: "friendly",
      formality: "low",
      constraints: "",
      doNotUse: "",
      languageMode: "manual",
      manualLanguage: "english",
      summaryMaxWords: null,
      maxKeywordsPerSkill: null,
    });

    await generateTailoring("Build APIs", {
      basics: { name: "Test User", label: "Engineer" },
    });

    const prompt = callJsonMock.mock.calls.at(-1)?.[0]?.messages?.[0]?.content;
    expect(prompt).not.toContain("keywords per category");
  });

  it("includes both limits and constraints when all set", async () => {
    vi.mocked(getWritingStyle).mockResolvedValue({
      tone: "friendly",
      formality: "low",
      constraints: "keep under 90 words",
      doNotUse: "",
      languageMode: "manual",
      manualLanguage: "english",
      summaryMaxWords: 35,
      maxKeywordsPerSkill: 8,
    });

    await generateTailoring("Build APIs", {
      basics: { name: "Test User", label: "Engineer" },
    });

    const prompt = callJsonMock.mock.calls.at(-1)?.[0]?.messages?.[0]?.content;
    expect(prompt).toContain("Maximum 35 words.");
    expect(prompt).toContain("Maximum 8 keywords per category");
    // "keep under 90 words" is stripped from constraints because summaryMaxWords (35) takes precedence
    expect(prompt).not.toContain("keep under 90 words");
  });

  describe("candidate AI guidance", () => {
    const guidedProfile = (guidance: unknown): ResumeProfile => ({
      basics: {
        name: "Dhia",
        label: "Stagiaire IA",
        headline: "Stagiaire IA",
        summary: "<p>Étudiant en <strong>Master 2</strong></p>",
      },
      sections: {
        summary: { content: "<p>Étudiant en <strong>Master 2</strong></p>" },
        skills: {
          items: [
            {
              id: "s1",
              name: "LLM",
              description: "",
              level: 0,
              keywords: ["RAG", "LangChain"],
              visible: true,
            },
            {
              id: "s2",
              name: "Hidden",
              description: "",
              level: 0,
              keywords: ["x"],
              visible: false,
            },
          ],
        },
        experience: {
          items: [
            {
              id: "e1",
              company: "KPIT",
              position: "QA",
              location: "",
              date: "",
              summary: "Validation",
              visible: true,
            },
          ],
        },
      },
      aiGuidance: normalizeDesignResumeAiGuidance(guidance),
    });

    it("skips the LLM entirely when every tailorable section is locked", async () => {
      const result = await generateTailoring(
        "Data Scientist (H/F)",
        guidedProfile({
          sections: {
            headline: { mode: "keep" },
            summary: { mode: "keep" },
            skills: { mode: "keep" },
          },
        }),
      );

      expect(callJsonMock).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: true,
        data: {
          headline: "Stagiaire IA",
          summary: "Étudiant en Master 2",
          skills: [{ name: "LLM", keywords: ["RAG", "LangChain"] }],
        },
      });
    });

    it("restores locked sections and prefixes the tailored headline", async () => {
      callJsonMock.mockResolvedValueOnce({
        success: true,
        data: {
          headline: "Stage - Data Scientist (H/F)",
          summary: "Rewritten summary",
          skills: [{ name: "AI", keywords: ["PyTorch"] }],
        },
      });

      const result = await generateTailoring(
        "Stage - Data Scientist (H/F)",
        guidedProfile({
          sections: {
            headline: { prefix: "Stagiaire" },
            summary: { mode: "keep" },
          },
        }),
      );

      expect(result.data).toEqual({
        headline: "Stagiaire Data Scientist",
        summary: "Étudiant en Master 2",
        skills: [{ name: "AI", keywords: ["PyTorch"] }],
      });
    });

    it("sends rules and notes but never private sections to the model", async () => {
      await generateTailoring(
        "Build APIs",
        guidedProfile({
          sections: {
            headline: { prefix: "Stagiaire" },
            skills: { notes: "Python first" },
            experience: { share: false, notes: "secret employer details" },
          },
        }),
      );

      const prompt = callJsonMock.mock.calls.at(-1)?.[0]?.messages?.[0]
        ?.content as string;
      expect(prompt).toContain('must start with "Stagiaire"');
      expect(prompt).toContain("Skills notes from the candidate: Python first");
      expect(prompt).not.toContain("KPIT");
      expect(prompt).not.toContain("secret employer details");
      expect(prompt).not.toContain("{{candidateInstructions}}");
    });
  });
});

describe("enforceTailoringRules", () => {
  const originals = {
    headline: "Stagiaire IA",
    summary: "Original summary",
    skills: [{ name: "LLM", keywords: ["RAG"] }],
  };
  const tailored = {
    headline: "ML Engineer (m/w/d)",
    summary: "Tailored",
    skills: [{ name: "ML", keywords: ["PyTorch"] }],
  };
  const rule = (mode: "tailor" | "keep", prefix = "") => ({
    mode,
    prefix,
    notes: "",
  });

  it("strips job-ad gender markers from tailored headlines", () => {
    expect(
      enforceTailoringRules(
        tailored,
        {
          headline: rule("tailor"),
          summary: rule("tailor"),
          skills: rule("tailor"),
          projects: rule("tailor"),
        },
        originals,
      ).headline,
    ).toBe("ML Engineer");
  });

  it("falls back to the original headline when the AI returns none", () => {
    expect(
      enforceTailoringRules(
        { ...tailored, headline: "" },
        {
          headline: rule("tailor", "Stagiaire"),
          summary: rule("tailor"),
          skills: rule("tailor"),
          projects: rule("tailor"),
        },
        originals,
      ).headline,
    ).toBe("Stagiaire IA");
  });

  it("keeps locked sections verbatim", () => {
    expect(
      enforceTailoringRules(
        tailored,
        {
          headline: rule("keep", "Ignored"),
          summary: rule("keep"),
          skills: rule("keep"),
          projects: rule("tailor"),
        },
        originals,
      ),
    ).toEqual(originals);
  });

  it("reads original values from a Design Resume profile", () => {
    expect(
      getOriginalTailoringValues({
        basics: { label: "Fallback label" },
        sections: { summary: { content: "<p>A &amp; B</p>" } },
      }),
    ).toEqual({ headline: "Fallback label", summary: "A & B", skills: [] });
  });
});

describe("job title context", () => {
  it("falls back to the cleaned job title, with the prefix, when the AI returns no headline", () => {
    expect(
      enforceTailoringRules(
        { headline: "", summary: "s", skills: [] },
        {
          headline: { mode: "tailor", prefix: "Stagiaire", notes: "" },
          summary: { mode: "tailor", prefix: "", notes: "" },
          skills: { mode: "tailor", prefix: "", notes: "" },
          projects: { mode: "tailor", prefix: "", notes: "" },
        },
        { headline: "Original", summary: "o", skills: [] },
        "Stage - Data Scientist (H/F)",
      ).headline,
    ).toBe("Stagiaire Data Scientist");
  });
});
