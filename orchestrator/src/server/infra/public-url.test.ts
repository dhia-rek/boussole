import { describe, expect, it } from "vitest";
import {
  __publicOnlyLookupForTests,
  assertPublicHttpUrl,
  fetchPublicUrl,
  isPublicIpAddress,
  type PublicFetchResponse,
  ResponseTooLargeError,
  readTextWithLimit,
  UnsafeUrlError,
} from "./public-url";

const resolvesTo =
  (...addresses: string[]) =>
  async () =>
    addresses;

function redirect(location: string): PublicFetchResponse {
  return new Response(null, { status: 302, headers: { location } });
}

describe("isPublicIpAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "100.100.1.1",
    "169.254.169.254",
    "172.18.0.1",
    "192.168.1.10",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "::",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "fd7a:115c:a1e0::1",
    "fe80::1",
    "not-an-ip",
  ])("blocks %s", (ip) => {
    expect(isPublicIpAddress(ip)).toBe(false);
  });

  it.each([
    "8.8.8.8",
    "93.184.216.34",
    "2606:4700:4700::1111",
  ])("allows %s", (ip) => {
    expect(isPublicIpAddress(ip)).toBe(true);
  });
});

describe("assertPublicHttpUrl", () => {
  it.each([
    ["not a url", "not a valid web address"],
    ["file:///etc/passwd", "Only http and https"],
    ["https://user:pass@example.com", "username or password"],
    ["http://localhost:3001/api", "Only public websites"],
    ["http://app.localhost/", "Only public websites"],
    ["http://127.0.0.1:8888/", "Only public websites"],
    ["http://2130706433/", "Only public websites"],
    ["http://[::ffff:7f00:1]/", "Only public websites"],
    ["http://169.254.169.254/latest/meta-data", "Only public websites"],
  ])("rejects %s", async (raw, message) => {
    await expect(
      assertPublicHttpUrl(raw, resolvesTo("93.184.216.34")),
    ).rejects.toThrow(message);
  });

  it("rejects names that resolve to a private address", async () => {
    await expect(
      assertPublicHttpUrl("https://intranet.example", resolvesTo("10.0.0.5")),
    ).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it("rejects names where any answer is private", async () => {
    await expect(
      assertPublicHttpUrl(
        "https://mixed.example",
        resolvesTo("93.184.216.34", "127.0.0.1"),
      ),
    ).rejects.toThrow("Only public websites");
  });

  it("explains unknown names", async () => {
    await expect(
      assertPublicHttpUrl("https://nope.example", async () => {
        throw new Error("ENOTFOUND");
      }),
    ).rejects.toThrow("could not be found");
  });

  it("accepts public websites", async () => {
    const url = await assertPublicHttpUrl(
      "https://jobs.example.com/offer/42",
      resolvesTo("93.184.216.34"),
    );
    expect(url.hostname).toBe("jobs.example.com");
  });
});

describe("fetchPublicUrl", () => {
  it("follows public redirects and returns the final page", async () => {
    const seen: string[] = [];
    const response = await fetchPublicUrl(
      "https://a.example/job",
      {},
      {
        resolveHost: resolvesTo("93.184.216.34"),
        fetchImpl: async (url) => {
          seen.push(url);
          return url.startsWith("https://a.example")
            ? redirect("https://b.example/job")
            : new Response("<html>offer</html>");
        },
      },
    );
    expect(seen).toEqual(["https://a.example/job", "https://b.example/job"]);
    expect(response.status).toBe(200);
  });

  it("refuses a redirect to the server's own network", async () => {
    await expect(
      fetchPublicUrl(
        "https://a.example/job",
        {},
        {
          resolveHost: resolvesTo("93.184.216.34"),
          fetchImpl: async () => redirect("http://127.0.0.1:18789/"),
        },
      ),
    ).rejects.toThrow("Only public websites");
  });

  it("stops after too many redirects", async () => {
    await expect(
      fetchPublicUrl(
        "https://a.example/loop",
        {},
        {
          maxRedirects: 2,
          resolveHost: resolvesTo("93.184.216.34"),
          fetchImpl: async () => redirect("https://a.example/loop"),
        },
      ),
    ).rejects.toThrow("redirects too many times");
  });

  it("reports a connection refused for a non-public address as unsafe", async () => {
    await expect(
      fetchPublicUrl(
        "https://rebind.example/",
        {},
        {
          resolveHost: resolvesTo("93.184.216.34"),
          fetchImpl: async () => {
            throw Object.assign(new TypeError("fetch failed"), {
              cause: { code: "EBLOCKEDADDRESS" },
            });
          },
        },
      ),
    ).rejects.toBeInstanceOf(UnsafeUrlError);
  });
});

describe("connection-time lookup", () => {
  it("refuses names that resolve to loopback", async () => {
    const error = await new Promise<NodeJS.ErrnoException | null>((resolve) => {
      __publicOnlyLookupForTests("localhost", {}, (err) => resolve(err));
    });
    expect(error?.code).toBe("EBLOCKEDADDRESS");
  });
});

describe("readTextWithLimit", () => {
  it("reads a small page", async () => {
    await expect(
      readTextWithLimit(new Response("<p>héllo</p>"), 1000),
    ).resolves.toBe("<p>héllo</p>");
  });

  it("refuses a declared size above the limit", async () => {
    const response = new Response("tiny", {
      headers: { "content-length": "50000000" },
    });
    await expect(readTextWithLimit(response, 1000)).rejects.toBeInstanceOf(
      ResponseTooLargeError,
    );
  });

  it("stops reading once the limit is passed", async () => {
    const response = new Response("x".repeat(5000));
    await expect(readTextWithLimit(response, 1000)).rejects.toBeInstanceOf(
      ResponseTooLargeError,
    );
  });
});
