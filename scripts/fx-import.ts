import { loadEnvConfig } from "@next/env";
import { closeDb, getDb } from "../src/server/db/client";
import { ECB_DAILY_URL, importFxRates } from "../src/server/db/fx-import";

// Imports the European Central Bank's daily reference rates (FR-406). Runs on weekdays from
// maintenance.yml; re-running a day is harmless, since each day's rates are upserted.
//
//   pnpm fx:import

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set (see .env.example).");
  }

  const response = await fetch(ECB_DAILY_URL, {
    headers: { accept: "application/xml" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`The ECB feed answered ${response.status}.`);
  }

  try {
    const { rateDate, stored } = await importFxRates(
      getDb(),
      await response.text(),
    );
    console.log(`Stored ${stored} rate(s) for ${rateDate}.`);
  } finally {
    await closeDb();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
