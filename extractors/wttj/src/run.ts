import { gunzipSync } from "node:zlib";
import { normalizeCountryKey } from "@shared/location-support.js";
import type { CreateJobInput } from "@shared/types/jobs";
import { htmlToPlainText } from "@shared/utils/string.js";

/**
 * Welcome to the Jungle (WTTJ) extractor.
 *
 * WTTJ retired its public jobs API (`api/v1/jobs` answers 404), its site
 * search runs on an Algolia key that only works from welcometothejungle.com,
 * and robots.txt disallows crawling search pages. This extractor therefore
 * only uses what WTTJ publishes for automated clients:
 *
 * 1. the job-listings sitemaps (`/sitemaps/index.xml.gz`) to discover offers;
 *    every offer URL carries its title and city in the slug, so search terms
 *    are matched locally against titles;
 * 2. the public job endpoint
 *    (`api.welcometothejungle.com/api/v1/organizations/<org>/jobs/<slug>`)
 *    for the full offer, requested only for slugs that match a search term.
 *
 * Traffic stays small: the sitemaps are read once per run (about nine files),
 * detail requests are bounded per term and per run, go out three at a time,
 * and are spaced out.
 */

const WTTJ_SITE = "https://www.welcometothejungle.com";
const WTTJ_API = "https://api.welcometothejungle.com/api/v1";
export const WTTJ_SITEMAP_INDEX_URL = `${WTTJ_SITE}/sitemaps/index.xml.gz`;

const USER_AGENT =
  "Mozilla/5.0 (compatible; ForsaJobSearch/1.0; personal job search)";
const REQUEST_TIMEOUT_MS = 30_000;
const SITEMAP_CONCURRENCY = 3;
const DETAIL_CONCURRENCY = 3;
const DEFAULT_DELAY_MS = 250;
export const DEFAULT_MAX_JOBS_PER_TERM = 50;
export const DEFAULT_MAX_DETAIL_REQUESTS = 300;
/** Detail requests a term may spend per job it keeps (some offers get filtered out). */
const DETAIL_ATTEMPTS_PER_JOB = 3;

export type WTTJProgressEvent =
  | {
      type: "sitemap_progress";
      filesDone: number;
      filesTotal: number;
      listingsFound: number;
    }
  | {
      type: "term_start";
      termIndex: number;
      termTotal: number;
      searchTerm: string;
      matches: number;
    }
  | {
      type: "job_fetched";
      termIndex: number;
      termTotal: number;
      searchTerm: string;
      processed: number;
      total: number;
      collected: number;
    }
  | {
      type: "term_complete";
      termIndex: number;
      termTotal: number;
      searchTerm: string;
      jobsFoundTerm: number;
    };

export interface RunWTTJOptions {
  searchTerms?: string[];
  /** Selected country (e.g. "france"); on-site offers elsewhere are skipped. */
  country?: string;
  maxJobsPerTerm?: number;
  /** Upper bound on job-detail requests for the whole run. */
  maxDetailRequests?: number;
  /** Pause between detail batches in milliseconds (tests pass 0). */
  delayMs?: number;
  onProgress?: (event: WTTJProgressEvent) => void;
  shouldCancel?: () => boolean;
  fetchImpl?: typeof fetch;
}

export interface WTTJResult {
  success: boolean;
  jobs: CreateJobInput[];
  error?: string;
}

export interface WTTJListing {
  url: string;
  language: string;
  orgSlug: string;
  jobSlug: string;
  /** Title words from the slug (the part before the first "_"). */
  titleText: string;
  titleTokens: ReadonlySet<string>;
  /** `<lastmod>` as epoch milliseconds; 0 when missing. */
  lastModified: number;
}

interface WTTJOffice {
  city?: unknown;
  country_code?: unknown;
  address?: unknown;
}

export interface WTTJJobDetail {
  name?: unknown;
  reference?: unknown;
  language?: unknown;
  contract_type?: unknown;
  remote?: unknown;
  experience_level?: unknown;
  published_at?: unknown;
  archived_at?: unknown;
  apply_url?: unknown;
  description?: unknown;
  profile?: unknown;
  recruitment_process?: unknown;
  key_missions?: unknown;
  salary_min?: unknown;
  salary_max?: unknown;
  salary_currency?: unknown;
  salary_period?: unknown;
  office?: unknown;
  offices?: unknown;
  organization?: {
    name?: unknown;
    media_website_url?: unknown;
    description?: unknown;
    industry?: unknown;
    nb_employees?: unknown;
  } | null;
}

// ---------------------------------------------------------------------------
// Small value helpers
// ---------------------------------------------------------------------------

function toStr(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function toHttpUrl(value: unknown): string | undefined {
  const text = toStr(value);
  return text && /^https?:\/\//i.test(text) ? text : undefined;
}

function positiveInt(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function listingKey(listing: Pick<WTTJListing, "orgSlug" | "jobSlug">): string {
  return `${listing.orgSlug}/${listing.jobSlug}`;
}

// ---------------------------------------------------------------------------
// Search-term matching against slug titles
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  "a",
  "au",
  "aux",
  "d",
  "de",
  "des",
  "du",
  "en",
  "et",
  "l",
  "la",
  "le",
  "les",
  "pour",
  "sur",
  "un",
  "une",
  "and",
  "for",
  "in",
  "of",
  "the",
  "to",
  "with",
  "h",
  "f",
  "x",
  "m",
  "w",
  "n",
  "hf",
  "fh",
]);

function foldText(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function rawTokens(value: string): string[] {
  return foldText(value)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Folds simple plurals so "agents" matches "agent" ("process" is kept). */
function singular(token: string): string {
  return token.length > 3 && token.endsWith("s") && !token.endsWith("ss")
    ? token.slice(0, -1)
    : token;
}

export function tokenize(value: string): string[] {
  return rawTokens(value).map(singular);
}

type TokenAlternatives = readonly (readonly string[])[];

const AI_ALTERNATIVES: TokenAlternatives = [
  ["ai"],
  ["ia"],
  ["artificial", "intelligence"],
  ["intelligence", "artificielle"],
];

/** Abbreviations that job titles often spell out or translate. */
const TOKEN_ALTERNATIVES: Readonly<Record<string, TokenAlternatives>> = {
  ai: AI_ALTERNATIVES,
  ia: AI_ALTERNATIVES,
  ml: [["ml"], ["machine", "learning"]],
};

/** One entry per search-term word, each listing the token sets that satisfy it. */
export type TermMatcher = readonly TokenAlternatives[];

export function buildTermMatcher(term: string): TermMatcher | null {
  const words = [
    ...new Set(
      rawTokens(term)
        .filter((token) => !STOP_WORDS.has(token))
        .map(singular),
    ),
  ];
  if (words.length === 0) return null;
  return words.map((word) => TOKEN_ALTERNATIVES[word] ?? [[word]]);
}

/** True when the listing title contains every word of the term, in any order. */
export function listingMatchesTerm(
  listing: Pick<WTTJListing, "titleTokens">,
  matcher: TermMatcher,
): boolean {
  return matcher.every((alternatives) =>
    alternatives.some((tokens) =>
      tokens.every((token) => listing.titleTokens.has(token)),
    ),
  );
}

const INTERNSHIP_WORDS =
  /\b(?:stages?|stagiaires?|interns?|internships?|alternan(?:ce|ts?|tes?)|apprenti(?:e|es|s)?|apprentissage|apprentices?|apprenticeships?|trainees?)\b/;
const INTERNSHIP_CONTRACTS = new Set(["internship", "apprenticeship"]);

/** True for text that names an internship or apprenticeship (FR or EN). */
export function mentionsInternship(text: string): boolean {
  return INTERNSHIP_WORDS.test(foldText(text));
}

// ---------------------------------------------------------------------------
// Sitemaps
// ---------------------------------------------------------------------------

const SITEMAP_LOC = /<loc>([\s\S]*?)<\/loc>/g;
const URL_BLOCK = /<url>([\s\S]*?)<\/url>/g;
const LOC_TAG = /<loc>([\s\S]*?)<\/loc>/;
const LASTMOD_TAG = /<lastmod>([\s\S]*?)<\/lastmod>/;
const LISTING_URL =
  /^https:\/\/www\.welcometothejungle\.com\/([a-z]{2})\/companies\/([A-Za-z0-9._~%-]+)\/jobs\/([A-Za-z0-9._~%-]+)$/;

function decodeXmlText(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

/** Job-listings sitemap URLs from the sitemap index; other sitemaps are ignored. */
export function parseSitemapIndex(xml: string): string[] {
  const urls: string[] = [];
  for (const match of xml.matchAll(SITEMAP_LOC)) {
    const loc = decodeXmlText(match[1] ?? "");
    if (
      loc.startsWith(`${WTTJ_SITE}/sitemaps/job-listings.`) &&
      /\.xml(?:\.gz)?$/.test(loc)
    ) {
      urls.push(loc);
    }
  }
  return urls;
}

export function parseJobListingsSitemap(xml: string): WTTJListing[] {
  const listings: WTTJListing[] = [];
  for (const block of xml.matchAll(URL_BLOCK)) {
    const body = block[1] ?? "";
    const loc = decodeXmlText(LOC_TAG.exec(body)?.[1] ?? "");
    const match = LISTING_URL.exec(loc);
    if (!match) continue;
    const [, language = "", orgSlug = "", jobSlug = ""] = match;
    const titleText = (jobSlug.split("_")[0] ?? jobSlug)
      .replace(/-+/g, " ")
      .trim();
    const lastModified = Date.parse(
      decodeXmlText(LASTMOD_TAG.exec(body)?.[1] ?? ""),
    );
    listings.push({
      url: loc,
      language,
      orgSlug,
      jobSlug,
      titleText,
      titleTokens: new Set(tokenize(titleText)),
      lastModified: Number.isFinite(lastModified) ? lastModified : 0,
    });
  }
  return listings;
}

async function readBodyText(response: Response): Promise<string> {
  const bytes = Buffer.from(await response.arrayBuffer());
  const gzipped = bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  return (gzipped ? gunzipSync(bytes) : bytes).toString("utf8");
}

type TextResult = { ok: true; text: string } | { ok: false; error: string };

async function fetchText(
  fetchImpl: typeof fetch,
  url: string,
): Promise<TextResult> {
  try {
    const response = await fetchImpl(url, {
      headers: {
        Accept: "application/xml, text/xml;q=0.9, */*;q=0.8",
        "User-Agent": USER_AGENT,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      return { ok: false, error: `returned HTTP ${response.status}` };
    }
    return { ok: true, text: await readBodyText(response) };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `request failed: ${reason}` };
  }
}

type ListingsResult =
  | { ok: true; listings: WTTJListing[] }
  | { ok: false; error: string };

async function loadListings(
  fetchImpl: typeof fetch,
  opts: RunWTTJOptions,
): Promise<ListingsResult> {
  const index = await fetchText(fetchImpl, WTTJ_SITEMAP_INDEX_URL);
  if (!index.ok) {
    return {
      ok: false,
      error: `Welcome to the Jungle sitemap index ${index.error} (${WTTJ_SITEMAP_INDEX_URL}).`,
    };
  }

  const files = parseSitemapIndex(index.text);
  if (files.length === 0) {
    return {
      ok: false,
      error: `Welcome to the Jungle sitemap index lists no job-listings sitemaps (${WTTJ_SITEMAP_INDEX_URL}); the site layout probably changed.`,
    };
  }

  const listings: WTTJListing[] = [];
  const seen = new Set<string>();
  let failures = 0;
  let lastError = "";

  for (let start = 0; start < files.length; start += SITEMAP_CONCURRENCY) {
    if (opts.shouldCancel?.()) break;
    const batch = files.slice(start, start + SITEMAP_CONCURRENCY);
    const results = await Promise.all(
      batch.map((url) => fetchText(fetchImpl, url)),
    );
    for (const [offset, result] of results.entries()) {
      if (!result.ok) {
        failures += 1;
        lastError = `${batch[offset]} ${result.error}`;
        continue;
      }
      for (const listing of parseJobListingsSitemap(result.text)) {
        const key = listingKey(listing);
        if (seen.has(key)) continue;
        seen.add(key);
        listings.push(listing);
      }
    }
    opts.onProgress?.({
      type: "sitemap_progress",
      filesDone: start + batch.length,
      filesTotal: files.length,
      listingsFound: listings.length,
    });
  }

  if (listings.length === 0 && failures > 0) {
    return {
      ok: false,
      error: `Welcome to the Jungle job-listings sitemaps could not be read (${failures}/${files.length} failed; last: ${lastError}).`,
    };
  }
  return { ok: true, listings };
}

// ---------------------------------------------------------------------------
// Job details
// ---------------------------------------------------------------------------

type DetailResult =
  | { ok: true; job: WTTJJobDetail | null }
  | { ok: false; error: string };

async function fetchJobDetail(
  fetchImpl: typeof fetch,
  listing: WTTJListing,
): Promise<DetailResult> {
  const url = `${WTTJ_API}/organizations/${listing.orgSlug}/jobs/${listing.jobSlug}`;
  try {
    const response = await fetchImpl(url, {
      headers: {
        Accept: "application/json",
        "Accept-Language":
          listing.language === "fr"
            ? "fr-FR,fr;q=0.9,en;q=0.8"
            : "en-US,en;q=0.9",
        "User-Agent": USER_AGENT,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    // Offers can expire between the sitemap refresh and this request.
    if (response.status === 404 || response.status === 410) {
      return { ok: true, job: null };
    }
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status} for ${url}` };
    }
    const body = (await response.json()) as { job?: unknown } | null;
    const job = body?.job;
    if (!job || typeof job !== "object") {
      return { ok: false, error: `unexpected payload (no "job") for ${url}` };
    }
    return { ok: true, job: job as WTTJJobDetail };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `${reason} for ${url}` };
  }
}

const WTTJ_COUNTRY_CODES: Readonly<Record<string, string>> = {
  austria: "AT",
  belgium: "BE",
  canada: "CA",
  "czech republic": "CZ",
  czechia: "CZ",
  france: "FR",
  germany: "DE",
  ireland: "IE",
  italy: "IT",
  luxembourg: "LU",
  netherlands: "NL",
  portugal: "PT",
  slovakia: "SK",
  spain: "ES",
  switzerland: "CH",
  "united kingdom": "GB",
  "united states": "US",
};

/** ISO code for the selected country, or undefined when WTTJ doesn't cover it. */
export function resolveCountryCode(
  country: string | undefined,
): string | undefined {
  if (!country?.trim()) return undefined;
  return WTTJ_COUNTRY_CODES[normalizeCountryKey(country)];
}

const REGION_NAMES: Intl.DisplayNames | null = (() => {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" });
  } catch {
    return null;
  }
})();

function countryNameFromCode(code: string): string | undefined {
  try {
    return REGION_NAMES?.of(code.toUpperCase()) ?? undefined;
  } catch {
    return undefined;
  }
}

function pickOffice(
  job: WTTJJobDetail,
  countryCode: string | undefined,
): WTTJOffice | undefined {
  const offices = [
    job.office,
    ...(Array.isArray(job.offices) ? job.offices : []),
  ].filter(
    (office): office is WTTJOffice =>
      typeof office === "object" && office !== null,
  );
  if (countryCode) {
    const local = offices.find(
      (office) => toStr(office.country_code)?.toUpperCase() === countryCode,
    );
    if (local) return local;
  }
  return offices[0];
}

function formatLocation(office: WTTJOffice | undefined): string | undefined {
  if (!office) return undefined;
  const code = toStr(office.country_code);
  const parts = [
    toStr(office.city),
    code ? countryNameFromCode(code) : undefined,
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(", ") : toStr(office.address);
}

function isFullyRemote(job: WTTJJobDetail): boolean {
  return (toStr(job.remote)?.toLowerCase() ?? "").includes("full");
}

type SkipReason = "archived" | "contract" | "country";

function skipReason(
  job: WTTJJobDetail,
  options: { wantsInternships: boolean; countryCode?: string },
): SkipReason | null {
  if (toStr(job.archived_at)) return "archived";
  const contract = toStr(job.contract_type)?.toLowerCase();
  if (
    !options.wantsInternships &&
    contract &&
    INTERNSHIP_CONTRACTS.has(contract)
  ) {
    return "contract";
  }
  if (options.countryCode && !isFullyRemote(job)) {
    const code = toStr(
      pickOffice(job, options.countryCode)?.country_code,
    )?.toUpperCase();
    if (code && code !== options.countryCode) return "country";
  }
  return null;
}

const CONTRACT_LABELS: Readonly<Record<string, string>> = {
  full_time: "Full-time permanent (CDI)",
  temporary: "Fixed-term (CDD)",
  part_time: "Part-time",
  internship: "Internship (stage)",
  apprenticeship: "Apprenticeship (alternance)",
  freelance: "Freelance",
  vie: "VIE (international volunteer)",
  graduate_program: "Graduate program",
  volunteer: "Volunteer",
};

const SALARY_PERIODS: Readonly<Record<string, string>> = {
  yearly: "year",
  monthly: "month",
  weekly: "week",
  daily: "day",
  hourly: "hour",
};

function salaryFields(
  job: WTTJJobDetail,
): Pick<
  CreateJobInput,
  | "salary"
  | "salaryMinAmount"
  | "salaryMaxAmount"
  | "salaryCurrency"
  | "salaryInterval"
> {
  const min = toNumber(job.salary_min);
  const max = toNumber(job.salary_max);
  if (min === undefined && max === undefined) return {};
  const currency = toStr(job.salary_currency)?.toUpperCase();
  const period = toStr(job.salary_period)?.toLowerCase();
  const unit = period ? SALARY_PERIODS[period] : undefined;
  const amount =
    min !== undefined && max !== undefined && min !== max
      ? `${min}–${max}`
      : String(min ?? max);
  return {
    salary: [amount, currency, unit ? `/ ${unit}` : undefined]
      .filter(Boolean)
      .join(" "),
    salaryMinAmount: min,
    salaryMaxAmount: max,
    salaryCurrency: currency,
    salaryInterval: unit ? period : undefined,
  };
}

const SECTION_TITLES = {
  fr: {
    profile: "Profil recherché",
    interviews: "Déroulement des entretiens",
    missions: "Missions clés",
  },
  en: {
    profile: "Preferred experience",
    interviews: "Recruitment process",
    missions: "Key missions",
  },
} as const;

function htmlText(value: unknown): string | undefined {
  const html = toStr(value);
  if (!html) return undefined;
  return htmlToPlainText(html).trim() || undefined;
}

function buildDescription(job: WTTJJobDetail): string | undefined {
  const titles =
    toStr(job.language) === "fr" ? SECTION_TITLES.fr : SECTION_TITLES.en;
  const sections: string[] = [];
  const description = htmlText(job.description);
  if (description) sections.push(description);
  const profile = htmlText(job.profile);
  if (profile) sections.push(`${titles.profile}\n${profile}`);
  const interviews = htmlText(job.recruitment_process);
  if (interviews) sections.push(`${titles.interviews}\n${interviews}`);
  if (sections.length === 0 && Array.isArray(job.key_missions)) {
    const missions = job.key_missions
      .map((mission) => toStr(mission))
      .filter((mission): mission is string => Boolean(mission));
    if (missions.length > 0) {
      sections.push(
        `${titles.missions}\n${missions.map((mission) => `- ${mission}`).join("\n")}`,
      );
    }
  }
  return sections.length > 0 ? sections.join("\n\n") : undefined;
}

export function mapWttjJob(
  job: WTTJJobDetail,
  listing: WTTJListing,
  countryCode?: string,
): CreateJobInput {
  const organization = job.organization ?? undefined;
  const contract = toStr(job.contract_type)?.toLowerCase();
  const companyDescription = htmlText(organization?.description);
  const employees = toNumber(organization?.nb_employees);
  return {
    source: "wttj",
    sourceJobId: toStr(job.reference) ?? listingKey(listing),
    title: toStr(job.name) ?? listing.titleText,
    employer: toStr(organization?.name) ?? listing.orgSlug,
    employerUrl:
      toHttpUrl(organization?.media_website_url) ??
      `${WTTJ_SITE}/${listing.language}/companies/${listing.orgSlug}`,
    jobUrl: listing.url,
    jobUrlDirect: toHttpUrl(job.apply_url),
    location: formatLocation(pickOffice(job, countryCode)),
    isRemote: isFullyRemote(job),
    jobDescription: buildDescription(job),
    datePosted:
      toStr(job.published_at) ??
      (listing.lastModified
        ? new Date(listing.lastModified).toISOString()
        : undefined),
    jobType: contract ? (CONTRACT_LABELS[contract] ?? contract) : undefined,
    jobLevel: toStr(job.experience_level)?.replace(/_/g, " ").toLowerCase(),
    companyIndustry: toStr(organization?.industry),
    companyNumEmployees:
      employees !== undefined ? String(employees) : undefined,
    companyDescription: companyDescription
      ? truncate(companyDescription, 2000)
      : undefined,
    ...salaryFields(job),
  };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

export async function runWTTJ(opts: RunWTTJOptions): Promise<WTTJResult> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const delayMs = opts.delayMs ?? DEFAULT_DELAY_MS;
  const terms = [
    ...new Set(
      (opts.searchTerms ?? []).map((term) => term.trim()).filter(Boolean),
    ),
  ];
  if (terms.length === 0 || opts.shouldCancel?.()) {
    return { success: true, jobs: [] };
  }

  const maxPerTerm = positiveInt(
    opts.maxJobsPerTerm,
    DEFAULT_MAX_JOBS_PER_TERM,
  );
  const maxDetailRequests = positiveInt(
    opts.maxDetailRequests,
    DEFAULT_MAX_DETAIL_REQUESTS,
  );
  const countryCode = resolveCountryCode(opts.country);
  // Internship and apprenticeship offers are skipped unless a term asks for them.
  const wantsInternships = terms.some(mentionsInternship);

  const loaded = await loadListings(fetchImpl, opts);
  if (!loaded.ok) return { success: false, jobs: [], error: loaded.error };

  const seen = new Set<string>();
  const jobs: CreateJobInput[] = [];
  let detailRequests = 0;
  let detailResponses = 0;
  let detailFailures = 0;
  let lastDetailError = "";

  for (const [termOffset, term] of terms.entries()) {
    if (opts.shouldCancel?.()) break;
    const termIndex = termOffset + 1;
    const matcher = buildTermMatcher(term);
    const candidates = matcher
      ? loaded.listings
          .filter(
            (listing) =>
              !seen.has(listingKey(listing)) &&
              listingMatchesTerm(listing, matcher) &&
              (wantsInternships || !mentionsInternship(listing.titleText)),
          )
          .sort((a, b) => b.lastModified - a.lastModified)
      : [];
    const attemptLimit = Math.min(
      candidates.length,
      maxPerTerm * DETAIL_ATTEMPTS_PER_JOB,
    );

    opts.onProgress?.({
      type: "term_start",
      termIndex,
      termTotal: terms.length,
      searchTerm: term,
      matches: candidates.length,
    });

    let termJobs = 0;
    let attempts = 0;
    while (
      termJobs < maxPerTerm &&
      attempts < attemptLimit &&
      detailRequests < maxDetailRequests
    ) {
      if (opts.shouldCancel?.()) break;
      const size = Math.min(
        DETAIL_CONCURRENCY,
        maxPerTerm - termJobs,
        attemptLimit - attempts,
        maxDetailRequests - detailRequests,
      );
      const batch = candidates.slice(attempts, attempts + size);
      attempts += batch.length;
      detailRequests += batch.length;
      for (const listing of batch) seen.add(listingKey(listing));

      const results = await Promise.all(
        batch.map((listing) => fetchJobDetail(fetchImpl, listing)),
      );
      for (const [offset, result] of results.entries()) {
        const listing = batch[offset];
        if (!listing) continue;
        if (!result.ok) {
          detailFailures += 1;
          lastDetailError = result.error;
          continue;
        }
        detailResponses += 1;
        if (!result.job) continue;
        if (skipReason(result.job, { wantsInternships, countryCode })) continue;
        jobs.push(mapWttjJob(result.job, listing, countryCode));
        termJobs += 1;
      }

      opts.onProgress?.({
        type: "job_fetched",
        termIndex,
        termTotal: terms.length,
        searchTerm: term,
        processed: attempts,
        total: attemptLimit,
        collected: termJobs,
      });
      if (delayMs > 0 && termJobs < maxPerTerm && attempts < attemptLimit) {
        await sleep(delayMs);
      }
    }

    opts.onProgress?.({
      type: "term_complete",
      termIndex,
      termTotal: terms.length,
      searchTerm: term,
      jobsFoundTerm: termJobs,
    });
  }

  if (jobs.length === 0 && detailResponses === 0 && detailFailures > 0) {
    return {
      success: false,
      jobs: [],
      error: `Welcome to the Jungle job details could not be fetched (${detailFailures} request(s) failed; last: ${lastDetailError}).`,
    };
  }
  return { success: true, jobs };
}
