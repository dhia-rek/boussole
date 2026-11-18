import type { OutreachContact, SpontaneousOutreach } from "@shared/types";
import { describe, expect, it, vi } from "vitest";
import {
  normalizeContactsOutput,
  rankContacts,
  verifyContacts,
} from "./contacts";
import { buildEmailPrompt } from "./email";
import { domainOf, lookupHunterContacts } from "./hunter";

const RAW = {
  website: "https://acme.example",
  summary: "Acme builds payment software for banks.",
  facts: [
    {
      claim: "Acme serves 300 banks.",
      source_url: "https://acme.example/about",
      quote: "Acme serves 300 European banks",
    },
    {
      claim: "Acme is huge.",
      source_url: "https://acme.example/about",
      quote: "Acme employs 90,000 people worldwide",
    },
  ],
  contacts: [
    {
      kind: "email",
      value: "mailto:Recrutement@Acme.example",
      name: "",
      title: "",
      source_url: "https://acme.example/careers",
    },
    {
      kind: "email",
      value: "guessed.person@acme.example",
      name: "Guessed Person",
      title: "HR",
      source_url: "https://acme.example/careers",
    },
    {
      kind: "email",
      value: "privacy@acme.example",
      name: "",
      title: "",
      source_url: "https://acme.example/legal",
    },
    {
      kind: "application_form",
      value: "https://acme.example/open-application",
      name: "",
      title: "",
      source_url: "https://acme.example/careers",
    },
    {
      kind: "linkedin_person",
      value: "https://www.linkedin.com/in/someone",
      name: "Sam Recruiter",
      title: "Talent Acquisition",
      source_url: "https://www.linkedin.com/in/someone",
    },
    {
      kind: "careers_page",
      value: "not a url",
      name: "",
      title: "",
      source_url: "",
    },
    { kind: "fax", value: "123", name: "", title: "", source_url: "" },
  ],
};

const PAGES: Record<string, string> = {
  "https://acme.example/careers":
    "Join us! Send your CV to recrutement@acme.example.",
  "https://acme.example/about": "Today Acme serves 300 European banks.",
  "https://acme.example/open-application": "Open application form",
};

describe("spontaneous contacts", () => {
  it("keeps only plausible contacts and never non-recruiting addresses", () => {
    const raw = normalizeContactsOutput(RAW);
    expect(raw.website).toBe("https://acme.example");
    expect(raw.contacts.map((c) => `${c.kind}:${c.value}`)).toEqual([
      "email:recrutement@acme.example",
      "email:guessed.person@acme.example",
      "application_form:https://acme.example/open-application",
      "linkedin_person:https://www.linkedin.com/in/someone",
    ]);
  });

  it("verifies addresses on their page, drops guesses, never checks LinkedIn", async () => {
    const readPage = vi.fn(async (url: string) => PAGES[url] ?? null);
    const { contacts, facts } = await verifyContacts(
      normalizeContactsOutput(RAW),
      readPage,
    );
    expect(contacts.map((c) => c.check)).toEqual([
      "verified",
      "not_found",
      "verified",
      "not_checked",
    ]);
    expect(facts.map((f) => f.check)).toEqual(["verified", "not_found"]);
    // The careers page is read once even though two contacts cite it.
    expect(
      readPage.mock.calls.filter(([u]) => u === "https://acme.example/careers"),
    ).toHaveLength(1);

    const ranked = rankContacts(contacts);
    expect(ranked.map((c) => c.value)).toEqual([
      "recrutement@acme.example",
      "https://acme.example/open-application",
      "https://www.linkedin.com/in/someone",
    ]);
  });

  it("ranks Hunter estimates after verified web results", () => {
    const hunter: OutreachContact = {
      kind: "email",
      value: "jane@acme.example",
      name: "Jane",
      title: "Head of People",
      sourceUrl: null,
      check: "not_checked",
      origin: "hunter",
      confidence: 97,
    };
    const web: OutreachContact = {
      ...hunter,
      value: "jobs@acme.example",
      check: "verified",
      origin: "web",
      confidence: null,
    };
    expect(rankContacts([hunter, web]).map((c) => c.value)).toEqual([
      "jobs@acme.example",
      "jane@acme.example",
    ]);
  });
});

describe("Hunter.io", () => {
  it("maps HR people first and sends only the domain", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: {
          emails: [
            { value: "CTO@acme.example", confidence: 99, position: "CTO" },
            { value: "low@acme.example", confidence: 30, position: "HR" },
            {
              value: "people@acme.example",
              confidence: 80,
              first_name: "Pat",
              position: "Head of People",
            },
          ],
        },
      }),
    })) as unknown as typeof fetch;
    const contacts = await lookupHunterContacts("acme.example", "k", fetchImpl);
    expect(contacts.map((c) => c.value)).toEqual([
      "people@acme.example",
      "cto@acme.example",
    ]);
    expect(contacts[0]).toMatchObject({
      origin: "hunter",
      check: "not_checked",
    });
    const url = String(vi.mocked(fetchImpl).mock.calls[0]?.[0]);
    expect(url).toContain("domain=acme.example");
  });

  it("reads a domain from a website or a bare host", () => {
    expect(domainOf("https://www.acme.example/fr/careers")).toBe(
      "acme.example",
    );
    expect(domainOf("acme.example")).toBe("acme.example");
    expect(domainOf(null)).toBeNull();
  });
});

describe("spontaneous email prompt", () => {
  it("gives the model only verified facts and the CV lines", () => {
    const outreach = {
      company: "Acme",
      summary: "Payments for banks.",
      facts: [
        {
          claim: "Acme serves 300 banks.",
          sourceUrl: "x",
          quote: "q",
          check: "verified",
        },
        {
          claim: "Acme is huge.",
          sourceUrl: "x",
          quote: "q",
          check: "not_found",
        },
      ],
    } as unknown as SpontaneousOutreach;
    const prompt = buildEmailPrompt({
      outreach,
      request: {
        recipient: "jobs@acme.example",
        recipientName: "Pat",
        targetRole: "Data Engineer",
        language: "fr",
      },
      candidateName: "Sam Doe",
      cvLines: ["Acme Corp — Data Engineer: Built Airflow pipelines"],
    });
    expect(prompt).toContain("Acme serves 300 banks.");
    expect(prompt).not.toContain("Acme is huge.");
    expect(prompt).toContain("Built Airflow pipelines");
    expect(prompt).toContain("addressed to Pat");
    expect(prompt).toContain("Vous trouverez mon CV en pièce jointe");
  });
});
