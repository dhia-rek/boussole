import type { CreateJobInput } from "@shared/types/jobs";

const BRAVE_API = "https://api.search.brave.com/res/v1/web/search";

export type BraveSearchProgressEvent =
  | {
      type: "term_start";
      termIndex: number;
      termTotal: number;
      searchTerm: string;
    }
  | {
      type: "term_complete";
      termIndex: number;
      termTotal: number;
      searchTerm: string;
      jobsFoundTerm: number;
    }
  | {
      type: "rate_limit";
      termIndex: number;
      termTotal: number;
      searchTerm: string;
      message: string;
    }
  | {
      type: "api_error";
      termIndex: number;
      termTotal: number;
      searchTerm: string;
      status: number;
      message: string;
    };

export interface RunBraveSearchOptions {
  apiKey: string;
  searchTerms?: string[];
  locations?: string[];
  maxJobsPerTerm?: number;
  onProgress?: (event: BraveSearchProgressEvent) => void;
  shouldCancel?: () => boolean;
  fetchImpl?: typeof fetch;
}

export interface BraveSearchResult {
  success: boolean;
  jobs: CreateJobInput[];
  error?: string;
}

interface BraveWebResult {
  title?: string;
  url?: string;
  description?: string;
  meta_url?: { hostname?: string };
  age?: string;
}

interface BraveResponse {
  web?: { results?: BraveWebResult[] };
  query?: { original?: string };
}

const JOB_SITE_PATTERNS = [
  /linkedin\.com\/jobs/i,
  /indeed\.com/i,
  /glassdoor\.(com|co\.uk)/i,
  /wellfound\.com/i,
  /welcometothejungle\.com/i,
  /weworkremotely\.com/i,
  /remote\.co\/job/i,
  /jobs\.lever\.co/i,
  /boards\.greenhouse\.io/i,
  /apply\.workable\.com/i,
  /jobs\.ashbyhq\.com/i,
  /careers\./i,
  /jobs\./i,
  /hiring\./i,
  /\/jobs\//i,
  /\/careers\//i,
  /\/job\//i,
];

function looksLikeJobUrl(url: string): boolean {
  return JOB_SITE_PATTERNS.some((re) => re.test(url));
}

/** ATS hosts where the company slug is the first path segment. */
const ATS_PATH_HOSTS = [
  /^jobs\.(eu\.)?lever\.co$/,
  /^(boards|job-boards)(\.eu)?\.greenhouse\.io$/,
  /^jobs\.ashbyhq\.com$/,
  /^apply\.workable\.com$/,
  /^jobs\.smartrecruiters\.com$/,
];

/** ATS hosts where the company is the subdomain (acme.teamtailor.com). */
const ATS_SUBDOMAIN_HOSTS = [
  /\.recruitee\.com$/,
  /\.teamtailor\.com$/,
  /\.bamboohr\.com$/,
  /\.breezy\.hr$/,
  /\.workable\.com$/,
];

/** Job boards/aggregators: their hostname is never the employer. */
const AGGREGATOR_DOMAINS = new Set([
  "indeed",
  "linkedin",
  "glassdoor",
  "welcometothejungle",
  "weworkremotely",
  "wellfound",
  "remote",
  "monster",
  "hellowork",
  "apec",
  "jobteaser",
  "francetravail",
  "pole-emploi",
  "jooble",
  "simplyhired",
  "ziprecruiter",
  "talent",
  "adzuna",
  "builtin",
  "otta",
]);

/** Leading labels that describe a site section, not the company. */
const GENERIC_SUBDOMAINS = new Set([
  "www",
  "m",
  "fr",
  "en",
  "uk",
  "de",
  "es",
  "it",
  "nl",
  "jobs",
  "job",
  "careers",
  "career",
  "emplois",
  "carrieres",
  "recrutement",
  "apply",
  "boards",
  "hiring",
  "talent",
  "join",
  "work",
]);

const TWO_LEVEL_SUFFIXES = new Set([
  "co.uk",
  "org.uk",
  "ac.uk",
  "com.au",
  "co.nz",
  "co.in",
  "com.br",
  "co.za",
  "com.sg",
  "co.jp",
]);

function registrableLabel(hostname: string): string | undefined {
  const labels = hostname
    .toLowerCase()
    .split(".")
    .filter(Boolean)
    .filter((label, index, all) => {
      // Drop generic leading labels (www., fr., jobs., careers., …).
      const isLeading = all
        .slice(0, index)
        .every((previous) => GENERIC_SUBDOMAINS.has(previous));
      return !(isLeading && GENERIC_SUBDOMAINS.has(label) && all.length > 2);
    });
  if (labels.length < 2) return labels[0];
  const lastTwo = labels.slice(-2).join(".");
  if (TWO_LEVEL_SUFFIXES.has(lastTwo) && labels.length >= 3) {
    return labels[labels.length - 3];
  }
  return labels[labels.length - 2];
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function humanizeSlug(slug: string): string {
  return safeDecode(slug)
    .split(/[-_+]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Best-effort employer from a result URL. Returns undefined for aggregators
 * (Indeed, LinkedIn, …) where the host is the job board, not the employer.
 */
export function extractEmployerFromUrl(
  url: string,
  hostname?: string,
): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  const host = (hostname ?? parsed.hostname).toLowerCase().replace(/\.$/, "");
  const segments = parsed.pathname.split("/").filter(Boolean);

  if (ATS_PATH_HOSTS.some((pattern) => pattern.test(host))) {
    return segments[0] ? humanizeSlug(segments[0]) : undefined;
  }

  // welcometothejungle.com/<lang>/companies/<company>/jobs/<slug>
  const companiesIndex = segments.indexOf("companies");
  if (host.endsWith("welcometothejungle.com") && companiesIndex >= 0) {
    const slug = segments[companiesIndex + 1];
    return slug ? humanizeSlug(slug) : undefined;
  }

  if (ATS_SUBDOMAIN_HOSTS.some((pattern) => pattern.test(host))) {
    const sub = host.split(".")[0];
    if (sub && !GENERIC_SUBDOMAINS.has(sub)) return humanizeSlug(sub);
  }

  const label = registrableLabel(host);
  if (!label || AGGREGATOR_DOMAINS.has(label)) return undefined;
  return humanizeSlug(label);
}

/** "Criteo hiring Data Science Intern in Paris, France | LinkedIn" */
const LINKEDIN_HIRING_TITLE =
  /^(.+?)\s+hiring\s+(.+?)(?:\s+in\s+(.+?))?\s*\|\s*LinkedIn\s*$/i;

/**
 * "<count> [up to 6 words] jobs|emplois|offres|…" — plural nouns only. The
 * in-between words may not start with a digit, so a year can never swallow
 * the real count that follows it ("Stage 2027 … - 150 offres").
 */
const COUNTED_LISTING_PATTERN =
  /(\d{1,3}(?:[.,\u00a0\u202f ]\d{3})+|\d+)(\+?)\s+(?:[\p{L}'’&/-][\p{L}\p{N}'’&/-]*\s+){0,6}?(?:jobs|emplois|offres|postes|vacancies|openings|stages)\b/giu;

/**
 * Search/listing pages ("Stage Data Scientist : plus de 200 emplois | Indeed",
 * "2,000+ Data Science Intern jobs in France") are not job postings. A count
 * only marks a listing when it has 2+ digits or a "+", and is not a year, so
 * "Data Scientist (2 postes)" or "Intern 2027 - Paris - Jobs at X" survive.
 */
export function isListingTitle(title: string): boolean {
  if (/\bplus de\s+\d/i.test(title)) return true;
  // LinkedIn/Indeed result counters: "(26 nouvelles)", "(95 new)".
  if (/\(\d[\d.,\s]*\s+(new|nouvelles?|neue|nuevas?|nuove)\)/i.test(title)) {
    return true;
  }
  for (const match of title.matchAll(COUNTED_LISTING_PATTERN)) {
    const rawCount = match[1] ?? "";
    const hasPlus = match[2] === "+";
    if (!hasPlus && /^(19|20)\d\d$/.test(rawCount)) continue; // a year
    if (hasPlus || rawCount.replace(/\D/g, "").length >= 2) return true;
  }
  return false;
}

const LISTING_URL_PATTERNS = [
  /indeed\.[^/]+\/(q-|jobs\?|emplois\?|m\/jobs\?)/i,
  /indeed\.[^/]+\/.*-emplois\.html/i,
  /indeed\.[^/]+\/[^/?#]*emplois-/i,
  // LinkedIn postings always live under /jobs/view/; every other /jobs/ path
  // (search, collections, "<keyword>-jobs", "<keyword>-emplois-paris") lists.
  /linkedin\.com\/jobs\/(?!view\/)/i,
  /glassdoor\.[^/]+\/Job\//,
  /welcometothejungle\.com\/[a-z]{2}\/jobs\/?(\?|$)/i,
];

export function isListingPage(url: string, title: string): boolean {
  return (
    isListingTitle(title) ||
    LISTING_URL_PATTERNS.some((pattern) => pattern.test(url))
  );
}

function mapResult(result: BraveWebResult): CreateJobInput | null {
  const jobUrl = result.url?.trim();
  const rawTitle = result.title?.trim();
  if (!jobUrl || !rawTitle) return null;
  if (isListingPage(jobUrl, rawTitle)) return null;

  let title = rawTitle;
  let employer = extractEmployerFromUrl(jobUrl, result.meta_url?.hostname);
  let location: string | undefined;

  const linkedin = /linkedin\.com\/jobs\/view\//i.test(jobUrl)
    ? LINKEDIN_HIRING_TITLE.exec(rawTitle)
    : null;
  if (linkedin) {
    employer = linkedin[1]?.trim() || employer;
    title = linkedin[2]?.trim() || title;
    location = linkedin[3]?.trim() || undefined;
  }

  const description = result.description?.trim();

  return {
    source: "bravesearch",
    title,
    employer: employer ?? "Unknown Employer",
    jobUrl,
    location,
    jobDescription: description || undefined,
    datePosted: result.age || undefined,
  };
}

function buildQuery(term: string, location?: string): string {
  const base = term ? `${term} jobs` : "software engineer jobs";
  return location ? `${base} ${location}` : base;
}

export async function runBraveSearch(
  opts: RunBraveSearchOptions,
): Promise<BraveSearchResult> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const searchTerms = opts.searchTerms?.length ? opts.searchTerms : [""];
  const maxPerTerm = opts.maxJobsPerTerm ?? 20;
  const location = opts.locations?.[0];
  const seen = new Set<string>();
  const allJobs: CreateJobInput[] = [];

  for (let ti = 0; ti < searchTerms.length; ti++) {
    if (opts.shouldCancel?.()) break;
    const term = searchTerms[ti];

    opts.onProgress?.({
      type: "term_start",
      termIndex: ti + 1,
      termTotal: searchTerms.length,
      searchTerm: term,
    });

    const query = buildQuery(term, location);
    const params = new URLSearchParams({
      q: query,
      count: String(Math.min(maxPerTerm, 20)),
      search_lang: "en",
      safesearch: "off",
    });

    let data: BraveResponse;
    try {
      const res = await fetchImpl(`${BRAVE_API}?${params}`, {
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip",
          "X-Subscription-Token": opts.apiKey,
        },
        signal: AbortSignal.timeout(20_000),
      });

      if (res.status === 429) {
        const msg =
          "Brave Search rate limit reached (2,000 queries/month on free tier). Wait or upgrade your plan.";
        opts.onProgress?.({
          type: "rate_limit",
          termIndex: ti + 1,
          termTotal: searchTerms.length,
          searchTerm: term,
          message: msg,
        });
        return { success: false, jobs: allJobs, error: msg };
      }

      if (res.status === 401) {
        const msg =
          "Brave Search API key is invalid or missing. Check your BRAVE_SEARCH_API_KEY setting.";
        opts.onProgress?.({
          type: "api_error",
          termIndex: ti + 1,
          termTotal: searchTerms.length,
          searchTerm: term,
          status: res.status,
          message: msg,
        });
        return { success: false, jobs: allJobs, error: msg };
      }

      if (!res.ok) {
        const msg = `Brave Search API error: HTTP ${res.status}`;
        opts.onProgress?.({
          type: "api_error",
          termIndex: ti + 1,
          termTotal: searchTerms.length,
          searchTerm: term,
          status: res.status,
          message: msg,
        });
        opts.onProgress?.({
          type: "term_complete",
          termIndex: ti + 1,
          termTotal: searchTerms.length,
          searchTerm: term,
          jobsFoundTerm: 0,
        });
        continue;
      }

      data = (await res.json()) as BraveResponse;
    } catch {
      opts.onProgress?.({
        type: "term_complete",
        termIndex: ti + 1,
        termTotal: searchTerms.length,
        searchTerm: term,
        jobsFoundTerm: 0,
      });
      continue;
    }

    const results = data.web?.results ?? [];
    let added = 0;

    for (const result of results) {
      if (added >= maxPerTerm) break;
      if (!result.url || seen.has(result.url)) continue;
      if (!looksLikeJobUrl(result.url)) continue;
      const job = mapResult(result);
      if (!job) continue;
      seen.add(result.url);
      allJobs.push(job);
      added++;
    }

    opts.onProgress?.({
      type: "term_complete",
      termIndex: ti + 1,
      termTotal: searchTerms.length,
      searchTerm: term,
      jobsFoundTerm: added,
    });

    // Brave free tier enforces 1 req/sec — respect it
    if (ti < searchTerms.length - 1 && !opts.shouldCancel?.()) {
      await new Promise((r) => setTimeout(r, 1100));
    }
  }

  return { success: true, jobs: allJobs };
}
