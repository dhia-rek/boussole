import type { CreateJobInput } from "@shared/types/jobs";

// Wellfound RSS feed (no auth required)
const WELLFOUND_RSS = "https://wellfound.com/jobs.rss";

export type WellfoundProgressEvent =
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
    };

export interface RunWellfoundOptions {
  searchTerms?: string[];
  locations?: string[];
  maxJobsPerTerm?: number;
  onProgress?: (event: WellfoundProgressEvent) => void;
  shouldCancel?: () => boolean;
  fetchImpl?: typeof fetch;
}

export interface WellfoundResult {
  success: boolean;
  jobs: CreateJobInput[];
  error?: string;
}

function extractCdata(xml: string, tag: string): string {
  const m =
    xml.match(
      new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`, "i"),
    ) || xml.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, "i"));
  return m ? m[1].trim() : "";
}

function parseItem(item: string): CreateJobInput | null {
  const title = extractCdata(item, "title");
  const link =
    extractCdata(item, "link") ||
    item.match(/<link>([^<]+)<\/link>/i)?.[1]?.trim() ||
    "";
  const description = extractCdata(item, "description")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const pubDate = extractCdata(item, "pubDate");

  // WLFD title format: "Role @ Company (Location)"
  const titleMatch = title.match(/^(.+?)\s+@\s+(.+?)(?:\s+\((.+?)\))?$/);
  const jobTitle = titleMatch ? titleMatch[1].trim() : title;
  const company = titleMatch ? titleMatch[2].trim() : "Unknown";
  const location = titleMatch?.[3]?.trim();

  if (!jobTitle || !link) return null;

  return {
    source: "wellfound",
    title: jobTitle,
    employer: company,
    jobUrl: link,
    location,
    jobDescription: description || undefined,
    datePosted: pubDate || undefined,
  };
}

function matchesTerm(job: CreateJobInput, term: string): boolean {
  if (!term) return true;
  const haystack =
    `${job.title} ${job.employer} ${job.jobDescription ?? ""}`.toLowerCase();
  return haystack.includes(term.toLowerCase());
}

export async function runWellfound(
  opts: RunWellfoundOptions,
): Promise<WellfoundResult> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const searchTerms = opts.searchTerms?.length ? opts.searchTerms : [""];
  const maxPerTerm = opts.maxJobsPerTerm ?? 100;
  const seen = new Set<string>();
  const allJobs: CreateJobInput[] = [];

  // Fetch RSS once and filter per term
  let xml: string;
  try {
    const params = new URLSearchParams();
    if (opts.locations?.length) params.set("l", opts.locations[0]);

    const res = await fetchImpl(`${WELLFOUND_RSS}?${params}`, {
      headers: {
        Accept: "application/rss+xml, text/xml, */*",
        "User-Agent": "Mozilla/5.0 (compatible; JobHunter/1.0)",
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok)
      return { success: false, jobs: [], error: `HTTP ${res.status}` };
    xml = await res.text();
  } catch (err) {
    return { success: false, jobs: [], error: String(err) };
  }

  const items = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? [];
  const parsed = items
    .map(parseItem)
    .filter((j): j is CreateJobInput => j !== null);

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
    for (const job of parsed) {
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
