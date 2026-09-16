import "server-only";

import { z } from "zod";
import { isSlug, MAX_SLUG_LENGTH } from "../../lib/slug";
import { headcountBandEnum, stageEnum, workTypeEnum } from "../db/schema";
import { httpsUrl, text, year } from "./shared";

// docs/API.md §8.7 (FR-402, SEC-07). One row of the startup import sheet. Unknown columns are
// ignored, because real spreadsheets carry notes and working columns; every column we do know is
// validated, and a row reports all of its problems at once rather than only the first.

/** A spreadsheet's empty cell is "no value", not an empty string. */
const optional = <S extends z.ZodType>(schema: S) =>
  z.preprocess((value) => {
    if (typeof value !== "string") return value ?? undefined;
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
  }, schema.optional());

/** `Fintech; Payments` → `["Fintech", "Payments"]`. */
const list = () =>
  z.preprocess(
    (value) =>
      typeof value === "string"
        ? value
            .split(";")
            .map((part) => part.trim())
            .filter(Boolean)
        : (value ?? []),
    z.array(z.string().min(1).max(200)).max(20),
  );

const enumColumn = <T extends readonly [string, ...string[]]>(values: T) =>
  optional(
    z.preprocess(
      (value) =>
        typeof value === "string"
          ? value.toLowerCase().replace(/[\s-]+/g, "_")
          : value,
      z.enum(values),
    ),
  );

export const importRowSchema = z.object({
  name: text(200),
  slug: optional(
    z
      .string()
      .max(MAX_SLUG_LENGTH)
      .refine(isSlug, "Use lowercase letters, digits and single hyphens."),
  ),
  tagline: optional(z.string().max(120)),
  description: optional(z.string().max(4000)),
  websiteurl: optional(httpsUrl()),
  careersurl: optional(httpsUrl()),
  stage: enumColumn(stageEnum.enumValues),
  worktype: enumColumn(workTypeEnum.enumValues),
  headcountband: optional(z.enum(headcountBandEnum.enumValues)),
  foundedyear: optional(z.coerce.number().pipe(year())),
  /** A `locations` slug, such as `berlin-de`. */
  location: optional(z.string().max(MAX_SLUG_LENGTH)),
  /** Industry slugs, `;`-separated. */
  industries: list(),
  /** Founder names, `;`-separated; unknown names become drafts. */
  founders: list(),
  /** Investor names, `;`-separated; unknown names become drafts. */
  investors: list(),
});

export type ImportRowInput = z.input<typeof importRowSchema>;
export type ImportRow = z.output<typeof importRowSchema>;

export const commitImportSchema = z.strictObject({ importJobId: z.uuid() });

export type CommitImportInput = z.input<typeof commitImportSchema>;
