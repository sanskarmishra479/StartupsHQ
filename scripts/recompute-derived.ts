import { loadEnvConfig } from "@next/env";
import { closeDb, getDb } from "../src/server/db/client";
import { repairStartupDerived } from "../src/server/db/derived";
import { resolveTestDatabaseUrl } from "../vitest.test-database";

// Repairs every startup's derived totals and latest round from its published rounds (FR-404,
// ADR-009). Idempotent and safe on any database: the columns are a pure function of the rounds.
//   pnpm recompute:derived          → DATABASE_URL
//   pnpm recompute:derived --test   → the *_test database
//
// This runs outside Next.js, so it cannot expire cached pages. Cached startup pages expire within
// a day and lists within hours; after repairing a production database, redeploy to clear them now.

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  if (process.argv.includes("--test")) {
    process.env.DATABASE_URL = resolveTestDatabaseUrl();
  }

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (see .env.example).");
  const { hostname, pathname } = new URL(url);

  try {
    const { checked, repaired } = await repairStartupDerived(getDb());
    console.log(
      `Checked ${checked} startups in "${pathname.slice(1)}" on ${hostname}: ${repaired} repaired.`,
    );
    if (repaired > 0) {
      console.log(
        "Cached pages were not expired; redeploy to serve the repaired totals immediately.",
      );
    }
  } finally {
    await closeDb();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
