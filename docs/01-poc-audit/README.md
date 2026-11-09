# POC Audit — CORE-Studio-V2 (`main@7992369`)

Detailed reports: [backend-ai-security.md](backend-ai-security.md) · [frontend-canvas-ds-knowledge.md](frontend-canvas-ds-knowledge.md)
Evidence tags: **Verified** (read or executed) · **Inferred** · **No evidence**.

## Revalidation of previously identified concerns
| # | Concern | Result |
|---|---|---|
| 1 | Monolithic FastAPI backend | **Verified** — `server_local.py` 4,368 LOC, 53 routes, all layers in one file |
| 2 | Two backend paths, one incomplete | **Verified** — `app/main.py` mounts only auth/projects/workflows/knowledge/artifacts |
| 3 | Fixed workflow, not dynamic Master Agent | **Verified** — classify→planner→ux→ui→review; LangGraph only in unused `app/` path |
| 4 | In-memory execution state | **Verified** — generations, sessions, rate limiter, WS connections in process memory |
| 5 | Incomplete auth / RBAC | **Verified** — JWT (python-jose), owner scoping only, `role` unenforced; tokens in localStorage |
| 6 | Competing design tokens | **Verified** — 6 sources; app brand ≠ CORE 2.0 |
| 7 | HTML output, no real CORE React components | **Verified** — HTML + Tailwind CDN in `iframe srcDoc`; no component package imported |
| 8 | Heuristic accessibility | **Verified** — heuristic/LLM only, no axe-core |
| 9 | Incomplete knowledge governance | **Verified** — filesystem markdown + ChromaDB, no versioning/ownership/tenant filter |
| 10 | Limited observability / durable jobs | **Verified** — Sentry unused, no metrics/tracing, no durable queue |

## Additional critical findings
- **Any authenticated user can overwrite server-wide LLM keys** (`/api/v1/ai/switch`, `/ai/config`) — written to `.env`.
- Unsanitised LLM HTML → stored-XSS risk; no CSP/security headers.
- Vulnerable deps: `npm audit` 21 (2 critical incl. `next`); pip-audit many (python-jose, starlette, pypdf, langchain-core…).
- 149 of 150 design-system folders imitate third-party brands → **IP risk**.
- No LICENSE; `npm ci` fails (lockfile drift); no frontend tests, no CI. Backend `test_core_design_system.py` 50/50 pass.
- Fabric.js is declared but never imported.

## Consolidated classification
| Capability | Decision | Reason |
|---|---|---|
| `server_local.py` monolith | Replace | Split into NestJS control plane + Python AI runtime |
| `app/` backend path | Retire | Incomplete duplicate |
| ORM schema concepts | Refactor | Port to PostgreSQL migrations in new schema |
| `create_all`, SQLite | Replace | Migrations; Azure PostgreSQL |
| JWT/python-jose auth | Replace | Entra ID + BFF secure cookies |
| Role column | Build new | Real RBAC + tenant isolation |
| Runtime key editing via `.env` | Retire | Replace with LLM Gateway + Key Vault credentials |
| Direct provider SDK calls | Replace | Central LLM Gateway |
| Fixed pipeline | Replace | Master Agent + LangGraph |
| Approval-gate concept | Reuse (concept) | Becomes LangGraph interrupt gates |
| Core prompt logic | Refactor | Move into specialist agents, versioned prompts |
| ChromaDB RAG | Replace | Azure AI Search + governed Knowledge Centre |
| Domain/company knowledge content | Reuse | Re-ingest with provenance & review |
| Brand-clone design systems (149) | Retire | IP risk |
| CORE 2.0 `DESIGN.md` + `core_design_system` tests | Refactor | Seed Design System Registry |
| HTML generation | Replace | Real React + CORE components |
| Canvas (iframe board) | Replace | DOM-backed, oid-mapped React editor |
| Fabric.js, legacy JSON canvas | Retire | Unused / duplicate |
| Flow canvas, prototype links | Refactor | Rebuild on new source model |
| Version history | Replace | Git-based checkpoints |
| HTML / Figma JSON export | Refactor | Derive from React source |
| Figma plugin | Refactor | Keep import concept; add library/variable binding |
| TanStack Query usage | Reuse (pattern) | Keep in new frontend |
| Accessibility checks | Build new | axe-core + design-system a11y metadata |
| Sanitisation, CSP, observability, CI, tests | Build new | Absent |
