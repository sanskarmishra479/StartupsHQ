import "server-only";

import { z } from "zod";
import { roundTypeEnum } from "../db/schema";
import { httpsUrl, optionalText, text, wholeUsd } from "./shared";

// docs/API.md §8.1 for rounds (FR-406). `amountUsd`, `fxRate`, `fxRateDate` and `fxSource` are
// not fields: the server computes them, so a client value is rejected as an unknown field.

/** Amounts travel as exact decimal strings; a JS float never touches money. */
const amount = z.union([
  z.int().min(0).max(Number.MAX_SAFE_INTEGER).transform(String),
  z
    .string()
    .regex(
      /^\d{1,15}(\.\d{1,2})?$/,
      "Use a positive amount with at most 2 decimals.",
    ),
]);

const rate = z.union([
  z
    .number()
    .positive()
    .max(1e9)
    .refine(
      (value) => Number(value.toFixed(8)) === value,
      "At most 8 decimals.",
    )
    .transform((value) => value.toFixed(8)),
  z
    .string()
    .regex(/^\d{1,10}(\.\d{1,8})?$/, "Use a decimal rate.")
    .refine((value) => Number(value) > 0, "Must be positive."),
]);

const fields = {
  roundType: z.enum(roundTypeEnum.enumValues),
  announcedOn: z.iso.date(),
  isUndisclosed: z.boolean().optional(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/, "Use an ISO 4217 code such as USD.")
    .optional(),
  amountOriginal: amount.nullable().optional(),
  valuationUsd: wholeUsd().nullable().optional(),
  sourceUrl: httpsUrl(),
  sourceTitle: optionalText(300),
  notes: optionalText(2000),
  /** Admin only, for a currency the ECB does not publish. */
  manualFx: z.strictObject({ rate, sourceNote: text(500) }).optional(),
};

export const createRoundSchema = z.strictObject({
  ...fields,
  startupId: z.uuid(),
  investors: z
    .array(
      z.strictObject({
        investorId: z.uuid(),
        isLead: z.boolean().optional(),
      }),
    )
    .max(50)
    .optional(),
});

/** Partial. Participants change through the startup's investor links (§8.3). */
export const updateRoundSchema = z.strictObject(fields).partial();

export type CreateRoundInput = z.input<typeof createRoundSchema>;
export type UpdateRoundInput = z.input<typeof updateRoundSchema>;
