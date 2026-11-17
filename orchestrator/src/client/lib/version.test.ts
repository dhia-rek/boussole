import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkForUpdate, parseVersion } from "./version";

describe("version", () => {
  it("normalizes bare semver into a release tag", () => {
    expect(parseVersion("0.1.30")).toBe("v0.1.30");
  });

  it("keeps prefixed release tags unchanged", () => {
    expect(parseVersion("v0.1.30")).toBe("v0.1.30");
  });

  it("falls back to unknown for empty values", () => {
    expect(parseVersion("")).toBe("unknown");
  });
});

describe("checkForUpdate", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shares one request between concurrent callers", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ tag_name: "v9.9.9" }],
    });
    vi.stubGlobal("fetch", fetchMock);

    const [first, second] = await Promise.all([
      checkForUpdate(),
      checkForUpdate(),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first.latestVersion).toBe("v9.9.9");
    expect(second.latestVersion).toBe("v9.9.9");
  });

  it("asks for the release list, which is empty (not a 404) before the first release", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => [] });
    vi.stubGlobal("fetch", fetchMock);

    const result = await checkForUpdate();

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/releases?per_page=1",
    );
    expect(result.updateAvailable).toBe(false);
    expect(result.latestVersion).toBeNull();
  });

  it("remembers a failed check instead of retrying on every page load", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 403 });
    vi.stubGlobal("fetch", fetchMock);

    const first = await checkForUpdate();
    const second = await checkForUpdate();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first.updateAvailable).toBe(false);
    expect(second.latestVersion).toBeNull();
  });
});
