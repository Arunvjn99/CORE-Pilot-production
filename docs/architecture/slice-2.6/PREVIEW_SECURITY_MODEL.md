# Preview security model

Status: **Approved 2026-11-09.** Part of [SLICE_2_6_ARCHITECTURE.md](SLICE_2_6_ARCHITECTURE.md).

Assumption: **all code running in a preview is hostile.** It may be written or modified by an AI agent, pasted by a user, or crafted by an attacker who has a team account. The preview must be safe even if that code is fully malicious.

## 1. Trust zones

| Zone                | Contents                                   | Trust                               | Holds secrets                                                                                                             |
| ------------------- | ------------------------------------------ | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Studio browser      | `apps/web` on the studio origin            | Trusted UI, untrusted input         | Session cookie (HttpOnly), in-memory CSRF token                                                                           |
| Control plane       | `apps/api`, PostgreSQL, Redis, repo volume | Privileged                          | DB credentials, Key Vault wrap rights, IdP client credentials                                                             |
| AI runtime          | `services/ai-runtime`                      | Privileged (decrypts provider keys) | Unwrap rights                                                                                                             |
| Preview edge        | `services/preview-gateway`                 | Semi-trusted router                 | Its managed identity (Session Executor on the pool only) or local service credentials; per-session agent tokens in memory |
| **Preview sandbox** | `preview-agent` + project code + Vite      | **Untrusted**                       | Only its own per-session agent token (useless outside its sandbox)                                                        |
| Preview browser     | The iframe document on the preview site    | **Untrusted**                       | Nothing                                                                                                                   |

## 2. Assets to protect

1. Studio session cookies and CSRF tokens.
2. LLM provider keys and envelope keys.
3. Database and Redis contents of other teams.
4. Other projects' source (repo volume, other sandboxes).
5. Cloud identity: managed identity tokens, the instance metadata service.
6. Internal services: api, ai-runtime, gateway control, Key Vault, Storage.
7. Availability of shared infrastructure (cost, CPU, noisy neighbours).

## 3. Threat model (STRIDE-oriented)

| #   | Threat                                                    | Vector                                                               | Controls                                                                                                                                                                                                                                                                                                                             | Verified by                                                                                                                                                                             |
| --- | --------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | Preview JS steals the studio session                      | Reading cookies, calling the studio API with credentials             | Preview served on a **different registrable domain** (Azure) or a different site (`127.0.0.1` vs `localhost` locally); studio cookies are `__Host-`, HttpOnly, `SameSite=Lax`; the API rejects unsafe methods without a matching `Origin` and CSRF token; CORS on the API allows only the studio origin                              | E2E: preview page tries `fetch(studio/api/v1/auth/session, {credentials:'include'})` and a cross-site POST → blocked/403                                                                |
| T2  | Preview frames or navigates the studio (top-level hijack) | `window.top.location = …`, popups                                    | Iframe `sandbox` omits `allow-top-navigation*` and `allow-popups`; studio sends `X-Frame-Options: DENY` / CSP `frame-ancestors 'none'`, so it can't be framed by the preview                                                                                                                                                         | E2E: navigation attempts fail; the studio stays put                                                                                                                                     |
| T3  | Forged messages to the studio                             | A malicious page or another frame posts protocol messages            | The studio accepts only messages where `event.origin === session.previewOrigin` **and** `event.source === iframe.contentWindow`, then switches to a private `MessageChannel`; every message is schema-validated, size- and rate-limited; the studio never evaluates content from messages, and studio-rendered strings are text only | Unit tests for the protocol client; E2E with a rogue frame                                                                                                                              |
| T4  | Studio data leaking into the preview                      | `postMessage` to a wildcard target                                   | The studio always posts with the exact `previewOrigin`; messages to the preview carry only oids, viewport and mode (no user, team or token data)                                                                                                                                                                                     | Lint rule bans `postMessage(_, '*')`; tests                                                                                                                                             |
| T5  | Network pivot to internal services                        | `fetch`, Node `net`, DNS from Vite plugins or app code at build time | Azure: session pool with egress disabled. Local: `internal: true` network whose only peer is the gateway, which binds **no** listener on that network (explicit interface binding). No service DNS names resolve inside the sandbox                                                                                                  | Container tests: TCP connects to api:3000, postgres:5432, redis:6379, ai-runtime:8000, gateway control, 1.1.1.1:443 and the internet all fail; DNS lookups of studio service names fail |
| T6  | Cloud metadata / identity theft                           | `169.254.169.254`, IMDS headers                                      | No managed identity assigned to the session pool; Hyper-V sessions don't expose host IMDS; egress disabled anyway                                                                                                                                                                                                                    | Container test plus spike S1 check                                                                                                                                                      |
| T7  | Secrets in the sandbox                                    | Environment variables, mounted files, build args                     | The agent image has no secrets; sandbox environment is a fixed allow-list (`NODE_ENV`, `PREVIEW_*` non-secret settings); the per-session agent token arrives via the lease call and is kept in memory, not the environment; no repo volume mount                                                                                     | Test: `env` and a filesystem scan for key patterns (gitleaks rules) inside a running sandbox                                                                                            |
| T8  | Cross-project access                                      | Reading another project's files or processes                         | One sandbox per session; pool containers are recycled (process exit → Compose restart → fresh tmpfs) before reuse; Azure sessions are destroyed on release                                                                                                                                                                           | Integration test: project A's marker file is absent in the next session on the same slot                                                                                                |
| T9  | Container escape / kernel exploit                         | Privilege escalation                                                 | Azure: Hyper-V isolation (no shared kernel). Local: non-root UID 10001, `cap_drop ALL`, `no-new-privileges`, read-only rootfs, seccomp default, no Docker socket. Local is developer-only by design                                                                                                                                  | Trivy on the image; config assertions in the container test                                                                                                                             |
| T10 | Resource exhaustion and cost abuse                        | Fork bombs, memory hogs, infinite builds, many sessions              | CPU, memory and pids limits; 256 MB tmpfs; 4 h maximum lifetime; idle stop; per-team and global quotas; gateway rate limits on control and data planes                                                                                                                                                                               | Container tests (OOM kill, pids cap); quota integration tests                                                                                                                           |
| T11 | Malicious dependencies (supply chain)                     | Install scripts, typosquats                                          | No installs in the sandbox (no egress anyway); a baked allow-listed `node_modules` built in CI with install scripts off, scanned by Trivy and `pnpm audit`; `package.json` validated against the allow-list before sync                                                                                                              | CI image scan; API test that rejects unknown dependencies                                                                                                                               |
| T12 | Path traversal into the agent or API                      | Crafted paths in sync patches or edits                               | The same path policy in the API and the agent (repo-relative only, no `..`, no `.git`, no symlinks, size limits); tar extraction rejects absolute paths, links and devices                                                                                                                                                           | Unit and fuzz tests on both sides                                                                                                                                                       |
| T13 | Capability URL leakage                                    | Referer, logs, screenshots                                           | Capability is per-session and dies with it; `Referrer-Policy: no-referrer` from the gateway; logs record only its hash; the URL is never shown in the UI chrome                                                                                                                                                                      | Gateway log test                                                                                                                                                                        |
| T14 | Gateway compromise via untrusted traffic                  | HTTP request smuggling, header injection                             | Gateway built on Node's HTTP server with a maintained proxy library; strips hop-by-hop and studio headers; size and time limits; it holds only routing data and its pool role (can't reach DB, Key Vault or Storage)                                                                                                                 | Unit tests; Trivy; least-privilege role review                                                                                                                                          |
| T15 | Phishing from the preview domain                          | A malicious app mimics the studio login                              | The preview domain is visibly different; the studio never asks for credentials inside the canvas; previews aren't publicly indexed (`X-Robots-Tag: noindex`), and capabilities expire                                                                                                                                                | Review                                                                                                                                                                                  |
| T16 | Data exfiltration from the user's browser by preview JS   | Beacons to an attacker                                               | The preview gateway sends a CSP on preview documents: `connect-src 'self' ws(s)://<same host>`, `form-action 'self'`, `frame-ancestors <studio origin>`; images and fonts are limited to `'self' data: blob:` in 2.6                                                                                                                 | E2E: an external fetch from the preview is blocked by CSP                                                                                                                               |

**T16 trade-off:** user apps can't call external APIs from the preview in 2.6. Allowing specific hosts per project is a deliberate later feature with its own review.

## 4. Browser-side configuration

**Studio iframe:**

```html
<iframe
  src="{previewUrl}"
  sandbox="allow-scripts allow-same-origin allow-forms allow-modals"
  allow="clipboard-read 'none'; clipboard-write 'none'; camera 'none'; microphone 'none'; geolocation 'none'"
  referrerpolicy="no-referrer"
  title="Live preview of {page name}"
>
</iframe>
```

- **Why `allow-same-origin` is safe here:** the preview origin is cross-site. The flag only lets the frame keep _its own_ origin, which is needed for exact origin checks, Vite module loading and HMR. It is unsafe only when the framed origin equals the parent's, which the configuration validation forbids.
  - The API refuses to start if `PREVIEW_ORIGIN_PATTERN` shares a registrable domain with `PUBLIC_APP_ORIGIN`.
  - Locally it must be an IP literal while the studio uses a host name.
- **Studio CSP addition:** `frame-src <preview origin pattern>` only, e.g. `https://*.core-preview.example.net` or `http://127.0.0.1:8091-8093`. `connect-src` is unchanged (`'self'`).

**Gateway response headers on preview documents:**

- `Content-Security-Policy`: `frame-ancestors <studio origin>`, the `connect-src`/`form-action` rules above, `base-uri 'self'`.
- `Referrer-Policy: no-referrer`.
- `X-Robots-Tag: noindex`.
- `Cross-Origin-Resource-Policy: same-site`.
- `Permissions-Policy` restrictive.

## 5. Identity and secrets

| Hop                                      | Mechanism                                                                                                                                                       |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Studio → API                             | Existing session cookie + CSRF + permissions (`projects:read` to view a preview)                                                                                |
| API → gateway control                    | IdP JWT (client credentials locally, managed identity in Azure), audience `api://core-preview-gateway`, caller allow-list; the same validation code as ADR-0011 |
| Gateway → API (boot reconciliation only) | Gateway managed identity → API internal endpoint, allow-listed caller                                                                                           |
| Gateway → ACA pool                       | Gateway managed identity with **Azure ContainerApps Session Executor** on that pool only                                                                        |
| Gateway → agent                          | 256-bit random token per session, generated by the gateway at lease time, compared in constant time; never leaves the gateway and the sandbox                   |
| Browser → preview                        | The capability in host or path; no cookies                                                                                                                      |

No component in the preview zone can obtain provider keys, database credentials, storage keys or Key Vault access.

## 6. Exposure gate

- `FEATURE_CANVAS`: `off | internal | public`. `internal` allows the canvas only for company admins and allow-listed teams (`CANVAS_INTERNAL_TEAM_IDS`).
- Production configuration **refuses `public`** unless all of these hold:
  - `PREVIEW_PROVIDER` is `aca-sessions` or `aci` (not `compose-pool`).
  - The preview origin is on a separate registrable domain.
  - The egress-disabled check from spike S1 is recorded as passed (`PREVIEW_ISOLATION_VERIFIED=<date>` set by the operator after the security review).
- This replaces the earlier rule from the Phase 2 plan, §5.6 item 6, with concrete conditions.

## 7. Logging, audit, monitoring

- **Audit events:** `preview.session_started`, `preview.session_stopped` (with reason), `preview.quota_exceeded`, `preview.isolation_violation_suspected`. The last one is raised when the gateway sees a sandbox opening an unexpected connection.
- **Never logged:** capabilities, agent tokens, file contents, raw build errors beyond a bounded, sanitised message.
- **Alerts:** a crash-loop rate per team, quota saturation, egress-denied counters from the session pool (if exposed) and NSG logs for the ACI fallback.

## 8. Residual risks

| ID  | Risk                                                                                         | Status                                                                                                                                                                                         |
| --- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | Local provider shares the developer's kernel                                                 | Accepted for local/CI only; production refuses `compose-pool`                                                                                                                                  |
| P2  | Vite dev server vulnerabilities (dev servers aren't hardened for the internet)               | Reachable only through the gateway with a capability; Vite is pinned and patched via image rebuilds; `server.fs.strict` and `allowedHosts` set; consider a production-build preview mode later |
| P3  | The user's own browser can still be attacked by preview content (malicious app in an iframe) | Same as visiting any website; CSP and sandbox flags limit it; previews aren't public                                                                                                           |
| P4  | ACA dynamic sessions behaviour not yet proven for this use                                   | Spike S1 is a hard gate for `public`                                                                                                                                                           |
