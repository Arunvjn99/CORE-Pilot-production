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

## Phase 2 — slice 2.3 (2026-11-09)

- **Credential storage:** envelope-encrypted and AAD-bound to each row. Key material is destroyed on revoke (enforced by a check constraint), and the runtime role has no DELETE.
- **Crypto split:** the API can never decrypt (a source-scan test enforces this); only the AI runtime can unwrap.
- **Personal credentials** are private to their owner through a RESTRICTIVE RLS policy, including from owners and company admins.
- **Step-up** re-authentication is required for every credential and policy mutation.
- **Secrets never appear** in responses, audit rows or logs; integration tests capture logs to prove it.
- **gitleaks** now uses `.gitleaks.toml`, which allow-lists only the deliberately fake secrets in test fixtures.
- **Scans:**
  - Trivy: api 0, ai-runtime 0.
  - `pnpm audit --prod`: 0.
  - `pip-audit`: 0.
  - New licences are MIT, Apache-2.0/BSD, MIT-0 (cffi) and PSF.

### New risks

| ID  | Risk                                                          | Status                     |
| --- | ------------------------------------------------------------- | -------------------------- |
| R12 | Key Vault wrap/unwrap is not exercised against real Azure yet | Phase 7 infra + smoke test |
| R13 | KEK version rotation needs a re-seal job                      | Phase 7                    |
| R14 | Personal credentials of removed members persist until revoked | Offboarding job, Phase 7   |

## Phase 2 — slice 2.4 (2026-11-09)

- **SSRF:** save-time URL policy in the API, plus connect-time enforcement in the runtime: resolve once, block non-global addresses, pin the connection with SNI (defeats DNS rebinding), no redirects, no proxies, size and time caps. Both sides share one address-case file. See `docs/security/provider-endpoint-ssrf.md`.
- **Service auth:** API → runtime calls carry IdP-issued JWTs (managed identity in Azure, enforced by production config). The runtime rejects missing, mis-signed, wrong-audience, wrong-issuer, expired and non-allow-listed tokens (tests for each).
- **No key exposure:** the API sends only the sealed envelope; the runtime returns fixed codes and model ids. Tests prove upstream error bodies and secrets never reach responses, the DOM or the activity feed. The UI key field is write-only (`type=password`, autocomplete off) and cleared on close and after saving.
- **Authorization:** testing requires `providers:manage` (team and entitled company credentials) or ownership (personal). Default model needs `providers:manage` and never accepts personal credentials. Activity hides other people's personal-credential events.
- **gitleaks:** allowlist narrowed to one fixture; a scan with no allowlist showed nothing else.
- **Scans:**
  - Trivy with `--ignore-unfixed` (the CI gate): api 0, web 0, ai-runtime 0.
  - Without that flag the ai-runtime image shows 47 Debian base-image CVEs with **no fix available**, published since slice 2.3. They will be picked up by the next base-image refresh.
  - `pnpm audit --prod`: 0. `pip-audit`: 0.

### New risks

| ID  | Risk                                                                                                                         | Status                                                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| R15 | Managed-identity runtime auth not exercised in Azure                                                                         | Same JWT validation as local; Azure smoke test with R12 |
| R16 | Endpoint is not bound into the envelope AAD; a compromised API could aim a stored key at its own endpoint (for Azure/Ollama) | Envelope v2 (bind endpoint), Phase 7                    |
| R17 | Unfixed Debian CVEs in the python slim base                                                                                  | Track; rebuild when fixes publish                       |

## Phase 2 — slice 2.5 (2026-11-09)

- **Team isolation:** `projects` and `project_pages` use forced RLS on `organization_id`. A composite foreign key `(project_id, organization_id)` makes a page from another team impossible even if RLS were bypassed (tested). Other teams' ids return 404.
- **Authorization:** reads need `projects:read`; every write needs `projects:write`, so viewers are read-only (tested). Every write is CSRF-protected.
- **Integrity:** `expectedUpdatedAt` concurrency prevents silent lost updates. Routes are restricted to lowercase URL-safe segments, so they are safe as future file paths (no `..` or uppercase). The last page can't be deleted. Projects are archived, never hard-deleted (no DELETE grant).
- **Audit:** project created, updated, archived and restored; page created, updated and deleted.
- **Browser storage:** only the theme preference (`localStorage`, no user data; failures ignored).
- **Scans:** Trivy `--ignore-unfixed` api, web, ai-runtime 0; `pnpm audit --prod` 0; gitleaks clean. No new dependencies.

### New risks

| ID  | Risk                                                                             | Status                                                        |
| --- | -------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| R18 | “Recently opened” is per project (last open by anyone in the team), not per user | Per-user recents if needed, with the usage data in slice 2.10 |
| R19 | Page metadata will need reconciling with route files when the repository arrives | Repository slice owns the migration                           |

## Phase 2 — slice 2.6a (2026-11-09)

- **Git hardening:** `execFile` with fixed arguments (no shell); user text only as `-m` message values or after `--`; no system/global config; `core.hooksPath=/dev/null`, `core.symlinks=false`, `protocol.allow=never`; no remotes. Commit emails are non-routable per-user addresses (no real emails in history).
- **Filesystem:** repo paths are built from server UUIDs only; every file operation is policy-checked (no absolute paths, `..`, `.git`, `node_modules`, control characters; depth, name, size and type limits) and every path component is `lstat`-ed, so symlinks are refused rather than followed. Writes are atomic.
- **Isolation:** repositories live under `REPO_ROOT/<organizationId>/<projectId>`; access requires the project to be visible under RLS; checkpoints of another project can't be restored (tested). New tables use forced RLS with composite same-team foreign keys; checkpoints are append-only for the app role.
- **Concurrency:** advisory lock per project; the revision marker detects partial failures and the repository wins.
- **Log fix:** OAuth callback `code`/`state` were written to request logs since slice 2.1 (one-time values bound by PKCE and the browser-binding cookie, so not replayable, but still secrets). They are now redacted in the request serializer, with a unit test and an integration assertion on captured logs.
- **Scans:** Trivy (`--ignore-unfixed`) api 0 including the new git package; `pnpm audit --prod` 0; gitleaks clean.

### New risks

| ID  | Risk                                                             | Status                                                    |
| --- | ---------------------------------------------------------------- | --------------------------------------------------------- |
| R20 | git on Azure Files not yet validated                             | Spike S2 before Azure use                                 |
| R21 | Bundles stay on the local volume until 2.6f uploads them to Blob | Same volume as the repos locally; not a backup on its own |
