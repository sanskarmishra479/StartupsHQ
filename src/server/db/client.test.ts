import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "./client";

describe("getDb", () => {
  afterAll(async () => {
    await closeDb();
  });

  it("connects to the dedicated test database", async () => {
    const result = await getDb().execute<{ db: string; ok: number }>(
      sql`select current_database() as db, 1 as ok`,
    );

    expect(result.rows[0]).toEqual({
      db: expect.stringMatching(/_test$/),
      ok: 1,
    });
  });

  it("refuses to create a connection without DATABASE_URL", async () => {
    await closeDb();
    const saved = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;

    try {
      expect(() => getDb()).toThrow("DATABASE_URL is not set.");
    } finally {
      process.env.DATABASE_URL = saved;
    }
  });
});
