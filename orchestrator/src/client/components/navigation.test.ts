import { describe, expect, it } from "vitest";
import {
  isNavActive,
  MOBILE_TAB_LINKS,
  NAV_GROUPS,
  NAV_LINKS,
  SETTINGS_LINK,
} from "./navigation";

describe("navigation", () => {
  it("groups every page by job-search step, with settings last", () => {
    expect(NAV_GROUPS.map((group) => group.label)).toEqual([
      null,
      "Find",
      "Apply",
      "Profile",
      "Insights",
    ]);
    expect(NAV_LINKS.at(-1)).toBe(SETTINGS_LINK);
    expect(NAV_LINKS.map((link) => link.to)).toEqual([
      "/today",
      "/jobs/ready",
      "/spontaneous",
      "/applications/in-progress",
      "/tracking-inbox",
      "/design-resume",
      "/overview",
      "/tracer-links",
      "/ai-activity",
      "/settings",
    ]);
  });

  it("keeps the phone tab bar to the most used pages", () => {
    expect(MOBILE_TAB_LINKS.map((link) => link.label)).toEqual([
      "Today",
      "Jobs",
      "Applications",
      "CV",
    ]);
  });

  it("marks Jobs active on every jobs tab and on a job page", () => {
    const jobs = NAV_LINKS.find((link) => link.label === "Jobs");
    if (!jobs) throw new Error("missing Jobs link");
    for (const path of ["/jobs/ready", "/jobs/discovered/abc", "/job/42"]) {
      expect(isNavActive(path, jobs.to, jobs.activePaths)).toBe(true);
    }
    expect(isNavActive("/jobsearch", jobs.to, jobs.activePaths)).toBe(false);
    expect(isNavActive("/today", jobs.to, jobs.activePaths)).toBe(false);
  });
});
