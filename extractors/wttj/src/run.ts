import type { CreateJobInput } from "@shared/types/jobs";

// WTTJ public search API (no auth required)
const WTTJ_API_BASE = "https://api.welcometothejungle.com/api/v1";
const PAGE_SIZE = 30;

export type WTTJProgressEvent =
  | {
      type: "term_start";
      termIndex: number;
      termTotal: number;
      searchTerm: string;
    }
  | {
      type: "page_fetched";
      termIndex: number;
      termTotal: number;
      searchTerm: string;
      pageNo: number;
      totalCollected: number;
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
  country?: string;
  locations?: string[];
  maxJobsPerTerm?: number;
  onProgress?: (event: WTTJProgressEvent) => void;
  shouldCancel?: () => boolean;
  fetchImpl?: typeof fetch;
}

export interface WTTJResult {
  success: boolean;
  jobs: CreateJobInput[];
  error?: string;
}

interface WTTJJob {
  slug?: unknown;
  name?: unknown;
  organization?: { name?: unknown; slug?: unknown; website?: unknown };
  office?: { city?: unknown; country?: { name?: unknown } };
  contract_type?: unknown;
  published_at?: unknown;
  description?: unknown;
  salary_min?: unknown;
  salary_max?: unknown;
  salary_currency?: unknown;
  remote?: unknown;
  experience_level?: unknown;
}

interface WTTJResponse {
  jobs?: WTTJJob[];
  meta?: {
    total?: number;
    per_page?: number;
    current_page?: number;
    total_pages?: number;
  };
}

function toStr(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

function buildJobUrl(job: WTTJJob): string {
  const slug = toStr(job.slug);
  const orgSlug = toStr(job.organization?.slug);
  if (slug && orgSlug) {
    return `https://www.welcometothejungle.com/fr/companies/${orgSlug}/jobs/${slug}`;
  }
  return "https://www.welcometothejungle.com/fr/jobs";
}

function mapJob(job: WTTJJob): CreateJobInput {
  const employer = toStr(job.organization?.name) ?? "Unknown";
  const city = toStr(job.office?.city);
  const countryName = toStr(job.office?.country?.name);
  const locationParts = [city, countryName].filter(Boolean);
  const isRemote = job.remote === true || String(job.remote).includes("full");

  const salMin =
    typeof job.salary_min === "number" ? job.salary_min : undefined;
  const salMax =
    typeof job.salary_max === "number" ? job.salary_max : undefined;
  const currency = toStr(job.salary_currency);

  let salary: string | undefined;
  if (salMin !== undefined || salMax !== undefined) {
    salary = [salMin, salMax].filter((v) => v !== undefined).join(" – ");
    if (currency) salary += ` ${currency}`;
  }

  return {
    source: "wttj",
    title: toStr(job.name) ?? "Unknown",
    employer,
    employerUrl: toStr(job.organization?.website),
    jobUrl: buildJobUrl(job),
    location: locationParts.join(", ") || undefined,
    isRemote,
    jobDescription: toStr(job.description),
    datePosted: toStr(job.published_at),
    jobType: toStr(job.contract_type),
    salary,
    jobLevel: toStr(job.experience_level),
  };
}

export async function runWTTJ(opts: RunWTTJOptions): Promise<WTTJResult> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const searchTerms = opts.searchTerms?.length ? opts.searchTerms : [""];
  const maxPerTerm = opts.maxJobsPerTerm ?? 100;
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

    let page = 1;
    let termJobs = 0;

    while (termJobs < maxPerTerm) {
      if (opts.shouldCancel?.()) break;

      const params = new URLSearchParams({
        query: term,
        page: String(page),
        per_page: String(PAGE_SIZE),
        language: "en",
      });
      if (opts.country)
        params.set(
          "contract_country_codes[]",
          opts.country.toUpperCase().slice(0, 2),
        );

      let data: WTTJResponse;
      try {
        const res = await fetchImpl(`${WTTJ_API_BASE}/jobs?${params}`, {
          headers: {
            Accept: "application/json",
            "Accept-Language": "en-US,en;q=0.9",
            "User-Agent": "Mozilla/5.0 (compatible; JobHunter/1.0)",
          },
          signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) break;
        data = (await res.json()) as WTTJResponse;
      } catch {
        break;
      }

      const jobs = data.jobs ?? [];
      if (jobs.length === 0) break;

      for (const job of jobs) {
        const url = buildJobUrl(job);
        if (seen.has(url)) continue;
        seen.add(url);
        allJobs.push(mapJob(job));
        termJobs++;
        if (termJobs >= maxPerTerm) break;
      }

      opts.onProgress?.({
        type: "page_fetched",
        termIndex: ti + 1,
        termTotal: searchTerms.length,
        searchTerm: term,
        pageNo: page,
        totalCollected: termJobs,
      });

      const totalPages = data.meta?.total_pages ?? 1;
      if (page >= totalPages || jobs.length < PAGE_SIZE) break;
      page++;
    }

    opts.onProgress?.({
      type: "term_complete",
      termIndex: ti + 1,
      termTotal: searchTerms.length,
      searchTerm: term,
      jobsFoundTerm: termJobs,
    });
  }

  return { success: true, jobs: allJobs };
}
