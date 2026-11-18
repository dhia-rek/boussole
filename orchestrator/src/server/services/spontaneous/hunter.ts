/**
 * Optional Hunter.io lookup (only when the person saved a Hunter API key).
 * Hunter's addresses are estimates, so they are shown as "not checked" with
 * Hunter's own confidence. The payload sent is the company domain only.
 */
import { logger } from "@infra/logger";
import type { OutreachContact } from "@shared/types";

const HUNTER_API = "https://api.hunter.io/v2";
const MAX_HUNTER_CONTACTS = 5;
const HR_WORDS = ["hr", "human", "recruit", "talent", "people", "rh"];

interface HunterEmail {
  value: string;
  confidence: number;
  first_name?: string;
  last_name?: string;
  position?: string;
  department?: string;
}

export function domainOf(website: string | null): string | null {
  if (!website) return null;
  try {
    const url = new URL(
      /^https?:\/\//i.test(website) ? website : `https://${website}`,
    );
    return url.hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

export async function lookupHunterContacts(
  domain: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<OutreachContact[]> {
  try {
    const url = `${HUNTER_API}/domain-search?domain=${encodeURIComponent(domain)}&limit=10&type=personal&api_key=${encodeURIComponent(apiKey)}`;
    const response = await fetchImpl(url, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      logger.warn("Hunter.io lookup failed", { status: response.status });
      return [];
    }
    const data = (await response.json()) as {
      data?: { emails?: HunterEmail[] };
    };
    const isHr = (email: HunterEmail) =>
      HR_WORDS.some((word) =>
        `${email.position ?? ""} ${email.department ?? ""}`
          .toLowerCase()
          .includes(word),
      );
    return (data.data?.emails ?? [])
      .filter((email) => email.confidence >= 50 && email.value)
      .sort(
        (a, b) =>
          Number(isHr(b)) - Number(isHr(a)) || b.confidence - a.confidence,
      )
      .slice(0, MAX_HUNTER_CONTACTS)
      .map((email) => ({
        kind: "email" as const,
        value: email.value.toLowerCase(),
        name:
          [email.first_name, email.last_name].filter(Boolean).join(" ") || null,
        title: email.position ?? null,
        sourceUrl: null,
        check: "not_checked" as const,
        origin: "hunter" as const,
        confidence: email.confidence,
      }));
  } catch (error) {
    logger.warn("Hunter.io lookup failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return [];
  }
}
