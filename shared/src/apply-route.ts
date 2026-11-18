/**
 * How to apply to a job: by email (when the posting says so), on LinkedIn, on
 * a job board, or on the company's own application system. Read from the job
 * description and links only — deterministic, no AI.
 */

export type ApplyChannel =
  | "email"
  | "linkedin"
  | "job_board"
  | "company_ats"
  | "company_site";

export interface ApplyRoute {
  channel: ApplyChannel;
  /** "LinkedIn", "Welcome to the Jungle", "Workday", "Email"… */
  label: string;
  url: string | null;
  email: string | null;
  /** The sentence of the posting that names this route, when there is one. */
  evidence: string | null;
}

export interface ApplyRoutes {
  primary: ApplyRoute | null;
  /** Other ways the posting mentions, best first. */
  alternatives: ApplyRoute[];
  /** Addresses for something else (accommodations, privacy, fraud…), never to apply. */
  otherContacts: string[];
}

export interface ApplyRouteJobFields {
  jobDescription?: string | null;
  applicationLink?: string | null;
  jobUrlDirect?: string | null;
  jobUrl?: string | null;
}

const JOB_BOARDS: Array<[RegExp, string]> = [
  [/(^|\.)welcometothejungle\.com$/, "Welcome to the Jungle"],
  [/(^|\.)indeed\.[a-z.]+$/, "Indeed"],
  [/(^|\.)glassdoor\.[a-z.]+$/, "Glassdoor"],
  [/(^|\.)hellowork\.com$/, "HelloWork"],
  [/(^|\.)apec\.fr$/, "APEC"],
  [/(^|\.)(francetravail|pole-emploi)\.fr$/, "France Travail"],
  [/(^|\.)jobteaser\.com$/, "JobTeaser"],
  [/(^|\.)startup\.jobs$/, "startup.jobs"],
  [/(^|\.)hiring\.cafe$/, "Hiring Cafe"],
  [/(^|\.)wellfound\.com$/, "Wellfound"],
  [/(^|\.)adzuna\.[a-z.]+$/, "Adzuna"],
  [/(^|\.)workingnomads\.com$/, "Working Nomads"],
  [/(^|\.)golangjobs\.tech$/, "golangjobs"],
  [/(^|\.)monster\.[a-z.]+$/, "Monster"],
  [/(^|\.)cadremploi\.fr$/, "Cadremploi"],
];

const ATS: Array<[RegExp, string]> = [
  [/myworkdayjobs\.com$|(^|\.)workday\.com$/, "Workday"],
  [/(^|\.)greenhouse\.io$|(^|\.)grnh\.se$/, "Greenhouse"],
  [/(^|\.)lever\.co$/, "Lever"],
  [/(^|\.)smartrecruiters\.com$/, "SmartRecruiters"],
  [/(^|\.)teamtailor\.com$/, "Teamtailor"],
  [/(^|\.)workable\.com$/, "Workable"],
  [/(^|\.)ashbyhq\.com$/, "Ashby"],
  [/(^|\.)recruitee\.com$/, "Recruitee"],
  [/(^|\.)jobvite\.com$/, "Jobvite"],
  [/(^|\.)icims\.com$/, "iCIMS"],
  [/(^|\.)taleo\.net$/, "Taleo"],
  [/successfactors\.(com|eu)$|(^|\.)sapsf\.(com|eu)$/, "SuccessFactors"],
  [/(^|\.)breezy\.hr$/, "Breezy"],
  [/(^|\.)personio\.[a-z]+$/, "Personio"],
  [/(^|\.)flatchr\.io$/, "Flatchr"],
  [/(^|\.)digitalrecruiters\.com$/, "DigitalRecruiters"],
  [/(^|\.)talent-soft\.com$|(^|\.)cegid\.com$/, "Cegid Talentsoft"],
  [/(^|\.)recruiterflow\.com$/, "Recruiterflow"],
  [/(^|\.)ripplehire\.com$/, "RippleHire"],
  [/(^|\.)welcomekit\.co$/, "Welcome Kit"],
];

/** Words just before an address that say "this is how you apply". */
const APPLY_INTENT =
  /how to apply|to apply|apply by|postuler|(envoie[sz]?|envoyez|adresse[sz]?|transmet(s|tez)) (nous )?(votre |ta )?candidature|candidature (à|par (e-?)?mail)|send (us )?(your )?(cv|resume|résumé|application)|send (an )?e-?mail|send application|shoot us an e-?mail|e-?mail us|email (it )?to|write to us|envoie[sz]?\b|envoyez|adresse[sz]? (votre|ton)|à l'adresse|cv (et|and) (lettre|cover)/i;

/** Words that make an address something other than an application route. */
const NOT_APPLY =
  /accommodat|accomodat|aménagement|amenagement|handicap|disabilit|diversity|adjustment|accessib|privacy|confidentialité|données personnelles|personal data|rgpd|gdpr|\bdpo\b|fraud|scam|phishing|technical difficult|issues, concerns|unsubscribe/i;

/** Index just after the last match of `pattern` in `text`, or -1. */
function lastMatchEnd(pattern: RegExp, text: string): number {
  const global = new RegExp(pattern.source, "gi");
  let end = -1;
  for (const match of text.matchAll(global)) {
    end = (match.index ?? 0) + match[0].length;
  }
  return end;
}

type EmailPurpose = "apply" | "contact" | "other";

/**
 * What an address in a posting is for. The wording closest before it decides
 * ("send your CV to…" vs "if you need an accommodation…"); when nothing
 * before it is conclusive, the next sentence after it may be ("…: send an
 * email with your CV").
 */
function emailPurpose(
  before: string,
  after: string,
  email: string,
): EmailPurpose {
  if (NOT_APPLY.test(email)) return "other";
  const applyAt = lastMatchEnd(APPLY_INTENT, before);
  const notApplyAt = lastMatchEnd(NOT_APPLY, before);
  if (notApplyAt > applyAt) return "other";
  if (NOT_APPLY.test(after)) return "other";
  if (applyAt >= 0 || APPLY_INTENT.test(after)) return "apply";
  return "contact";
}

const EMAIL_PATTERN =
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[a-z]{2,24}(?![a-z])/g;
const IGNORED_LOCAL_PARTS = /^(no-?reply|donotreply|do-not-reply|example)$/i;

/** Undoes markdown escapes ("richie\+hiring@", "e\-mail") in scraped text. */
function unescapeMarkdown(text: string): string {
  return text.replace(/\\([\\`*_{}[\]()#+\-.!|])/g, "$1");
}

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** The line around a match, at most 160 chars before and 100 after. */
function clipSentence(text: string, index: number, length: number): string {
  const lineStart = text.lastIndexOf("\n", index) + 1;
  const lineEndRaw = text.indexOf("\n", index + length);
  const lineEnd = lineEndRaw === -1 ? text.length : lineEndRaw;
  const start = Math.max(lineStart, index - 160);
  const end = Math.min(lineEnd, index + length + 100);
  const sentence = text
    .slice(start, end)
    .replace(/[*_#>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return `${start > lineStart ? "…" : ""}${sentence}${end < lineEnd ? "…" : ""}`;
}

export function classifyApplyLink(
  url: string | null | undefined,
): ApplyRoute | null {
  const host = hostOf(url);
  if (!host || !url) return null;
  if (/(^|\.)linkedin\.com$/.test(host)) {
    return {
      channel: "linkedin",
      label: "LinkedIn",
      url,
      email: null,
      evidence: null,
    };
  }
  for (const [pattern, label] of JOB_BOARDS) {
    if (pattern.test(host)) {
      return { channel: "job_board", label, url, email: null, evidence: null };
    }
  }
  for (const [pattern, label] of ATS) {
    if (pattern.test(host)) {
      return {
        channel: "company_ats",
        label,
        url,
        email: null,
        evidence: null,
      };
    }
  }
  return {
    channel: "company_site",
    label: "Company website",
    url,
    email: null,
    evidence: null,
  };
}

/** Addresses in a job description, split into "apply here" and everything else. */
export function findApplyEmails(description: string | null | undefined): {
  apply: Array<{ email: string; evidence: string }>;
  contacts: Array<{ email: string; evidence: string }>;
  other: string[];
} {
  const text = unescapeMarkdown(description ?? "");
  const apply: Array<{ email: string; evidence: string }> = [];
  const contacts: Array<{ email: string; evidence: string }> = [];
  const other: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(EMAIL_PATTERN)) {
    const email = match[0].toLowerCase();
    const index = match.index ?? 0;
    if (seen.has(email)) continue;
    seen.add(email);
    if (IGNORED_LOCAL_PARTS.test(email.split("@")[0] ?? "")) continue;
    const before = text.slice(Math.max(0, index - 400), index);
    const after = text.slice(
      index + match[0].length,
      index + match[0].length + 120,
    );
    const evidence = clipSentence(text, index, match[0].length);
    const purpose = emailPurpose(before, after, email);
    if (purpose === "other") other.push(email);
    else if (purpose === "apply") apply.push({ email, evidence });
    else contacts.push({ email, evidence });
  }
  return { apply, contacts, other };
}

const EASY_APPLY = /easy apply|candidature simplifiée/i;

export function detectApplyRoutes(job: ApplyRouteJobFields): ApplyRoutes {
  const routes: ApplyRoute[] = [];
  const { apply, contacts, other } = findApplyEmails(job.jobDescription);
  for (const { email, evidence } of apply) {
    routes.push({
      channel: "email",
      label: "Email",
      url: null,
      email,
      evidence,
    });
  }

  const seenUrls = new Set<string>();
  for (const url of [job.applicationLink, job.jobUrlDirect, job.jobUrl]) {
    const route = classifyApplyLink(url);
    if (!route?.url) continue;
    const key = `${route.channel}:${hostOf(route.url)}`;
    if (seenUrls.has(key)) continue;
    seenUrls.add(key);
    if (
      route.channel === "linkedin" &&
      EASY_APPLY.test(job.jobDescription ?? "")
    ) {
      route.label = "LinkedIn Easy Apply";
    }
    routes.push(route);
  }

  for (const { email, evidence } of contacts) {
    routes.push({
      channel: "email",
      label: "Contact named in the post",
      url: null,
      email,
      evidence,
    });
  }

  // An explicit "send your CV to…" beats any link. Otherwise prefer the
  // company's own system over a board or LinkedIn copy of the posting.
  const rank = (route: ApplyRoute): number => {
    if (route.channel === "email") return route.label === "Email" ? 0 : 9;
    if (route.channel === "company_ats") return 1;
    if (route.channel === "company_site") return 2;
    if (route.channel === "linkedin") return 3;
    return 4;
  };
  const sorted = routes
    .map((route, order) => ({ route, order }))
    .sort((a, b) => rank(a.route) - rank(b.route) || a.order - b.order)
    .map(({ route }) => route);
  const primary = sorted.find((route) => rank(route) < 9) ?? null;
  return {
    primary,
    alternatives: sorted.filter((route) => route !== primary),
    otherContacts: other,
  };
}
