import "server-only";

import { eq } from "drizzle-orm";
import type { ReadContext } from "../auth/context";
import { assertEditor } from "../auth/guards";
import { auditDiff, writeAudit } from "../db/audit";
import { runMutation } from "../db/mutation";
import { founders } from "../db/schema";
import { attachMedia } from "../db/writes/media";
import { claimSlug } from "../db/writes/slugs";
import { founderTags } from "../db/writes/tags";
import { NotFoundError, UnprocessableError } from "../lib/errors";
import {
  type CreateFounderInput,
  createFounderSchema,
  FOUNDER_PERSONAL_FIELDS,
  type UpdateFounderInput,
  updateFounderSchema,
} from "../validation/founders";
import { isUuid, parseInput } from "../validation/shared";
import type { WriteResult } from "./startup-writes";

// Founder writes (docs/API.md §8.1, FR-204). Also the inline "create a draft founder" of the
// startup form's picker. Personal fields reach the audit log by name only (ADR-019).

const written = {
  id: founders.id,
  slug: founders.slug,
  status: founders.status,
};

export async function create(
  ctx: ReadContext,
  input: CreateFounderInput,
): Promise<WriteResult> {
  assertEditor(ctx);
  const { slug: requestedSlug, ...fields } = parseInput(
    createFounderSchema,
    input,
  );

  return runMutation(async (tx, tags) => {
    const slug = await claimSlug(tx, "founder", {
      name: fields.fullName,
      slug: requestedSlug,
    });
    await attachMedia(
      tx,
      [{ assetId: fields.photoAssetId, purpose: "photo" }],
      new Set(),
    );

    const [row] = await tx
      .insert(founders)
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
      entityType: "founder",
      entityId: row.id,
      action: "create",
      diff: auditDiff(null, { ...fields, slug }, FOUNDER_PERSONAL_FIELDS),
    });
    for (const tag of await founderTags(tx, [row.id])) tags.add(tag);
    return row;
  });
}

export async function update(
  ctx: ReadContext,
  id: string,
  input: UpdateFounderInput,
): Promise<WriteResult> {
  assertEditor(ctx);
  if (typeof input === "object" && input !== null && "slug" in input) {
    throw new UnprocessableError(
      "A slug changes only through the slug action, which admins use.",
    );
  }
  if (!isUuid(id)) throw new NotFoundError();
  const changes = parseInput(updateFounderSchema, input);

  return runMutation(async (tx, tags) => {
    const [current] = await tx
      .select()
      .from(founders)
      .where(eq(founders.id, id))
      .for("update");
    if (!current) throw new NotFoundError();

    const diff = auditDiff(current, changes, FOUNDER_PERSONAL_FIELDS);
    if (Object.keys(diff).length === 0) {
      return { id, slug: current.slug, status: current.status };
    }

    await attachMedia(
      tx,
      [{ assetId: changes.photoAssetId, purpose: "photo" }],
      new Set(current.photoAssetId ? [current.photoAssetId] : []),
    );
    for (const tag of await founderTags(tx, [id])) tags.add(tag);

    const [row] = await tx
      .update(founders)
      .set({ ...changes, updatedBy: ctx.actor.id })
      .where(eq(founders.id, id))
      .returning(written);
    if (!row) throw new NotFoundError();

    await writeAudit(tx, ctx, {
      entityType: "founder",
      entityId: id,
      action: "update",
      diff,
    });
    return row;
  });
}
