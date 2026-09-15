import "server-only";

import { eq } from "drizzle-orm";
import type { ReadContext } from "../auth/context";
import { assertEditor } from "../auth/guards";
import { auditDiff, writeAudit } from "../db/audit";
import { runMutation } from "../db/mutation";
import { batches } from "../db/schema";
import { attachMedia } from "../db/writes/media";
import { claimSlug } from "../db/writes/slugs";
import { batchTags } from "../db/writes/tags";
import { NotFoundError, UnprocessableError } from "../lib/errors";
import {
  type CreateBatchInput,
  createBatchSchema,
  type UpdateBatchInput,
  updateBatchSchema,
} from "../validation/batches";
import { isUuid, parseInput } from "../validation/shared";
import type { WriteResult } from "./startup-writes";

// Batch writes (docs/API.md §8.1). The slug is generated from program and label, e.g.
// "Parallel Accelerator W27" → "parallel-accelerator-w27", unless one is given.

const written = { id: batches.id, slug: batches.slug, status: batches.status };

export async function create(
  ctx: ReadContext,
  input: CreateBatchInput,
): Promise<WriteResult> {
  assertEditor(ctx);
  const { slug: requestedSlug, ...fields } = parseInput(
    createBatchSchema,
    input,
  );

  return runMutation(async (tx, tags) => {
    const slug = await claimSlug(tx, "batch", {
      name: `${fields.programName} ${fields.label}`,
      slug: requestedSlug,
    });
    await attachMedia(
      tx,
      [{ assetId: fields.logoAssetId, purpose: "logo" }],
      new Set(),
    );

    const [row] = await tx
      .insert(batches)
      .values({
        ...fields,
        slug,
        status: "draft",
        createdBy: ctx.actor.id,
        updatedBy: ctx.actor.id,
      })
      .returning(written);
    if (!row) throw new Error("Insert returned no row.");

    await writeAudit(tx, ctx, {
      entityType: "batch",
      entityId: row.id,
      action: "create",
      diff: auditDiff(null, { ...fields, slug }),
    });
    for (const tag of await batchTags(tx, [row.id])) tags.add(tag);
    return row;
  });
}

export async function update(
  ctx: ReadContext,
  id: string,
  input: UpdateBatchInput,
): Promise<WriteResult> {
  assertEditor(ctx);
  if (typeof input === "object" && input !== null && "slug" in input) {
    throw new UnprocessableError(
      "A slug changes only through the slug action, which admins use.",
    );
  }
  if (!isUuid(id)) throw new NotFoundError();
  const changes = parseInput(updateBatchSchema, input);

  return runMutation(async (tx, tags) => {
    const [current] = await tx
      .select()
      .from(batches)
      .where(eq(batches.id, id))
      .for("update");
    if (!current) throw new NotFoundError();

    const diff = auditDiff(current, changes);
    if (Object.keys(diff).length === 0) {
      return { id, slug: current.slug, status: current.status };
    }

    await attachMedia(
      tx,
      [{ assetId: changes.logoAssetId, purpose: "logo" }],
      new Set(current.logoAssetId ? [current.logoAssetId] : []),
    );
    for (const tag of await batchTags(tx, [id])) tags.add(tag);

    const [row] = await tx
      .update(batches)
      .set({ ...changes, updatedBy: ctx.actor.id })
      .where(eq(batches.id, id))
      .returning(written);
    if (!row) throw new NotFoundError();

    await writeAudit(tx, ctx, {
      entityType: "batch",
      entityId: id,
      action: "update",
      diff,
    });
    return row;
  });
}
