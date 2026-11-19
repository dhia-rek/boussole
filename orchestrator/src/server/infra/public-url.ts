/**
 * Fetching addresses that people type in (e.g. "import a job from a link")
 * without letting them reach the server's own network: loopback, private
 * ranges, Tailscale (CGNAT), link-local / cloud metadata, multicast.
 *
 * Two layers:
 * 1. Before the request and before every redirect hop, the hostname is
 *    resolved and every address must be public. This gives a clear error.
 * 2. The connection itself goes through an agent whose DNS lookup refuses
 *    non-public addresses, so a DNS answer that changes between the check and
 *    the connection (DNS rebinding) cannot reach the private network either.
 */
import { lookup as dnsLookupCallback, type LookupAddress } from "node:dns";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP, type LookupFunction } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

export class ResponseTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`The page is larger than ${Math.round(maxBytes / 1_000_000)} MB.`);
    this.name = "ResponseTooLargeError";
  }
}

const PUBLIC_ONLY_MESSAGE = "Only public websites can be fetched.";

/** [network, prefix length] of IPv4 ranges that are not the public internet. */
const BLOCKED_IPV4_RANGES: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // CGNAT, used by Tailscale
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, cloud metadata
  ["172.16.0.0", 12], // includes Docker bridges
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, broadcast
];

function ipv4ToNumber(ip: string): number {
  return (
    ip
      .split(".")
      .reduce(
        (value, octet) => (value << 8) + Number.parseInt(octet, 10),
        0,
      ) >>> 0
  );
}

function isBlockedIpv4(ip: string): boolean {
  const value = ipv4ToNumber(ip);
  return BLOCKED_IPV4_RANGES.some(([network, prefix]) => {
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return (value & mask) === (ipv4ToNumber(network) & mask);
  });
}

/** IPv4 embedded in an IPv6 address (mapped ::ffff:a.b.c.d or NAT64 64:ff9b::/96). */
function embeddedIpv4(ip: string): string | null {
  const dotted = /^(?:::ffff:|64:ff9b::)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
  if (dotted?.[1]) return dotted[1];
  const hex = /^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(ip);
  if (hex?.[1] && hex[2]) {
    const high = Number.parseInt(hex[1], 16);
    const low = Number.parseInt(hex[2], 16);
    return [high >> 8, high & 255, low >> 8, low & 255].join(".");
  }
  return null;
}

function isBlockedIpv6(ip: string): boolean {
  const lower = ip.toLowerCase().split("%")[0] ?? "";
  if (lower === "::" || lower === "::1") return true;
  const mapped = embeddedIpv4(lower);
  if (mapped) return isBlockedIpv4(mapped);
  const firstHextet = Number.parseInt(lower.split(":")[0] || "0", 16);
  if ((firstHextet & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((firstHextet & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((firstHextet & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
}

/** True only for addresses on the public internet. */
export function isPublicIpAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return !isBlockedIpv4(ip);
  if (version === 6) return !isBlockedIpv6(ip);
  return false;
}

export type ResolveHost = (hostname: string) => Promise<string[]>;

const resolveWithDns: ResolveHost = async (hostname) =>
  (await dnsLookup(hostname, { all: true, verbatim: true })).map(
    (entry) => entry.address,
  );

/** Parses `raw` and checks that every address it resolves to is public. */
export async function assertPublicHttpUrl(
  raw: string,
  resolveHost: ResolveHost = resolveWithDns,
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("This is not a valid web address.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError("Only http and https addresses can be fetched.");
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError(
      "Addresses with a username or password are not allowed.",
    );
  }

  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost")) {
    throw new UnsafeUrlError(PUBLIC_ONLY_MESSAGE);
  }

  let addresses: string[];
  if (isIP(host)) {
    addresses = [host];
  } else {
    try {
      addresses = await resolveHost(host);
    } catch {
      throw new UnsafeUrlError("This website's name could not be found.");
    }
  }
  if (addresses.length === 0 || !addresses.every(isPublicIpAddress)) {
    throw new UnsafeUrlError(PUBLIC_ONLY_MESSAGE);
  }
  return url;
}

const BLOCKED_LOOKUP_CODE = "EBLOCKEDADDRESS";

/** DNS lookup for the socket itself: refuses any non-public answer. */
const publicOnlyLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookupCallback(hostname, { ...options, all: true }, (error, result) => {
    if (error) {
      callback(error, "", 0);
      return;
    }
    const addresses = result as LookupAddress[];
    const first = addresses[0];
    if (
      !first ||
      !addresses.every((entry) => isPublicIpAddress(entry.address))
    ) {
      const blocked: NodeJS.ErrnoException = new Error(
        `Refusing to connect to a non-public address for ${hostname}`,
      );
      blocked.code = BLOCKED_LOOKUP_CODE;
      callback(blocked, "", 0);
      return;
    }
    if (options.all) {
      callback(null, addresses);
      return;
    }
    callback(null, first.address, first.family);
  });
};

const publicOnlyAgent = new Agent({ connect: { lookup: publicOnlyLookup } });

export const __publicOnlyLookupForTests = publicOnlyLookup;

/** What the callers read from a response; both undici and DOM responses fit. */
export type PublicFetchResponse = {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  body: {
    getReader(): {
      read(): Promise<{ done: boolean; value?: Uint8Array }>;
      cancel(reason?: unknown): Promise<void>;
    };
  } | null;
};

/** What fetchPublicUrl returns: the response, plus where redirects ended. */
export type PublicFetchResult = PublicFetchResponse & { finalUrl: string };

export type PublicFetchInit = {
  headers?: Record<string, string>;
  signal?: AbortSignal;
};

type FetchImpl = (
  url: string,
  init: PublicFetchInit & { redirect: "manual" },
) => Promise<PublicFetchResponse>;

const fetchThroughPublicAgent: FetchImpl = (url, init) =>
  undiciFetch(url, { ...init, dispatcher: publicOnlyAgent });

function isBlockedConnection(error: unknown): boolean {
  const cause = (error as { cause?: { code?: unknown } } | null)?.cause;
  return cause?.code === BLOCKED_LOOKUP_CODE;
}

/**
 * GET for user-supplied addresses: public hosts only, redirects followed by
 * hand (each hop checked again), at most `maxRedirects` of them.
 */
export async function fetchPublicUrl(
  raw: string,
  init: PublicFetchInit = {},
  options: {
    maxRedirects?: number;
    fetchImpl?: FetchImpl;
    resolveHost?: ResolveHost;
  } = {},
): Promise<PublicFetchResult> {
  const maxRedirects = options.maxRedirects ?? 3;
  const fetchImpl = options.fetchImpl ?? fetchThroughPublicAgent;
  const resolveHost = options.resolveHost ?? resolveWithDns;

  let target = await assertPublicHttpUrl(raw, resolveHost);
  for (let hop = 0; hop <= maxRedirects; hop++) {
    let response: PublicFetchResponse;
    try {
      response = await fetchImpl(target.toString(), {
        ...init,
        redirect: "manual",
      });
    } catch (error) {
      if (isBlockedConnection(error)) {
        throw new UnsafeUrlError(PUBLIC_ONLY_MESSAGE);
      }
      throw error;
    }
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body
        ?.getReader()
        .cancel()
        .catch(() => undefined);
      target = await assertPublicHttpUrl(
        new URL(location, target).toString(),
        resolveHost,
      );
      continue;
    }
    return {
      ok: response.ok,
      status: response.status,
      headers: response.headers,
      body: response.body,
      finalUrl: target.toString(),
    };
  }
  throw new UnsafeUrlError("This address redirects too many times.");
}

/** Reads a response body as UTF-8 text, refusing bodies above `maxBytes`. */
export async function readTextWithLimit(
  response: PublicFetchResponse,
  maxBytes: number,
): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body
      ?.getReader()
      .cancel()
      .catch(() => undefined);
    throw new ResponseTooLargeError(maxBytes);
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let received = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new ResponseTooLargeError(maxBytes);
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}
