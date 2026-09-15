import "server-only";

import { and, eq } from "drizzle-orm";
import type { ReadContext } from "../auth/context";
import { assertEditor } from "../auth/guards";
import { writeAudit } from "../db/audit";
import type { Transaction } from "../db/client";
import { runMutation, type TagSet } from "../db/mutation";
import {
  investments,
  startupBatches,
  startupFounders,
  startups,
} from "../db/schema";
import {
  insertBatchLink,
  insertFounderLink,
  insertInvestorLink,
  replaceIndustries,
} from "../db/writes/relations";
import {
  batchTags,
  founderTags,
  investorTags,
  startupTags,
} from "../db/writes/tags";
import { NotFoundError } from "../lib/errors";
import {
  type BatchLinkInput,
  batchLinkSchema,
  type FounderLinkInput,
  founderLinkSchema,
  type IndustryLinksInput,
  type InvestorLinkInput,
  industryLinksSchema,
  investorLinkSchema,
} from "../validation/relations";
import { isUuid, parseInput } from "../validation/shared";

// Links between a startup and its founders, investors, batches and industries (docs/API.md
// §8.3). Every change locks the startup, is audited on it, and expires the pages at both ends of
// the link.

async function lockStartup(tx: Transaction, startupId: string): Promise<void> {
  const [row] = await tx
    .select({ id: startups.id })
    .from(startups)
    .where(eq(startups.id, startupId))
    .for("update");
  if (!row) throw new NotFoundError();
}

function addAll(tags: TagSet, ...groups: readonly string[][]): void {
  for (const group of groups) for (const tag of group) tags.add(tag);
}

function assertIds(...ids: readonly string[]): void {
  if (!ids.every(isUuid)) throw new NotFoundError();
}

export async function addFounder(
  ctx: ReadContext,
  startupId: string,
  input: FounderLinkInput,
): Promise<{ id: string }> {
  assertEditor(ctx);
  assertIds(startupId);
  const link = parseInput(founderLinkSchema, input);

  return runMutation(async (tx, tags) => {
    await lockStartup(tx, startupId);
    const id = await insertFounderLink(tx, startupId, link);
    await writeAudit(tx, ctx, {
      entityType: "startup",
      entityId: startupId,
      action: "update",
      diff: { founders: { added: { linkId: id, ...link } } },
    });
    addAll(
      tags,
      await startupTags(tx, [startupId]),
      await founderTags(tx, [link.founderId]),
    );
    return { id };
  });
}

export async function removeFounder(
  ctx: ReadContext,
  startupId: string,
  linkId: string,
): Promise<void> {
  assertEditor(ctx);
  assertIds(startupId, linkId);

  await runMutation(async (tx, tags) => {
    await lockStartup(tx, startupId);
    addAll(tags, await startupTags(tx, [startupId]));
    const [removed] = await tx
      .delete(startupFounders)
      .where(
        and(
          eq(startupFounders.id, linkId),
          eq(startupFounders.startupId, startupId),
        ),
      )
      .returning({
        founderId: startupFounders.founderId,
        role: startupFounders.role,
        joinedYear: startupFounders.joinedYear,
      });
    if (!removed) throw new NotFoundError();

    await writeAudit(tx, ctx, {
      entityType: "startup",
      entityId: startupId,
      action: "update",
      diff: { founders: { removed: { linkId, ...removed } } },
    });
    addAll(tags, await founderTags(tx, [removed.founderId]));
  });
}

export async function addInvestor(
  ctx: ReadContext,
  startupId: string,
  input: InvestorLinkInput,
): Promise<{ id: string }> {
  assertEditor(ctx);
  assertIds(startupId);
  const link = parseInput(investorLinkSchema, input);

  return runMutation(async (tx, tags) => {
    await lockStartup(tx, startupId);
    const id = await insertInvestorLink(tx, startupId, link);
    await writeAudit(tx, ctx, {
      entityType: "startup",
      entityId: startupId,
      action: "update",
      diff: { investors: { added: { linkId: id, ...link } } },
    });
    addAll(
      tags,
      await startupTags(tx, [startupId]),
      await investorTags(tx, [link.investorId]),
    );
    return { id };
  });
}

export async function removeInvestor(
  ctx: ReadContext,
  startupId: string,
  linkId: string,
): Promise<void> {
  assertEditor(ctx);
  assertIds(startupId, linkId);

  await runMutation(async (tx, tags) => {
    await lockStartup(tx, startupId);
    addAll(tags, await startupTags(tx, [startupId]));
    const [removed] = await tx
      .delete(investments)
      .where(
        and(eq(investments.id, linkId), eq(investments.startupId, startupId)),
      )
      .returning({
        investorId: investments.investorId,
        roundId: investments.roundId,
        isLead: investments.isLead,
      });
    if (!removed) throw new NotFoundError();

    await writeAudit(tx, ctx, {
      entityType: "startup",
      entityId: startupId,
      action: "update",
      diff: { investors: { removed: { linkId, ...removed } } },
    });
    addAll(tags, await investorTags(tx, [removed.investorId]));
  });
}

export async function addBatch(
  ctx: ReadContext,
  startupId: string,
  input: BatchLinkInput,
): Promise<void> {
  assertEditor(ctx);
  assertIds(startupId);
  const { batchId } = parseInput(batchLinkSchema, input);

  await runMutation(async (tx, tags) => {
    await lockStartup(tx, startupId);
    await insertBatchLink(tx, startupId, batchId);
    await writeAudit(tx, ctx, {
      entityType: "startup",
      entityId: startupId,
      action: "update",
      diff: { batches: { added: batchId } },
    });
    addAll(
      tags,
      await startupTags(tx, [startupId]),
      await batchTags(tx, [batchId]),
    );
  });
}

export async function removeBatch(
  ctx: ReadContext,
  startupId: string,
  batchId: string,
): Promise<void> {
  assertEditor(ctx);
  assertIds(startupId, batchId);

  await runMutation(async (tx, tags) => {
    await lockStartup(tx, startupId);
    addAll(
      tags,
      await startupTags(tx, [startupId]),
      await batchTags(tx, [batchId]),
    );
    const removed = await tx
      .delete(startupBatches)
      .where(
        and(
          eq(startupBatches.startupId, startupId),
          eq(startupBatches.batchId, batchId),
        ),
      )
      .returning({ batchId: startupBatches.batchId });
    if (removed.length === 0) throw new NotFoundError();

    await writeAudit(tx, ctx, {
      entityType: "startup",
      entityId: startupId,
      action: "update",
      diff: { batches: { removed: batchId } },
    });
  });
}

/** Replaces the startup's industries (PUT). Category pages follow the directory-wide tags. */
export async function setIndustries(
  ctx: ReadContext,
  startupId: string,
  input: IndustryLinksInput,
): Promise<void> {
  assertEditor(ctx);
  assertIds(startupId);
  const { industries } = parseInput(industryLinksSchema, input);

  await runMutation(async (tx, tags) => {
    await lockStartup(tx, startupId);
    await replaceIndustries(tx, startupId, industries);
    await writeAudit(tx, ctx, {
      entityType: "startup",
      entityId: startupId,
      action: "update",
      diff: { industries: { to: industries } },
    });
    addAll(tags, await startupTags(tx, [startupId]));
  });
}
