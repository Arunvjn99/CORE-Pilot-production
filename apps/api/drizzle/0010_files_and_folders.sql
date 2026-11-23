CREATE TABLE "folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "folders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "folder_id" uuid;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "folders_org_name_idx" ON "folders" USING btree ("organization_id",lower("name"));--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "projects_org_folder_idx" ON "projects" USING btree ("organization_id","folder_id");--> statement-breakpoint
CREATE POLICY "folders_tenant_isolation" ON "folders" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
-- Defence in depth (ADR-0014): FK checks bypass RLS, so a file may only reference a folder of its own team.
CREATE UNIQUE INDEX "folders_org_id_idx" ON "folders" USING btree ("organization_id","id");--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_folder_same_team_fk" FOREIGN KEY ("organization_id","folder_id") REFERENCES "public"."folders"("organization_id","id") ON DELETE SET NULL ("folder_id");--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "folders" TO core_app;
