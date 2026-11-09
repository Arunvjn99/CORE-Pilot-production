# Changelog

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
