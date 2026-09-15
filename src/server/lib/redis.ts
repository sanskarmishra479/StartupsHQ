import "server-only";

import { Redis } from "@upstash/redis";

// The shared store for sensitive rate limits (SEC-08, ADR-017): Upstash in production, and the
// loopback serverless-redis-http proxy locally and in CI, which speaks the same REST API. Callers
// treat any error from here as a reason to refuse a request, never to allow it (fail closed).

type Env = Readonly<Record<string, string | undefined>>;

let client: Redis | undefined;

export function getRedis(env: Env = process.env): Redis {
  if (client) return client;
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error(
      "UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be set.",
    );
  }
  // No retries: a slow or failing store should refuse quickly, not hold a sign-in open.
  client = new Redis({ url, token, retry: false, enableTelemetry: false });
  return client;
}

/**
 * Every key carries a namespace, so environments and test files sharing one store never collide.
 */
export function limitKey(...parts: string[]): string {
  return [process.env.RATE_LIMIT_NAMESPACE || "startupshq", ...parts].join(":");
}

// INCR and EXPIRE in one script, so a counter can never be left without an expiry.
const HIT_WINDOW = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then redis.call("EXPIRE", KEYS[1], ARGV[1]) end
return { count, redis.call("TTL", KEYS[1]) }`;

/**
 * Counts one hit in a fixed window that starts at the first hit. Returns the count so far and the
 * seconds until the window resets.
 */
export async function hitWindow(
  redis: Redis,
  key: string,
  windowSeconds: number,
): Promise<{ count: number; secondsLeft: number }> {
  const [count, ttl] = await redis.eval<[number], [number, number]>(
    HIT_WINDOW,
    [key],
    [windowSeconds],
  );
  return { count, secondsLeft: ttl > 0 ? ttl : windowSeconds };
}
