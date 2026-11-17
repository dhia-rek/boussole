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

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  rsquo: "'",
  lsquo: "'",
  rdquo: '"',
  ldquo: '"',
  ndash: "–",
  mdash: "—",
  hellip: "…",
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    const key = String(entity).toLowerCase();
    if (key.startsWith("#x")) {
      const code = Number.parseInt(key.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (key.startsWith("#")) {
      const code = Number.parseInt(key.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[key] ?? match;
  });
}

/** WWR descriptions are entity-escaped HTML (`&lt;p&gt;…`), not CDATA. */
function htmlToText(value: string): string {
  // Decode once to turn escaped markup into tags, strip the tags, then decode
  // again for entities that were double-escaped (e.g. `&amp;nbsp;`).
  return decodeEntities(
    decodeEntities(value)
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * WWR feed titles are "Company: Role" and the feed has no <author>, so the
 * company must be taken from the title (falls back to <author> if present).
 */
export function splitCompanyFromTitle(
  rawTitle: string,
  author?: string,
): { company: string; title: string } {
  const title = rawTitle.trim();
  const separator = title.indexOf(": ");
  if (separator > 0) {
    const company = title.slice(0, separator).trim();
    const role = title.slice(separator + 2).trim();
    if (company && role) return { company, title: role };
  }
  return { company: author?.trim() ?? "", title };
}

export function parseRssItem(item: string): {
  title: string;
  link: string;
  company: string;
  pubDate: string;
  description: string;
  region: string;
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

  const rawTitle = decodeEntities(get("title"));
  const link =
    get("link") || item.match(/<link>([^<]+)<\/link>/i)?.[1]?.trim() || "";
  const { company, title } = splitCompanyFromTitle(
    rawTitle,
    decodeEntities(get("author")),
  );
  const pubDate = get("pubDate");
  const description = htmlToText(get("description"));
  const region = decodeEntities(get("region")).trim();

  if (!title || !link) return null;
  return { title, link, company, pubDate, description, region };
}

function matchesTerm(
  job: { title: string; company: string; description: string },
  terms: string[],
): boolean {
  if (!terms.length) return true;
  const haystack =
    `${job.title} ${job.company} ${job.description}`.toLowerCase();
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
      if (!matchesTerm(parsed, searchTerms)) continue;

      seen.add(parsed.link);
      jobs.push({
        source: "weworkremotely",
        title: parsed.title,
        employer: parsed.company || "Unknown",
        jobUrl: parsed.link,
        jobDescription: parsed.description || undefined,
        datePosted: parsed.pubDate || undefined,
        isRemote: true,
        // e.g. "Remote (USA Only)" — keeps WWR's region restriction visible
        // to location filtering instead of a bare "Remote".
        location: parsed.region ? `Remote (${parsed.region})` : "Remote",
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
