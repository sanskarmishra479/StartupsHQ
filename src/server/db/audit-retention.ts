import "server-only";

import { sql } from "drizzle-orm";
import type { Database } from "./client";
import { auditLog } from "./schema";

// Audit retention (SEC-11). The log is append-only for the application: only the `retention`
// role may change it, which is why this runs from a scheduled job under its own credentials and
// not from any request path.
//
// Two ages, for two reasons: an IP address stops being useful long before the record of who
// changed what does, so addresses are cleared first and rows are removed later.

export const IP_RETENTION_DAYS = 90;
export const ROW_RETENTION_MONTHS = 12;

export type RetentionResult = Readonly<{
  ipsCleared: number;
  rowsDeleted: number;
}>;

export async function applyAuditRetention(
  db: Database,
  now: Date = new Date(),
): Promise<RetentionResult> {
  const ipCutoff = new Date(now);
  ipCutoff.setUTCDate(ipCutoff.getUTCDate() - IP_RETENTION_DAYS);
  const rowCutoff = new Date(now);
  rowCutoff.setUTCMonth(rowCutoff.getUTCMonth() - ROW_RETENTION_MONTHS);

  const cleared = await db.execute(sql`
    update ${auditLog}
       set ${sql.raw("ip")} = null
     where ${auditLog.ip} is not null
       and ${auditLog.createdAt} < ${ipCutoff.toISOString()}::timestamptz`);

  const deleted = await db.execute(sql`
    delete from ${auditLog}
     where ${auditLog.createdAt} < ${rowCutoff.toISOString()}::timestamptz`);

  return {
    ipsCleared: cleared.rowCount ?? 0,
    rowsDeleted: deleted.rowCount ?? 0,
  };
}
