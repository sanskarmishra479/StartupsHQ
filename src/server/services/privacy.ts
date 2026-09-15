import "server-only";

import { createHash } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { ReadContext } from "../auth/context";
import { assertAdmin } from "../auth/guards";
import { auditDiff, writeAudit } from "../db/audit";
import { getDb } from "../db/client";
import { runMutation } from "../db/mutation";
import {
  erasureLog,
  founders,
  mediaAssets,
  privacyRequests,
  slugRedirects,
} from "../db/schema";
import { founderTags } from "../db/writes/tags";
import { NotFoundError, UnprocessableError } from "../lib/errors";
import {
  type EraseFounderInput,
  eraseFounderSchema,
  type PrivacyRequestInput,
  privacyRequestSchema,
  type ResolvePrivacyRequestInput,
  resolvePrivacyRequestSchema,
} from "../validation/privacy";
import { isUuid, parseInput } from "../validation/shared";

// Privacy requests and founder erasure (docs/API.md §8.9, FR-210, FR-410, SEC-18). Admin only.
// Requests are answered within 30 days. Erasure is irreversible: it removes the founder, their
// links and redirects, queues their images for deletion, redacts audit rows about them through
// the one sanctioned audit rewrite (migration 0004), and keeps only a hash as proof.

const RESPONSE_DAYS = 30;
const DAY_MS = 86_400_000;

/** Request notes may hold a requester's contact details. */
const PERSONAL_FIELDS: ReadonlySet<string> = new Set(["notes"]);

export type PrivacyRequest = Readonly<{
  id: string;
  requestType: "access" | "correction" | "erasure" | "objection";
  status: "open" | "completed" | "rejected";
  subjectEntityType: string;
  subjectEntityId: string | null;
  receivedAt: string;
  dueAt: string;
  notes: string | null;
  resolvedAt: string | null;
}>;

function toPrivacyRequest(
  row: typeof privacyRequests.$inferSelect,
): PrivacyRequest {
  return {
    id: row.id,
    requestType: row.requestType,
    status: row.status,
    subjectEntityType: row.subjectEntityType,
    subjectEntityId: row.subjectEntityId,
    receivedAt: row.receivedAt.toISOString(),
    dueAt: row.dueAt.toISOString(),
    notes: row.notes,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
  };
}

export async function recordRequest(
  ctx: ReadContext,
  input: PrivacyRequestInput,
): Promise<PrivacyRequest> {
  assertAdmin(ctx);
  const data = parseInput(privacyRequestSchema, input);
  const receivedAt = new Date(data.receivedAt);
  // A few minutes of clock skew is tolerated; a request from the future is a typo.
  if (receivedAt.getTime() > Date.now() + 5 * 60_000) {
    throw new UnprocessableError("A request cannot be received in the future.");
  }

  return runMutation(async (tx) => {
    const values = {
      requestType: data.requestType,
      subjectEntityType: data.subjectEntityType,
      subjectEntityId: data.subjectEntityId ?? null,
      receivedAt,
      dueAt: new Date(receivedAt.getTime() + RESPONSE_DAYS * DAY_MS),
      notes: data.notes ?? null,
    };
    const [row] = await tx
      .insert(privacyRequests)
      .values({ ...values, createdBy: ctx.actor.id })
      .returning();
    if (!row) throw new Error("Insert returned no row.");

    await writeAudit(tx, ctx, {
      entityType: "privacy_request",
      entityId: row.id,
      action: "create",
      diff: auditDiff(null, values, PERSONAL_FIELDS),
    });
    return toPrivacyRequest(row);
  });
}

/** Every request, earliest due first. */
export async function listRequests(
  ctx: ReadContext,
  filter: Readonly<{ status?: PrivacyRequest["status"] }> = {},
): Promise<PrivacyRequest[]> {
  assertAdmin(ctx);
  const rows = await getDb()
    .select()
    .from(privacyRequests)
    .where(
      filter.status ? eq(privacyRequests.status, filter.status) : undefined,
    )
    .orderBy(asc(privacyRequests.dueAt), asc(privacyRequests.id))
    .limit(500);
  return rows.map(toPrivacyRequest);
}

export async function resolveRequest(
  ctx: ReadContext,
  id: string,
  input: ResolvePrivacyRequestInput,
): Promise<PrivacyRequest> {
  assertAdmin(ctx);
  if (!isUuid(id)) throw new NotFoundError();
  const data = parseInput(resolvePrivacyRequestSchema, input);

  return runMutation(async (tx) => {
    const [current] = await tx
      .select()
      .from(privacyRequests)
      .where(eq(privacyRequests.id, id))
      .for("update");
    if (!current) throw new NotFoundError();
    if (current.status !== "open") {
      throw new UnprocessableError("This request has already been resolved.");
    }

    const changes = {
      status: data.status,
      ...(data.notes !== undefined ? { notes: data.notes } : {}),
    };
    const [row] = await tx
      .update(privacyRequests)
      .set({
        ...changes,
        resolvedAt: sql`now()`,
        resolvedBy: ctx.actor.id,
      })
      .where(eq(privacyRequests.id, id))
      .returning();
    if (!row) throw new NotFoundError();

    await writeAudit(tx, ctx, {
      entityType: "privacy_request",
      entityId: id,
      action: "update",
      diff: auditDiff(current, changes, PERSONAL_FIELDS),
    });
    return toPrivacyRequest(row);
  });
}

/**
 * Erases a founder (FR-410). The confirmation must read `ERASE <founder-slug>` exactly. Returns
 * how many audit rows were redacted.
 */
export async function eraseFounder(
  ctx: ReadContext,
  founderId: string,
  input: EraseFounderInput,
): Promise<{ scrubbedAuditRows: number }> {
  assertAdmin(ctx);
  if (!isUuid(founderId)) throw new NotFoundError();
  const { confirm } = parseInput(eraseFounderSchema, input);

  return runMutation(async (tx, tags) => {
    const [founder] = await tx
      .select({
        slug: founders.slug,
        photoAssetId: founders.photoAssetId,
        ogAssetId: founders.ogAssetId,
      })
      .from(founders)
      .where(eq(founders.id, founderId))
      .for("update");
    if (!founder) throw new NotFoundError();
    if (confirm !== `ERASE ${founder.slug}`) {
      throw new UnprocessableError(
        "Type ERASE followed by the founder's slug to confirm.",
      );
    }

    // Collected first: once the founder and their links are gone, their pages cannot be found.
    for (const tag of await founderTags(tx, [founderId])) tags.add(tag);

    // Cascades their stints (startup_founders).
    await tx.delete(founders).where(eq(founders.id, founderId));
    await tx
      .delete(slugRedirects)
      .where(
        and(
          eq(slugRedirects.entityType, "founder"),
          eq(slugRedirects.entityId, founderId),
        ),
      );
    await tx
      .update(privacyRequests)
      .set({ subjectEntityId: null })
      .where(
        and(
          eq(privacyRequests.subjectEntityType, "founder"),
          eq(privacyRequests.subjectEntityId, founderId),
        ),
      );

    // Back to staging and past the 24-hour window, so the next media GC run deletes the files.
    const assetIds = [founder.photoAssetId, founder.ogAssetId].filter(
      (assetId): assetId is string => assetId !== null,
    );
    if (assetIds.length > 0) {
      await tx
        .update(mediaAssets)
        .set({
          state: "staging",
          attachedAt: null,
          createdAt: sql`now() - interval '25 hours'`,
        })
        .where(inArray(mediaAssets.id, assetIds));
    }

    const { rows } = await tx.execute<{ scrubbed: number }>(
      sql`select public.scrub_founder_audit(${founderId}::uuid) as scrubbed`,
    );

    await tx.insert(erasureLog).values({
      entityType: "founder",
      entityIdHash: createHash("sha256").update(founderId).digest("hex"),
      actorId: ctx.actor.id,
    });
    // The erasure itself is audited without naming the founder.
    await writeAudit(tx, ctx, {
      entityType: "founder",
      entityId: null,
      action: "erase",
    });

    return { scrubbedAuditRows: rows[0]?.scrubbed ?? 0 };
  });
}
