import "server-only";

import { isAuthedContext, type ReadContext } from "../auth/context";
import {
  assertPageAllowed,
  type Cursor,
  cursorSecret,
  decodeCursor,
  encodeCursor,
  type KeyValue,
} from "./cursor";
import { ValidationError } from "./errors";
import { clampLimit, type Page, toPage } from "./pagination";

// The keyset page lifecycle shared by every paginated read (ADR-008, SEC-15): verify the cursor
// for this sort, enforce the anonymous depth limit, fetch `limit + 1` rows, then mint the next
// signed cursor from the last row returned.

export type PageRequest<Sort extends string> = Readonly<{
  sort: Sort;
  cursor: Cursor<Sort> | undefined;
  limit: number;
  page: number;
}>;

export type RowKey = Readonly<{ key: KeyValue[]; id: string }>;

export function beginPage<Sort extends string>(
  ctx: ReadContext,
  sort: Sort,
  token: string | undefined,
  requestedLimit: number | undefined,
): PageRequest<Sort> {
  const cursor =
    token === undefined ? undefined : decodeCursor(token, sort, cursorSecret());
  const page = cursor?.page ?? 1;
  assertPageAllowed(page, isAuthedContext(ctx));
  return { sort, cursor, limit: clampLimit(requestedLimit), page };
}

export function finishPage<Sort extends string, Row, T>(
  request: PageRequest<Sort>,
  rows: readonly Row[],
  map: (row: Row) => T,
  keyOf: (row: Row) => RowKey,
): Page<T> {
  return toPage(rows, request.limit, map, (last) => {
    const { key, id } = keyOf(last);
    return encodeCursor(
      { sort: request.sort, key, id, page: request.page + 1 },
      cursorSecret(),
    );
  });
}

/**
 * The single sort-key value of a verified cursor, checked against the type the sort expects.
 * A cursor is signed, so a mismatch means a bug or a key rotation; either way it is a 400.
 */
export function cursorKey<T extends "string" | "number">(
  cursor: Cursor,
  type: T,
): T extends "string" ? string : number {
  const [value] = cursor.key;
  if (cursor.key.length !== 1 || typeof value !== type) {
    throw new ValidationError([{ path: "cursor", message: "Invalid cursor." }]);
  }
  return value as T extends "string" ? string : number;
}
