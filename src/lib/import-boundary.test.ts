import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// SEC-01: code that can reach the browser never imports src/server, not even for types. The
// `server-only` guard catches a runtime import at build time; this also catches `import type`,
// which compiles away and would otherwise let server shapes leak into client code unnoticed.

const SRC = new URL("..", import.meta.url).pathname;
const CLIENT_SAFE_DIRS = ["components", "hooks", "lib", "types"];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
      ? [path]
      : [];
  });
}

const SERVER_IMPORT =
  /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["'](?:@\/|(?:\.\.\/)+)server["'/]/;

describe("client-safe directories", () => {
  const files = CLIENT_SAFE_DIRS.flatMap((dir) => sourceFiles(join(SRC, dir)));

  it("finds the files it is meant to check", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(
    files.map((file) => [relative(SRC, file), file]),
  )("%s does not import src/server", (_name, file) => {
    expect(readFileSync(file as string, "utf8")).not.toMatch(SERVER_IMPORT);
  });

  it("recognises the import forms it forbids", () => {
    for (const line of [
      'import type { Image } from "@/server/dto/image";',
      'import { x } from "../server/db";',
      'import { x } from "../../server/db";',
      'const m = await import("@/server/cache/stats");',
    ]) {
      expect(line).toMatch(SERVER_IMPORT);
    }
    expect('import { x } from "@/lib/server-time";').not.toMatch(SERVER_IMPORT);
    expect('import { x } from "./server-time";').not.toMatch(SERVER_IMPORT);
  });
});
