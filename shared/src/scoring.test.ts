import { describe, expect, it } from "vitest";
import { isKeywordEstimate, KEYWORD_ESTIMATE_REASON } from "./scoring";

describe("isKeywordEstimate", () => {
  it("recognizes the current and older fallback wordings", () => {
    expect(isKeywordEstimate(KEYWORD_ESTIMATE_REASON)).toBe(true);
    expect(
      isKeywordEstimate(
        "Scored using keyword matching (API key not configured) Score reduced by 10 points due to missing salary information.",
      ),
    ).toBe(true);
    expect(
      isKeywordEstimate(
        "Scored by keyword matching because Claude was unavailable",
      ),
    ).toBe(true);
  });

  it("does not flag real AI explanations that mention keywords", () => {
    expect(
      isKeywordEstimate("Strong match: keyword matching and NLP work fit"),
    ).toBe(false);
    expect(isKeywordEstimate(null)).toBe(false);
    expect(isKeywordEstimate("")).toBe(false);
  });
});
