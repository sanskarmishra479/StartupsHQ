import "server-only";

import { and, eq } from "drizzle-orm";
import { isSlug } from "../../lib/slug";
import type { ReadContext } from "../auth/context";
import { assertEditor } from "../auth/guards";
import { auditDiff, writeAudit } from "../db/audit";
import { runMutation } from "../db/mutation";
import { resolveFacet, TAXONOMY_KIND } from "../db/queries/facets";
import { taxonomyPages } from "../db/schema";
import { isCategoryKind } from "../dto/category";
import { cacheTags } from "../lib/cache-tags";
import { NotFoundError } from "../lib/errors";
import {
  type CategoryCopyInput,
  categoryCopySchema,
} from "../validation/categories";
import { parseInput } from "../validation/shared";

// Category copy (docs/API.md §8.4, FR-205). Copy exists only for a facet value that exists
// (DM-09), so a made-up value is a 404 rather than a new, empty category.

/** Upserts the copy for a facet value; fields left out keep their current value. */
export async function updateCopy(
  ctx: ReadContext,
  kind: string,
  slug: string,
  input: CategoryCopyInput,
): Promise<void> {
  assertEditor(ctx);
  if (!isCategoryKind(kind) || !isSlug(slug)) throw new NotFoundError();
  const changes = parseInput(categoryCopySchema, input);

  await runMutation(async (tx, tags) => {
    if (!(await resolveFacet(tx, kind, slug))) throw new NotFoundError();

    const taxonomyKind = TAXONOMY_KIND[kind];
    const [current] = await tx
      .select()
      .from(taxonomyPages)
      .where(
        and(eq(taxonomyPages.kind, taxonomyKind), eq(taxonomyPages.slug, slug)),
      )
      .for("update");

    const diff = auditDiff(current ?? null, changes);
    if (Object.keys(diff).length === 0) return;

    const [row] = await tx
      .insert(taxonomyPages)
      .values({ kind: taxonomyKind, slug, ...changes })
      .onConflictDoUpdate({
        target: [taxonomyPages.kind, taxonomyPages.slug],
        set: changes,
      })
      .returning({ id: taxonomyPages.id });

    await writeAudit(tx, ctx, {
      entityType: "category",
      entityId: row?.id ?? null,
      action: current ? "update" : "create",
      diff: { kind, slug, ...diff },
    });
    tags.add(cacheTags.category(kind, slug));
    tags.add(cacheTags.categories());
  });
}
