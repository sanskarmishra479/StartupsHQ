import "server-only";

import { z } from "zod";
import { privacyRequestTypeEnum } from "../db/schema";
import { optionalText } from "./shared";

// docs/API.md §8.9 (FR-210, FR-410). Admin only.

export const privacyRequestSchema = z.strictObject({
  requestType: z.enum(privacyRequestTypeEnum.enumValues),
  subjectEntityType: z.enum(["founder", "user", "other"]),
  subjectEntityId: z.uuid().nullable().optional(),
  receivedAt: z.iso.datetime({ offset: true }),
  notes: optionalText(4000),
});

export const resolvePrivacyRequestSchema = z.strictObject({
  status: z.enum(["completed", "rejected"]),
  notes: optionalText(4000),
});

/** The typed confirmation `ERASE <founder-slug>`; compared with the founder's slug in the service. */
export const eraseFounderSchema = z.strictObject({
  confirm: z.string().max(200),
});

export type PrivacyRequestInput = z.input<typeof privacyRequestSchema>;
export type ResolvePrivacyRequestInput = z.input<
  typeof resolvePrivacyRequestSchema
>;
export type EraseFounderInput = z.input<typeof eraseFounderSchema>;
