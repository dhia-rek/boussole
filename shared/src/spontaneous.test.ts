import { describe, expect, it } from "vitest";
import { isRecruitingContact } from "./spontaneous";
import type { OutreachContact } from "./types/spontaneous";

const contact = (overrides: Partial<OutreachContact>): OutreachContact => ({
  kind: "email",
  value: "someone@acme.example",
  name: null,
  title: null,
  sourceUrl: null,
  check: "not_checked",
  origin: "hunter",
  confidence: 90,
  ...overrides,
});

describe("isRecruitingContact", () => {
  it("accepts verified web addresses, recruiting addresses and recruiting titles", () => {
    expect(
      isRecruitingContact(contact({ origin: "web", check: "verified" })),
    ).toBe(true);
    expect(
      isRecruitingContact(contact({ value: "recrutement@acme.example" })),
    ).toBe(true);
    expect(
      isRecruitingContact(contact({ title: "Senior Talent Acquisition" })),
    ).toBe(true);
    expect(isRecruitingContact(contact({ title: "Head of People" }))).toBe(
      true,
    );
    expect(isRecruitingContact(contact({ title: "Chargée RH" }))).toBe(true);
  });

  it("keeps founders, executives and other teams out of the default list", () => {
    for (const title of [
      "Co-Founder",
      "CEO",
      "CTO",
      "CMO",
      "Product Director",
    ]) {
      expect(isRecruitingContact(contact({ title }))).toBe(false);
    }
    expect(
      isRecruitingContact(
        contact({ kind: "careers_page", value: "https://acme.example" }),
      ),
    ).toBe(false);
  });
});
