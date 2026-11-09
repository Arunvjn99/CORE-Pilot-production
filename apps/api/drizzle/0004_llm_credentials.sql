CREATE TYPE "public"."credential_scope" AS ENUM('organization', 'user');--> statement-breakpoint
CREATE TYPE "public"."credential_status" AS ENUM('active', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."llm_provider" AS ENUM('openai', 'anthropic', 'gemini', 'azure_openai', 'ollama');--> statement-breakpoint
CREATE TABLE "llm_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"scope" "credential_scope" NOT NULL,
	"owner_user_id" uuid,
	"provider" "llm_provider" NOT NULL,
	"label" text NOT NULL,
	"endpoint" text,
	"api_version" text,
	"deployment" text,
	"status" "credential_status" DEFAULT 'active' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rotated_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"has_secret" boolean NOT NULL,
	"envelope_version" smallint,
	"ciphertext" "bytea",
	"iv" "bytea",
	"auth_tag" "bytea",
	"wrapped_dek" "bytea",
	"kek_id" text,
	"kek_version" text,
	"wrap_algorithm" text,
	"display_hint" text,
	CONSTRAINT "llm_credentials_owner_matches_scope" CHECK ((scope = 'user') = (owner_user_id is not null)),
	CONSTRAINT "llm_credentials_sealed_when_active" CHECK (status <> 'active' or not has_secret or (ciphertext is not null and iv is not null and auth_tag is not null and wrapped_dek is not null and kek_id is not null and envelope_version is not null)),
	CONSTRAINT "llm_credentials_destroyed_when_revoked" CHECK (status <> 'revoked' or (ciphertext is null and wrapped_dek is null and iv is null and auth_tag is null))
);
--> statement-breakpoint
ALTER TABLE "llm_credentials" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform_llm_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "llm_provider" NOT NULL,
	"label" text NOT NULL,
	"endpoint" text,
	"api_version" text,
	"deployment" text,
	"status" "credential_status" DEFAULT 'active' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rotated_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"has_secret" boolean NOT NULL,
	"envelope_version" smallint,
	"ciphertext" "bytea",
	"iv" "bytea",
	"auth_tag" "bytea",
	"wrapped_dek" "bytea",
	"kek_id" text,
	"kek_version" text,
	"wrap_algorithm" text,
	"display_hint" text,
	CONSTRAINT "platform_llm_credentials_sealed_when_active" CHECK (status <> 'active' or not has_secret or (ciphertext is not null and iv is not null and auth_tag is not null and wrapped_dek is not null and kek_id is not null and envelope_version is not null)),
	CONSTRAINT "platform_llm_credentials_destroyed_when_revoked" CHECK (status <> 'revoked' or (ciphertext is null and wrapped_dek is null and iv is null and auth_tag is null))
);
--> statement-breakpoint
ALTER TABLE "platform_llm_credentials" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform_llm_entitlements" (
	"credential_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"granted_by" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_llm_entitlements_credential_id_organization_id_pk" PRIMARY KEY("credential_id","organization_id")
);
--> statement-breakpoint
ALTER TABLE "platform_llm_entitlements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "allow_personal_credentials" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "llm_credentials" ADD CONSTRAINT "llm_credentials_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_credentials" ADD CONSTRAINT "llm_credentials_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_credentials" ADD CONSTRAINT "llm_credentials_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_credentials" ADD CONSTRAINT "llm_credentials_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_llm_credentials" ADD CONSTRAINT "platform_llm_credentials_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_llm_credentials" ADD CONSTRAINT "platform_llm_credentials_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_llm_entitlements" ADD CONSTRAINT "platform_llm_entitlements_credential_id_platform_llm_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."platform_llm_credentials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_llm_entitlements" ADD CONSTRAINT "platform_llm_entitlements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_llm_entitlements" ADD CONSTRAINT "platform_llm_entitlements_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "llm_credentials_org_idx" ON "llm_credentials" USING btree ("organization_id","status");--> statement-breakpoint
CREATE POLICY "llm_credentials_tenant_isolation" ON "llm_credentials" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "llm_credentials_personal_privacy" ON "llm_credentials" AS RESTRICTIVE FOR ALL TO public USING ("llm_credentials"."scope" = 'organization' or "llm_credentials"."owner_user_id" = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK ("llm_credentials"."scope" = 'organization' or "llm_credentials"."owner_user_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "platform_credentials_admin" ON "platform_llm_credentials" AS PERMISSIVE FOR ALL TO public USING (coalesce(current_setting('app.platform_admin', true), '') = 'true') WITH CHECK (coalesce(current_setting('app.platform_admin', true), '') = 'true');--> statement-breakpoint
CREATE POLICY "platform_credentials_entitled_read" ON "platform_llm_credentials" AS PERMISSIVE FOR SELECT TO public USING (exists (select 1 from platform_llm_entitlements e where e.credential_id = "platform_llm_credentials"."id" and e.organization_id = nullif(current_setting('app.organization_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "entitlements_admin" ON "platform_llm_entitlements" AS PERMISSIVE FOR ALL TO public USING (coalesce(current_setting('app.platform_admin', true), '') = 'true') WITH CHECK (coalesce(current_setting('app.platform_admin', true), '') = 'true');--> statement-breakpoint
CREATE POLICY "entitlements_team_read" ON "platform_llm_entitlements" AS PERMISSIVE FOR SELECT TO public USING ("platform_llm_entitlements"."organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);