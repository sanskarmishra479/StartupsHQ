import "server-only";

import { z } from "zod";
import { isSlug, MAX_SLUG_LENGTH } from "../../lib/slug";
import { roundTypeEnum, stageEnum, workTypeEnum } from "../db/schema/enums";
import { type FieldIssue, ValidationError } from "../lib/errors";
import { SEARCH_TYPES } from "../services/search";
import { STARTUP_SORTS } from "../services/startups";
import { parseInput } from "./shared";

// Query-string schemas for the public read endpoints (docs/API.md §6). Unknown parameters are
// ignored (API.md §1); a known one that is malformed is a 400, never a database cast error.
// Services still clamp `limit` and re-check what they depend on.

const MAX_REPEATED_VALUES = 20;
const MAX_CURSOR_LENGTH = 1024;

const slug = z.string().max(MAX_SLUG_LENGTH).refine(isSlug, "Invalid slug.");

const repeated = <T extends z.ZodType>(item: T) =>
  z.array(item).max(MAX_REPEATED_VALUES).optional();

/** Any whole number; the service clamps it into range (`limit=500` → 48, SEC-15). */
const wholeNumber = z
  .string()
  .regex(/^\d{1,6}$/, "Must be a whole number.")
  .transform(Number);

const paging = {
  cursor: z.string().min(1).max(MAX_CURSOR_LENGTH).optional(),
  limit: wholeNumber.optional(),
};

export const noQuery = z.object({});

export const pageQuery = z.object(paging);

export const startupListQuery = z.object({
  stage: repeated(z.enum(stageEnum.enumValues)),
  industry: repeated(slug),
  work_type: repeated(z.enum(workTypeEnum.enumValues)),
  city: repeated(slug),
  country: z
    .string()
    .regex(/^[A-Za-z]{2}$/, "Must be an ISO 3166-1 alpha-2 code.")
    .optional(),
  batch: slug.optional(),
  investor: slug.optional(),
  founder: slug.optional(),
  q: z.string().trim().min(2).max(100).optional(),
  include_acquired: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  sort: z.enum(STARTUP_SORTS).optional(),
  ...paging,
});

export const portfolioQuery = z.object({
  stage: repeated(z.enum(stageEnum.enumValues)),
  industry: repeated(slug),
  ...paging,
});

export const roundFeedQuery = z.object({
  round_type: repeated(z.enum(roundTypeEnum.enumValues)),
  investor: slug.optional(),
  industry: slug.optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  ...paging,
});

export const searchQuery = z.object({
  q: z.string().trim().min(2).max(100),
  type: z.enum(SEARCH_TYPES).optional(),
  limit: wholeNumber.optional(),
});

export const suggestQuery = z.object({
  q: z.string().trim().min(1).max(60),
});

export const privacyRequestsQuery = z.object({
  status: z.enum(["open", "completed", "rejected"]).optional(),
});

function isRepeatable(field: unknown): boolean {
  const inner = field instanceof z.ZodOptional ? field.unwrap() : field;
  return inner instanceof z.ZodArray;
}

/**
 * Reads only the parameters a schema names. Array fields take every value; any other field given
 * twice is a 400, so `?sort=name&sort=raised` cannot mean different things to different layers.
 */
export function parseQuery<S extends z.ZodObject>(
  schema: S,
  params: URLSearchParams,
): z.output<S> {
  const raw: Record<string, string | string[]> = {};
  const repeatedOnce: FieldIssue[] = [];
  for (const [key, field] of Object.entries(schema.shape)) {
    const values = params.getAll(key);
    if (values.length === 0) continue;
    if (isRepeatable(field)) {
      raw[key] = values;
    } else if (values.length === 1) {
      raw[key] = values[0] as string;
    } else {
      repeatedOnce.push({ path: key, message: "Pass this parameter once." });
    }
  }
  if (repeatedOnce.length > 0) {
    throw new ValidationError(repeatedOnce, "Invalid query parameters.");
  }
  return parseInput(schema, raw);
}
