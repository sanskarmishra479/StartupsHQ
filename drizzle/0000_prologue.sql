-- Prologue: extensions, the immutable unaccent wrapper, and database group roles.
-- Runs before any table exists (docs/SRS.md DM-13, SEC-10).

CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS unaccent;
--> statement-breakpoint

-- unaccent() is STABLE, so Postgres rejects it in generated columns and index expressions.
-- Binding the dictionary explicitly makes the result deterministic, so IMMUTABLE is safe.
CREATE OR REPLACE FUNCTION public.immutable_unaccent(input text)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  PARALLEL SAFE
  STRICT
  RETURN public.unaccent('public.unaccent'::regdictionary, input);
--> statement-breakpoint

-- Group roles hold privileges but cannot log in. Each environment creates its own LOGIN
-- users (passwords never live in git) and grants them membership in these roles.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'startupshq_app') THEN
    CREATE ROLE startupshq_app NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'startupshq_retention') THEN
    CREATE ROLE startupshq_retention NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'startupshq_backup') THEN
    CREATE ROLE startupshq_backup NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO startupshq_app, startupshq_retention, startupshq_backup;
--> statement-breakpoint

-- Every table the migrating role creates from here on gets these grants automatically.
-- The app role gets DML only, never DDL. Tighter per-table rules (e.g. audit_log is
-- insert-only for the app, and the only table the retention role may touch) are applied
-- in the migration that creates the table.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO startupshq_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO startupshq_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO startupshq_backup;
