import "server-only";

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware, isAPIError } from "better-auth/api";
import { twoFactor } from "better-auth/plugins/two-factor";
import { type Database, getDb } from "../db/client";
import {
  accounts,
  sessions,
  twoFactors,
  users,
  verifications,
} from "../db/schema";
import { sendEmail } from "../lib/email";
import { RateLimitedError } from "../lib/errors";
import { clientIp } from "../lib/ip";
import { adminOrigin } from "../lib/origin";
import { getRedis, hitWindow, limitKey } from "../lib/redis";
import {
  assertSignInAllowed,
  recordSignInFailure,
  recordSignInSuccess,
} from "./login-limits";

// The Better Auth instance (FR-201, SEC-04, SEC-08). Decisions, recorded in docs/SRS.md:
// - Sessions live in Postgres only. Redis holds rate limits and never sessions, so an outage of
//   the limit store refuses new sign-ins (fail closed) without signing anyone out.
// - Sign-up is closed: users are created by an admin (FR-208) or scripts/seed-admin.ts.
// - Every user enrols TOTP. Better Auth treats two-factor as opt-in, so enforcement is ours, in
//   session.ts: a session whose user has not enrolled is never an editor.
// - The plugin's account lockout is disabled: SEC-08 allows delays but no lockout.
// - On https the session cookie is `__Host-startupshq.session_token`: Secure, Path=/ and no
//   Domain, so no other subdomain can set or read it (the Phase 6 cookie spike).

type Env = Readonly<Record<string, string | undefined>>;

const SIGN_IN_PATH = "/sign-in/email";
const SECOND_FACTOR_PATHS: ReadonlySet<string> = new Set([
  "/two-factor/verify-totp",
  "/two-factor/verify-backup-code",
]);

export const PASSWORD_MIN_LENGTH = 12;

function required(env: Env, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is not set.`);
  return value;
}

function tooManyAttempts(error: RateLimitedError): APIError {
  return new APIError(
    "TOO_MANY_REQUESTS",
    { code: "RATE_LIMITED", message: "Too many attempts. Try again later." },
    { "Retry-After": String(error.retryAfterSeconds) },
  );
}

/** Runs a limiter step, turning a refusal into Better Auth's 429 response. */
async function limited(step: () => Promise<void>): Promise<void> {
  try {
    await step();
  } catch (error) {
    if (error instanceof RateLimitedError) throw tooManyAttempts(error);
    throw error;
  }
}

function createAuth(env: Env, db: Database) {
  const baseURL = required(env, "BETTER_AUTH_URL");
  const secret = required(env, "BETTER_AUTH_SECRET");
  if (secret.length < 32) {
    throw new Error("BETTER_AUTH_SECRET must be at least 32 characters.");
  }
  const https = baseURL.startsWith("https://");
  const redis = () => getRedis(env);

  return betterAuth({
    appName: "startupsHQ",
    baseURL,
    secret,
    trustedOrigins: [adminOrigin(env)],
    database: drizzleAdapter(db, {
      provider: "pg",
      usePlural: true,
      schema: { users, sessions, accounts, verifications, twoFactors },
    }),
    user: {
      additionalFields: {
        role: {
          type: "string",
          required: false,
          defaultValue: "editor",
          input: false,
        },
      },
    },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await sendEmail({
          to: user.email,
          subject: "Reset your startupsHQ password",
          text: `Someone asked to reset the password for this startupsHQ account.\n\nReset it here within an hour:\n${url}\n\nIf this was not you, ignore this email; your password is unchanged.`,
        });
      },
    },
    session: {
      expiresIn: 12 * 60 * 60,
      updateAge: 60 * 60,
      freshAge: 15 * 60,
    },
    rateLimit: {
      enabled: true,
      customStorage: {
        consume: async (key, rule) => {
          const { count, secondsLeft } = await hitWindow(
            redis(),
            limitKey("auth", key),
            rule.window,
          );
          return count <= rule.max
            ? { allowed: true, retryAfter: null }
            : { allowed: false, retryAfter: secondsLeft };
        },
      },
    },
    advanced: {
      database: { generateId: "uuid" },
      // The platform overwrites x-real-ip on Vercel; elsewhere Better Auth falls back to a shared
      // bucket, and our own limiter uses clientIp() (SEC-14).
      ipAddress: { ipAddressHeaders: ["x-real-ip"] },
      useSecureCookies: false,
      cookiePrefix: https ? "__Host-startupshq" : "startupshq",
      defaultCookieAttributes: {
        secure: https,
        httpOnly: true,
        sameSite: "lax",
        path: "/",
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== SIGN_IN_PATH && !SECOND_FACTOR_PATHS.has(ctx.path)) {
          return;
        }
        const email =
          ctx.path === SIGN_IN_PATH && typeof ctx.body?.email === "string"
            ? ctx.body.email
            : undefined;
        await limited(() =>
          assertSignInAllowed(redis(), {
            ip: clientIp(ctx.headers ?? new Headers(), env),
            email,
          }),
        );
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== SIGN_IN_PATH || typeof ctx.body?.email !== "string") {
          return;
        }
        const email: string = ctx.body.email;
        const returned = ctx.context.returned;
        if (isAPIError(returned)) {
          if (returned.statusCode === 401) {
            await limited(() => recordSignInFailure(redis(), email));
          }
          return;
        }
        // A correct password, whether it opened a session or a second-factor challenge.
        await limited(() => recordSignInSuccess(redis(), email));
      }),
    },
    plugins: [
      twoFactor({
        issuer: "startupsHQ",
        backupCodeOptions: {
          amount: 10,
          length: 10,
          storeBackupCodes: "encrypted",
        },
        accountLockout: { enabled: false },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

const globalForAuth = globalThis as typeof globalThis & {
  __startupshqAuth?: { db: Database; auth: Auth };
};

/** The shared instance, rebuilt only if the database client was closed and reopened (tests). */
export function getAuth(): Auth {
  const db = getDb();
  const cached = globalForAuth.__startupshqAuth;
  if (cached?.db === db) return cached.auth;
  const auth = createAuth(process.env, db);
  globalForAuth.__startupshqAuth = { db, auth };
  return auth;
}
