# ADR-0012: One git repository per project, React source as the source of truth

Status: **Accepted** (slice 2.6a, 2026-11-09). Design: `docs/architecture/slice-2.6/PROJECT_REPOSITORY_DESIGN.md`.

## Decision

- Every project has its own git repository under `REPO_ROOT/<organizationId>/<projectId>/repo` (Docker volume locally; Azure Files in Azure, pending spike S2). The working tree on `main` is shared by the team; checkpoints are commits.
- The repository is created from `@core-studio/project-template` v1 (Vite + React 19 + React Router 8 + Tailwind 4 + TypeScript). Pages are `src/pages/<folder>/<Component>.tsx`; `src/app/routes.ts` is generated from `core.project.json`. `project_pages` is a projection of the manifest.
- **Git CLI, hardened (D9):** `execFile`, fixed arguments, no system/global config, hooks disabled, symlinks off, no transport protocols, no remotes. Authors use a non-routable per-user address.
- **One writer per project:** PostgreSQL advisory transaction lock after the project row lock. A revision marker in `.git/core-revision` lets the API detect and repair a database projection that lags the repository (the repository wins).
- **Restore** creates a new commit (after an automatic safety checkpoint if there are uncommitted changes). History is never rewritten; `project_checkpoints` is append-only for the app role.
- **Path policy** on every file operation (repo-relative only, no `..`, `.git`, `node_modules`, symlinks; extension and size limits) and atomic writes.
- **Backups:** a `git bundle` per checkpoint to `BUNDLE_ROOT` (Blob upload in 2.6f) plus share snapshots in Azure.
- **Backfill:** projects created before this slice get a repository lazily on first access, built from their stored pages.

## Consequences

- The API image now contains `git` (Trivy-gated).
- Page folder names never change after creation, so renames keep history and imports stable.
- File writes happen inside the database transaction's critical section; a crash between the two is repaired on the next access.
