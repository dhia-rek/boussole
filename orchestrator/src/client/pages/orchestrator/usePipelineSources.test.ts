import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { PIPELINE_SOURCES_STORAGE_KEY } from "./constants";
import {
  getPipelineSourcesStorageKey,
  usePipelineSources,
} from "./usePipelineSources";

function ensureStorage(): Storage {
  const existing = globalThis.localStorage as Partial<Storage> | undefined;
  const hasStorageShape =
    existing &&
    typeof existing.getItem === "function" &&
    typeof existing.setItem === "function" &&
    typeof existing.removeItem === "function" &&
    typeof existing.clear === "function";

  if (hasStorageShape) {
    return existing as Storage;
  }

  const store = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      const value = store.get(key);
      return value ?? null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };

  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
    writable: true,
  });

  return storage;
}

function ensureSessionStorage(): Storage {
  const existing = globalThis.sessionStorage as Partial<Storage> | undefined;
  const hasStorageShape =
    existing &&
    typeof existing.getItem === "function" &&
    typeof existing.setItem === "function" &&
    typeof existing.removeItem === "function" &&
    typeof existing.clear === "function";

  if (hasStorageShape) {
    return existing as Storage;
  }

  const store = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      const value = store.get(key);
      return value ?? null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };

  Object.defineProperty(globalThis, "sessionStorage", {
    value: storage,
    configurable: true,
    writable: true,
  });

  return storage;
}

function makeAuthToken(tenantId: string): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  return [
    encode({ alg: "HS256", typ: "JWT" }),
    encode({ tenantId }),
    "signature",
  ].join(".");
}

describe("usePipelineSources", () => {
  beforeEach(() => {
    ensureStorage().clear();
    ensureSessionStorage().clear();
  });

  it("filters stored sources to enabled sources", () => {
    ensureStorage().setItem(
      PIPELINE_SOURCES_STORAGE_KEY,
      JSON.stringify(["linkedin", "adzuna"]),
    );

    const enabledSources = ["linkedin"] as const;

    const { result } = renderHook(() => usePipelineSources(enabledSources));

    expect(result.current.pipelineSources).toEqual(["linkedin"]);
  });

  it("falls back to the first enabled source", () => {
    ensureStorage().setItem(
      PIPELINE_SOURCES_STORAGE_KEY,
      JSON.stringify(["adzuna"]),
    );

    const enabledSources = ["wttj", "linkedin"] as const;

    const { result } = renderHook(() => usePipelineSources(enabledSources));

    expect(result.current.pipelineSources).toEqual(["wttj"]);
  });

  it("drops stored sources that no longer exist", () => {
    ensureStorage().setItem(
      PIPELINE_SOURCES_STORAGE_KEY,
      JSON.stringify(["ukvisajobs", "linkedin"]),
    );

    const enabledSources = ["wttj", "linkedin"] as const;

    const { result } = renderHook(() => usePipelineSources(enabledSources));

    expect(result.current.pipelineSources).toEqual(["linkedin"]);
  });

  it("ignores toggles for disabled sources", () => {
    ensureStorage().setItem(
      PIPELINE_SOURCES_STORAGE_KEY,
      JSON.stringify(["linkedin"]),
    );

    const enabledSources = ["linkedin"] as const;

    const { result } = renderHook(() => usePipelineSources(enabledSources));

    act(() => {
      result.current.toggleSource("adzuna", true);
    });

    expect(result.current.pipelineSources).toEqual(["linkedin"]);
  });

  it("loads and saves sources using workspace-scoped storage keys", () => {
    const sessionStorage = ensureSessionStorage();
    sessionStorage.setItem("forsa.authToken", makeAuthToken("tenant-one"));
    ensureStorage().setItem(
      getPipelineSourcesStorageKey(),
      JSON.stringify(["wttj"]),
    );

    sessionStorage.setItem("forsa.authToken", makeAuthToken("tenant-two"));
    ensureStorage().setItem(
      getPipelineSourcesStorageKey(),
      JSON.stringify(["linkedin"]),
    );

    sessionStorage.setItem("forsa.authToken", makeAuthToken("tenant-one"));
    const enabledSources = ["wttj", "linkedin"] as const;
    const { result } = renderHook(() => usePipelineSources(enabledSources));

    expect(getPipelineSourcesStorageKey()).toBe(
      `${PIPELINE_SOURCES_STORAGE_KEY}:workspace:tenant-one`,
    );
    expect(result.current.pipelineSources).toEqual(["wttj"]);

    act(() => {
      result.current.toggleSource("linkedin", true);
    });

    expect(
      JSON.parse(
        ensureStorage().getItem(
          `${PIPELINE_SOURCES_STORAGE_KEY}:workspace:tenant-one`,
        ) ?? "[]",
      ),
    ).toEqual(["wttj", "linkedin"]);
    expect(
      JSON.parse(
        ensureStorage().getItem(
          `${PIPELINE_SOURCES_STORAGE_KEY}:workspace:tenant-two`,
        ) ?? "[]",
      ),
    ).toEqual(["linkedin"]);
  });

  it("migrates legacy stored sources into the workspace-scoped key", () => {
    const sessionStorage = ensureSessionStorage();
    const localStorage = ensureStorage();
    sessionStorage.setItem("forsa.authToken", makeAuthToken("tenant-one"));
    localStorage.setItem(
      PIPELINE_SOURCES_STORAGE_KEY,
      JSON.stringify(["wttj"]),
    );

    const enabledSources = ["wttj", "linkedin"] as const;
    const { result } = renderHook(() => usePipelineSources(enabledSources));

    expect(result.current.pipelineSources).toEqual(["wttj"]);
    expect(
      localStorage.getItem(
        `${PIPELINE_SOURCES_STORAGE_KEY}:workspace:tenant-one`,
      ),
    ).toBe(localStorage.getItem(PIPELINE_SOURCES_STORAGE_KEY));
  });
});
