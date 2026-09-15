import "server-only";

import { z } from "zod";
import { isSlug, MAX_SLUG_LENGTH } from "../../lib/slug";
import { type FieldIssue, ValidationError } from "../lib/errors";

// Building blocks for write validation (SEC-02). Services validate their own input, so no caller
// — route handler, script or test — can skip it. Every schema is a strict object: an unknown
// field such as `status`, `amountUsd` or `createdBy` is rejected, never silently dropped.

function toFieldIssue(issue: z.core.$ZodIssue): FieldIssue {
  const path = issue.path.map(String);
  if (issue.code === "unrecognized_keys") {
    return {
      path: [...path, issue.keys.join(", ")].join("."),
      message: "Unknown field.",
    };
  }
  return { path: path.join(".") || "(root)", message: issue.message };
}

export function parseInput<S extends z.ZodType>(
  schema: S,
  input: unknown,
): z.output<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw new ValidationError(result.error.issues.map(toFieldIssue));
}

export const isUuid = (value: unknown): value is string =>
  z.uuid().safeParse(value).success;

export const text = (max: number) => z.string().trim().min(1).max(max);

export const optionalText = (max: number) => text(max).nullable().optional();

/** https only, so a stored link can never become `javascript:` in an href. */
export const httpsUrl = () =>
  z.url({ protocol: /^https$/, error: "Must be an https:// URL." }).max(2048);

export const slugInput = z
  .string()
  .max(MAX_SLUG_LENGTH)
  .refine(isSlug, "Use lowercase letters, digits and single hyphens.");

export const year = () =>
  z
    .int()
    .min(1900)
    .max(new Date().getUTCFullYear() + 1);

export const wholeUsd = () => z.int().min(0).max(Number.MAX_SAFE_INTEGER);
