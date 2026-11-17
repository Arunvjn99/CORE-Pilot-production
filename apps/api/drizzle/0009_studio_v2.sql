CREATE TYPE "public"."run_status" AS ENUM('running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TABLE "agent_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"agent_key" text NOT NULL,
	"version" integer NOT NULL,
	"instructions" text NOT NULL,
	"model" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_definitions_key" CHECK (agent_key in ('orchestrator','ux','ui','reviewer')),
	CONSTRAINT "agent_definitions_version_positive" CHECK (version > 0)
);
--> statement-breakpoint
ALTER TABLE "agent_definitions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "design_system_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"version" integer NOT NULL,
	"name" text NOT NULL,
	"design_md" text NOT NULL,
	"tokens_css" text NOT NULL,
	"custom" boolean NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "design_system_versions_version_positive" CHECK (version > 0)
);
--> statement-breakpoint
ALTER TABLE "design_system_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "generation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"status" "run_status" DEFAULT 'running' NOT NULL,
	"prompt" text NOT NULL,
	"title" text,
	"error_code" text,
	"provider" text,
	"agent_versions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"design_system" jsonb,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"screens" integer DEFAULT 0 NOT NULL,
	"review_score" integer,
	"review" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"traced" boolean DEFAULT false NOT NULL,
	"checkpoint_id" uuid,
	"started_by" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "generation_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "run_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"agent_key" text NOT NULL,
	"label" text NOT NULL,
	"status" "run_status" NOT NULL,
	"model" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "run_steps" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "design_system_slug" text;--> statement-breakpoint
ALTER TABLE "agent_definitions" ADD CONSTRAINT "agent_definitions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_definitions" ADD CONSTRAINT "agent_definitions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_system_versions" ADD CONSTRAINT "design_system_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_system_versions" ADD CONSTRAINT "design_system_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_runs" ADD CONSTRAINT "generation_runs_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_runs" ADD CONSTRAINT "generation_runs_project_fk" FOREIGN KEY ("project_id","organization_id") REFERENCES "public"."projects"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_steps" ADD CONSTRAINT "run_steps_run_id_generation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."generation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_definitions_version_idx" ON "agent_definitions" USING btree ("organization_id","agent_key","version");--> statement-breakpoint
CREATE UNIQUE INDEX "design_system_versions_idx" ON "design_system_versions" USING btree ("organization_id","slug","version");--> statement-breakpoint
CREATE INDEX "generation_runs_org_time_idx" ON "generation_runs" USING btree ("organization_id","started_at");--> statement-breakpoint
CREATE INDEX "generation_runs_project_time_idx" ON "generation_runs" USING btree ("project_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "run_steps_seq_idx" ON "run_steps" USING btree ("run_id","seq");--> statement-breakpoint
CREATE INDEX "run_steps_org_time_idx" ON "run_steps" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE POLICY "agent_definitions_tenant_isolation" ON "agent_definitions" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "design_system_versions_tenant_isolation" ON "design_system_versions" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "generation_runs_tenant_isolation" ON "generation_runs" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "run_steps_tenant_isolation" ON "run_steps" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "agent_definitions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "design_system_versions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "generation_runs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "run_steps" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- Version history is append-only for the app (edits and reverts create new versions).
GRANT SELECT, INSERT ON "agent_definitions" TO core_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "design_system_versions" TO core_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "generation_runs" TO core_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "run_steps" TO core_app;--> statement-breakpoint
GRANT UPDATE ("design_system_slug") ON "projects" TO core_app;
