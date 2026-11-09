CREATE TABLE "organization_llm_defaults" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"team_credential_id" uuid,
	"platform_credential_id" uuid,
	"model" text NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_llm_defaults_one_credential" CHECK ((team_credential_id is null) <> (platform_credential_id is null))
);
--> statement-breakpoint
ALTER TABLE "organization_llm_defaults" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "llm_credentials" ADD COLUMN "last_test_code" text;--> statement-breakpoint
ALTER TABLE "llm_credentials" ADD COLUMN "last_tested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "platform_llm_credentials" ADD COLUMN "last_test_code" text;--> statement-breakpoint
ALTER TABLE "platform_llm_credentials" ADD COLUMN "last_tested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organization_llm_defaults" ADD CONSTRAINT "organization_llm_defaults_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_llm_defaults" ADD CONSTRAINT "organization_llm_defaults_team_credential_id_llm_credentials_id_fk" FOREIGN KEY ("team_credential_id") REFERENCES "public"."llm_credentials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_llm_defaults" ADD CONSTRAINT "organization_llm_defaults_platform_credential_id_platform_llm_credentials_id_fk" FOREIGN KEY ("platform_credential_id") REFERENCES "public"."platform_llm_credentials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_llm_defaults" ADD CONSTRAINT "organization_llm_defaults_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organization_llm_defaults_platform_idx" ON "organization_llm_defaults" USING btree ("platform_credential_id");--> statement-breakpoint
CREATE POLICY "organization_llm_defaults_tenant_isolation" ON "organization_llm_defaults" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "organization_llm_defaults_platform_admin" ON "organization_llm_defaults" AS PERMISSIVE FOR ALL TO public USING (coalesce(current_setting('app.platform_admin', true), '') = 'true') WITH CHECK (coalesce(current_setting('app.platform_admin', true), '') = 'true');--> statement-breakpoint
ALTER TABLE "organization_llm_defaults" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "organization_llm_defaults" TO core_app;
