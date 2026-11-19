import type { OutreachContact } from "./types/spontaneous";

const RECRUITING_TITLE =
  /talent|recruit|recrut|\bhr\b|\brh\b|human resources|ressources humaines|people|acquisition|hiring|staffing|carri[eè]re/i;
export const RECRUITING_ADDRESS =
  /^(recrutement|recruitment|recruiting|recrute|rh|hr|jobs?|careers?|carrieres?|talents?|emploi|candidatures?|people|hiring)([._+-]|@)/i;

/**
 * Whether a contact is a sensible place to send a spontaneous application:
 * a published recruiting address, or someone whose title is in recruiting/HR.
 * Founders, executives and other teams are not, unless nothing else exists.
 */
export function isRecruitingContact(contact: OutreachContact): boolean {
  if (contact.kind !== "email") return false;
  if (contact.origin === "web" && contact.check === "verified") return true;
  if (RECRUITING_ADDRESS.test(contact.value)) return true;
  return RECRUITING_TITLE.test(contact.title ?? "");
}

/** Hosts that are job boards or social networks, not a company's own site. */
const NOT_A_COMPANY_SITE =
  /(^|\.)(linkedin\.com|indeed\.[a-z.]+|glassdoor\.[a-z.]+|welcometothejungle\.com|startup\.jobs|wellfound\.com|angel\.co|hellowork\.com|jobteaser\.com|monster\.[a-z.]+|ziprecruiter\.com|workable\.com|lever\.co|greenhouse\.io|ashbyhq\.com|google\.[a-z.]+)$/i;

/**
 * The company's own website from a job's employer link, or null. Job
 * sources often store a LinkedIn or job-board page there, a broken value
 * ("https://fr.indeed.comNone") or an unfilled template ("{{{slug}}}").
 */
export function companyWebsiteOrNull(
  value: string | null | undefined,
): string | null {
  const raw = value?.trim();
  if (!raw || /\{\{|%7b%7b/i.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (!host.includes(".") || /(none|null|undefined)$/.test(host)) return null;
  if (NOT_A_COMPANY_SITE.test(host)) return null;
  return `https://${host.replace(/^www\./, "")}`;
}
