ALTER TABLE "organization_memberships" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- Users: company directory. Runtime role may read, never write directly.
GRANT SELECT ON "users" TO core_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "organization_memberships" TO core_app;--> statement-breakpoint
-- Security events are append-only and not readable by the runtime role.
GRANT INSERT ON "security_events" TO core_app;--> statement-breakpoint
GRANT DELETE ON "organizations" TO core_app;--> statement-breakpoint
-- The only write path for users. Runs with the migration owner's rights; inputs are typed, and
-- platform admin can only ever be granted here (from the deployment's bootstrap list), never revoked.
CREATE FUNCTION auth_upsert_user(
  p_tenant_id uuid,
  p_object_id uuid,
  p_email text,
  p_display_name text,
  p_grant_platform_admin boolean
) RETURNS TABLE (id uuid, platform_role platform_role)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
BEGIN
  IF p_tenant_id IS NULL OR p_object_id IS NULL OR coalesce(length(p_display_name), 0) = 0 THEN
    RAISE EXCEPTION 'invalid identity';
  END IF;
  RETURN QUERY
  INSERT INTO users AS u (entra_tenant_id, entra_object_id, email, display_name, platform_role, last_sign_in_at)
  VALUES (
    p_tenant_id, p_object_id, left(p_email, 320), left(p_display_name, 200),
    CASE WHEN p_grant_platform_admin THEN 'platform_admin'::platform_role ELSE 'none'::platform_role END,
    now()
  )
  ON CONFLICT (entra_tenant_id, entra_object_id) DO UPDATE SET
    email = EXCLUDED.email,
    display_name = EXCLUDED.display_name,
    last_sign_in_at = now(),
    platform_role = CASE WHEN p_grant_platform_admin THEN 'platform_admin'::platform_role ELSE u.platform_role END
  RETURNING u.id, u.platform_role;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_upsert_user(uuid, uuid, text, text, boolean) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth_upsert_user(uuid, uuid, text, text, boolean) TO core_app;
