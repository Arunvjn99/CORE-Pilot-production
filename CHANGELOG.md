# Changelog

## [Unreleased] — Phase 2, slice 2.3 Credential vault (2026-11-09)

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
