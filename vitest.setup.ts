// Tests always run against the dedicated test database (docs/TEST_PLAN.md §3).
// The fallback is the loopback-only Docker database from docker-compose.yml.
const LOCAL_TEST_DATABASE_URL =
  "postgres://startupshq:startupshq_local@127.0.0.1:5432/startupshq_test";

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ?? LOCAL_TEST_DATABASE_URL;
const databaseName = new URL(testDatabaseUrl).pathname.slice(1);

// Test suites truncate tables. Never let them near a non-test database.
if (!databaseName.endsWith("_test")) {
  throw new Error(
    `Refusing to run tests against "${databaseName}": the test database name must end in "_test".`,
  );
}

process.env.DATABASE_URL = testDatabaseUrl;
