# Preview service architecture

Status: **Approved 2026-11-09.** Part of [SLICE_2_6_ARCHITECTURE.md](SLICE_2_6_ARCHITECTURE.md). Security details are in [PREVIEW_SECURITY_MODEL.md](PREVIEW_SECURITY_MODEL.md).

## 1. Components

| Component                                                      | Runs where               | Responsibilities                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **preview-sessions** module in `apps/api`                      | Privileged zone          | Session records, quotas, start/attach/stop, viewer heartbeats, snapshot and file pushes, health reconciliation, status for the studio                                                                                                                                                                                           |
| **`services/preview-gateway`** (Node, new deployable)          | Edge of the preview zone | 1) Browser data plane: routes `s-<capability>` hosts (or local ports) to the right sandbox, including the HMR WebSocket. 2) Control plane for the API only: allocate/release sandboxes, forward workspace pushes and status calls. 3) Sandbox provider adapter: `compose-pool` locally, `aca-sessions` in Azure, `aci` fallback |
| **`services/preview-agent`** (image, one instance per sandbox) | Inside the sandbox       | Lease handshake; receive a workspace snapshot and file patches into tmpfs; run Vite with the oid plugin and inspector injection; report status, build errors and readiness; exit on release                                                                                                                                     |
| **`packages/project-template`**                                | Build time               | Template sources and the allow-listed dependency set baked into the agent image                                                                                                                                                                                                                                                 |
| **`@core-studio/vite-plugin-oid`** (in `packages/code-index`)  | Inside the sandbox       | Injects `data-core-oid` / `data-core-instance` during transform                                                                                                                                                                                                                                                                 |
| **Inspector script** (`packages/preview-inspector`)            | Inside the preview page  | Hover, select and DOM tree reporting, error capture and the studio protocol; served by the agent from the preview origin                                                                                                                                                                                                        |

## 2. Why this shape

- **One sandbox per session** isolates projects from each other at the container (local) or VM (Azure) boundary.
- **No Docker socket and no orchestrator holding host privileges.** Locally a fixed pool of identical single-use containers is recycled by exiting; Compose restarts it clean, because tmpfs is emptied on restart. In Azure the platform creates and destroys sessions.
- **The API never proxies preview traffic,** so studio cookies and CSRF state never sit beside untrusted content.
- **The gateway is stateless.** Its session → sandbox map is rebuilt from the API on start, and the API's database is authoritative.
- **Same agent image and HTTP contract in every environment.** Only the provider adapter in the gateway differs.

## 3. Sandbox providers (evaluated)

| Option                                                           | Isolation                                        | Start time                     | Network control                                                  | Fit                                                                                                       | Verdict                                                                                                                       |
| ---------------------------------------------------------------- | ------------------------------------------------ | ------------------------------ | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **ACA dynamic sessions, custom container**                       | Hyper-V sandbox per session                      | Seconds from a pre-warmed pool | Egress can be disabled per pool; no managed identity on sessions | Same Container Apps environment and platform as the rest; scale to zero; billed for running pool capacity | **Recommended for Azure**, pending spike S1 (WebSocket through the pool endpoint, cold/warm start, egress-disabled behaviour) |
| ACI container group per session                                  | Hyper-V (ACI)                                    | Tens of seconds                | VNet subnet + NSG deny-all egress                                | Separate service and billing; slower                                                                      | **Fallback** behind the same provider interface                                                                               |
| ACA app or job per session                                       | Container on a shared-kernel node                | Tens of seconds                | Environment-level only                                           | One app per session doesn't scale and is slow                                                             | Rejected                                                                                                                      |
| Shared preview container with many Vite processes (earlier plan) | Process only                                     | Fast                           | Shared                                                           | Cross-project leakage                                                                                     | Rejected                                                                                                                      |
| AKS with gVisor/Kata                                             | Strong                                           | Fast                           | Full                                                             | A new platform to operate                                                                                 | Rejected for now (no team to run it)                                                                                          |
| WebContainers / CodeSandbox / StackBlitz                         | Browser or vendor VM                             | Fast                           | Vendor                                                           | Commercial licence; third-party execution of customer code                                                | Rejected (ADR-0006)                                                                                                           |
| Local: Compose pool of single-use containers                     | Container (shared kernel) on a developer machine | ~2 s (Vite cold start)         | `internal: true` network                                         | No socket, same images                                                                                    | **Local/CI provider**                                                                                                         |

## 4. Session model

```
preview_sessions (migration 0008)
  id uuid PK, project_id, organization_id (composite FK, forced RLS)
  ref text NOT NULL DEFAULT 'main'                  -- working tree served (agent branches later)
  status preview_status NOT NULL                    -- starting | syncing | ready | error | stopping | stopped
  provider text NOT NULL                            -- compose-pool | aca-sessions | aci
  sandbox_ref text                                  -- opaque provider id (pool slot / ACA identifier)
  capability_hash text NOT NULL                     -- sha256 of the host/path capability; raw value only in the gateway and the URL
  preview_origin text NOT NULL
  synced_revision bigint                            -- working revision the sandbox has
  error_code text, error_detail jsonb (sanitised, bounded)
  started_by uuid, started_at, ready_at, last_heartbeat_at, stopped_at, stop_reason text
  UNIQUE (project_id, ref) WHERE status IN ('starting','syncing','ready')
```

- **Viewers:** each open canvas sends `POST …/heartbeat` every 30 s. Redis keeps `preview:viewers:<sessionId>` with a 90 s TTL per viewer. Once there are no viewers, the session stops after `PREVIEW_IDLE_STOP_SECONDS` (default 600).
- **Quotas:** `PREVIEW_MAX_SESSIONS_PER_TEAM` (default 3) and `PREVIEW_MAX_SESSIONS_GLOBAL` (pool size locally). Above a quota the request returns `429 PREVIEW_QUOTA` with the list of the team's running sessions.
- **Hard limits per session:**
  - 1 vCPU and 2 GiB memory (ACA session sizes; Compose `cpus`/`mem_limit`).
  - 512 pids.
  - 256 MB tmpfs workspace.
  - 4 h maximum lifetime, then a forced stop. The studio offers a restart.

## 5. Lifecycle

```
studio                     api                                gateway                       sandbox (agent)
  │ POST preview-sessions   │                                    │                              │
  ├────────────────────────►│ perms, quota, existing session?    │                              │
  │                         │  yes → attach (+viewer) ──────────────────────────────────────────┐ │
  │                         │  no  → row: starting               │                              │ │
  │                         │ POST /control/sessions (JWT) ─────►│ provider.allocate()          │ │
  │                         │                                    │  → sandbox, agent token      │ │
  │                         │                                    │ POST /lease {token, studioOrigin, sessionId} ─►│
  │                         │◄── {sandboxRef, previewOrigin} ────│                              │ │
  │                         │ status: syncing                    │                              │ │
  │                         │ PUT /control/sessions/:s/workspace (tar.zst @rev N) ─► PUT /workspace ─►│ unpack to tmpfs
  │                         │                                    │                              │ start Vite
  │                         │ poll GET /control/sessions/:s/status ◄──────────────── ready ─────│
  │◄── {status: ready, previewUrl, previewOrigin, revision} ─────│                              │
  │ iframe src=previewUrl ──────────────────────────────────────►│ route by host → sandbox ────►│ Vite + inspector
  │◄═══════ handshake / protocol (see PREVIEW_COMMUNICATION_PROTOCOL.md) ═══════════════════════│
  │ heartbeat every 30 s ──►│                                    │                              │
  │                         │ file write (page create / 2.7 edit) → PATCH workspace files @rev N+1 ─► HMR
  │ close / idle            │ last viewer gone + idle timeout → DELETE /control/sessions/:s ─► /release → exit
```

### Workspace sync

- **Initial:** a `tar` + zstd snapshot of the working tree excluding `.git`, capped at 50 MB, tagged with the working revision.
- **Incremental:** `PATCH /workspace` with `{baseRevision, revision, files: [{path, op: put|delete, contentBase64, sha256}]}`.
  - The agent rejects any patch whose `baseRevision` doesn't match its current revision. The API then re-sends a full snapshot.
  - The agent applies the same path policy as the API (defence in depth) and writes atomically.
  - Vite's watcher triggers HMR.
- The agent's `node_modules` is a read-only bind of the baked dependency directory. The project's `package.json` is checked against the allow-list by the API before sync; a mismatch is `error: dependency_not_allowed`.

### Status and errors reported by the agent (pull model; the agent can't call out)

`GET /status` → `{state: idle|syncing|starting|ready|build_error|crashed, revision, viteReadyAt, lastBuildError?: {file, line, column, message(≤2 KB)}, memoryMb}`

| Failure                                        | Detected by                                                                                          | Result                                           | User sees                                                                |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------ |
| Build/transform error (syntax, missing import) | Vite error hook in the agent; also the inspector overlay message                                     | Session stays `ready` with `buildError`          | Error panel with file:line; canvas still usable for the last good render |
| Runtime error in the app                       | Inspector (`window.onerror`, `unhandledrejection`, React error boundary in the template's `App.tsx`) | Protocol `runtimeError` message                  | Inline error banner; selection disabled until reload                     |
| Vite crash / OOM                               | Agent supervisor; exit code                                                                          | `error: crashed`                                 | "Preview stopped — Restart"                                              |
| Sandbox lost (node recycle, pool restart)      | Reconciler: gateway reports unknown sandbox                                                          | `error: sandbox_lost`                            | Same, auto-restart once if viewers are present                           |
| Sync failure / revision mismatch               | Agent `409`                                                                                          | API re-sends a full snapshot (max 3 attempts)    | Brief "Syncing…"                                                         |
| Allocation failure / quota                     | Gateway or API                                                                                       | `error: capacity` / `429`                        | Message with the team's running sessions                                 |
| Gateway down                                   | API control call fails                                                                               | `error: gateway_unavailable`, retry with backoff | "Preview service unavailable"                                            |

### Restart and refresh

- **Refresh (studio only):** reloads the iframe. No server call.
- **Restart Vite:** `POST …/restart`. The agent restarts Vite on the same workspace.
- **Restart preview:** `POST …/restart?hard=true`. Releases the sandbox, allocates a new one and re-syncs.

### Recovery after restarts

| Restarted | Effect              | Recovery                                                                                                                                                           |
| --------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| API       | Session rows remain | Reconciler on boot: `GET /control/sessions` from the gateway, mark missing ones `error`, release orphans the API doesn't know                                      |
| Gateway   | Routing map lost    | On boot it asks the API (`GET /internal/preview-sessions/active`, service JWT) for the active sessions and re-reads provider state; unknown sandboxes are released |
| Sandbox   | Lost                | `sandbox_lost` → restart flow; the working tree is untouched                                                                                                       |
| Redis     | Viewer counts lost  | Sessions without heartbeats for 90 s are treated as idle; new heartbeats rebuild them                                                                              |

## 6. API contracts

### Studio-facing (`/api/v1`, session cookie, CSRF on unsafe methods, `projects:read` unless noted)

| Method | Path                                                | Body / response                                                                                                                                    |
| ------ | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/projects/:id/preview-sessions`                    | `{}` → `201 \| 200 {id, status, previewUrl?, previewOrigin, revision, expiresAt}`. Attaches if a session exists. Requires `FEATURE_CANVAS` enabled |
| GET    | `/projects/:id/preview-sessions/current`            | Session or `404`                                                                                                                                   |
| POST   | `/projects/:id/preview-sessions/:sid/heartbeat`     | `204`; also returns status changes via `200 {status, revision, buildError?}`                                                                       |
| POST   | `/projects/:id/preview-sessions/:sid/restart?hard=` | `projects:read` (restart is not a write to the project)                                                                                            |
| DELETE | `/projects/:id/preview-sessions/:sid`               | Stops if the caller is the only viewer, otherwise detaches                                                                                         |

Status is delivered by heartbeat responses (30 s) plus short polling (2 s) during `starting`/`syncing`. Server-sent events can replace polling later without contract changes.

### API → gateway (`/control/*`, IdP JWT, audience `api://core-preview-gateway`, caller allow-list — same validation code as the AI runtime, ADR-0011)

| Method | Path                               | Purpose                                                                                                                                                           |
| ------ | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/control/sessions`                | `{sessionId, projectId(opaque), studioOrigin}` → `{sandboxRef, previewOrigin, capability}` (the capability is returned once and stored only as a hash in the API) |
| PUT    | `/control/sessions/:sid/workspace` | Snapshot stream                                                                                                                                                   |
| PATCH  | `/control/sessions/:sid/workspace` | File patch                                                                                                                                                        |
| GET    | `/control/sessions/:sid/status`    | Agent status passthrough                                                                                                                                          |
| POST   | `/control/sessions/:sid/restart`   | Restart Vite or the sandbox                                                                                                                                       |
| DELETE | `/control/sessions/:sid`           | Release                                                                                                                                                           |
| GET    | `/control/sessions`                | Reconciliation listing                                                                                                                                            |

### Gateway → agent (inside the sandbox network only; per-session random 256-bit agent token, constant-time compared)

`POST /lease`, `PUT|PATCH /workspace`, `GET /status`, `POST /restart`, `POST /release`. Browser traffic is forwarded unchanged except: `Host` rewritten, studio headers stripped, and capability checking done in the gateway.

## 7. Preview addressing

| Environment | Preview URL                                                                                                                        | Origin isolation                                                                                                              |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Azure       | `https://s-<26-char base32 capability>.<preview-domain>/` (wildcard DNS and certificate on a domain separate from the studio, D12) | Distinct origin per session; different site from the studio                                                                   |
| Local / CI  | `http://127.0.0.1:<8091-8093>/s/<capability>/` (one port per pool slot; Vite `base` set to the capability path)                    | Different site from the studio (`localhost`) because an IP literal and a host name never share a site; distinct port per slot |

The capability is unguessable, valid only while the session is live, and never logged. Gateway logs record the hash.

## 8. Deployment

### Local (docker-compose, `preview` profile)

```
networks:
  default            (studio services as today)
  preview-edge       gateway ↔ host ports (browser traffic)
  preview-sandbox    internal: true — gateway + preview-1..3 only; no egress, no studio services

services:
  preview-gateway    networks: default (control API, reachable by api only), preview-edge, preview-sandbox
                     listens: :7000 on default (control), :8091-8093 on preview-edge (published 127.0.0.1)
                     binds nothing on preview-sandbox (outbound to agents only)
  preview-1..3       image core-studio/preview-agent:local, networks: preview-sandbox only,
                     read_only, cap_drop ALL, no-new-privileges, user 10001, pids_limit 512,
                     cpus 1, mem_limit 2g, tmpfs /workspace (256m) /tmp, restart: always, no env secrets
```

`docker compose --profile preview up`. The canvas uses `FEATURE_CANVAS=internal`.

### Azure (when someone with access can deploy; Bicep added in this slice but not applied)

- **ACA environment (existing target):**
  - `api`, `web`, `ai-runtime`.
  - `preview-gateway`: external ingress on the preview domain, a managed identity with the **Session Executor** role on the pool only, and internal ingress for the control port.
- **Session pool (`containerType: CustomContainer`):**
  - Agent image from ACR. No secrets and no managed identity.
  - `sessionNetworkConfiguration: EgressDisabled`.
  - `cooldownPeriodInSeconds` aligned to the idle stop.
  - Ready-session count 1–2.
  - Maximum concurrent sessions = the global quota.
- **Storage:** Azure Files (NFS preferred, spike S2) mounted into `api` only. Blob for bundles.
- **Domain:** wildcard DNS + managed certificate for the preview domain on the gateway.

## 9. Cost and scalability

- **Cost drivers:** session pool capacity in vCPU-seconds and GiB-seconds while sessions or ready instances run; the gateway (one small replica, two for HA); Azure Files capacity and transactions; Blob bundles (small).
  - Exact prices depend on region and agreement, so no figures are given here. The spike measures per-session resource use to feed an estimate.
- **Levers:**
  - Idle stop (10 min).
  - Sessions shared per project.
  - Per-team quotas.
  - A small ready pool (0 outside business hours via a schedule).
  - 1 vCPU / 2 GiB sizing validated in the spike.
- **Scale:**
  - The gateway is stateless and horizontally scalable; WebSocket affinity isn't needed because each request is routed by host.
  - Sessions are capped by the pool maximum.
  - The API's preview work is light (snapshots ≤ 50 MB, patches small).
- **Observability:**
  - `preview_session_*` metrics: start latency, ready rate, crash/error codes, active sessions per team.
  - Logs carry `sessionId` and correlation id.
  - Usage events for slice 2.10.

## 10. Testing

- **Agent (unit):** path policy, patch revision checks, lease and token checks, release exit.
- **Gateway (unit):** host/capability routing, control JWT validation (reuses the ADR-0011 tests), header stripping, unknown-host handling.
- **Container tests** (CI, on the real images):
  - No egress: internet, api, postgres, redis, ai-runtime, the gateway control port and 169.254.169.254 all unreachable.
  - No secrets in the environment or the filesystem.
  - Read-only rootfs.
  - Non-root user.
  - Limits enforced (memory hog is killed, fork bomb is contained by pids).
  - tmpfs wiped after release.
- **Integration (compose stack):** start → ready → page create appears via HMR → restart → stop; quota; concurrent projects isolated (project A's files absent in B's sandbox); reconciler after a killed gateway and a killed sandbox.
- **E2E:**
  - Canvas shows the live app.
  - Hover and select report an oid.
  - The studio shows file:line for the selection.
  - A build error is shown with location.
  - Axe on the canvas chrome.
- **Spikes S1/S2 (Azure)** have their own pass criteria in the implementation plan.
