CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"page_id" uuid,
	"x" real,
	"y" real,
	"parent_id" uuid,
	"body" text NOT NULL,
	"author_id" uuid,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"edited" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comments_body_length" CHECK (char_length(body) between 1 and 4000),
	CONSTRAINT "comments_position" CHECK ((x is null) = (y is null) and (x is null or (x between 0 and 1 and y between 0 and 1))),
	CONSTRAINT "comments_reply_shape" CHECK (parent_id is null or (page_id is null and x is null and resolved_at is null and resolved_by is null))
);
--> statement-breakpoint
ALTER TABLE "comments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_page_id_project_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."project_pages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_project_fk" FOREIGN KEY ("project_id","organization_id") REFERENCES "public"."projects"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comments_project_time_idx" ON "comments" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "comments_parent_idx" ON "comments" USING btree ("parent_id");--> statement-breakpoint
CREATE POLICY "comments_tenant_isolation" ON "comments" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "comments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- Defence in depth: FK checks bypass RLS, so a pin may only reference a screen of the same file and a
-- reply only a thread of the same file.
CREATE UNIQUE INDEX "project_pages_project_id_id_idx" ON "project_pages" USING btree ("project_id","id");--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_page_same_file_fk" FOREIGN KEY ("project_id","page_id") REFERENCES "public"."project_pages"("project_id","id") ON DELETE SET NULL ("page_id");--> statement-breakpoint
CREATE UNIQUE INDEX "comments_project_id_id_idx" ON "comments" USING btree ("project_id","id");--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_parent_same_file_fk" FOREIGN KEY ("project_id","parent_id") REFERENCES "public"."comments"("project_id","id") ON DELETE cascade;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "comments" TO core_app;--> statement-breakpoint
-- Delete forever from Trash. Checkpoints are append-only for core_app (ADR-0012), so permanent
-- deletion runs with the migration owner's rights, but only for a file that is in Trash and belongs
-- to the team in the transaction's RLS context. Returns 'deleted', 'not_found' or 'not_in_trash'.
-- Audit events are not touched. The repository directory is removed by the API after commit.
CREATE FUNCTION purge_trashed_project(p_project uuid) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org uuid := nullif(current_setting('app.organization_id', true), '')::uuid;
  v_status project_status;
BEGIN
  IF v_org IS NULL OR p_project IS NULL THEN
    RAISE EXCEPTION 'purge_trashed_project requires a team context';
  END IF;
  SELECT p.status INTO v_status FROM projects p
    WHERE p.id = p_project AND p.organization_id = v_org
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;
  IF v_status <> 'archived' THEN
    RETURN 'not_in_trash';
  END IF;
  DELETE FROM comments WHERE project_id = p_project AND organization_id = v_org;
  DELETE FROM run_steps WHERE organization_id = v_org
    AND run_id IN (SELECT r.id FROM generation_runs r WHERE r.project_id = p_project AND r.organization_id = v_org);
  DELETE FROM generation_runs WHERE project_id = p_project AND organization_id = v_org;
  DELETE FROM project_checkpoints WHERE project_id = p_project AND organization_id = v_org;
  DELETE FROM project_repositories WHERE project_id = p_project AND organization_id = v_org;
  DELETE FROM project_pages WHERE project_id = p_project AND organization_id = v_org;
  DELETE FROM projects WHERE id = p_project AND organization_id = v_org;
  RETURN 'deleted';
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION purge_trashed_project(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION purge_trashed_project(uuid) TO core_app;
