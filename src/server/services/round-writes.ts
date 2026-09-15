import "server-only";

import { eq } from "drizzle-orm";
import type { ReadContext } from "../auth/context";
import { assertAdmin, assertEditor } from "../auth/guards";
import { auditDiff, writeAudit } from "../db/audit";
import type { Transaction } from "../db/client";
import { recomputeStartupDerived } from "../db/derived";
import { runMutation } from "../db/mutation";
import { fundingRounds, investments, startups } from "../db/schema";
import { roundTags } from "../db/writes/tags";
import { NotFoundError, UnprocessableError } from "../lib/errors";
import { convertRound, convertToWholeUsd, findRate } from "../lib/fx";
import {
  type CreateRoundInput,
  createRoundSchema,
  type UpdateRoundInput,
  updateRoundSchema,
} from "../validation/rounds";
import { isUuid, parseInput } from "../validation/shared";

// Funding round writes (docs/API.md §8.1, FR-404, FR-406). Editors enter the original currency
// and amount; the server converts to whole USD from fx_rates. Only an admin may enter a manual
// rate, and only for a currency with no ECB rate for that date. Totals are recomputed in the
// same transaction.

export type RoundWriteResult = Readonly<{
  id: string;
  status: "draft" | "published" | "archived";
}>;

type ManualFx = Readonly<{ rate: string; sourceNote: string }>;

type AmountInput = Readonly<{
  currency: string;
  announcedOn: string;
  isUndisclosed: boolean;
  amountOriginal: string | null | undefined;
  manualFx: ManualFx | undefined;
}>;

type StoredAmounts = {
  amountOriginal: string | null;
  amountUsd: number | null;
  fxRate: string | null;
  fxRateDate: string | null;
  fxSource: "ecb" | "manual" | null;
};

const AMOUNT_FIELDS = [
  "announcedOn",
  "isUndisclosed",
  "currency",
  "amountOriginal",
] as const;

async function resolveAmounts(
  tx: Transaction,
  input: AmountInput,
): Promise<StoredAmounts> {
  if (input.isUndisclosed) {
    if (input.amountOriginal != null || input.manualFx) {
      throw new UnprocessableError(
        "An undisclosed round has no amount or exchange rate.",
      );
    }
    return {
      amountOriginal: null,
      amountUsd: null,
      fxRate: null,
      fxRateDate: null,
      fxSource: null,
    };
  }
  if (input.amountOriginal == null) {
    throw new UnprocessableError(
      "Enter the amount, or mark the round as undisclosed.",
    );
  }

  if (!input.manualFx) {
    return {
      amountOriginal: input.amountOriginal,
      ...(await convertRound(tx, {
        currency: input.currency,
        amountOriginal: input.amountOriginal,
        announcedOn: input.announcedOn,
      })),
    };
  }

  if (input.currency === "USD") {
    throw new UnprocessableError("A USD round needs no exchange rate.");
  }
  if (await findRate(tx, input.currency, input.announcedOn)) {
    throw new UnprocessableError(
      `There is an ECB rate for ${input.currency} on that date, and it is used automatically.`,
    );
  }
  return {
    amountOriginal: input.amountOriginal,
    amountUsd: convertToWholeUsd(input.amountOriginal, input.manualFx.rate),
    fxRate: input.manualFx.rate,
    fxRateDate: input.announcedOn,
    fxSource: "manual",
  };
}

/** A manual rate keeps its source next to the round (FR-406). */
function withFxSource(
  notes: string | null | undefined,
  manualFx: ManualFx | undefined,
): string | null | undefined {
  if (!manualFx) return notes;
  return [notes, `FX rate source: ${manualFx.sourceNote}`]
    .filter(Boolean)
    .join("\n\n");
}

/** Creates a draft round, with its participating investors. */
export async function create(
  ctx: ReadContext,
  input: CreateRoundInput,
): Promise<RoundWriteResult> {
  assertEditor(ctx);
  const {
    startupId,
    investors: participants = [],
    manualFx,
    ...fields
  } = parseInput(createRoundSchema, input);
  if (manualFx) assertAdmin(ctx);
  const investorIds = participants.map((participant) => participant.investorId);
  if (new Set(investorIds).size !== investorIds.length) {
    throw new UnprocessableError("An investor is listed twice.");
  }

  return runMutation(async (tx, tags) => {
    const [startup] = await tx
      .select({ id: startups.id })
      .from(startups)
      .where(eq(startups.id, startupId))
      .for("update");
    if (!startup) throw new UnprocessableError("That startup does not exist.");

    const isUndisclosed = fields.isUndisclosed ?? false;
    const currency = fields.currency ?? "USD";
    const values = {
      ...fields,
      currency,
      isUndisclosed,
      notes: withFxSource(fields.notes, manualFx),
      ...(await resolveAmounts(tx, {
        currency,
        announcedOn: fields.announcedOn,
        isUndisclosed,
        amountOriginal: fields.amountOriginal,
        manualFx,
      })),
    };

    const [row] = await tx
      .insert(fundingRounds)
      .values({
        ...values,
        startupId,
        status: "draft",
        createdBy: ctx.actor.id,
        updatedBy: ctx.actor.id,
      })
      .returning({ id: fundingRounds.id, status: fundingRounds.status });
    if (!row) throw new Error("Insert returned no row.");

    if (participants.length > 0) {
      await tx.insert(investments).values(
        participants.map((participant) => ({
          startupId,
          investorId: participant.investorId,
          roundId: row.id,
          isLead: participant.isLead ?? false,
        })),
      );
    }

    await writeAudit(tx, ctx, {
      entityType: "round",
      entityId: row.id,
      action: "create",
      diff: auditDiff(null, { ...values, startupId, investors: participants }),
    });
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
      const isUndisclosed = changes.isUndisclosed ?? current.isUndisclosed;
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
          isUndisclosed,
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
