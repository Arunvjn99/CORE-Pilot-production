# Implementation Status

Last updated: 2026-11-09

| Phase                                          | Status                                                                                                                                                                        |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — Foundation                                 | **Implemented and verified locally.** CI pipeline written, not yet run on Azure DevOps.                                                                                       |
| 2 — Product shell, identity, providers, canvas | **In progress.** Slices 2.1–2.4 (identity, shell, credential vault, provider settings) done and verified locally; 2.5–2.10 pending ([plan](docs/development/phase-2-plan.md)) |
| 3 — LLM Gateway                                | Not started (ADR-0005 proposed)                                                                                                                                               |
| 4 — Agent runtime                              | Not started                                                                                                                                                                   |
| 5 — Design system & Knowledge                  | Not started. Blocked on B1 (CORE React package source)                                                                                                                        |
| 6 — Visual canvas                              | Not started (ADR-0006 proposed)                                                                                                                                               |
| 7 — Integrations & readiness                   | Not started                                                                                                                                                                   |

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

## Phase 2 — slice 2.1 Identity & sessions (2026-11-09)

| Module                                                                                    | State        | Evidence                                                                      |
| ----------------------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------- |
| OIDC BFF sign-in (PKCE, state/nonce, browser binding, tenant restriction)                 | Done         | Integration tests: flow, replay, login-CSRF, wrong tenant, open-redirect      |
| Sessions (Redis, hashed IDs, idle/absolute timeout, fixation defence, logout)             | Done         | Integration tests                                                             |
| CSRF (token + Origin)                                                                     | Done         | Integration tests                                                             |
| Step-up re-auth (`prompt=login`, 10-minute window)                                        | Done         | Integration tests incl. mismatched-user rejection                             |
| Teams, memberships, RBAC (4 team roles + company admin), last-owner protection            | Done         | RBAC matrix + cross-team tests                                                |
| DB: users directory (definer-only writes), memberships RLS, security events (insert-only) | Done         | DB-privilege tests                                                            |
| Audit events for team changes                                                             | Done         | Integration test reads them under team context                                |
| Web: sign-in, auth gate, team switcher, no-team page (admin create team), sign-out        | Done         | 3 unit + 4 E2E (real OIDC flow, axe)                                          |
| Entra ID production wiring                                                                | Config-ready | Blocked on app registration (D1); production config enforces the Entra issuer |

## Phase 2 — slice 2.2 Product shell (2026-11-09)

| Module                                                                                                                                  | State                 | Evidence                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------- |
| App shell: header (team switcher, user menu), permission-aware main navigation, responsive layout, skip link, route error boundary, 404 | Done                  | Unit (nav filtering) + E2E (desktop & 390px mobile, no horizontal overflow, axe) |
| Project dashboard                                                                                                                       | Empty state only      | Projects arrive in slice 2.5 (no mock data)                                      |
| Settings → Members (list, add via directory search, change role, remove with confirmation; owner-role rules mirrored from API)          | Done                  | 3 unit + E2E full flow across two users                                          |
| Settings → AI providers / Design systems                                                                                                | Honest empty states   | Filled by slices 2.3–2.4 and Phase 5 (blocked on B1)                             |
| AI assistant panel                                                                                                                      | Deferred to slice 2.8 | Lives in the canvas workspace; nothing to attach it to until projects exist      |
| Fix: session endpoint now returns permissions for the auto-activated team                                                               | Done                  | Regression integration test                                                      |

## Phase 2 — slice 2.3 Credential vault (2026-11-09)

| Module                                                                                       | State                                                    | Evidence                                                                          |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Envelope encryption v1 (AES-256-GCM, per-secret DEK, AAD-bound)                              | Done                                                     | 7 unit tests incl. cross-language vector                                          |
| Key wrappers: local (dev/test) and Azure Key Vault RSA-OAEP-256                              | Local verified; Key Vault unit-tested with a fake client | Real Key Vault needs Azure (Phase 7 infra)                                        |
| Crypto split: API wrap-only, AI runtime unwrap/decrypt                                       | Done                                                     | Source-scan test; Python vault tests (7)                                          |
| Team/personal credentials API: list, create, rotate, revoke; team personal-credential policy | Done                                                     | Integration tests (step-up, RBAC, RLS privacy, cross-team, destruction on revoke) |
| Company-managed credentials and team entitlements                                            | Done                                                     | Integration tests                                                                 |
| Secret hygiene: never in responses, audit or logs                                            | Done                                                     | Log-capture and audit-scan tests                                                  |
| UI for provider credentials                                                                  | Not in this slice                                        | Slice 2.4 (with model discovery and the step-up prompt)                           |

## Phase 2 — slice 2.4 AI provider settings (2026-11-09)

| Module                                                                            | State        | Evidence                                                                                                                         |
| --------------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Save-time endpoint SSRF policy (API)                                              | Done         | 22 unit cases                                                                                                                    |
| Runtime gateway: service-token auth, pinned egress, provider probes (5 providers) | Done         | 51 new pytest cases; live check: OpenAI/Anthropic/Gemini reject fake keys, local Ollama lists models                             |
| API: test (team/company), default model, activity feed, migration 0006            | Done         | 14 integration tests against a **real** AI runtime process and mock IdP tokens                                                   |
| Web: provider settings UI (all requirements of slice 2.4)                         | Done         | 10 unit + 3 E2E on production images (real step-up, real OpenAI call, real Ollama); screenshots in `docs/screenshots/slice-2.4/` |
| Managed-identity service auth in Azure                                            | Config-ready | Needs Azure (same validation path as local)                                                                                      |
| Azure OpenAI deployment-name verification                                         | Not done     | Listing proves key/resource only (ADR-0011)                                                                                      |
