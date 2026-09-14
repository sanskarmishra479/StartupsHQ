import { is } from "drizzle-orm";
import { getTableConfig, PgDialect, PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as schema from "./index";

const dialect = new PgDialect();

// The schema module also exports enums and relations; keep only tables.
const exported: unknown[] = Object.values(schema);
const tables = exported.filter((value): value is PgTable => is(value, PgTable));

const checks = tables.flatMap((table) => {
  const config = getTableConfig(table);
  return config.checks.map(
    (constraint) =>
      [
        `${config.name}.${constraint.name}`,
        dialect.sqlToQuery(constraint.value).sql,
      ] as const,
  );
});

describe("schema", () => {
  it("exports every table", () => {
    expect(tables).toHaveLength(23);
  });

  // drizzle-kit truncates a CHECK expression at the first ';' when it generates a migration.
  // That either breaks the migration or, worse, silently installs a weaker constraint.
  it.each(checks)("%s contains no semicolon", (_name, sql) => {
    expect(sql).not.toContain(";");
  });
});
