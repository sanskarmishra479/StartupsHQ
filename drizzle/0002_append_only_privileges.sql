-- audit_log and erasure_log are append-only for the app (SEC-11, FR-410).
-- Default privileges from 0000 gave the app full DML on every table; narrow these two.
REVOKE UPDATE, DELETE, TRUNCATE ON public.audit_log, public.erasure_log FROM startupshq_app;
--> statement-breakpoint

-- The retention job may change audit_log and nothing else (SEC-10, SEC-11).
GRANT SELECT, UPDATE, DELETE ON public.audit_log TO startupshq_retention;
