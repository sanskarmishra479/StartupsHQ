import { loadEnvConfig } from "@next/env";
import { defineConfig } from "drizzle-kit";

// Load .env.local exactly as Next.js does.
loadEnvConfig(process.cwd());

// Migrations use the DDL-capable role. It exists only locally and in the
// protected GitHub Actions environment — never in Vercel (ADR-015).
const url = process.env.MIGRATION_DATABASE_URL;
if (!url) {
  throw new Error("MIGRATION_DATABASE_URL is not set (see .env.example).");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema/index.ts",
  out: "./drizzle",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
