declare const __APP_VERSION__: string;

const GITHUB_REPO = "dhia-rek/boussole";
const STORAGE_KEY = "boussole_version_check";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const FAILED_CHECK_RETRY_MS = 6 * 60 * 60 * 1000; // 6 hours

function canUseStorage(): boolean {
  return (
    typeof localStorage !== "undefined" &&
    typeof localStorage.getItem === "function" &&
    typeof localStorage.setItem === "function"
  );
}

export interface VersionCheckResult {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  lastChecked: number;
}

/**
 * Normalize the app version into the user-facing release format.
 */
export function parseVersion(rawVersion: string): string {
  const normalized = rawVersion.trim();
  if (/^v\d+\.\d+\.\d+$/.test(normalized)) {
    return normalized;
  }
  if (/^\d+\.\d+\.\d+$/.test(normalized)) {
    return `v${normalized}`;
  }
  return normalized || "unknown";
}

function readCache(): VersionCheckResult | null {
  if (!canUseStorage()) return null;
  try {
    const cached = localStorage.getItem(STORAGE_KEY);
    return cached ? (JSON.parse(cached) as VersionCheckResult) : null;
  } catch {
    return null;
  }
}

function writeCache(result: VersionCheckResult): void {
  if (!canUseStorage()) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(result));
  } catch {
    // Storage full or blocked (private mode): skip caching.
  }
}

let inFlightCheck: Promise<VersionCheckResult> | null = null;

/**
 * Check for updates against GitHub releases API.
 * Successful results are cached for 24 hours and failures (rate limit,
 * offline, private repo) for 6 hours, so a failing check is not retried on
 * every page load. Concurrent callers share a single request.
 */
export function checkForUpdate(): Promise<VersionCheckResult> {
  if (!inFlightCheck) {
    inFlightCheck = runVersionCheck().finally(() => {
      inFlightCheck = null;
    });
  }
  return inFlightCheck;
}

async function runVersionCheck(): Promise<VersionCheckResult> {
  const currentRaw =
    typeof __APP_VERSION__ !== "undefined"
      ? (__APP_VERSION__ as string)
      : "unknown";
  const currentVersion = parseVersion(currentRaw);

  const cached = readCache();
  if (cached && typeof cached.lastChecked === "number") {
    const maxAge =
      cached.latestVersion === null ? FAILED_CHECK_RETRY_MS : CHECK_INTERVAL_MS;
    if (Date.now() - cached.lastChecked < maxAge) {
      const latestVersion = cached.latestVersion ?? null;
      return {
        currentVersion,
        latestVersion,
        updateAvailable:
          latestVersion !== null &&
          currentVersion !== "unknown" &&
          latestVersion !== currentVersion,
        lastChecked: cached.lastChecked,
      };
    }
  }

  try {
    const response = await fetch(
      // The list endpoint answers [] (not 404) while there is no release yet.
      `https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=1`,
    );
    if (!response.ok) throw new Error("Failed to fetch");

    const data: unknown = await response.json();
    const newest = Array.isArray(data) ? (data[0] as unknown) : null;
    const tagName =
      newest && typeof newest === "object"
        ? (newest as { tag_name?: unknown }).tag_name
        : null;
    if (typeof tagName !== "string" || !tagName.trim()) {
      throw new Error("No release yet");
    }
    const latestVersion = parseVersion(tagName);

    const result: VersionCheckResult = {
      currentVersion,
      latestVersion,
      updateAvailable:
        currentVersion !== "unknown" && latestVersion !== currentVersion,
      lastChecked: Date.now(),
    };
    writeCache(result);
    return result;
  } catch {
    // Remember the failure too, so the next page load does not retry at once.
    const result: VersionCheckResult = {
      currentVersion,
      latestVersion: null,
      updateAvailable: false,
      lastChecked: Date.now(),
    };
    writeCache(result);
    return result;
  }
}
