import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type ScanRoot, scanForLeaks } from "./leak-scan";

const SECRET = "s3cret-value-that-must-never-leak";

let baseDir = "";

function buildOutput(files: Record<string, string>): string {
  baseDir = mkdtempSync(join(tmpdir(), "leak-scan-"));
  for (const [path, content] of Object.entries(files)) {
    const full = join(baseDir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return baseDir;
}

function roots(base: string): ScanRoot[] {
  return [
    { dir: join(base, "static"), extensions: [".js", ".css"] },
    { dir: join(base, "server", "app"), extensions: [".html", ".rsc"] },
  ];
}

afterEach(() => {
  if (baseDir) rmSync(baseDir, { recursive: true, force: true });
  baseDir = "";
});

describe("scanForLeaks", () => {
  it("passes clean build output", () => {
    const base = buildOutput({
      "static/chunks/app.js": "console.log('hello')",
      "server/app/index.html": "<h1>startupsHQ</h1>",
    });

    expect(
      scanForLeaks({
        roots: roots(base),
        secrets: { DATABASE_URL: SECRET },
        baseDir: base,
      }),
    ).toEqual([]);
  });

  it("flags a secret value in a client chunk without reporting the value", () => {
    const base = buildOutput({
      "static/chunks/app.js": `const key = "${SECRET}";`,
    });

    const findings = scanForLeaks({
      roots: roots(base),
      secrets: { BETTER_AUTH_SECRET: SECRET },
      baseDir: base,
    });

    expect(findings).toEqual([
      {
        file: join("static", "chunks", "app.js"),
        match: "value of BETTER_AUTH_SECRET",
      },
    ]);
    expect(JSON.stringify(findings)).not.toContain(SECRET);
  });

  it("flags a secret value in a prerendered page", () => {
    const base = buildOutput({ "server/app/index.rsc": `payload ${SECRET}` });

    expect(
      scanForLeaks({
        roots: roots(base),
        secrets: { CURSOR_SIGNING_SECRET: SECRET },
        baseDir: base,
      }),
    ).toHaveLength(1);
  });

  it("flags a Postgres connection string even when no secret is configured", () => {
    const base = buildOutput({
      "static/chunks/db.js": 'fetch("postgres://user:pw@db.example.com/prod")',
    });

    expect(
      scanForLeaks({ roots: roots(base), secrets: {}, baseDir: base }),
    ).toEqual([
      {
        file: join("static", "chunks", "db.js"),
        match: "Postgres connection string",
      },
    ]);
  });

  it("only reads the extensions allowed for each root", () => {
    const base = buildOutput({
      "server/app/route.js": `const url = "postgres://x/y"; ${SECRET}`,
    });

    expect(
      scanForLeaks({
        roots: roots(base),
        secrets: { DATABASE_URL: SECRET },
        baseDir: base,
      }),
    ).toEqual([]);
  });

  it("ignores empty and short secret values", () => {
    const base = buildOutput({ "static/chunks/app.js": "const a = 'abc';" });

    expect(
      scanForLeaks({
        roots: roots(base),
        secrets: { EMPTY: "", SHORT: "abc", UNSET: undefined },
        baseDir: base,
      }),
    ).toEqual([]);
  });

  it("skips roots that do not exist", () => {
    const base = buildOutput({});

    expect(
      scanForLeaks({
        roots: roots(base),
        secrets: { X: SECRET },
        baseDir: base,
      }),
    ).toEqual([]);
  });
});
