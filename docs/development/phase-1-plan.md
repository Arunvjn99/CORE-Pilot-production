# Phase 1 — Foundation Plan

Status: **Awaiting approval**. Versions checked against npm/PyPI on 2026-11-09. Licences and vulnerability results are re-verified at install time and recorded in `DEPENDENCY_REGISTER.md`.

## Scope (Phase 1 only)

Workspace, Vite web bootstrap, NestJS bootstrap, FastAPI runtime bootstrap, shared contracts, validated config, Docker Compose (Postgres + Redis), Drizzle migrations (baseline schema + RLS scaffolding), structured logging + OpenTelemetry, CI pipeline, initial security controls (helmet/CSP, CORS allow-list, rate limiting, correlation IDs, secret scanning).
**Not in Phase 1:** Entra login (Phase 2), LLM Gateway (3), agents (4), CORE package (5, deferred: blocker B1), canvas/preview (6).

## Folder structure (only what Phase 1 fills)

```
apps/web/               Vite + React SPA
apps/api/               NestJS control plane / BFF
services/ai-runtime/    FastAPI (uv)
packages/contracts/     Zod schemas + generated OpenAPI types
packages/config/        tsconfig/eslint/prettier presets
infrastructure/docker/  Dockerfiles; compose at repo root
docs/{adr,architecture,security,development}
.github or azure-pipelines.yml   (CI — see B4)
```

Dropped from the proposed tree for now: `apps/admin` (role-gated area of web, ADR-0004), `services/code-edit`, `services/preview-runtime`, `packages/{design-system,llm-gateway,agent-tools,observability}`, `infrastructure/{azure,bicep}`: each is created in the phase that fills it.

## Proposed dependencies

### TypeScript (Node 24 LTS, pnpm 10.x via Corepack: see note)

| Package                                                                                                                                    | Version                   | Purpose                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| typescript                                                                                                                                 | **5.9.3**                 | Not 7.0 (Go-native rewrite): NestJS legacy decorators/`emitDecoratorMetadata` compatibility unverified. Not 6.0 until Nest confirms. |
| turbo                                                                                                                                      | 2.11.x                    | Task graph                                                                                                                           |
| vite / @vitejs/plugin-react                                                                                                                | 8.3.x                     | Web build                                                                                                                            |
| react / react-dom                                                                                                                          | 19.3.x                    | UI                                                                                                                                   |
| @tanstack/react-query                                                                                                                      | 5.107.x                   | Server state                                                                                                                         |
| zustand                                                                                                                                    | 5.1.x                     | Local UI state only                                                                                                                  |
| react-router                                                                                                                               | latest 7.x                | Routing (verify)                                                                                                                     |
| tailwindcss / @tailwindcss/vite                                                                                                            | 4.3.x                     | Styling (tokens from one source in Phase 5)                                                                                          |
| zod                                                                                                                                        | 4.6.x                     | Shared validation (contracts, env, API)                                                                                              |
| @nestjs/{core,common,platform-express,config,swagger,throttler,terminus}                                                                   | 12.x                      | API                                                                                                                                  |
| nestjs-pino / pino                                                                                                                         | 5.3 / 10.4                | Structured logs + correlation IDs                                                                                                    |
| helmet                                                                                                                                     | 8.3.x                     | Security headers                                                                                                                     |
| drizzle-orm / drizzle-kit / pg                                                                                                             | 0.45.4 / 0.31.11 / 8.23.x | DB + migrations                                                                                                                      |
| ioredis                                                                                                                                    | latest                    | Redis                                                                                                                                |
| @opentelemetry/sdk-node + auto-instrumentations, @azure/monitor-opentelemetry                                                              | 0.301 / 1.21              | Tracing (OTLP locally, App Insights in Azure)                                                                                        |
| vitest, @testing-library/react, @playwright/test, @axe-core/playwright, supertest                                                          | 5.1 / … / 1.65            | Tests                                                                                                                                |
| eslint 10, typescript-eslint, prettier 3.9                                                                                                 |                           | Lint/format                                                                                                                          |
| Deferred to later phases: React Hook Form, Radix, Framer Motion, Monaco/CodeMirror, Babel, isomorphic-git, MSAL/openid-client, Azure SDKs. |

### Python (3.13, uv)

| Package                                                                        | Version      | Purpose                       |
| ------------------------------------------------------------------------------ | ------------ | ----------------------------- |
| fastapi / uvicorn                                                              | 0.162 / 0.54 | Runtime API                   |
| pydantic / pydantic-settings                                                   | 2.14 / 2.16  | Models, validated config      |
| structlog                                                                      | 26.1         | JSON logs                     |
| opentelemetry-sdk + fastapi instrumentation                                    | 1.45         | Tracing                       |
| pytest, httpx, ruff, mypy, pip-audit                                           |              | Tests / static checks / audit |
| LangGraph 1.2 and LiteLLM 1.108 are **not installed in Phase 1** (Phases 3–4). |

Note: npm reports pnpm 12.18 is current; local pnpm is 9.12. I'll pin whichever major Corepack resolves cleanly with Node 24 and record it.

## Acceptance criteria

- `pnpm install --frozen-lockfile` and `uv sync --frozen` succeed from clean.
- `turbo run lint typecheck test build` green; `pytest`, `ruff`, `mypy --strict` green.
- `docker compose up` brings up Postgres, Redis, api, ai-runtime, web; health endpoints pass; migrations apply via a separate job.
- API fails fast on invalid/missing env; security headers present; rate limit enforced; correlation ID propagated web → api → ai-runtime in traces.
- `pnpm audit`, `pip-audit`, gitleaks and trivy run with results in `SECURITY_REVIEW.md` (no unresolved high/critical).
- `IMPLEMENTATION_STATUS.md`, `DEPENDENCY_REGISTER.md`, `TEST_REPORT.md`, `SECURITY_REVIEW.md` and `CHANGELOG.md` created.

## Blockers / open decisions

| ID  | Item                                                                                                                 | Impact                                  |
| --- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| B1  | Source of the real CORE React package (not on public npm)                                                            | Blocks Phase 5; deferred by owner       |
| B2  | Docker daemon not running; gitleaks/trivy/az not installed. Owner proposed connecting the Docker MCP toolkit.        | Blocks compose + container/secret scans |
| B3  | Single- vs multi-tenant, data residency, personal keys (ADR-0007)                                                    | Needed by Phase 2                       |
| B4  | CI host: Azure DevOps (per baseline) while the repo lives on GitHub. Azure Pipelines from GitHub, or GitHub Actions? | Phase 1 CI file                         |
| B5  | Architecture docs/ADRs were never formally approved; ADR-0002, 0004–0007 are _Proposed_                              | Approve before relying on them          |
