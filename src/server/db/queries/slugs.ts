import "server-only";

import { and, eq } from "drizzle-orm";
import { isSlug } from "../../../lib/slug";
import type { ReadContext } from "../../auth/context";
import { visibilityFilter } from "../../auth/visibility";
import { NotFoundError } from "../../lib/errors";
import type { Database } from "../client";
import {
  batches,
  founders,
  investors,
  slugRedirects,
  startups,
} from "../schema";

// Slug resolution for the four public entity types (FR-409). Both lookups apply visibility to
// the entity itself, so an old slug of a draft, or a sub-resource of a hidden entity, is a 404.

/** A slug read either finds the entity or answers with its current slug. */
export type SlugLookup<T> =
  | Readonly<{ kind: "found"; value: T }>
  | Readonly<{ kind: "redirect"; slug: string }>;

export type SluggedEntity = "startup" | "founder" | "investor" | "batch";

const ENTITY_TABLES = {
  startup: startups,
  founder: founders,
  investor: investors,
  batch: batches,
} as const;

// Every entity table has `id`, `slug` and `status`. The cast only unifies the TypeScript types;
// the generated SQL names the real table.
const tableFor = (entity: SluggedEntity) =>
  ENTITY_TABLES[entity] as unknown as typeof startups;

/** Resolves an old slug to the entity's current slug, or throws NotFoundError. */
export async function findRedirect(
  db: Database,
  ctx: ReadContext,
  entity: SluggedEntity,
  oldSlug: string,
): Promise<string> {
  const table = tableFor(entity);
  const [row] = await db
    .select({ slug: table.slug })
    .from(slugRedirects)
    .innerJoin(table, eq(table.id, slugRedirects.entityId))
    .where(
      and(
        eq(slugRedirects.entityType, entity),
        eq(slugRedirects.oldSlug, oldSlug),
        visibilityFilter(ctx, table.status),
      ),
    )
    .limit(1);
  if (!row) throw new NotFoundError();
  return row.slug;
}

/** The id of a visible entity by its current slug, or NotFoundError. */
export async function findVisibleId(
  db: Database,
  ctx: ReadContext,
  entity: SluggedEntity,
  slug: string,
): Promise<string> {
  if (!isSlug(slug)) throw new NotFoundError();
  const table = tableFor(entity);
  const [row] = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.slug, slug), visibilityFilter(ctx, table.status)))
    .limit(1);
  if (!row) throw new NotFoundError();
  return row.id;
}
