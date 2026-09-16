import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { resolveTestDatabaseUrl } from "./vitest.test-database";

/**
 * Applies every migration in ./drizzle to the test database once per run, so each test run —
 * locally and in CI — proves the committed migrations apply cleanly to a real Postgres.
 */
/**
 * Login users for the privilege tests (SEC-10). Production creates its own per environment, with
 * passwords that never live in git; these exist only in the test database, which is loopback-only
 * and recreated at will, and each one holds exactly the group role it is named for.
 */
const TEST_ROLE_USERS = [
  { user: "test_app_rw", group: "startupshq_app" },
  { user: "test_retention", group: "startupshq_retention" },
  { user: "test_backup", group: "startupshq_backup" },
] as const;

export default async function setup(): Promise<void> {
  const db = drizzle({ connection: resolveTestDatabaseUrl() });
  try {
    await migrate(db, { migrationsFolder: "./drizzle" });

    for (const { user, group } of TEST_ROLE_USERS) {
      const existing = await db.execute(
        sql`select 1 from pg_roles where rolname = ${user}`,
      );
      // The names are constants in this file, never input, so they can be written literally —
      // a DO block's body is opaque to the parser and cannot take parameters.
      if (existing.rows.length === 0) {
        await db.execute(
          sql.raw(`create role ${user} login password '${user}'`),
        );
      }
      await db.execute(sql.raw(`grant ${group} to ${user}`));
    }
  } finally {
    await db.$client.end();
  }
}
