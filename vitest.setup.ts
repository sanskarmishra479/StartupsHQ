import { resolveTestDatabaseUrl } from "./vitest.test-database";

// Every worker's DB client targets the dedicated, already-migrated test database.
process.env.DATABASE_URL = resolveTestDatabaseUrl();

// Test-only signing key for pagination cursors; production keys live in Vercel env vars.
process.env.CURSOR_SIGNING_SECRET ??=
  "test-only-cursor-signing-key-never-used-outside-vitest";
