import "server-only";

import { isIP } from "node:net";
import type { AuthedContext } from "../auth/context";
import type { Transaction } from "./client";
import { auditLog } from "./schema";

// Audit rows are written inside the mutation's transaction (FR-405, SEC-11). Personal-data
// fields are recorded by name only, never by value (DM-12, ADR-019), so an erasure leaves no
// personal data behind in the append-only log.

export type AuditAction =
  | "create"
  | "update"
  | "archive"
  | "restore"
  | "publish"
  | "unpublish"
  | "slug_change"
  | "hard_delete"
  | "erase";

export type AuditEntityType =
  | "startup"
  | "founder"
  | "investor"
  | "batch"
  | "round"
  | "category";

export async function writeAudit(
  tx: Pick<Transaction, "insert">,
  ctx: AuthedContext,
  entry: Readonly<{
    entityType: AuditEntityType;
    entityId: string | null;
    action: AuditAction;
    diff?: Record<string, unknown>;
  }>,
): Promise<void> {
  await tx.insert(auditLog).values({
    entityType: entry.entityType,
    entityId: entry.entityId,
    action: entry.action,
    actorId: ctx.actor.id,
    diff: entry.diff ?? {},
    ip: isIP(ctx.ip) ? ctx.ip : null,
  });
}

const NO_PERSONAL_FIELDS: ReadonlySet<string> = new Set();

const toJson = (value: unknown): unknown =>
  value instanceof Date ? value.toISOString() : (value ?? null);

/**
 * The fields `after` changes relative to `before` (null for a create), as
 * `{ field: { from, to } }`, or `{ field: { changed: true } }` for personal-data fields.
 * Fields absent from `after` are not compared.
 */
export function auditDiff(
  before: Readonly<Record<string, unknown>> | null,
  after: Readonly<Record<string, unknown>>,
  personalFields: ReadonlySet<string> = NO_PERSONAL_FIELDS,
): Record<string, unknown> {
  const diff: Record<string, unknown> = {};
  for (const [field, next] of Object.entries(after)) {
    if (next === undefined) continue;
    const from = toJson(before?.[field]);
    const to = toJson(next);
    if (JSON.stringify(from) === JSON.stringify(to)) continue;
    diff[field] = personalFields.has(field) ? { changed: true } : { from, to };
  }
  return diff;
}
