import { describe, expect, it } from "vitest";
import {
  designResumeLanguageFromDetected,
  getDesignResumeLanguageLabel,
  normalizeDesignResumeLanguage,
  writingLanguageFromDesignResumeLanguage,
} from "./design-resume-variants";
import { htmlToPlainText } from "./utils/string";

describe("design resume language variants", () => {
  it("normalizes supported tags and rejects everything else", () => {
    expect(normalizeDesignResumeLanguage(" EN ")).toBe("en");
    expect(normalizeDesignResumeLanguage("fr")).toBe("fr");
    expect(normalizeDesignResumeLanguage("xx")).toBeNull();
    expect(normalizeDesignResumeLanguage("../../etc")).toBeNull();
    expect(normalizeDesignResumeLanguage(null)).toBeNull();
    expect(normalizeDesignResumeLanguage(42)).toBeNull();
  });

  it("maps detected writing languages to tags and back", () => {
    expect(designResumeLanguageFromDetected("english")).toBe("en");
    expect(designResumeLanguageFromDetected("french")).toBe("fr");
    expect(designResumeLanguageFromDetected(null)).toBeNull();
    expect(writingLanguageFromDesignResumeLanguage("fr")).toBe("french");
    expect(writingLanguageFromDesignResumeLanguage("de")).toBe("german");
    expect(writingLanguageFromDesignResumeLanguage(null)).toBeNull();
    expect(writingLanguageFromDesignResumeLanguage("zz")).toBeNull();
  });

  it("labels variants in their own language", () => {
    expect(getDesignResumeLanguageLabel("fr")).toBe("Français");
    expect(getDesignResumeLanguageLabel("en")).toBe("English");
    expect(getDesignResumeLanguageLabel(null)).toBe("CV");
  });
});

describe("htmlToPlainText", () => {
  it("turns editor HTML into readable text", () => {
    expect(
      htmlToPlainText(
        "<p>Étudiant en <strong>Master 2</strong> à l&#39;ECE &amp; plus</p><p>Second&nbsp;paragraph</p>",
      ),
    ).toBe("Étudiant en Master 2 à l'ECE & plus\nSecond paragraph");
  });

  it("renders lists as dash bullets and handles empty input", () => {
    expect(htmlToPlainText("<ul><li>One</li><li>Two</li></ul>")).toBe(
      "- One\n- Two",
    );
    expect(htmlToPlainText("")).toBe("");
  });
});
