import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import { UnprocessableError } from "../../lib/errors";
import type { Transaction } from "../client";
import { mediaAssets } from "../schema";

// FR-408: an entity may reference a media asset that is still in staging, or one it already
// references. Saving attaches the staging assets, so the media GC keeps them.

type Purpose = (typeof mediaAssets.purpose.enumValues)[number];

export type MediaRef = Readonly<{
  assetId: string | null | undefined;
  purpose: Purpose;
}>;

export async function attachMedia(
  tx: Transaction,
  refs: readonly MediaRef[],
  alreadyReferenced: ReadonlySet<string>,
): Promise<void> {
  const wanted = refs.filter(
    (ref): ref is MediaRef & { assetId: string } =>
      typeof ref.assetId === "string" && !alreadyReferenced.has(ref.assetId),
  );
  if (wanted.length === 0) return;
  const ids = wanted.map((ref) => ref.assetId);

  const rows = await tx
    .select({
      id: mediaAssets.id,
      purpose: mediaAssets.purpose,
      state: mediaAssets.state,
    })
    .from(mediaAssets)
    .where(inArray(mediaAssets.id, ids))
    .for("update");
  const byId = new Map(rows.map((row) => [row.id, row]));

  for (const ref of wanted) {
    const asset = byId.get(ref.assetId);
    if (!asset) throw new UnprocessableError("That image does not exist.");
    if (asset.purpose !== ref.purpose) {
      throw new UnprocessableError(
        `That image was uploaded as a ${asset.purpose}, not a ${ref.purpose}.`,
      );
    }
    if (asset.state !== "staging") {
      throw new UnprocessableError(
        "That image is already used by another record.",
      );
    }
  }

  await tx
    .update(mediaAssets)
    .set({ state: "attached", attachedAt: sql`now()` })
    .where(and(inArray(mediaAssets.id, ids), eq(mediaAssets.state, "staging")));
}
