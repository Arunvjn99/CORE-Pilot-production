# Security Review

## Phase 1 — 2026-11-09

### Controls implemented (with evidence)

| Control                                                                                                                                               | Where                                                                        | Verified by             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------- |
| Fail-fast validated config; no insecure fallbacks; production requires DB `sslmode=require/verify-full`, `rediss://`, HTTPS CORS, docs off            | `apps/api/src/config/env.ts`, `services/ai-runtime/src/ai_runtime/config.py` | unit tests              |
| Security headers (CSP `default-src 'none'` on API; strict SPA CSP without `unsafe-inline`/`unsafe-eval`; nosniff; frame-ancestors none; HSTS in prod) | `app.setup.ts`, nginx template                                               | integration + E2E tests |
| CORS allow-list, wildcard rejected                                                                                                                    | `env.ts`, `app.setup.ts`                                                     | integration test        |
| Rate limiting with shared Redis state (atomic Lua)                                                                                                    | `redis-throttler.storage.ts`                                                 | integration test        |
| Uniform error envelope; no stack/internal messages on 5xx                                                                                             | `http-exception.filter.ts`, `errors.py`                                      | tests                   |
| Correlation-ID validation (prevents log/header injection)                                                                                             | contracts + both services                                                    | tests                   |
| Log redaction of auth headers, cookies, secrets                                                                                                       | pino `redact`, structlog processor                                           | code review             |
| Tenant isolation via PostgreSQL RLS, `FORCE ROW LEVEL SECURITY`, transaction-scoped tenant setting                                                    | `schema.ts`, migrations, `withTenant()`                                      | 6 integration tests     |
| Least-privilege DB runtime role (`core_app`: no superuser, NOBYPASSRLS, audit append-only); migrations use a separate privileged credential           | migration 0001, `01-roles.sh`                                                | integration test        |
| No tokens/secrets in browser storage (ESLint rule bans `localStorage`); same-origin cookie-credential fetch                                           | `packages/config/eslint.config.js`, `api-client.ts`                          | lint + unit test        |
| Containers: non-root, read-only rootfs, `no-new-privileges`, `cap_drop: ALL`; package managers removed from runtime images; OS patched                | Dockerfiles, compose                                                         | Trivy                   |
| Ports bound to 127.0.0.1 locally; ai-runtime not published                                                                                            | compose                                                                      | inspection              |
| Supply chain: frozen lockfiles, exact versions, strict peer deps, only allow-listed install scripts (`onlyBuiltDependencies`)                         | workspace config                                                             | install                 |

### Scan results

| Scan                                                                                         | Result                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trivy 0.76.2 (vuln, secret, misconfig; HIGH/CRITICAL, fixable) — api, ai-runtime, web images | **0 findings** each (after base-image upgrade and hardening; the initial scan found 50+ in outdated base layers, all fixed)                                                               |
| `pip-audit --strict` (runtime deps)                                                          | No known vulnerabilities                                                                                                                                                                  |
| `pnpm audit` (prod)                                                                          | 0                                                                                                                                                                                         |
| `pnpm audit` (all, incl. dev)                                                                | 2 moderate, dev-only — see accepted risks                                                                                                                                                 |
| gitleaks 8.28 (working tree)                                                                 | 3 hits, all in local untracked `.env` (generated local secrets; gitignored). Pipeline scans git history.                                                                                  |
| Licences                                                                                     | Production: MIT, Apache-2.0, BSD, ISC, PSF, 0BSD only. Dev/build: MPL-2.0 (axe-core, lightningcss), Python MPL-2.0 (certifi, pathspec) — file-level copyleft, unmodified use, acceptable. |

### Accepted / open risks

| ID  | Risk                                                                                 | Status                                                                        |
| --- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| R1  | `esbuild ≤0.24.2` via `drizzle-kit → @esbuild-kit` (moderate, dev server CORS issue) | Dev-only CLI, never in images. Track drizzle-kit upgrade.                     |
| R2  | `minimatch` ReDoS via `eslint` (moderate)                                            | Dev-only. Track eslint update.                                                |
| R3  | Throttler applies to matched routes only; unknown-path floods not limited by the app | Mitigate at ingress/WAF (Azure Front Door / Container Apps ingress) — Phase 7 |
| R4  | No authentication yet                                                                | Phase 2 (Entra ID BFF). API exposes health endpoints only.                    |
| R5  | ai-runtime has no service auth                                                       | Internal network only; Phase 4 adds identity-based auth                       |
| R6  | Base images pinned by tag, not digest                                                | Pin digests + automated update PRs in Phase 7                                 |
| R7  | Local Node 24.11 < 24.15 (jsdom 31 requires it)                                      | jsdom pinned to 29.1.1; upgrade local Node                                    |
| R8  | Pipeline not yet executed on Azure DevOps                                            | Run once the pipeline is connected                                            |
