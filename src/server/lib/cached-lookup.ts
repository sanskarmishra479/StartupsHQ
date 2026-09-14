import "server-only";

import type { SlugLookup } from "../db/queries/slugs";
import { NotFoundError } from "./errors";

// Cached reads return absence as a value. An error thrown inside `'use cache'` reaches the caller
// as a generic digest error in production, so `instanceof NotFoundError` would not survive the
// cache boundary; a `{ kind: "not-found" }` value does, and the page turns it into notFound().

export type NotFound = Readonly<{ kind: "not-found" }>;

export const NOT_FOUND: NotFound = Object.freeze({ kind: "not-found" });

export type CachedLookup<T> = SlugLookup<T> | NotFound;

export async function notFoundAsValue<T>(
  read: Promise<T>,
): Promise<T | NotFound> {
  try {
    return await read;
  } catch (error) {
    if (error instanceof NotFoundError) return NOT_FOUND;
    throw error;
  }
}
