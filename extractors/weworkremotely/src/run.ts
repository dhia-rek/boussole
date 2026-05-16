import type { CreateJobInput } from "@shared/types/jobs";

const RSS_CATEGORIES = [
  "remote-programming-jobs",
  "remote-devops-sysadmin-jobs",
  "remote-design-jobs",
  "remote-product-jobs",
  "remote-management-executive-jobs",
];

export type WWRProgressEvent =
  | {
      type: "category_start";
      categoryIndex: number;
      categoryTotal: number;
      category: string;
    }
  | {
      type: "category_done";
      categoryIndex: number;
      categoryTotal: number;
      jobs: number;
    };

export interface RunWWROptions {
  searchTerms?: string[];
  maxJobsPerTerm?: number;
  onProgress?: (event: WWRProgressEvent) => void;
  shouldCancel?: () => boolean;
  fetchImpl?: typeof fetch;
}

export interface WWRResult {
  success: boolean;
  jobs: CreateJobInput[];
  error?: string;
}

function parseRssItem(item: string): {
  title: string;
  link: string;
  company: string;
  pubDate: string;
  description: string;
} | null {
  const get = (tag: string) => {
    const m =
      item.match(
        new RegExp(
          `<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`,
          "i",
        ),
      ) || item.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, "i"));
    return m ? m[1].trim() : "";
  };

  const title = get("title");
  const link =
    get("link") || item.match(/<link>([^<]+)<\/link>/i)?.[1]?.trim() || "";
  const company = get("author") || "";
  const pubDate = get("pubDate");
  const description = get("description")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!title || !link) return null;
  return { title, link, company, pubDate, description };
}

function matchesTerm(
  job: { title: string; description: string },
  terms: string[],
): boolean {
  if (!terms.length) return true;
  const haystack = `${job.title} ${job.description}`.toLowerCase();
  return terms.some((t) => haystack.includes(t.toLowerCase()));
}

export async function runWWR(opts: RunWWROptions): Promise<WWRResult> {
  const fetch = opts.fetchImpl ?? globalThis.fetch;
  const searchTerms = opts.searchTerms ?? [];
  const seen = new Set<string>();
  const jobs: CreateJobInput[] = [];
  const maxJobs = opts.maxJobsPerTerm ?? 200;

  for (let i = 0; i < RSS_CATEGORIES.length; i++) {
    if (opts.shouldCancel?.()) break;
    const category = RSS_CATEGORIES[i];

    opts.onProgress?.({
      type: "category_start",
      categoryIndex: i + 1,
      categoryTotal: RSS_CATEGORIES.length,
      category,
    });

    let xml: string;
    try {
      const res = await fetch(
        `https://weworkremotely.com/categories/${category}.rss`,
        {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; JobHunter/1.0)" },
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (!res.ok) {
        opts.onProgress?.({
          type: "category_done",
          categoryIndex: i + 1,
          categoryTotal: RSS_CATEGORIES.length,
          jobs: 0,
        });
        continue;
      }
      xml = await res.text();
    } catch {
      opts.onProgress?.({
        type: "category_done",
        categoryIndex: i + 1,
        categoryTotal: RSS_CATEGORIES.length,
        jobs: 0,
      });
      continue;
    }

    const items = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? [];
    let added = 0;

    for (const item of items) {
      if (jobs.length >= maxJobs) break;
      const parsed = parseRssItem(item);
      if (!parsed || seen.has(parsed.link)) continue;
      if (
        !matchesTerm(
          { title: parsed.title, description: parsed.description },
          searchTerms,
        )
      )
        continue;

      seen.add(parsed.link);
      jobs.push({
        source: "weworkremotely",
        title: parsed.title,
        employer: parsed.company || "Unknown",
        jobUrl: parsed.link,
        jobDescription: parsed.description || undefined,
        datePosted: parsed.pubDate || undefined,
        isRemote: true,
        location: "Remote",
      });
      added++;
    }

    opts.onProgress?.({
      type: "category_done",
      categoryIndex: i + 1,
      categoryTotal: RSS_CATEGORIES.length,
      jobs: added,
    });
  }

  return { success: true, jobs };
}
