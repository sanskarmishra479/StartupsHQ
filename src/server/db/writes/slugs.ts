import "server-only";

import { sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { slugify, withSuffix } from "../../../lib/slug";
import { ConflictError, UnprocessableError } from "../../lib/errors";
import type { Transaction } from "../client";
import type { SluggedEntity } from "../queries/slugs";
import {
  batches,
  founders,
  investors,
  slugRedirects,
  startups,
} from "../schema";

// Slug claiming for new and renamed entities (FR-403, FR-409). The unique index still decides a
// race; this only picks a slug that is free when checked.

const TABLES = {
  startup: startups,
  founder: founders,
  investor: investors,
  batch: batches,
} as const;

const MAX_ATTEMPTS = 50;

/**
 * Taken by another entity of the same type, or still redirecting to one. An old slug keeps
 * pointing at its entity, so reusing it would silently change where old links go.
 */
async function isTaken(
  tx: Pick<Transaction, "execute">,
  entity: SluggedEntity,
  slug: string,
  ownerId: string | undefined,
): Promise<boolean> {
  // Every entity table has `id` and `slug`; the cast only unifies types, the SQL names the real table.
  const table = TABLES[entity] as unknown as typeof startups;
  const notOwner = (column: AnyPgColumn) =>
    ownerId ? sql`and ${column} <> ${ownerId}::uuid` : sql``;
  const { rows } = await tx.execute<{ taken: boolean }>(sql`
    select exists (select 1 from ${table} where ${table.slug} = ${slug} ${notOwner(table.id)})
        or exists (select 1 from ${slugRedirects}
                   where ${slugRedirects.entityType} = ${entity} and ${slugRedirects.oldSlug} = ${slug}
                   ${notOwner(slugRedirects.entityId)}) as taken`);
  return rows[0]?.taken === true;
}

/** An explicit free slug, or the first free slug generated from the name. */
export async function claimSlug(
  tx: Pick<Transaction, "execute">,
  entity: SluggedEntity,
  input: Readonly<{
    name: string;
    slug?: string | undefined;
    ownerId?: string;
  }>,
): Promise<string> {
  if (input.slug !== undefined) {
    if (await isTaken(tx, entity, input.slug, input.ownerId)) {
      throw new ConflictError("That slug is already taken.");
    }
    return input.slug;
  }

  const base = slugify(input.name);
  if (!base) {
    throw new UnprocessableError(
      "This name has no Latin letters or digits. Enter a slug.",
    );
  }
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const candidate = withSuffix(base, attempt);
    if (!(await isTaken(tx, entity, candidate, input.ownerId)))
      return candidate;
  }
  throw new ConflictError("Every generated slug is taken. Enter a slug.");
}
