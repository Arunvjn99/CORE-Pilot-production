CREATE TYPE "public"."membership_role" AS ENUM('org_owner', 'org_admin', 'designer', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."platform_role" AS ENUM('none', 'platform_admin');--> statement-breakpoint
CREATE TABLE "organization_memberships" (
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "membership_role" NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_memberships_organization_id_user_id_pk" PRIMARY KEY("organization_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "organization_memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "security_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" text NOT NULL,
	"outcome" text NOT NULL,
	"user_id" uuid,
	"correlation_id" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entra_tenant_id" uuid NOT NULL,
	"entra_object_id" uuid NOT NULL,
	"email" text,
	"display_name" text NOT NULL,
	"platform_role" "platform_role" DEFAULT 'none' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_sign_in_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organization_memberships_user_idx" ON "organization_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "security_events_time_idx" ON "security_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_entra_identity_idx" ON "users" USING btree ("entra_tenant_id","entra_object_id");--> statement-breakpoint
CREATE POLICY "organizations_member_read" ON "organizations" AS PERMISSIVE FOR SELECT TO public USING (exists (select 1 from organization_memberships m where m.organization_id = "organizations"."id" and m.user_id = nullif(current_setting('app.user_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "organizations_platform_admin" ON "organizations" AS PERMISSIVE FOR ALL TO public USING (coalesce(current_setting('app.platform_admin', true), '') = 'true') WITH CHECK (coalesce(current_setting('app.platform_admin', true), '') = 'true');--> statement-breakpoint
CREATE POLICY "memberships_active_org" ON "organization_memberships" AS PERMISSIVE FOR ALL TO public USING ("organization_memberships"."organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK ("organization_memberships"."organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "memberships_self_read" ON "organization_memberships" AS PERMISSIVE FOR SELECT TO public USING ("organization_memberships"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "memberships_platform_admin" ON "organization_memberships" AS PERMISSIVE FOR ALL TO public USING (coalesce(current_setting('app.platform_admin', true), '') = 'true') WITH CHECK (coalesce(current_setting('app.platform_admin', true), '') = 'true');