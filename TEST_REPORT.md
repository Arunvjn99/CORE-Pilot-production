# Test Report

## Phase 1 — 2026-11-09 (local, macOS arm64, Docker Desktop)

| Suite                                             | Command                                             | Result                                                                                     |
| ------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| TS lint + typecheck + unit + build (all packages) | `pnpm turbo run lint typecheck test build`          | 12/12 tasks pass                                                                           |
| Formatting                                        | `pnpm format:check`                                 | pass                                                                                       |
| contracts unit                                    | vitest                                              | 3/3                                                                                        |
| api unit (config, correlation)                    | vitest                                              | 6/6                                                                                        |
| api integration (real Postgres 17.6 + Redis 8.2)  | `./scripts/test-integration.sh`                     | **13/13** — health, headers, CORS, correlation, error envelope, rate limit, RLS ×6         |
| web unit                                          | vitest + Testing Library                            | 4/4                                                                                        |
| web E2E on the composed production images         | Playwright (Chromium)                               | **4/4** — app ↔ API same-origin, axe WCAG 2.2 AA (0 violations), CSP/headers, SPA fallback |
| ai-runtime                                        | ruff, ruff format, mypy --strict, `pytest -W error` | 11/11, no issues                                                                           |
| Stack smoke                                       | `docker compose up --wait`                          | migrate job exit 0; api, ai-runtime healthy; web serving                                   |

Not yet run: the Azure DevOps pipeline itself (no run has occurred). Coverage thresholds are not yet enforced (to add with Phase 2 business logic).
