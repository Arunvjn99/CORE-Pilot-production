# Changelog

## [Unreleased] — Studio v2 (re-baseline, in progress)

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
