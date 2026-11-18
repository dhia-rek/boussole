/**
 * Reads a job posting from a link for "Add a job". Many career sites build
 * their pages with JavaScript or block plain requests, so the visible page
 * text is often empty. In order of preference:
 *   1. a known public feed (Welcome to the Jungle, Workable),
 *   2. the page's schema.org JobPosting data (most career sites embed it),
 *   3. the page's text (done by the route).
 */
import { fetchPublicUrl } from "@infra/public-url";
import { convert } from "html-to-text";

export type JobPostingFields = {
  title?: string;
  company?: string;
  location?: string;
  contract?: string;
  remote?: string;
  salary?: string;
  postedAt?: string;
  applyUrl?: string;
  description: string;
};

/** Text the existing inference step reads (labelled lines, then the body). */
export function formatJobPosting(fields: JobPostingFields): string {
  const lines = [
    ["Job Title", fields.title],
    ["Company", fields.company],
    ["Location", fields.location],
    ["Contract", fields.contract],
    ["Remote", fields.remote],
    ["Salary", fields.salary],
    ["Posted", fields.postedAt],
    ["Apply", fields.applyUrl],
  ]
    .filter(([, value]) => typeof value === "string" && value.trim())
    .map(([label, value]) => `${label}: ${String(value).trim()}`);
  return [...lines, "", "Description:", fields.description.trim()].join("\n");
}

export function htmlToText(html: string): string {
  return convert(html, {
    wordwrap: false,
    selectors: [
      { selector: "a", options: { ignoreHref: true } },
      { selector: "img", format: "skip" },
    ],
  })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const str = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const list = (value: unknown): unknown[] =>
  Array.isArray(value)
    ? value
    : value === undefined || value === null
      ? []
      : [value];

function joinParts(...parts: Array<string | undefined>): string | undefined {
  const kept = parts.filter((part): part is string => Boolean(part));
  return kept.length > 0 ? [...new Set(kept)].join(", ") : undefined;
}

function salaryText(
  min: unknown,
  max: unknown,
  currency: unknown,
  period: unknown,
): string | undefined {
  const low = typeof min === "number" ? min : Number(min);
  const high = typeof max === "number" ? max : Number(max);
  const hasLow = Number.isFinite(low) && low > 0;
  const hasHigh = Number.isFinite(high) && high > 0;
  if (!hasLow && !hasHigh) return undefined;
  const amount =
    hasLow && hasHigh && low !== high
      ? `${low}–${high}`
      : String(hasLow ? low : high);
  return [amount, str(currency), str(period) ? `per ${str(period)}` : undefined]
    .filter(Boolean)
    .join(" ");
}

// ---------------------------------------------------------------------------
// schema.org JobPosting
// ---------------------------------------------------------------------------

function isJobPosting(node: Record<string, unknown>): boolean {
  return list(node["@type"]).some((type) => type === "JobPosting");
}

function findJobPosting(value: unknown): Record<string, unknown> | null {
  for (const item of list(value)) {
    const node = record(item);
    if (isJobPosting(node)) return node;
    const nested = findJobPosting(node["@graph"]);
    if (nested) return nested;
  }
  return null;
}

/** The first JobPosting in the page's JSON-LD blocks, or null. */
export function jobPostingFromJsonLd(
  scripts: readonly string[],
): JobPostingFields | null {
  for (const script of scripts) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(script);
    } catch {
      continue;
    }
    const node = findJobPosting(parsed);
    if (!node) continue;
    const description = htmlToText(str(node.description) ?? "");
    if (!description) continue;

    const locations = list(node.jobLocation).map((location) => {
      const address = record(record(location).address);
      const country = address.addressCountry;
      return joinParts(
        str(address.addressLocality),
        str(address.addressRegion),
        str(country) ?? str(record(country).name),
      );
    });
    const salary = record(node.baseSalary);
    const amount = record(salary.value);
    return {
      title: str(node.title),
      company: str(record(node.hiringOrganization).name),
      location: joinParts(...locations),
      contract:
        list(node.employmentType).map(str).filter(Boolean).join(", ") ||
        undefined,
      remote:
        str(node.jobLocationType) === "TELECOMMUTE" ? "Remote" : undefined,
      salary: salaryText(
        amount.minValue ?? amount.value,
        amount.maxValue,
        salary.currency,
        amount.unitText,
      ),
      postedAt: str(node.datePosted),
      applyUrl: str(node.url),
      description,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Known public feeds
// ---------------------------------------------------------------------------

const WTTJ_JOB =
  /^https?:\/\/(?:www\.)?welcometothejungle\.com\/([a-z]{2})\/companies\/([^/?#]+)\/jobs\/([^/?#]+)/i;
const WORKABLE_JOB =
  /^https?:\/\/apply\.workable\.com\/(?:([^/?#]+)\/)?j\/([A-Za-z0-9]+)/i;

const WTTJ_CONTRACTS: Record<string, string> = {
  full_time: "CDI (permanent, full-time)",
  temporary: "CDD (fixed-term)",
  internship: "Internship",
  apprenticeship: "Apprenticeship (alternance)",
  freelance: "Freelance",
  part_time: "Part-time",
  vie: "VIE",
};
const WTTJ_REMOTE: Record<string, string> = {
  fulltime: "Full remote",
  partial: "Partial remote",
  punctual: "Occasional remote",
  no: "No remote",
};

async function fetchJson(
  url: string,
  signal: AbortSignal | undefined,
  language?: string,
): Promise<unknown | null> {
  const response = await fetchPublicUrl(url, {
    signal,
    headers: {
      Accept: "application/json",
      ...(language ? { "Accept-Language": language } : {}),
    },
  });
  if (!response.ok) return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function readWelcomeToTheJungle(
  match: RegExpMatchArray,
  signal: AbortSignal | undefined,
): Promise<JobPostingFields | null> {
  const [, language, org, slug] = match;
  const body = record(
    await fetchJson(
      `https://api.welcometothejungle.com/api/v1/organizations/${encodeURIComponent(org ?? "")}/jobs/${encodeURIComponent(slug ?? "")}`,
      signal,
      language === "fr" ? "fr-FR,fr;q=0.9,en;q=0.8" : "en-US,en;q=0.9",
    ),
  );
  const job = record(body.job);
  const sections = [
    htmlToText(str(job.description) ?? ""),
    str(job.profile) ? `Profile:\n${htmlToText(str(job.profile) ?? "")}` : "",
    str(job.recruitment_process)
      ? `Recruitment process:\n${htmlToText(str(job.recruitment_process) ?? "")}`
      : "",
  ].filter(Boolean);
  if (!str(job.name) || sections.length === 0) return null;
  const office = record(job.office);
  return {
    title: str(job.name),
    company: str(record(job.organization).name),
    location: joinParts(str(office.city), str(office.country)),
    contract:
      WTTJ_CONTRACTS[str(job.contract_type) ?? ""] ?? str(job.contract_type),
    remote: WTTJ_REMOTE[str(job.remote) ?? ""],
    salary: salaryText(
      job.salary_min,
      job.salary_max,
      job.salary_currency,
      job.salary_period,
    ),
    postedAt: str(job.published_at),
    applyUrl: str(job.apply_url),
    description: sections.join("\n\n"),
  };
}

async function readWorkable(
  account: string,
  shortcode: string,
  signal: AbortSignal | undefined,
): Promise<JobPostingFields | null> {
  const body = record(
    await fetchJson(
      `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(account)}?details=true`,
      signal,
    ),
  );
  const job = list(body.jobs)
    .map(record)
    .find((candidate) => str(candidate.shortcode) === shortcode);
  if (!job) return null;
  const description = [job.description, job.requirements, job.benefits]
    .map((html) => htmlToText(str(html) ?? ""))
    .filter(Boolean)
    .join("\n\n");
  if (!description) return null;
  const locations = list(job.locations)
    .map(record)
    .filter((location) => location.hidden !== true)
    .map((location) => joinParts(str(location.city), str(location.country)));
  return {
    title: str(job.title),
    company: str(body.name),
    location:
      joinParts(...locations) ?? joinParts(str(job.city), str(job.country)),
    contract: str(job.employment_type),
    remote: job.telecommuting === true ? "Remote" : undefined,
    postedAt: str(job.published_on),
    applyUrl: str(job.application_url),
    description,
  };
}

/**
 * The posting from a known public feed, or null for other sites (and when
 * the feed has nothing). `finalUrl` is the address after redirects, which
 * carries the Workable account for short /j/<code> links.
 */
export async function readJobFromKnownFeed(
  url: string,
  options: { signal?: AbortSignal; finalUrl?: string } = {},
): Promise<JobPostingFields | null> {
  const wttj = url.match(WTTJ_JOB);
  if (wttj) return readWelcomeToTheJungle(wttj, options.signal);

  const workable =
    url.match(WORKABLE_JOB) ?? options.finalUrl?.match(WORKABLE_JOB) ?? null;
  if (workable) {
    const account =
      workable[1] ?? options.finalUrl?.match(WORKABLE_JOB)?.[1] ?? null;
    if (!account || !workable[2]) return null;
    return readWorkable(account, workable[2], options.signal);
  }
  return null;
}

/** Workable short links need the page's final address to find the account. */
export function needsFinalUrl(url: string): boolean {
  const workable = url.match(WORKABLE_JOB);
  return Boolean(workable && !workable[1]);
}
