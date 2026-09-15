import "server-only";

import type { z } from "zod";
import type { AuthedContext } from "../../auth/context";
import { ForbiddenError, UnprocessableError } from "../../lib/errors";
import { convertRound, convertToWholeUsd, findRate } from "../../lib/fx";
import type { createRoundSchema } from "../../validation/rounds";
import { auditDiff, writeAudit } from "../audit";
import type { Transaction } from "../client";
import { fundingRounds, investments } from "../schema";

// Round inserts shared by the round endpoints and nested startup creation (FR-404, FR-406).
// Editors enter the original currency and amount; the server converts to whole USD. A manual rate
// is for admins only, and only for a currency with no ECB rate for that date.

export type NewRound = Omit<z.output<typeof createRoundSchema>, "startupId">;

type ManualFx = Readonly<{ rate: string; sourceNote: string }>;

export type AmountInput = Readonly<{
  currency: string;
  announcedOn: string;
  isUndisclosed: boolean;
  amountOriginal: string | null | undefined;
  manualFx: ManualFx | undefined;
}>;

export type StoredAmounts = {
  amountOriginal: string | null;
  amountUsd: number | null;
  fxRate: string | null;
  fxRateDate: string | null;
  fxSource: "ecb" | "manual" | null;
};

export async function resolveAmounts(
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
export function withFxSource(
  notes: string | null | undefined,
  manualFx: ManualFx | undefined,
): string | null | undefined {
  if (!manualFx) return notes;
  return [notes, `FX rate source: ${manualFx.sourceNote}`]
    .filter(Boolean)
    .join("\n\n");
}

/** Inserts an audited draft round and its participants. */
export async function insertRound(
  tx: Transaction,
  ctx: AuthedContext,
  startupId: string,
  round: NewRound,
): Promise<{ id: string; status: "draft" | "published" | "archived" }> {
  const { investors: participants = [], manualFx, ...fields } = round;
  // The service checks this first; a second check here keeps every caller honest.
  if (manualFx && ctx.actor.role !== "admin") throw new ForbiddenError();

  const investorIds = participants.map((participant) => participant.investorId);
  if (new Set(investorIds).size !== investorIds.length) {
    throw new UnprocessableError("An investor is listed twice.");
  }

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
  return row;
}
