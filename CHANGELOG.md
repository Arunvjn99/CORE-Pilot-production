# Changelog

## [Unreleased] — Phase 1 Foundation (2026-11-09)

### Added

- Monorepo: pnpm workspaces + Turborepo; uv-managed Python service; shared TS/ESLint config.
- `packages/contracts`: error envelope, pagination, correlation-ID and health schemas.
- `apps/api`: NestJS 12 control-plane foundation — validated config, health (live/ready), helmet, CORS allow-list, Redis-backed rate limiting, pino logging with correlation IDs, OpenTelemetry, Drizzle migrations with RLS and least-privilege runtime role.
- `services/ai-runtime`: FastAPI foundation with validated settings, structured logging, correlation IDs, error envelope, OTel.
- `apps/web`: Vite + React 19 SPA shell with same-origin API client and system status.
- Hardened production Dockerfiles, nginx with strict CSP, docker-compose running the production images.
- Azure DevOps CI pipeline (build, test, scan, publish images; no deploy).
- Docs: POC audit, reference analysis, ADR-0001–0008, Phase 1 plan, status/security/dependency/test reports.
