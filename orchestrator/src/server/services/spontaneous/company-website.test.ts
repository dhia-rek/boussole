import { companyWebsiteOrNull } from "@shared/spontaneous";
import { describe, expect, it } from "vitest";

describe("companyWebsiteOrNull", () => {
  it("keeps a company's own site", () => {
    expect(companyWebsiteOrNull("https://www.withings.com/fr/en/")).toBe(
      "https://withings.com",
    );
    expect(companyWebsiteOrNull("mistral.ai")).toBe("https://mistral.ai");
  });

  it("drops job boards, LinkedIn pages and broken links stored by job sources", () => {
    for (const value of [
      "https://fr.linkedin.com/company/driveco",
      "https://www.linkedin.com/company/deloitte",
      "https://fr.indeed.comNone",
      "https://startup.jobs/company/%7B%7B%7Bslug%7D%7D%7D",
      "https://startup.jobs/company/{{{slug}}}",
      "https://www.welcometothejungle.com/fr/companies/acme",
      "https://jobs.ashbyhq.com/mistral.ai",
      "not a url",
      "",
      null,
    ]) {
      expect(companyWebsiteOrNull(value), String(value)).toBeNull();
    }
  });
});
