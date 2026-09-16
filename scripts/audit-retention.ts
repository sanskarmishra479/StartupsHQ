import { loadEnvConfig } from "@next/env";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  applyAuditRetention,
  IP_RETENTION_DAYS,
  ROW_RETENTION_MONTHS,
} from "../src/server/db/audit-retention";
import * as schema from "../src/server/db/schema";

// Clears IP addresses older than 90 days and removes audit rows older than 12 months (SEC-11).
// Runs weekly from maintenance.yml under the `retention` role, which is the only role allowed to
// change the log at all — the application itself can only append to it.
//
//   RETENTION_DATABASE_URL=… pnpm audit:retention

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  const url = process.env.RETENTION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "RETENTION_DATABASE_URL is not set (see .env.example). It must name the retention user, not the application's.",
    );
  }

  const db = drizzle({ connection: url, schema });
  try {
    const { ipsCleared, rowsDeleted } = await applyAuditRetention(db);
    console.log(
      `Cleared ${ipsCleared} IP address(es) older than ${IP_RETENTION_DAYS} days and deleted ${rowsDeleted} row(s) older than ${ROW_RETENTION_MONTHS} months.`,
    );
  } finally {
    await db.$client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
