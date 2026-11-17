import { describe, expect, it } from "vitest";
import { updateSettingsSchema } from "./settings-schema";

describe("updateSettingsSchema", () => {
  it("accepts supported language mode and manual language values", () => {
    expect(
      updateSettingsSchema.parse({
        chatStyleLanguageMode: "manual",
        chatStyleManualLanguage: "german",
      }),
    ).toEqual({
      chatStyleLanguageMode: "manual",
      chatStyleManualLanguage: "german",
    });

    expect(
      updateSettingsSchema.parse({
        chatStyleLanguageMode: null,
        chatStyleManualLanguage: null,
      }),
    ).toEqual({
      chatStyleLanguageMode: null,
      chatStyleManualLanguage: null,
    });
  });

  it("rejects unsupported language mode and manual language values", () => {
    const result = updateSettingsSchema.safeParse({
      chatStyleLanguageMode: "auto",
      chatStyleManualLanguage: "italian",
    });

    expect(result.success).toBe(false);

    if (result.success) {
      return;
    }

    expect(
      result.error.flatten().fieldErrors.chatStyleLanguageMode,
    ).toBeDefined();
    expect(
      result.error.flatten().fieldErrors.chatStyleManualLanguage,
    ).toBeDefined();
  });

  it("accepts prompt template overrides up to 12000 characters", () => {
    const prompt = "A".repeat(12000);

    expect(
      updateSettingsSchema.parse({
        ghostwriterSystemPromptTemplate: prompt,
        tailoringPromptTemplate: prompt,
        scoringPromptTemplate: prompt,
      }),
    ).toEqual({
      ghostwriterSystemPromptTemplate: prompt,
      tailoringPromptTemplate: prompt,
      scoringPromptTemplate: prompt,
    });
  });

  it("accepts the Ghostwriter Stop Slop toggle", () => {
    expect(
      updateSettingsSchema.parse({
        ghostwriterStopSlopEnabled: true,
      }),
    ).toEqual({
      ghostwriterStopSlopEnabled: true,
    });

    expect(
      updateSettingsSchema.parse({
        ghostwriterStopSlopEnabled: null,
      }),
    ).toEqual({
      ghostwriterStopSlopEnabled: null,
    });
  });

  it("rejects prompt template overrides above 12000 characters", () => {
    const result = updateSettingsSchema.safeParse({
      ghostwriterSystemPromptTemplate: "A".repeat(12001),
    });

    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }

    expect(
      result.error.flatten().fieldErrors.ghostwriterSystemPromptTemplate,
    ).toBeDefined();
  });
});
