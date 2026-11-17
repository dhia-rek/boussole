import { describe, expect, it } from "vitest";
import {
  EXTRACTOR_SOURCE_IDS,
  EXTRACTOR_SOURCE_METADATA,
  type ExtractorSourceId,
  extractorSourceEnum,
  isExtractorSourceId,
  PIPELINE_EXTRACTOR_SOURCE_IDS,
  sortSources,
  sourceLabel,
} from "./index";

describe("extractor source catalog", () => {
  it("validates known source ids", () => {
    for (const source of EXTRACTOR_SOURCE_IDS) {
      expect(extractorSourceEnum.parse(source)).toBe(source);
      expect(isExtractorSourceId(source)).toBe(true);
    }
  });

  it("rejects unknown source ids", () => {
    expect(isExtractorSourceId("unknown-source")).toBe(false);
    expect(() => extractorSourceEnum.parse("unknown-source")).toThrow();
  });

  it("provides metadata for every known source", () => {
    for (const source of EXTRACTOR_SOURCE_IDS) {
      expect(EXTRACTOR_SOURCE_METADATA[source]).toBeDefined();
      expect(EXTRACTOR_SOURCE_METADATA[source].label.length).toBeGreaterThan(0);
    }
  });

  it("only lists job sources for a search in France", () => {
    expect([...PIPELINE_EXTRACTOR_SOURCE_IDS]).toEqual([
      "wttj",
      "companyats",
      "linkedin",
      "indeed",
      "glassdoor",
      "adzuna",
      "hiringcafe",
      "startupjobs",
      "wellfound",
      "bravesearch",
    ]);
    expect(EXTRACTOR_SOURCE_METADATA.manual.category).toBe("manual");

    for (const removed of [
      "gradcracker",
      "ukvisajobs",
      "seek",
      "naukri",
      "jobindex",
      "golangjobs",
      "remoteco",
      "weworkremotely",
      "workingnomads",
    ]) {
      expect(isExtractorSourceId(removed)).toBe(false);
      expect(() => extractorSourceEnum.parse(removed)).toThrow();
    }
  });

  it("labels known sources and falls back to the id for removed ones", () => {
    expect(sourceLabel("wttj")).toBe("Welcome to the Jungle");
    expect(sourceLabel("ukvisajobs")).toBe("ukvisajobs");
  });

  it("sorts sources by catalog order and puts unknown ones last", () => {
    const sorted = sortSources([
      { source: "manual" as const },
      { source: "gradcracker" as unknown as ExtractorSourceId },
      { source: "linkedin" as const },
      { source: "wttj" as const },
    ]);
    expect(sorted.map((entry) => entry.source)).toEqual([
      "wttj",
      "linkedin",
      "manual",
      "gradcracker",
    ]);
  });
});
