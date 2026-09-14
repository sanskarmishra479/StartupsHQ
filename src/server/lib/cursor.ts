import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { PaginationDepthError, ValidationError } from "./errors";

// Signed, sort-aware keyset cursors (ADR-008, ADR-017, SEC-15).
// Format: "v1.<base64url payload>.<base64url HMAC-SHA256>". The sort is inside the signed
// payload, so a cursor minted for one sort order can never be replayed against another.

export const MAX_ANONYMOUS_PAGE_DEPTH = 20;
const VERSION = "v1";
const MIN_SECRET_LENGTH = 32;
const MAX_KEY_PARTS = 4;
const MAX_PAGE = 10_000;

export type KeyValue = string | number | null;

export type Cursor<Sort extends string = string> = Readonly<{
  sort: Sort;
  /** Values of the sort columns for the last row on the previous page. */
  key: readonly KeyValue[];
  /** Tie-breaker: id of the last row on the previous page. */
  id: string;
  /** The page this cursor opens (page 1 never has a cursor). */
  page: number;
}>;

type Payload = { s: string; k: KeyValue[]; i: string; p: number };

export function cursorSecret(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const secret = env.CURSOR_SIGNING_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `CURSOR_SIGNING_SECRET must be set to at least ${MIN_SECRET_LENGTH} characters.`,
    );
  }
  return secret;
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`${VERSION}.${payload}`)
    .digest("base64url");
}

const invalidCursor = () =>
  new ValidationError([{ path: "cursor", message: "Invalid cursor." }]);

export function encodeCursor<Sort extends string>(
  cursor: Cursor<Sort>,
  secret: string,
): string {
  const payload: Payload = {
    s: cursor.sort,
    k: [...cursor.key],
    i: cursor.id,
    p: cursor.page,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${VERSION}.${encoded}.${sign(encoded, secret)}`;
}

function isPayload(value: unknown): value is Payload {
  if (typeof value !== "object" || value === null) return false;
  const { s, k, i, p } = value as Record<string, unknown>;
  return (
    typeof s === "string" &&
    typeof i === "string" &&
    i.length > 0 &&
    i.length <= 64 &&
    Number.isSafeInteger(p) &&
    (p as number) >= 2 &&
    (p as number) <= MAX_PAGE &&
    Array.isArray(k) &&
    k.length <= MAX_KEY_PARTS &&
    k.every(
      (part) =>
        part === null ||
        typeof part === "string" ||
        (typeof part === "number" && Number.isFinite(part)),
    )
  );
}

/** Verifies and decodes a cursor. Any tampering, wrong version or sort mismatch → 400. */
export function decodeCursor<Sort extends string>(
  token: string,
  expectedSort: Sort,
  secret: string,
): Cursor<Sort> {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION) throw invalidCursor();
  const [, encoded = "", signature = ""] = parts;

  const expected = Buffer.from(sign(encoded, secret));
  const actual = Buffer.from(signature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw invalidCursor();
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw invalidCursor();
  }
  if (!isPayload(decoded) || decoded.s !== expectedSort) throw invalidCursor();

  return Object.freeze({
    sort: expectedSort,
    key: Object.freeze([...decoded.k]),
    id: decoded.i,
    page: decoded.p,
  });
}

/** Anonymous callers may page at most MAX_ANONYMOUS_PAGE_DEPTH pages deep (SEC-15). */
export function assertPageAllowed(page: number, isAuthenticated: boolean) {
  if (!isAuthenticated && page > MAX_ANONYMOUS_PAGE_DEPTH) {
    throw new PaginationDepthError();
  }
}
