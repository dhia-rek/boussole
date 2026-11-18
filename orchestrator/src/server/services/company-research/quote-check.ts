/**
 * The deterministic half of the judge: Boussole opens every cited page itself
 * (public addresses only) and checks that the quoted words are really there.
 */
import {
  fetchPublicUrl,
  type PublicFetchResponse,
  readTextWithLimit,
} from "@infra/public-url";
import type { CompanyResearchFactCheck, Job } from "@shared/types";
import { JSDOM, VirtualConsole } from "jsdom";
import type { RawResearchFact } from "./brief";

const MAX_PAGE_BYTES = 3_000_000;
const PAGE_TIMEOUT_MS = 15_000;
const MAX_PARALLEL_FETCHES = 4;
/** Quotes shorter than this prove nothing ("Paris", "AI"). */
const MIN_QUOTE_CHARS = 15;
const MIN_SEGMENT_CHARS = 8;

/**
 * Lower-cases and flattens typography (curly quotes, dashes, non-breaking and
 * French thin spaces, spacing before punctuation) so a faithful copy matches
 * however the page or the model typeset it.
 */
export function normalizeForMatch(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’‚‛′´`]/g, "'")
    .replace(/[“”„‟″«»]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/[   ​]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:!?%)"'])/g, "$1")
    .replace(/(["'(])\s+/g, "$1")
    .trim();
}

/**
 * True when the quote appears in the text. A quote shortened with "…" or
 * "..." matches when every part appears, in order.
 */
export function quoteAppearsIn(quote: string, text: string): boolean {
  const haystack = normalizeForMatch(text);
  const normalizedQuote = normalizeForMatch(quote).replace(
    /^["']+|["']+$/g,
    "",
  );
  if (normalizedQuote.length < MIN_QUOTE_CHARS) return false;
  const segments = normalizedQuote
    .split(/\s*(?:\.\.\.|…|\[\.\.\.\]|\[…\])\s*/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.some((segment) => segment.length < MIN_SEGMENT_CHARS)) {
    return false;
  }
  let from = 0;
  for (const segment of segments) {
    const index = haystack.indexOf(segment, from);
    if (index < 0) return false;
    from = index + segment.length;
  }
  return true;
}

/** Visible text of an HTML page plus its title and description metadata. */
export function extractPageText(html: string): string {
  // A bare VirtualConsole drops the page's CSS/script parse errors.
  const dom = new JSDOM(html, { virtualConsole: new VirtualConsole() });
  const { document } = dom.window;
  for (const node of document.querySelectorAll(
    "script, style, noscript, template, svg",
  )) {
    node.remove();
  }
  const meta = [
    'meta[name="description"]',
    'meta[property="og:description"]',
    'meta[property="og:title"]',
    'meta[name="twitter:description"]',
  ]
    .map((selector) =>
      document.querySelector(selector)?.getAttribute("content"),
    )
    .filter((value): value is string => Boolean(value));
  const title = document.querySelector("title")?.textContent ?? "";
  // Block elements become line breaks so words of adjacent blocks don't fuse.
  for (const node of document.querySelectorAll(
    "p, div, li, h1, h2, h3, h4, h5, h6, br, tr, section, article",
  )) {
    node.append(document.createTextNode(" "));
  }
  const body = document.body?.textContent ?? "";
  dom.window.close();
  return [title, ...meta, body].join("\n");
}

export type PageReader = (url: string) => Promise<string | null>;

/** Reads a public page as text; null when it cannot be read. */
export const readPublicPage: PageReader = async (url) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS);
  try {
    const response: PublicFetchResponse = await fetchPublicUrl(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
      },
    });
    if (!response.ok) {
      await response.body
        ?.getReader()
        .cancel()
        .catch(() => undefined);
      return null;
    }
    const contentType = response.headers.get("content-type") ?? "";
    const isHtml = /html|xml/i.test(contentType) || contentType === "";
    const isText = /^text\//i.test(contentType) || /json/i.test(contentType);
    if (!isHtml && !isText) {
      await response.body
        ?.getReader()
        .cancel()
        .catch(() => undefined);
      return null;
    }
    const raw = await readTextWithLimit(response, MAX_PAGE_BYTES);
    return isHtml ? extractPageText(raw) : raw;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

function sameAddress(left: string | null | undefined, right: string): boolean {
  if (!left) return false;
  try {
    const a = new URL(left);
    const b = new URL(right);
    const path = (url: URL) => url.pathname.replace(/\/+$/, "");
    return (
      a.hostname.replace(/^www\./, "") === b.hostname.replace(/^www\./, "") &&
      path(a) === path(b)
    );
  } catch {
    return false;
  }
}

/**
 * Checks every fact's quote against its page. Quotes citing the job posting
 * are also checked against the job description Boussole already stored, since
 * many job boards block automated reads.
 */
export async function checkFactQuotes(
  facts: RawResearchFact[],
  job: Pick<
    Job,
    "jobUrl" | "jobUrlDirect" | "applicationLink" | "jobDescription"
  >,
  readPage: PageReader = readPublicPage,
): Promise<CompanyResearchFactCheck[]> {
  const urls = Array.from(new Set(facts.map((fact) => fact.sourceUrl)));
  const pages = new Map<string, string | null>();
  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      const url = urls[next++];
      if (!url) continue;
      pages.set(url, await readPage(url));
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(MAX_PARALLEL_FETCHES, urls.length) }, worker),
  );

  return facts.map((fact) => {
    const citesJobPosting = [
      job.jobUrl,
      job.jobUrlDirect,
      job.applicationLink,
    ].some((address) => sameAddress(address, fact.sourceUrl));
    if (
      citesJobPosting &&
      job.jobDescription &&
      quoteAppearsIn(fact.quote, job.jobDescription)
    ) {
      return "verified";
    }
    const page = pages.get(fact.sourceUrl);
    if (page === null || page === undefined) return "unreachable";
    return quoteAppearsIn(fact.quote, page) ? "verified" : "not_found";
  });
}
