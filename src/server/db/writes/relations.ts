import "server-only";

import { eq } from "drizzle-orm";
import { UnprocessableError } from "../../lib/errors";
import type {
  FounderLink,
  IndustryLink,
  InvestorLink,
} from "../../validation/relations";
import type { Transaction } from "../client";
import {
  fundingRounds,
  investments,
  startupBatches,
  startupFounders,
  startupIndustries,
} from "../schema";

// Link writes shared by the relationship endpoints and nested startup creation (docs/API.md
// §8.1, §8.3). A missing founder, investor, batch or industry fails its foreign key (422); a
// duplicate link fails its unique key (409). Both roll back the whole transaction.

/** One founder stint at a startup (DM-10). Returns the link id. */
export async function insertFounderLink(
  tx: Transaction,
  startupId: string,
  link: FounderLink,
): Promise<string> {
  const isCurrent = link.isCurrent ?? link.leftYear == null;
  if (
    link.joinedYear != null &&
    link.leftYear != null &&
    link.leftYear < link.joinedYear
  ) {
    throw new UnprocessableError(
      "The year they left is before the year they joined.",
    );
  }
  if (isCurrent && link.leftYear != null) {
    throw new UnprocessableError("A current role has no year left.");
  }

  const [row] = await tx
    .insert(startupFounders)
    .values({
      startupId,
      founderId: link.founderId,
      role: link.role,
      isCurrent,
      joinedYear: link.joinedYear ?? null,
      leftYear: link.leftYear ?? null,
      sortOrder: link.sortOrder ?? 0,
      sourceUrl: link.sourceUrl ?? null,
    })
    .returning({ id: startupFounders.id });
  if (!row) throw new Error("Insert returned no row.");
  return row.id;
}

/** An investor backing a startup, optionally in one of its rounds (ADR-005). Returns the link id. */
export async function insertInvestorLink(
  tx: Transaction,
  startupId: string,
  link: InvestorLink,
): Promise<string> {
  if (link.roundId) {
    const [round] = await tx
      .select({ startupId: fundingRounds.startupId })
      .from(fundingRounds)
      .where(eq(fundingRounds.id, link.roundId));
    if (round?.startupId !== startupId) {
      throw new UnprocessableError("That round is not one of this startup's.");
    }
  }

  const [row] = await tx
    .insert(investments)
    .values({
      startupId,
      investorId: link.investorId,
      roundId: link.roundId ?? null,
      isLead: link.isLead ?? false,
      amountUsd: link.amountUsd ?? null,
    })
    .returning({ id: investments.id });
  if (!row) throw new Error("Insert returned no row.");
  return row.id;
}

export async function insertBatchLink(
  tx: Transaction,
  startupId: string,
  batchId: string,
): Promise<void> {
  await tx.insert(startupBatches).values({ startupId, batchId });
}

/** Replaces a startup's industries: at most one primary, no duplicates. */
export async function replaceIndustries(
  tx: Transaction,
  startupId: string,
  industries: readonly IndustryLink[],
): Promise<void> {
  if (industries.filter((industry) => industry.isPrimary).length > 1) {
    throw new UnprocessableError("Only one industry can be primary.");
  }
  if (
    new Set(industries.map((industry) => industry.id)).size !==
    industries.length
  ) {
    throw new UnprocessableError("An industry is listed twice.");
  }

  await tx
    .delete(startupIndustries)
    .where(eq(startupIndustries.startupId, startupId));
  if (industries.length > 0) {
    await tx.insert(startupIndustries).values(
      industries.map((industry) => ({
        startupId,
        industryId: industry.id,
        isPrimary: industry.isPrimary ?? false,
      })),
    );
  }
}
