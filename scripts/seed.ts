import { loadEnvConfig } from "@next/env";
import { closeDb, getDb } from "../src/server/db/client";
import { seed } from "../src/server/db/seed";
import { resolveTestDatabaseUrl } from "../vitest.test-database";

// Replaces all directory content with the fictional fixtures.
//   pnpm db:seed          → DATABASE_URL (local development)
//   pnpm db:seed --test   → the *_test database
//
// Seeding truncates every content table, so any database that is not on this machine requires
// SEED_CONFIRM_DATABASE=<database name> — e.g. the disposable Neon seed branch used by previews.

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());

  if (process.argv.includes("--test")) {
    process.env.DATABASE_URL = resolveTestDatabaseUrl();
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set (see .env.example).");
  }

  const { hostname, pathname } = new URL(url);
  const database = pathname.slice(1);

  if (
    !LOOPBACK_HOSTS.has(hostname) &&
    process.env.SEED_CONFIRM_DATABASE !== database
  ) {
    throw new Error(
      `Refusing to seed "${database}" on ${hostname}: it is not a local database. ` +
        `If it is disposable, set SEED_CONFIRM_DATABASE=${database}.`,
    );
  }

  try {
    const summary = await seed(getDb());
    const total = Object.values(summary).reduce((sum, count) => sum + count, 0);
    console.log(`Seeded "${database}": ${total} rows.`);
    for (const [table, count] of Object.entries(summary)) {
      if (count > 0) console.log(`  ${table.padEnd(20)} ${count}`);
    }
  } finally {
    await closeDb();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
