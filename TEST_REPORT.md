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

## Phase 2 — slice 2.1 (2026-11-09)

| Suite                                                                                                                                                                             | Result    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| API unit (config, correlation, permissions, returnTo, audit sanitising)                                                                                                           | **16/16** |
| API integration (real Postgres, Redis and OIDC test server): HTTP foundation 7, RLS 6, auth/session/CSRF/step-up 15, RBAC/cross-team/DB privileges 27                             | **55/55** |
| Web unit                                                                                                                                                                          | **7/7**   |
| E2E on the composed production images (real OIDC sign-in through the browser, axe on sign-in and workspace, cookie flags, empty browser storage, sign-out, wrong tenant, no-team) | **7/7**   |

## Phase 2 — slice 2.2 (2026-11-09)

| Suite                                                                                                                               | Result      |
| ----------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| TypeScript lint, typecheck, unit and build                                                                                          | 12/12 tasks |
| API integration (new: permissions after late team assignment)                                                                       | **56/56**   |
| Web unit (auth gate, navigation, members page)                                                                                      | **13/13**   |
| E2E on production images (sign-in, team management across two users, empty states, 404, mobile width, axe on every page and dialog) | **9/9**     |

## Phase 2 — slice 2.3 (2026-11-09)

| Suite                                                                                                      | Result      |
| ---------------------------------------------------------------------------------------------------------- | ----------- |
| API unit (config incl. KEK rules, envelope crypto, Key Vault wrapper, no-decrypt source scan, permissions) | **24/24**   |
| API integration (now incl. 18 credential tests)                                                            | **73/73**   |
| AI runtime (ruff, mypy --strict, pytest -W error; vault vector/tamper/binding)                             | **18/18**   |
| Web unit / E2E (regression)                                                                                | 13/13 · 9/9 |

## Phase 2 — slice 2.4 (2026-11-09)

| Suite                                                                                                                | Result                                                                          |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| TypeScript lint, typecheck, unit and build (`turbo --force`)                                                         | 12/12 tasks                                                                     |
| API unit (incl. endpoint SSRF policy)                                                                                | **48/48**                                                                       |
| API integration (real Postgres, Redis, mock IdP **and a real AI runtime process**; fake Ollama is the only stand-in) | **87/87** (14 new)                                                              |
| AI runtime (ruff, format, mypy --strict, pytest)                                                                     | **69/69**                                                                       |
| Web unit                                                                                                             | **23/23** (10 new)                                                              |
| E2E on production images, with `E2E_OLLAMA_URL` set to the developer's local Ollama                                  | **12/12** (3 new; the Ollama test skips when the variable is unset, e.g. in CI) |
| Live provider checks (pinned egress)                                                                                 | OpenAI, Anthropic, Gemini: `unauthorized` for fake keys; Ollama: `ok`, 4 models |

## Phase 2 — slice 2.5 (2026-11-09)

| Suite                                                                                                                                                                                         | Result                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| TypeScript lint, typecheck, unit and build (`turbo --force`)                                                                                                                                  | 12/12 tasks                  |
| API unit / integration                                                                                                                                                                        | 48/48 · **102/102** (15 new) |
| AI runtime                                                                                                                                                                                    | 69/69                        |
| Web unit                                                                                                                                                                                      | **38/38** (15 new)           |
| E2E on production images (acceptance journey incl. reload persistence; dashboard archive/restore; dark theme at tablet and desktop; axe on dashboard, dialogs, workspace sections and drawer) | **16/16** (4 new)            |

Defects found by E2E and fixed before commit: Project settings crashed because the shared form rendered a dialog Cancel outside a dialog (unit test added); the assistant panel covered the work area on tablets (now closed by default below 1280px).

## Phase 2 — slice 2.6a (2026-11-09)

| Suite                                                                                                                                                                                                                                                 | Result      |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| TypeScript lint, typecheck, unit and build (`turbo --force`, now 16 tasks incl. project-template)                                                                                                                                                     | 16/16       |
| project-template (naming, escaping, allow-list parity, generated app `tsc` + `vite build`)                                                                                                                                                            | **5/5**     |
| API unit (new: path policy ×16 cases, symlink refusal, atomic writes, log scrubbing)                                                                                                                                                                  | **68/68**   |
| API integration (new: repository lifecycle, pages as files, concurrency, checkpoints, bundle restore, restore with safety checkpoint, cross-project restore, self-repair, lazy backfill, archived refusal, log redaction) — run twice for idempotence | **116/116** |
| Web unit                                                                                                                                                                                                                                              | 38/38       |
| E2E on rebuilt production images (all slice 2.5 journeys now write real repositories)                                                                                                                                                                 | **16/16**   |
