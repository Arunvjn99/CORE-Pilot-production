# Phase 2 — Product Shell, Identity, AI Provider Settings, Canvas Foundation

Status: **Proposed — decisions D1–D8 answered; awaiting final approval. No implementation started.**
Builds on Phase 1 (`d62a709`). Nothing in Phase 1 is rewritten; additions only.

## 0. Scope and one sequencing change

The direction asks for provider settings (org/personal/platform credentials) and a canvas, with "no authentication shortcuts". Credential ownership, RBAC and tenant isolation all depend on knowing **who** the user is and **which organization** they act for. So identity (originally Phase 2 in the roadmap) is the first slice of this phase, not skipped. Everything else follows the vertical-slice order in §7.

**Target journey (acceptance):** sign in → open project dashboard → open a project → canvas loads a real React page in an isolated preview → select an element (highlight + layer tree sync) → change a property (text / class-based style) in the inspector → the source file is edited via AST and the preview hot-reloads → save a checkpoint (git commit) → undo/redo works across the edit.

**Out of scope for Phase 2:** agents and AI-generated screens (Phase 4), CORE component registry content (Phase 5, blocker B1), AI-assisted element editing (needs agents), Figma/Azure Boards, public exposure of the canvas (see §5.6).

## 1. System view (Phase 2)

```
 Browser (studio origin)                         Browser iframe (preview origin, separate site)
 ┌───────────────────────────────┐   penpal RPC   ┌──────────────────────────────────┐
 │ apps/web  Vite SPA            │◄──────────────►│ preview client script (injected) │
 │  shell · dashboard · canvas   │ origin-pinned, │  hit-testing, overlays data,     │
 │  inspector · layers · code    │ zod-validated  │  DOM→oid, error forwarding       │
 └──────────────┬────────────────┘                └───────────────▲──────────────────┘
                │ same-origin /api (cookie session, CSRF token)   │ HTTP (Vite dev server + HMR)
 ┌──────────────▼────────────────────────────┐   internal, signed  ┌──────────────────────────┐
 │ apps/api  NestJS (control plane + BFF)     │ ───file sync────► │ services/preview-runtime   │
 │  auth (Entra OIDC) · orgs · RBAC · audit   │   + build status  │  Node, UNTRUSTED zone      │
 │  projects · pages · edits · checkpoints    │ ◄──diagnostics──  │  Vite + oid plugin         │
 │  provider settings · credential WRITE only │                   │  no secrets, no egress,    │
 │  packages/code-edit (AST edits, limits)    │                   │  read-only rootfs + tmpfs  │
 └───────┬───────────────┬─────────────┬──────┘                   └──────────────────────────┘
         │               │             │ internal, service-authenticated
   PostgreSQL (RLS)   Redis       ┌────▼───────────────────────────────┐
   + project git repos (volume)   │ services/ai-runtime (FastAPI)       │
                                  │  llm_gateway: adapters, test, model │
                                  │  discovery, capability check;       │
                                  │  credential UNWRAP only here        │
                                  └────────────────┬────────────────────┘
                                         Key Vault (Azure) / local KEK (dev only)
```

Trust zones: **studio** (web + api, privileged), **AI runtime** (holds plaintext keys transiently), **preview** (untrusted generated code; never holds credentials, cannot reach api/ai-runtime/DB, serves on a different origin).

## 2. Component breakdown

### 2.1 Identity, tenancy, RBAC (`apps/api/src/identity`, `apps/api/src/orgs`)

- **OIDC Authorization Code + PKCE against Microsoft Entra ID**, done server-side in the BFF with `openid-client`. Tokens never reach the browser.
- **Session:** opaque session ID cookie (`__Host-core_sid`, HttpOnly, Secure, SameSite=Lax, Path=/). The session record lives in Redis with idle and absolute timeouts. Revocation is per session or for all of a user's sessions.
- **CSRF:** synchronizer token from `GET /auth/session`, sent as `x-csrf-token` on every unsafe method, with an Origin check as well.
- **Users** are linked to Entra (`tid`, `oid`); organizations are linked to Entra tenants (decision D2).
- **Roles:** `org_owner`, `org_admin`, `designer`, `viewer`, plus a platform-level `platform_admin`.
- **Permission checks** are explicit (`@RequirePermission('providers:manage')`) and evaluated server-side against the membership. Every tenant query runs through `withTenant()` (Phase 1 RLS).
- **Audit events** for sign-in/out, membership changes, credential create/rotate/revoke, provider policy changes, checkpoints. Secret values are never recorded.
- **Local dev and CI:** a real OIDC flow against a local standards-compliant test IdP container (decision D1). Production config refuses any issuer other than the configured Entra tenant(s). This is not a bypass: the same code path runs, only the issuer differs, and it is guarded by `NODE_ENV`.

### 2.2 Product shell (`apps/web`)

- **Layout:** app shell (top bar with org switcher and user menu; left nav: Projects, Settings), `ProjectDashboard`, `ProjectWorkspace` (pages list), `CanvasWorkspace`, `AiAssistantPanel`, `Settings` → AI Providers / Agent Models / Design Systems.
- **UI primitives:** Radix UI with Tailwind and the shell tokens from Phase 1, lucide icons, React Hook Form with Zod resolvers using the shared contracts.
- **AI assistant panel:** a docked panel in the canvas. In Phase 2 it shows the selected-element context and a clearly labelled "Agents arrive in Phase 4" state. It never fakes responses.
- **Design system settings:** lists registered design systems and versions (registry table, empty until B1), and lets an org admin choose the project default. No component metadata is invented.

### 2.3 AI Provider Settings — control plane (`apps/api/src/llm-config`) + gateway (`services/ai-runtime/llm_gateway`)

- **Provider catalog:** a code-registered adapter list in ai-runtime (`openai`, `anthropic`, `gemini`, `azure_openai`, `ollama`) exposed via `GET /internal/providers`. Adding a provider means adding an adapter, with no schema change.
- **Credentials have 3 scopes:** `organization`, `user` (personal) and `platform`.
  - **Encryption:** envelope encryption, AES-256-GCM. A random data key (DEK) per credential encrypts the secret; the DEK is wrapped by a key-encryption key (KEK). In Azure the KEK lives in Key Vault (RSA-OAEP-256 / HSM-backed), and only the KEK id and version are stored.
  - **API is write-only (Key Vault `wrapKey` only):** it encrypts on create/rotate and can never decrypt.
  - **ai-runtime is the only decryptor (`unwrapKey` only):** it decrypts in memory per call and never logs or returns the value.
  - **Local dev:** a local KEK from `.env` behind the same `KeyWrapper` interface. Startup refuses the local wrapper when `NODE_ENV=production`.
  - **Display data:** the API stores a display hint (provider, label, last 4 characters, created and rotated dates). The secret is never echoed back.
- **Credential precedence** when resolving the credential for a call (snapshotted per execution):
  1. Explicit credential in the agent assignment.
  2. The user's personal credential for that provider, if org policy `allowPersonalCredentials`.
  3. Org default credential for the provider.
  4. Platform-managed credential, if the org is entitled (`allowPlatformCredentials`).
  5. Otherwise, fail with `NO_CREDENTIAL`. There is never a silent fallback to another provider.
- **Test connection:** the API calls `POST ai-runtime /internal/credentials/{id}/test`. The gateway unwraps the key, makes a minimal list-models or ping call with a short timeout, and returns `ok | auth_failed | unreachable | rate_limited` plus latency. The raw provider error is not passed through.
- **Model discovery:** `POST /internal/credentials/{id}/models` lists models where the provider supports it (Ollama/OpenAI/Gemini/Anthropic list endpoints; Azure OpenAI lists deployments). It merges with a curated **capability catalog** (`chat`, `structured_output`, `tools`, `streaming`, `vision`, `embeddings`, `context_window`) kept in code and versioned. Unknown models are marked `capabilities: unverified` and cannot be assigned to an agent that requires a capability.
- **Defaults and per-agent assignment:** an org default (provider, model, credential policy) plus per agent-role assignments (`master`, `requirement`, `research`, `ux`, `design_system`, `ui_generation`, `validation`, …). Each change bumps `llm_config_versions.version`. Phase 4 executions snapshot the version.
- **Runtime switching** is configuration-only: data in PostgreSQL with short Redis cache invalidation, so no redeploy.
- **Adapter implementation (decision D5):** either the LiteLLM Python SDK (MIT core; never the `enterprise/` path) behind our `ProviderAdapter` interface, or thin first-party adapters using official SDKs. Recommendation: LiteLLM SDK as an adapter backend for chat/test/models, wrapped so it can be swapped.

### 2.4 Projects, pages, source of truth (`apps/api/src/projects`)

- A project owns **one git repository** (bare repo, isomorphic-git) holding a real React app (Vite + React + TS template in `templates/react-app`, versioned). **The repo is the source of truth.** DB rows hold metadata and indexes only.
- **Pages** are derived from a route manifest in the repo (`src/routes.tsx` convention for Phase 2) and cached in DB for navigation.
- **Working tree:** each project has a working copy on the server. Edits apply to it, checkpoints commit it, and the canvas shows working-tree state.
- **Repo storage (decision D6):** a persistent volume (local Docker volume; Azure Files in ACA). Repos are never stored in the preview zone.

### 2.5 Code-edit engine (`packages/code-edit`, used by API and by the preview Vite plugin)

- **Parser:** `@babel/parser` with JSX/TS, `recast` for printing so untouched code keeps its formatting, `prettier` for edited ranges only.
- **Stable element IDs (oid):** deterministic `oid = base32(sha256(relativePath + "#" + jsxElementPath)).slice(0, 12)`, where `jsxElementPath` is the chain of child indexes among JSX elements from the component root.
  - **Never written into source:** unlike Onlook, there is no `data-oid` in customer code, so nothing needs stripping on export.
  - **Shared algorithm:** the same pure function runs in the API (indexing) and in the preview Vite plugin (injection as `data-core-oid` at transform time). Both sides agree by construction.
  - **Re-indexing:** after every edit the API re-indexes the touched file and returns the new oid map. Edits that move elements return an `oidRemap` so selection follows the element.
- **Edit operations (typed, validated, both visual and future AI edits use the same layer):**
  - Phase 2: `setText`, `setClassName` (tailwind-merge aware), `setProp` (literal values only), `removeElement`, `duplicateElement`, `moveElement` (same parent).
  - Every op returns its **inverse op** (for undo) and a unified diff.
- **Limits:** max file size, AST node count and edit wall-clock; parse failures are reported, never thrown raw. Edits are rejected if the result does not re-parse. Type-checking of the edited project happens in the preview build (diagnostics surfaced) in Phase 2; full `tsc` validation lands in Phase 6.

### 2.6 Preview runtime (`services/preview-runtime`) — untrusted zone

- **Process:** a Node service hosting a Vite dev server per active project workspace with the `@core-studio/vite-plugin-oid` plugin and an injected preview client script.
- **File sync:** the API pushes the working tree (and later diffs) over an internal endpoint authenticated with a short-lived HMAC-signed token (mutual secret held only by the API and preview-runtime; no cloud credentials).
- **Isolation (Phase 2 baseline):**
  - **Container:** separate container, non-root, read-only rootfs plus a tmpfs workspace, `cap_drop ALL`, CPU/memory/pids limits.
  - **Network:** no egress (internal network only; no route to api/ai-runtime/DB/Redis; `npm install` is not allowed). Dependencies come only from a pre-installed, allow-listed template `node_modules` baked into the image.
  - **Origin:** served on a separate origin (local `http://localhost:8090`; Azure: a separate domain such as `*.preview.<domain>`, never a subdomain of the studio host).
- **Iframe:** `sandbox="allow-scripts allow-forms"`, without `allow-same-origin`, so the preview cannot read studio storage even if the origins were confused. The studio pins the preview origin in penpal `allowedOrigins`. The preview pins the studio origin, which it receives via build config and not from the URL.
- **Messages (penpal v8, every payload zod-validated on receipt):** `preview→studio: ready, hover(oid), select(oid, rect, computedStyle subset), domTree(snapshot), error(build|runtime), navigate(path)` and `studio→preview: highlight(oid[]), setViewport, navigate(path), reload`.
- **Per-session/per-tenant container isolation** (Azure Container Apps dynamic sessions or jobs) is the Phase 6/7 target. Until then the canvas is behind a feature flag and not publicly exposed (§5.6).

### 2.7 Canvas workspace (`apps/web/src/features/canvas`)

- **Viewport frame:** desktop 1440, tablet 834 and mobile 390 widths, plus zoom.
- **Selection and hover overlays:** drawn in the studio from rects reported by the preview, re-measured on scroll/resize/HMR.
- **Layers tree:** built from the API oid index (source structure), merged with the DOM snapshot (render presence). Components are shown by name.
- **Properties inspector (Phase 2 set):**
  - Text content, plus a raw className editor and structured controls that map to Tailwind classes: spacing, typography size/weight, colors from tokens, radius, width/height, flex alignment.
  - Literal props only.
  - Each change becomes an edit op (`PATCH`), followed by the server AST edit, HMR, and re-measure.
- **Code panel:** CodeMirror 6, read-only in Phase 2, showing the file and range for the selected element. Editing code directly comes later through the same edit layer.
- **Undo/redo:** a client command stack of `{op, inverseOp, baseRevision}`. Undo sends the inverse op, so no client-side source mutation happens. The server rejects ops whose `baseRevision` is stale (optimistic concurrency) and returns the current state. Stack depth is bounded.
- **Checkpoints:** "Save checkpoint" sends `POST`; the server commits the working tree (message plus author = user), records it in `checkpoints`, and emits an audit event. A checkpoint list supports preview/restore; restore is a new commit, so history is never rewritten.

## 3. API contracts (all under `/api/v1`, cookie session, CSRF on unsafe methods, Zod schemas in `packages/contracts`, OpenAPI generated)

Errors use the Phase 1 envelope. Lists use `?limit&cursor`. Mutations accept `Idempotency-Key`.

### Auth / org

| Method                | Path                               | Notes                                                                     |
| --------------------- | ---------------------------------- | ------------------------------------------------------------------------- |
| GET                   | `/auth/login?returnTo=`            | 302 to Entra; `returnTo` restricted to relative paths                     |
| GET                   | `/auth/callback`                   | code exchange, session creation                                           |
| POST                  | `/auth/logout`                     | revoke session                                                            |
| GET                   | `/auth/session`                    | `{user, organizations[], activeOrganizationId, permissions[], csrfToken}` |
| POST                  | `/orgs/{orgId}/activate`           | switch active org (membership required)                                   |
| GET/POST/PATCH/DELETE | `/orgs/{orgId}/members[/{userId}]` | `members:manage`                                                          |

### AI providers

| Method  | Path                                        | Permission                                                                                                                                                                                 |
| ------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET     | `/llm/providers`                            | catalog with capabilities (`providers:read`)                                                                                                                                               |
| GET     | `/llm/credentials?scope=organization\|user` | metadata only, never the secret                                                                                                                                                            |
| POST    | `/llm/credentials`                          | `{scope, provider, label, secret, endpoint?, apiVersion?, deployment?}`. The secret is write-only. User scope: self only. Org scope: `providers:manage`. Platform scope: `platform_admin`. |
| POST    | `/llm/credentials/{id}/rotate`              | new secret, same id; old ciphertext destroyed                                                                                                                                              |
| DELETE  | `/llm/credentials/{id}`                     | revoke (soft-delete metadata, hard-delete ciphertext)                                                                                                                                      |
| POST    | `/llm/credentials/{id}/test`                | `{status, latencyMs, checkedAt}`                                                                                                                                                           |
| GET     | `/llm/credentials/{id}/models`              | discovered and catalog models with capabilities                                                                                                                                            |
| GET/PUT | `/llm/settings`                             | `{defaultProvider, defaultModel, defaultCredentialId?, allowPersonalCredentials, allowPlatformCredentials, fallbackPolicy: none\|same_provider\|ordered_list}`; returns `configVersion`    |
| GET/PUT | `/llm/agent-assignments`                    | `[{agentRole, provider, model, credentialId?, requiredCapabilities[]}]`; validated against capabilities                                                                                    |

Internal (ai-runtime, not routed through the web): `GET /internal/providers`, `POST /internal/credentials/{id}/test`, `POST /internal/credentials/{id}/models`. Authenticated by service identity (local: signed service token; Azure: managed identity / Entra app role, decision D7).

### Projects / canvas

| Method           | Path                                                   | Notes                                                                                                   |
| ---------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| GET/POST         | `/projects`                                            | create from template                                                                                    |
| GET/PATCH/DELETE | `/projects/{id}`                                       |                                                                                                         |
| GET              | `/projects/{id}/pages`                                 | from route manifest                                                                                     |
| GET              | `/projects/{id}/files?path=`                           | read source (code panel)                                                                                |
| GET              | `/projects/{id}/source-index?file=`                    | oid → `{file, loc, component, tagName, editableProps}` + tree                                           |
| POST             | `/projects/{id}/edits`                                 | `{baseRevision, op}` → `{revision, inverseOp, diff, oidRemap, index}`; 409 on stale revision            |
| GET/POST         | `/projects/{id}/checkpoints`                           | list / create `{message}`                                                                               |
| POST             | `/projects/{id}/checkpoints/{cid}/restore`             | creates a new commit                                                                                    |
| POST             | `/projects/{id}/preview-session`                       | starts/attaches the preview; returns `{previewUrl, previewOrigin, expiresAt}` (signed, short-lived URL) |
| GET              | `/design-systems` · PUT `/projects/{id}/design-system` | registry list / select                                                                                  |

## 4. Data model changes (Drizzle migrations; all tenant tables have `organization_id`, forced RLS)

| Table                                      | Key columns                                                                                                                                                                                                 | Notes                                                                   |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `users`                                    | id, entra_tenant_id, entra_object_id (unique pair), email, display_name, status                                                                                                                             | Global (not tenant-scoped); readable only via membership joins          |
| `organization_memberships`                 | org_id, user_id, role, status                                                                                                                                                                               | RLS by org                                                              |
| `organizations`                            | + entra_tenant_id, llm_policy jsonb                                                                                                                                                                         | Extends Phase 1 table                                                   |
| `llm_credentials`                          | id, org_id, scope (`organization`/`user`), owner_user_id?, provider, label, ciphertext, iv, auth_tag, wrapped_dek, kek_id, kek_version, display_hint, endpoint?, status, created_by, rotated_at, revoked_at | RLS by org, plus an owner check for user scope (policy + service check) |
| `platform_llm_credentials`                 | same crypto columns, no org                                                                                                                                                                                 | Not RLS-tenant; only `platform_admin`; separate grants                  |
| `org_platform_entitlements`                | org_id, provider, allowed                                                                                                                                                                                   | Which orgs may use platform keys                                        |
| `llm_settings`                             | org_id, default_provider, default_model, default_credential_id, fallback_policy, config_version                                                                                                             | RLS                                                                     |
| `llm_agent_assignments`                    | org_id, agent_role, provider, model, credential_id?, required_capabilities[], config_version                                                                                                                | RLS; unique (org, role)                                                 |
| `llm_config_versions`                      | org_id, version, snapshot jsonb, changed_by, changed_at                                                                                                                                                     | Immutable history for reproducible snapshots                            |
| `projects`                                 | id, org_id, name, template_id, template_version, repo_path, head_revision, design_system_id?, created_by                                                                                                    | RLS                                                                     |
| `project_pages`                            | project_id, route, file_path, title                                                                                                                                                                         | Derived cache                                                           |
| `project_edits`                            | id, project_id, revision, actor_id, op jsonb, inverse_op jsonb, file_path, created_at                                                                                                                       | Append-only edit journal (audit and undo integrity)                     |
| `checkpoints`                              | id, project_id, commit_sha, message, author_id, created_at, restored_from?                                                                                                                                  | RLS                                                                     |
| `design_systems`, `design_system_versions` | id, name, package, version, status                                                                                                                                                                          | Platform registry (empty until B1)                                      |

Sessions are stored in Redis (TTL) and not in PostgreSQL. All create/rotate/revoke/policy changes write `audit_events`.

## 5. Security requirements and how they are met

1. **No secrets in the browser:** credentials are write-only via the API; responses hold metadata only. The ESLint ban on `localStorage` stays. CSP `connect-src 'self'`.
2. **No secrets in logs:** pino/structlog redaction covers `secret`, `apiKey`, and `authorization` in nested paths. Tests assert redaction on credential endpoints.
3. **Least-privilege crypto split:** API can wrap only, AI runtime can unwrap only (Key Vault RBAC). Locally this is simulated by giving the API process no unwrap code path.
4. **Session security:** `__Host-` cookie, rotation on login, idle and absolute timeouts, CSRF, re-auth not required for Phase 2 but planned for credential changes (decision D8).
5. **RBAC tests:** every endpoint gets an authorization test matrix (role × endpoint → expected status). Cross-tenant tests for every new table.
6. **Canvas exposure gate:**
   - The canvas route and preview-runtime are behind `FEATURE_CANVAS=internal`. Production config refuses `public` until per-session container isolation, egress controls and a security review are complete (Phase 6/7).
   - The preview is never on the studio site, never sandboxed with `allow-same-origin`, and holds no credentials.
7. **Code-edit hardening:** parse/edit only (no execution) in the API, with size, node and time limits, and paths constrained to the project repo (no `..`, no symlinks).
8. **Internal service auth** between api, ai-runtime and preview-runtime: signed short-lived tokens locally; Entra managed identity in Azure (D7).

## 6. Dependencies to add (versions checked 2026-11-09; final check at install, recorded in DEPENDENCY_REGISTER)

| Package                                                                          | Version                                  | Licence        | Where               | Why                                                                                                  |
| -------------------------------------------------------------------------------- | ---------------------------------------- | -------------- | ------------------- | ---------------------------------------------------------------------------------------------------- |
| openid-client                                                                    | 6.8.9                                    | MIT            | api                 | Entra OIDC (certified client)                                                                        |
| @azure/identity, @azure/keyvault-keys                                            | 4.14.1 / 4.10.2                          | MIT            | api (wrap)          | KEK in Key Vault                                                                                     |
| isomorphic-git                                                                   | 1.44.11                                  | MIT            | api                 | Project repos, checkpoints (pure JS, no git binary)                                                  |
| @babel/parser, @babel/traverse, @babel/types                                     | 8.1.0                                    | MIT            | code-edit           | AST                                                                                                  |
| recast                                                                           | 0.24.3                                   | MIT            | code-edit           | Formatting-preserving printing                                                                       |
| prettier (runtime use)                                                           | 3.9.10                                   | MIT            | code-edit           | Format edited ranges                                                                                 |
| tailwind-merge                                                                   | 3.7.0                                    | MIT            | code-edit, web      | Class conflict resolution                                                                            |
| penpal                                                                           | 8.0.1                                    | MIT            | web, preview client | Origin-checked iframe RPC                                                                            |
| radix-ui                                                                         | 1.8.1                                    | MIT            | web                 | Accessible primitives                                                                                |
| react-hook-form, @hookform/resolvers                                             | 7.91.0 / 7.0.5                           | MIT            | web                 | Forms (provider settings)                                                                            |
| lucide-react                                                                     | 1.70.0                                   | ISC            | web                 | Icons                                                                                                |
| @uiw/react-codemirror / @codemirror/*                                            | 4.25.12 / 6.x                            | MIT            | web                 | Code panel (CodeMirror chosen over Monaco: smaller, no `unsafe-eval` or blob-worker CSP relaxations) |
| motion                                                                           | 14.10.1                                  | MIT            | web                 | Restrained panel/overlay transitions (respects reduced motion). Optional; drop if not needed.        |
| Python: litellm _(D5)_, cryptography, azure-identity, azure-keyvault-keys, httpx | latest stable                            | MIT/Apache/BSD | ai-runtime          | Adapters, AES-GCM, unwrap                                                                            |
| Test IdP container _(D1)_                                                        | e.g. `ghcr.io/navikt/mock-oauth2-server` | MIT            | compose/CI only     | Local OIDC                                                                                           |

Not adding: express-session/connect-redis (a small typed session store on the existing ioredis is enough, and NestJS-native), Monaco, Fabric.js, any WebContainer/CodeSandbox SDK, LangGraph (Phase 4).

## 7. Implementation sequence (each slice ends green: lint, types, unit, integration, E2E, Trivy, docs)

| #    | Slice                                                                                                                                                                | Done when                                                                                                                    |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 2.1  | Identity and sessions (OIDC BFF, users, memberships, RBAC guard, CSRF, audit, test IdP in compose/CI)                                                                | Sign-in/out E2E; RBAC matrix and cross-tenant tests pass                                                                     |
| 2.2  | Product shell (nav, org switcher, dashboard, settings frame, assistant panel placeholder, a11y)                                                                      | E2E navigation + axe clean; light/dark                                                                                       |
| 2.3  | Credential vault (KeyWrapper: Key Vault + local; envelope crypto in API; unwrap in ai-runtime; CRUD/rotate/revoke)                                                   | Crypto unit tests; "API cannot decrypt" test; redaction tests; audit entries                                                 |
| 2.4  | LLM gateway v0 in ai-runtime (adapter interface, 5 adapters, test + model discovery, capability catalog) and provider settings UI (credentials, defaults, per-agent) | Adapter contract tests with recorded HTTP fixtures; one optional live smoke per provider when a test key is supplied; UI E2E |
| 2.5  | Projects and repos (template, isomorphic-git repo, pages manifest, dashboard create/open)                                                                            | Integration tests on repo lifecycle, RLS                                                                                     |
| 2.6  | code-edit package (oid algorithm, index, 6 ops with inverse, limits)                                                                                                 | Property-style tests: op∘inverse = identity; oid stability across unrelated edits; malicious inputs rejected                 |
| 2.7  | Preview runtime (container, oid Vite plugin, client script, file sync, separate origin, no egress)                                                                   | Container test: no egress, no secrets in env; Trivy clean                                                                    |
| 2.8  | Canvas (iframe + penpal, overlays, layers, inspector, viewports, code panel)                                                                                         | E2E: select → highlight → layer sync                                                                                         |
| 2.9  | Edit loop, undo/redo, checkpoints                                                                                                                                    | **Full journey E2E** (§0) incl. stale-revision conflict and restore                                                          |
| 2.10 | Usage & metrics dashboard (§9)                                                                                                                                       | Ingestion/RLS/permission/rollup tests; E2E shows recorded activity                                                           |

## 8. Decisions (answered 2026-11-09)

| ID  | Decision                                         | Answer → consequence                                                                                                                                                                                                                                                        |
| --- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Entra dev app registration                       | **Not available yet.** The local/CI OIDC test server is used. The Entra issuer, client and redirect config are env-only and plug in when a registration exists. Production refuses a non-Entra issuer.                                                                      |
| D2  | Tenancy                                          | **Single company, single Entra tenant, many organisations/teams inside it.** The RLS isolation built in Phase 1 is kept per team. Users from other Entra tenants are rejected (`tid` must match the configured tenant). No cross-company features.                          |
| D3  | Personal credentials                             | **Allowed**, governed by the team policy toggle                                                                                                                                                                                                                             |
| D4  | Platform-managed credentials                     | **Owned and managed at the organisation level** (company admins); teams are entitled individually                                                                                                                                                                           |
| D5  | LiteLLM SDK behind our adapter interface         | **Yes**                                                                                                                                                                                                                                                                     |
| D6  | Project repo storage                             | **App-owned repo store (Azure Files) is the source of truth, with optional sync/export to Azure DevOps Repos.** Push uses a team-configured Azure DevOps connection (Phase 2 builds the store; the Azure Repos push is a follow-up slice after Phase 2 unless prioritised). |
| D7  | Service-to-service auth via managed identity     | **Yes**                                                                                                                                                                                                                                                                     |
| D8  | Step-up re-authentication for credential changes | **Yes, in Phase 2.** Adding, rotating or revoking a credential or changing platform entitlements requires a fresh sign-in (`auth_time` within 10 minutes, `prompt=login` / `max_age`). Enforced server-side.                                                                |

Terminology after D2: "organisation" in the schema is a **team/workspace** inside the company. The company-level admin role is `platform_admin`.

## 9. Usage & metrics dashboard (added per review)

**Goal:** a product usage dashboard covering token and cost usage per screen/page, project, agent, provider/model, user and team over time, plus product activity metrics. **Only real recorded data is shown; no mock or estimated numbers.**

### 9.1 What is recorded

| Event                                                      | Producer                                                      | Attribution fields                                                                                                                                                                                                                              |
| ---------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `llm_call`                                                 | ai-runtime gateway, **every** model call (success or failure) | team, user, project, page/screen, agent_role, execution_id, provider, model, credential_scope (never the id of a secret value), input/output/cached tokens, cost (computed from versioned pricing), latency, status/error class, config_version |
| `canvas_edit`, `checkpoint_created`, `checkpoint_restored` | api                                                           | team, user, project, page, op type                                                                                                                                                                                                              |
| `preview_session`, `preview_build_error`                   | api / preview-runtime (via api)                               | team, project, page, duration, error class                                                                                                                                                                                                      |
| `project_created`, `session_started`                       | api                                                           | team, user                                                                                                                                                                                                                                      |

Per-screen token usage appears as soon as model calls carry a `page_id`. In Phase 2 the only model calls are connection tests and model discovery (attributed to settings, not screens). Screen-level token data begins with Phase 4 generation and AI edits, and the schema and dashboard are ready for it.

### 9.2 Data model

| Table          | Notes                                                                                                                                                                                        |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `usage_events` | Append-only, RLS by team, partitioned monthly by `occurred_at`. Columns as in 9.1, plus `event_id` (idempotency key, unique). No prompt or response content is stored.                       |
| `llm_pricing`  | provider, model, input/output/cached price per 1M tokens, currency, `effective_from`. Versioned; cost is computed at ingest with the price version recorded. Admin-editable (company admin). |
| `usage_daily`  | Rollup by day × team × project × page × agent × provider × model × user: calls, tokens, cost, errors, p50/p95 latency. Refreshed incrementally (scheduled job) for fast dashboards.          |

**Ingestion:** ai-runtime → `POST /internal/usage-events` (service-authenticated, batch, idempotent). Phase 4 moves this onto Azure Service Bus for durability. Retention is configurable (default 13 months raw, rollups kept); this is a governance decision to confirm.

### 9.3 API

| Method  | Path                                                                                          | Notes                                                                     |
| ------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| GET     | `/usage/summary?from&to&teamId?`                                                              | totals: tokens, cost, calls, error rate, active users, edits, checkpoints |
| GET     | `/usage/timeseries?metric&interval=day\|week&from&to&groupBy?`                                | metric ∈ tokens, cost, calls, errors, latency_p95, edits                  |
| GET     | `/usage/breakdown?dimension=page\|project\|agent\|model\|provider\|user&from&to&limit&cursor` | ranked table, e.g. **per-screen token usage**                             |
| GET     | `/usage/export?…`                                                                             | CSV export of the breakdown (audited)                                     |
| GET/PUT | `/admin/llm-pricing`                                                                          | company admin                                                             |

**Permissions:**

- `usage:read:team`: team admins see their team.
- `usage:read:all`: company admin sees all teams.
- Every user sees their own personal usage.
- Per-user breakdowns are visible only to admins (privacy).

### 9.4 UI

**Usage** in the main nav (`/usage`):

- KPI row: tokens, cost, calls, error rate, active users.
- Tokens/cost over time, by provider/model.
- Ranked tables: **screens by token usage**, projects, agents, users (admin only).
- Filters: date range, team, project, provider, agent.
- Drill-down: project → pages → individual calls (metadata only).
- CSV export.

A project-level "Usage" tab shows the same views scoped to the project. Charts follow the shared dataviz standards (accessible colours, keyboard and screen-reader tables behind every chart, light/dark). The chart library is chosen and recorded at the slice.

**Operational metrics** (latency, error rates and saturation for SRE) go through OpenTelemetry → Application Insights. The product dashboard is for usage and cost, not infrastructure health.

### 9.5 Slice

Added as **2.10 Usage & metrics**: tables, ingestion, rollups, API, dashboard. Done when ingestion idempotency, RLS, permission-matrix and rollup-correctness tests pass and the E2E shows recorded edits/checkpoints/test-calls in the dashboard. Slice 2.4 already emits `llm_call` events, so the gateway records usage from its first call.

ADRs to be written with the slice that implements them: ADR-0009 Identity and BFF sessions, ADR-0010 Credential envelope encryption and crypto split, ADR-0011 Source-derived oids (not persisted), ADR-0012 Edit operations, undo and checkpoints, ADR-0013 Preview runtime isolation baseline and exposure gate, ADR-0014 Usage metering and attribution. ADR-0005 (LLM gateway) and ADR-0006 (canvas) move to Accepted once D5 is decided and 2.9 lands.
