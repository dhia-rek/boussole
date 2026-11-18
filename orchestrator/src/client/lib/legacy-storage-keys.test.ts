import { describe, expect, it } from "vitest";
import { migrateLegacyStorageKeys } from "./legacy-storage-keys";

describe("migrateLegacyStorageKeys", () => {
  it("moves the app's keys from a previous name and keeps newer values", () => {
    localStorage.clear();
    localStorage.setItem("oldname.authToken", "token-1");
    localStorage.setItem("oldname.rememberedAuthUsers", '["admin"]');
    localStorage.setItem("oldname.ghostwriter.display-mode.v1", "drawer");
    localStorage.setItem("boussole.ghostwriter.display-mode.v1", "page");
    localStorage.setItem("other.setting", "kept");
    localStorage.setItem("unrelated", "kept");

    expect(migrateLegacyStorageKeys(localStorage)).toBe(3);

    expect(localStorage.getItem("boussole.authToken")).toBe("token-1");
    expect(localStorage.getItem("boussole.rememberedAuthUsers")).toBe(
      '["admin"]',
    );
    expect(localStorage.getItem("boussole.ghostwriter.display-mode.v1")).toBe(
      "page",
    );
    expect(localStorage.getItem("oldname.authToken")).toBeNull();
    expect(localStorage.getItem("other.setting")).toBe("kept");
    expect(localStorage.getItem("unrelated")).toBe("kept");
    expect(migrateLegacyStorageKeys(localStorage)).toBe(0);
  });
});
