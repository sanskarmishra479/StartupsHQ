import "server-only";

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

/**
 * The only module that reads DATABASE_URL (SEC-01).
 *
 * The connection is created lazily on first use, so importing this module
 * during `next build` never opens a connection.
 */
export type Database = NodePgDatabase<typeof schema>;

type DbHandle = { pool: Pool; db: Database };

// Reuse one pool per process, including across dev hot reloads.
const globalForDb = globalThis as typeof globalThis & {
  __startupshqDb?: DbHandle;
};

export function getDb(): Database {
  const existing = globalForDb.__startupshqDb;
  if (existing) return existing.db;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set.");
  }

  const pool = new Pool({ connectionString, max: 5 });
  const db = drizzle({ client: pool, schema });
  globalForDb.__startupshqDb = { pool, db };
  return db;
}

/** Closes the pool. For scripts and tests — the running app never calls this. */
export async function closeDb(): Promise<void> {
  const existing = globalForDb.__startupshqDb;
  if (!existing) return;
  globalForDb.__startupshqDb = undefined;
  await existing.pool.end();
}
