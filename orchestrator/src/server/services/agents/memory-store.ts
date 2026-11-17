/**
 * LangGraph `BaseStore` over the `agent_memories` table.
 *
 * Deep Agents' `StoreBackend` persists its files (the `/memories/` folder)
 * in a BaseStore. This implementation keeps every item in Forsa's SQLite
 * database, scoped to the tenant of the current request context — the
 * tenant is read on every operation, never cached on the instance.
 *
 * Semantic search (`query` with embeddings) is not supported; a `query` is
 * treated as a case-insensitive substring match on the stored value.
 */
import { randomUUID } from "node:crypto";
import {
  BaseStore,
  type GetOperation,
  type Item,
  type ListNamespacesOperation,
  type MatchCondition,
  type Operation,
  type OperationResults,
  type PutOperation,
  type SearchItem,
  type SearchOperation,
} from "@langchain/langgraph-checkpoint";
import { db, schema } from "@server/db";
import { getActiveTenantId } from "@server/tenancy/context";
import { type FileData, StoreBackend } from "deepagents";
import { and, eq } from "drizzle-orm";

const { agentMemories } = schema;

type MemoryRow = typeof agentMemories.$inferSelect;

/** Namespace holding the Deep Agents `/memories/` files. */
export const AGENT_MEMORY_NAMESPACE = ["forsa", "memories"];
/** The learned-preferences file, as agents see it. */
export const PREFERENCES_PATH = "/memories/preferences.md";
/** Same file inside the store-backed `/memories/` route. */
const PREFERENCES_KEY = "/preferences.md";

function encodeNamespace(namespace: string[]): string {
  return JSON.stringify(namespace);
}

function decodeNamespace(raw: string): string[] {
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value.map((part) => String(part)) : [];
  } catch {
    return [];
  }
}

function toDate(value: string): Date {
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

function toItem(row: MemoryRow): Item {
  return {
    namespace: decodeNamespace(row.namespace),
    key: row.key,
    value: (row.value ?? {}) as Record<string, unknown>,
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
  };
}

function hasPrefix(namespace: string[], prefix: string[]): boolean {
  return prefix.every((part, index) => namespace[index] === part);
}

function matchesCondition(
  namespace: string[],
  condition: MatchCondition,
): boolean {
  const { path, matchType } = condition;
  if (path.length > namespace.length) return false;
  const segment =
    matchType === "prefix"
      ? namespace.slice(0, path.length)
      : namespace.slice(namespace.length - path.length);
  return path.every((part, index) => part === "*" || part === segment[index]);
}

function matchesFilter(
  value: Record<string, unknown>,
  filter: Record<string, unknown> | undefined,
): boolean {
  if (!filter) return true;
  return Object.entries(filter).every(
    ([key, expected]) =>
      JSON.stringify(value[key]) === JSON.stringify(expected),
  );
}

export class SqliteAgentStore extends BaseStore {
  async batch<Op extends Operation[]>(
    operations: Op,
  ): Promise<OperationResults<Op>> {
    const tenantId = getActiveTenantId();
    const results: unknown[] = [];
    for (const operation of operations) {
      if ("value" in operation) {
        await this.putItem(tenantId, operation as PutOperation);
        results.push(undefined);
      } else if ("namespacePrefix" in operation) {
        results.push(
          await this.searchItems(tenantId, operation as SearchOperation),
        );
      } else if ("key" in operation) {
        results.push(await this.getItem(tenantId, operation as GetOperation));
      } else {
        results.push(
          await this.listNamespacesFor(
            tenantId,
            operation as ListNamespacesOperation,
          ),
        );
      }
    }
    return results as OperationResults<Op>;
  }

  private async getItem(
    tenantId: string,
    operation: GetOperation,
  ): Promise<Item | null> {
    const [row] = await db
      .select()
      .from(agentMemories)
      .where(
        and(
          eq(agentMemories.tenantId, tenantId),
          eq(agentMemories.namespace, encodeNamespace(operation.namespace)),
          eq(agentMemories.key, operation.key),
        ),
      );
    return row ? toItem(row) : null;
  }

  private async putItem(
    tenantId: string,
    operation: PutOperation,
  ): Promise<void> {
    const namespace = encodeNamespace(operation.namespace);
    if (operation.value === null) {
      await db
        .delete(agentMemories)
        .where(
          and(
            eq(agentMemories.tenantId, tenantId),
            eq(agentMemories.namespace, namespace),
            eq(agentMemories.key, operation.key),
          ),
        );
      return;
    }
    const now = new Date().toISOString();
    await db
      .insert(agentMemories)
      .values({
        id: randomUUID(),
        tenantId,
        namespace,
        key: operation.key,
        value: operation.value,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          agentMemories.tenantId,
          agentMemories.namespace,
          agentMemories.key,
        ],
        set: { value: operation.value, updatedAt: now },
      });
  }

  private async tenantRows(tenantId: string): Promise<MemoryRow[]> {
    return db
      .select()
      .from(agentMemories)
      .where(eq(agentMemories.tenantId, tenantId));
  }

  private async searchItems(
    tenantId: string,
    operation: SearchOperation,
  ): Promise<SearchItem[]> {
    const query = operation.query?.trim().toLowerCase();
    const items = (await this.tenantRows(tenantId))
      .map(toItem)
      .filter((item) => hasPrefix(item.namespace, operation.namespacePrefix))
      .filter((item) => matchesFilter(item.value, operation.filter))
      .filter(
        (item) =>
          !query || JSON.stringify(item.value).toLowerCase().includes(query),
      )
      .sort(
        (a, b) =>
          b.updatedAt.getTime() - a.updatedAt.getTime() ||
          a.key.localeCompare(b.key),
      );
    const offset = operation.offset ?? 0;
    const limit = operation.limit ?? 10;
    return items.slice(offset, offset + limit);
  }

  private async listNamespacesFor(
    tenantId: string,
    operation: ListNamespacesOperation,
  ): Promise<string[][]> {
    const seen = new Map<string, string[]>();
    for (const row of await this.tenantRows(tenantId)) {
      let namespace = decodeNamespace(row.namespace);
      if (
        operation.matchConditions?.some(
          (condition) => !matchesCondition(namespace, condition),
        )
      ) {
        continue;
      }
      if (operation.maxDepth !== undefined) {
        namespace = namespace.slice(0, operation.maxDepth);
      }
      seen.set(encodeNamespace(namespace), namespace);
    }
    const namespaces = [...seen.values()].sort((a, b) =>
      a.join("/").localeCompare(b.join("/")),
    );
    return namespaces.slice(
      operation.offset,
      operation.offset + operation.limit,
    );
  }
}

/** Deep Agents backend for the tenant's `/memories/` files. */
export function createMemoryBackend(
  store: BaseStore = new SqliteAgentStore(),
): StoreBackend {
  return new StoreBackend({ store, namespace: AGENT_MEMORY_NAMESPACE });
}

function fileDataToText(data: FileData): string {
  if (Array.isArray(data.content)) return data.content.join("\n");
  if (typeof data.content === "string") return data.content;
  return new TextDecoder().decode(data.content);
}

/** The tenant's learned preferences, or null when none were learned yet. */
export async function readPreferences(
  backend: StoreBackend = createMemoryBackend(),
): Promise<{ content: string; updatedAt: string | null } | null> {
  const result = await backend.readRaw(PREFERENCES_KEY);
  if (result.error || !result.data) return null;
  const content = fileDataToText(result.data).trim();
  return content
    ? { content, updatedAt: result.data.modified_at ?? null }
    : null;
}

export async function writePreferences(
  content: string,
  backend: StoreBackend = createMemoryBackend(),
): Promise<void> {
  const result = await backend.write(PREFERENCES_KEY, content);
  if (result.error) {
    throw new Error(`Could not save learned preferences: ${result.error}`);
  }
}
