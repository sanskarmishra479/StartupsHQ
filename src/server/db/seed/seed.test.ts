import { type SQL, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "../client";
import { seed } from "./index";

// Phase 2 exit criteria (TODO.md) and the fixture catalog (docs/TEST_PLAN.md §4).

async function rows<T extends Record<string, unknown>>(
  query: SQL,
): Promise<T[]> {
  return (await getDb().execute<T>(query)).rows as T[];
}

async function count(query: SQL): Promise<number> {
  const [row] = await rows<{ n: number }>(query);
  return Number(row?.n ?? 0);
}

/** Everything that must be identical after re-seeding; ids and timestamps are excluded. */
async function snapshot() {
  return {
    startups: await rows(sql`
      select s.slug, s.status, s.total_raised_usd::text as raised, s.total_debt_usd::text as debt,
             r.round_type as latest_round, a.slug as acquired_by
      from startups s
      left join funding_rounds r on r.id = s.latest_round_id
      left join startups a on a.id = s.acquired_by_startup_id
      order by s.slug`),
    rounds: await rows(sql`
      select s.slug, r.round_type, r.announced_on::text, r.amount_usd::text, r.status, r.round_class
      from funding_rounds r join startups s on s.id = r.startup_id
      order by 1, 3, 2`),
    investments: await rows(sql`
      select s.slug as startup, i.slug as investor, r.announced_on::text as round_date, x.is_lead
      from investments x
      join startups s on s.id = x.startup_id
      join investors i on i.id = x.investor_id
      left join funding_rounds r on r.id = x.round_id
      order by 1, 2, 3 nulls first`),
    stints: await rows(sql`
      select s.slug as startup, f.slug as founder, sf.role, sf.joined_year
      from startup_founders sf
      join startups s on s.id = sf.startup_id
      join founders f on f.id = sf.founder_id
      order by 1, 2, 4`),
    counts: {
      founders: await count(sql`select count(*) as n from founders`),
      investors: await count(sql`select count(*) as n from investors`),
      batches: await count(sql`select count(*) as n from batches`),
      startupBatches: await count(
        sql`select count(*) as n from startup_batches`,
      ),
      startupIndustries: await count(
        sql`select count(*) as n from startup_industries`,
      ),
      media: await count(sql`select count(*) as n from media_assets`),
      audit: await count(sql`select count(*) as n from audit_log`),
      taxonomy: await count(sql`select count(*) as n from taxonomy_pages`),
      fx: await count(sql`select count(*) as n from fx_rates`),
    },
  };
}

beforeAll(async () => {
  await seed(getDb());
});

afterAll(async () => {
  await closeDb();
});

describe("seed", () => {
  it("is idempotent", async () => {
    const first = await snapshot();
    await seed(getDb());
    expect(await snapshot()).toEqual(first);
  });

  it("counts only published equity and convertible rounds toward totals", async () => {
    const [solstice] = await rows(sql`
      select s.total_raised_usd::text as raised, s.total_debt_usd::text as debt,
             r.round_type as latest_round
      from startups s left join funding_rounds r on r.id = s.latest_round_id
      where s.slug = 'solstice-grid'`);

    // seed 3M + series A 12M; the grant, secondary, draft series B and archived bridge do not count.
    expect(solstice).toEqual({
      raised: "15000000",
      debt: "10000000",
      latest_round: "series_a",
    });
  });

  it("keeps every stored total consistent with its published rounds", async () => {
    const mismatched = await rows(sql`
      select s.slug from startups s
      where s.total_raised_usd <> coalesce((
              select sum(r.amount_usd) from funding_rounds r
              where r.startup_id = s.id and r.status = 'published'
                and r.round_class in ('equity', 'convertible')), 0)
         or s.total_debt_usd <> coalesce((
              select sum(r.amount_usd) from funding_rounds r
              where r.startup_id = s.id and r.status = 'published'
                and r.round_class = 'debt'), 0)`);
    expect(mismatched).toEqual([]);
  });

  it("stores non-USD amounts converted at the recorded rate", async () => {
    const wrong = await rows(sql`
      select r.source_url from funding_rounds r
      where r.currency <> 'USD' and not r.is_undisclosed
        and r.amount_usd <> round(r.amount_original * r.fx_rate)`);
    expect(wrong).toEqual([]);
  });
});

describe("fixture catalog (docs/TEST_PLAN.md §4)", () => {
  const atLeast = (min: number) => (n: number) => n >= min;
  const exactly = (expected: number) => (n: number) => n === expected;

  const fixtures: [label: string, query: SQL, holds: (n: number) => boolean][] =
    [
      [
        "an undisclosed round",
        sql`select count(*) as n from funding_rounds where is_undisclosed`,
        atLeast(1),
      ],
      [
        "an EUR round converted at an ECB rate",
        sql`select count(*) as n from funding_rounds where currency = 'EUR' and fx_source = 'ecb'`,
        atLeast(1),
      ],
      [
        "a round with a manually entered FX rate",
        sql`select count(*) as n from funding_rounds where fx_source = 'manual'`,
        atLeast(1),
      ],
      [
        "one startup with debt, grant and secondary rounds",
        sql`select count(*) as n from (
            select startup_id from funding_rounds group by startup_id
            having bool_or(round_class = 'debt') and bool_or(round_class = 'non_dilutive')
               and bool_or(round_class = 'secondary')) x`,
        atLeast(1),
      ],
      [
        "draft and archived rounds",
        sql`select count(distinct status) as n from funding_rounds where status in ('draft', 'archived')`,
        exactly(2),
      ],
      [
        "an acquisition by a startup in the database",
        sql`select count(*) as n from startups where acquired_by_startup_id is not null and acquired_on is not null`,
        atLeast(1),
      ],
      [
        "an acquisition by name only",
        sql`select count(*) as n from startups where acquired_by_name is not null and acquired_by_startup_id is null`,
        atLeast(1),
      ],
      [
        "a startup in two batches",
        sql`select count(*) as n from (select startup_id from startup_batches group by startup_id having count(*) >= 2) x`,
        atLeast(1),
      ],
      [
        "a founder across three startups who returned to one",
        sql`select count(*) as n from (
            select founder_id from startup_founders group by founder_id
            having count(distinct startup_id) >= 3 and count(*) > count(distinct startup_id)) x`,
        atLeast(1),
      ],
      [
        "an investor in five rounds, leading two",
        sql`select count(*) as n from (
            select investor_id from investments where round_id is not null group by investor_id
            having count(distinct round_id) = 5 and count(*) filter (where is_lead) = 2) x`,
        atLeast(1),
      ],
      [
        "a backer with no round",
        sql`select count(*) as n from investments where round_id is null`,
        atLeast(1),
      ],
      [
        "a published startup with no founders",
        sql`select count(*) as n from startups s where s.status = 'published' and not exists (select 1 from startup_founders sf where sf.startup_id = s.id)`,
        atLeast(1),
      ],
      [
        "a published startup with no rounds",
        sql`select count(*) as n from startups s where s.status = 'published' and not exists (select 1 from funding_rounds r where r.startup_id = s.id)`,
        atLeast(1),
      ],
      [
        "a draft and an archived startup",
        sql`select count(distinct status) as n from startups where status in ('draft', 'archived')`,
        exactly(2),
      ],
      [
        "a draft and an archived founder",
        sql`select count(distinct status) as n from founders where status in ('draft', 'archived')`,
        exactly(2),
      ],
      [
        "a draft and an archived investor",
        sql`select count(distinct status) as n from investors where status in ('draft', 'archived')`,
        exactly(2),
      ],
      [
        "a draft and an archived batch",
        sql`select count(distinct status) as n from batches where status in ('draft', 'archived')`,
        exactly(2),
      ],
      [
        "an archived startup that was previously published",
        sql`select count(*) as n from startups where status = 'archived' and first_published_at is not null`,
        atLeast(1),
      ],
      [
        "a never-published draft startup",
        sql`select count(*) as n from startups where status = 'draft' and first_published_at is null`,
        atLeast(1),
      ],
      [
        "a slug redirect",
        sql`select count(*) as n from slug_redirects`,
        atLeast(1),
      ],
      [
        "a facet value with no copy and at least 5 published startups",
        sql`select count(*) as n from startups s
          where s.status = 'published' and s.work_type = 'remote'
            and not exists (select 1 from taxonomy_pages t where t.kind = 'work_type')`,
        atLeast(5),
      ],
      [
        "a thin facet with exactly 3 published startups",
        sql`select count(*) as n from startup_industries si
          join industries i on i.id = si.industry_id join startups s on s.id = si.startup_id
          where i.slug = 'robotics' and s.status = 'published'`,
        exactly(3),
      ],
      [
        "an industry with no published startups",
        sql`select count(*) as n from startup_industries si
          join industries i on i.id = si.industry_id join startups s on s.id = si.startup_id
          where i.slug = 'quantum' and s.status = 'published'`,
        exactly(0),
      ],
      [
        "a staging media asset older than 24 hours",
        sql`select count(*) as n from media_assets where state = 'staging' and created_at < now() - interval '24 hours'`,
        atLeast(1),
      ],
      [
        "a fresh staging media asset",
        sql`select count(*) as n from media_assets where state = 'staging' and created_at > now() - interval '24 hours'`,
        atLeast(1),
      ],
      [
        "an unreferenced attached asset older than 7 days",
        sql`select count(*) as n from media_assets m
          where m.state = 'attached' and m.attached_at < now() - interval '7 days'
            and not exists (select 1 from startups s where m.id in (s.logo_asset_id, s.cover_asset_id, s.og_asset_id))
            and not exists (select 1 from founders f where m.id in (f.photo_asset_id, f.og_asset_id))
            and not exists (select 1 from investors i where m.id in (i.logo_asset_id, i.og_asset_id))
            and not exists (select 1 from batches b where m.id in (b.logo_asset_id, b.og_asset_id))`,
        atLeast(1),
      ],
      [
        "an audit row older than 90 days that still has an IP",
        sql`select count(*) as n from audit_log where created_at < now() - interval '90 days' and ip is not null`,
        atLeast(1),
      ],
      [
        "an audit row older than 12 months",
        sql`select count(*) as n from audit_log where created_at < now() - interval '12 months'`,
        atLeast(1),
      ],
      [
        "names with diacritics",
        sql`select count(*) as n from founders where full_name <> public.immutable_unaccent(full_name)`,
        atLeast(3),
      ],
      [
        "a name in a non-Latin script",
        sql`select count(*) as n from founders where full_name = '佐藤 花子'`,
        exactly(1),
      ],
      [
        "published startups in at least 8 countries",
        sql`select count(distinct l.country_code) as n from startups s join locations l on l.id = s.location_id where s.status = 'published'`,
        atLeast(8),
      ],
      [
        "a near-duplicate company name for CSV matching",
        sql`select count(*) as n from startups where similarity(public.immutable_unaccent(lower(name)), 'bright path health') > 0.5`,
        atLeast(1),
      ],
    ];

  it.each(fixtures)("includes %s", async (_label, query, holds) => {
    const n = await count(query);
    expect(holds(n), `observed ${n}`).toBe(true);
  });
});
