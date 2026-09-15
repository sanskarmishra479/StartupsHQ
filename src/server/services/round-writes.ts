import "server-only";

import { eq } from "drizzle-orm";
import type { ReadContext } from "../auth/context";
import { assertAdmin, assertEditor } from "../auth/guards";
import { auditDiff, writeAudit } from "../db/audit";
import { recomputeStartupDerived } from "../db/derived";
import { runMutation } from "../db/mutation";
import { fundingRounds, startups } from "../db/schema";
import { insertRound, resolveAmounts, withFxSource } from "../db/writes/rounds";
import { roundTags } from "../db/writes/tags";
import { NotFoundError, UnprocessableError } from "../lib/errors";
import {
  type CreateRoundInput,
  createRoundSchema,
  type UpdateRoundInput,
  updateRoundSchema,
} from "../validation/rounds";
import { isUuid, parseInput } from "../validation/shared";

// Funding round writes (docs/API.md §8.1, FR-404, FR-406). Conversion and inserts live in
// db/writes/rounds.ts, shared with nested startup creation. Totals are recomputed in the same
// transaction as any change to a round.

export type RoundWriteResult = Readonly<{
  id: string;
  status: "draft" | "published" | "archived";
}>;

const AMOUNT_FIELDS = [
  "announcedOn",
  "isUndisclosed",
  "currency",
  "amountOriginal",
] as const;

/** Creates a draft round, with its participating investors. */
export async function create(
  ctx: ReadContext,
  input: CreateRoundInput,
): Promise<RoundWriteResult> {
  assertEditor(ctx);
  const { startupId, ...round } = parseInput(createRoundSchema, input);
  if (round.manualFx) assertAdmin(ctx);

  return runMutation(async (tx, tags) => {
    const [startup] = await tx
      .select({ id: startups.id })
      .from(startups)
      .where(eq(startups.id, startupId))
      .for("update");
    if (!startup) throw new UnprocessableError("That startup does not exist.");

    const row = await insertRound(tx, ctx, startupId, round);
    for (const tag of await roundTags(tx, [row.id])) tags.add(tag);
    return row;
  });
}

/**
 * Partial update. Changing the date, currency, amount or disclosure re-converts the amount; making
 * a round undisclosed clears it. Totals are recomputed either way.
 */
export async function update(
  ctx: ReadContext,
  id: string,
  input: UpdateRoundInput,
): Promise<RoundWriteResult> {
  assertEditor(ctx);
  if (!isUuid(id)) throw new NotFoundError();
  const { manualFx, ...changes } = parseInput(updateRoundSchema, input);
  if (manualFx) assertAdmin(ctx);

  return runMutation(async (tx, tags) => {
    const [current] = await tx
      .select()
      .from(fundingRounds)
      .where(eq(fundingRounds.id, id))
      .for("update");
    if (!current) throw new NotFoundError();

    const next: Record<string, unknown> = { ...changes };
    const touchesAmount =
      manualFx !== undefined ||
      AMOUNT_FIELDS.some((field) => changes[field] !== undefined);

    if (touchesAmount) {
      const amountOriginal =
        changes.amountOriginal !== undefined
          ? changes.amountOriginal
          : changes.isUndisclosed === true
            ? null
            : current.amountOriginal;
      Object.assign(
        next,
        await resolveAmounts(tx, {
          currency: changes.currency ?? current.currency,
          announcedOn: changes.announcedOn ?? current.announcedOn,
          isUndisclosed: changes.isUndisclosed ?? current.isUndisclosed,
          amountOriginal,
          manualFx,
        }),
      );
      if (manualFx) {
        next.notes = withFxSource(changes.notes ?? current.notes, manualFx);
      }
    }

    const diff = auditDiff(current, next);
    if (Object.keys(diff).length === 0) {
      return { id, status: current.status };
    }

    for (const tag of await roundTags(tx, [id])) tags.add(tag);
    await tx
      .update(fundingRounds)
      .set({
        ...(next as Partial<typeof fundingRounds.$inferInsert>),
        updatedBy: ctx.actor.id,
      })
      .where(eq(fundingRounds.id, id));
    await recomputeStartupDerived(tx, [current.startupId]);

    await writeAudit(tx, ctx, {
      entityType: "round",
      entityId: id,
      action: "update",
      diff,
    });
    return { id, status: current.status };
  });
}
