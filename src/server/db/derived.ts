import "server-only";

import { type SQL, sql } from "drizzle-orm";
import type { Database } from "./client";

type Executor = Pick<Database, "execute">;

/** Each startup's derived columns as one comparable string. */
async function derivedSnapshot(db: Executor): Promise<Map<string, string>> {
  const { rows } = await db.execute<{ id: string; derived: string }>(sql`
    select id,
           total_raised_usd::text || '|' || total_debt_usd::text || '|' ||
             coalesce(latest_round_id::text, '-') as derived
    from public.startups`);
  return new Map(rows.map((row) => [row.id, row.derived]));
}

/**
 * The repair path (ADR-009): recomputes every startup in one transaction and reports how many
 * were wrong. Safe at any time, because the columns are a pure function of published rounds.
 */
export async function repairStartupDerived(
  db: Pick<Database, "transaction">,
): Promise<{ checked: number; repaired: number }> {
  return db.transaction(async (tx) => {
    const before = await derivedSnapshot(tx);
    await recomputeStartupDerived(tx);
    const after = await derivedSnapshot(tx);
    let repaired = 0;
    for (const [id, value] of after) {
      if (before.get(id) !== value) repaired += 1;
    }
    return { checked: after.size, repaired };
  });
}

/**
 * Recomputes the derived startup columns (FR-404, ADR-009, ADR-018):
 * - total_raised_usd: published equity + convertible rounds
 * - total_debt_usd:   published debt rounds
 * - latest_round_id:  latest published equity or convertible round
 *
 * Only published rounds count. Totals appear on public cards, so including a draft or archived
 * round would leak its amount through the total.
 *
 * Call inside the same transaction as the round write. Pass startup ids to limit the update;
 * omit them to recompute every startup (the repair path).
 */
export async function recomputeStartupDerived(
  db: Executor,
  startupIds?: readonly string[],
): Promise<void> {
  if (startupIds?.length === 0) return;

  const scope: SQL = startupIds
    ? sql`where s.id in (${sql.join(
        startupIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`
    : sql``;

  await db.execute(sql`
    update public.startups as target
    set
      total_raised_usd = derived.raised,
      total_debt_usd = derived.debt,
      latest_round_id = derived.latest_round_id
    from (
      select
        s.id,
        coalesce((
          select sum(r.amount_usd) from public.funding_rounds r
          where r.startup_id = s.id and r.status = 'published'
            and r.round_class in ('equity', 'convertible')
        ), 0) as raised,
        coalesce((
          select sum(r.amount_usd) from public.funding_rounds r
          where r.startup_id = s.id and r.status = 'published'
            and r.round_class = 'debt'
        ), 0) as debt,
        (
          select r.id from public.funding_rounds r
          where r.startup_id = s.id and r.status = 'published'
            and r.round_class in ('equity', 'convertible')
          order by r.announced_on desc, r.id desc
          limit 1
        ) as latest_round_id
      from public.startups s
      ${scope}
    ) as derived
    where target.id = derived.id
  `);
}
