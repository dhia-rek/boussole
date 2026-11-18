/**
 * Finding where to send a spontaneous application: web research on the
 * person's own AI account, then Boussole re-reads every cited page itself.
 * An email address counts only if it is written on the page it came from;
 * addresses are never guessed from name patterns.
 */
import { isRecruitingContact, RECRUITING_ADDRESS } from "@shared/spontaneous";
import type {
  OutreachContact,
  OutreachContactKind,
  OutreachFact,
} from "@shared/types";
import {
  type PageReader,
  quoteAppearsIn,
  readPublicPage,
} from "../company-research/quote-check";

export const MAX_CONTACTS = 10;
export const MAX_FACTS = 6;

const CONTACT_KINDS: readonly OutreachContactKind[] = [
  "email",
  "application_form",
  "careers_page",
  "linkedin_person",
];

export const CONTACTS_JSON_SCHEMA = {
  type: "object",
  properties: {
    website: { type: "string", description: "The company's main website." },
    summary: {
      type: "string",
      description: "Two sentences: what the company does and for whom.",
    },
    facts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          claim: { type: "string" },
          source_url: { type: "string" },
          quote: { type: "string" },
        },
        required: ["claim", "source_url", "quote"],
        additionalProperties: false,
      },
    },
    contacts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: [...CONTACT_KINDS] },
          value: {
            type: "string",
            description:
              "The email address, or the page URL for forms, careers pages and LinkedIn profiles.",
          },
          name: { type: "string" },
          title: { type: "string" },
          source_url: {
            type: "string",
            description: "The page where you read this contact.",
          },
        },
        required: ["kind", "value", "name", "title", "source_url"],
        additionalProperties: false,
      },
    },
  },
  required: ["website", "summary", "facts", "contacts"],
  additionalProperties: false,
} as const;

export function buildContactsPrompt(company: string, website: string | null) {
  return `
A candidate wants to send a spontaneous application (candidature spontanée) to this company. Search the web and open the pages you rely on.

Company: ${company}${website ? `\nWebsite (given by the candidate): ${website}` : ""}

Find:
1. Where to send it, best first:
   - "email": recruiting addresses published on a public page (careers page, contact page, legal notice, job posts), such as recrutement@, rh@, jobs@, careers@, talent@. ONLY addresses written on a page you opened. Never guess or build an address from a name or a pattern.
   - "application_form": a spontaneous application form or "open application" page.
   - "careers_page": the company's careers / jobs page.
   - "linkedin_person": up to 3 people in recruiting, talent acquisition or HR at this company, with the URL of their LinkedIn profile, their name and title as shown there.
2. Up to ${MAX_FACTS} short facts about the company useful in an application email (what it does, products, customers, recent news), each with the page and a quote copied character for character from it (8 to 40 words).

Rules:
- If several companies share this name, use the website given (if any) to pick the right one.
- "source_url" is the page where you read the contact or quote.
- Use "" for unknown name/title.
- Write summary and claims in French if the company is French, otherwise in English.
- Answer with the JSON object only.
`.trim();
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

const EMAIL_SHAPE = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,24}$/i;
/** Addresses that are not a way to apply. */
const NOT_A_RECRUITING_ADDRESS =
  /^(no-?reply|donotreply|privacy|dpo|rgpd|gdpr|abuse|security|legal|press|presse|invest|ir|accessibility|accessibilite|unsubscribe)([._+-]|@)/i;
export type RawContacts = {
  website: string | null;
  summary: string;
  facts: Array<{ claim: string; sourceUrl: string; quote: string }>;
  contacts: Array<Omit<OutreachContact, "check" | "origin" | "confidence">>;
};

export function normalizeContactsOutput(value: unknown): RawContacts {
  const record =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const website = str(record.website);
  const facts: RawContacts["facts"] = [];
  for (const item of Array.isArray(record.facts) ? record.facts : []) {
    const fact = (item ?? {}) as Record<string, unknown>;
    const sourceUrl = str(fact.source_url ?? fact.sourceUrl);
    const claim = str(fact.claim).slice(0, 400);
    const quote = str(fact.quote).slice(0, 400);
    if (!claim || !quote || !isHttpUrl(sourceUrl)) continue;
    facts.push({ claim, sourceUrl, quote });
    if (facts.length >= MAX_FACTS) break;
  }
  const contacts: RawContacts["contacts"] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(record.contacts) ? record.contacts : []) {
    const contact = (item ?? {}) as Record<string, unknown>;
    const kind = str(contact.kind) as OutreachContactKind;
    if (!CONTACT_KINDS.includes(kind)) continue;
    let contactValue = str(contact.value).replace(/^mailto:/i, "");
    if (kind === "email") {
      contactValue = contactValue.toLowerCase();
      if (!EMAIL_SHAPE.test(contactValue)) continue;
      if (NOT_A_RECRUITING_ADDRESS.test(contactValue)) continue;
    } else if (!isHttpUrl(contactValue)) {
      continue;
    }
    if (seen.has(contactValue)) continue;
    seen.add(contactValue);
    const sourceUrl = str(contact.source_url ?? contact.sourceUrl);
    contacts.push({
      kind,
      value: contactValue,
      name: str(contact.name) || null,
      title: str(contact.title) || null,
      sourceUrl: isHttpUrl(sourceUrl) ? sourceUrl : null,
    });
  }
  return {
    website: isHttpUrl(website) ? website : null,
    summary: str(record.summary).slice(0, 700),
    facts,
    contacts,
  };
}

const isLinkedIn = (url: string | null) =>
  Boolean(url && /(^|\.)linkedin\.com$/i.test(safeHost(url)));

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/** Boussole re-reads the cited pages: addresses must be on them, pages must load. */
export async function verifyContacts(
  raw: RawContacts,
  readPage: PageReader = readPublicPage,
): Promise<{ contacts: OutreachContact[]; facts: OutreachFact[] }> {
  const pages = new Map<string, Promise<string | null>>();
  const read = (url: string) => {
    if (!pages.has(url)) pages.set(url, readPage(url));
    return pages.get(url) as Promise<string | null>;
  };

  const contacts = await Promise.all(
    raw.contacts.map(async (contact): Promise<OutreachContact> => {
      const base = { ...contact, origin: "web" as const, confidence: null };
      if (contact.kind === "linkedin_person" || isLinkedIn(contact.value)) {
        return { ...base, check: "not_checked" };
      }
      if (contact.kind === "email") {
        if (!contact.sourceUrl) return { ...base, check: "unreachable" };
        const page = await read(contact.sourceUrl);
        if (page === null) return { ...base, check: "unreachable" };
        return {
          ...base,
          check: page.toLowerCase().includes(contact.value)
            ? "verified"
            : "not_found",
        };
      }
      const page = await read(contact.value);
      return { ...base, check: page === null ? "unreachable" : "verified" };
    }),
  );

  const facts = await Promise.all(
    raw.facts.map(async (fact): Promise<OutreachFact> => {
      const page = await read(fact.sourceUrl);
      if (page === null) return { ...fact, check: "unreachable" };
      return {
        ...fact,
        check: quoteAppearsIn(fact.quote, page) ? "verified" : "not_found",
      };
    }),
  );

  return { contacts, facts };
}

const CHECK_RANK = {
  verified: 0,
  not_checked: 1,
  unreachable: 2,
  not_found: 3,
};
const KIND_RANK = {
  email: 0,
  application_form: 1,
  careers_page: 2,
  linkedin_person: 3,
};

/**
 * Best first: verified recruiting addresses, then forms and careers pages,
 * then people. Addresses the page did not contain are dropped: they were
 * guesses.
 */
export function rankContacts(contacts: OutreachContact[]): OutreachContact[] {
  const score = (contact: OutreachContact) =>
    CHECK_RANK[contact.check] * 10 +
    KIND_RANK[contact.kind] +
    (contact.kind === "email" && RECRUITING_ADDRESS.test(contact.value)
      ? -0.5
      : 0) +
    (contact.origin === "hunter" ? 4 : 0) +
    (contact.kind === "email" && !isRecruitingContact(contact) ? 20 : 0);
  return contacts
    .filter(
      (contact) => !(contact.kind === "email" && contact.check === "not_found"),
    )
    .sort((a, b) => score(a) - score(b))
    .slice(0, MAX_CONTACTS);
}
