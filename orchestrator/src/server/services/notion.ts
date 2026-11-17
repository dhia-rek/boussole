import { logger } from "@infra/logger";
import { detectLanguage } from "./language-detection";

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

export interface NotionJobPayload {
  id: string;
  title: string;
  employer: string;
  jobUrl: string;
  jobDescription?: string | null;
  location?: string | null;
  source?: string | null;
  suitabilityScore?: number | null;
  salary?: string | null;
  datePosted?: string | null;
}

function makeHeaders(apiKey: string) {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "Notion-Version": NOTION_VERSION,
  };
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

function richText(content: string, max = 2000) {
  return [{ type: "text", text: { content: truncate(content, max) } }];
}

export async function pushJobToNotion(
  job: NotionJobPayload,
  apiKey: string,
  databaseId: string,
): Promise<{ success: boolean; pageId?: string; error?: string }> {
  try {
    const lang = detectLanguage(job.jobDescription ?? job.title);

    const properties: Record<string, unknown> = {
      Name: {
        title: richText(job.title),
      },
      Company: {
        rich_text: richText(job.employer),
      },
      URL: {
        url: job.jobUrl,
      },
      Language: {
        select: { name: lang === "fr" ? "🇫🇷 French" : "🇬🇧 English" },
      },
      Status: {
        select: { name: "📋 To Apply" },
      },
      Source: {
        select: { name: job.source ?? "Unknown" },
      },
    };

    if (job.suitabilityScore != null) {
      properties.Score = { number: job.suitabilityScore };
    }

    if (job.location) {
      properties.Location = { rich_text: richText(job.location) };
    }

    if (job.salary) {
      properties.Salary = { rich_text: richText(job.salary) };
    }

    if (job.datePosted) {
      properties["Date Posted"] = { rich_text: richText(job.datePosted) };
    }

    const descriptionBlock = job.jobDescription
      ? [
          {
            object: "block",
            type: "heading_2",
            heading_2: { rich_text: richText("Job Description") },
          },
          {
            object: "block",
            type: "paragraph",
            paragraph: {
              rich_text: richText(job.jobDescription, 1900),
            },
          },
        ]
      : [];

    const body = {
      parent: { database_id: databaseId },
      properties,
      children: [
        {
          object: "block",
          type: "heading_2",
          heading_2: { rich_text: richText("CV Notes") },
        },
        {
          object: "block",
          type: "paragraph",
          paragraph: {
            rich_text: richText(
              lang === "fr"
                ? "[ Coller ici le CV adapté en français ]"
                : "[ Paste tailored CV here ]",
            ),
          },
        },
        {
          object: "block",
          type: "heading_2",
          heading_2: { rich_text: richText("Cover Letter / Cold Email") },
        },
        {
          object: "block",
          type: "paragraph",
          paragraph: {
            rich_text: richText(
              lang === "fr"
                ? "[ Lettre de motivation ou email de candidature spontanée ]"
                : "[ Cover letter or cold email draft ]",
            ),
          },
        },
        ...descriptionBlock,
        {
          object: "block",
          type: "heading_2",
          heading_2: { rich_text: richText("Feedback") },
        },
        {
          object: "block",
          type: "paragraph",
          paragraph: { rich_text: richText("[ Notes on recruiter replies ]") },
        },
      ],
    };

    const res = await fetch(`${NOTION_API}/pages`, {
      method: "POST",
      headers: makeHeaders(apiKey),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      logger.warn("Notion page creation failed", {
        status: res.status,
        err,
        jobId: job.id,
      });
      return { success: false, error: `Notion API ${res.status}: ${err}` };
    }

    const data = (await res.json()) as { id: string };
    logger.info("Job pushed to Notion", { jobId: job.id, pageId: data.id });
    return { success: true, pageId: data.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.warn("Notion sync error", { jobId: job.id, error: message });
    return { success: false, error: message };
  }
}
