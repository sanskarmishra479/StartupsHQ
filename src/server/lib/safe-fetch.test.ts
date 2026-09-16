import type { LookupAddress } from "node:dns";
import type { LookupFunction } from "node:net";
import { describe, expect, it } from "vitest";
import { UnsafeUrlError } from "./errors";
import {
  assertSafeUrl,
  createSafeLookup,
  isPublicAddress,
  type Resolver,
  resolveRedirect,
  safeFetch,
} from "./safe-fetch";

// SEC-05 — the SSRF matrix in docs/TEST_PLAN.md §8.

const resolverReturning =
  (...addresses: string[]): Resolver =>
  async () =>
    addresses.map((address) => ({
      address,
      family: address.includes(":") ? 6 : 4,
    }));

function runLookup(
  lookup: LookupFunction,
  options: { all?: boolean; family?: number } = {},
): Promise<string | LookupAddress[]> {
  return new Promise((resolve, reject) => {
    lookup("target.example.com", options, (error, address) => {
      if (error) reject(error);
      else resolve(address);
    });
  });
}

describe("isPublicAddress", () => {
  it.each([
    "127.0.0.1",
    "127.255.255.254",
    "10.0.0.1",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "100.64.0.1",
    "169.254.169.254",
    "0.0.0.0",
    "192.0.2.10",
    "198.51.100.10",
    "203.0.113.10",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "0:0:0:0:0:ffff:a00:1",
    "64:ff9b::a00:1",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "ff02::1",
    "2001:db8::1",
    "2002:7f00:1::",
    "not-an-ip",
    "",
  ])("treats %j as non-public", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "93.184.216.34",
    "2606:4700:4700::1111",
    "::ffff:8.8.8.8",
    // NAT64 of a public IPv4 (76.76.21.22): judged by what it embeds, so it is allowed.
    "64:ff9b::4c4c:1516",
  ])("treats %s as public", (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });
});

describe("assertSafeUrl", () => {
  it.each([
    ["http://example.com/", "only https"],
    ["file:///etc/passwd", "only https"],
    ["https://localhost/", "local or internal"],
    ["https://app.localhost/", "local or internal"],
    ["https://metadata.google.internal/", "local or internal"],
    ["https://intranet/", "local or internal"],
    ["https://127.0.0.1/", "private or reserved"],
    ["https://[::1]/", "private or reserved"],
    ["https://[::ffff:127.0.0.1]/", "private or reserved"],
    ["https://10.0.0.1/", "private or reserved"],
    ["https://172.16.0.1/", "private or reserved"],
    ["https://192.168.1.1/", "private or reserved"],
    ["https://100.64.0.1/", "private or reserved"],
    ["https://169.254.169.254/latest/meta-data/", "private or reserved"],
    ["https://2130706433/", "private or reserved"], // decimal 127.0.0.1
    ["https://0177.0.0.1/", "private or reserved"], // octal
    ["https://0x7f.1/", "private or reserved"], // hex
    ["https://user:pass@example.com/", "credentials"],
    ["https://example.com:8443/", "non-standard ports"],
    ["not a url", "not a valid URL"],
  ])("rejects %s", (url, reason) => {
    expect(() => assertSafeUrl(url)).toThrow(UnsafeUrlError);
    expect(() => assertSafeUrl(url)).toThrow(reason);
  });

  it("accepts a public https URL", () => {
    expect(assertSafeUrl("https://www.example.com/about").hostname).toBe(
      "www.example.com",
    );
    expect(assertSafeUrl("https://example.com:443/").port).toBe("");
  });

  it("never echoes a resolved internal address in its message", () => {
    try {
      assertSafeUrl("https://2130706433/");
    } catch (error) {
      expect((error as Error).message).not.toContain("127.0.0.1");
    }
  });
});

describe("resolveRedirect", () => {
  const current = new URL("https://startup.example.com/about");

  it("follows a relative redirect on the same host", () => {
    expect(resolveRedirect(current, "/team").href).toBe(
      "https://startup.example.com/team",
    );
  });

  it.each([
    "http://startup.example.com/",
    "https://127.0.0.1/",
    "https://169.254.169.254/latest/meta-data/",
    "https://localhost:443/",
  ])("rejects a redirect to %s", (location) => {
    expect(() => resolveRedirect(current, location)).toThrow(UnsafeUrlError);
  });

  it("rejects a redirect without a destination", () => {
    expect(() => resolveRedirect(current, null)).toThrow(UnsafeUrlError);
  });
});

describe("createSafeLookup (connect-time validation)", () => {
  it("connects only to validated public addresses", async () => {
    const lookup = createSafeLookup(resolverReturning("93.184.216.34"));
    expect(await runLookup(lookup)).toBe("93.184.216.34");
    expect(await runLookup(lookup, { all: true })).toEqual([
      { address: "93.184.216.34", family: 4 },
    ]);
  });

  it("refuses a hostname that resolves to a private address", async () => {
    const lookup = createSafeLookup(resolverReturning("10.0.0.5"));
    await expect(runLookup(lookup)).rejects.toMatchObject({
      code: "EUNSAFEADDRESS",
    });
  });

  it("hands over only the public addresses of a mixed answer", async () => {
    // Dual-stack and DNS64 resolvers mix these routinely; the private one is simply dropped.
    const lookup = createSafeLookup(
      resolverReturning("93.184.216.34", "127.0.0.1"),
    );
    expect(await runLookup(lookup, { all: true })).toEqual([
      { address: "93.184.216.34", family: 4 },
    ]);
    expect(await runLookup(lookup)).toBe("93.184.216.34");
  });

  it("defeats DNS rebinding: every connection re-validates the fresh answer", async () => {
    const answers = ["93.184.216.34", "169.254.169.254"];
    const rebinding: Resolver = async () => {
      const address = answers.shift() ?? "169.254.169.254";
      return [{ address, family: 4 }];
    };
    const lookup = createSafeLookup(rebinding);

    expect(await runLookup(lookup)).toBe("93.184.216.34"); // the check a naive fetcher would do
    await expect(runLookup(lookup)).rejects.toMatchObject({
      code: "EUNSAFEADDRESS",
    }); // the connect
  });

  it("refuses an empty answer", async () => {
    const lookup = createSafeLookup(async () => []);
    await expect(runLookup(lookup)).rejects.toMatchObject({
      code: "EUNSAFEADDRESS",
    });
  });
});

describe("safeFetch", () => {
  it("rejects unsafe URLs before any network activity", async () => {
    for (const url of [
      "http://example.com/",
      "https://169.254.169.254/latest/meta-data/",
    ]) {
      await expect(safeFetch(url)).rejects.toThrow(UnsafeUrlError);
    }
  });

  it("refuses to connect when the hostname resolves to a private address", async () => {
    const attempt = safeFetch("https://rebind.example.com/", {
      resolve: resolverReturning("127.0.0.1"),
      timeoutMs: 2_000,
    });
    await expect(attempt).rejects.toThrow(UnsafeUrlError);
    await expect(attempt).rejects.toThrow("private or reserved");
  });
});
