import { z } from "zod";

/** Job sources for a search in France (plus jobs added by hand). */
export const EXTRACTOR_SOURCE_IDS = [
  "wttj",
  "companyats",
  "linkedin",
  "indeed",
  "glassdoor",
  "adzuna",
  "hiringcafe",
  "startupjobs",
  "wellfound",
  "bravesearch",
  "manual",
] as const;

export type ExtractorSourceId = (typeof EXTRACTOR_SOURCE_IDS)[number];

export interface ExtractorSourceMetadata {
  label: string;
  order: number;
  category: "pipeline" | "manual";
  requiresCredentials?: boolean;
}

export const EXTRACTOR_SOURCE_METADATA: Record<
  ExtractorSourceId,
  ExtractorSourceMetadata
> = {
  wttj: { label: "Welcome to the Jungle", order: 10, category: "pipeline" },
  companyats: {
    label: "Company Career Pages",
    order: 20,
    category: "pipeline",
  },
  linkedin: { label: "LinkedIn", order: 30, category: "pipeline" },
  indeed: { label: "Indeed", order: 40, category: "pipeline" },
  glassdoor: { label: "Glassdoor", order: 50, category: "pipeline" },
  adzuna: {
    label: "Adzuna",
    order: 60,
    category: "pipeline",
    requiresCredentials: true,
  },
  hiringcafe: { label: "Hiring Cafe", order: 70, category: "pipeline" },
  startupjobs: { label: "startup.jobs", order: 80, category: "pipeline" },
  wellfound: { label: "Wellfound", order: 90, category: "pipeline" },
  bravesearch: {
    label: "Brave Search",
    order: 100,
    category: "pipeline",
    requiresCredentials: true,
  },
  manual: { label: "Manual", order: 120, category: "manual" },
};

export const PIPELINE_EXTRACTOR_SOURCE_IDS = EXTRACTOR_SOURCE_IDS.filter(
  (source) => EXTRACTOR_SOURCE_METADATA[source].category === "pipeline",
);

const extractorSourceTuple = EXTRACTOR_SOURCE_IDS as unknown as [
  ExtractorSourceId,
  ...ExtractorSourceId[],
];

export const extractorSourceEnum = z.enum(extractorSourceTuple);

export function isExtractorSourceId(value: string): value is ExtractorSourceId {
  return EXTRACTOR_SOURCE_IDS.includes(value as ExtractorSourceId);
}

/** Display name; jobs found by a source that was later removed keep its id. */
export function sourceLabel(source: ExtractorSourceId | string): string {
  return (
    EXTRACTOR_SOURCE_METADATA[source as ExtractorSourceId]?.label ?? source
  );
}

function sourceOrder(source: ExtractorSourceId | string): number {
  return (
    EXTRACTOR_SOURCE_METADATA[source as ExtractorSourceId]?.order ??
    Number.MAX_SAFE_INTEGER
  );
}

export function sortSources<T extends { source: ExtractorSourceId }>(
  values: T[],
): T[] {
  return [...values].sort(
    (left, right) => sourceOrder(left.source) - sourceOrder(right.source),
  );
}
