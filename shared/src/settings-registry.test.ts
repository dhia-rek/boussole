import { describe, expect, it } from "vitest";
import { getDefaultPromptTemplate } from "./prompt-template-definitions";
import {
  DEFAULT_CLAUDE_CLI_MODEL,
  settingsRegistry,
} from "./settings-registry";

describe("settingsRegistry helpers", () => {
  describe("searchCities defaults", () => {
    it("defaults to empty when no location env is configured", () => {
      const previousSearchCities = process.env.SEARCH_CITIES;
      const previousJobspyLocation = process.env.JOBSPY_LOCATION;

      delete process.env.SEARCH_CITIES;
      delete process.env.JOBSPY_LOCATION;

      try {
        expect(settingsRegistry.searchCities.default()).toBe("");
      } finally {
        if (previousSearchCities === undefined) {
          delete process.env.SEARCH_CITIES;
        } else {
          process.env.SEARCH_CITIES = previousSearchCities;
        }

        if (previousJobspyLocation === undefined) {
          delete process.env.JOBSPY_LOCATION;
        } else {
          process.env.JOBSPY_LOCATION = previousJobspyLocation;
        }
      }
    });

    it("uses explicit SEARCH_CITIES or legacy JOBSPY_LOCATION env values", () => {
      const previousSearchCities = process.env.SEARCH_CITIES;
      const previousJobspyLocation = process.env.JOBSPY_LOCATION;

      process.env.SEARCH_CITIES = "Leeds|London";
      process.env.JOBSPY_LOCATION = "Manchester";

      try {
        expect(settingsRegistry.searchCities.default()).toBe("Leeds|London");
        delete process.env.SEARCH_CITIES;
        expect(settingsRegistry.searchCities.default()).toBe("Manchester");
      } finally {
        if (previousSearchCities === undefined) {
          delete process.env.SEARCH_CITIES;
        } else {
          process.env.SEARCH_CITIES = previousSearchCities;
        }

        if (previousJobspyLocation === undefined) {
          delete process.env.JOBSPY_LOCATION;
        } else {
          process.env.JOBSPY_LOCATION = previousJobspyLocation;
        }
      }
    });

    it("does not default jobspyCountryIndeed to UK when no env is configured", () => {
      const previousJobspyCountryIndeed = process.env.JOBSPY_COUNTRY_INDEED;
      delete process.env.JOBSPY_COUNTRY_INDEED;

      try {
        expect(settingsRegistry.jobspyCountryIndeed.default()).toBe("");
      } finally {
        if (previousJobspyCountryIndeed === undefined) {
          delete process.env.JOBSPY_COUNTRY_INDEED;
        } else {
          process.env.JOBSPY_COUNTRY_INDEED = previousJobspyCountryIndeed;
        }
      }
    });

    it("defaults location scope and strictness to explicit local matching", () => {
      expect(settingsRegistry.locationSearchScope.default()).toBe(
        "selected_only",
      );
      expect(settingsRegistry.locationMatchStrictness.default()).toBe(
        "exact_only",
      );
    });
  });

  describe("string parsing (parseNonEmptyStringOrNull)", () => {
    it("returns null for undefined", () => {
      expect(settingsRegistry.model.parse(undefined)).toBeNull();
    });

    it("returns null for empty string", () => {
      expect(settingsRegistry.searchCities.parse("")).toBeNull();
    });

    it("returns the string for non-empty string", () => {
      expect(settingsRegistry.searchCities.parse("London")).toBe("London");
    });

    it("uses shared default prompt templates for prompt settings", () => {
      expect(settingsRegistry.ghostwriterSystemPromptTemplate.default()).toBe(
        getDefaultPromptTemplate("ghostwriterSystemPromptTemplate"),
      );
      expect(settingsRegistry.tailoringPromptTemplate.default()).toBe(
        getDefaultPromptTemplate("tailoringPromptTemplate"),
      );
      expect(settingsRegistry.scoringPromptTemplate.default()).toBe(
        getDefaultPromptTemplate("scoringPromptTemplate"),
      );
    });
  });

  describe("number parsing and clamping", () => {
    it("returns null for empty/invalid values", () => {
      expect(settingsRegistry.adzunaMaxJobsPerTerm.parse("")).toBeNull();
      expect(settingsRegistry.adzunaMaxJobsPerTerm.parse("abc")).toBeNull();
      expect(settingsRegistry.adzunaMaxJobsPerTerm.parse(undefined)).toBeNull();
    });

    it("parses valid numbers", () => {
      expect(settingsRegistry.adzunaMaxJobsPerTerm.parse("42")).toBe(42);
    });

    it("uses env-backed defaults for per-term source caps", () => {
      const previousAdzunaMaxJobsPerTerm = process.env.ADZUNA_MAX_JOBS_PER_TERM;
      const previousStartupjobsMaxResults = process.env.STARTUPJOBS_MAX_RESULTS;

      process.env.ADZUNA_MAX_JOBS_PER_TERM = "75";
      process.env.STARTUPJOBS_MAX_RESULTS = "30";

      try {
        expect(settingsRegistry.adzunaMaxJobsPerTerm.default()).toBe(75);
        expect(settingsRegistry.adzunaMaxJobsPerTerm.parse("25")).toBe(25);
        expect(settingsRegistry.startupjobsMaxJobsPerTerm.default()).toBe(30);

        delete process.env.ADZUNA_MAX_JOBS_PER_TERM;
        delete process.env.STARTUPJOBS_MAX_RESULTS;
        expect(settingsRegistry.adzunaMaxJobsPerTerm.default()).toBe(50);
        expect(settingsRegistry.startupjobsMaxJobsPerTerm.default()).toBe(50);
      } finally {
        if (previousAdzunaMaxJobsPerTerm === undefined) {
          delete process.env.ADZUNA_MAX_JOBS_PER_TERM;
        } else {
          process.env.ADZUNA_MAX_JOBS_PER_TERM = previousAdzunaMaxJobsPerTerm;
        }

        if (previousStartupjobsMaxResults === undefined) {
          delete process.env.STARTUPJOBS_MAX_RESULTS;
        } else {
          process.env.STARTUPJOBS_MAX_RESULTS = previousStartupjobsMaxResults;
        }
      }
    });

    it("clamps backupHour to 0-23", () => {
      expect(settingsRegistry.backupHour.parse("25")).toBe(23);
      expect(settingsRegistry.backupHour.parse("-1")).toBe(0);
      expect(settingsRegistry.backupHour.parse("12")).toBe(12);
    });

    it("clamps backupMaxCount to 1-5", () => {
      expect(settingsRegistry.backupMaxCount.parse("10")).toBe(5);
      expect(settingsRegistry.backupMaxCount.parse("0")).toBe(1);
      expect(settingsRegistry.backupMaxCount.parse("3")).toBe(3);
    });

    it("clamps missingSalaryPenalty to 0-100", () => {
      expect(settingsRegistry.missingSalaryPenalty.parse("150")).toBe(100);
      expect(settingsRegistry.missingSalaryPenalty.parse("-10")).toBe(0);
      expect(settingsRegistry.missingSalaryPenalty.parse("50")).toBe(50);
    });
  });

  describe("boolean (bit-bool) parsing and serialization", () => {
    it("parses bit bools correctly", () => {
      expect(settingsRegistry.backupEnabled.parse("1")).toBe(true);
      expect(settingsRegistry.backupEnabled.parse("true")).toBe(true);
      expect(settingsRegistry.backupEnabled.parse("0")).toBe(false);
      expect(settingsRegistry.backupEnabled.parse("false")).toBe(false);
      expect(settingsRegistry.backupEnabled.parse("2")).toBeNull();
      expect(settingsRegistry.backupEnabled.parse("yes")).toBeNull();
      expect(settingsRegistry.backupEnabled.parse("")).toBeNull();
      expect(settingsRegistry.backupEnabled.parse(undefined)).toBeNull();
      expect(settingsRegistry.renderMarkdownInJobDescriptions.parse("1")).toBe(
        true,
      );
      expect(settingsRegistry.renderMarkdownInJobDescriptions.parse("0")).toBe(
        false,
      );
      expect(settingsRegistry.ghostwriterStopSlopEnabled.parse("1")).toBe(true);
      expect(settingsRegistry.ghostwriterStopSlopEnabled.parse("0")).toBe(
        false,
      );
    });

    it("serializes bit bools correctly", () => {
      expect(settingsRegistry.backupEnabled.serialize(true)).toBe("1");
      expect(settingsRegistry.backupEnabled.serialize(false)).toBe("0");
      expect(settingsRegistry.backupEnabled.serialize(null)).toBeNull();
      expect(settingsRegistry.backupEnabled.serialize(undefined)).toBeNull();
      expect(
        settingsRegistry.renderMarkdownInJobDescriptions.serialize(true),
      ).toBe("1");
      expect(
        settingsRegistry.renderMarkdownInJobDescriptions.serialize(false),
      ).toBe("0");
      expect(settingsRegistry.ghostwriterStopSlopEnabled.serialize(true)).toBe(
        "1",
      );
      expect(settingsRegistry.ghostwriterStopSlopEnabled.serialize(false)).toBe(
        "0",
      );
    });
  });

  describe("JSON array parsing", () => {
    it("parses valid JSON arrays", () => {
      expect(settingsRegistry.searchTerms.parse('["dev", "engineer"]')).toEqual(
        ["dev", "engineer"],
      );
    });

    it("returns null for invalid JSON or non-arrays", () => {
      expect(settingsRegistry.searchTerms.parse('{"not": "array"}')).toBeNull();
      expect(settingsRegistry.searchTerms.parse("invalid json")).toBeNull();
      expect(settingsRegistry.searchTerms.parse("")).toBeNull();
      expect(settingsRegistry.searchTerms.parse(undefined)).toBeNull();
    });

    it("serializes arrays back to JSON", () => {
      expect(settingsRegistry.searchTerms.serialize(["dev", "engineer"])).toBe(
        '["dev","engineer"]',
      );
      expect(settingsRegistry.searchTerms.serialize(null)).toBeNull();
    });

    it("parses valid workplace type arrays", () => {
      expect(
        settingsRegistry.workplaceTypes.parse('["remote","onsite"]'),
      ).toEqual(["remote", "onsite"]);
    });

    it("rejects invalid workplace type arrays", () => {
      expect(
        settingsRegistry.workplaceTypes.parse('["remote","satellite"]'),
      ).toBeNull();
      expect(settingsRegistry.workplaceTypes.parse("[]")).toBeNull();
    });
  });

  describe("Resume projects settings", () => {
    it("parses and serializes resume projects", () => {
      const obj = {
        maxProjects: 10,
        lockedProjectIds: ["1", "2"],
        aiSelectableProjectIds: ["3"],
      };
      const json = JSON.stringify(obj);

      expect(settingsRegistry.resumeProjects.parse(json)).toEqual(obj);
      expect(settingsRegistry.resumeProjects.parse("invalid")).toBeNull();

      expect(settingsRegistry.resumeProjects.serialize(obj)).toBe(json);
      expect(settingsRegistry.resumeProjects.serialize(null)).toBeNull();
    });
  });

  describe("writing-style language settings", () => {
    it("defaults to manual english", () => {
      const previousLanguageMode = process.env.CHAT_STYLE_LANGUAGE_MODE;
      const previousManualLanguage = process.env.CHAT_STYLE_MANUAL_LANGUAGE;

      delete process.env.CHAT_STYLE_LANGUAGE_MODE;
      delete process.env.CHAT_STYLE_MANUAL_LANGUAGE;

      try {
        expect(settingsRegistry.chatStyleLanguageMode.default()).toBe("manual");
        expect(settingsRegistry.chatStyleManualLanguage.default()).toBe(
          "english",
        );
      } finally {
        if (previousLanguageMode === undefined) {
          delete process.env.CHAT_STYLE_LANGUAGE_MODE;
        } else {
          process.env.CHAT_STYLE_LANGUAGE_MODE = previousLanguageMode;
        }

        if (previousManualLanguage === undefined) {
          delete process.env.CHAT_STYLE_MANUAL_LANGUAGE;
        } else {
          process.env.CHAT_STYLE_MANUAL_LANGUAGE = previousManualLanguage;
        }
      }
    });

    it("parses and serializes supported language settings", () => {
      expect(settingsRegistry.chatStyleLanguageMode.parse("manual")).toBe(
        "manual",
      );
      expect(settingsRegistry.chatStyleLanguageMode.parse("match-resume")).toBe(
        "match-resume",
      );
      expect(settingsRegistry.chatStyleLanguageMode.parse("auto")).toBeNull();
      expect(settingsRegistry.chatStyleLanguageMode.parse("")).toBeNull();
      expect(
        settingsRegistry.chatStyleLanguageMode.serialize("match-resume"),
      ).toBe("match-resume");
      expect(settingsRegistry.chatStyleLanguageMode.serialize(null)).toBeNull();

      expect(settingsRegistry.chatStyleManualLanguage.parse("english")).toBe(
        "english",
      );
      expect(settingsRegistry.chatStyleManualLanguage.parse("german")).toBe(
        "german",
      );
      expect(
        settingsRegistry.chatStyleManualLanguage.parse("italian"),
      ).toBeNull();
      expect(settingsRegistry.chatStyleManualLanguage.parse("")).toBeNull();
      expect(
        settingsRegistry.chatStyleManualLanguage.serialize("spanish"),
      ).toBe("spanish");
      expect(
        settingsRegistry.chatStyleManualLanguage.serialize(null),
      ).toBeNull();
    });
  });

  describe("Claude model setting", () => {
    it("defaults to opus with medium effort when MODEL is unset", () => {
      const previousModel = process.env.MODEL;
      delete process.env.MODEL;

      try {
        expect(DEFAULT_CLAUDE_CLI_MODEL).toBe("opus:medium");
        expect(settingsRegistry.model.default()).toBe("opus:medium");

        process.env.MODEL = "  sonnet  ";
        expect(settingsRegistry.model.default()).toBe("sonnet");

        process.env.MODEL = "   ";
        expect(settingsRegistry.model.default()).toBe("opus:medium");
      } finally {
        if (previousModel === undefined) {
          delete process.env.MODEL;
        } else {
          process.env.MODEL = previousModel;
        }
      }
    });

    it("parses and serializes model overrides", () => {
      expect(settingsRegistry.model.parse("haiku")).toBe("haiku");
      expect(settingsRegistry.model.parse("")).toBeNull();
      expect(settingsRegistry.model.serialize("opus:high")).toBe("opus:high");
      expect(settingsRegistry.model.serialize(null)).toBeNull();
    });

    it("no longer registers settings for other AI providers or removed sources", () => {
      for (const removedKey of [
        "llmProvider",
        "llmBaseUrl",
        "llmApiKey",
        "modelScorer",
        "modelTailoring",
        "modelProjectSelection",
        "showSponsorInfo",
        "ukvisajobsMaxJobs",
        "jobindexMaxJobsPerTerm",
        "apifyToken",
        "rxresumeApiKey",
        "pdfRenderer",
      ]) {
        expect(Object.hasOwn(settingsRegistry, removedKey)).toBe(false);
      }
    });
  });
});
