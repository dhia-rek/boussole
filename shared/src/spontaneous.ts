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
