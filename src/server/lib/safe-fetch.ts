import "server-only";

import type { LookupAddress } from "node:dns";
import { lookup as dnsLookup } from "node:dns/promises";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { Agent, fetch } from "undici";
import { UnsafeUrlError } from "./errors";

// Server-side fetching of URLs we did not author (SEC-05): the pasted prefill page, every image
// or icon it references, and URLs returned by Firecrawl. Each is attacker-controlled.
//
// Defences, in order: https only, no credentials, standard port only, no local or single-label
// hostnames, IP-literal hosts must be public, DNS answers are validated at connect time by the
// socket's own lookup (so a rebinding DNS server cannot swap in a private address between check
// and connect), every redirect hop is re-validated, and time and size are capped.

export const TIMEOUT_MS = 5_000;
export const MAX_BYTES = 5 * 1024 * 1024;
export const MAX_REDIRECTS = 3;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const nonPublic = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, including cloud metadata (169.254.169.254)
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.88.99.0", 24], // 6to4 relay
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, including broadcast
] as const) {
  nonPublic.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  // IPv4-mapped addresses (::ffff:0:0/96) are deliberately NOT listed: Node's BlockList applies
  // that range to plain IPv4 checks too, which would block every IPv4 address. Mapped addresses
  // are unwrapped and checked as IPv4 in isPublicAddress() instead.
  ["64:ff9b::", 96], // NAT64, can reach internal IPv4
  ["100::", 64], // discard
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4, embeds an IPv4 address
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
] as const) {
  nonPublic.addSubnet(network, prefix, "ipv6");
}

/** "::ffff:127.0.0.1" or "::ffff:7f00:1" → "127.0.0.1"; anything else → null. */
function unwrapMappedIpv4(ipv6: string): string | null {
  const normalized = new URL(`http://[${ipv6}]`).hostname.slice(1, -1);
  const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(normalized);
  if (dotted?.[1]) return dotted[1];
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(normalized);
  if (!hex?.[1] || !hex[2]) return null;
  const high = Number.parseInt(hex[1], 16);
  const low = Number.parseInt(hex[2], 16);
  return [high >> 8, high & 255, low >> 8, low & 255].join(".");
}

/** Fails closed: anything that is not a recognizably public IP address is not public. */
export function isPublicAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return !nonPublic.check(address, "ipv4");
  if (version === 6) {
    const mapped = unwrapMappedIpv4(address);
    if (mapped) return isPublicAddress(mapped);
    return !nonPublic.check(address, "ipv6");
  }
  return false;
}

/** Validates a URL before any request. Throws UnsafeUrlError with a client-safe reason. */
export function assertSafeUrl(input: string | URL): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new UnsafeUrlError("it is not a valid URL.");
  }

  if (url.protocol !== "https:") {
    throw new UnsafeUrlError("only https URLs are allowed.");
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError("URLs containing credentials are not allowed.");
  }
  if (url.port !== "" && url.port !== "443") {
    throw new UnsafeUrlError("non-standard ports are not allowed.");
  }

  // WHATWG URL parsing already normalizes decimal, octal and hex IPv4 forms to dotted quads.
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();

  if (isIP(host) !== 0) {
    if (!isPublicAddress(host)) {
      throw new UnsafeUrlError("it points to a private or reserved address.");
    }
    return url;
  }

  if (
    host === "localhost" ||
    /\.(localhost|local|internal|intranet|lan|home|corp)$/.test(host) ||
    !host.includes(".")
  ) {
    throw new UnsafeUrlError("it points to a local or internal hostname.");
  }
  return url;
}

/** Resolves a redirect's Location against the current URL and re-validates it. */
export function resolveRedirect(current: URL, location: string | null): URL {
  if (!location) throw new UnsafeUrlError("a redirect had no destination.");
  return assertSafeUrl(new URL(location, current));
}

export type Resolver = (hostname: string) => Promise<readonly LookupAddress[]>;

const systemResolver: Resolver = (hostname) =>
  dnsLookup(hostname, { all: true });

/**
 * A socket lookup that refuses the whole hostname if any resolved address is non-public, and
 * otherwise connects only to the addresses it validated.
 */
export function createSafeLookup(
  resolve: Resolver = systemResolver,
): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname).then(
      (addresses) => {
        if (
          addresses.length === 0 ||
          !addresses.every((entry) => isPublicAddress(entry.address))
        ) {
          const error: NodeJS.ErrnoException = new Error(
            "Refusing to connect to a non-public address.",
          );
          error.code = "EUNSAFEADDRESS";
          callback(error, "");
          return;
        }

        const family =
          options.family === 4 || options.family === 6 ? options.family : 0;
        const usable = family
          ? addresses.filter((entry) => entry.family === family)
          : [...addresses];
        const [first] = usable;
        if (!first) {
          const error: NodeJS.ErrnoException = new Error("No usable address.");
          error.code = "ENOTFOUND";
          callback(error, "");
          return;
        }

        if (options.all) callback(null, usable);
        else callback(null, first.address, first.family);
      },
      (error: NodeJS.ErrnoException) => callback(error, ""),
    );
  };
}

function errorCodes(error: unknown): Set<string> {
  const codes = new Set<string>();
  const queue: unknown[] = [error];
  for (let depth = 0; queue.length > 0 && depth < 20; depth++) {
    const current = queue.shift();
    if (typeof current !== "object" || current === null) continue;
    const { code, name, cause, errors } = current as {
      code?: unknown;
      name?: unknown;
      cause?: unknown;
      errors?: unknown;
    };
    if (typeof code === "string") codes.add(code);
    if (typeof name === "string") codes.add(name);
    if (cause) queue.push(cause);
    if (Array.isArray(errors)) queue.push(...errors);
  }
  return codes;
}

function toUnsafeUrlError(error: unknown): UnsafeUrlError {
  if (error instanceof UnsafeUrlError) return error;
  const codes = errorCodes(error);
  if (codes.has("EUNSAFEADDRESS")) {
    return new UnsafeUrlError(
      "it resolves to a private or reserved address.",
      error,
    );
  }
  if (codes.has("UND_ERR_RES_EXCEEDED_MAX_SIZE")) {
    return new UnsafeUrlError("the response is larger than 5 MB.", error);
  }
  if (
    [
      "TimeoutError",
      "AbortError",
      "UND_ERR_CONNECT_TIMEOUT",
      "UND_ERR_HEADERS_TIMEOUT",
      "UND_ERR_BODY_TIMEOUT",
    ].some((code) => codes.has(code))
  ) {
    return new UnsafeUrlError("it took too long to respond.", error);
  }
  return new UnsafeUrlError("it could not be reached.", error);
}

type ResponseBody = Awaited<ReturnType<typeof fetch>>["body"];

/** Reads a body up to maxBytes after decompression, so a small compressed bomb cannot expand. */
async function readCapped(
  body: ResponseBody,
  maxBytes: number,
): Promise<Buffer> {
  if (!body) return Buffer.alloc(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new UnsafeUrlError("the response is larger than 5 MB.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

export type SafeResponse = {
  url: string;
  status: number;
  contentType: string | null;
  body: Buffer;
};

export type SafeFetchOptions = {
  /** Replaces DNS resolution; used by tests to simulate hostile resolvers. */
  resolve?: Resolver;
  accept?: string;
  timeoutMs?: number;
  maxBytes?: number;
};

export async function safeFetch(
  input: string,
  options: SafeFetchOptions = {},
): Promise<SafeResponse> {
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? MAX_BYTES;
  const agent = new Agent({
    connect: { lookup: createSafeLookup(options.resolve), timeout: timeoutMs },
    headersTimeout: timeoutMs,
    bodyTimeout: timeoutMs,
    maxResponseSize: maxBytes,
  });
  const signal = AbortSignal.timeout(timeoutMs);

  try {
    let url = assertSafeUrl(input);
    for (let redirects = 0; ; redirects++) {
      const response = await fetch(url, {
        dispatcher: agent,
        redirect: "manual",
        signal,
        headers: {
          accept:
            options.accept ?? "text/html,application/xhtml+xml,image/*;q=0.8",
          "user-agent": "startupsHQ-prefill/1.0",
        },
      });

      if (REDIRECT_STATUSES.has(response.status)) {
        await response.body?.cancel();
        if (redirects >= MAX_REDIRECTS) {
          throw new UnsafeUrlError("it redirects too many times.");
        }
        url = resolveRedirect(url, response.headers.get("location"));
        continue;
      }

      const declared = Number(response.headers.get("content-length"));
      if (declared > maxBytes) {
        await response.body?.cancel();
        throw new UnsafeUrlError("the response is larger than 5 MB.");
      }

      return {
        url: url.href,
        status: response.status,
        contentType: response.headers.get("content-type"),
        body: await readCapped(response.body, maxBytes),
      };
    }
  } catch (error) {
    throw toUnsafeUrlError(error);
  } finally {
    await agent.destroy();
  }
}
