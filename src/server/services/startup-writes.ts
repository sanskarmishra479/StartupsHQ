import "server-only";

import { eq } from "drizzle-orm";
import type { ReadContext } from "../auth/context";
import { assertAdmin, assertEditor } from "../auth/guards";
import { auditDiff, writeAudit } from "../db/audit";
import { runMutation } from "../db/mutation";
import { startups } from "../db/schema";
import { attachMedia } from "../db/writes/media";
import {
  insertBatchLink,
  insertFounderLink,
  insertInvestorLink,
  replaceIndustries,
} from "../db/writes/relations";
import { insertRound } from "../db/writes/rounds";
import { claimSlug } from "../db/writes/slugs";
import { startupTags } from "../db/writes/tags";
import { NotFoundError, UnprocessableError } from "../lib/errors";
import { isUuid, parseInput } from "../validation/shared";
import {
  type CreateStartupInput,
  createStartupSchema,
  type UpdateStartupInput,
  updateStartupSchema,
} from "../validation/startups";

// Startup writes (docs/API.md §8.1, FR-204). Each function asserts an editor before anything
// else, validates its own input, and runs as one audited transaction that expires every page the
// change can affect.

export type WriteResult = Readonly<{
  id: string;
  slug: string;
  status: "draft" | "published" | "archived";
}>;

const written = {
  id: startups.id,
  slug: startups.slug,
  status: startups.status,
};

/** Omits empty arrays from an audit diff, so a create records only the links it made. */
const nonEmpty = <T>(items: readonly T[] | undefined) =>
  items && items.length > 0 ? items : undefined;

/**
 * Creates a draft, with any industries, founders, backers, batches and rounds in the same
 * transaction: if one link or round is invalid, nothing is created. The slug comes from the name
 * unless a free one is given (FR-403).
 */
export async function create(
  ctx: ReadContext,
  input: CreateStartupInput,
): Promise<WriteResult> {
  assertEditor(ctx);
  const {
    slug: requestedSlug,
    industries,
    founders = [],
    investors = [],
    batchIds = [],
    rounds = [],
    ...fields
  } = parseInput(createStartupSchema, input);
  if (rounds.some((round) => round.manualFx)) assertAdmin(ctx);
  if (new Set(batchIds).size !== batchIds.length) {
    throw new UnprocessableError("A batch is listed twice.");
  }

  return runMutation(async (tx, tags) => {
    const slug = await claimSlug(tx, "startup", {
      name: fields.name,
      slug: requestedSlug,
    });
    await attachMedia(
      tx,
      [
        { assetId: fields.logoAssetId, purpose: "logo" },
        { assetId: fields.coverAssetId, purpose: "cover" },
      ],
      new Set(),
    );

    const [row] = await tx
      .insert(startups)
      .values({
        ...fields,
        slug,
        status: "draft",
        createdBy: ctx.actor.id,
        updatedBy: ctx.actor.id,
      })
      .returning(written);
    if (!row) throw new Error("Insert returned no row.");

    await writeAudit(tx, ctx, {
      entityType: "startup",
      entityId: row.id,
      action: "create",
      diff: auditDiff(null, {
        ...fields,
        slug,
        industries: nonEmpty(industries),
        founders: nonEmpty(founders),
        investors: nonEmpty(investors),
        batchIds: nonEmpty(batchIds),
      }),
    });

    if (industries) await replaceIndustries(tx, row.id, industries);
    for (const link of founders) await insertFounderLink(tx, row.id, link);
    for (const link of investors) await insertInvestorLink(tx, row.id, link);
    for (const batchId of batchIds) await insertBatchLink(tx, row.id, batchId);
    for (const round of rounds) await insertRound(tx, ctx, row.id, round);

    for (const tag of await startupTags(tx, [row.id])) tags.add(tag);
    return row;
  });
}

/** Partial update. A change that alters nothing writes nothing and expires nothing. */
export async function update(
  ctx: ReadContext,
  id: string,
  input: UpdateStartupInput,
): Promise<WriteResult> {
  assertEditor(ctx);
  if (typeof input === "object" && input !== null && "slug" in input) {
    throw new UnprocessableError(
      "A slug changes only through the slug action, which admins use.",
    );
  }
  if (!isUuid(id)) throw new NotFoundError();
  const changes = parseInput(updateStartupSchema, input);

  return runMutation(async (tx, tags) => {
    const [current] = await tx
      .select()
      .from(startups)
      .where(eq(startups.id, id))
      .for("update");
    if (!current) throw new NotFoundError();

    const diff = auditDiff(current, changes);
    if (Object.keys(diff).length === 0) {
      return { id, slug: current.slug, status: current.status };
    }

    await attachMedia(
      tx,
      [
        { assetId: changes.logoAssetId, purpose: "logo" },
        { assetId: changes.coverAssetId, purpose: "cover" },
      ],
      new Set(
        [current.logoAssetId, current.coverAssetId].filter(
          (assetId): assetId is string => assetId !== null,
        ),
      ),
    );

    // Before the change, so a removed acquirer still expires its page; after, for a new one.
    for (const tag of await startupTags(tx, [id])) tags.add(tag);
    const [row] = await tx
      .update(startups)
      .set({ ...changes, updatedBy: ctx.actor.id })
      .where(eq(startups.id, id))
      .returning(written);
    if (!row) throw new NotFoundError();

    await writeAudit(tx, ctx, {
      entityType: "startup",
      entityId: id,
      action: "update",
      diff,
    });
    for (const tag of await startupTags(tx, [id])) tags.add(tag);
    return row;
  });
}
