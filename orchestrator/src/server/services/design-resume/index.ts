import { existsSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { AppError, badRequest, conflict, notFound } from "@infra/errors";
import { logger } from "@infra/logger";
import { sanitizeUnknown } from "@infra/sanitize";
import { createId } from "@paralleldrive/cuid2";
import { getDataDir } from "@server/config/dataDir";
import * as designResumeRepo from "@server/repositories/design-resume";
import { detectLanguageFromText } from "@server/services/output-language";
import { getResumeSchemaValidationMessage } from "@server/services/resume-data/schema";
import {
  parseV5ResumeData,
  safeParseV5ResumeData,
} from "@server/services/resume-data/schema/v5";
import { getActiveTenantId } from "@server/tenancy/context";
import {
  designResumeAiGuidanceInputSchema,
  normalizeDesignResumeAiGuidance,
  pruneDesignResumeAiGuidanceItems,
} from "@shared/design-resume-ai-guidance";
import {
  designResumeLanguageFromDetected,
  normalizeDesignResumeLanguage,
} from "@shared/design-resume-variants";
import type {
  DesignResumeAiGuidance,
  DesignResumeAsset,
  DesignResumeDocument,
  DesignResumeExportResponse,
  DesignResumeJson,
  DesignResumePatchRequest,
  DesignResumeStatusResponse,
  DesignResumeVariantSummary,
  ResumeProfile,
} from "@shared/types";
import { resolveDesignResumeAssetPath } from "./asset-path";

const DESIGN_RESUME_DIR = join(getDataDir(), "design-resume");
const DESIGN_RESUME_ASSET_DIR = join(DESIGN_RESUME_DIR, "assets");
const DESIGN_RESUME_DEFAULT_ID = "primary";
const IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const LEGACY_REIMPORT_MESSAGE =
  "Your saved CV uses an old format. Import your CV again (PDF, DOCX or JSON) to continue.";
const INVALID_V5_PREFIX =
  "Design Resume must be a valid Reactive Resume v5 document.";

function buildTenantScopedDesignResumeDocumentId(): string {
  return `${DESIGN_RESUME_DEFAULT_ID}_${getActiveTenantId()}`;
}

type JsonPatchOperation = NonNullable<
  DesignResumePatchRequest["operations"]
>[number];

function toBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function toNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function toText(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function formatValidationMessage(prefix: string, error: unknown): string {
  const detail = getResumeSchemaValidationMessage(error);
  if (!detail || detail === "Resume schema validation failed.") {
    return prefix;
  }
  return `${prefix} ${detail}`;
}

/**
 * Every list item needs a unique, non-empty id: per-item AI guidance, project
 * selection and the editor all key off it. File imports used to produce empty
 * ids, so missing or duplicate ids are replaced with fresh ones.
 */
export function ensureDesignResumeItemIds(document: DesignResumeJson): {
  document: DesignResumeJson;
  changed: boolean;
} {
  const seen = new Set<string>();
  let changed = false;

  const fixItems = (items: unknown) => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      const record = asRecord(item);
      if (!record) continue;
      const id = typeof record.id === "string" ? record.id.trim() : "";
      if (!id || seen.has(id)) {
        record.id = createId();
        changed = true;
      } else if (id !== record.id) {
        record.id = id;
        changed = true;
      }
      seen.add(record.id as string);
    }
  };

  for (const section of Object.values(asRecord(document.sections) ?? {})) {
    fixItems(asRecord(section)?.items);
  }
  for (const section of asArray(document.customSections)) {
    fixItems(asRecord(section)?.items);
  }

  return { document, changed };
}

function validateIncomingDesignResumeDocument(
  input: unknown,
): DesignResumeJson {
  let parsed: DesignResumeJson;
  try {
    parsed = parseV5ResumeData(input) as DesignResumeJson;
  } catch (error) {
    throw badRequest(formatValidationMessage(INVALID_V5_PREFIX, error));
  }
  return ensureDesignResumeItemIds(parsed).document;
}

function parseAiGuidanceInput(input: unknown): DesignResumeAiGuidance {
  const parsed = designResumeAiGuidanceInputSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.join(".") || "aiGuidance";
    throw badRequest(
      `Invalid AI guidance at "${path}": ${issue?.message ?? "invalid value"}`,
    );
  }
  return normalizeDesignResumeAiGuidance(parsed.data);
}

function validateStoredDesignResumeDocument(input: unknown): DesignResumeJson {
  const parsed = safeParseV5ResumeData(input);
  if (parsed.success) {
    return parsed.data as DesignResumeJson;
  }
  throw badRequest(LEGACY_REIMPORT_MESSAGE);
}

export function isLegacyDesignResumeError(error: unknown): boolean {
  return error instanceof AppError && error.message === LEGACY_REIMPORT_MESSAGE;
}

function buildDocumentTitle(document: DesignResumeJson): string {
  const basics = asRecord(document.basics);
  const name = toText(basics?.name).trim();
  return name ? `${name} Resume` : "Design Resume";
}

function contentUrlForAsset(assetId: string): string {
  return `/api/design-resume/assets/${encodeURIComponent(assetId)}/content`;
}

function normalizeImageMimeType(input: {
  mimeType?: string | null;
  fileName?: string | null;
}): string {
  const normalizedMimeType = input.mimeType
    ?.split(";")[0]
    ?.trim()
    .toLowerCase();
  if (normalizedMimeType && IMAGE_MIME_TYPES.has(normalizedMimeType)) {
    return normalizedMimeType;
  }

  const extension = input.fileName?.toLowerCase().split(".").pop() ?? "";
  if (extension === "png") return "image/png";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "webp") return "image/webp";

  throw badRequest("Only PNG, JPEG, and WebP images are supported.");
}

function assertImageByteSize(byteLength: number): void {
  if (byteLength > MAX_IMAGE_BYTES) {
    throw badRequest("Images must be 10 MB or smaller.");
  }
}

async function storeDesignResumePictureAsset(input: {
  documentId: string;
  fileName: string;
  mimeType: string;
  data: Buffer;
  updatedAt: string;
}) {
  await ensureStorageDirs();
  assertImageByteSize(input.data.byteLength);

  const assetId = createId();
  const storagePath = join(
    DESIGN_RESUME_ASSET_DIR,
    `${assetId}${extensionForMimeType(input.mimeType)}`,
  );

  try {
    await writeFile(storagePath, input.data);
    await designResumeRepo.insertDesignResumeAsset({
      id: assetId,
      documentId: input.documentId,
      kind: "picture",
      originalName: basename(
        input.fileName || `picture${extname(storagePath)}`,
      ),
      mimeType: input.mimeType,
      byteSize: input.data.byteLength,
      storagePath,
      updatedAt: input.updatedAt,
    });
  } catch (error) {
    await deleteAssetFile(storagePath);
    throw error;
  }

  return { assetId, storagePath };
}

function toDesignResumeAsset(
  row: Awaited<
    ReturnType<typeof designResumeRepo.getDesignResumeAssetById>
  > extends infer T
    ? NonNullable<T>
    : never,
): DesignResumeAsset {
  return {
    id: row.id,
    documentId: row.documentId,
    kind: row.kind,
    originalName: row.originalName,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    contentUrl: contentUrlForAsset(row.id),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

type DesignResumeRow = NonNullable<
  Awaited<ReturnType<typeof designResumeRepo.getPrimaryDesignResumeDocument>>
>;

async function hydrateDocument(
  row: DesignResumeRow | null | undefined,
  primaryId?: string | null,
): Promise<DesignResumeDocument | null> {
  if (!row) return null;
  const resolvedPrimaryId =
    primaryId !== undefined
      ? primaryId
      : ((await designResumeRepo.getPrimaryDesignResumeDocument())?.id ?? null);
  const assets = await designResumeRepo.listDesignResumeAssets(row.id);
  return {
    id: row.id,
    title: row.title,
    resumeJson: validateStoredDesignResumeDocument(row.resumeJson ?? {}),
    revision: row.revision,
    sourceResumeId: row.sourceResumeId ?? null,
    sourceMode: (row.sourceMode as "v4" | "v5" | null) ?? null,
    language: row.language ?? null,
    isPrimary: row.id === resolvedPrimaryId,
    aiGuidance: normalizeDesignResumeAiGuidance(row.aiGuidance),
    importedAt: row.importedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    assets: assets.map(toDesignResumeAsset),
  };
}

function toVariantSummary(
  row: DesignResumeRow,
  primaryId: string | null,
): DesignResumeVariantSummary {
  return {
    id: row.id,
    title: row.title,
    language: row.language ?? null,
    isPrimary: row.id === primaryId,
    revision: row.revision,
    updatedAt: row.updatedAt,
  };
}

function parseDataUrl(input: string): { mimeType: string; data: Buffer } {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(input.trim());
  if (!match) {
    throw badRequest("Image payload must be a base64 data URL.");
  }

  const mimeType = normalizeImageMimeType({ mimeType: match[1] });

  // Base64 expands by roughly 4/3, so we can reject oversized payloads
  // before decoding the entire string into memory.
  const estimatedByteLength = Math.floor((match[2].length * 3) / 4);
  assertImageByteSize(estimatedByteLength);

  const data = Buffer.from(match[2], "base64");
  assertImageByteSize(data.byteLength);

  return {
    mimeType,
    data,
  };
}

function extensionForMimeType(mimeType: string): string {
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/webp") return ".webp";
  return ".jpg";
}

function decodePointerToken(token: string): string {
  return token.replace(/~1/g, "/").replace(/~0/g, "~");
}

function getPointerParent(
  root: Record<string, unknown>,
  path: string,
): {
  parent: Record<string, unknown> | unknown[];
  key: string;
} {
  const tokens = path.split("/").slice(1).map(decodePointerToken);
  if (tokens.length === 0) {
    throw badRequest("Patch path must not target the root document directly.");
  }

  let current: Record<string, unknown> | unknown[] = root;
  for (const token of tokens.slice(0, -1)) {
    if (Array.isArray(current)) {
      const index = token === "-" ? current.length : Number.parseInt(token, 10);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        throw badRequest(`Patch path not found: ${path}`);
      }
      const next = current[index];
      if (!next || typeof next !== "object") {
        throw badRequest(`Patch path not found: ${path}`);
      }
      current = next as Record<string, unknown> | unknown[];
      continue;
    }

    const next = current[token];
    if (!next || typeof next !== "object") {
      throw badRequest(`Patch path not found: ${path}`);
    }
    current = next as Record<string, unknown> | unknown[];
  }

  return { parent: current, key: tokens[tokens.length - 1] ?? "" };
}

function readPointerValue(
  root: Record<string, unknown>,
  path: string,
): unknown {
  if (path === "") return root;
  const { parent, key } = getPointerParent(root, path);
  if (Array.isArray(parent)) {
    if (key === "-") {
      throw badRequest(`Patch path not found: ${path}`);
    }
    const index = Number.parseInt(key, 10);
    if (!Number.isInteger(index) || index < 0 || index >= parent.length) {
      throw badRequest(`Patch path not found: ${path}`);
    }
    return parent[index];
  }
  return parent[key];
}

function applyPatchOperation(
  root: Record<string, unknown>,
  operation: JsonPatchOperation,
) {
  if (operation.path === "" && operation.op === "replace") {
    if (
      !operation.value ||
      typeof operation.value !== "object" ||
      Array.isArray(operation.value)
    ) {
      throw badRequest("Replacing the root document requires an object value.");
    }
    return structuredClone(operation.value) as Record<string, unknown>;
  }

  const { parent, key } = getPointerParent(root, operation.path);
  switch (operation.op) {
    case "add":
    case "replace": {
      if (Array.isArray(parent)) {
        const index = key === "-" ? parent.length : Number.parseInt(key, 10);
        const isValidReplaceIndex =
          operation.op === "replace"
            ? Number.isInteger(index) && index >= 0 && index < parent.length
            : Number.isInteger(index) && index >= 0 && index <= parent.length;
        if (!isValidReplaceIndex) {
          throw badRequest(`Invalid array patch path: ${operation.path}`);
        }
        if (operation.op === "replace") {
          parent[index] = operation.value;
        } else {
          parent.splice(index, 0, operation.value);
        }
      } else {
        parent[key] = operation.value;
      }
      return root;
    }
    case "remove": {
      if (Array.isArray(parent)) {
        const index = Number.parseInt(key, 10);
        if (!Number.isInteger(index) || index < 0 || index >= parent.length) {
          throw badRequest(`Invalid array patch path: ${operation.path}`);
        }
        parent.splice(index, 1);
      } else {
        delete parent[key];
      }
      return root;
    }
    case "copy": {
      if (!operation.from) throw badRequest("Patch copy requires a from path.");
      return applyPatchOperation(root, {
        op: "add",
        path: operation.path,
        value: structuredClone(readPointerValue(root, operation.from)),
      });
    }
    case "move": {
      if (!operation.from) throw badRequest("Patch move requires a from path.");
      const value = structuredClone(readPointerValue(root, operation.from));
      applyPatchOperation(root, { op: "remove", path: operation.from });
      return applyPatchOperation(root, {
        op: "add",
        path: operation.path,
        value,
      });
    }
    case "test": {
      const actual = readPointerValue(root, operation.path);
      if (!isDeepStrictEqual(actual, operation.value)) {
        throw conflict(`Patch test failed for path ${operation.path}.`);
      }
      return root;
    }
    default:
      throw badRequest(
        `Unsupported patch operation: ${sanitizeUnknown(operation.op)}`,
      );
  }
}

function validatePatchedDocument(
  document: Record<string, unknown>,
): DesignResumeJson {
  return validateIncomingDesignResumeDocument(document);
}

function isMissingDesignResumeTableError(error: unknown): boolean {
  const message = String((error as Error)?.message ?? error);
  return (
    (message.includes("no such table") &&
      message.includes("design_resume_documents")) ||
    (message.includes("no such column") && message.includes("tenant_id"))
  );
}

async function ensureStorageDirs(): Promise<void> {
  if (!existsSync(DESIGN_RESUME_ASSET_DIR)) {
    await mkdir(DESIGN_RESUME_ASSET_DIR, { recursive: true });
  }
}

async function deleteAssetFile(storagePath: string): Promise<void> {
  try {
    await unlink(resolveDesignResumeAssetPath(storagePath));
  } catch (error) {
    logger.warn("Failed to delete design resume asset", {
      storagePath,
      error: sanitizeUnknown(error),
    });
  }
}

async function clearDesignResumeAssetsForDocument(
  documentId: string,
): Promise<void> {
  const assets = await designResumeRepo.listDesignResumeAssets(documentId);
  if (assets.length === 0) return;

  await designResumeRepo.deleteDesignResumeAssetsForDocument(documentId);
  await Promise.all(
    assets.map(async (asset) => {
      await deleteAssetFile(asset.storagePath);
    }),
  );
}

/** Selects which CV variant a request targets: a language tag, or the primary CV. */
export type DesignResumeVariantSelector = { language?: string | null };

function resolveSelectorLanguage(
  selector?: DesignResumeVariantSelector | null,
): string | null {
  const raw = selector?.language;
  if (raw === undefined || raw === null || raw === "") return null;
  const language = normalizeDesignResumeLanguage(raw);
  if (!language) {
    throw badRequest(`Unsupported CV language "${String(raw).slice(0, 20)}".`);
  }
  return language;
}

/**
 * Normalizes item ids of a stored CV once (older file imports produced empty
 * ids). Revision and updatedAt are left untouched: ids are not content, so
 * open editors and ready PDFs stay valid.
 */
async function repairStoredItemIds(
  row: DesignResumeRow | null,
): Promise<DesignResumeRow | null> {
  if (!row) return row;
  const parsed = safeParseV5ResumeData(row.resumeJson ?? {});
  if (!parsed.success) return row;
  const { document, changed } = ensureDesignResumeItemIds(
    parsed.data as DesignResumeJson,
  );
  if (!changed) return row;
  const repaired = await designResumeRepo.upsertDesignResumeDocument({
    id: row.id,
    title: row.title,
    resumeJson: document,
    revision: row.revision,
    sourceResumeId: row.sourceResumeId ?? null,
    sourceMode: row.sourceMode ?? null,
    importedAt: row.importedAt ?? null,
    updatedAt: row.updatedAt,
  });
  logger.info("Repaired missing Design Resume item ids", {
    documentId: row.id,
  });
  return repaired ?? row;
}

export async function replaceCurrentDesignResumeDocument(input: {
  importedAt?: string | null;
  resumeJson: DesignResumeJson;
  sourceResumeId: string | null;
  sourceMode: "v4" | "v5" | null;
  /** When set (e.g. "en"), creates or replaces that language variant instead
   *  of the primary CV. */
  language?: string | null;
}): Promise<DesignResumeDocument> {
  const language = resolveSelectorLanguage({ language: input.language });
  // Each language is its own row. The base id is deterministic per tenant, so
  // a language variant uses `<base>:<lang>`; otherwise importing the English
  // CV would overwrite the French one.
  const existingRow = language
    ? await designResumeRepo.getDesignResumeDocumentByLanguage(language)
    : await designResumeRepo.getPrimaryDesignResumeDocument();
  const targetId =
    existingRow?.id ??
    (language
      ? `${buildTenantScopedDesignResumeDocumentId()}:${language}`
      : buildTenantScopedDesignResumeDocumentId());

  const resumeJson = ensureDesignResumeItemIds(
    structuredClone(input.resumeJson),
  ).document;
  // Re-importing keeps the candidate's section guidance; notes attached to
  // entries that no longer exist are dropped.
  const aiGuidance = existingRow
    ? pruneDesignResumeAiGuidanceItems(
        normalizeDesignResumeAiGuidance(existingRow.aiGuidance),
        resumeJson,
      )
    : null;

  const importedAt = input.importedAt ?? new Date().toISOString();
  const saved = await designResumeRepo.upsertDesignResumeDocument({
    id: targetId,
    title: buildDocumentTitle(resumeJson),
    resumeJson,
    revision: (existingRow?.revision ?? 0) + 1,
    sourceResumeId: input.sourceResumeId,
    sourceMode: input.sourceMode,
    // Omitted on update so re-importing the primary keeps its language tag.
    ...(language || !existingRow ? { language } : {}),
    aiGuidance: aiGuidance as unknown as Record<string, unknown> | null,
    importedAt,
    updatedAt: importedAt,
  });

  if (existingRow?.id) {
    await clearDesignResumeAssetsForDocument(existingRow.id);
  }

  return (await hydrateDocument(saved)) as DesignResumeDocument;
}

export async function getCurrentDesignResume(
  selector?: DesignResumeVariantSelector | null,
): Promise<DesignResumeDocument | null> {
  const language = resolveSelectorLanguage(selector);
  try {
    const primary = await designResumeRepo.getPrimaryDesignResumeDocument();
    const row = language
      ? await designResumeRepo.getDesignResumeDocumentByLanguage(language)
      : primary;
    return hydrateDocument(await repairStoredItemIds(row), primary?.id ?? null);
  } catch (error) {
    if (isMissingDesignResumeTableError(error)) {
      return null;
    }
    throw error;
  }
}

/**
 * Base CV for a job: the variant written in the job description's language
 * (e.g. the English CV for an English posting), otherwise the primary CV.
 */
export async function getDesignResumeForJobLanguage(
  jobDescription: string | null | undefined,
): Promise<DesignResumeDocument | null> {
  try {
    const language = designResumeLanguageFromDetected(
      jobDescription ? detectLanguageFromText(jobDescription) : null,
    );
    const primary = await designResumeRepo.getPrimaryDesignResumeDocument();
    const row = await designResumeRepo.resolveDesignResumeForLanguage(language);
    return hydrateDocument(await repairStoredItemIds(row), primary?.id ?? null);
  } catch (error) {
    if (
      isMissingDesignResumeTableError(error) ||
      isLegacyDesignResumeError(error)
    ) {
      return null;
    }
    throw error;
  }
}

export async function getCurrentDesignResumeOrNullOnLegacy(
  selector?: DesignResumeVariantSelector | null,
): Promise<DesignResumeDocument | null> {
  try {
    return await getCurrentDesignResume(selector);
  } catch (error) {
    if (isLegacyDesignResumeError(error)) {
      return null;
    }
    throw error;
  }
}

export async function requireCurrentDesignResume(
  selector?: DesignResumeVariantSelector | null,
): Promise<DesignResumeDocument> {
  const document = await getCurrentDesignResume(selector);
  if (!document) {
    const language = resolveSelectorLanguage(selector);
    throw notFound(
      language
        ? `No "${language}" CV has been imported yet.`
        : "Design Resume has not been imported yet.",
    );
  }
  return document;
}

export async function listDesignResumeVariants(): Promise<
  DesignResumeVariantSummary[]
> {
  try {
    const rows = await designResumeRepo.listDesignResumeDocuments();
    const primaryId = rows[0]?.id ?? null;
    return rows.map((row) => toVariantSummary(row, primaryId));
  } catch (error) {
    if (isMissingDesignResumeTableError(error)) return [];
    throw error;
  }
}

export async function getDesignResumeStatus(): Promise<DesignResumeStatusResponse> {
  try {
    const document = await getCurrentDesignResume();
    return {
      exists: Boolean(document),
      documentId: document?.id ?? null,
      updatedAt: document?.updatedAt ?? null,
      variants: document ? await listDesignResumeVariants() : [],
    };
  } catch (error) {
    if (isLegacyDesignResumeError(error)) {
      return {
        exists: false,
        documentId: null,
        updatedAt: null,
        variants: [],
      };
    }
    throw error;
  }
}

/**
 * Deletes a language variant (e.g. a wrongly imported English CV). The primary
 * CV cannot be deleted this way — re-import it instead.
 */
export async function deleteDesignResumeVariant(
  selector: DesignResumeVariantSelector,
): Promise<void> {
  const language = resolveSelectorLanguage(selector);
  if (!language) {
    throw badRequest("A CV language is required to delete a variant.");
  }
  const row =
    await designResumeRepo.getDesignResumeDocumentByLanguage(language);
  if (!row) {
    throw notFound(`No "${language}" CV has been imported yet.`);
  }
  const primary = await designResumeRepo.getPrimaryDesignResumeDocument();
  if (primary?.id === row.id) {
    throw conflict(
      "The primary CV cannot be deleted. Import a replacement instead.",
    );
  }
  await clearDesignResumeAssetsForDocument(row.id);
  await designResumeRepo.deleteDesignResumeDocument(row.id);
}

export async function updateCurrentDesignResume(
  input: DesignResumePatchRequest,
  selector?: DesignResumeVariantSelector | null,
): Promise<DesignResumeDocument> {
  const current = await requireCurrentDesignResume(selector);
  if (current.revision !== input.baseRevision) {
    throw conflict("Design Resume has changed. Refresh and try again.");
  }

  let nextDocument: DesignResumeJson;
  if (input.document) {
    nextDocument = validatePatchedDocument(
      structuredClone(input.document) as Record<string, unknown>,
    );
  } else if (input.operations && input.operations.length > 0) {
    let nextDocumentRecord = structuredClone(current.resumeJson) as Record<
      string,
      unknown
    >;
    for (const operation of input.operations) {
      nextDocumentRecord = applyPatchOperation(nextDocumentRecord, operation);
    }
    nextDocument = validatePatchedDocument(nextDocumentRecord);
  } else if (input.aiGuidance !== undefined) {
    nextDocument = current.resumeJson;
  } else {
    throw badRequest(
      "Design Resume update requires a document, patch operations, or AI guidance.",
    );
  }

  const aiGuidance = pruneDesignResumeAiGuidanceItems(
    input.aiGuidance !== undefined
      ? parseAiGuidanceInput(input.aiGuidance)
      : current.aiGuidance,
    nextDocument,
  );

  const now = new Date().toISOString();
  const saved = await designResumeRepo.upsertDesignResumeDocument({
    id: current.id,
    title: buildDocumentTitle(nextDocument),
    resumeJson: nextDocument,
    revision: current.revision + 1,
    sourceResumeId: current.sourceResumeId,
    sourceMode: current.sourceMode,
    aiGuidance: aiGuidance as unknown as Record<string, unknown>,
    importedAt: current.importedAt,
    updatedAt: now,
  });

  return (await hydrateDocument(saved)) as DesignResumeDocument;
}

export async function uploadDesignResumePicture(
  input: {
    fileName: string;
    dataUrl: string;
    baseRevision?: number;
    document?: DesignResumeJson;
  },
  selector?: DesignResumeVariantSelector | null,
): Promise<DesignResumeDocument> {
  const current = await requireCurrentDesignResume(selector);
  const parsed = parseDataUrl(input.dataUrl);
  const existingAsset = await designResumeRepo.findDesignResumeAssetForDocument(
    {
      documentId: current.id,
      kind: "picture",
    },
  );

  const now = new Date().toISOString();
  const { assetId, storagePath } = await storeDesignResumePictureAsset({
    documentId: current.id,
    fileName: input.fileName,
    mimeType: parsed.mimeType,
    data: parsed.data,
    updatedAt: now,
  });

  const baseDocument = input.document
    ? validatePatchedDocument(
        structuredClone(input.document) as Record<string, unknown>,
      )
    : current.resumeJson;
  const nextDocument = structuredClone(baseDocument) as DesignResumeJson;
  const picture = asRecord(nextDocument.picture) ?? {};
  nextDocument.picture = {
    ...picture,
    url: contentUrlForAsset(assetId),
    hidden: false,
  } as DesignResumeJson["picture"];

  let updated: DesignResumeDocument;
  try {
    updated = await updateCurrentDesignResume(
      {
        baseRevision: input.baseRevision ?? current.revision,
        document: nextDocument,
      },
      selector,
    );
  } catch (error) {
    await designResumeRepo.deleteDesignResumeAsset(assetId);
    await deleteAssetFile(storagePath);
    throw error;
  }

  if (existingAsset) {
    try {
      await designResumeRepo.deleteDesignResumeAsset(existingAsset.id);
      await deleteAssetFile(existingAsset.storagePath);
    } catch (error) {
      logger.warn("Failed to delete replaced design resume asset", {
        assetId: existingAsset.id,
        documentId: current.id,
        error: sanitizeUnknown(error),
      });
    }
  }

  return updated;
}

export async function uploadDesignResumePictureFile(
  input: {
    fileName: string;
    mimeType?: string | null;
    data: Buffer;
    baseRevision?: number;
  },
  selector?: DesignResumeVariantSelector | null,
): Promise<DesignResumeDocument> {
  const current = await requireCurrentDesignResume(selector);
  const mimeType = normalizeImageMimeType({
    mimeType: input.mimeType,
    fileName: input.fileName,
  });
  if (input.data.byteLength === 0) {
    throw badRequest("Image payload must not be empty.");
  }
  assertImageByteSize(input.data.byteLength);

  const existingAsset = await designResumeRepo.findDesignResumeAssetForDocument(
    {
      documentId: current.id,
      kind: "picture",
    },
  );

  const now = new Date().toISOString();
  const { assetId, storagePath } = await storeDesignResumePictureAsset({
    documentId: current.id,
    fileName: input.fileName,
    mimeType,
    data: input.data,
    updatedAt: now,
  });

  const nextDocument = structuredClone(current.resumeJson) as DesignResumeJson;
  const picture = asRecord(nextDocument.picture) ?? {};
  nextDocument.picture = {
    ...picture,
    url: contentUrlForAsset(assetId),
    hidden: false,
  } as DesignResumeJson["picture"];

  let updated: DesignResumeDocument;
  try {
    updated = await updateCurrentDesignResume(
      {
        baseRevision: input.baseRevision ?? current.revision,
        document: nextDocument,
      },
      selector,
    );
  } catch (error) {
    await designResumeRepo.deleteDesignResumeAsset(assetId);
    await deleteAssetFile(storagePath);
    throw error;
  }

  if (existingAsset) {
    try {
      await designResumeRepo.deleteDesignResumeAsset(existingAsset.id);
      await deleteAssetFile(existingAsset.storagePath);
    } catch (error) {
      logger.warn("Failed to delete replaced design resume asset", {
        assetId: existingAsset.id,
        documentId: current.id,
        error: sanitizeUnknown(error),
      });
    }
  }

  return updated;
}

export async function deleteDesignResumePicture(
  input?: {
    baseRevision?: number;
    document?: DesignResumeJson;
  },
  selector?: DesignResumeVariantSelector | null,
): Promise<DesignResumeDocument> {
  const current = await requireCurrentDesignResume(selector);
  const asset = await designResumeRepo.findDesignResumeAssetForDocument({
    documentId: current.id,
    kind: "picture",
  });

  const baseDocument = input?.document
    ? validatePatchedDocument(
        structuredClone(input.document) as Record<string, unknown>,
      )
    : current.resumeJson;
  const nextDocument = structuredClone(baseDocument) as DesignResumeJson;
  const picture = asRecord(nextDocument.picture) ?? {};
  nextDocument.picture = {
    ...picture,
    url: "",
  } as DesignResumeJson["picture"];

  const updated = await updateCurrentDesignResume(
    {
      baseRevision: input?.baseRevision ?? current.revision,
      document: nextDocument,
    },
    selector,
  );

  if (asset) {
    try {
      await designResumeRepo.deleteDesignResumeAsset(asset.id);
      await deleteAssetFile(asset.storagePath);
    } catch (error) {
      logger.warn("Failed to delete removed design resume asset", {
        assetId: asset.id,
        documentId: current.id,
        error: sanitizeUnknown(error),
      });
    }
  }

  return updated;
}

export async function readDesignResumeAssetContent(
  assetId: string,
  options?: { bypassTenantScope?: boolean },
): Promise<{
  asset: DesignResumeAsset;
  content: Buffer;
}> {
  const row = options?.bypassTenantScope
    ? await designResumeRepo.getDesignResumeAssetByIdAnyTenant(assetId)
    : await designResumeRepo.getDesignResumeAssetById(assetId);
  if (!row) {
    throw notFound("Design Resume asset not found.");
  }

  const content = await readFile(resolveDesignResumeAssetPath(row.storagePath));
  return {
    asset: toDesignResumeAsset(row),
    content,
  };
}

export async function exportDesignResume(
  selector?: DesignResumeVariantSelector | null,
): Promise<DesignResumeExportResponse> {
  const current = await requireCurrentDesignResume(selector);
  const fileStem =
    buildDocumentTitle(current.resumeJson)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "design-resume";
  const languageSuffix = current.language ? `-${current.language}` : "";

  return {
    fileName: `${fileStem}${languageSuffix}.json`,
    document: current.resumeJson,
  };
}

type DesignResumeProfileSource = Pick<
  DesignResumeDocument,
  "resumeJson" | "aiGuidance"
> &
  Partial<Pick<DesignResumeDocument, "id" | "language">>;

function mapProfileSection(
  sections: Record<string, unknown>,
  key: string,
  fallbackName: string,
  mapItem: (record: Record<string, unknown>) => Record<string, unknown>,
) {
  const section = asRecord(sections[key]) ?? {};
  return {
    id: key,
    visible: !toBoolean(section.hidden, false),
    name: toText(section.title, fallbackName),
    items: asArray(section.items).map((item) => {
      const record = asRecord(item) ?? {};
      return {
        id: toText(record.id),
        visible: !toBoolean(record.hidden, false),
        ...mapItem(record),
      };
    }),
  };
}

/**
 * Converts a Design Resume into the provider-neutral `ResumeProfile` used by
 * scoring, tailoring, project selection and cover letters. The candidate's AI
 * guidance travels with it (`aiGuidance`); prompt builders must go through
 * `buildAiProfileView` so sections marked private are never sent to an LLM.
 */
export async function designResumeToProfile(
  document?: DesignResumeProfileSource | null,
): Promise<ResumeProfile | null> {
  const resolved = document ?? (await getCurrentDesignResume());
  if (!resolved) return null;
  const source = resolved.resumeJson;

  const basics = asRecord(source.basics) ?? {};
  const summary = asRecord(source.summary) ?? {};
  const sections = asRecord(source.sections) ?? {};
  const urlOf = (record: Record<string, unknown>) =>
    toText(asRecord(record.website)?.url);

  return {
    basics: {
      name: toText(basics.name),
      label: toText(basics.headline),
      headline: toText(basics.headline),
      email: toText(basics.email),
      phone: toText(basics.phone),
      url: toText(asRecord(basics.website)?.url),
      summary: toText(summary.content),
      location: {
        address: toText(basics.location),
      },
      profiles: asArray(profilesSection(source)?.items).map((item) => {
        const record = asRecord(item) ?? {};
        return {
          network: toText(record.network),
          username: toText(record.username),
          url: toText(asRecord(record.website)?.url),
        };
      }),
    },
    sections: {
      summary: {
        id: "summary",
        visible: !toBoolean(summary.hidden, false),
        name: toText(summary.title, "Summary"),
        content: toText(summary.content),
      },
      skills: mapProfileSection(sections, "skills", "Skills", (record) => ({
        name: toText(record.name),
        description: toText(record.proficiency),
        level: toNumber(record.level, 1),
        keywords: asArray(record.keywords).map((value) => toText(value)),
      })) as NonNullable<ResumeProfile["sections"]>["skills"],
      projects: mapProfileSection(
        sections,
        "projects",
        "Projects",
        (record) => ({
          name: toText(record.name),
          description: toText(record.description),
          date: toText(record.period),
          summary: toText(record.description),
          keywords: asArray(record.keywords).map((value) => toText(value)),
          url: urlOf(record),
        }),
      ) as NonNullable<ResumeProfile["sections"]>["projects"],
      experience: mapProfileSection(
        sections,
        "experience",
        "Experience",
        (record) => ({
          company: toText(record.company),
          position: toText(record.position),
          location: toText(record.location),
          date: toText(record.period),
          summary: toText(record.description),
        }),
      ) as NonNullable<ResumeProfile["sections"]>["experience"],
      education: mapProfileSection(
        sections,
        "education",
        "Education",
        (record) => ({
          institution: toText(record.school),
          school: toText(record.school),
          degree: toText(record.degree),
          area: toText(record.area),
          grade: toText(record.grade),
          location: toText(record.location),
          date: toText(record.period),
          summary: toText(record.description),
        }),
      ),
      languages: mapProfileSection(
        sections,
        "languages",
        "Languages",
        (record) => ({
          language: toText(record.language),
          fluency: toText(record.fluency),
          level: toNumber(record.level, 0),
        }),
      ),
      certifications: mapProfileSection(
        sections,
        "certifications",
        "Certifications",
        (record) => ({
          title: toText(record.title),
          issuer: toText(record.issuer),
          date: toText(record.date),
          summary: toText(record.description),
        }),
      ),
      awards: mapProfileSection(sections, "awards", "Awards", (record) => ({
        title: toText(record.title),
        awarder: toText(record.awarder),
        date: toText(record.date),
        summary: toText(record.description),
      })),
      publications: mapProfileSection(
        sections,
        "publications",
        "Publications",
        (record) => ({
          title: toText(record.title),
          publisher: toText(record.publisher),
          date: toText(record.date),
          summary: toText(record.description),
        }),
      ),
      volunteer: mapProfileSection(
        sections,
        "volunteer",
        "Volunteer",
        (record) => ({
          organization: toText(record.organization),
          location: toText(record.location),
          date: toText(record.period),
          summary: toText(record.description),
        }),
      ),
      interests: mapProfileSection(
        sections,
        "interests",
        "Interests",
        (record) => ({
          name: toText(record.name),
          keywords: asArray(record.keywords).map((value) => toText(value)),
        }),
      ),
      references: mapProfileSection(
        sections,
        "references",
        "References",
        (record) => ({
          name: toText(record.name),
          position: toText(record.position),
          summary: toText(record.description),
        }),
      ),
    },
    aiGuidance: resolved.aiGuidance,
    ...(resolved.language ? { language: resolved.language } : {}),
  };
}

function profilesSection(source: DesignResumeJson) {
  const sections = asRecord(source.sections) ?? {};
  return asRecord(sections.profiles) ?? {};
}

/**
 * Profile of the CV variant a job will actually be rendered with (matched on
 * the job description's language). Using the same variant for tailoring,
 * project selection and PDF rendering keeps skill names and project ids
 * consistent between the AI output and the document it is applied to.
 */
export async function designResumeProfileForJob(
  jobDescription: string | null | undefined,
): Promise<ResumeProfile | null> {
  const document = await getDesignResumeForJobLanguage(jobDescription);
  return document ? designResumeToProfile(document) : null;
}
