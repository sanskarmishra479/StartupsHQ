import { randomUUID } from "node:crypto";
import { resolveTestDatabaseUrl } from "./vitest.test-database";

// Each test file gets its own rate-limit namespace, so limits from one run never leak into the next.
process.env.RATE_LIMIT_NAMESPACE = `test:${randomUUID()}`;

// Every worker's DB client targets the dedicated, already-migrated test database.
process.env.DATABASE_URL = resolveTestDatabaseUrl();

// Test-only signing key for pagination cursors; production keys live in Vercel env vars.
process.env.CURSOR_SIGNING_SECRET ??=
  "test-only-cursor-signing-key-never-used-outside-vitest";

// Test-only auth configuration. The rate-limit store is the loopback redis-http service from
// docker-compose.yml, so tests run the same Upstash client and fail-closed path as production.
process.env.BETTER_AUTH_SECRET ??=
  "test-only-better-auth-secret-7f3a9c1e5b2d8046f9a1c3e7b5d2";
process.env.BETTER_AUTH_URL ??= "https://admin.startupshq.test";
process.env.ADMIN_ORIGIN ??= "https://admin.startupshq.test";
process.env.UPSTASH_REDIS_REST_URL ??= "http://127.0.0.1:8079";
process.env.UPSTASH_REDIS_REST_TOKEN ??= "startupshq_local_redis";
