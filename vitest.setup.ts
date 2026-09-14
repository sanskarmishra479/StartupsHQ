import { resolveTestDatabaseUrl } from "./vitest.test-database";

// Every worker's DB client targets the dedicated, already-migrated test database.
process.env.DATABASE_URL = resolveTestDatabaseUrl();
