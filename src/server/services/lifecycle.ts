import "server-only";

import { and, eq, sql } from "drizzle-orm";
import type { AuthedContext, ReadContext } from "../auth/context";
import { assertAdmin, assertEditor } from "../auth/guards";
import { writeAudit } from "../db/audit";
import type { Transaction } from "../db/client";
import { recomputeStartupDerived } from "../db/derived";
import { runMutation } from "../db/mutation";
import {
  batches,
  founders,
  fundingRounds,
  investors,
  slugRedirects,
  startups,
} from "../db/schema";
import {
  batchTags,
  founderTags,
  investorTags,
  roundTags,
  startupTags,
} from "../db/writes/tags";
import { NotFoundError, UnprocessableError } from "../lib/errors";
import { isUuid } from "../validation/shared";

// Publish, unpublish, archive, restore and hard delete for the five editorial entities
// (docs/API.md §8.1, FR-407). Deleting is archiving; hard delete is admin-only and only for a
// record that was never published, because a published one may already be linked or indexed.

export const LIFECYCLE_ENTITIES = [
  "startup",
  "founder",
  "investor",
  "batch",
  "round",
] as const;
export type LifecycleEntity = (typeof LIFECYCLE_ENTITIES)[number];

type Status = "draft" | "published" | "archived";
export type LifecycleResult = Readonly<{ id: string; status: Status }>;

// Every entity table is built from entityColumns(); the cast only unifies the TypeScript types
// of those shared columns. Generated SQL always names the real table.
type EntityTable = typeof batches;

const ENTITIES: Record<
  LifecycleEntity,
  {
    table: EntityTable;
    tags: (tx: Transaction, id: string) => Promise<string[]>;
  }
> = {
  startup: {
    table: startups as unknown as EntityTable,
    tags: (tx, id) => startupTags(tx, [id]),
  },
  founder: {
    table: founders as unknown as EntityTable,
    tags: (tx, id) => founderTags(tx, [id]),
  },
  investor: {
    table: investors as unknown as EntityTable,
    tags: (tx, id) => investorTags(tx, [id]),
  },
  batch: { table: batches, tags: (tx, id) => batchTags(tx, [id]) },
  round: {
    table: fundingRounds as unknown as EntityTable,
    tags: (tx, id) => roundTags(tx, [id]),
  },
};

function entityFor(entity: string) {
  if (!(LIFECYCLE_ENTITIES as readonly string[]).includes(entity)) {
    throw new NotFoundError();
  }
  return {
    name: entity as LifecycleEntity,
    ...ENTITIES[entity as LifecycleEntity],
  };
}

type Transition = "publish" | "unpublish" | "archive" | "restore";

const TRANSITIONS: Record<
  Transition,
  { from: readonly Status[]; to: Status; pastTense: string }
> = {
  publish: { from: ["draft"], to: "published", pastTense: "published" },
  unpublish: { from: ["published"], to: "draft", pastTense: "unpublished" },
  archive: {
    from: ["draft", "published"],
    to: "archived",
    pastTense: "archived",
  },
  restore: { from: ["archived"], to: "draft", pastTense: "restored" },
};

/** Fields a public page needs (docs/API.md §8.1: name, slug, tagline, location for startups). */
async function missingForPublish(
  tx: Transaction,
  entity: LifecycleEntity,
  id: string,
): Promise<string[]> {
  if (entity !== "startup") return [];
  const [row] = await tx
    .select({ tagline: startups.tagline, locationId: startups.locationId })
    .from(startups)
    .where(eq(startups.id, id));
  return [
    row?.tagline ? null : "a tagline",
    row?.locationId ? null : "a location",
  ].filter((field): field is string => field !== null);
}

/** A round's status decides whether it counts toward its startup's totals (FR-404). */
async function roundStartupId(
  tx: Transaction,
  entity: LifecycleEntity,
  id: string,
): Promise<string | null> {
  if (entity !== "round") return null;
  const [row] = await tx
    .select({ startupId: fundingRounds.startupId })
    .from(fundingRounds)
    .where(eq(fundingRounds.id, id));
  return row?.startupId ?? null;
}

async function transition(
  ctx: AuthedContext,
  entityName: string,
  id: string,
  action: Transition,
): Promise<LifecycleResult> {
  const entity = entityFor(entityName);
  if (!isUuid(id)) throw new NotFoundError();
  const rule = TRANSITIONS[action];
  const { table } = entity;

  return runMutation(async (tx, tags) => {
    const [row] = await tx
      .select({ status: table.status })
      .from(table)
      .where(eq(table.id, id))
      .for("update");
    if (!row) throw new NotFoundError();
    if (!rule.from.includes(row.status)) {
      throw new UnprocessableError(
        `A ${row.status} ${entity.name} cannot be ${rule.pastTense}.`,
      );
    }
    if (action === "publish") {
      const missing = await missingForPublish(tx, entity.name, id);
      if (missing.length > 0) {
        throw new UnprocessableError(
          `Add ${missing.join(" and ")} before publishing.`,
        );
      }
    }

    for (const tag of await entity.tags(tx, id)) tags.add(tag);
    await tx
      .update(table)
      .set({
        status: rule.to,
        updatedBy: ctx.actor.id,
        archivedAt: rule.to === "archived" ? sql`now()` : null,
        // Set once: republishing keeps the original first-publication time.
        ...(action === "publish"
          ? {
              firstPublishedAt: sql`coalesce(${table.firstPublishedAt}, now())`,
            }
          : {}),
      })
      .where(eq(table.id, id));

    const startupId = await roundStartupId(tx, entity.name, id);
    if (startupId) await recomputeStartupDerived(tx, [startupId]);

    await writeAudit(tx, ctx, {
      entityType: entity.name,
      entityId: id,
      action,
      diff: { status: { from: row.status, to: rule.to } },
    });
    return { id, status: rule.to };
  });
}

export async function publish(
  ctx: ReadContext,
  entity: string,
  id: string,
): Promise<LifecycleResult> {
  assertEditor(ctx);
  return transition(ctx, entity, id, "publish");
}

export async function unpublish(
  ctx: ReadContext,
  entity: string,
  id: string,
): Promise<LifecycleResult> {
  assertEditor(ctx);
  return transition(ctx, entity, id, "unpublish");
}

/** DELETE on an entity (FR-407): hidden publicly, restorable. */
export async function archive(
  ctx: ReadContext,
  entity: string,
  id: string,
): Promise<LifecycleResult> {
  assertEditor(ctx);
  return transition(ctx, entity, id, "archive");
}

/** Archived → draft. Publishing again is a separate, deliberate step. */
export async function restore(
  ctx: ReadContext,
  entity: string,
  id: string,
): Promise<LifecycleResult> {
  assertEditor(ctx);
  return transition(ctx, entity, id, "restore");
}

/** Admin only, and only for a record that was never published. Cascades a startup's rounds and links. */
export async function hardDelete(
  ctx: ReadContext,
  entityName: string,
  id: string,
): Promise<void> {
  assertAdmin(ctx);
  const entity = entityFor(entityName);
  if (!isUuid(id)) throw new NotFoundError();
  const { table } = entity;

  await runMutation(async (tx, tags) => {
    const [row] = await tx
      .select({ firstPublishedAt: table.firstPublishedAt })
      .from(table)
      .where(eq(table.id, id))
      .for("update");
    if (!row) throw new NotFoundError();
    if (row.firstPublishedAt !== null) {
      throw new UnprocessableError(
        "This record has been published, so it can only be archived.",
      );
    }

    for (const tag of await entity.tags(tx, id)) tags.add(tag);
    const startupId = await roundStartupId(tx, entity.name, id);
    await tx.delete(table).where(eq(table.id, id));
    if (entity.name !== "round") {
      await tx
        .delete(slugRedirects)
        .where(
          and(
            eq(slugRedirects.entityType, entity.name),
            eq(slugRedirects.entityId, id),
          ),
        );
    }
    if (startupId) await recomputeStartupDerived(tx, [startupId]);

    await writeAudit(tx, ctx, {
      entityType: entity.name,
      entityId: id,
      action: "hard_delete",
    });
  });
}
