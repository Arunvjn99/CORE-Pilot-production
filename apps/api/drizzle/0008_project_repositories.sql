CREATE TYPE "public"."checkpoint_kind" AS ENUM('create', 'manual', 'restore', 'safety');--> statement-breakpoint
CREATE TYPE "public"."repository_status" AS ENUM('initializing', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "project_checkpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"commit_sha" text NOT NULL,
	"message" text NOT NULL,
	"kind" "checkpoint_kind" NOT NULL,
	"revision" bigint NOT NULL,
	"restored_from" uuid,
	"author_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_checkpoints" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "project_repositories" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"status" "repository_status" NOT NULL,
	"template_version" text NOT NULL,
	"default_branch" text DEFAULT 'main' NOT NULL,
	"head_commit" text,
	"working_revision" bigint DEFAULT 0 NOT NULL,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_repositories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "project_pages" ADD COLUMN "file_path" text;--> statement-breakpoint
ALTER TABLE "project_checkpoints" ADD CONSTRAINT "project_checkpoints_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_checkpoints" ADD CONSTRAINT "project_checkpoints_project_fk" FOREIGN KEY ("project_id","organization_id") REFERENCES "public"."projects"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_repositories" ADD CONSTRAINT "project_repositories_project_fk" FOREIGN KEY ("project_id","organization_id") REFERENCES "public"."projects"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_checkpoints_commit_idx" ON "project_checkpoints" USING btree ("project_id","commit_sha");--> statement-breakpoint
CREATE INDEX "project_checkpoints_project_time_idx" ON "project_checkpoints" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE POLICY "project_checkpoints_tenant_isolation" ON "project_checkpoints" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "project_repositories_tenant_isolation" ON "project_repositories" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "project_repositories" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "project_checkpoints" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "project_repositories" TO core_app;--> statement-breakpoint
-- Checkpoint history is append-only for the application.
GRANT SELECT, INSERT ON "project_checkpoints" TO core_app;
