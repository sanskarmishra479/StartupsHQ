import "server-only";

import { revalidateTag } from "next/cache";
import { getDb, type Transaction } from "./client";
import { translateDbError } from "./pg-errors";

// Every write runs through here (FR-405, NFR-02, NFR-08): one transaction, with cache tags
// expired only after it commits. A rolled-back write expires nothing and leaves no audit row.

export type TagSet = Set<string>;

export async function runMutation<T>(
  work: (tx: Transaction, tags: TagSet) => Promise<T>,
): Promise<T> {
  const tags: TagSet = new Set();
  let result: T;
  try {
    result = await getDb().transaction((tx) => work(tx, tags));
  } catch (error) {
    throw translateDbError(error);
  }
  // `{ expire: 0 }`: the next read is a blocking miss, so a publish is never served stale.
  for (const tag of tags) revalidateTag(tag, { expire: 0 });
  return result;
}
