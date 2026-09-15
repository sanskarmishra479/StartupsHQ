import "server-only";

import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";

// Privacy requests (FR-210, SEC-18): access, correction, erasure and objection requests that
// arrive through the published privacy address, answered within 30 days. `notes` may hold a
// requester's contact details, so audit rows record it by name only.

export const privacyRequestTypeEnum = pgEnum("privacy_request_type", [
  "access",
  "correction",
  "erasure",
  "objection",
]);

export const privacyRequestStatusEnum = pgEnum("privacy_request_status", [
  "open",
  "completed",
  "rejected",
]);

export const privacyRequests = pgTable(
  "privacy_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestType: privacyRequestTypeEnum("request_type").notNull(),
    status: privacyRequestStatusEnum("status").notNull().default("open"),
    subjectEntityType: text("subject_entity_type").notNull(),
    /** Null when the subject is not a record, or once a founder has been erased. */
    subjectEntityId: uuid("subject_entity_id"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    /** received_at + 30 days, set by the service (timestamptz arithmetic is not immutable). */
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    notes: text("notes"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: uuid("resolved_by").references(() => users.id, {
      onDelete: "restrict",
    }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "privacy_requests_subject_entity_type",
      sql`${t.subjectEntityType} in ('founder', 'user', 'other')`,
    ),
    check(
      "privacy_requests_due_after_received",
      sql`${t.dueAt} > ${t.receivedAt}`,
    ),
    check(
      "privacy_requests_notes_length",
      sql`char_length(${t.notes}) <= 4000`,
    ),
    check(
      "privacy_requests_resolved_matches_status",
      sql`(${t.status} = 'open') = (${t.resolvedAt} is null)`,
    ),
    index("privacy_requests_status_due_at_idx").on(t.status, t.dueAt),
  ],
);
