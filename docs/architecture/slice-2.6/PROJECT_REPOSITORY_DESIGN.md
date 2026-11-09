# Project repository design

Status: **Approved 2026-11-09.** Part of [SLICE_2_6_ARCHITECTURE.md](SLICE_2_6_ARCHITECTURE.md).

## 1. Principles

1. **React source in git is the single source of truth.** PostgreSQL holds metadata, indexes and projections that can be rebuilt from the repository.
2. **One repository per project**, never shared object stores between projects or teams.
3. **Every write goes through one pipeline** in the API (path policy → lock → revision check → write → re-parse → index → revision bump). Canvas edits, the code editor and AI agents all use it.
4. **The repository never leaves the privileged zone.** Sandboxes receive copies of files, never the repository or its volume.
5. **Generated code must look hand-written.** No ids, markers or platform imports in customer source; the project builds and runs with plain `npm install && npm run dev` after export.

## 2. Storage layout

```
<REPO_ROOT>/                                   Docker volume locally; Azure Files share in Azure (spike S2)
  <organizationId>/
    <projectId>/
      repo/                                    non-bare repository, checked out on main = the shared working tree
        .git/
        …project files…
      worktrees/                               later: agent/<runId> worktrees (Phase 4)
      tmp/                                     staging for atomic writes (same filesystem)
```

- Paths are built only from server-side UUIDs. No user input is ever part of an absolute path.
- `REPO_ROOT` is mounted only into the API (and a future backup job). It is never mounted into the gateway or any sandbox.
- **Per-project single writer:** `pg_advisory_xact_lock(hashtextextended('repo:' || project_id, 0))` around every write, so multiple API replicas are safe on a shared filesystem.
- **Atomic file writes:** write to `tmp/`, `fsync`, `rename` into place.

## 3. Git usage (decision D9: hardened git CLI)

- Invoked with `execFile` (no shell), fixed argument arrays, a minimal environment and a timeout:
  - `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=/dev/null`, `HOME=/nonexistent`, `GIT_TERMINAL_PROMPT=0`
  - `-c core.hooksPath=/dev/null -c core.symlinks=false -c core.fsmonitor=false -c protocol.allow=never -c safe.directory=<path>`
- **Disabled behaviour:**
  - No remotes in 2.6. The Azure Repos sync comes later and will run as a separate job with its own credentials, never in the request path.
  - No hooks.
  - No submodules.
  - No LFS.
  - No filters: there is no `.gitattributes` honouring of drivers, because drivers would need config we never set.
- **Author identity:** `CORE Studio <noreply@…>` as committer, with the signed-in user as author (name and a non-routable email `user-<uuid>@users.core-studio.invalid`). No real email addresses are written into history.
- **Image impact:** adds the `git` package to the API image. It is covered by the Trivy gate and pinned via the Alpine package version.

Rejected: isomorphic-git (no worktrees, bundles or fsck, slower on large trees) and libgit2 bindings (native addon build in our strict-install workspace).

## 4. Generated React project (template v1)

The template is versioned in `packages/project-template`. Every project records the template version it was created from.

```
core.project.json            Manifest: schemaVersion, templateVersion, pages[{id, name, route, file}], designSystem: null
package.json                 Exact pinned versions from the allow-list (no ranges); scripts: dev, build, preview, typecheck
pnpm-lock.yaml               Copied from the template; changes only via the dependency pipeline (later)
index.html
vite.config.ts               Managed file
tsconfig.json                Managed file
public/                      Static files served as-is (favicon, robots.txt)
src/
  main.tsx                   Managed: mounts <App/>
  app/
    App.tsx                  Managed: router provider + RootLayout
    routes.ts                GENERATED from core.project.json (lazy imports per page) — never hand-edited
  layouts/
    RootLayout.tsx           User/AI-editable shared layout (header, footer, <Outlet/>)
  pages/
    home/
      HomePage.tsx           One folder per page; default export is the page component
    pricing/
      PricingPage.tsx
  components/                Shared components (user/AI); later CORE design-system wrappers live under components/core/
  styles/
    globals.css              Tailwind import + design tokens (CSS variables)
  assets/                    Images and fonts imported by components (bundled and hashed by Vite)
  lib/                       Utilities (e.g. cn())
```

### Why this structure (evaluated against canvas and AI needs)

| Requirement             | How the structure serves it                                                                                                                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Pages as routes         | `routes.ts` is generated from the manifest, so creating, renaming or deleting pages never needs AST surgery on a router file and can't drift. Lazy imports keep HMR scoped to one page                                                     |
| Visual editing (2.7)    | Each page and component is a single default-export function component in its own file, which is ideal for oid indexing and AST edits. Styling is Tailwind classes (D14), so style edits are `className` edits merged with `tailwind-merge` |
| AI generation (Phase 4) | Predictable locations (`pages/<slug>/<Name>Page.tsx`, `components/<Name>.tsx`) make prompts and validation simple; agents get a typed "create page" tool that goes through the manifest instead of writing router code                     |
| Shared layouts          | `layouts/RootLayout.tsx` wraps every route via `<Outlet/>`; per-page layout overrides are a manifest field later                                                                                                                           |
| Design system (Phase 5) | `components/core/` and token CSS variables in `globals.css` give one place to plug in the CORE package once blocker B1 clears                                                                                                              |
| Export without lock-in  | Standard Vite + React + React Router app with no runtime dependency on CORE Studio                                                                                                                                                         |

**Managed vs editable files:**

- **Managed** (`main.tsx`, `App.tsx`, `routes.ts`, `vite.config.ts`, `tsconfig.json`, `package.json` scripts): rejected by the edit pipeline and regenerated on template upgrades.
- **Editable:** everything under `layouts/`, `pages/`, `components/`, `styles/`, `lib/`, `assets/`, `public/`.

**Template stack:** the same versions the studio already runs (React 19.3, React Router 8.5, Vite 8.3, Tailwind CSS 4.3, TypeScript 5.9), so there is one set of dependencies to scan and patch.

### Pages ↔ files

| Operation                               | Repository change                                                                             | Database change                      |
| --------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------ |
| Create page "Pricing", route `/pricing` | `src/pages/pricing/PricingPage.tsx` from a page stub; manifest entry; `routes.ts` regenerated | `project_pages` row with `file_path` |
| Rename page (name only)                 | Manifest name updated; component name unchanged (renaming identifiers is a later refactor op) | `name`                               |
| Change route                            | Manifest route; `routes.ts` regenerated; file stays put                                       | `route`                              |
| Delete page                             | Folder removed; manifest entry removed; `routes.ts` regenerated                               | Row deleted                          |

- **Folder slugs:** derived from the name at creation (`pricing`, `getting-started`). Collisions get a suffix (`pricing-2`). Folder names never change afterwards, which keeps git history and imports stable.
- **Write order:** repository first (inside the advisory lock), then the database projection in the same request. A crash between the two is repaired by the **reconciler**, which rebuilds `project_pages` from `core.project.json`. The repository wins.

## 5. Revisions, checkpoints, history, restore

- **Working revision:** a monotonically increasing `bigint` in `project_repositories.working_revision`, bumped by every successful write. Clients send `baseRevision`; mismatches return `409 STALE_REVISION` with the current revision. This replaces `updatedAt` concurrency for anything that touches files.
- **Uncommitted work:** edits change the working tree and are durable immediately (on the volume). They aren't commits.
- **Checkpoint:** `POST /projects/:id/checkpoints {message}`:
  1. `git add -A` (path policy re-checked).
  2. `git commit`.
  3. Row in `project_checkpoints` with the commit SHA, author, message and revision.
  4. Audit event.
  5. Backup bundle job queued.
- **Automatic checkpoints:** taken on project creation, before and after template upgrades, and (Phase 4) before and after every agent run.
- **History:** `GET /projects/:id/checkpoints`, from the database list cross-checked against `git log`.
- **Restore** `POST /projects/:id/checkpoints/:cid/restore`:
  1. Refused if there are uncommitted changes, unless `{discardUncommitted: true}` is passed or a safety checkpoint is taken first (the default is to take one).
  2. Checks out the checkpoint's tree into the working tree.
  3. Commits "Restore to <checkpoint>".
  4. Bumps the revision, rebuilds the page projection from the manifest, and pushes a full snapshot to any running preview.

  History is never rewritten: there is no reset and no force.

- **Undo/redo (2.7):** a client command stack of inverse operations applied through the same pipeline. It is independent of checkpoints.
- **Branching:** no user-visible branches in 2.6–2.7. `main` is the only branch. Agent branches `agent/<runId>` in worktrees arrive in Phase 4, merged back by 3-way merge through the pipeline.

## 6. Repository lifecycle

```
            create project                                    archive project
 (none) ──────────────────► initializing ──ok──► ready ───────────────────────► ready (read-only: pipeline refuses writes)
                                 │                  │  ▲
                                 │ fail             │  │ restore project (status active again)
                                 ▼                  │  │
                               failed ──retry job───┘  │
                                                       │
            backfill job (projects from slice 2.5) ────┘   builds repo from DB pages, then the repo becomes the truth
```

- **Initialisation** happens inside `POST /projects`:
  1. Copy the template.
  2. Write the manifest from the requested pages ("Home").
  3. `git init -b main`.
  4. First commit.

  It is bounded to about 2 s. On failure the project row stays with `repository.status = failed`, and a retry job (in-process now, Service Bus later) re-runs it idempotently.

- **Backfill for existing projects (slice 2.5 data):** a one-off migration job creates repos for projects without a `project_repositories` row, generating one page file per existing `project_pages` row.
- **Deletion:** projects are archived, never deleted (unchanged). A future purge job deletes the directory and bundles after the retention period, with an audit record.

## 7. Backup and recovery

| Layer       | Mechanism                                                                                                                                                                                                  | RPO / RTO target                        |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Primary     | Azure Files share (ZRS) with daily share snapshots kept 30 days                                                                                                                                            | 24 h / hours (restore a share snapshot) |
| Per-project | `git bundle create --all` after every checkpoint (debounced to at most one per 5 min per project), uploaded to Blob Storage: `bundles/<org>/<project>/<timestamp>.bundle`, with versioning and soft delete | Last checkpoint / minutes per project   |
| Integrity   | Nightly `git fsck --no-dangling` and manifest ↔ database reconciliation; findings become security/ops events                                                                                               | —                                       |

- **Project restore from bundle:** `git clone <bundle>` into a fresh directory, then switch the path atomically, then run the reconciler. Uncommitted working-tree changes since the last checkpoint are covered only by share snapshots, and the UI states this.
- **Local:** the Docker volume plus a `scripts/backup-repos.sh` that bundles every project to `./backups/`. It is ignored by git.

## 8. Database changes (migration 0008)

```sql
project_repositories (
  project_id uuid PK → projects(id, organization_id) composite FK,
  organization_id uuid NOT NULL,           -- forced RLS like every team table
  status repository_status NOT NULL,       -- initializing | ready | failed
  template_version text NOT NULL,
  default_branch text NOT NULL DEFAULT 'main',
  head_commit text,                        -- last checkpoint commit
  working_revision bigint NOT NULL DEFAULT 0,
  last_error_code text,
  created_at, updated_at timestamptz
)
project_checkpoints (
  id uuid PK, project_id, organization_id (composite FK), commit_sha text NOT NULL,
  message text NOT NULL, kind checkpoint_kind NOT NULL,   -- manual | create | restore | template_upgrade | agent
  revision bigint NOT NULL, restored_from uuid NULL, author_id uuid, created_at
  UNIQUE (project_id, commit_sha)
)
project_pages + file_path text NOT NULL (backfilled), + manifest_id uuid (the id in core.project.json)
```

- **Grants:**
  - SELECT/INSERT/UPDATE on both new tables.
  - No DELETE on checkpoints (history is append-only).
- **Audit actions:** `repository.initialized`, `repository.init_failed`, `checkpoint.created`, `checkpoint.restored`, `page.*` (now with `file_path`).

## 9. API contracts (additions under `/api/v1`)

| Method     | Path                                      | Permission     | Notes                                                                                       |
| ---------- | ----------------------------------------- | -------------- | ------------------------------------------------------------------------------------------- |
| GET        | `/projects/:id/repository`                | projects:read  | `{status, templateVersion, workingRevision, headCommit, dirty}`                             |
| GET        | `/projects/:id/files?dir=src/`            | projects:read  | Directory listing (editable/managed flag per entry); path policy enforced                   |
| GET        | `/projects/:id/files/content?path=`       | projects:read  | UTF-8 text up to 512 KB, with `revision`; binary assets return metadata only                |
| GET        | `/projects/:id/code-index/:oid?revision=` | projects:read  | `{file, range, elementName, componentName, instanceOf?}`; `409` if the revision is outdated |
| GET        | `/projects/:id/checkpoints`               | projects:read  | Newest first, cursor pagination                                                             |
| POST       | `/projects/:id/checkpoints`               | projects:write | `{message}` → checkpoint                                                                    |
| POST       | `/projects/:id/checkpoints/:cid/restore`  | projects:write | `{safetyCheckpoint: true}` by default                                                       |
| (2.7) POST | `/projects/:id/edits`                     | projects:write | `{baseRevision, ops[]}` → `{revision, changedFiles, oidRemap, inverseOps}`                  |

Existing page endpoints keep their contracts. Their implementation moves to the repository pipeline and their responses gain `filePath`.

## 10. Path and content policy (enforced on every read and write)

- Repo-relative POSIX paths only, normalised. Rejected: absolute paths, `..`, `\`, NUL, control characters, `.git` anywhere, names over 255 bytes, depth over 20.
- No symlinks: `lstat` before every read and write. A symlink found in the tree is a fatal integrity error. Git is configured with `core.symlinks=false`.
- Allow-listed extensions for writes: `.tsx .ts .css .json .svg .png .jpg .jpeg .webp .gif .woff2 .md .txt .html`.
- **Limits:**
  - 512 KB per text file.
  - 5 MB per asset.
  - 50 MB per working tree.
  - 2,000 files.
- Managed files are writable only by the template/manifest generators, never by the edit pipeline.
- SVG uploads are sanitised (scripts and event handlers stripped). They render only inside the preview origin, but sanitising keeps exported apps safe.

## 11. Testing

- **Unit:** path policy (traversal, symlink, `.git`, unicode tricks), manifest ↔ routes generation, slug collisions, git argument builder (no user strings reach argv except via `--` separated paths).
- **Integration (real git, real PostgreSQL):**
  - init, create/rename/route-change/delete page;
  - checkpoint, restore with and without uncommitted changes;
  - concurrent writers (two requests, one gets `409`);
  - reconciler repair after a simulated crash between repo and database;
  - backfill of slice 2.5 projects;
  - RLS on new tables;
  - viewer read-only.
- **Recovery:** bundle create → wipe → restore → identical tree hash and checkpoint list.
- **Generated app validity:** CI builds the template plus three generated pages with `vite build` and `tsc --noEmit`. Generated code must pass the same checks a developer would run.
