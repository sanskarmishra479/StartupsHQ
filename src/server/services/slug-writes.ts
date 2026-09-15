import "server-only";

import { and, eq } from "drizzle-orm";
import type { ReadContext } from "../auth/context";
import { assertAdmin } from "../auth/guards";
import { writeAudit } from "../db/audit";
import type { Transaction } from "../db/client";
import { runMutation } from "../db/mutation";
import type { SluggedEntity } from "../db/queries/slugs";
import {
  batches,
  founders,
  investors,
  slugRedirects,
  startups,
} from "../db/schema";
import { claimSlug } from "../db/writes/slugs";
import {
  batchTags,
  founderTags,
  investorTags,
  startupTags,
} from "../db/writes/tags";
import { NotFoundError } from "../lib/errors";
import { isUuid, parseInput } from "../validation/shared";
import { type SlugChangeInput, slugChangeSchema } from "../validation/slugs";

// Admin slug changes (docs/API.md §8.2, FR-409). The old slug becomes a redirect to the entity.
// Redirects point at the entity's id, never at another slug, so chains are flat by construction:
// every old slug answers with the current one. Moving back to one of the entity's own old slugs
// removes that redirect.

const ENTITIES: Record<
  SluggedEntity,
  {
    table: typeof startups;
    tags: (tx: Transaction, id: string) => Promise<string[]>;
  }
> = {
  // Every entity table has `id` and `slug`; the cast only unifies types, the SQL names the real table.
  startup: { table: startups, tags: (tx, id) => startupTags(tx, [id]) },
  founder: {
    table: founders as unknown as typeof startups,
    tags: (tx, id) => founderTags(tx, [id]),
  },
  investor: {
    table: investors as unknown as typeof startups,
    tags: (tx, id) => investorTags(tx, [id]),
  },
  batch: {
    table: batches as unknown as typeof startups,
    tags: (tx, id) => batchTags(tx, [id]),
  },
};

const isSluggedEntity = (value: string): value is SluggedEntity =>
  Object.hasOwn(ENTITIES, value);

export async function changeSlug(
  ctx: ReadContext,
  entity: string,
  id: string,
  input: SlugChangeInput,
): Promise<{ id: string; slug: string }> {
  assertAdmin(ctx);
  if (!isSluggedEntity(entity) || !isUuid(id)) throw new NotFoundError();
  const { slug: requested } = parseInput(slugChangeSchema, input);
  const { table, tags: tagsFor } = ENTITIES[entity];

  return runMutation(async (tx, tags) => {
    const [current] = await tx
      .select({ slug: table.slug })
      .from(table)
      .where(eq(table.id, id))
      .for("update");
    if (!current) throw new NotFoundError();
    if (current.slug === requested) return { id, slug: requested };

    // Taken by another entity, or still redirecting to one, is a conflict; this entity's own
    // old slug is not.
    const slug = await claimSlug(tx, entity, {
      name: "",
      slug: requested,
      ownerId: id,
    });

    // Before the change, so every old slug's cached redirect expires too.
    for (const tag of await tagsFor(tx, id)) tags.add(tag);

    await tx
      .delete(slugRedirects)
      .where(
        and(
          eq(slugRedirects.entityType, entity),
          eq(slugRedirects.entityId, id),
          eq(slugRedirects.oldSlug, slug),
        ),
      );
    await tx.update(table).set({ slug }).where(eq(table.id, id));
    await tx
      .insert(slugRedirects)
      .values({ entityType: entity, oldSlug: current.slug, entityId: id });

    await writeAudit(tx, ctx, {
      entityType: entity,
      entityId: id,
      action: "slug_change",
      // A founder's slug is derived from their name, so it is recorded by name only (ADR-019).
      diff: {
        slug:
          entity === "founder"
            ? { changed: true }
            : { from: current.slug, to: slug },
      },
    });

    for (const tag of await tagsFor(tx, id)) tags.add(tag);
    return { id, slug };
  });
}
