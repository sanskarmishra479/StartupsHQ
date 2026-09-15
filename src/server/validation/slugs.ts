import "server-only";

import { z } from "zod";
import { slugInput } from "./shared";

// docs/API.md §8.2 (FR-409).

export const slugChangeSchema = z.strictObject({ slug: slugInput });

export type SlugChangeInput = z.input<typeof slugChangeSchema>;
