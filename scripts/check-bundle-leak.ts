import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";
import { scanForLeaks } from "./lib/leak-scan";

// Server-only variables whose values must never reach anything a browser can download (SEC-01).
const SERVER_SECRET_NAMES = [
  "DATABASE_URL",
  "MIGRATION_DATABASE_URL",
  "TEST_DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "CURSOR_SIGNING_SECRET",
  "BLOB_READ_WRITE_TOKEN",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "EMAIL_API_KEY",
  "FIRECRAWL_API_KEY",
] as const;

const projectDir = process.cwd();
loadEnvConfig(projectDir);

const buildDir = join(projectDir, ".next");
if (!existsSync(buildDir)) {
  console.error("No .next build output found. Run `pnpm build` first.");
  process.exit(2);
}

const findings = scanForLeaks({
  baseDir: projectDir,
  secrets: Object.fromEntries(
    SERVER_SECRET_NAMES.map((name) => [name, process.env[name]]),
  ),
  roots: [
    // Client JavaScript and CSS.
    { dir: join(buildDir, "static"), extensions: [".js", ".css", ".map"] },
    // Prerendered HTML and RSC payloads served to browsers. Server JS is excluded.
    {
      dir: join(buildDir, "server", "app"),
      extensions: [".html", ".rsc", ".body", ".meta"],
    },
  ],
});

if (findings.length > 0) {
  console.error(`Bundle leak scan FAILED with ${findings.length} finding(s):`);
  for (const finding of findings) {
    console.error(`  ${finding.file}: ${finding.match}`);
  }
  process.exit(1);
}

const checked = SERVER_SECRET_NAMES.filter((name) => process.env[name]).length;
console.log(
  `Bundle leak scan passed: ${checked} secret value(s) and connection-string patterns checked.`,
);
