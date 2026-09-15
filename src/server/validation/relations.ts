import "server-only";

import { z } from "zod";
import { founderRoleEnum } from "../db/schema";
import { httpsUrl, wholeUsd, year } from "./shared";

// docs/API.md §8.3: the links that make up the graph. Joined and left years are checked against
// each other in db/writes/relations.ts, so the error can say which one is wrong.

export const founderLinkSchema = z.strictObject({
  founderId: z.uuid(),
  role: z.enum(founderRoleEnum.enumValues),
  /** Defaults to true unless a year left is given. */
  isCurrent: z.boolean().optional(),
  joinedYear: year().nullable().optional(),
  leftYear: year().nullable().optional(),
  sortOrder: z.int().min(0).max(1000).optional(),
  /** Where this attribution came from (SEC-18). */
  sourceUrl: httpsUrl().nullable().optional(),
});

export const investorLinkSchema = z.strictObject({
  investorId: z.uuid(),
  /** A round of the same startup; null records a backer whose round is unknown (ADR-005). */
  roundId: z.uuid().nullable().optional(),
  isLead: z.boolean().optional(),
  amountUsd: wholeUsd().nullable().optional(),
});

export const batchLinkSchema = z.strictObject({ batchId: z.uuid() });

export const industryLinksSchema = z.strictObject({
  industries: z
    .array(z.strictObject({ id: z.uuid(), isPrimary: z.boolean().optional() }))
    .max(20),
});

export type FounderLinkInput = z.input<typeof founderLinkSchema>;
export type FounderLink = z.output<typeof founderLinkSchema>;
export type InvestorLinkInput = z.input<typeof investorLinkSchema>;
export type InvestorLink = z.output<typeof investorLinkSchema>;
export type BatchLinkInput = z.input<typeof batchLinkSchema>;
export type IndustryLinksInput = z.input<typeof industryLinksSchema>;
export type IndustryLink = z.output<
  typeof industryLinksSchema
>["industries"][number];
