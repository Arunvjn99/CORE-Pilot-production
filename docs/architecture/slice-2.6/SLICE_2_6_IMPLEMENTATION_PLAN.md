# Slice 2.6 implementation plan

Status: **Approved 2026-11-09** (decisions D9–D16 as recommended). 2.6a implemented. Part of [SLICE_2_6_ARCHITECTURE.md](SLICE_2_6_ARCHITECTURE.md).

## 1. Scope

**In 2.6:**

- Repository per project.
- Pages as route files.
- Checkpoints, history and restore (API).
- Backup bundles.
- Code index and oid Vite plugin.
- Preview agent image.
- Preview gateway with the local Compose pool provider.
- Session API and lifecycle.
- Live preview in the canvas section.
- Studio ↔ preview protocol with hover/select.
- Selected element → React source location shown in the studio.
- Azure provider and Bicep written but **not enabled** until the spikes pass.

**Not in 2.6 (→ 2.7):**

- AST edit operations and the `/edits` endpoint.
- Undo/redo.
- The properties inspector and the layers panel UI.
- The code panel.
- The checkpoint UI. The checkpoint _API_ ships in 2.6; a minimal "Save checkpoint" button is included only if time allows.

**Not in Phase 2:** agent worktrees (Phase 4), dependency installation (later slice), Azure Repos sync (after Phase 2), CORE design-system components (Phase 5).

## 2. Sub-slices (each ends green, reviewed and committable)

| #        | Deliverable                             | Main files                                                                                                                                                                                                                  | Done when                                                                                                                                                                                                                                         |
| -------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **2.6a** | Project template v1 + repository module | `packages/project-template`, `apps/api/src/repositories/*`, migration 0008 (repositories, checkpoints, page `file_path`), git CLI in the API image, backfill job, reconciler                                                | New and existing projects have repos; page CRUD writes files and regenerates routes; checkpoint, history and restore work; concurrency gives `409`; path-policy, RLS and recovery tests pass; the generated app passes `vite build` + `tsc` in CI |
| **2.6b** | Code index                              | `packages/code-index` (oid algorithm, index, `oidRemap`, Vite plugin), `GET /code-index/:oid`                                                                                                                               | Property tests show API ids = plugin ids on the corpus; no `data-core-*` in production builds; Redis-cached index per revision                                                                                                                    |
| **2.6c** | Preview agent image                     | `services/preview-agent`, `packages/preview-inspector`, `infrastructure/docker/preview-agent.Dockerfile` (baked allow-listed `node_modules`)                                                                                | Agent unit tests; container tests: no egress, no secrets, read-only, non-root, limits, tmpfs wiped on release; Trivy 0 fixable high/critical                                                                                                      |
| **2.6d** | Gateway + sessions                      | `services/preview-gateway` (compose-pool provider, control API with JWT, data-plane routing), `apps/api/src/preview-sessions/*`, migration additions (`preview_sessions`), Compose `preview` profile, `FEATURE_CANVAS` gate | Start/attach/heartbeat/restart/stop; quotas; reconciler after a gateway, API or sandbox kill; two projects run concurrently and are isolated; HMR shows a newly created page                                                                      |
| **2.6e** | Protocol + canvas frame                 | `packages/preview-protocol`, `apps/web/src/features/canvas/*` (PreviewFrame, status bar, viewport switcher, hover/select overlays, "source" read-out), ESLint wildcard-postMessage ban                                      | E2E: open project → preview ready → hover and select → overlay + `File.tsx:line`; build-error panel; rogue-frame test; axe on canvas chrome; screenshots                                                                                          |
| **2.6f** | Azure provider (dormant) + IaC          | `aca-sessions` provider in the gateway, `infrastructure/bicep/preview/*` (session pool, gateway app, identity, role assignment, Files share, Blob), runbook for spikes S1/S2                                                | Unit tests with a mocked pool API; Bicep `what-if` builds in CI; production config refuses `public` until `PREVIEW_ISOLATION_VERIFIED` is set                                                                                                     |

Order: a → b → c → d → e. f can run in parallel after c. Estimated size is comparable to slices 2.3 + 2.4 together; each sub-slice stops for review.

## 3. Validation spikes (need someone with Azure access — the team can't deploy)

| Spike                                            | Question                                                                                                                  | Pass criteria                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **S1 — ACA dynamic sessions (custom container)** | Can the agent image run Vite in a session with egress disabled, reached through the gateway, including the HMR WebSocket? | 1) Page loads and HMR updates arrive over WebSocket through the pool endpoint. 2) Warm start ≤ 5 s, cold ≤ 30 s. 3) From inside a session: no outbound TCP/DNS, no IMDS token. 4) Session deleted on release. 5) Measured vCPU/GiB use for the cost estimate. **If 1 fails:** check whether full-reload mode is acceptable or switch to the ACI provider |
| **S2 — git on Azure Files**                      | Is git reliable on the share under concurrent API replicas?                                                               | 1000 commit/checkout cycles from 2 replicas with advisory locks, no corruption (`git fsck` clean); p95 commit < 500 ms for a 200-file repo; NFS vs SMB comparison; snapshot restore drill                                                                                                                                                                |
| **S3 — local (no Azure)**                        | Vite 8 on a read-only rootfs with baked `node_modules` and a tmpfs workspace; cold start time; memory footprint           | Ready ≤ 5 s on CI hardware; ≤ 600 MB RSS for the template app                                                                                                                                                                                                                                                                                            |

S3 runs inside 2.6c. S1/S2 are prepared in 2.6f (runbook + Bicep) and executed by the Azure owner. `public` stays blocked until then.

## 4. Configuration (new)

| Variable                                                                                                                    | Where                                | Default / rule                                                                     |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------- |
| `REPO_ROOT`                                                                                                                 | api                                  | `/data/repos`; must exist and be writable                                          |
| `FEATURE_CANVAS`                                                                                                            | api, web (via `/auth/session` flags) | `off`; production refuses `public` without the conditions in the security model §6 |
| `CANVAS_INTERNAL_TEAM_IDS`                                                                                                  | api                                  | Empty = company admins only                                                        |
| `PREVIEW_GATEWAY_URL`, `PREVIEW_GATEWAY_TOKEN_SCOPE`                                                                        | api                                  | Production requires https and managed identity                                     |
| `PREVIEW_ORIGIN_PATTERN`                                                                                                    | api, web CSP, gateway                | Must be cross-site from `PUBLIC_APP_ORIGIN` (validated at start)                   |
| `PREVIEW_PROVIDER`                                                                                                          | gateway                              | `compose-pool` (refused in production) \| `aca-sessions` \| `aci`                  |
| `PREVIEW_MAX_SESSIONS_PER_TEAM`, `PREVIEW_MAX_SESSIONS_GLOBAL`, `PREVIEW_IDLE_STOP_SECONDS`, `PREVIEW_MAX_LIFETIME_SECONDS` | api                                  | 3 / pool size / 600 / 14400                                                        |
| `SERVICE_AUTH_*`                                                                                                            | gateway                              | Same shape as the AI runtime (ADR-0011)                                            |

## 5. Dependencies (to verify at install time and record in DEPENDENCY_REGISTER)

| Package / binary                                                                                                       | Where                  | Why                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `git` (Alpine package)                                                                                                 | api image              | Repository operations (D9)                                                                                                        |
| `@babel/parser`, `@babel/traverse`, `@babel/types`                                                                     | code-index             | TSX parsing and ids, same as the reference approach                                                                               |
| `vite`, `@vitejs/plugin-react`, `react`, `react-dom`, `react-router`, `tailwindcss`, `@tailwindcss/vite`, `typescript` | template + agent image | The generated app's allow-listed runtime (same versions as the studio)                                                            |
| `tar` (node-tar) and `@mongodb-js/zstd` or Node's built-in zlib                                                        | api, agent             | Snapshot transfer (prefer built-in gzip if zstd adds a native addon)                                                              |
| `http-proxy-3` or a small in-house proxy on `node:http`                                                                | gateway                | Data plane incl. WebSocket upgrade (pick the one with active maintenance at install time)                                         |
| `penpal` 8 **or** an in-house MessagePort wrapper                                                                      | web, inspector         | The protocol in this design needs only a handshake plus a typed port; recommendation: in-house (~150 lines) to avoid a dependency |
| `@azure/identity` (already present) + REST calls                                                                       | gateway                | Pool management API (no new SDK unless needed)                                                                                    |

No commercial services and no vendor SDK for execution.

## 6. Testing strategy

| Level                                               | Coverage                                                                                                                                                           |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unit                                                | Path policy (both sides), manifest/routes generation, git argv builder, oid algorithm, oidRemap, protocol schemas, gateway routing and auth, agent revision checks |
| Property                                            | API index ids = plugin ids over the corpus; op/remap invariants                                                                                                    |
| Integration (real PostgreSQL, Redis, git, mock IdP) | Repo lifecycle, checkpoints and restore, concurrency, RLS on new tables, reconciler, backfill, session lifecycle against the real gateway and agent containers     |
| Container / security                                | Egress matrix (§T5), secrets scan inside the sandbox, limits, recycle hygiene, Trivy, gitleaks                                                                     |
| E2E (production images)                             | Acceptance journey §7, rogue iframe, build error, viewer read-only, quota, mobile/tablet viewport frame, axe                                                       |
| Recovery drills                                     | Bundle restore; kill gateway / API / sandbox mid-session                                                                                                           |

## 7. Acceptance criteria for slice 2.6

1. Creating a project initialises a git repository from template v1 with a first commit; existing slice 2.5 projects are backfilled.
2. Creating, renaming, re-routing and deleting a page changes route files and the manifest; the database projection matches the manifest after every operation and after a reconciler repair.
3. `POST /checkpoints` creates a commit and a row; restore creates a new commit and never rewrites history; bundles restore to an identical tree.
4. Opening the canvas starts (or attaches to) an isolated preview showing the real React app; a new page appears via HMR without a full restart.
5. Hovering and selecting an element in the preview highlights it in the studio and shows the exact source file and line from the API index.
6. Build and runtime errors are shown with location; the preview can be refreshed, restarted and stopped; idle sessions stop automatically.
7. Two projects preview concurrently without sharing files or processes; every egress/secret/limit test in the security model passes on the local provider.
8. No `postMessage` uses a wildcard target; every message is origin-, source- and schema-checked.
9. All existing suites stay green; Trivy, audits and gitleaks clean; reports and ADRs updated (ADR-0011 → new ADR-0012 repository, ADR-0013 preview isolation, ADR-0014 oids/protocol).

The full journey's last two steps ("edit source → save checkpoint" from the canvas) complete in 2.7 on top of these pieces.

## 8. Local development strategy

- `docker compose --profile preview up` starts the gateway and three preview slots alongside the existing stack. Without the profile, the canvas shows "Preview service not running", so nothing else breaks.
- `pnpm dev` workflows: the studio runs with Vite as today; the gateway and agent run as containers (the agent must run in its hardened image to be representative).
- Integration tests start the preview profile in CI (as E2E already uses Compose).

## 9. Azure deployment strategy

Written in 2.6f, applied by the Azure owner:

1. Bicep module for the session pool, the gateway app, identity and role, Files share, Blob container and DNS/certificate parameters.
2. Run spikes S1/S2 from the runbook and record the results.
3. Deploy with `FEATURE_CANVAS=internal` and `PREVIEW_PROVIDER=aca-sessions`.
4. Security review, then set `PREVIEW_ISOLATION_VERIFIED`, then `public`.

The CI pipeline only builds, scans and publishes images and runs `what-if`; it never deploys (unchanged rule).

## 10. Decisions needed before 2.6a starts

| ID  | Decision                  | Recommendation                                                                              |
| --- | ------------------------- | ------------------------------------------------------------------------------------------- |
| D9  | git CLI vs isomorphic-git | git CLI, hardened                                                                           |
| D10 | Azure sandbox             | ACA dynamic sessions, ACI fallback, gated by spike S1                                       |
| D11 | Dependencies              | Allow-list only in 2.6                                                                      |
| D12 | Preview domain            | A separate registrable domain + wildcard certificate (needs an owner in the company)        |
| D13 | Iframe sandbox            | `allow-scripts allow-same-origin allow-forms allow-modals` on the cross-site preview origin |
| D14 | Template styling          | Tailwind CSS 4                                                                              |
| D15 | Scope split 2.6 / 2.7     | As in §1                                                                                    |
| D16 | Protocol library          | In-house typed MessagePort wrapper instead of penpal                                        |
