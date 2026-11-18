import { describe, expect, it } from "vitest";
import { buildGmailQuery } from "./gmail-api";
import { employerKeys, isLikelyJobEmail } from "./job-email-filter";

const email = (subject: string, fromAddress = "someone@example.com") => ({
  fromAddress,
  senderName: "",
  subject,
});

describe("isLikelyJobEmail", () => {
  it("keeps French and English application emails", () => {
    for (const subject of [
      "Votre candidature chez Acme",
      "Invitation à un entretien - Data Engineer",
      "Nous ne pouvons pas donner suite à votre candidature",
      "Votre profil a retenu notre attention",
      "Thank you for applying to Acme",
      "Interview availability",
    ]) {
      expect(isLikelyJobEmail(email(subject)), subject).toBe(true);
    }
  });

  it("matches without accents or case", () => {
    expect(isLikelyJobEmail(email("ENTRETIEN PRÉVU"))).toBe(true);
    expect(
      isLikelyJobEmail(email("Votre candidature n'a pas été retenue")),
    ).toBe(true);
  });

  it("leaves out job alerts, newsletters and everyday mail", () => {
    for (const subject of [
      "Nouvelles offres pour vous : Data Engineer",
      "Job alert: 12 new jobs for you",
      "Our newsletter - November",
      "Your order has shipped",
      "Facture de novembre",
    ]) {
      expect(isLikelyJobEmail(email(subject)), subject).toBe(false);
    }
  });

  it("keeps recruiting senders and hiring tools whatever the subject", () => {
    expect(isLikelyJobEmail(email("Hello", "recrutement@acme.fr"))).toBe(true);
    expect(
      isLikelyJobEmail(email("Next steps", "no-reply@teamtailor.com")),
    ).toBe(true);
  });

  it("keeps replies from employers you applied to, by whole word", () => {
    const keys = employerKeys(["Groupe SII", "AI", "Alan"]);
    expect(keys).toEqual(["sii", "alan"]);
    expect(
      isLikelyJobEmail(
        {
          fromAddress: "marie@sii.fr",
          senderName: "Marie",
          subject: "Re: notre échange",
        },
        keys,
      ),
    ).toBe(true);
    expect(
      isLikelyJobEmail(
        { fromAddress: "news@siim.com", senderName: "", subject: "Promo" },
        keys,
      ),
    ).toBe(false);
  });
});

describe("Gmail search query", () => {
  it("still uses the English terms only", () => {
    const query = buildGmailQuery(30);
    expect(query.startsWith('newer_than:30d ((subject:"application"')).toBe(
      true,
    );
    expect(query).not.toContain("candidature");
    expect(query).toContain('-subject:"newsletter"');
  });
});
