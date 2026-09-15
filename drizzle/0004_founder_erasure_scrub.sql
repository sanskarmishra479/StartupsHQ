-- Founder erasure (FR-410, ADR-019). audit_log is append-only for the app role (0002), so the
-- one sanctioned rewrite goes through this function, which is narrow on purpose:
--   * it redacts audit rows about a single founder and nothing else;
--   * it refuses while that founder still exists, so it can only run inside an erasure, after
--     the founder row has been deleted in the same transaction;
--   * SECURITY DEFINER runs as the migration owner, so search_path is pinned and every object
--     is schema-qualified: nothing in another schema can be substituted.
CREATE FUNCTION public.scrub_founder_audit(p_founder_id uuid)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  scrubbed integer;
BEGIN
  IF p_founder_id IS NULL THEN
    RAISE EXCEPTION 'scrub_founder_audit: a founder id is required';
  END IF;
  IF EXISTS (SELECT 1 FROM public.founders WHERE id = p_founder_id) THEN
    RAISE EXCEPTION 'scrub_founder_audit: the founder still exists';
  END IF;

  -- Rows about the founder, and rows on other entities whose diff mentions them (link changes).
  UPDATE public.audit_log
  SET diff = '{"scrubbed": true}'::jsonb,
      ip = NULL,
      entity_id = CASE WHEN entity_type = 'founder' THEN NULL ELSE entity_id END
  WHERE (entity_type = 'founder' AND entity_id = p_founder_id)
     OR strpos(diff::text, p_founder_id::text) > 0;

  GET DIAGNOSTICS scrubbed = ROW_COUNT;
  RETURN scrubbed;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.scrub_founder_audit(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.scrub_founder_audit(uuid) TO startupshq_app;
