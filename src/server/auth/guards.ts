import "server-only";

import { ForbiddenError } from "../lib/errors";
import {
  type AuthedContext,
  isAuthedContext,
  type ReadContext,
} from "./context";

export type AdminContext = AuthedContext & {
  readonly actor: { readonly id: string; readonly role: "admin" };
};

/**
 * First line of every mutation (SEC-03.3). Admins are editors too.
 * Throws ForbiddenError for public, public-read and forged contexts.
 */
export function assertEditor(ctx: ReadContext): asserts ctx is AuthedContext {
  if (!isAuthedContext(ctx)) throw new ForbiddenError();
}

/** For admin-only actions: hard delete, slug change, users, privacy, manual FX. */
export function assertAdmin(ctx: ReadContext): asserts ctx is AdminContext {
  assertEditor(ctx);
  if (ctx.actor.role !== "admin") throw new ForbiddenError();
}
