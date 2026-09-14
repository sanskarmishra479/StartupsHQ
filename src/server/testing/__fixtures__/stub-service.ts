import "server-only";

import {
  assertPublicRead,
  isAuthedContext,
  type PublicReadContext,
  type ReadContext,
} from "../../auth/context";
import { assertAdmin, assertEditor } from "../../auth/guards";

// A tiny service that follows every authz rule, so the harness can be proven on it.

export type Thing = { slug: string; status: "draft" | "published" };

export const THINGS: readonly Thing[] = [
  { slug: "public-thing", status: "published" },
  { slug: "draft-thing", status: "draft" },
];

export async function listThings(ctx: ReadContext): Promise<Thing[]> {
  return THINGS.filter(
    (thing) => isAuthedContext(ctx) || thing.status === "published",
  );
}

export async function getCachedThings(
  ctx: PublicReadContext,
): Promise<Thing[]> {
  assertPublicRead(ctx);
  return THINGS.filter((thing) => thing.status === "published");
}

export async function renameThing(
  ctx: ReadContext,
  slug: string,
): Promise<string> {
  assertEditor(ctx);
  return slug;
}

export async function purgeThing(ctx: ReadContext): Promise<void> {
  assertAdmin(ctx);
}
