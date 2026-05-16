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

function extractEmployerFromUrl(url: string, hostname?: string): string {
  try {
    const h = hostname ?? new URL(url).hostname;
    return h.replace(/^www\./, "").split(".")[0] ?? "Unknown";
  } catch {
    return "Unknown";
  }
}

function mapResult(result: BraveWebResult): CreateJobInput | null {
  const jobUrl = result.url?.trim();
  const title = result.title?.trim();
  if (!jobUrl || !title) return null;

  const employer = extractEmployerFromUrl(jobUrl, result.meta_url?.hostname);

  const description = result.description?.trim();

  return {
    source: "bravesearch",
    title,
    employer,
    jobUrl,
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
