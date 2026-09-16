import "server-only";

import { z } from "zod";
import { userRoleEnum } from "../db/schema";
import { text } from "./shared";

// docs/API.md §8.8 (FR-208). Staff accounts only — there are no public accounts — and every
// endpoint here is admin-only.

export const inviteUserSchema = z.strictObject({
  email: z.email().max(254),
  role: z.enum(userRoleEnum.enumValues),
  /** Defaults to the address's local part. */
  name: text(200).optional(),
});

export const changeRoleSchema = z.strictObject({
  role: z.enum(userRoleEnum.enumValues),
});

export type InviteUserInput = z.input<typeof inviteUserSchema>;
export type ChangeRoleInput = z.input<typeof changeRoleSchema>;
