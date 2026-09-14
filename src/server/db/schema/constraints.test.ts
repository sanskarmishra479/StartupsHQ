import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeDb, type Database, getDb } from "../client";
import {
  auditLog,
  founders,
  fundingRounds,
  industries,
  investments,
  investors,
  startupFounders,
  startupIndustries,
  startups,
} from "./index";

// Phase 1 exit criteria (TODO.md): Postgres itself — not application code — rejects invalid
// data, and the app role cannot run DDL or rewrite the audit log (DM-02..DM-12, SEC-10, SEC-11).
// Every test runs inside a transaction that is rolled back, so the test database stays empty.

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type PgError = { code?: string; constraint?: string };

const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";
const INSUFFICIENT_PRIVILEGE = "42501";

const ROLLBACK = new Error("rollback");

/** Runs fn in a transaction that is always rolled back. */
async function inRollback(fn: (tx: Tx) => Promise<void>): Promise<void> {
  await getDb()
    .transaction(async (tx) => {
      await fn(tx);
      throw ROLLBACK;
    })
    .catch((error: unknown) => {
      if (error !== ROLLBACK) throw error;
    });
}

/** Runs fn in a transaction and returns the Postgres error it must raise. */
async function rejection(fn: (tx: Tx) => Promise<unknown>): Promise<PgError> {
  try {
    await getDb().transaction(async (tx) => {
      await fn(tx);
    });
  } catch (error) {
    return ((error as { cause?: unknown }).cause ?? error) as PgError;
  }
  throw new Error("Expected the database to reject this write.");
}

const slug = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8)}`;

async function insertStartup(
  tx: Tx,
  values: Partial<typeof startups.$inferInsert> = {},
) {
  const [row] = await tx
    .insert(startups)
    .values({ slug: slug("startup"), name: "Test Startup", ...values })
    .returning({ id: startups.id });
  if (!row) throw new Error("startup insert returned no row");
  return row.id;
}

const disclosedUsdRound = (startupId: string) =>
  ({
    startupId,
    roundType: "seed",
    announcedOn: "2026-03-01",
    amountOriginal: "2000000.00",
    amountUsd: 2_000_000,
    fxRate: "1",
    fxRateDate: "2026-03-01",
    fxSource: "ecb",
    sourceUrl: "https://example.com/seed",
  }) satisfies typeof fundingRounds.$inferInsert;

afterAll(async () => {
  await closeDb();
});

describe("funding_rounds constraints", () => {
  it("accepts a disclosed USD round and an undisclosed round", async () => {
    await inRollback(async (tx) => {
      const startupId = await insertStartup(tx);
      await tx.insert(fundingRounds).values(disclosedUsdRound(startupId));
      await tx.insert(fundingRounds).values({
        startupId,
        roundType: "series_a",
        announcedOn: "2026-06-01",
        isUndisclosed: true,
        sourceUrl: "https://example.com/a",
      });
    });
  });

  it("rejects an undisclosed round that carries an amount", async () => {
    const error = await rejection(async (tx) => {
      const startupId = await insertStartup(tx);
      await tx
        .insert(fundingRounds)
        .values({ ...disclosedUsdRound(startupId), isUndisclosed: true });
    });
    expect(error).toMatchObject({
      code: CHECK_VIOLATION,
      constraint: "funding_rounds_undisclosed_has_no_amount",
    });
  });

  it("rejects a disclosed round without an amount", async () => {
    const error = await rejection(async (tx) => {
      const startupId = await insertStartup(tx);
      await tx.insert(fundingRounds).values({
        startupId,
        roundType: "seed",
        announcedOn: "2026-03-01",
        sourceUrl: "https://example.com/seed",
      });
    });
    expect(error.constraint).toBe("funding_rounds_undisclosed_has_no_amount");
  });

  it("rejects a disclosed non-USD round without FX details", async () => {
    const error = await rejection(async (tx) => {
      const startupId = await insertStartup(tx);
      await tx.insert(fundingRounds).values({
        ...disclosedUsdRound(startupId),
        currency: "EUR",
        fxRate: null,
        fxRateDate: null,
        fxSource: null,
      });
    });
    expect(error).toMatchObject({
      code: CHECK_VIOLATION,
      constraint: "funding_rounds_non_usd_has_fx",
    });
  });

  it("rejects an orphan round", async () => {
    const error = await rejection((tx) =>
      tx.insert(fundingRounds).values(disclosedUsdRound(randomUUID())),
    );
    expect(error.code).toBe(FOREIGN_KEY_VIOLATION);
  });

  it("derives round_class from round_type", async () => {
    await inRollback(async (tx) => {
      const startupId = await insertStartup(tx);
      const expected = {
        seed: "equity",
        bridge: "convertible",
        convertible: "convertible",
        debt: "debt",
        grant: "non_dilutive",
        secondary: "secondary",
      } as const;

      for (const [roundType, roundClass] of Object.entries(expected)) {
        const [row] = await tx
          .insert(fundingRounds)
          .values({
            ...disclosedUsdRound(startupId),
            roundType: roundType as keyof typeof expected,
          })
          .returning({ roundClass: fundingRounds.roundClass });
        expect(row?.roundClass).toBe(roundClass);
      }
    });
  });
});

describe("graph constraints", () => {
  it("rejects a second primary industry for the same startup", async () => {
    const error = await rejection(async (tx) => {
      const startupId = await insertStartup(tx);
      const rows = await tx
        .insert(industries)
        .values([
          { slug: slug("fintech"), name: "Fintech" },
          { slug: slug("ai"), name: "AI" },
        ])
        .returning({ id: industries.id });
      await tx.insert(startupIndustries).values(
        rows.map((row) => ({
          startupId,
          industryId: row.id,
          isPrimary: true,
        })),
      );
    });
    expect(error).toMatchObject({
      code: UNIQUE_VIOLATION,
      constraint: "startup_industries_one_primary_idx",
    });
  });

  it("rejects a duplicate backer with no round (NULLS NOT DISTINCT)", async () => {
    const error = await rejection(async (tx) => {
      const startupId = await insertStartup(tx);
      const [investor] = await tx
        .insert(investors)
        .values({ slug: slug("fund"), name: "Fund", investorType: "vc" })
        .returning({ id: investors.id });
      if (!investor) throw new Error("investor insert returned no row");
      const link = { startupId, investorId: investor.id, roundId: null };
      await tx.insert(investments).values(link);
      await tx.insert(investments).values(link);
    });
    expect(error).toMatchObject({
      code: UNIQUE_VIOLATION,
      constraint: "investments_startup_investor_round_key",
    });
  });

  it("allows a founder to return to a startup, but not to duplicate a stint", async () => {
    await inRollback(async (tx) => {
      const startupId = await insertStartup(tx);
      const [founder] = await tx
        .insert(founders)
        .values({ slug: slug("jane"), fullName: "Jane Doe" })
        .returning({ id: founders.id });
      if (!founder) throw new Error("founder insert returned no row");
      const stint = {
        startupId,
        founderId: founder.id,
        role: "ceo" as const,
        isCurrent: false,
      };
      await tx.insert(startupFounders).values([
        { ...stint, joinedYear: 2019, leftYear: 2021 },
        { ...stint, joinedYear: 2024, isCurrent: true },
      ]);

      const error = await tx
        .insert(startupFounders)
        .values({ ...stint, joinedYear: 2019 })
        .then(
          () => ({}) as PgError,
          (e: unknown) => ((e as { cause?: unknown }).cause ?? e) as PgError,
        );
      expect(error).toMatchObject({
        code: UNIQUE_VIOLATION,
        constraint: "startup_founders_stint_key",
      });
    });
  });
});

describe("startups constraints", () => {
  it.each([
    ["an invalid slug", { slug: "Not A Slug" }, "startups_slug_format"],
    [
      "a javascript: website URL",
      { websiteUrl: "javascript:alert(1)" },
      "startups_website_url_https",
    ],
    [
      "archived status without archived_at",
      { status: "archived" as const },
      "startups_archived_at_matches_status",
    ],
    [
      "published status without first_published_at",
      { status: "published" as const },
      "startups_published_has_first_published_at",
    ],
    [
      "an acquisition date without an acquirer",
      { acquiredOn: "2026-01-01" },
      "startups_acquisition_has_acquirer",
    ],
  ])("rejects %s", async (_label, values, constraint) => {
    const error = await rejection((tx) => insertStartup(tx, values));
    expect(error).toMatchObject({ code: CHECK_VIOLATION, constraint });
  });

  it("builds an accent-insensitive search vector", async () => {
    await inRollback(async (tx) => {
      const id = await insertStartup(tx, {
        name: "Zürich Labs",
        tagline: "Fintech für Kraków",
      });
      const [row] = await tx
        .select({
          matches: sql<boolean>`${startups.searchVector} @@ to_tsquery('simple', 'zurich & krakow')`,
        })
        .from(startups)
        .where(eq(startups.id, id));
      expect(row?.matches).toBe(true);
    });
  });
});

describe("database role privileges", () => {
  it("denies DDL to the app role", async () => {
    const error = await rejection(async (tx) => {
      await tx.execute(sql`set local role startupshq_app`);
      await tx.execute(sql`create table public.should_not_exist (id int)`);
    });
    expect(error.code).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it("lets the app role insert into audit_log but never rewrite it", async () => {
    await inRollback(async (tx) => {
      await tx.execute(sql`set local role startupshq_app`);
      await tx
        .insert(auditLog)
        .values({ entityType: "startup", action: "create" });
    });

    const error = await rejection(async (tx) => {
      await tx.execute(sql`set local role startupshq_app`);
      await tx.execute(sql`update public.audit_log set action = 'erase'`);
    });
    expect(error.code).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it("confines the retention role to audit_log", async () => {
    await inRollback(async (tx) => {
      await tx.execute(sql`set local role startupshq_retention`);
      await tx.execute(
        sql`delete from public.audit_log where created_at < now() - interval '12 months'`,
      );
    });

    const error = await rejection(async (tx) => {
      await tx.execute(sql`set local role startupshq_retention`);
      await tx.execute(sql`select 1 from public.startups limit 1`);
    });
    expect(error.code).toBe(INSUFFICIENT_PRIVILEGE);
  });
});
