import { loadEnvConfig } from "@next/env";
import { closeDb, getDb } from "../src/server/db/client";
import { sweepMediaAssets } from "../src/server/db/media-gc";
import { deleteBlobPrefix } from "../src/server/lib/blob";
import { resolveTestDatabaseUrl } from "../vitest.test-database";

// Deletes staging uploads nobody saved (> 24 h) and attached assets no record references any
// more (> 7 days), with their blobs (FR-408). Runs weekly from maintenance.yml.
//   pnpm media:gc          → DATABASE_URL
//   pnpm media:gc --test   → the *_test database
//
// Safe to re-run: every branch also proves no record references the asset.

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  if (process.argv.includes("--test")) {
    process.env.DATABASE_URL = resolveTestDatabaseUrl();
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (see .env.example).");

  try {
    const swept = await sweepMediaAssets(getDb());
    let blobs = 0;
    for (const asset of swept) {
      blobs += await deleteBlobPrefix(asset.blobPrefix);
    }
    const staging = swept.filter((asset) => asset.state === "staging").length;
    console.log(
      `Deleted ${swept.length} media asset(s) — ${staging} never saved, ${swept.length - staging} unreferenced — and ${blobs} blob(s).`,
    );
  } finally {
    await closeDb();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
