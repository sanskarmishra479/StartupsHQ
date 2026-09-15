import "server-only";

import { z } from "zod";
import { httpsUrl, optionalText } from "./shared";

// docs/API.md §8.4 (FR-205): editable copy for a facet value. Every field is optional; a field
// left out keeps its value, and null clears it back to the generated fallback.

export const categoryCopySchema = z.strictObject({
  heading: optionalText(120),
  /** Markdown. */
  intro: optionalText(4000),
  seoTitle: optionalText(120),
  seoDescription: optionalText(300),
  iconUrl: httpsUrl().nullable().optional(),
  sortOrder: z.int().min(0).max(10_000).optional(),
});

export type CategoryCopyInput = z.input<typeof categoryCopySchema>;
