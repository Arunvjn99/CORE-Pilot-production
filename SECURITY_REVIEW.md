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
| R4  | ~~No authentication yet~~                                                            | **Closed in slice 2.1** (OIDC BFF, sessions, CSRF, RBAC, step-up)             |
| R5  | ai-runtime has no service auth                                                       | Internal network only; Phase 4 adds identity-based auth                       |
| R6  | Base images pinned by tag, not digest                                                | Pin digests + automated update PRs in Phase 7                                 |
| R7  | Local Node 24.11 < 24.15 (jsdom 31 requires it)                                      | jsdom pinned to 29.1.1; upgrade local Node                                    |
| R8  | Pipeline not yet executed on Azure DevOps                                            | Run once the pipeline is connected                                            |

## Phase 2 — slice 2.1 (2026-11-09)

### Controls added

- **Sign-in flow:** OIDC Authorization Code + PKCE S256 in the BFF. State is single-use and hashed in Redis; nonce is checked; a browser-binding cookie defeats login CSRF; identities from other tenants are rejected; production accepts only the Entra issuer.
- **Session cookie:** `__Host-` prefix, HttpOnly, Secure, SameSite=Lax. Session IDs are stored hashed. Idle and absolute timeouts apply, a new ID is issued at sign-in, and logout destroys the server session.
- **CSRF:** synchronizer token plus a strict Origin check on all unsafe methods.
- **Step-up re-authentication** for sensitive routes, bound to the same session and user.
- **Authorization:** deny-by-default guard chain; RBAC evaluated server-side on every request from fresh database state; last-owner protection.
- **Database:**
  - The runtime role cannot write `users` (SECURITY DEFINER function only) and cannot read `security_events`.
  - Memberships have forced RLS.
  - Audit rows commit atomically with each change.
- **Safe redirects:** `returnTo` accepts only same-app relative paths.
- **Browser storage:** the SPA keeps the CSRF token in memory only; E2E asserts that localStorage and sessionStorage are empty.

### Scans

| Scan                                | Result                                   |
| ----------------------------------- | ---------------------------------------- |
| Trivy on rebuilt api and web images | **0** high/critical findings             |
| `pnpm audit --prod`                 | 0                                        |
| `pnpm audit` (all)                  | Unchanged: 2 moderate, dev-only (R1, R2) |

### New risks

| ID  | Risk                                                                     | Status                                                                                      |
| --- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| R9  | A user removed from Entra keeps their session until it expires (12h max) | Per-user revocation exists; Graph/SCIM offboarding hook in Phase 7                          |
| R10 | Entra not yet wired (no app registration)                                | Config-only switch; production validation enforces the Entra issuer                         |
| R11 | Mock OIDC server image used locally/CI                                   | Not part of any production image or config; production validation rejects non-Entra issuers |

## Phase 2 — slice 2.2 (2026-11-09)

- **UI permissions are hints only:** permission-aware navigation and controls hide what a user can't do, but the API enforces every rule (covered by the 2.1 RBAC matrix).
- **No internal details in errors:** the route error boundary never renders error details. Member-management errors show the API's sanitised message.
- **Scans:**
  - Trivy on the api and web images: 0 high/critical.
  - `pnpm audit --prod`: 0.
  - Production licences: MIT, Apache-2.0, BSD-3-Clause, ISC, PSF-2.0, 0BSD.
- **Defect found by E2E and fixed:** `/auth/session` returned permissions for the previously active team after auto-activation. This was a UI-only impact (empty navigation), not a privilege escalation, because every API call recomputes permissions server-side.
