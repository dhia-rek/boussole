import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "../db/index";
import { getActiveTenantId } from "../tenancy/context";

const { designResumeAssets, designResumeDocuments } = schema;

/**
 * Ordering that defines the PRIMARY CV of a workspace: an untagged CV
 * (language IS NULL) wins, otherwise the first CV ever created. The primary is
 * what the editor opens by default and what jobs fall back to when their
 * language has no dedicated variant. It never depends on edit recency, so
 * saving one variant can't silently change which CV the pipeline uses.
 */
const primaryOrder = [
  sql`${designResumeDocuments.language} IS NULL DESC`,
  asc(designResumeDocuments.createdAt),
  asc(designResumeDocuments.id),
] as const;

export async function getPrimaryDesignResumeDocument() {
  const tenantId = getActiveTenantId();
  const [row] = await db
    .select()
    .from(designResumeDocuments)
    .where(eq(designResumeDocuments.tenantId, tenantId))
    .orderBy(...primaryOrder)
    .limit(1);
  return row ?? null;
}

/** All CV variants of the active workspace, primary first. */
export async function listDesignResumeDocuments() {
  const tenantId = getActiveTenantId();
  return db
    .select()
    .from(designResumeDocuments)
    .where(eq(designResumeDocuments.tenantId, tenantId))
    .orderBy(...primaryOrder);
}

export async function getDesignResumeDocumentByLanguage(language: string) {
  const tenantId = getActiveTenantId();
  const [row] = await db
    .select()
    .from(designResumeDocuments)
    .where(
      and(
        eq(designResumeDocuments.tenantId, tenantId),
        eq(designResumeDocuments.language, language),
      ),
    )
    .orderBy(desc(designResumeDocuments.updatedAt))
    .limit(1);
  return row ?? null;
}

/**
 * Base CV for a job's language: the variant tagged with that language when one
 * exists, otherwise the primary CV.
 */
export async function resolveDesignResumeForLanguage(
  language: string | null | undefined,
) {
  if (language) {
    const tagged = await getDesignResumeDocumentByLanguage(language);
    if (tagged) return tagged;
  }
  return getPrimaryDesignResumeDocument();
}

export async function getDesignResumeDocumentById(id: string) {
  const tenantId = getActiveTenantId();
  const [row] = await db
    .select()
    .from(designResumeDocuments)
    .where(
      and(
        eq(designResumeDocuments.tenantId, tenantId),
        eq(designResumeDocuments.id, id),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function listDesignResumeAssets(documentId: string) {
  const tenantId = getActiveTenantId();
  return db
    .select()
    .from(designResumeAssets)
    .where(
      and(
        eq(designResumeAssets.tenantId, tenantId),
        eq(designResumeAssets.documentId, documentId),
      ),
    )
    .orderBy(desc(designResumeAssets.updatedAt));
}

export async function getDesignResumeAssetById(id: string) {
  const tenantId = getActiveTenantId();
  const [row] = await db
    .select()
    .from(designResumeAssets)
    .where(
      and(
        eq(designResumeAssets.tenantId, tenantId),
        eq(designResumeAssets.id, id),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function getDesignResumeAssetByIdAnyTenant(id: string) {
  const [row] = await db
    .select()
    .from(designResumeAssets)
    .where(eq(designResumeAssets.id, id))
    .limit(1);
  return row ?? null;
}

export async function upsertDesignResumeDocument(input: {
  id: string;
  title: string;
  resumeJson: Record<string, unknown>;
  revision: number;
  sourceResumeId: string | null;
  sourceMode: string | null;
  /** Omit to keep the stored value on update (null on insert). */
  language?: string | null;
  /** Omit to keep the stored value on update (null on insert). */
  aiGuidance?: Record<string, unknown> | null;
  importedAt: string | null;
  createdAt?: string;
  updatedAt: string;
}) {
  const tenantId = getActiveTenantId();
  const existing = await getDesignResumeDocumentById(input.id);
  if (existing) {
    await db
      .update(designResumeDocuments)
      .set({
        title: input.title,
        resumeJson: input.resumeJson,
        revision: input.revision,
        sourceResumeId: input.sourceResumeId,
        sourceMode: input.sourceMode,
        ...(input.language !== undefined ? { language: input.language } : {}),
        ...(input.aiGuidance !== undefined
          ? { aiGuidance: input.aiGuidance }
          : {}),
        importedAt: input.importedAt,
        updatedAt: input.updatedAt,
      })
      .where(
        and(
          eq(designResumeDocuments.tenantId, tenantId),
          eq(designResumeDocuments.id, input.id),
        ),
      );
  } else {
    await db.insert(designResumeDocuments).values({
      id: input.id,
      tenantId,
      title: input.title,
      resumeJson: input.resumeJson,
      revision: input.revision,
      sourceResumeId: input.sourceResumeId,
      sourceMode: input.sourceMode,
      language: input.language ?? null,
      aiGuidance: input.aiGuidance ?? null,
      importedAt: input.importedAt,
      createdAt: input.createdAt ?? input.updatedAt,
      updatedAt: input.updatedAt,
    });
  }

  return getDesignResumeDocumentById(input.id);
}

export async function insertDesignResumeAsset(input: {
  id: string;
  documentId: string;
  kind: "picture";
  originalName: string;
  mimeType: string;
  byteSize: number;
  storagePath: string;
  createdAt?: string;
  updatedAt: string;
}) {
  const tenantId = getActiveTenantId();
  await db.insert(designResumeAssets).values({
    id: input.id,
    tenantId,
    documentId: input.documentId,
    kind: input.kind,
    originalName: input.originalName,
    mimeType: input.mimeType,
    byteSize: input.byteSize,
    storagePath: input.storagePath,
    createdAt: input.createdAt ?? input.updatedAt,
    updatedAt: input.updatedAt,
  });

  return getDesignResumeAssetById(input.id);
}

export async function deleteDesignResumeAsset(id: string) {
  const tenantId = getActiveTenantId();
  await db
    .delete(designResumeAssets)
    .where(
      and(
        eq(designResumeAssets.tenantId, tenantId),
        eq(designResumeAssets.id, id),
      ),
    );
}

export async function deleteDesignResumeAssetsForDocument(documentId: string) {
  const tenantId = getActiveTenantId();
  await db
    .delete(designResumeAssets)
    .where(
      and(
        eq(designResumeAssets.tenantId, tenantId),
        eq(designResumeAssets.documentId, documentId),
      ),
    );
}

export async function deleteDesignResumeDocument(id: string) {
  const tenantId = getActiveTenantId();
  await db
    .delete(designResumeDocuments)
    .where(
      and(
        eq(designResumeDocuments.tenantId, tenantId),
        eq(designResumeDocuments.id, id),
      ),
    );
}

export async function findDesignResumeAssetForDocument(args: {
  documentId: string;
  kind: "picture";
}) {
  const tenantId = getActiveTenantId();
  const [row] = await db
    .select()
    .from(designResumeAssets)
    .where(
      and(
        eq(designResumeAssets.documentId, args.documentId),
        eq(designResumeAssets.tenantId, tenantId),
        eq(designResumeAssets.kind, args.kind),
      ),
    )
    .limit(1);
  return row ?? null;
}
