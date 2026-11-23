# ADR-0014: Figma-style hierarchy — projects are folders, files are design files

Status: **Accepted** (2026-11-17). Plan: [figma-style-app-plan.md](../development/figma-style-app-plan.md).

## Context

The product is organised like Figma: a team has projects, a project has files, a file has screens. Until now the entity called `project` was one design file (its own repository, screens, history). Renaming it everywhere (tables, RLS policies, API paths, 150+ tests, audit records) would be a large change with migration risk and no user value.

## Decision

- The existing `projects` table and `/api/v1/projects/*` endpoints keep their names and **mean "file"**. The UI says "file". Code comments and new contracts use `file` where they face the UI.
- A new `folders` table (`/api/v1/folders`) holds what the UI calls **Projects**. Files reference it with a nullable `folder_id`; `null` is shown as **Drafts** (shared with the team, unlike Figma's private drafts — permissions are team-wide, R8).
- **Trash** reuses the `archived` status: trashed files are read-only and restorable. Deleting a project moves its files to Trash and removes the folder; restoring such a file puts it in Drafts. Permanent deletion is deferred: checkpoints are append-only for the application role (ADR-0012), so it needs a retention job with its own privileges.
- **Duplicate** copies the source file's repository including history into a new file with a new id and pages, in the same project.
- RLS on `folders` follows the team policies of the other tables; folder names are unique per team (case-insensitive).

## Consequences

- One glossary mismatch remains in code (`project` = file); documented here and in the plan's glossary.
- `/projects/:id` links keep working; the editor moves to `/file/:id` with a redirect.
