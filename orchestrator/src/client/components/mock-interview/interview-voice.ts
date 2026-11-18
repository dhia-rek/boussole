/**
 * Speech helpers for the mock interview: the interview language, the most
 * natural voice the browser offers for it, and text split for speaking.
 */

export type InterviewLang = "fr-FR" | "en-US";

const FRENCH_WORDS =
  / (le|la|les|des|du|une|et|est|vous|nous|votre|pour|avec|dans|sur|pas|que|qui)(?= )/g;
const ENGLISH_WORDS =
  / (the|and|you|your|we|our|is|are|with|for|in|on|not|that|which|what|how)(?= )/g;

/** French or English, from a job description or an interviewer message. */
export function detectInterviewLang(
  text: string | null | undefined,
): InterviewLang {
  const sample = ` ${(text ?? "")
    .slice(0, 4000)
    .toLowerCase()
    .replace(/[.,;:!?()«»"]/g, " ")} `;
  const french = sample.match(FRENCH_WORDS)?.length ?? 0;
  const english = sample.match(ENGLISH_WORDS)?.length ?? 0;
  return french > english ? "fr-FR" : "en-US";
}

/**
 * Novelty and robotic voices shipped with macOS (Grandpa, Bad News, Zarvox…)
 * and the old Eloquence voices: never chosen unless nothing else exists.
 */
const NOVELTY_VOICES =
  /\b(grandpa|grandma|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|albert|fred|junior|ralph|kathy|eddy|flo|reed|rocko|sandy|shelley)\b/i;
const NATURAL_HINTS = /premium|enhanced|natural|neural|siri|google/i;

const NOT_A_NAME = /^(google|microsoft|apple|siri|voice|default)$/i;

/**
 * The interviewer's first name, taken from the chosen voice so the name and
 * the voice match: "Audrey (Premium)" → "Audrey", "Microsoft Denise Online
 * (Natural) - French (France)" → "Denise", "Google français" → null.
 */
export function personaNameFromVoice(
  voiceName: string | null | undefined,
): string | null {
  if (!voiceName || NOVELTY_VOICES.test(voiceName)) return null;
  const first =
    voiceName
      .replace(/^(microsoft|apple)\s+/i, "")
      .replace(/\([^)]*\)/g, " ")
      .split(/[\s-]+/)
      .find(Boolean) ?? "";
  if (NOT_A_NAME.test(first)) return null;
  return /^\p{Lu}[\p{L}']{1,24}$/u.test(first) ? first : null;
}

export type VoiceLike = Pick<
  SpeechSynthesisVoice,
  "name" | "lang" | "voiceURI" | "localService" | "default"
>;

/** Voices for the language, the most natural first; novelty voices last. */
export function rankVoices<T extends VoiceLike>(
  voices: T[],
  lang: InterviewLang,
): T[] {
  const prefix = lang.slice(0, 2).toLowerCase();
  const score = (voice: T) =>
    (NOVELTY_VOICES.test(voice.name) ? 100 : 0) -
    (NATURAL_HINTS.test(voice.name) ? 10 : 0) -
    (voice.lang.toLowerCase() === lang.toLowerCase() ? 3 : 0) -
    (voice.localService ? 1 : 0);
  return voices
    .filter((voice) => voice.lang.toLowerCase().startsWith(prefix))
    .map((voice, index) => ({ voice, index }))
    .sort((a, b) => score(a.voice) - score(b.voice) || a.index - b.index)
    .map(({ voice }) => voice);
}

/**
 * Sentences grouped into chunks of at most `maxLength` characters. Chrome
 * stops speaking long utterances after about 15 seconds, so long questions
 * are spoken piece by piece.
 */
export function splitForSpeech(text: string, maxLength = 220): string[] {
  const sentences = text
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?…])\s+/)
    .filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (current && `${current} ${sentence}`.length > maxLength) {
      chunks.push(current);
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
