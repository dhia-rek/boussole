import { describe, expect, it } from "vitest";
import {
  detectInterviewLang,
  personaNameFromVoice,
  rankVoices,
  splitForSpeech,
} from "./interview-voice";

const voice = (
  name: string,
  lang: string,
  extra: Partial<{ localService: boolean }> = {},
) => ({
  name,
  lang,
  voiceURI: name,
  localService: extra.localService ?? true,
  default: false,
});

describe("interview voice", () => {
  it("detects French and English interviews", () => {
    expect(
      detectInterviewLang(
        "Bonjour Dhia, merci d'être là. Pour commencer, parlez-moi de votre projet avec n8n.",
      ),
    ).toBe("fr-FR");
    expect(
      detectInterviewLang(
        "Thanks for joining. Tell me how you built the pipeline and what you learned.",
      ),
    ).toBe("en-US");
    expect(detectInterviewLang("")).toBe("en-US");
  });

  it("puts natural voices first and novelty voices like Grandpa last", () => {
    const voices = [
      voice("Grandpa (Français (France))", "fr-FR"),
      voice("Thomas", "fr-FR"),
      voice("Audrey (Premium)", "fr-FR"),
      voice("Amélie", "fr-CA"),
      voice("Samantha", "en-US"),
      voice("Eddy (Français (France))", "fr-FR"),
    ];
    expect(rankVoices(voices, "fr-FR").map((v) => v.name)).toEqual([
      "Audrey (Premium)",
      "Thomas",
      "Amélie",
      "Grandpa (Français (France))",
      "Eddy (Français (France))",
    ]);
    expect(rankVoices(voices, "en-US").map((v) => v.name)).toEqual([
      "Samantha",
    ]);
  });

  it("splits long questions into speakable chunks", () => {
    const text =
      "D'accord. J'aimerais entrer dans le concret. Comment l'assistant décide-t-il qu'il n'est pas sûr ? Est-ce un score de similarité, un seuil, ou autre chose ?";
    const chunks = splitForSpeech(text, 60);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 80)).toBe(true);
    expect(chunks.join(" ")).toBe(text);
  });
});

describe("personaNameFromVoice", () => {
  it("takes a first name from real voices only", () => {
    expect(personaNameFromVoice("Audrey (Premium)")).toBe("Audrey");
    expect(personaNameFromVoice("Thomas")).toBe("Thomas");
    expect(personaNameFromVoice("Amélie (Enhanced)")).toBe("Amélie");
    expect(
      personaNameFromVoice(
        "Microsoft Denise Online (Natural) - French (France)",
      ),
    ).toBe("Denise");
    expect(personaNameFromVoice("Google français")).toBeNull();
    expect(personaNameFromVoice("Grandpa (French (France))")).toBeNull();
    expect(personaNameFromVoice(null)).toBeNull();
  });
});
