import type { CompanyResearchFactCheck } from "./company-research";

/** Where a spontaneous application can go. */
export type OutreachContactKind =
  | "email"
  | "application_form"
  | "careers_page"
  | "linkedin_person";

/**
 * - verified: Boussole opened the source page and found the address there
 *   (for pages: the page exists and loads)
 * - not_found: the page loaded but the address is not on it
 * - unreachable: the page could not be read
 * - not_checked: LinkedIn (blocks automated reads) or Hunter.io estimates
 */
export type OutreachContactCheck =
  | "verified"
  | "not_found"
  | "unreachable"
  | "not_checked";

export interface OutreachContact {
  kind: OutreachContactKind;
  /** An email address, or the page URL for forms, careers pages and LinkedIn. */
  value: string;
  name: string | null;
  title: string | null;
  sourceUrl: string | null;
  check: OutreachContactCheck;
  origin: "web" | "hunter";
  /** Hunter.io confidence (0-100), null for web results. */
  confidence: number | null;
}

export interface OutreachFact {
  claim: string;
  sourceUrl: string;
  quote: string;
  check: CompanyResearchFactCheck;
}

export interface OutreachEmail {
  recipient: string | null;
  recipientName: string | null;
  targetRole: string | null;
  language: "fr" | "en";
  subject: string;
  body: string;
  /** Numbers, tools or names in the email found neither in the CV nor in the verified facts. */
  unsupportedTerms: string[];
}

export type SpontaneousOutreachStatus = "researching" | "ready" | "failed";

export interface SpontaneousOutreach {
  id: string;
  company: string;
  website: string | null;
  status: SpontaneousOutreachStatus;
  summary: string | null;
  facts: OutreachFact[];
  contacts: OutreachContact[];
  error: string | null;
  email: OutreachEmail | null;
  /** The job created on the Applications board once the email was sent. */
  jobId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A company worth a spontaneous application, from the person's own jobs. */
export interface SpontaneousSuggestion {
  company: string;
  website: string | null;
  jobCount: number;
  bestScore: number | null;
}
