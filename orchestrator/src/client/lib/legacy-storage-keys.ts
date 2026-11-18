/**
 * Moves this browser's saved keys from the app's previous name to
 * "boussole." (sign-in, remembered accounts, preferences), so nobody is
 * signed out by the rename. Runs on import, before anything reads storage;
 * main.tsx imports it first.
 */
const NEW_PREFIX = "boussole.";

/** Keys the app saved under its previous name, without the prefix. */
const MOVED_KEYS = new Set([
  "authToken",
  "jwtToken",
  "basicAuthCredentials",
  "rememberedAuthUsers",
  "ghostwriter.display-mode.v1",
  "user-country-cache.v1",
]);

/** Returns how many old keys were moved. */
export function migrateLegacyStorageKeys(storage: Storage): number {
  const moves: Array<[string, string]> = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key || key.startsWith(NEW_PREFIX)) continue;
    const dot = key.indexOf(".");
    const prefix = key.slice(0, dot);
    const rest = key.slice(dot + 1);
    if (dot > 0 && /^[a-z]+$/.test(prefix) && MOVED_KEYS.has(rest)) {
      moves.push([key, `${NEW_PREFIX}${rest}`]);
    }
  }
  for (const [oldKey, newKey] of moves) {
    const value = storage.getItem(oldKey);
    // A value already saved under the new name wins.
    if (value !== null && storage.getItem(newKey) === null) {
      storage.setItem(newKey, value);
    }
    storage.removeItem(oldKey);
  }
  return moves.length;
}

function storageOrNull(get: () => Storage): Storage | null {
  try {
    return get();
  } catch {
    return null;
  }
}

for (const storage of [
  storageOrNull(() => window.localStorage),
  storageOrNull(() => window.sessionStorage),
]) {
  if (!storage) continue;
  try {
    migrateLegacyStorageKeys(storage);
  } catch {
    // Blocked or full storage: the app still works, just signed out.
  }
}
