CREATE TYPE "public"."project_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TABLE "project_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"route" text NOT NULL,
	"position" integer NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_pages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" "project_status" DEFAULT 'active' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_opened_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "projects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "project_pages" ADD CONSTRAINT "project_pages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_pages" ADD CONSTRAINT "project_pages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_pages" ADD CONSTRAINT "project_pages_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_pages_route_idx" ON "project_pages" USING btree ("project_id","route");--> statement-breakpoint
CREATE INDEX "project_pages_project_idx" ON "project_pages" USING btree ("project_id","position");--> statement-breakpoint
CREATE INDEX "projects_org_status_idx" ON "projects" USING btree ("organization_id","status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_org_active_name_idx" ON "projects" USING btree ("organization_id",lower("name")) WHERE "projects"."status" = 'active';--> statement-breakpoint
CREATE POLICY "project_pages_tenant_isolation" ON "project_pages" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "projects_tenant_isolation" ON "projects" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "projects" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "project_pages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- Projects are archived, never deleted by the app; pages can be deleted.
GRANT SELECT, INSERT, UPDATE ON "projects" TO core_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "project_pages" TO core_app;--> statement-breakpoint
-- A page must belong to a project of the same team (defence in depth beyond RLS).
CREATE UNIQUE INDEX "projects_id_org_idx" ON "projects" ("id", "organization_id");--> statement-breakpoint
ALTER TABLE "project_pages" ADD CONSTRAINT "project_pages_project_same_org_fk" FOREIGN KEY ("project_id", "organization_id") REFERENCES "projects"("id", "organization_id") ON DELETE cascade;
