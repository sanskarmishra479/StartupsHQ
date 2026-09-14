import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";

export type ScanRoot = {
  /** Directory to scan recursively. A missing directory is skipped. */
  dir: string;
  /** File extensions to read, e.g. [".js", ".html"]. */
  extensions: readonly string[];
};

export type Finding = {
  file: string;
  /** Names what matched. Never contains the secret value itself. */
  match: string;
};

const PATTERNS: readonly { name: string; regex: RegExp }[] = [
  {
    name: "Postgres connection string",
    regex: /postgres(?:ql)?:\/\/[^\s"'`]+/i,
  },
];

function* walk(dir: string): Generator<string> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

/**
 * Scans build output for server secret values and secret-shaped patterns (SEC-01).
 * Findings report the variable name and file, never the value.
 */
export function scanForLeaks(options: {
  roots: readonly ScanRoot[];
  secrets: Readonly<Record<string, string | undefined>>;
  baseDir: string;
  /** Values shorter than this are ignored to avoid false positives. */
  minSecretLength?: number;
}): Finding[] {
  const minLength = options.minSecretLength ?? 8;
  const secrets = Object.entries(options.secrets).filter(
    (entry): entry is [string, string] =>
      typeof entry[1] === "string" && entry[1].length >= minLength,
  );

  const findings: Finding[] = [];
  for (const root of options.roots) {
    for (const file of walk(root.dir)) {
      if (!root.extensions.includes(extname(file))) continue;

      const content = readFileSync(file, "utf8");
      const rel = relative(options.baseDir, file);

      for (const [name, value] of secrets) {
        if (content.includes(value)) {
          findings.push({ file: rel, match: `value of ${name}` });
        }
      }
      for (const { name, regex } of PATTERNS) {
        if (regex.test(content)) findings.push({ file: rel, match: name });
      }
    }
  }
  return findings;
}
