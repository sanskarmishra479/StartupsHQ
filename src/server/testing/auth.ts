import "server-only";

import { createHmac, randomInt, randomUUID } from "node:crypto";
import { eq, like } from "drizzle-orm";
import { getAuth } from "../auth/better-auth";
import type { Role } from "../auth/context";
import { createCredentialUser } from "../auth/users";
import { getDb } from "../db/client";
import { sessions, users } from "../db/schema";

// Helpers for tests that drive the real Better Auth handler with real HTTP requests.

export const TEST_PASSWORD = "correct horse battery staple";
const TEST_EMAIL_DOMAIN = "auth.test";

/** A fresh address from the benchmarking range 198.18.0.0/15, never a real client. */
export const testIp = () => `198.18.${randomInt(0, 256)}.${randomInt(1, 255)}`;

export async function createTestUser(
  role: Role = "editor",
): Promise<{ id: string; email: string }> {
  const email = `${randomUUID()}@${TEST_EMAIL_DOMAIN}`;
  const { id } = await createCredentialUser({
    email,
    name: `Test ${role}`,
    password: TEST_PASSWORD,
    role,
  });
  return { id, email };
}

/**
 * Users created by createTestUser, with their sessions, accounts and second factors. A user who
 * wrote through the API has audit history, whose actor is kept (`on delete restrict`: users with
 * history are deactivated, never deleted), so that user is only signed out.
 */
export async function deleteTestUsers(): Promise<void> {
  const db = getDb();
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(like(users.email, `%@${TEST_EMAIL_DOMAIN}`));
  for (const { id } of rows) {
    try {
      await db.delete(users).where(eq(users.id, id));
    } catch (error) {
      const code = (error as { cause?: { code?: unknown } }).cause?.code;
      if (code !== "23503") throw error;
      await db.delete(sessions).where(eq(sessions.userId, id));
    }
  }
}

/** A cookie jar that follows Set-Cookie headers, as a browser would. */
export class CookieJar {
  private readonly cookies = new Map<string, string>();

  absorb(setCookies: readonly string[]): void {
    for (const header of setCookies) {
      const [pair = "", ...attributes] = header.split(";");
      const separator = pair.indexOf("=");
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      const expired = attributes.some((attribute) =>
        /^\s*max-age=0\s*$/i.test(attribute),
      );
      if (!value || expired) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  has(name: string): boolean {
    return this.cookies.has(name);
  }

  header(): string {
    return [...this.cookies]
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }
}

export type AuthResponse = Readonly<{
  status: number;
  body: Record<string, unknown> | null;
  headers: Headers;
  setCookies: string[];
}>;

/** POSTs JSON to a Better Auth endpoint on the admin origin. */
export async function authPost(
  path: string,
  body: unknown,
  options: Readonly<{ jar?: CookieJar; ip?: string }> = {},
): Promise<AuthResponse> {
  const headers = new Headers({
    "content-type": "application/json",
    origin: process.env.ADMIN_ORIGIN ?? "",
    "x-real-ip": options.ip ?? testIp(),
  });
  const cookie = options.jar?.header();
  if (cookie) headers.set("cookie", cookie);

  const response = await getAuth().handler(
    new Request(`${process.env.BETTER_AUTH_URL}/api/auth${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
  );
  const setCookies = response.headers.getSetCookie();
  options.jar?.absorb(setCookies);

  const text = await response.text();
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    parsed = { raw: text };
  }
  return {
    status: response.status,
    body: parsed,
    headers: response.headers,
    setCookies,
  };
}

/** Request headers carrying a jar's cookies, as a route handler would receive them. */
export function headersWith(jar: CookieJar, ip: string = testIp()): Headers {
  return new Headers({ cookie: jar.header(), "x-real-ip": ip });
}

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(input: string): Buffer {
  let bits = "";
  for (const char of input.replace(/=+$/, "").toUpperCase()) {
    const value = BASE32.indexOf(char);
    if (value < 0) throw new Error("Not base32.");
    bits += value.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

/**
 * An RFC 6238 TOTP code (SHA-1, 6 digits, 30 s), computed independently of Better Auth, as an
 * authenticator app would compute it from the enrolment QR code's secret.
 */
export function totp(base32Secret: string, at: number = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const digest = createHmac("sha1", base32Decode(base32Secret))
    .update(counter)
    .digest();
  const offset = (digest.at(-1) ?? 0) & 0x0f;
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, "0");
}

/**
 * Signs a test user in with the test password and enrols TOTP, as a first sign-in must, and
 * returns a jar holding the resulting two-factor-completed session.
 */
export async function signInWithTwoFactor(email: string): Promise<CookieJar> {
  const jar = new CookieJar();
  const signedIn = await authPost(
    "/sign-in/email",
    { email, password: TEST_PASSWORD },
    { jar },
  );
  if (signedIn.status !== 200) {
    throw new Error(`Sign-in failed with ${signedIn.status}.`);
  }
  const enabled = await authPost(
    "/two-factor/enable",
    { password: TEST_PASSWORD },
    { jar },
  );
  const secret = enabled.body?.totpURI
    ? new URL(String(enabled.body.totpURI)).searchParams.get("secret")
    : null;
  if (enabled.status !== 200 || !secret) {
    throw new Error(`Two-factor enrolment failed with ${enabled.status}.`);
  }
  const verified = await authPost(
    "/two-factor/verify-totp",
    { code: totp(secret) },
    { jar },
  );
  if (verified.status !== 200) {
    throw new Error(`Two-factor verification failed with ${verified.status}.`);
  }
  return jar;
}
