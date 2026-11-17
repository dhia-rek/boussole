import { PRINT_BOLD_END, PRINT_BOLD_START } from "@shared/design-resume-print";
import type { LatexResumeContactItem } from "./types";

/** Text escaping and icon helpers shared by every LaTeX CV layout. */

/** Bold runs from the CV arrive wrapped in these markers (see design-resume-print). */
export const BOLD_RUN = new RegExp(
  `${PRINT_BOLD_START}([^${PRINT_BOLD_START}${PRINT_BOLD_END}]*)${PRINT_BOLD_END}`,
  "g",
);
export const BOLD_MARKERS = new RegExp(
  `[${PRINT_BOLD_START}${PRINT_BOLD_END}]`,
  "g",
);

export function normalizeText(value: string): string {
  return (
    value
      // Typographic dashes → TeX ligatures (en dash "--", em dash "---").
      .replace(/\u2014/g, "---")
      .replace(/\u2013/g, "--")
      .replace(/\u2010|\u2011|\u2012/g, "-")
      .replace(/\u2022/g, "-")
      .replace(/\s+/g, " ")
      .trim()
  );
}

export function escapeLatexText(value: string): string {
  return normalizeText(value)
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([#$%&_{}])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}");
}

export function escapeLatexUrl(value: string): string {
  return value
    .trim()
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([#$%&_{}])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}");
}

export function escapeKeepingBold(value: string): string {
  return escapeLatexText(value).replace(/\|/g, "{\\textbar}");
}

export function escapeForCommand(value: string): string {
  return escapeKeepingBold(value).replace(BOLD_MARKERS, "");
}

/** Escapes text and restores bold runs from the CV as `\textbf{…}`. */
export function renderRichText(value: string): string {
  return escapeKeepingBold(value)
    .replace(BOLD_RUN, (_match, inner: string) =>
      inner.trim() ? `\\textbf{${inner}}` : inner,
    )
    .replace(BOLD_MARKERS, "");
}

/** Editor icon names (Phosphor/Iconify style) → FontAwesome 4 commands. */
const NAMED_CONTACT_ICONS: Array<[RegExp, string]> = [
  [/calendar|date|clock/, "\\faCalendar"],
  [/map|pin|location|home|house|address/, "\\faMapMarker"],
  [/phone|mobile/, "\\faPhone"],
  [/envelope|mail|email/, "\\faEnvelope"],
  [/linkedin/, "\\faLinkedin"],
  [/github/, "\\faGithub"],
  [/briefcase|work|job/, "\\faBriefcase"],
  [/graduation|school|student/, "\\faGraduationCap"],
  [/car|driving/, "\\faCar"],
  [/globe|web|link|site/, "\\faGlobe"],
];

/** Uses the icon chosen in the editor when it is recognised; otherwise infers
 *  one from the contact value (email/phone/social/site). */
export function contactIcon(item: LatexResumeContactItem): string {
  const named = item.icon?.trim().toLowerCase();
  if (named) {
    const match = NAMED_CONTACT_ICONS.find(([pattern]) => pattern.test(named));
    if (match) return match[1];
  }
  const hay = `${item.text} ${item.url ?? ""}`.toLowerCase();
  if (hay.includes("@") && !hay.includes("http")) return "\\faEnvelope";
  if (/^[+\d][\d\s().-]{5,}$/.test(item.text.trim())) return "\\faPhone";
  if (hay.includes("linkedin.")) return "\\faLinkedin";
  if (hay.includes("github.")) return "\\faGithub";
  if (hay.includes("@")) return "\\faEnvelope";
  return "\\faGlobe";
}

/** Plain text with the CV's bold markers removed. */
export function stripBoldMarkers(value: string): string {
  return value.replace(BOLD_MARKERS, "");
}
