// The dedicated test database (docs/TEST_PLAN.md §3). Shared by the global setup, which
// migrates it, and the per-worker setup, which points DATABASE_URL at it.

// Loopback-only Docker database from docker-compose.yml; not a secret.
const LOCAL_TEST_DATABASE_URL =
  "postgres://startupshq:startupshq_local@127.0.0.1:5432/startupshq_test";

export function resolveTestDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL ?? LOCAL_TEST_DATABASE_URL;
  const databaseName = new URL(url).pathname.slice(1);

  // Tests insert, truncate and change roles. Never let them near a non-test database.
  if (!databaseName.endsWith("_test")) {
    throw new Error(
      `Refusing to run tests against "${databaseName}": the test database name must end in "_test".`,
    );
  }
  return url;
}
