import "server-only";

import { z } from "zod";

// docs/API.md §8.6 (FR-401, SEC-05). The URL is deliberately only length-checked here: every
// other rule about it — https, public address, no credentials — belongs to safeFetch, so a
// hostile URL is refused with `UNSAFE_URL` by the one component that owns that judgement.

export const prefillSchema = z.strictObject({
  url: z.string().trim().min(1).max(2048),
});

export type PrefillInput = z.input<typeof prefillSchema>;
