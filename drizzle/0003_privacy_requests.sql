CREATE TYPE "public"."privacy_request_status" AS ENUM('open', 'completed', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."privacy_request_type" AS ENUM('access', 'correction', 'erasure', 'objection');--> statement-breakpoint
CREATE TABLE "privacy_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_type" "privacy_request_type" NOT NULL,
	"status" "privacy_request_status" DEFAULT 'open' NOT NULL,
	"subject_entity_type" text NOT NULL,
	"subject_entity_id" uuid,
	"received_at" timestamp with time zone NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"notes" text,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "privacy_requests_subject_entity_type" CHECK ("privacy_requests"."subject_entity_type" in ('founder', 'user', 'other')),
	CONSTRAINT "privacy_requests_due_after_received" CHECK ("privacy_requests"."due_at" > "privacy_requests"."received_at"),
	CONSTRAINT "privacy_requests_notes_length" CHECK (char_length("privacy_requests"."notes") <= 4000),
	CONSTRAINT "privacy_requests_resolved_matches_status" CHECK (("privacy_requests"."status" = 'open') = ("privacy_requests"."resolved_at" is null))
);
--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "privacy_requests_status_due_at_idx" ON "privacy_requests" USING btree ("status","due_at");