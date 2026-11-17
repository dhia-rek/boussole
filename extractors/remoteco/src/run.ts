import type { CreateJobInput } from "@shared/types/jobs";

// Remote.co JSON jobs feed — no auth required
const REMOTECO_API = "https://remote.co/wp-json/wp/v2/job_listing";

export type RemoteCoProgressEvent =
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

export interface RunRemoteCoOptions {
  searchTerms?: string[];
  maxJobsPerTerm?: number;
  onProgress?: (event: RemoteCoProgressEvent) => void;
  shouldCancel?: () => boolean;
  fetchImpl?: typeof fetch;
}

export interface RemoteCoResult {
  success: boolean;
  jobs: CreateJobInput[];
  error?: string;
}

interface RemoteCoJob {
  id?: unknown;
  link?: unknown;
  title?: { rendered?: unknown };
  content?: { rendered?: unknown };
  date?: unknown;
  meta?: Record<string, unknown>;
}

function toStr(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function mapJob(job: RemoteCoJob): CreateJobInput | null {
  const jobUrl = toStr(job.link);
  const title = toStr(
    job.title?.rendered ? stripHtml(String(job.title.rendered)) : undefined,
  );
  const description = job.content?.rendered
    ? stripHtml(String(job.content.rendered))
    : undefined;
  const datePosted = toStr(job.date);
  const company =
    toStr(job.meta?._company_name as string) ??
    toStr(job.meta?.company_name as string) ??
    "Remote.co";

  if (!jobUrl || !title) return null;

  return {
    source: "remoteco",
    title,
    employer: company,
    jobUrl,
    isRemote: true,
    location: "Remote",
    jobDescription: description,
    datePosted,
  };
}

function matchesTerm(job: CreateJobInput, term: string): boolean {
  if (!term) return true;
  const haystack =
    `${job.title} ${job.employer} ${job.jobDescription ?? ""}`.toLowerCase();
  return haystack.includes(term.toLowerCase());
}

export async function runRemoteCo(
  opts: RunRemoteCoOptions,
): Promise<RemoteCoResult> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const searchTerms = opts.searchTerms?.length ? opts.searchTerms : [""];
  const maxPerTerm = opts.maxJobsPerTerm ?? 100;
  const PAGE_SIZE = 50;
  const seen = new Set<string>();
  const allJobs: CreateJobInput[] = [];

  // Fetch all pages once, then filter per term
  const allRaw: CreateJobInput[] = [];
  let page = 1;
  // Failures used to be swallowed (`break`), so a removed endpoint looked like
  // "0 jobs found". Remember the reason and fail loudly if page 1 fails.
  let firstPageError: string | undefined;
  while (allRaw.length < 500) {
    if (opts.shouldCancel?.()) break;
    let items: RemoteCoJob[];
    try {
      const res = await fetchImpl(
        `${REMOTECO_API}?per_page=${PAGE_SIZE}&page=${page}&_fields=id,link,title,content,date,meta`,
        {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; JobHunter/1.0)" },
          signal: AbortSignal.timeout(20_000),
        },
      );
      if (!res.ok) {
        // WordPress answers 400 once `page` runs past the last page; only a
        // first-page failure means the feed itself is unavailable.
        if (page === 1) {
          firstPageError =
            res.status === 404
              ? `Remote.co jobs feed returned HTTP 404 (${REMOTECO_API}); the WordPress job_listing endpoint no longer exists, so this source cannot fetch jobs.`
              : `Remote.co jobs feed returned HTTP ${res.status} (${REMOTECO_API}).`;
        }
        break;
      }
      const payload = (await res.json()) as unknown;
      if (!Array.isArray(payload)) {
        if (page === 1) {
          firstPageError = `Remote.co jobs feed returned an unexpected payload (expected a JSON array) from ${REMOTECO_API}.`;
        }
        break;
      }
      items = payload as RemoteCoJob[];
    } catch (error) {
      if (page === 1) {
        const reason = error instanceof Error ? error.message : String(error);
        firstPageError = `Remote.co jobs feed request failed (${REMOTECO_API}): ${reason}`;
      }
      break;
    }
    if (!items.length) break;
    for (const item of items) {
      const mapped = mapJob(item);
      if (mapped) allRaw.push(mapped);
    }
    if (items.length < PAGE_SIZE) break;
    page++;
  }

  if (firstPageError) {
    return { success: false, jobs: [], error: firstPageError };
  }

  for (let ti = 0; ti < searchTerms.length; ti++) {
    if (opts.shouldCancel?.()) break;
    const term = searchTerms[ti];
    opts.onProgress?.({
      type: "term_start",
      termIndex: ti + 1,
      termTotal: searchTerms.length,
      searchTerm: term,
    });

    let added = 0;
    for (const job of allRaw) {
      if (added >= maxPerTerm) break;
      if (!matchesTerm(job, term)) continue;
      if (seen.has(job.jobUrl)) continue;
      seen.add(job.jobUrl);
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
  }

  return { success: true, jobs: allJobs };
}
