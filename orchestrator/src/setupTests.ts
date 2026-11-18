// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import "@testing-library/jest-dom";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";
import { installDomMeasurementMocks } from "@/client/test/dom-measurement";

// Never let a test touch the developer's real database or PDFs: unless a test
// configures its own DATA_DIR, point the app at a throwaway directory before
// any module opens the SQLite file.
if (!process.env.DATA_DIR) {
  const isolatedDataDir = mkdtempSync(join(tmpdir(), "boussole-test-"));
  process.env.DATA_DIR = isolatedDataDir;
  afterAll(() => {
    rmSync(isolatedDataDir, { recursive: true, force: true });
  });
}

installDomMeasurementMocks();

const hasStorageShape = (value: unknown): value is Storage => {
  if (!value || typeof value !== "object") return false;
  const storage = value as Partial<Storage>;
  return (
    typeof storage.getItem === "function" &&
    typeof storage.setItem === "function" &&
    typeof storage.removeItem === "function" &&
    typeof storage.clear === "function" &&
    typeof storage.key === "function"
  );
};

if (!hasStorageShape(globalThis.localStorage)) {
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
    configurable: true,
    writable: true,
    value: storage,
  });
}
