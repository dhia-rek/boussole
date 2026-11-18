// @vitest-environment node
import { runWithRequestContext } from "@infra/request-context";
import { beforeAll, describe, expect, it } from "vitest";

type StoreModule = typeof import("./memory-store");
let store: StoreModule;

beforeAll(async () => {
  await import("@server/db/migrate");
  store = await import("./memory-store");
});

const knownTenants = new Set<string>();

/** Runs `fn` as `tenantId`, creating the tenant row (foreign keys are on). */
async function asTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  if (!knownTenants.has(tenantId)) {
    const { db, schema } = await import("@server/db");
    await db
      .insert(schema.tenants)
      .values({ id: tenantId, name: tenantId, slug: tenantId })
      .onConflictDoNothing();
    knownTenants.add(tenantId);
  }
  return runWithRequestContext({ tenantId }, fn);
}

describe("SqliteAgentStore", () => {
  it("keeps items per tenant and deletes on null", async () => {
    const memory = new store.SqliteAgentStore();
    await asTenant("tenant-a", () =>
      memory.put(["boussole", "memories"], "/a.md", { content: "A" }),
    );

    expect(
      await asTenant("tenant-a", () =>
        memory.get(["boussole", "memories"], "/a.md"),
      ),
    ).toMatchObject({ key: "/a.md", value: { content: "A" } });
    expect(
      await asTenant("tenant-b", () =>
        memory.get(["boussole", "memories"], "/a.md"),
      ),
    ).toBeNull();

    await asTenant("tenant-a", () =>
      memory.put(["boussole", "memories"], "/a.md", { content: "A2" }),
    );
    const updated = await asTenant("tenant-a", () =>
      memory.get(["boussole", "memories"], "/a.md"),
    );
    expect(updated?.value).toEqual({ content: "A2" });
    expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(
      updated?.createdAt.getTime() ?? 0,
    );

    await asTenant("tenant-a", () =>
      memory.delete(["boussole", "memories"], "/a.md"),
    );
    expect(
      await asTenant("tenant-a", () =>
        memory.get(["boussole", "memories"], "/a.md"),
      ),
    ).toBeNull();
  });

  it("searches by namespace prefix, filter, text and page", async () => {
    const memory = new store.SqliteAgentStore();
    await asTenant("tenant-search", async () => {
      await memory.put(["docs", "fr"], "one", { lang: "fr", text: "Données" });
      await memory.put(["docs", "en"], "two", { lang: "en", text: "Data" });
      await memory.put(["other"], "three", { lang: "en", text: "Data" });
    });

    const docs = await asTenant("tenant-search", () => memory.search(["docs"]));
    expect(docs.map((item) => item.key).sort()).toEqual(["one", "two"]);
    expect(
      (
        await asTenant("tenant-search", () =>
          memory.search(["docs"], { filter: { lang: "en" } }),
        )
      ).map((item) => item.key),
    ).toEqual(["two"]);
    expect(
      (
        await asTenant("tenant-search", () =>
          memory.search([], { query: "données" }),
        )
      ).map((item) => item.key),
    ).toEqual(["one"]);
    expect(
      await asTenant("tenant-search", () =>
        memory.search(["docs"], { limit: 1, offset: 5 }),
      ),
    ).toEqual([]);
    expect(
      await asTenant("tenant-other", () => memory.search(["docs"])),
    ).toEqual([]);
  });

  it("lists namespaces with prefix/suffix conditions and depth", async () => {
    const memory = new store.SqliteAgentStore();
    await asTenant("tenant-ns", async () => {
      await memory.put(["a", "b", "c"], "k1", { v: 1 });
      await memory.put(["a", "x", "c"], "k2", { v: 2 });
      await memory.put(["z"], "k3", { v: 3 });
    });

    expect(
      await asTenant("tenant-ns", () =>
        memory.listNamespaces({ prefix: ["a"] }),
      ),
    ).toEqual([
      ["a", "b", "c"],
      ["a", "x", "c"],
    ]);
    expect(
      await asTenant("tenant-ns", () =>
        memory.listNamespaces({ suffix: ["*", "c"], maxDepth: 1 }),
      ),
    ).toEqual([["a"]]);
  });
});

describe("learned preferences file", () => {
  it("is written through the Deep Agents StoreBackend, per tenant", async () => {
    await asTenant("tenant-prefs-a", () =>
      store.writePreferences("## Prefers\n- CDI roles (applied 3, skipped 0)"),
    );
    const own = await asTenant("tenant-prefs-a", () => store.readPreferences());
    expect(own?.content).toBe("## Prefers\n- CDI roles (applied 3, skipped 0)");
    expect(own?.updatedAt).toBeTruthy();

    expect(
      await asTenant("tenant-prefs-b", () => store.readPreferences()),
    ).toBeNull();

    await asTenant("tenant-prefs-a", () =>
      store.writePreferences("## Prefers\n- Remote"),
    );
    expect(
      (await asTenant("tenant-prefs-a", () => store.readPreferences()))
        ?.content,
    ).toBe("## Prefers\n- Remote");
  });
});
