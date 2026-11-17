/**
 * Language variants of the Design Resume (e.g. a French and an English CV).
 * A job uses the variant whose language matches its description, falling back
 * to the primary CV.
 */
import type { ChatStyleManualLanguage } from "./types/settings";

export const DESIGN_RESUME_LANGUAGES = ["fr", "en", "de", "es"] as const;

export type DesignResumeLanguage = (typeof DESIGN_RESUME_LANGUAGES)[number];

export const DESIGN_RESUME_LANGUAGE_LABELS: Record<
  DesignResumeLanguage,
  string
> = {
  fr: "Français",
  en: "English",
  de: "Deutsch",
  es: "Español",
};

const DETECTED_TO_TAG: Record<ChatStyleManualLanguage, DesignResumeLanguage> = {
  english: "en",
  french: "fr",
  german: "de",
  spanish: "es",
};

export function isDesignResumeLanguage(
  value: unknown,
): value is DesignResumeLanguage {
  return (
    typeof value === "string" &&
    (DESIGN_RESUME_LANGUAGES as readonly string[]).includes(value)
  );
}

/** Lower-cases and validates a variant tag; anything unsupported → null. */
export function normalizeDesignResumeLanguage(
  value: unknown,
): DesignResumeLanguage | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return isDesignResumeLanguage(normalized) ? normalized : null;
}

/** Maps a detected writing language ("english") to a variant tag ("en"). */
export function designResumeLanguageFromDetected(
  language: ChatStyleManualLanguage | null | undefined,
): DesignResumeLanguage | null {
  return language ? DETECTED_TO_TAG[language] : null;
}

/** Maps a variant tag ("fr") to the writing language used by renderers ("french"). */
export function writingLanguageFromDesignResumeLanguage(
  language: string | null | undefined,
): ChatStyleManualLanguage | null {
  const normalized = normalizeDesignResumeLanguage(language);
  if (!normalized) return null;
  const entry = Object.entries(DETECTED_TO_TAG).find(
    ([, tag]) => tag === normalized,
  );
  return entry ? (entry[0] as ChatStyleManualLanguage) : null;
}

export function getDesignResumeLanguageLabel(
  language: string | null | undefined,
): string {
  const normalized = normalizeDesignResumeLanguage(language);
  return normalized ? DESIGN_RESUME_LANGUAGE_LABELS[normalized] : "CV";
}
