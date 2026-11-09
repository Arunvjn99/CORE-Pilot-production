-- RLS also applies to the table owner, so a misconfigured connection cannot bypass tenant policies.
ALTER TABLE "organizations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- The runtime role (core_app) is provisioned by infrastructure (compose init script / Bicep), never by the app.
-- It is a non-owner, NOBYPASSRLS role with least privilege. audit_events is append-only for it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'core_app') THEN
    RAISE EXCEPTION 'Database role core_app must be provisioned before migrations run';
  END IF;
END $$;--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO core_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "organizations" TO core_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "audit_events" TO core_app;
