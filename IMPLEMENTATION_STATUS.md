# Implementation Status

Last updated: 2026-11-09

| Phase                         | Status                                                                                  |
| ----------------------------- | --------------------------------------------------------------------------------------- |
| 1 — Foundation                | **Implemented and verified locally.** CI pipeline written, not yet run on Azure DevOps. |
| 2 — Identity & enterprise     | Not started. Needs decision B3 (tenancy model, residency, personal keys).               |
| 3 — LLM Gateway               | Not started (ADR-0005 proposed)                                                         |
| 4 — Agent runtime             | Not started                                                                             |
| 5 — Design system & Knowledge | Not started. Blocked on B1 (CORE React package source)                                  |
| 6 — Visual canvas             | Not started (ADR-0006 proposed)                                                         |
| 7 — Integrations & readiness  | Not started                                                                             |

## Phase 1 modules

| Module                                   | State                       | Evidence                                                                              |
| ---------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------- |
| Workspace (pnpm 10.34.9, Turborepo, uv)  | Done                        | Frozen installs succeed; strict peers enforced                                        |
| `packages/contracts`                     | Done                        | 3 unit tests                                                                          |
| `apps/api` NestJS foundation             | Done                        | 6 unit + 13 integration tests vs real Postgres 17 / Redis 8                           |
| Validated config (api, ai-runtime)       | Done                        | Unit tests cover missing vars, wildcard CORS, production TLS/docs rules               |
| PostgreSQL + Drizzle migrations + RLS    | Done (baseline tables only) | RLS isolation, no-context, cross-tenant write and append-only audit tests             |
| Redis (shared rate-limit state)          | Done                        | Integration test: 429 after limit                                                     |
| Logging + correlation IDs + tracing      | Done                        | Correlation tests; OTLP export enabled by env (not exercised against a collector yet) |
| `services/ai-runtime` FastAPI foundation | Done                        | 11 tests, ruff, mypy --strict                                                         |
| `apps/web` Vite SPA shell                | Done                        | 4 unit tests, 4 E2E incl. axe WCAG 2.2 AA                                             |
| Docker images + compose                  | Done                        | Read-only, non-root, cap-drop ALL; stack healthy; Trivy 0 high/critical               |
| Azure Pipeline (CI only)                 | Written                     | **Not yet executed on Azure DevOps**                                                  |

## Not in Phase 1 (by design)

Authentication (Entra ID) — the API currently exposes only health endpoints. Service-to-service auth between api and ai-runtime (ai-runtime is network-internal only for now; Phase 4 adds managed-identity/mTLS auth).
