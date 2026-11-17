import { AppError, badRequest, upstreamError } from "@infra/errors";
import { logger } from "@infra/logger";
import { sanitizeUnknown } from "@infra/sanitize";
import { getRequestId } from "@server/infra/request-context";
import { ClaudeCliClient } from "@server/services/llm/claude-cli/client";
import type { JsonSchemaDefinition } from "@server/services/llm/types";
import { resolveLlmModel } from "@server/services/modelSelection";
import { normalizeReactiveResumeV5Document } from "@server/services/resume-data/document";
import {
  getResumeSchemaValidationMessage,
  safeParseV5ResumeData,
} from "@server/services/resume-data/schema";
import type { DesignResumeDocument, DesignResumeJson } from "@shared/types";
import { jsonrepair } from "jsonrepair";
import JSZip from "jszip";
import { truncate } from "../llm/utils/string";
import { replaceCurrentDesignResumeDocument } from "./index";

type SupportedImportMediaType =
  | "application/pdf"
  | "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const DESIGN_RESUME_IMPORT_CLI_JSON_SCHEMA: JsonSchemaDefinition = {
  name: "design_resume_import",
  schema: {
    type: "object",
    properties: {
      picture: { type: "object" },
      basics: { type: "object" },
      summary: { type: "object" },
      sections: { type: "object" },
      metadata: { type: "object" },
      customSections: { type: "array" },
    },
    required: [
      "picture",
      "basics",
      "summary",
      "sections",
      "metadata",
      "customSections",
    ],
    additionalProperties: true,
  },
};

type ResumeImportFileInput = {
  fileName: string;
  mediaType?: string | null;
  dataBase64: string;
  /** Optional language slot ("en") — stores a secondary résumé used when a
   *  job is posted in that language. Omit for the primary résumé. */
  language?: string | null;
};

const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024;
const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const SUPPORTED_EXTENSION_TO_MEDIA_TYPE: Record<
  string,
  SupportedImportMediaType
> = {
  pdf: "application/pdf",
  docx: DOCX_MIME,
};

const SYSTEM_PROMPT = `
You extract a resume into a single JSON object.

Rules:
- Extract only information explicitly present in the provided resume input.
- Do not guess, infer, summarize, embellish, or invent missing values.
- Preserve the source language and wording as closely as possible.
- Return JSON only. Do not wrap it in markdown or prose.
- If a field is unknown, use an empty string, empty array, or default placeholder that matches the template.
- For rich text descriptions and summaries, preserve structure using simple HTML tags only: <p>, <ul>, <li>, <strong>, <em>.
- Do not add sections or keys that do not exist in the template.
- Keep dates, names, locations, and organization names exactly as written when possible.
`.trim();

type RecordLike = Record<string, unknown>;

function asRecord(value: unknown): RecordLike | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordLike)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toText(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function trimText(value: unknown): string {
  return toText(value).trim();
}

function normalizeFileName(fileName: string): string {
  const trimmed = fileName.trim();
  if (!trimmed) {
    throw badRequest("Resume import requires a file name.");
  }
  if (trimmed.length > 255) {
    throw badRequest("Resume file names must be 255 characters or shorter.");
  }
  return trimmed;
}

function extensionFromFileName(fileName: string): string {
  const match = /\.([^.]+)$/.exec(fileName.toLowerCase());
  return match?.[1] ?? "";
}

function normalizeImportMediaType(input: {
  fileName: string;
  mediaType?: string | null;
}): SupportedImportMediaType {
  const extension = extensionFromFileName(input.fileName);
  const fromExtension = SUPPORTED_EXTENSION_TO_MEDIA_TYPE[extension];
  const normalizedMediaType = input.mediaType?.trim().toLowerCase() ?? "";
  if (normalizedMediaType === "application/pdf") return "application/pdf";
  if (normalizedMediaType === DOCX_MIME) return DOCX_MIME;

  if (
    (!normalizedMediaType ||
      normalizedMediaType === "application/octet-stream") &&
    fromExtension
  ) {
    return fromExtension;
  }

  throw badRequest("Only PDF and DOCX resumes are supported.");
}

function normalizeBase64Payload(dataBase64: string): string {
  const trimmed = dataBase64.trim();
  if (!trimmed) {
    throw badRequest("Resume import requires file data.");
  }

  const normalized = trimmed.replace(/\s+/g, "");
  if (!normalized) {
    throw badRequest("Resume import requires file data.");
  }
  if (
    normalized.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)
  ) {
    throw badRequest("Resume file data must be valid base64.");
  }

  const paddingLength = normalized.endsWith("==")
    ? 2
    : normalized.endsWith("=")
      ? 1
      : 0;
  const estimatedByteLength = (normalized.length / 4) * 3 - paddingLength;
  if (estimatedByteLength > MAX_IMPORT_FILE_BYTES) {
    throw badRequest("Resume files must be 10 MB or smaller.");
  }

  return normalized;
}

function decodeBase64Payload(dataBase64: string): {
  decoded: Buffer;
  normalizedBase64: string;
} {
  const normalized = normalizeBase64Payload(dataBase64);
  const decoded = Buffer.from(normalized, "base64");
  if (decoded.toString("base64") !== normalized) {
    throw badRequest("Resume file data must be valid base64.");
  }

  if (decoded.byteLength === 0) {
    throw badRequest("Resume file data must not be empty.");
  }

  if (decoded.byteLength > MAX_IMPORT_FILE_BYTES) {
    throw badRequest("Resume files must be 10 MB or smaller.");
  }

  return { decoded, normalizedBase64: normalized };
}

function buildUserPrompt(): string {
  const template = {
    picture: {
      hidden: false,
      url: "",
      size: 80,
      rotation: 0,
      aspectRatio: 1,
      borderRadius: 0,
      borderColor: "rgba(0, 0, 0, 0.5)",
      borderWidth: 0,
      shadowColor: "rgba(0, 0, 0, 0.5)",
      shadowWidth: 0,
    },
    basics: {
      name: "",
      headline: "",
      email: "",
      phone: "",
      location: "",
      website: { url: "", label: "" },
      customFields: [],
    },
    summary: {
      title: "",
      columns: 1,
      hidden: false,
      content: "",
    },
    sections: {
      profiles: {
        title: "",
        columns: 1,
        hidden: false,
        items: [
          {
            id: "",
            hidden: false,
            icon: "",
            network: "",
            username: "",
            website: { url: "", label: "" },
            options: { showLinkInTitle: false },
          },
        ],
      },
      experience: {
        title: "",
        columns: 1,
        hidden: false,
        items: [
          {
            id: "",
            hidden: false,
            company: "",
            position: "",
            location: "",
            period: "",
            website: { url: "", label: "" },
            description: "",
            roles: [],
            options: { showLinkInTitle: false },
          },
        ],
      },
      education: {
        title: "",
        columns: 1,
        hidden: false,
        items: [
          {
            id: "",
            hidden: false,
            school: "",
            degree: "",
            area: "",
            grade: "",
            location: "",
            period: "",
            website: { url: "", label: "" },
            description: "",
            options: { showLinkInTitle: false },
          },
        ],
      },
      projects: {
        title: "",
        columns: 1,
        hidden: false,
        items: [
          {
            id: "",
            hidden: false,
            name: "",
            period: "",
            website: { url: "", label: "" },
            description: "",
            options: { showLinkInTitle: false },
          },
        ],
      },
      skills: {
        title: "",
        columns: 1,
        hidden: false,
        items: [
          {
            id: "",
            hidden: false,
            icon: "",
            name: "",
            proficiency: "",
            level: 0,
            keywords: [],
          },
        ],
      },
      languages: {
        title: "",
        columns: 1,
        hidden: false,
        items: [
          {
            id: "",
            hidden: false,
            language: "",
            fluency: "",
            level: 0,
          },
        ],
      },
      interests: {
        title: "",
        columns: 1,
        hidden: false,
        items: [
          {
            id: "",
            hidden: false,
            icon: "",
            name: "",
            keywords: [],
          },
        ],
      },
      awards: {
        title: "",
        columns: 1,
        hidden: false,
        items: [
          {
            id: "",
            hidden: false,
            title: "",
            awarder: "",
            date: "",
            website: { url: "", label: "" },
            description: "",
            options: { showLinkInTitle: false },
          },
        ],
      },
      certifications: {
        title: "",
        columns: 1,
        hidden: false,
        items: [
          {
            id: "",
            hidden: false,
            title: "",
            issuer: "",
            date: "",
            website: { url: "", label: "" },
            description: "",
            options: { showLinkInTitle: false },
          },
        ],
      },
      publications: {
        title: "",
        columns: 1,
        hidden: false,
        items: [
          {
            id: "",
            hidden: false,
            title: "",
            publisher: "",
            date: "",
            website: { url: "", label: "" },
            description: "",
            options: { showLinkInTitle: false },
          },
        ],
      },
      volunteer: {
        title: "",
        columns: 1,
        hidden: false,
        items: [
          {
            id: "",
            hidden: false,
            organization: "",
            location: "",
            period: "",
            website: { url: "", label: "" },
            description: "",
            options: { showLinkInTitle: false },
          },
        ],
      },
      references: {
        title: "",
        columns: 1,
        hidden: false,
        items: [
          {
            id: "",
            hidden: false,
            name: "",
            position: "",
            website: { url: "", label: "" },
            phone: "",
            description: "",
            options: { showLinkInTitle: false },
          },
        ],
      },
    },
    customSections: [],
    metadata: {
      template: "onyx",
      layout: {
        sidebarWidth: 35,
        pages: [
          {
            fullWidth: false,
            main: [
              "profiles",
              "summary",
              "education",
              "experience",
              "projects",
              "volunteer",
              "references",
            ],
            sidebar: [
              "skills",
              "certifications",
              "awards",
              "languages",
              "interests",
              "publications",
            ],
          },
        ],
      },
      css: { enabled: false, value: "" },
      page: {
        gapX: 4,
        gapY: 6,
        marginX: 14,
        marginY: 12,
        format: "a4",
        locale: "en-US",
        hideIcons: false,
      },
      design: {
        colors: {
          primary: "rgba(220, 38, 38, 1)",
          text: "rgba(0, 0, 0, 1)",
          background: "rgba(255, 255, 255, 1)",
        },
        level: {
          icon: "star",
          type: "circle",
        },
      },
      typography: {
        body: {
          fontFamily: "IBM Plex Serif",
          fontWeights: ["400", "500"],
          fontSize: 10,
          lineHeight: 1.5,
        },
        heading: {
          fontFamily: "IBM Plex Serif",
          fontWeights: ["600"],
          fontSize: 14,
          lineHeight: 1.5,
        },
      },
      notes: "",
    },
  };

  return `
The resume input is provided in the request.
Return the final JSON object only.

Use this exact target shape and keys:
${JSON.stringify(template, null, 2)}
`.trim();
}

function decodeXmlEntities(value: string): string {
  return value.replace(
    /&(?:#x([0-9a-fA-F]+)|#([0-9]+)|amp|lt|gt|quot|apos);/g,
    (match, hex, dec) => {
      if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
      if (dec) return String.fromCodePoint(Number.parseInt(dec, 10));
      switch (match) {
        case "&amp;":
          return "&";
        case "&lt;":
          return "<";
        case "&gt;":
          return ">";
        case "&quot;":
          return '"';
        case "&apos;":
          return "'";
        default:
          return match;
      }
    },
  );
}

function normalizeDocxXmlText(xml: string): string {
  return decodeXmlEntities(
    xml
      .replace(/<w:tab\b[^>]*\/>/g, "\t")
      .replace(/<w:br\b[^>]*\/>/g, "\n")
      .replace(/<w:cr\b[^>]*\/>/g, "\n")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<\/w:tr>/g, "\n")
      .replace(/<\/w:tc>/g, "\t")
      .replace(/<w:t\b[^>]*>/g, "")
      .replace(/<\/w:t>/g, "")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function extractPdfText(decoded: Buffer): Promise<string> {
  try {
    const { default: pdfParse } = await import("pdf-parse");
    const data = (await pdfParse(decoded)) as { text?: string };
    const text = typeof data?.text === "string" ? data.text.trim() : "";
    if (!text) {
      throw badRequest("Resume PDF did not contain readable text.");
    }
    return text;
  } catch (error) {
    if (error instanceof AppError && error.status === 400) {
      throw error;
    }
    throw badRequest("Resume PDF file could not be read or is encrypted.");
  }
}

async function extractDocxText(decoded: Buffer): Promise<string> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(decoded);
  } catch {
    throw badRequest("Resume DOCX file could not be read.");
  }

  const documentXml = zip.file("word/document.xml");
  if (!documentXml) {
    throw badRequest("Resume DOCX file is missing document content.");
  }

  const xml = await documentXml.async("string");
  const text = normalizeDocxXmlText(xml);
  if (!text) {
    throw badRequest("Resume DOCX file did not contain readable text.");
  }

  return text;
}

function buildTextExtractPrompt(
  documentText: string,
  fileName: string,
  source: "DOCX" | "PDF",
): string {
  const sourceLine =
    source === "DOCX"
      ? "The resume file was uploaded as DOCX and converted locally to plain text before extraction."
      : "The resume file was uploaded as PDF and converted locally to plain text before extraction.";
  return `
${sourceLine}
File name: ${fileName}

Extracted resume text:
${documentText}

${buildUserPrompt()}
`.trim();
}

function extractProbablyJsonObject(content: string): string {
  const stripped = content
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  const firstBrace = stripped.indexOf("{");
  const lastBrace = stripped.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return stripped;
  }
  return stripped.slice(firstBrace, lastBrace + 1).trim();
}

function repairLikelyJson(candidate: string): string {
  return candidate
    .replace(/^\uFEFF/, "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/,\s*([}\]])/g, "$1")
    .replaceAll("\u0000", "")
    .trim();
}

function parseImportedResumeJson(content: string): unknown {
  const candidate = extractProbablyJsonObject(content);
  const repaired = repairLikelyJson(candidate);

  try {
    return JSON.parse(repaired) as unknown;
  } catch {
    try {
      return JSON.parse(jsonrepair(repaired)) as unknown;
    } catch (error) {
      throw badRequest(
        `Imported resume did not produce valid JSON. ${error instanceof Error ? error.message : "Unknown parsing error."}`,
      );
    }
  }
}

function filterRequiredItems(items: unknown, requiredField: string): unknown[] {
  return asArray(items).filter((item) =>
    trimText(asRecord(item)?.[requiredField]),
  );
}

function sanitizeNormalizedResume(input: unknown): DesignResumeJson {
  const normalized = normalizeReactiveResumeV5Document(input) as RecordLike;
  const sections = asRecord(normalized.sections) ?? {};

  normalized.sections = {
    ...sections,
    profiles: {
      ...asRecord(sections.profiles),
      items: filterRequiredItems(asRecord(sections.profiles)?.items, "network"),
    },
    experience: {
      ...asRecord(sections.experience),
      items: filterRequiredItems(
        asRecord(sections.experience)?.items,
        "company",
      ),
    },
    education: {
      ...asRecord(sections.education),
      items: filterRequiredItems(asRecord(sections.education)?.items, "school"),
    },
    projects: {
      ...asRecord(sections.projects),
      items: filterRequiredItems(asRecord(sections.projects)?.items, "name"),
    },
    skills: {
      ...asRecord(sections.skills),
      items: filterRequiredItems(asRecord(sections.skills)?.items, "name"),
    },
    languages: {
      ...asRecord(sections.languages),
      items: filterRequiredItems(
        asRecord(sections.languages)?.items,
        "language",
      ),
    },
    interests: {
      ...asRecord(sections.interests),
      items: filterRequiredItems(asRecord(sections.interests)?.items, "name"),
    },
    awards: {
      ...asRecord(sections.awards),
      items: filterRequiredItems(asRecord(sections.awards)?.items, "title"),
    },
    certifications: {
      ...asRecord(sections.certifications),
      items: filterRequiredItems(
        asRecord(sections.certifications)?.items,
        "title",
      ),
    },
    publications: {
      ...asRecord(sections.publications),
      items: filterRequiredItems(
        asRecord(sections.publications)?.items,
        "title",
      ),
    },
    volunteer: {
      ...asRecord(sections.volunteer),
      items: filterRequiredItems(
        asRecord(sections.volunteer)?.items,
        "organization",
      ),
    },
    references: {
      ...asRecord(sections.references),
      items: filterRequiredItems(asRecord(sections.references)?.items, "name"),
    },
  };

  const parsed = safeParseV5ResumeData(normalized);
  if (!parsed.success) {
    throw badRequest(
      `Imported resume could not be normalized into a valid Design Resume. ${getResumeSchemaValidationMessage(parsed.error)}`,
    );
  }

  return parsed.data as DesignResumeJson;
}

/** Claude reads the CV as extracted text and returns the structured CV. */
async function extractWithClaude(args: {
  model: string;
  mediaType: SupportedImportMediaType;
  fileName: string;
  documentText: string;
  requestId: string | undefined;
}): Promise<string> {
  const source: "DOCX" | "PDF" =
    args.mediaType === "application/pdf" ? "PDF" : "DOCX";
  const userContent = buildTextExtractPrompt(
    args.documentText,
    args.fileName,
    source,
  );
  const client = new ClaudeCliClient();
  try {
    const { text } = await client.callJson({
      model: args.model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      jsonSchema: DESIGN_RESUME_IMPORT_CLI_JSON_SCHEMA,
    });
    if (!text?.trim()) {
      throw upstreamError(
        "Claude returned an empty response while reading your CV.",
      );
    }
    return text;
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw upstreamError(
      truncate(message, 500),
      args.requestId
        ? { model: args.model, requestId: args.requestId }
        : { model: args.model },
    );
  }
}

export async function importDesignResumeFromFile(
  input: ResumeImportFileInput,
): Promise<DesignResumeDocument> {
  const fileName = normalizeFileName(input.fileName);
  const mediaType = normalizeImportMediaType({
    fileName,
    mediaType: input.mediaType,
  });
  const { decoded } = decodeBase64Payload(input.dataBase64);
  const requestId = getRequestId();

  const model = await resolveLlmModel();

  logger.info("Design resume file import started", {
    requestId: requestId ?? null,
    model,
    fileName,
    mediaType,
    byteSize: decoded.byteLength,
  });

  try {
    const documentText = (
      mediaType === DOCX_MIME
        ? await extractDocxText(decoded)
        : await extractPdfText(decoded)
    ).trim();
    if (!documentText) {
      throw badRequest(
        "No text found in this file. Use a DOCX, or a PDF with selectable text (not a scan).",
      );
    }
    const rawText = await extractWithClaude({
      model,
      mediaType,
      fileName,
      documentText,
      requestId,
    });
    const parsed = parseImportedResumeJson(rawText);
    const normalized = sanitizeNormalizedResume(parsed);
    const saved = await replaceCurrentDesignResumeDocument({
      importedAt: new Date().toISOString(),
      resumeJson: normalized,
      sourceMode: null,
      sourceResumeId: null,
      language: input.language ?? null,
    });

    logger.info("Design resume file import completed", {
      requestId: requestId ?? null,
      model,
      fileName,
      mediaType,
      documentId: saved.id,
    });

    return saved;
  } catch (error) {
    logger.warn("Design resume file import failed", {
      requestId: requestId ?? null,
      model,
      fileName,
      mediaType,
      error: sanitizeUnknown(error),
    });

    if (error instanceof AppError) {
      if (error.status >= 500) {
        throw upstreamError(error.message, error.details);
      }
      throw error;
    }

    const message =
      error instanceof Error ? error.message : "Resume import failed.";

    throw upstreamError(truncate(message, 400));
  }
}
