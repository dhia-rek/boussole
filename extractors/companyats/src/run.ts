import { normalizeCountryKey } from "@shared/location-support.js";
import type { CreateJobInput } from "@shared/types/jobs";
import { htmlToPlainText } from "@shared/utils/string.js";
import { ATS_COMPANIES, type AtsCompany } from "./companies";

const FETCH_TIMEOUT_MS = 20_000;
const USER_AGENT =
  "Mozilla/5.0 (compatible; BoussoleJobSearch/1.0; personal job search)";
/** Boards fetched in parallel; batches are spaced by `pauseMs`. */
const BOARD_CONCURRENCY = 4;
const DEFAULT_PAUSE_MS = 200;
/** SmartRecruiters pages hold 100 postings; never read more than this many. */
const SMARTRECRUITERS_MAX_PAGES = 10;
/** Detail requests (descriptions) per SmartRecruiters company and run. */
export const SMARTRECRUITERS_MAX_DETAILS = 30;
const DETAIL_CONCURRENCY = 3;
/** Consecutive timeouts / server errors after which a platform is skipped for
 *  the rest of the run (an unresponsive host would otherwise cost one timeout
 *  per remaining board). */
export const PLATFORM_FAILURE_LIMIT = 2;

/** AI / ML / data keywords. Without search terms a role is kept when its
 *  title or description contains one (broad net, legacy behaviour); with
 *  search terms only the title is checked, because AI-native companies
 *  mention AI in every description, sales roles included. */
const AI_KEYWORDS = [
  "machine learning",
  "deep learning",
  "data scien",
  "data engineer",
  "computer vision",
  "nlp",
  "natural language",
  "llm",
  "generative ai",
  "ml engineer",
  "ml ops",
  "mlops",
  "artificial intelligence",
  "intelligence artificielle",
  " ai ",
  " ai/",
  "ai engineer",
  "ai researcher",
  " ia ",
  " ia/",
];

/** Light location gate so a France-based search isn't flooded with US-only
 *  roles. Empty/remote/EU/France pass; precise matching is done downstream. */
const LOCATION_ALLOW = [
  "remote",
  "europe",
  "eu",
  "france",
  "paris",
  "lyon",
  "toulouse",
  "nantes",
  "lille",
  "bordeaux",
  "worldwide",
  "anywhere",
];

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  apos: "'",
  quot: '"',
  rsquo: "'",
  lsquo: "'",
  rdquo: '"',
  ldquo: '"',
  ndash: "–",
  mdash: "—",
  hellip: "…",
};

/** Single-pass entity decoding (`&amp;lt;` becomes `&lt;`, not `<`). */
function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
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

export function stripHtml(html: string): string {
  // Greenhouse returns `content` entity-escaped (`&lt;p&gt;…`): decode it into
  // real markup first, otherwise the tags survive as literal text.
  const markup = /&lt;\/?[a-z]/i.test(html) ? decodeEntities(html) : html;
  return decodeEntities(
    markup
      .replace(/<\/(p|div|li|h[1-6])>|<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Internship-type job titles across the languages these boards use
 * (FR "stage"/"alternance", DE "Praktikum"/"Werkstudent", ES "prácticas",
 * UK "placement", plus graduate programmes). Used for internship-only runs.
 */
const INTERNSHIP_TITLE =
  /\b(?:interns?|internships?|stages?|stagiaires?|alternan(?:ce|ts?|tes?)|apprenti(?:e|es|s)?|apprentices?|apprenticeships?|trainees?|placements?|graduates?|praktik(?:um|ant|antin)|werkstudent(?:in)?|pr[aá]cticas|becari[oa]s?)\b/i;

export function isInternshipTitle(title: string): boolean {
  return INTERNSHIP_TITLE.test(title);
}

/**
 * True when every search term asks for an internship ("Stage IA",
 * "Machine Learning Intern"). The company boards list mostly full-time roles,
 * so such searches only keep internship-type titles instead of sending
 * hundreds of senior roles to scoring.
 */
export function searchTermsWantInternships(terms: readonly string[]): boolean {
  const meaningful = terms.map((term) => term.trim()).filter(Boolean);
  return meaningful.length > 0 && meaningful.every(isInternshipTitle);
}

// ---------------------------------------------------------------------------
// Search-term matching (same rules as the Welcome to the Jungle extractor)
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

function tokenize(value: string): string[] {
  return rawTokens(value).map(singular);
}

function termWords(term: string): string[] {
  return [
    ...new Set(
      rawTokens(term)
        .filter((token) => !STOP_WORDS.has(token))
        .map(singular),
    ),
  ];
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

type TermMatcher = readonly TokenAlternatives[];

function buildTermMatcher(term: string): TermMatcher | null {
  const words = termWords(term);
  if (words.length === 0) return null;
  return words.map((word) => TOKEN_ALTERNATIVES[word] ?? [[word]]);
}

function matchesTerm(
  titleTokens: ReadonlySet<string>,
  matcher: TermMatcher,
): boolean {
  return matcher.every((alternatives) =>
    alternatives.some((tokens) =>
      tokens.every((token) => titleTokens.has(token)),
    ),
  );
}

/** Internship / apprenticeship wording (narrow: graduate programmes and
 *  placements are permanent junior roles and stay). */
const INTERNSHIP_WORDS =
  /\b(?:stages?|stagiaires?|interns?|internships?|alternan(?:ce|ts?|tes?)|apprenti(?:e|es|s)?|apprentissage|apprentices?|apprenticeships?|trainees?)\b/;

export function mentionsInternship(text: string): boolean {
  return INTERNSHIP_WORDS.test(foldText(text));
}

/** Business functions that are never what a technical search is after. */
const NON_TECH_TITLE =
  /\b(?:sales|account executive|account manager|business develop(?:er|ment)|sdr|bdr|recruit(?:er|ing|ment)|talent acquisition|people partner|hrbp|comptable|accountant|accounting|legal|counsel|juriste|paralegal|office manager|customer success|executive assistant)\b/;

function isAiRole(title: string, description: string): boolean {
  const haystack = ` ${title} ${description} `.toLowerCase();
  return AI_KEYWORDS.some((kw) => haystack.includes(kw));
}

/**
 * Scores how well a role fits the run: 2 = its title contains every word of
 * a search term, 1 = related (AI/ML/data title, or at least two words shared
 * with the search terms, e.g. "Junior Data & Automation Engineer"), 0 = drop.
 * Without search terms, any AI/ML/data role (title or description) scores 1.
 */
export function createRoleRanker(
  searchTerms: readonly string[],
): (title: string, description: string) => number {
  const terms = searchTerms.map((term) => term.trim()).filter(Boolean);
  if (terms.length === 0) {
    return (title, description) => (isAiRole(title, description) ? 1 : 0);
  }
  const matchers = terms
    .map(buildTermMatcher)
    .filter((matcher): matcher is TermMatcher => matcher !== null);
  const vocabulary = new Set(
    terms.flatMap((term) =>
      termWords(term).flatMap((word) =>
        word === "ai" || word === "ia" ? ["ai", "ia"] : [word],
      ),
    ),
  );
  return (title) => {
    const tokens = new Set(tokenize(title));
    if (matchers.some((matcher) => matchesTerm(tokens, matcher))) return 2;
    if (NON_TECH_TITLE.test(foldText(title))) return 0;
    if (isAiRole(title, "")) return 1;
    let shared = 0;
    for (const word of vocabulary) {
      if (tokens.has(word)) shared += 1;
    }
    return shared >= 2 ? 1 : 0;
  };
}

function locationAllowed(location: string): boolean {
  const loc = location.trim().toLowerCase();
  if (!loc) return true;
  return LOCATION_ALLOW.some((token) => loc.includes(token));
}

const COUNTRY_CODES: Readonly<Record<string, string>> = {
  austria: "at",
  belgium: "be",
  canada: "ca",
  france: "fr",
  germany: "de",
  ireland: "ie",
  italy: "it",
  luxembourg: "lu",
  netherlands: "nl",
  portugal: "pt",
  spain: "es",
  switzerland: "ch",
  "united kingdom": "gb",
  "united states": "us",
};

/** ISO code for the selected country (used by APIs that filter by country). */
export function resolveCountryCode(
  country: string | undefined,
): string | undefined {
  if (!country?.trim()) return undefined;
  return COUNTRY_CODES[normalizeCountryKey(country)];
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

type FetchResult<T> = { ok: true; data: T } | { ok: false; reason: string };

/** Never throws: a dead board must not fail the whole run, but the reason is
 *  kept so it can be reported instead of silently looking like "0 roles". */
async function fetchJson(
  url: string,
  fetchImpl: typeof fetch,
): Promise<FetchResult<unknown>> {
  try {
    const res = await fetchImpl(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: "application/json", "user-agent": USER_AGENT },
    });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    return { ok: true, data: (await res.json()) as unknown };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "request failed",
    };
  }
}

async function fetchText(
  url: string,
  fetchImpl: typeof fetch,
): Promise<FetchResult<string>> {
  try {
    const res = await fetchImpl(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        accept: "application/rss+xml, application/xml;q=0.9, */*;q=0.8",
        "user-agent": USER_AGENT,
      },
    });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    return { ok: true, data: await res.text() };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "request failed",
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function joinParts(...parts: string[]): string {
  return parts.filter(Boolean).join(", ");
}

function uniqueJoin(values: string[], separator = "; "): string {
  return [...new Set(values.filter(Boolean))].join(separator);
}

function isJob(job: CreateJobInput | null): job is CreateJobInput {
  return job !== null;
}

// ---------------------------------------------------------------------------
// Boards
// ---------------------------------------------------------------------------

interface BoardResult {
  jobs: CreateJobInput[];
  /** Set when the board could not be read (HTTP error, timeout, bad payload). */
  error?: string;
}

interface BoardContext {
  fetchImpl: typeof fetch;
  countryCode?: string;
  pauseMs: number;
  /** Applies the run's filters and per-company cap. */
  select: (jobs: CreateJobInput[]) => CreateJobInput[];
  shouldCancel?: () => boolean;
}

async function fetchGreenhouse(
  company: AtsCompany,
  ctx: BoardContext,
): Promise<BoardResult> {
  const result = await fetchJson(
    `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(
      company.slug,
    )}/jobs?content=true`,
    ctx.fetchImpl,
  );
  if (!result.ok) return { jobs: [], error: result.reason };
  const jobs = asRecord(result.data).jobs;
  if (!Array.isArray(jobs)) {
    return { jobs: [], error: "unexpected payload (no jobs array)" };
  }
  return {
    jobs: jobs.map((raw) => {
      const job = asRecord(raw);
      const description = stripHtml(str(job.content));
      return {
        source: "companyats",
        title: str(job.title),
        employer: company.name,
        jobUrl: str(job.absolute_url),
        location: str(asRecord(job.location).name) || undefined,
        jobDescription: description || undefined,
        // first_published is the real posting date; updated_at moves on edits.
        datePosted:
          str(job.first_published) || str(job.updated_at) || undefined,
        sourceJobId: job.id != null ? String(job.id) : undefined,
      };
    }),
  };
}

async function fetchLever(
  company: AtsCompany,
  ctx: BoardContext,
): Promise<BoardResult> {
  const result = await fetchJson(
    `https://api.lever.co/v0/postings/${encodeURIComponent(
      company.slug,
    )}?mode=json`,
    ctx.fetchImpl,
  );
  if (!result.ok) return { jobs: [], error: result.reason };
  if (!Array.isArray(result.data)) {
    return { jobs: [], error: "unexpected payload (expected an array)" };
  }
  return {
    jobs: result.data.map((raw) => {
      const job = asRecord(raw);
      const categories = asRecord(job.categories);
      // Responsibilities / requirements live in `lists`, not in the summary.
      const lists = asArray(job.lists)
        .map((entry) => {
          const list = asRecord(entry);
          return [str(list.text), stripHtml(str(list.content))]
            .filter(Boolean)
            .join("\n");
        })
        .filter(Boolean);
      const description = [
        str(job.descriptionPlain) || stripHtml(str(job.description)),
        ...lists,
        str(job.additionalPlain),
      ]
        .filter(Boolean)
        .join("\n\n");
      const workplace = str(job.workplaceType).toLowerCase();
      return {
        source: "companyats",
        title: str(job.text),
        employer: company.name,
        jobUrl: str(job.hostedUrl),
        applicationLink: str(job.applyUrl) || undefined,
        location: str(categories.location) || undefined,
        jobDescription: description || undefined,
        datePosted:
          typeof job.createdAt === "number"
            ? new Date(job.createdAt).toISOString()
            : undefined,
        jobType: str(categories.commitment) || undefined,
        isRemote: workplace ? workplace === "remote" : undefined,
        sourceJobId: str(job.id) || undefined,
      };
    }),
  };
}

const ASHBY_EMPLOYMENT_TYPES: Record<string, string> = {
  FullTime: "Full-time",
  PartTime: "Part-time",
  Intern: "Internship",
  Contract: "Contract",
  Temporary: "Temporary",
};

/** Ashby's public job-posting API (no auth): used by many EU scale-ups. */
async function fetchAshby(
  company: AtsCompany,
  ctx: BoardContext,
): Promise<BoardResult> {
  const result = await fetchJson(
    `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(
      company.slug,
    )}`,
    ctx.fetchImpl,
  );
  if (!result.ok) return { jobs: [], error: result.reason };
  const jobs = asRecord(result.data).jobs;
  if (!Array.isArray(jobs)) {
    return { jobs: [], error: "unexpected payload (no jobs array)" };
  }
  return {
    jobs: jobs
      .map((raw): CreateJobInput | null => {
        const job = asRecord(raw);
        if (job.isListed === false) return null;
        const location = uniqueJoin([
          str(job.location),
          ...asArray(job.secondaryLocations).map((entry) =>
            str(asRecord(entry).location),
          ),
        ]);
        const description =
          str(job.descriptionPlain) || stripHtml(str(job.descriptionHtml));
        return {
          source: "companyats",
          title: str(job.title),
          employer: company.name,
          jobUrl: str(job.jobUrl),
          applicationLink: str(job.applyUrl) || undefined,
          location: location || undefined,
          jobDescription: description || undefined,
          datePosted: str(job.publishedAt) || undefined,
          jobType: ASHBY_EMPLOYMENT_TYPES[str(job.employmentType)] ?? undefined,
          isRemote:
            typeof job.isRemote === "boolean" ? job.isRemote : undefined,
          sourceJobId: str(job.id) || undefined,
        };
      })
      .filter(isJob),
  };
}

/** Workable's public careers widget (one request, descriptions included). */
async function fetchWorkable(
  company: AtsCompany,
  ctx: BoardContext,
): Promise<BoardResult> {
  const result = await fetchJson(
    `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(
      company.slug,
    )}?details=true`,
    ctx.fetchImpl,
  );
  if (!result.ok) return { jobs: [], error: result.reason };
  const jobs = asRecord(result.data).jobs;
  if (!Array.isArray(jobs)) {
    return { jobs: [], error: "unexpected payload (no jobs array)" };
  }
  return {
    jobs: jobs.map((raw) => {
      const job = asRecord(raw);
      const locations = asArray(job.locations)
        .map(asRecord)
        .filter((location) => location.hidden !== true)
        .map((location) =>
          joinParts(str(location.city), str(location.country)),
        );
      const description = [job.description, job.requirements, job.benefits]
        .map((html) => htmlToPlainText(str(html)))
        .filter(Boolean)
        .join("\n\n");
      return {
        source: "companyats",
        title: str(job.title),
        employer: company.name,
        jobUrl: str(job.url) || str(job.shortlink),
        applicationLink: str(job.application_url) || undefined,
        location:
          uniqueJoin([
            ...locations,
            ...(locations.length === 0
              ? [joinParts(str(job.city), str(job.country))]
              : []),
          ]) || undefined,
        isRemote:
          typeof job.telecommuting === "boolean"
            ? job.telecommuting
            : undefined,
        jobDescription: description || undefined,
        datePosted: str(job.published_on) || str(job.created_at) || undefined,
        jobType: str(job.employment_type) || undefined,
        jobLevel: str(job.experience) || undefined,
        sourceJobId: str(job.shortcode) || undefined,
      };
    }),
  };
}

function smartRecruitersPostingUrl(companyId: string, postingId: string) {
  return `https://jobs.smartrecruiters.com/${encodeURIComponent(
    companyId,
  )}/${encodeURIComponent(postingId)}`;
}

function mapSmartRecruitersPosting(
  company: AtsCompany,
  raw: unknown,
): CreateJobInput | null {
  const posting = asRecord(raw);
  const id = str(posting.id);
  const title = str(posting.name);
  if (!id || !title) return null;
  const location = asRecord(posting.location);
  const companyId = str(asRecord(posting.company).identifier) || company.slug;
  return {
    source: "companyats",
    title,
    employer: company.name,
    // Stable canonical URL (the detail's slugged postingUrl redirects here).
    jobUrl: smartRecruitersPostingUrl(companyId, id),
    location:
      str(location.fullLocation) ||
      joinParts(str(location.city), str(location.country).toUpperCase()) ||
      undefined,
    isRemote:
      typeof location.remote === "boolean" ? location.remote : undefined,
    datePosted: str(posting.releasedDate) || undefined,
    jobType: str(asRecord(posting.typeOfEmployment).label) || undefined,
    jobLevel: str(asRecord(posting.experienceLevel).label) || undefined,
    sourceJobId: id,
  };
}

const SMARTRECRUITERS_SECTIONS = [
  "jobDescription",
  "qualifications",
  "additionalInformation",
] as const;

function withSmartRecruitersDetail(
  job: CreateJobInput,
  raw: unknown,
): CreateJobInput {
  const detail = asRecord(raw);
  const sections = asRecord(asRecord(detail.jobAd).sections);
  const description = SMARTRECRUITERS_SECTIONS.map((key) => {
    const section = asRecord(sections[key]);
    const text = htmlToPlainText(str(section.text));
    if (!text) return "";
    const heading = str(section.title);
    return heading ? `${heading}\n${text}` : text;
  })
    .filter(Boolean)
    .join("\n\n");
  const companyDescription = htmlToPlainText(
    str(asRecord(sections.companyDescription).text),
  );
  return {
    ...job,
    jobDescription: description || job.jobDescription,
    applicationLink: str(detail.applyUrl) || job.applicationLink,
    companyDescription: companyDescription || job.companyDescription,
  };
}

/**
 * SmartRecruiters Posting API: list postings (filtered by the selected
 * country when known, paged by 100), keep the ones that pass the run's
 * filters, then fetch descriptions for those only (bounded per company).
 */
async function fetchSmartRecruiters(
  company: AtsCompany,
  ctx: BoardContext,
): Promise<BoardResult> {
  const base = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(
    company.slug,
  )}/postings`;
  const postings: unknown[] = [];
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;
  for (
    let page = 0;
    page < SMARTRECRUITERS_MAX_PAGES && offset < total;
    page++
  ) {
    const params = new URLSearchParams({
      limit: "100",
      offset: String(offset),
    });
    if (ctx.countryCode) params.set("country", ctx.countryCode);
    const result = await fetchJson(`${base}?${params}`, ctx.fetchImpl);
    if (!result.ok) {
      if (page === 0) return { jobs: [], error: result.reason };
      break;
    }
    const data = asRecord(result.data);
    const content = asArray(data.content);
    total = typeof data.totalFound === "number" ? data.totalFound : 0;
    postings.push(...content);
    if (content.length === 0) break;
    offset += content.length;
  }

  const selected = ctx.select(
    postings
      .map((posting) => mapSmartRecruitersPosting(company, posting))
      .filter(isJob),
  );
  const withDetails = selected.slice(0, SMARTRECRUITERS_MAX_DETAILS);
  const detailed: CreateJobInput[] = [];
  for (let start = 0; start < withDetails.length; start += DETAIL_CONCURRENCY) {
    if (ctx.shouldCancel?.()) {
      detailed.push(...withDetails.slice(start));
      break;
    }
    const batch = withDetails.slice(start, start + DETAIL_CONCURRENCY);
    const details = await Promise.all(
      batch.map((job) =>
        fetchJson(
          `${base}/${encodeURIComponent(job.sourceJobId ?? "")}`,
          ctx.fetchImpl,
        ),
      ),
    );
    for (const [index, detail] of details.entries()) {
      const job = batch[index];
      if (!job) continue;
      detailed.push(
        detail.ok ? withSmartRecruitersDetail(job, detail.data) : job,
      );
    }
    if (ctx.pauseMs > 0 && start + DETAIL_CONCURRENCY < withDetails.length) {
      await sleep(ctx.pauseMs);
    }
  }
  return {
    jobs: [...detailed, ...selected.slice(SMARTRECRUITERS_MAX_DETAILS)],
  };
}

function xmlTag(xml: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(
    `<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)</${escaped}>`,
  ).exec(xml);
  return match?.[1] ?? "";
}

function xmlText(value: string): string {
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(value);
  return (cdata ? (cdata[1] ?? "") : decodeEntities(value)).trim();
}

/** Parses a Teamtailor `/jobs.rss` feed. */
export function parseTeamtailorFeed(
  xml: string,
  company: AtsCompany,
): CreateJobInput[] {
  const jobs: CreateJobInput[] = [];
  for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const item = match[1] ?? "";
    const locations = [
      ...item.matchAll(/<tt:location>([\s\S]*?)<\/tt:location>/g),
    ].map((entry) => {
      const body = entry[1] ?? "";
      return joinParts(
        xmlText(xmlTag(body, "tt:city")) || xmlText(xmlTag(body, "tt:name")),
        xmlText(xmlTag(body, "tt:country")),
      );
    });
    const remote = xmlText(xmlTag(item, "remoteStatus")).toLowerCase();
    const published = Date.parse(xmlText(xmlTag(item, "pubDate")));
    const description = htmlToPlainText(xmlText(xmlTag(item, "description")));
    jobs.push({
      source: "companyats",
      title: xmlText(xmlTag(item, "title")),
      employer: company.name,
      jobUrl: xmlText(xmlTag(item, "link")),
      location: uniqueJoin(locations) || undefined,
      isRemote: remote ? remote === "fully" : undefined,
      jobDescription: description || undefined,
      datePosted: Number.isFinite(published)
        ? new Date(published).toISOString()
        : undefined,
      sourceJobId: xmlText(xmlTag(item, "guid")) || undefined,
    });
  }
  return jobs;
}

/** Teamtailor careers-site RSS feed (`<slug>.teamtailor.com` or a custom host). */
async function fetchTeamtailor(
  company: AtsCompany,
  ctx: BoardContext,
): Promise<BoardResult> {
  const host = company.host ?? `${company.slug}.teamtailor.com`;
  const result = await fetchText(`https://${host}/jobs.rss`, ctx.fetchImpl);
  if (!result.ok) return { jobs: [], error: result.reason };
  if (!/<rss[\s>]/i.test(result.data)) {
    return { jobs: [], error: "unexpected payload (not an RSS feed)" };
  }
  return { jobs: parseTeamtailorFeed(result.data, company) };
}

function fetchBoard(
  company: AtsCompany,
  ctx: BoardContext,
): Promise<BoardResult> {
  switch (company.ats) {
    case "greenhouse":
      return fetchGreenhouse(company, ctx);
    case "ashby":
      return fetchAshby(company, ctx);
    case "workable":
      return fetchWorkable(company, ctx);
    case "smartrecruiters":
      return fetchSmartRecruiters(company, ctx);
    case "teamtailor":
      return fetchTeamtailor(company, ctx);
    default:
      return fetchLever(company, ctx);
  }
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

export interface CompanyAtsProgressEvent {
  companyIndex: number;
  companyTotal: number;
  companyName: string;
  collected: number;
  /** Why this company's board could not be read (e.g. "HTTP 404"). */
  boardError?: string;
}

export interface RunCompanyAtsOptions {
  companies?: AtsCompany[];
  /** Run search terms. Without them every AI/ML/data role is kept. */
  searchTerms?: string[];
  /** Selected country (e.g. "france"), used where an API filters by country. */
  country?: string;
  /** Keep only internship-type titles (see searchTermsWantInternships). */
  internshipsOnly?: boolean;
  /** Matching roles kept per company (best match, then newest, first). */
  maxJobsPerCompany?: number;
  /** Pause between board batches in milliseconds (tests pass 0). */
  pauseMs?: number;
  shouldCancel?: () => boolean;
  onProgress?: (event: CompanyAtsProgressEvent) => void;
  fetchImpl?: typeof fetch;
}

export interface CompanyAtsResult {
  success: true;
  jobs: CreateJobInput[];
  /** Boards that could not be read; the run still succeeds with the rest. */
  failedBoards: Array<{ company: string; ats: string; reason: string }>;
}

/** Timeouts, network errors, 429 and 5xx point at the platform, not the board
 *  (a 404 only means that company's board is gone). */
function isPlatformFailure(reason: string): boolean {
  if (/^HTTP (?:429|5\d\d)$/.test(reason)) return true;
  return (
    !reason.startsWith("HTTP ") && !reason.startsWith("unexpected payload")
  );
}

function dateValue(job: CreateJobInput): number {
  const parsed = Date.parse(job.datePosted ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function createJobSelector(options: {
  searchTerms: string[];
  internshipsOnly: boolean;
  maxJobsPerCompany?: number;
}): (jobs: CreateJobInput[]) => CreateJobInput[] {
  const rank = createRoleRanker(options.searchTerms);
  // Internships are skipped unless a search term asks for one (same rule as
  // the Welcome to the Jungle source); internship-only runs keep only them.
  const skipInternships =
    options.searchTerms.length > 0 &&
    !options.internshipsOnly &&
    !options.searchTerms.some(mentionsInternship);
  const cap = options.maxJobsPerCompany;

  return (jobs) => {
    const kept: Array<{ job: CreateJobInput; score: number; index: number }> =
      [];
    for (const [index, job] of jobs.entries()) {
      const title = job.title?.trim() ?? "";
      if (!title || !job.jobUrl) continue;
      if (!locationAllowed(job.location ?? "")) continue;
      if (options.internshipsOnly && !isInternshipTitle(title)) continue;
      if (
        skipInternships &&
        mentionsInternship(`${title} ${job.jobType ?? ""}`)
      ) {
        continue;
      }
      const score = rank(title, job.jobDescription ?? "");
      if (score > 0) kept.push({ job, score, index });
    }
    if (cap === undefined) return kept.map((entry) => entry.job);
    return kept
      .sort(
        (a, b) =>
          b.score - a.score ||
          dateValue(b.job) - dateValue(a.job) ||
          a.index - b.index,
      )
      .slice(0, cap)
      .map((entry) => entry.job);
  };
}

export async function runCompanyAts(
  options: RunCompanyAtsOptions = {},
): Promise<CompanyAtsResult> {
  const companies = options.companies ?? ATS_COMPANIES;
  const searchTerms = (options.searchTerms ?? [])
    .map((term) => term.trim())
    .filter(Boolean);
  const cap =
    options.maxJobsPerCompany !== undefined &&
    Number.isFinite(options.maxJobsPerCompany) &&
    options.maxJobsPerCompany > 0
      ? Math.floor(options.maxJobsPerCompany)
      : undefined;
  const select = createJobSelector({
    searchTerms,
    internshipsOnly: options.internshipsOnly ?? false,
    maxJobsPerCompany: cap,
  });
  const ctx: BoardContext = {
    fetchImpl: options.fetchImpl ?? fetch,
    countryCode: resolveCountryCode(options.country),
    pauseMs: options.pauseMs ?? DEFAULT_PAUSE_MS,
    select,
    shouldCancel: options.shouldCancel,
  };

  const jobs: CreateJobInput[] = [];
  const seen = new Set<string>();
  const failedBoards: CompanyAtsResult["failedBoards"] = [];
  const platformFailures = new Map<string, number>();
  let boardsAttempted = 0;

  for (let start = 0; start < companies.length; start += BOARD_CONCURRENCY) {
    if (options.shouldCancel?.()) break;
    const batch = companies.slice(start, start + BOARD_CONCURRENCY);
    const results = await Promise.all(
      batch.map((company): Promise<BoardResult> => {
        const failures = platformFailures.get(company.ats) ?? 0;
        if (failures >= PLATFORM_FAILURE_LIMIT) {
          return Promise.resolve({
            jobs: [],
            error: `skipped: ${company.ats} is not responding (${failures} consecutive failures)`,
          });
        }
        return fetchBoard(company, ctx);
      }),
    );

    for (const [offset, found] of results.entries()) {
      const company = batch[offset];
      if (!company) continue;
      boardsAttempted += 1;
      if (found.error && !found.error.startsWith("skipped:")) {
        platformFailures.set(
          company.ats,
          isPlatformFailure(found.error)
            ? (platformFailures.get(company.ats) ?? 0) + 1
            : 0,
        );
      } else if (!found.error) {
        platformFailures.set(company.ats, 0);
      }
      if (found.error) {
        failedBoards.push({
          company: company.name,
          ats: company.ats,
          reason: found.error,
        });
      }
      for (const job of select(found.jobs)) {
        if (seen.has(job.jobUrl)) continue;
        seen.add(job.jobUrl);
        jobs.push(job);
      }
      options.onProgress?.({
        companyIndex: start + offset + 1,
        companyTotal: companies.length,
        companyName: company.name,
        collected: jobs.length,
        boardError: found.error,
      });
    }

    if (ctx.pauseMs > 0 && start + BOARD_CONCURRENCY < companies.length) {
      await sleep(ctx.pauseMs);
    }
  }

  // One stale board is expected; every board failing means the source (or the
  // network) is broken and must not look like "0 roles found".
  if (boardsAttempted > 0 && failedBoards.length === boardsAttempted) {
    const sample = failedBoards
      .slice(0, 3)
      .map((board) => `${board.company} (${board.reason})`)
      .join(", ");
    throw new Error(
      `All ${boardsAttempted} company job boards failed to load: ${sample}${failedBoards.length > 3 ? ", …" : ""}`,
    );
  }

  return { success: true, jobs, failedBoards };
}
