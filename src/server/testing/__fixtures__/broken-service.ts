import "server-only";

import type { PublicReadContext, ReadContext } from "../../auth/context";
import { assertEditor } from "../../auth/guards";
import { THINGS, type Thing } from "./stub-service";

// Deliberately wrong. The harness must report every one of these.

/** Ignores visibility: leaks drafts to everyone. */
export async function leakyList(_ctx: ReadContext): Promise<Thing[]> {
  return [...THINGS];
}

/** Forgets assertEditor(). */
export async function unguardedDelete(_ctx: ReadContext): Promise<boolean> {
  return true;
}

/** An admin-only action that only checks for an editor. */
export async function editorOnlyPurge(ctx: ReadContext): Promise<void> {
  assertEditor(ctx);
}

/** A cached read without its runtime guard. */
export async function cachedReadWithoutGuard(
  _ctx: PublicReadContext,
): Promise<Thing[]> {
  return THINGS.filter((thing) => thing.status === "published");
}

/** An admin-panel read that forgets assertEditor(), so anyone could list drafts. */
export async function unguardedEditorList(_ctx: ReadContext): Promise<Thing[]> {
  return [...THINGS];
}
