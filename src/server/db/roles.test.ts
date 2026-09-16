import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveTestDatabaseUrl } from "../../../vitest.test-database";

// SEC-10: the privileges each database role holds, proven by connecting as that role rather than
// by reading the migration. The application role can write content and append to the audit log,
// and nothing more; the retention role may touch only the log; the backup role may only read.

const clients = new Map<string, Client>();

/** The test database, as one of the login users the global setup created. */
async function connectAs(role: string): Promise<Client> {
  const url = new URL(resolveTestDatabaseUrl());
  url.username = role;
  url.password = role;
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  clients.set(role, client);
  return client;
}

let app: Client;
let retention: Client;
let backup: Client;

beforeAll(async () => {
  [app, retention, backup] = await Promise.all([
    connectAs("test_app_rw"),
    connectAs("test_retention"),
    connectAs("test_backup"),
  ]);
});

afterAll(async () => {
  await Promise.all([...clients.values()].map((client) => client.end()));
});

/** Runs a statement and rolls it back, so a permitted write leaves nothing behind. */
async function attempt(
  client: Client,
  statement: string,
): Promise<string | null> {
  await client.query("begin");
  try {
    await client.query(statement);
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? "unknown";
  } finally {
    await client.query("rollback");
  }
}

const DENIED = "42501"; // insufficient_privilege

describe("the application role (startupshq_app)", () => {
  it("may read and write content", async () => {
    expect(await attempt(app, "select id from startups limit 1")).toBeNull();
    expect(
      await attempt(
        app,
        "insert into locations (slug, country, country_code) values ('role-test-city', 'Testland', 'TL')",
      ),
    ).toBeNull();
  });

  it("may append to the audit log but never change it (SEC-11)", async () => {
    expect(
      await attempt(
        app,
        "insert into audit_log (entity_type, action) values ('startup', 'create')",
      ),
    ).toBeNull();
    expect(await attempt(app, "update audit_log set action = 'tampered'")).toBe(
      DENIED,
    );
    expect(await attempt(app, "delete from audit_log")).toBe(DENIED);
    expect(await attempt(app, "truncate audit_log")).toBe(DENIED);
  });

  it("may not change the shape of the database", async () => {
    expect(await attempt(app, "create table role_test_table (id int)")).toBe(
      DENIED,
    );
    expect(await attempt(app, "drop table startups")).toBe(DENIED);
    expect(
      await attempt(app, "alter table startups add column sneaky text"),
    ).toBe(DENIED);
  });
});

describe("the retention role (startupshq_retention)", () => {
  it("may clear and delete audit rows", async () => {
    expect(
      await attempt(retention, "update audit_log set ip = null"),
    ).toBeNull();
    expect(
      await attempt(
        retention,
        "delete from audit_log where created_at < now()",
      ),
    ).toBeNull();
  });

  it("may not touch anything else", async () => {
    expect(await attempt(retention, "select id from startups limit 1")).toBe(
      DENIED,
    );
    expect(await attempt(retention, "delete from erasure_log")).toBe(DENIED);
  });
});

describe("the backup role (startupshq_backup)", () => {
  it("may read every table and write none", async () => {
    expect(await attempt(backup, "select id from startups limit 1")).toBeNull();
    expect(
      await attempt(backup, "select id from audit_log limit 1"),
    ).toBeNull();
    expect(
      await attempt(
        backup,
        "insert into locations (slug, country, country_code) values ('backup-test', 'Testland', 'TL')",
      ),
    ).toBe(DENIED);
    expect(await attempt(backup, "delete from startups")).toBe(DENIED);
  });
});
