import "server-only";

import { type SQL, sql } from "drizzle-orm";
import { cacheTags } from "../../lib/cache-tags";
import type { Transaction } from "../client";

// Which cached pages a write can change (ARCHITECTURE §5, NFR-02). Collect tags inside the
// transaction before the change, so links the write removes still expire their pages; collect
// again after a change that adds links. Tags for hidden records are harmless, while a missing
// tag is a stale-content bug.

type Executor = Pick<Transaction, "execute">;
type TagKind = "startup" | "founder" | "investor" | "batch";

const idList = (ids: readonly string[]) =>
  sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );

async function slugTags(tx: Executor, query: SQL): Promise<string[]> {
  const { rows } = await tx.execute<{ kind: TagKind; slug: string }>(query);
  return rows.map(({ kind, slug }) => cacheTags[kind](slug));
}

/**
 * A startup's own pages, and every page that shows its card or name. That includes the companies
 * it acquired: their cards name the acquirer, so their pages and neighbours change too.
 */
export async function startupTags(
  tx: Executor,
  startupIds: readonly string[],
): Promise<string[]> {
  if (startupIds.length === 0) return [];
  const ids = idList(startupIds);
  const targets = sql`select id from public.startups where id in (${ids})
    union select id from public.startups where acquired_by_startup_id in (${ids})`;
  return [
    ...(await slugTags(
      tx,
      sql`
      select 'startup'::text as kind, slug from public.startups where id in (${targets})
      union select 'startup', old_slug from public.slug_redirects where entity_type = 'startup' and entity_id in (${targets})
      union select 'founder', f.slug from public.startup_founders sf join public.founders f on f.id = sf.founder_id where sf.startup_id in (${targets})
      union select 'investor', i.slug from public.investments x join public.investors i on i.id = x.investor_id where x.startup_id in (${targets})
      union select 'batch', b.slug from public.startup_batches sb join public.batches b on b.id = sb.batch_id where sb.startup_id in (${targets})`,
    )),
    cacheTags.startupsList(),
    cacheTags.news(),
    cacheTags.categories(),
    cacheTags.stats(),
  ];
}

/** A founder's pages, and the startup pages whose founder strip shows them. */
export async function founderTags(
  tx: Executor,
  founderIds: readonly string[],
): Promise<string[]> {
  if (founderIds.length === 0) return [];
  const ids = idList(founderIds);
  return [
    ...(await slugTags(
      tx,
      sql`
      select 'founder'::text as kind, slug from public.founders where id in (${ids})
      union select 'founder', old_slug from public.slug_redirects where entity_type = 'founder' and entity_id in (${ids})
      union select 'startup', s.slug from public.startup_founders sf join public.startups s on s.id = sf.startup_id where sf.founder_id in (${ids})`,
    )),
    cacheTags.stats(),
  ];
}

/** An investor's pages, the startups it backs, the batches it runs, and the news feed. */
export async function investorTags(
  tx: Executor,
  investorIds: readonly string[],
): Promise<string[]> {
  if (investorIds.length === 0) return [];
  const ids = idList(investorIds);
  return [
    ...(await slugTags(
      tx,
      sql`
      select 'investor'::text as kind, slug from public.investors where id in (${ids})
      union select 'investor', old_slug from public.slug_redirects where entity_type = 'investor' and entity_id in (${ids})
      union select 'startup', s.slug from public.investments x join public.startups s on s.id = x.startup_id where x.investor_id in (${ids})
      union select 'batch', slug from public.batches where investor_id in (${ids})`,
    )),
    cacheTags.news(),
    cacheTags.stats(),
  ];
}

/** A batch's pages and the startup pages that show its badge. */
export async function batchTags(
  tx: Executor,
  batchIds: readonly string[],
): Promise<string[]> {
  if (batchIds.length === 0) return [];
  const ids = idList(batchIds);
  return [
    ...(await slugTags(
      tx,
      sql`
      select 'batch'::text as kind, slug from public.batches where id in (${ids})
      union select 'batch', old_slug from public.slug_redirects where entity_type = 'batch' and entity_id in (${ids})
      union select 'startup', s.slug from public.startup_batches sb join public.startups s on s.id = sb.startup_id where sb.batch_id in (${ids})`,
    )),
    cacheTags.stats(),
  ];
}

/** A round changes its startup's card (totals, latest round) everywhere, and its investors' pages. */
export async function roundTags(
  tx: Executor,
  roundIds: readonly string[],
): Promise<string[]> {
  if (roundIds.length === 0) return [];
  const ids = idList(roundIds);
  const { rows } = await tx.execute<{ startup_id: string }>(
    sql`select distinct startup_id from public.funding_rounds where id in (${ids})`,
  );
  return [
    ...(await startupTags(
      tx,
      rows.map((row) => row.startup_id),
    )),
    ...(await slugTags(
      tx,
      sql`select distinct 'investor'::text as kind, i.slug from public.investments x join public.investors i on i.id = x.investor_id where x.round_id in (${ids})`,
    )),
  ];
}
