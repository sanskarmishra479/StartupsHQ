import "server-only";

import { isIP } from "node:net";
import { ipAddress } from "@vercel/functions";

// Trusted client IP (SEC-14), used for rate limiting and the audit log.
//
// On Vercel, x-real-ip is set by Vercel's edge, which overwrites client-supplied forwarding
// headers "to prevent IP spoofing" (Vercel request-header docs). Anywhere else there is no
// trusted proxy, so request headers are ignored entirely.

const LOCAL_ADDRESS = "127.0.0.1";
/** On Vercel but without a usable header: one shared, clearly unknown bucket. */
const UNKNOWN_ADDRESS = "0.0.0.0";

export function clientIp(
  headers: Headers,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  if (env.VERCEL !== "1") return LOCAL_ADDRESS;
  const ip = ipAddress(headers);
  return ip && isIP(ip) !== 0 ? ip : UNKNOWN_ADDRESS;
}
