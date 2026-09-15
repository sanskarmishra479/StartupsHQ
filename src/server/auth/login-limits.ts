import "server-only";

import { createHash } from "node:crypto";
import type { Redis } from "@upstash/redis";
import { RateLimitedError } from "../lib/errors";
import { hitWindow, limitKey } from "../lib/redis";

// Sign-in limits (SEC-08): at most 20 attempts per IP in 15 minutes, and a growing delay for an
// account after 5 consecutive failures — 1 s, doubling to 30 s. There is deliberately no lockout:
// a delay slows guessing without letting anyone lock a real editor out. If the store cannot be
// reached, sign-in is refused (fail closed).

export const IP_ATTEMPTS = 20;
export const IP_WINDOW_SECONDS = 15 * 60;
export const FREE_FAILURES = 5;
export const MAX_DELAY_SECONDS = 30;

/** Failures are forgotten this long after the last one. */
const FAILURE_MEMORY_SECONDS = 15 * 60;
const STORE_UNAVAILABLE_RETRY_SECONDS = 60;

type FailureState = { failures: number; notBefore: number };

// Keyed by a hash, so no email address is ever stored in Redis.
export const accountKey = (email: string) =>
  limitKey(
    "login",
    "account",
    createHash("sha256").update(email.trim().toLowerCase()).digest("hex"),
  );

const ipKey = (ip: string) => limitKey("login", "ip", ip);

/** No delay for the first 4 failures; then 1 s, 2 s, 4 s … capped at 30 s. */
export function delayAfter(failures: number): number {
  if (failures < FREE_FAILURES) return 0;
  return Math.min(MAX_DELAY_SECONDS, 2 ** (failures - FREE_FAILURES));
}

async function failClosed<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof RateLimitedError) throw error;
    // The store is unreachable or misbehaving: refuse rather than allow unlimited guesses.
    throw new RateLimitedError(STORE_UNAVAILABLE_RETRY_SECONDS);
  }
}

/** Counts an attempt against its IP, and refuses while the IP or the account is limited. */
export async function assertSignInAllowed(
  redis: Redis,
  attempt: Readonly<{ ip: string; email?: string | undefined }>,
  now: number = Date.now(),
): Promise<void> {
  await failClosed(async () => {
    const { count, secondsLeft } = await hitWindow(
      redis,
      ipKey(attempt.ip),
      IP_WINDOW_SECONDS,
    );
    if (count > IP_ATTEMPTS) throw new RateLimitedError(secondsLeft);

    if (!attempt.email) return;
    const state = await redis.get<FailureState>(accountKey(attempt.email));
    if (state && state.notBefore > now) {
      throw new RateLimitedError(Math.ceil((state.notBefore - now) / 1000));
    }
  });
}

export async function recordSignInFailure(
  redis: Redis,
  email: string,
  now: number = Date.now(),
): Promise<void> {
  await failClosed(async () => {
    const key = accountKey(email);
    const failures = ((await redis.get<FailureState>(key))?.failures ?? 0) + 1;
    await redis.set(
      key,
      { failures, notBefore: now + delayAfter(failures) * 1000 },
      { ex: FAILURE_MEMORY_SECONDS },
    );
  });
}

export async function recordSignInSuccess(
  redis: Redis,
  email: string,
): Promise<void> {
  await failClosed(() => redis.del(accountKey(email)));
}
