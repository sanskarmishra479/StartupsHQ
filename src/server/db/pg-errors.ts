import "server-only";

import { ConflictError, UnprocessableError } from "../lib/errors";

// Constraint violations are expected outcomes of invalid or racing writes, not 500s. Drizzle
// wraps driver errors in DrizzleQueryError (which carries the query and its parameters), so the
// Postgres error is found on `cause`. Neither is ever sent to a client (SEC-12).

type PgError = { code: string; constraint?: unknown };

const SQLSTATE = /^[0-9A-Z]{5}$/;

function findPgError(error: unknown): PgError | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth++) {
    const candidate = current as { code?: unknown; cause?: unknown };
    if (typeof candidate.code === "string" && SQLSTATE.test(candidate.code)) {
      return candidate as PgError;
    }
    current = candidate.cause;
  }
  return undefined;
}

export function pgErrorCode(error: unknown): string | undefined {
  return findPgError(error)?.code;
}

/** A client-safe error for a constraint violation; any other error is returned unchanged. */
export function translateDbError(error: unknown): unknown {
  const pg = findPgError(error);
  if (!pg) return error;
  const constraint = typeof pg.constraint === "string" ? pg.constraint : "";

  switch (pg.code) {
    case "23505":
      return new ConflictError(
        constraint.includes("slug")
          ? "That slug is already taken."
          : "This conflicts with an existing record.",
      );
    case "23503":
      return new UnprocessableError("A referenced record does not exist.");
    case "23514":
      return new UnprocessableError("These values break a data rule.");
    case "23502":
      return new UnprocessableError("A required value is missing.");
    case "22P02":
    case "22007":
    case "22008":
      return new UnprocessableError("A value has the wrong format.");
    default:
      return error;
  }
}
