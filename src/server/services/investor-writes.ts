import "server-only";

import { eq } from "drizzle-orm";
import type { ReadContext } from "../auth/context";
import { assertEditor } from "../auth/guards";
import { auditDiff, writeAudit } from "../db/audit";
import { runMutation } from "../db/mutation";
import { investors } from "../db/schema";
import { attachMedia } from "../db/writes/media";
import { claimSlug } from "../db/writes/slugs";
import { investorTags } from "../db/writes/tags";
import { NotFoundError, UnprocessableError } from "../lib/errors";
import {
  type CreateInvestorInput,
  createInvestorSchema,
  type UpdateInvestorInput,
  updateInvestorSchema,
} from "../validation/investors";
import { isUuid, parseInput } from "../validation/shared";
import type { WriteResult } from "./startup-writes";

// Investor writes (docs/API.md §8.1, FR-204). Also the startup form's inline draft investor.

const written = {
  id: investors.id,
  slug: investors.slug,
  status: investors.status,
};

export async function create(
  ctx: ReadContext,
  input: CreateInvestorInput,
): Promise<WriteResult> {
  assertEditor(ctx);
  const { slug: requestedSlug, ...fields } = parseInput(
    createInvestorSchema,
    input,
  );

  return runMutation(async (tx, tags) => {
    const slug = await claimSlug(tx, "investor", {
      name: fields.name,
      slug: requestedSlug,
    });
    await attachMedia(
      tx,
      [{ assetId: fields.logoAssetId, purpose: "logo" }],
      new Set(),
    );

    const [row] = await tx
      .insert(investors)
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
      entityType: "investor",
      entityId: row.id,
      action: "create",
      diff: auditDiff(null, { ...fields, slug }),
    });
    for (const tag of await investorTags(tx, [row.id])) tags.add(tag);
    return row;
  });
}

export async function update(
  ctx: ReadContext,
  id: string,
  input: UpdateInvestorInput,
): Promise<WriteResult> {
  assertEditor(ctx);
  if (typeof input === "object" && input !== null && "slug" in input) {
    throw new UnprocessableError(
      "A slug changes only through the slug action, which admins use.",
    );
  }
  if (!isUuid(id)) throw new NotFoundError();
  const changes = parseInput(updateInvestorSchema, input);

  return runMutation(async (tx, tags) => {
    const [current] = await tx
      .select()
      .from(investors)
      .where(eq(investors.id, id))
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
    for (const tag of await investorTags(tx, [id])) tags.add(tag);

    const [row] = await tx
      .update(investors)
      .set({ ...changes, updatedBy: ctx.actor.id })
      .where(eq(investors.id, id))
      .returning(written);
    if (!row) throw new NotFoundError();

    await writeAudit(tx, ctx, {
      entityType: "investor",
      entityId: id,
      action: "update",
      diff,
    });
    return row;
  });
}
