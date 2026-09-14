import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { resolveTestDatabaseUrl } from "./vitest.test-database";

/**
 * Applies every migration in ./drizzle to the test database once per run, so each test run —
 * locally and in CI — proves the committed migrations apply cleanly to a real Postgres.
 */
export default async function setup(): Promise<void> {
  const db = drizzle({ connection: resolveTestDatabaseUrl() });
  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
  } finally {
    await db.$client.end();
  }
}
