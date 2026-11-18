import { describe, expect, it } from "vitest";
import {
  classifyApplyLink,
  detectApplyRoutes,
  findApplyEmails,
} from "./apply-route";

describe("findApplyEmails", () => {
  it("finds apply-by-email instructions in English and French", () => {
    const { apply } = findApplyEmails(
      "**How to apply**\n\nShoot us an email at careers@acme.example with your resume.\n\nPour postuler\n\nEnvoie à hello@studio.example : une petite présentation",
    );
    expect(apply.map((item) => item.email)).toEqual([
      "careers@acme.example",
      "hello@studio.example",
    ]);
    expect(apply[0]?.evidence).toContain(
      "Shoot us an email at careers@acme.example",
    );
  });

  it("ignores accommodation, diversity, privacy and fraud addresses", () => {
    const result = findApplyEmails(
      [
        "If you need such an accommodation during the application process, please contact us at accommodations@big.example.",
        "Si vous avez besoin d'aménagements spécifiques pendant le processus de candidature, contactez job@robots.example.",
        "Should you require any adjustments contact us on Fr\\-diversity.recruitment@pharma.example",
        "To report a scam, notify our recruitment unit at hiring@bio.example",
        "mission handicap avec temps dédié : missionhandicap@consult.example",
      ].join("\n"),
    );
    expect(result.apply).toEqual([]);
    expect(result.other).toEqual([
      "accommodations@big.example",
      "job@robots.example",
      "fr-diversity.recruitment@pharma.example",
      "hiring@bio.example",
      "missionhandicap@consult.example",
    ]);
  });

  it("undoes markdown escapes and stops at glued words", () => {
    const { apply } = findApplyEmails(
      "How to apply: Email richie\\+hiring@med.example with your resume.\nSend application to: careers@labs.exampleSubject: Founding ML Engineer.",
    );
    expect(apply.map((item) => item.email)).toEqual([
      "richie+hiring@med.example",
      "careers@labs.example",
    ]);
  });

  it("keeps a named contact without apply wording as a contact", () => {
    const result = findApplyEmails(
      "For more info, please apply below or reach Laura at laura@agency.example",
    );
    expect(result.apply).toEqual([]);
    expect(result.contacts.map((item) => item.email)).toEqual([
      "laura@agency.example",
    ]);
  });
});

describe("classifyApplyLink", () => {
  it("names LinkedIn, job boards, application systems and company sites", () => {
    const label = (url: string) => {
      const route = classifyApplyLink(url);
      return route ? `${route.channel}:${route.label}` : null;
    };
    expect(label("https://www.linkedin.com/jobs/view/1")).toBe(
      "linkedin:LinkedIn",
    );
    expect(label("https://fr.indeed.com/viewjob?jk=1")).toBe(
      "job_board:Indeed",
    );
    expect(
      label("https://www.welcometothejungle.com/fr/companies/x/jobs/y"),
    ).toBe("job_board:Welcome to the Jungle");
    expect(label("https://jobs.ashbyhq.com/acme/1")).toBe("company_ats:Ashby");
    expect(label("https://acme.wd3.myworkdayjobs.com/en-US/x")).toBe(
      "company_ats:Workday",
    );
    expect(label("https://grnh.se/abc")).toBe("company_ats:Greenhouse");
    expect(label("https://careers.acme.example/jobs/1")).toBe(
      "company_site:Company website",
    );
    expect(label("not a url")).toBeNull();
  });
});

describe("detectApplyRoutes", () => {
  it("puts an explicit apply-by-email first, links after", () => {
    const routes = detectApplyRoutes({
      jobDescription:
        "How to Apply: Please send an email to Career@Astral.example or apply on LinkedIn.",
      applicationLink: "https://www.linkedin.com/jobs/view/1",
      jobUrl: "https://www.linkedin.com/jobs/view/1",
    });
    expect(routes.primary).toMatchObject({
      channel: "email",
      email: "career@astral.example",
    });
    expect(routes.alternatives.map((route) => route.label)).toEqual([
      "LinkedIn",
    ]);
  });

  it("prefers the company's own system over a job-board copy", () => {
    const routes = detectApplyRoutes({
      jobDescription: "Great role.",
      applicationLink: "https://jobs.lever.co/acme/1",
      jobUrl: "https://startup.jobs/acme-1",
    });
    expect(routes.primary?.label).toBe("Lever");
    expect(routes.alternatives.map((route) => route.label)).toEqual([
      "startup.jobs",
    ]);
  });

  it("labels LinkedIn Easy Apply and never makes a mere contact the primary route", () => {
    const routes = detectApplyRoutes({
      jobDescription:
        "Candidature simplifiée. Questions ? laura@agency.example",
      jobUrl: "https://www.linkedin.com/jobs/view/2",
    });
    expect(routes.primary?.label).toBe("LinkedIn Easy Apply");
    expect(routes.alternatives[0]).toMatchObject({
      label: "Contact named in the post",
      email: "laura@agency.example",
    });
  });

  it("returns no route when there is nothing to go on", () => {
    expect(
      detectApplyRoutes({ jobDescription: "", jobUrl: "" }).primary,
    ).toBeNull();
  });
});
