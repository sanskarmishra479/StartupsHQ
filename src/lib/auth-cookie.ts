// The session cookie's name, shared by the Better Auth configuration and proxy.ts (SEC-04), so the
// two can never drift. Plain constants only: safe to import anywhere.

const PREFIX_HTTPS = "__Host-startupshq";
const PREFIX_HTTP = "startupshq";

/** `__Host-` on https (Secure, Path=/, no Domain); a plain prefix only on http local development. */
export function cookiePrefixFor(https: boolean): string {
  return https ? PREFIX_HTTPS : PREFIX_HTTP;
}

export const SESSION_COOKIE_NAMES = [
  `${PREFIX_HTTPS}.session_token`,
  `${PREFIX_HTTP}.session_token`,
] as const;
