/**
 * Brute-force protection for password sign-in.
 *
 * Failed attempts are counted per username and per client IP in a sliding
 * window; once a limit is reached, further attempts are refused until the
 * window clears. A successful sign-in clears the username's counter.
 *
 * Explicitly global (not tenant-scoped): sign-in happens before a tenant is
 * known, and the counters hold no tenant data, only attempt timestamps.
 * State is in memory, so restarting the server also clears a lockout.
 */

export const LOGIN_WINDOW_MS = 15 * 60_000;
export const MAX_FAILURES_PER_USERNAME = 10;
export const MAX_FAILURES_PER_IP = 30;
const MAX_TRACKED_KEYS = 10_000;

type Clock = () => number;

export interface LoginThrottle {
  /** Seconds to wait before another attempt, or 0 when allowed. */
  retryAfterSeconds(ip: string, username: string): number;
  recordFailure(ip: string, username: string): void;
  recordSuccess(ip: string, username: string): void;
  reset(): void;
}

export function createLoginThrottle(now: Clock = Date.now): LoginThrottle {
  const failures = new Map<string, number[]>();

  const userKey = (username: string) => `user:${username.trim().toLowerCase()}`;
  const ipKey = (ip: string) => `ip:${ip}`;

  const recent = (key: string): number[] => {
    const cutoff = now() - LOGIN_WINDOW_MS;
    const kept = (failures.get(key) ?? []).filter((time) => time > cutoff);
    if (kept.length === 0) failures.delete(key);
    else failures.set(key, kept);
    return kept;
  };

  const waitFor = (key: string, limit: number): number => {
    const attempts = recent(key);
    if (attempts.length < limit) return 0;
    const oldestCounted = attempts[attempts.length - limit] ?? now();
    return Math.max(
      1,
      Math.ceil((oldestCounted + LOGIN_WINDOW_MS - now()) / 1000),
    );
  };

  const prune = () => {
    if (failures.size <= MAX_TRACKED_KEYS) return;
    for (const key of [...failures.keys()]) recent(key);
    // Still too many: drop the oldest keys (Map keeps insertion order).
    for (const key of failures.keys()) {
      if (failures.size <= MAX_TRACKED_KEYS) break;
      failures.delete(key);
    }
  };

  return {
    retryAfterSeconds(ip, username) {
      return Math.max(
        waitFor(userKey(username), MAX_FAILURES_PER_USERNAME),
        waitFor(ipKey(ip), MAX_FAILURES_PER_IP),
      );
    },
    recordFailure(ip, username) {
      for (const key of [userKey(username), ipKey(ip)]) {
        failures.set(key, [...recent(key), now()]);
      }
      prune();
    },
    recordSuccess(_ip, username) {
      failures.delete(userKey(username));
    },
    reset() {
      failures.clear();
    },
  };
}

export const loginThrottle = createLoginThrottle();

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/**
 * Client address for throttling. Behind a local Cloudflare tunnel every
 * request arrives from loopback, so the visitor's address comes from
 * `CF-Connecting-IP`; that header is ignored for non-loopback peers, who
 * could forge it.
 */
export function clientAddress(
  remoteAddress: string | undefined,
  headers: Record<string, string | string[] | undefined>,
): string {
  const peer = remoteAddress ?? "unknown";
  if (LOOPBACK.has(peer)) {
    const forwarded = headers["cf-connecting-ip"];
    const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    if (value?.trim()) return value.trim();
  }
  return peer;
}
