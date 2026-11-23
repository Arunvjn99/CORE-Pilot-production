# Changelog

## [Unreleased] — Studio v2 (re-baseline, in progress)

### 2026-11-23 · Verify checks; live thumbnails; plan to-dos

- **Verify tab:** Run checks / Check all screens runs axe-core (WCAG 2.2 AA) and design-system checks (hard-coded colours, palette colours, small text, small touch targets, missing alt) inside the preview; issues grouped by severity, click to select the element. Protocol: `verify` / `verifyResult`.
- Live first-screen thumbnails on file cards; planner to-dos in the AI timeline.

### 2026-11-23 · V7 — prototype triggers, back and transitions

- **Prototype tab:** Trigger (on click, on hover, after delay with milliseconds), Action (navigate to a screen, or **Back**), Transition (instant, dissolve). Stored as source attributes `data-link`, `data-trigger`, `data-delay`, `data-transition`, validated in the contract and API (routes or `back` only; known triggers; 0–30 000 ms).
- **Present mode** follows hover and delay triggers, keeps a back-stack, and fades on dissolve (none with reduced motion). **Exported apps** behave the same (project template root layout).
- **Fix:** after an edit the preview now re-sends the selected element once its DOM settles, so the Design and Prototype panels show the element's current source (previously they could show stale values).
- Tests: integration **174/174** (V7 cases added), web unit **134**, preview **4**; E2E sets a hover trigger and follows it in Present mode.

### 2026-11-23 · F4 — layers tree and assets

- **Layers:** the selected screen's element tree, nested as rendered and named by its text (or alt/placeholder/link); choosing a layer selects the element on the canvas and in the Design panel. The preview sends the tree whenever the screen's DOM settles (protocol messages `tree` and `selectLoc`, schema-validated, exact-origin as before; capped at 2 000 layers).
- **Assets** tab: the file's design tokens grouped (colours, typography, radius, effects), safe colour swatches only, click to copy `var(--token)`. The safe-colour check and token parser are shared with Settings → Design systems.
- Tests: preview **4** (2 new), web unit **131** (5 new); E2E selects a layer and opens Assets.

### 2026-11-23 · Comments in the editor (V9b)

- **Comment tool (C):** click a screen to drop a numbered pin at that spot (pins keep their size at any zoom; screens don't take clicks in comment mode); the new **Comments** tab holds the composer, file-level comments, threads with replies, resolve/reopen, edit (author) and delete (author, or team admins/owners), and "Show resolved". Clicking a pin opens its thread.
- Tests: web unit **127** (5 new); E2E pins a comment, replies and resolves it.

### 2026-11-23 · Undo/redo (V6) and Delete forever in Trash

- **Undo/redo** for canvas edits: header buttons and ⌘/Ctrl+Z, ⌘/Ctrl+Shift+Z (or Ctrl+Y). Each step writes the screen's whole previous source back with the revision check; if the screen changed since (an AI run or a teammate) undo refuses rather than overwrite, and a stale revision clears the history. Writes now update the screens cache immediately, so quick successive edits start from the right code and revision.
- **Trash:** Delete forever (per file) and Empty trash for team admins/owners, with confirmation; designers keep Restore only.
- Tests: web unit **122** (7 new); E2E studio journey undoes and redoes a heading edit.

### 2026-11-23 · F3 editor shell; backend for comments, delete forever and screen writes

- **F3 (UI3 editor):** `/file/:id` (old `/projects/:id` links redirect); breadcrumb `Project / File ▾` with file menu (rename, duplicate, move, version history, export, settings, move to trash); left tabs Layers · AI · History; panels toggle (Ctrl/⌘+\\); floating toolbar (move, hand/Space, add screen, comment, ask AI) and shortcuts (V, H, S, C, /, Shift+1, Ctrl/⌘ ±, Esc). "Pages" are now "screens" in the UI. Canvas labels keep a 24 px target at any zoom (axe target-size). A focused toolbar button no longer re-activates when Space is released.
- **Comments API:** `GET/POST /projects/:id/comments`, replies, edit (author only), resolve/reopen, delete (author or team admin); pins on a screen (x, y in 0..1) or file-level; same-file foreign keys below RLS; trashed files are read-only. Migration 0011.
- **Delete forever:** `DELETE /projects/:id` (file must be in Trash) and `DELETE /projects/trash` (empty Trash), new permission `projects:delete` for team admins/owners; `SECURITY DEFINER` purge function keeps checkpoints append-only for the app role; repository and bundles removed from disk; audit kept.
- **Screen source writes:** `PUT /projects/:id/screens/:pageId/source` with `baseRevision` (for undo/redo and a code view); invalid TSX refused.
- JSON request bodies may be up to 1 MB (the previous 100 kB default silently capped DESIGN.md and screen code below their schema limits).
- Tests: integration **174/174** (18 new), web unit **115/115**, E2E 16/17 (sandbox-only OpenAI case).

### 2026-11-23 · F2 — Figma-style file browser

- **Files** replaces the project dashboard (`/files/recent`, `/files/drafts`, `/files/project/:id`, `/files/trash`; `/` and `/projects` redirect to Recents). Files sidebar: Recents, Drafts, Projects (create, rename, delete with file count), Trash.
- File views: search, sort (last modified, last opened, name, date created), grid/list (remembered per browser), cards with project, screen count and last edit. File menu and right-click: Open, Rename, Duplicate, Move to…, Export, Move to trash (with **Undo**); Trash offers Restore. Keyboard: Enter opens, F2 renames, Delete moves to trash. New design file: name, project and design system.
- Main navigation: **Files** · Metrics · Settings. The old dashboard component and its tests are removed (relative-time helper moved to `lib/time.ts`).
- Tests: 8 new web unit tests (web **108**); E2E rewritten for the Figma flow (project → new design file → screens; rename, duplicate, move, trash/undo/restore, delete project; dark/tablet) — **16/17**, same sandbox-only OpenAI case.

### 2026-11-23 · Figma-style app plan; F1 projects and files API

- **Plan:** [`docs/development/figma-style-app-plan.md`](docs/development/figma-style-app-plan.md) — Team → Projects → Files → Screens, file browser and UI3-style editor layouts, flows and CRUD; slices F1–F4 before V6. **ADR-0014:** UI "Projects" are folders (`folders` table); UI "files" keep the `projects` table and API.
- **API (F1):** `GET/POST/PATCH/DELETE /folders` (file counts; names unique per team; delete moves its files to Trash). Files gain `folderId`/`folderName`/`designSystemSlug`; list filters `folder` (id or `drafts`), `q` (case-insensitive, `%`/`_` literal), `sort` (updated, opened, name, created); create in a project; move via `PATCH {folderId}`; `POST /projects/:id/duplicate` copies the repository with history, new screen ids and a unique "(copy)" name. Migration 0010 adds a same-team composite foreign key so a file can never reference another team's folder, even below the API.
- **Fix found by the tests:** folder file counts were always 0 (unqualified column in a correlated subquery).
- Tests: 9 new integration tests (total **156/156**, fresh database and re-run).

### 2026-11-17 · V9a — version history and export as a React project

- **Export:** `GET /projects/:id/export[?checkpointId=]` downloads the project as a runnable Vite + React + Tailwind app (ZIP): the current work including unsaved canvas edits (snapshotted in a throw-away git index, so the repository's index and HEAD are untouched), or any checkpoint. Viewers may export; audited as `project.exported`. Verified: the downloaded ZIP installs and builds (`tsc` + `vite build`).
- **History tab** in the studio: checkpoints newest first, download any checkpoint, restore any checkpoint after confirmation (unsaved work is kept as an automatic checkpoint first); toolbar **Export** button; saving a checkpoint refreshes the list.
- **Project template:** `data-link` prototype links navigate with the router in exported apps (new projects).
- Tests: 3 new API integration tests (integration **147/147**), 4 new web unit tests (**104**), E2E studio journey extended with export + restore (**16/17**, same sandbox-only OpenAI case).

### 2026-11-17 · Docs and scans for the v2 re-baseline

- **ADR-0013** (v2 re-baseline: agent graph, versioned AGENT.md/DESIGN.md, static separate-origin preview runtime). The slice 2.6 preview-container documents are marked superseded (2.6a repositories remain valid).
- IMPLEMENTATION_STATUS, TEST_REPORT, SECURITY_REVIEW (preview origin CSP with `'unsafe-eval'` by design and `connect-src 'self'`; new risks R22–R25) and DEPENDENCY_REGISTER (langgraph, langsmith, @babel/parser, @babel/standalone, @tailwindcss/browser) updated.
- Scans: `pnpm audit --prod` 0; `pip-audit` 0; gitleaks clean; Trivy finds no library vulnerabilities, secrets or misconfigurations in any image (OS-package findings only in sandbox builds that skip the OS upgrade step).

### 2026-11-17 · Studio E2E on the composed stack, and fixes it found

- **E2E (`apps/web/e2e/studio.spec.ts`):** on the Docker Compose stack, the team owner connects the model, a designer creates a project, prompts the agent team, follows the live run, sees both screens render on the separate preview origin, edits a heading in the Design panel (written to source, survives reload), plays the prototype across screens, and checks metrics/agents/design systems. The model is an Ollama-compatible fake served by the test (`e2e/fake-llm.ts`); CI enables it with `LLM_ENDPOINT_ALLOWED_PRIVATE_HOSTS=host.docker.internal`. Screenshots in `docs/screenshots/v2/`.
- **Updated specs** for the v2 studio (project pages now live in the studio's Pages tab; Settings → Design systems is no longer a placeholder).
- **Fix:** pages added, renamed or deleted in the studio's Pages tab did not appear on the canvas until a reload.
- **Fix:** choosing a page in the Pages tab now selects its screen and pans the canvas to it (it was ignored).
- **Fix:** the header overflowed horizontally on phones when a team name was long (team picker now truncates).
- `E2E_CHROMIUM_PATH` (optional) lets Playwright use a preinstalled Chromium.
- E2E: **16/17** locally; the remaining test calls api.openai.com for real, which this sandbox's network blocks (unchanged; runs in CI).

### 2026-11-17 · Studio web unit tests; resilient run event stream

- **Tests:** 70 new web unit tests (web total **100**): Tailwind class editing, preview frame origin/source/schema checks (never posts to `*`), Design panel source edits and refusals, chat panel run timeline, Settings → Agents and Design systems (versioning, stale conflicts, restore/reset, required agents, read-only), metrics page.
- **Fix — dropped run streams:** the API now resumes from `Last-Event-ID` instead of replaying the whole run on a browser reconnect (which duplicated the timeline); the studio stops waiting when the stream closes for good and shows that the result will appear under previous runs, instead of staying on "Agents are working…" forever. One new integration test (studio total **28**).
- **Fix:** a failed run without an error code showed an empty alert; it now says "The run failed."

### 2026-11-17 · Studio API integration tests and two fixes they found

- **Tests:** 27 new API integration tests for the studio module (`apps/api/test/integration/studio.int.test.ts`): agent and design-system versioning, stale-version refusals, revert, required agents, project DESIGN.md apply/update with `STALE_REVISION`, design runs end to end through the real AI runtime (fake Ollama `/v1/chat/completions` answering by agent role), fix round, disabled agent, invalid TSX refused, provider outage without upstream leakage, one run per project, SSE events, canvas source edits incl. refusals, metrics, team isolation through the API and RLS, archived projects. Integration total **143/143**, on a fresh database and again on the same database.
- **Fix — run events stream:** the SSE endpoint read from a Redis connection that was never connected (`lazyConnect` is inherited, offline queue disabled), so every stream failed; the error then hit the JSON error filter after headers were sent. The reader now connects before headers are sent and later errors end the stream cleanly.
- **Fix — unchanged screens:** a run that regenerated exactly the current screens failed with `save_failed` (checkpoint refused "no changes"). It now succeeds without a new checkpoint.
- **Test fix:** a credentials test depended on data left by earlier runs (the admin's active team); it now selects the team explicitly.

### 2026-11-17 · Studio frontend and preview runtime

- **Studio** (`/projects/:id`): AI agents chat with live run timeline (SSE), infinite canvas (pan, zoom to cursor, fit, desktop/tablet/mobile frames, numbered storyboard), live React screens, element selection, Figma-style Design panel (text, layout/auto-layout, spacing, size, typography, fill, border, radius, shadow, opacity, raw classes) writing back to source, Prototype tab (on-click navigation, flow list, Play mode), Verify tab, project design system switcher + DESIGN.md editor, checkpoints.
- **Settings → Agents** (AGENT.md editor, model override, enable/disable, version history, restore, reset) and **Settings → Design systems** (DESIGN.md + tokens.css editor, colour swatches, custom systems).
- **Metrics** dashboard: runs, screens, tokens, review score, run time; by agent, model, day, project; failure causes.
- **Preview runtime** (`apps/preview`): separate-origin static app; compiles TSX in the browser with source locations; exact-origin postMessage protocol; strict CSP; new `preview` Docker image and Compose service.

### 2026-11-17 · Backend foundation for the v2 studio

- **Plan:** `docs/development/v2-rebaseline-plan.md` — reuse open-codesign (MIT), dsh-design-studio (MIT), codexdesign (GPL, UX ideas only) and the POC agents + CORE 2.0 design system.
- **AI runtime:** LangGraph design graph (orchestrator → UX → UI per screen in parallel → reviewer → fix loop), chat adapters for OpenAI / Anthropic / Gemini / Azure OpenAI / Ollama over the SSRF-safe egress, streamed NDJSON events, optional LangSmith tracing + feedback scores (off by default).
- **`@core-studio/studio-library`:** default `AGENT.md` per agent and design systems (CORE 2.0 default + minimal, corporate, flat) with a shared token contract.
- **API:** editable, versioned agents and design systems; project `DESIGN.md`/tokens in the repo; screens endpoint; deterministic source edits (text, classes, attributes) via Babel AST; design runs with the team's one key, step recording, Redis-backed SSE events, validated screens committed with a checkpoint; metrics endpoint. Migration 0009.
- Tests: runtime graph (3), source edits (5), library (3); existing suites green.

## [Unreleased] — Phase 2, slice 2.6a Project repositories (2026-11-09)

### Added

- Architecture for slice 2.6 (`docs/architecture/slice-2.6/`, six documents) and ADR-0012.
- `@core-studio/project-template` v1: a standard Vite + React + React Router + Tailwind app; generators for the manifest, the route table and page components; CI test that the generated app passes `tsc` and `vite build`.
- One git repository per project (hardened git CLI): created with the project, pages written as route files, manifest-driven routes, checkpoints (commits), history, restore as a new commit with an automatic safety checkpoint, per-checkpoint backup bundles, lazy backfill of existing projects, self-repair of the page projection.
- API: `GET /projects/:id/repository`, `GET/POST /projects/:id/checkpoints`, `POST /projects/:id/checkpoints/:checkpointId/restore`; pages now return `filePath`. Migration 0008.

### Security

- OAuth callback `code` and `state` values are now redacted from request logs (found while verifying this slice; present since slice 2.1).

## [Unreleased] — Phase 2, slice 2.5 Project dashboard and workspace shell (2026-11-09)

### Added

- Projects and pages persisted in PostgreSQL (migration 0007, team RLS, same-team composite FK, audit events) with optimistic concurrency (`expectedUpdatedAt`) and archive/restore instead of deletion.
- API: `GET/POST /projects`, `GET/PATCH /projects/:id`, `POST /projects/:id/open`, `GET/POST /projects/:id/pages`, `PATCH/DELETE /projects/:id/pages/:pageId`.
- Dashboard: project cards (name, description, pages, last modified, status), recently opened, search, active/archived tabs, create, rename, archive and restore, loading/empty/error states.
- Full-screen project workspace: toolbar, section navigation (Visual canvas, Code editor, AI assistant, Design system, Project settings), page list with add/rename/delete (confirmation) and arrow-key navigation, collapsible AI assistant panel placeholder, tablet drawers.
- Light/dark/system theme switch in the user menu.

## Phase 2, slice 2.4 AI provider settings (2026-11-09)

### Added

- Settings → AI providers: team, personal and company-managed credentials with add (step-up), connection test, rotate, revoke, masked keys, personal-key policy switch, company team-access dialog, default model selection and an activity feed. Responsive and WCAG 2.2 AA (axe) on desktop and mobile.
- AI runtime gateway: `POST /internal/v1/providers/probe` with service-token auth and SSRF-safe pinned egress; probes for OpenAI, Anthropic, Gemini, Azure OpenAI and Ollama.
- API: credential test endpoints (team and company), default model (`GET/PUT/DELETE /llm/default-model`), activity feed (`GET /llm/activity`); migration 0006 (`organization_llm_defaults`, last-test columns).
- Save-time endpoint SSRF policy and `LLM_ENDPOINT_ALLOWED_PRIVATE_HOSTS`; ADR-0011; ops docs for Key Vault validation, KEK rotation and cleanup.

### Changed

- gitleaks allowlist narrowed to the single fake test vector.

## Phase 2, slice 2.3 Credential vault (2026-11-09)

### Added

- Envelope-encrypted LLM credentials (team, personal, company-managed) with step-up-protected create/rotate/revoke, team personal-credential policy, company entitlements.
- Local and Azure Key Vault key wrappers; AI-runtime vault decryption with a shared cross-language test vector.
- `.gitleaks.toml`; ADR-0010.

## Phase 2, slice 2.2 Product shell (2026-11-09)

### Added

- Responsive app shell with permission-aware navigation, user menu (Radix), route error boundary.
- Projects dashboard (empty state), Settings with Members management (directory search, roles, removal), AI providers and Design systems empty states.

### Fixed

- `/auth/session` returns permissions for the team it auto-activates.

## Phase 2, slice 2.1 Identity & sessions (2026-11-09)

### Added

- OIDC (Entra-ready) BFF sign-in with PKCE, server-side Redis sessions, CSRF protection, step-up re-authentication.
- Users directory, teams, memberships, team roles and company admin with RLS; audit and security events.
- Team and member APIs (`/orgs`, `/orgs/:orgId/members`, `/directory/users`).
- Web: sign-in page, auth gate, team switcher, no-team onboarding, sign-out.
- Local/CI OIDC test server in docker-compose; `scripts/test-e2e.sh`.
- ADR-0009.

## Phase 1 Foundation (2026-11-09)

### Added

- Monorepo: pnpm workspaces + Turborepo; uv-managed Python service; shared TS/ESLint config.
- `packages/contracts`: error envelope, pagination, correlation-ID and health schemas.
- `apps/api`: NestJS 12 control-plane foundation — validated config, health (live/ready), helmet, CORS allow-list, Redis-backed rate limiting, pino logging with correlation IDs, OpenTelemetry, Drizzle migrations with RLS and least-privilege runtime role.
- `services/ai-runtime`: FastAPI foundation with validated settings, structured logging, correlation IDs, error envelope, OTel.
- `apps/web`: Vite + React 19 SPA shell with same-origin API client and system status.
- Hardened production Dockerfiles, nginx with strict CSP, docker-compose running the production images.
- Azure DevOps CI pipeline (build, test, scan, publish images; no deploy).
- Docs: POC audit, reference analysis, ADR-0001–0008, Phase 1 plan, status/security/dependency/test reports.
