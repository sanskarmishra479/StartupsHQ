import "server-only";

import { sql } from "drizzle-orm";
import type { Database } from "./client";
import { batches, founders, investors, mediaAssets, startups } from "./schema";

// The media GC (FR-408, ARCHITECTURE §ops): staging uploads nobody saved, and attached assets no
// record references any more. Both windows are generous, because deleting an image a record still
// points at would blank it — every branch therefore also proves nothing references the asset.
// Lives at the database layer so a scheduled script can run it without a request context.

export const STAGING_MAX_AGE_HOURS = 24;
export const UNREFERENCED_MAX_AGE_DAYS = 7;

export type SweptAsset = Readonly<{ blobPrefix: string; state: string }>;

export async function sweepMediaAssets(
  db: Database,
  now: Date = new Date(),
): Promise<SweptAsset[]> {
  const stagingCutoff = new Date(
    now.getTime() - STAGING_MAX_AGE_HOURS * 60 * 60 * 1000,
  );
  const attachedCutoff = new Date(
    now.getTime() - UNREFERENCED_MAX_AGE_DAYS * 24 * 60 * 60 * 1000,
  );

  const { rows } = await db.execute<{ blob_prefix: string; state: string }>(sql`
    delete from ${mediaAssets}
    where not exists (
            select 1 from ${startups} s
             where s.logo_asset_id = ${mediaAssets.id}
                or s.cover_asset_id = ${mediaAssets.id}
                or s.og_asset_id = ${mediaAssets.id})
      and not exists (
            select 1 from ${founders} f
             where f.photo_asset_id = ${mediaAssets.id}
                or f.og_asset_id = ${mediaAssets.id})
      and not exists (
            select 1 from ${investors} i
             where i.logo_asset_id = ${mediaAssets.id}
                or i.og_asset_id = ${mediaAssets.id})
      and not exists (
            select 1 from ${batches} b
             where b.logo_asset_id = ${mediaAssets.id}
                or b.og_asset_id = ${mediaAssets.id})
      and (
            (${mediaAssets.state} = 'staging' and ${mediaAssets.createdAt} < ${stagingCutoff.toISOString()}::timestamptz)
         or (${mediaAssets.state} = 'attached' and ${mediaAssets.attachedAt} < ${attachedCutoff.toISOString()}::timestamptz)
      )
    returning ${mediaAssets.blobPrefix} as blob_prefix, ${mediaAssets.state} as state`);

  return rows.map((row) => ({ blobPrefix: row.blob_prefix, state: row.state }));
}
