import {
  formatCountryLabel,
  normalizeCountryKey,
} from "@shared/location-support.js";
import { resolveSearchCities } from "@shared/search-cities.js";
import type { CreateJobInput } from "@shared/types/jobs";
import {
  type ScrapeOptions,
  type StartupJobRecord,
  scrapeStartupJobsViaAlgolia,
} from "startup-jobs-scraper";

export type StartupJobsProgressEvent =
  | {
      type: "term_start";
      termIndex: number;
      termTotal: number;
      searchTerm: string;
      location?: string;
    }
  | {
      type: "term_complete";
      termIndex: number;
      termTotal: number;
      searchTerm: string;
      location?: string;
      jobsFoundTerm: number;
    };

export interface RunStartupJobsOptions {
  searchTerms?: string[];
  selectedCountry?: string;
  locations?: string[];
  workplaceTypes?: Array<"remote" | "hybrid" | "onsite">;
  maxJobsPerTerm?: number;
  onProgress?: (event: StartupJobsProgressEvent) => void;
  shouldCancel?: () => boolean;
}

export interface StartupJobsResult {
  success: boolean;
  jobs: CreateJobInput[];
  error?: string;
}

type StartupJobsWorkplaceType = "remote" | "hybrid" | "on-site";

function mapWorkplaceTypes(
  workplaceTypes: Array<"remote" | "hybrid" | "onsite"> | undefined,
): StartupJobsWorkplaceType[] | undefined {
  if (!workplaceTypes || workplaceTypes.length === 0) return undefined;

  return workplaceTypes.map((workplaceType) =>
    workplaceType === "onsite" ? "on-site" : workplaceType,
  );
}

function toPositiveIntOrFallback(
  value: number | string | undefined,
  fallback: number,
): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : Number.NaN;

  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.floor(parsed));
}

function inferJobType(disciplines: string | undefined): string | undefined {
  if (!disciplines) return undefined;
  const segments = disciplines
    .split("|")
    .map((value) => value.trim())
    .filter(Boolean);
  return segments.length > 1 ? segments[segments.length - 1] : undefined;
}

/**
 * Link/button captions that startup.jobs renders next to the company and that
 * the scraper's detail-page enrichment can mistake for the employer name
 * (it reads the text of the *last* `/company/...` anchor on the page — since
 * late 2026 that anchor is a "View company profile" link).
 */
const PLACEHOLDER_EMPLOYER_PATTERNS: RegExp[] = [
  /^(view|see|visit|open|voir)\b.*\b(company|profile|employer|entreprise|profil)\b/i,
  /^(company|employer)\s+(profile|page)$/i,
  /^unknown\s+(employer|company)$/i,
  /^\{\{\{.*\}\}\}$/,
];

export function isPlaceholderEmployer(value: string | undefined): boolean {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  if (!normalized) return true;
  return PLACEHOLDER_EMPLOYER_PATTERNS.some((pattern) =>
    pattern.test(normalized),
  );
}

/** "acme-robotics" (from https://startup.jobs/company/acme-robotics) → "Acme Robotics" */
function employerFromCompanyProfileUrl(
  employerUrl: string | undefined,
): string | undefined {
  if (!employerUrl) return undefined;
  try {
    const url = new URL(employerUrl);
    if (!/(^|\.)startup\.jobs$/i.test(url.hostname)) return undefined;
    const match = url.pathname.match(/^\/company\/([^/?#]+)/i);
    const slug = match?.[1] ? decodeURIComponent(match[1]) : "";
    const words = slug.split(/[-_]+/).filter(Boolean);
    if (words.length === 0) return undefined;
    return words
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  } catch {
    return undefined;
  }
}

/**
 * Replaces placeholder employers (see PLACEHOLDER_EMPLOYER_PATTERNS) using,
 * in order: the employer from the listing-only Algolia record for the same
 * job URL, a name derived from a startup.jobs company profile URL, and
 * finally "Unknown Employer" — never a UI caption.
 */
export function repairStartupJobEmployers(
  records: StartupJobRecord[],
  listingRecords: StartupJobRecord[] = [],
): StartupJobRecord[] {
  const listingEmployerByUrl = new Map<string, string>();
  for (const listing of listingRecords) {
    if (listing.jobUrl && !isPlaceholderEmployer(listing.employer)) {
      listingEmployerByUrl.set(listing.jobUrl, listing.employer.trim());
    }
  }

  return records.map((record) => {
    if (!isPlaceholderEmployer(record.employer)) return record;
    const employer =
      listingEmployerByUrl.get(record.jobUrl) ??
      employerFromCompanyProfileUrl(record.employerUrl) ??
      "Unknown Employer";
    return { ...record, employer };
  });
}

function mapStartupJob(row: StartupJobRecord): CreateJobInput | null {
  if (!row.jobUrl) return null;

  return {
    source: "startupjobs",
    title: row.title || "Unknown Title",
    employer: isPlaceholderEmployer(row.employer)
      ? "Unknown Employer"
      : row.employer,
    employerUrl: row.employerUrl || undefined,
    jobUrl: row.jobUrl,
    applicationLink: row.applicationLink || row.jobUrl,
    disciplines: row.disciplines || undefined,
    deadline: row.deadline || undefined,
    salary: row.salary || undefined,
    location: row.location || undefined,
    degreeRequired: row.degreeRequired || undefined,
    starting: row.starting || undefined,
    jobDescription: row.jobDescription || undefined,
    jobType: inferJobType(row.disciplines),
    isRemote: row.location?.toLowerCase().includes("remote") ?? undefined,
  };
}

/**
 * When detail enrichment produced placeholder employers, re-runs the cheap
 * listing-only Algolia query (no detail pages) to recover the canonical
 * `company_name` for those job URLs. Only triggered when needed; a failure
 * here never fails the run — affected jobs fall back to "Unknown Employer".
 */
async function repairPlaceholderEmployers(
  records: StartupJobRecord[],
  scrapeOptions: Omit<ScrapeOptions, "enrichDetails">,
): Promise<StartupJobRecord[]> {
  if (!records.some((record) => isPlaceholderEmployer(record.employer))) {
    return records;
  }

  let listingRecords: StartupJobRecord[] = [];
  try {
    listingRecords = await scrapeStartupJobsViaAlgolia({
      ...scrapeOptions,
      enrichDetails: false,
    });
  } catch {
    listingRecords = [];
  }

  return repairStartupJobEmployers(records, listingRecords);
}

function resolveRunLocations(args: {
  selectedCountry?: string;
  locations?: string[];
}): Array<string | null> {
  const locations = resolveSearchCities({
    list: args.locations,
  });

  const normalizedLocations = locations
    .map((location) => normalizeCountryKey(location))
    .filter((location) => location !== "worldwide" && location !== "usa/ca");

  if (normalizedLocations.length > 0) {
    return normalizedLocations.map((location) => formatCountryLabel(location));
  }

  const countryKey = normalizeCountryKey(args.selectedCountry);
  if (!countryKey || countryKey === "worldwide" || countryKey === "usa/ca") {
    return [null];
  }

  return [formatCountryLabel(countryKey)];
}

export async function runStartupJobs(
  options: RunStartupJobsOptions = {},
): Promise<StartupJobsResult> {
  const searchTerms =
    options.searchTerms && options.searchTerms.length > 0
      ? options.searchTerms
      : ["software engineer"];
  const runLocations = resolveRunLocations({
    selectedCountry: options.selectedCountry,
    locations: options.locations,
  });
  const maxJobsPerTerm = toPositiveIntOrFallback(options.maxJobsPerTerm, 50);
  const workplaceType = mapWorkplaceTypes(options.workplaceTypes);
  const termTotal = searchTerms.length * runLocations.length;
  const jobs: CreateJobInput[] = [];
  const seen = new Set<string>();
  let runIndex = 0;

  try {
    for (const location of runLocations) {
      for (const searchTerm of searchTerms) {
        runIndex += 1;
        if (options.shouldCancel?.()) {
          return { success: true, jobs };
        }

        options.onProgress?.({
          type: "term_start",
          termIndex: runIndex,
          termTotal,
          searchTerm,
          location: location ?? undefined,
        });

        const scrapeOptions = {
          query: searchTerm,
          requestedCount: maxJobsPerTerm,
          location: location ?? undefined,
          workplaceType,
        };
        const enrichedRecords = await scrapeStartupJobsViaAlgolia({
          ...scrapeOptions,
          enrichDetails: true,
        });
        const records = await repairPlaceholderEmployers(
          enrichedRecords,
          scrapeOptions,
        );

        let jobsFoundTerm = 0;
        for (const record of records) {
          const mapped = mapStartupJob(record);
          if (!mapped) continue;
          const dedupeKey = mapped.jobUrl;
          if (seen.has(dedupeKey)) continue;
          seen.add(dedupeKey);
          jobs.push(mapped);
          jobsFoundTerm += 1;
        }

        options.onProgress?.({
          type: "term_complete",
          termIndex: runIndex,
          termTotal,
          searchTerm,
          location: location ?? undefined,
          jobsFoundTerm,
        });
      }
    }

    return {
      success: true,
      jobs,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "Unexpected error while running startup.jobs extractor.";
    const missingBrowser =
      /playwright|browser|executable/i.test(message) &&
      /install/i.test(message);
    return {
      success: false,
      jobs: [],
      error: missingBrowser
        ? `${message}. Install browser binaries with 'npx playwright install'.`
        : message,
    };
  }
}
