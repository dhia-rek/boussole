/**
 * Which emails are worth sending to the AI classifier. Gmail applies these
 * terms as a server-side search query; IMAP mailboxes apply them locally to
 * each message's sender and subject before downloading anything else.
 */

/** Gmail search subject terms (English). */
export const SUBJECT_TERMS = [
  "application",
  "thank you for applying",
  "thanks for applying",
  "application received",
  "application submitted",
  "your application",
  "interview",
  "assessment",
  "coding challenge",
  "take-home",
  "availability",
  "offer",
  "offer letter",
  "referral",
  "recruiter",
  "hiring team",
  "regret to inform",
  "not moving forward",
  "not selected",
  "application unsuccessful",
  "moving forward with other candidates",
  "unable to proceed",
  "position has been filled",
  "hiring freeze",
  "position on hold",
  "withdrawn",
];

/** Gmail search sender terms: recruiting mailboxes and hiring tools. */
export const FROM_TERMS = [
  "careers@",
  "jobs@",
  "recruiting@",
  "talent@",
  "no-reply@greenhouse.io",
  "no-reply@us.greenhouse-mail.io",
  "no-reply@ashbyhq.com",
  "notification@smartrecruiters.com",
  "@smartrecruiters.com",
  "@workablemail.com",
  "@hire.lever.co",
  "@myworkday.com",
  "@workdaymail.com",
  "@greenhouse.io",
  "@ashbyhq.com",
];

/** Subjects that look relevant but never are. */
export const EXCLUDE_SUBJECT_TERMS = [
  "newsletter",
  "webinar",
  "course",
  "discount",
  "event invitation",
  "job search council",
  "matched new opportunities",
];

/** French subjects (applications, interviews, answers). */
const SUBJECT_TERMS_FR = [
  "candidature",
  "entretien",
  "recrutement",
  "recruteur",
  "recruteuse",
  "offre d'emploi",
  "votre profil",
  "test technique",
  "cas pratique",
  "donner suite",
  "pas ete retenu",
  "promesse d'embauche",
];

/** More hiring tools and recruiting mailboxes, common in France. */
const FROM_TERMS_EXTRA = [
  "recrutement@",
  "rh@",
  "candidature@",
  "candidatures@",
  "@teamtailor",
  "@recruitee.com",
  "@welcometothejungle",
  "@jobteaser.com",
  "@flatchr.io",
  "@taleez.com",
  "@softy.pro",
  "@beetween.com",
  "@cegid.com",
  "@hellowork",
];

/** Job alerts and marketing in both languages. */
const EXCLUDE_SUBJECT_TERMS_EXTRA = [
  "webinaire",
  "job alert",
  "jobs for you",
  "new jobs",
  "alerte",
  "nouvelles offres",
  "offres pour vous",
  "recommand",
];

/** Lowercase without accents, so "Entretien prévu" matches "entretien prevu". */
export function normalizeForMatch(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

const subjectTerms = [...SUBJECT_TERMS, ...SUBJECT_TERMS_FR].map(
  normalizeForMatch,
);
const fromTerms = [...FROM_TERMS, ...FROM_TERMS_EXTRA].map(normalizeForMatch);
const excludeTerms = [
  ...EXCLUDE_SUBJECT_TERMS,
  ...EXCLUDE_SUBJECT_TERMS_EXTRA,
].map(normalizeForMatch);

/** Employer names usable for matching ("SII" yes, "AI" no). */
export function employerKeys(employers: readonly string[]): string[] {
  const keys = new Set<string>();
  for (const employer of employers) {
    const key = normalizeForMatch(employer)
      .replace(/\b(sas|sa|sarl|inc|ltd|gmbh|group|groupe)\b/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
    if (key.length >= 3) keys.add(key);
  }
  return [...keys];
}

/**
 * True when an email is likely about a job application: a recruiting
 * subject or sender, or a mention of an employer you applied to. Job
 * alerts and marketing are left out.
 */
export function isLikelyJobEmail(
  email: { fromAddress: string; senderName: string; subject: string },
  appliedEmployerKeys: readonly string[] = [],
): boolean {
  const subject = normalizeForMatch(email.subject);
  if (excludeTerms.some((term) => subject.includes(term))) return false;
  if (subjectTerms.some((term) => subject.includes(term))) return true;

  const from = normalizeForMatch(email.fromAddress);
  if (fromTerms.some((term) => from.includes(term))) return true;

  const haystack = normalizeForMatch(
    `${email.fromAddress} ${email.senderName} ${email.subject}`,
  ).replace(/[^a-z0-9]+/g, " ");
  return appliedEmployerKeys.some((key) =>
    ` ${haystack} `.includes(` ${key} `),
  );
}
