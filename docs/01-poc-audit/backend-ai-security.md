# POC Audit — Backend, AI, Security

Repo: `poc-CORE-Studio-V2` (15 commits, HEAD `7992369` v2.5.0). Audit was read-only. Paths are relative to `packages/backend/` unless stated.
Tags: **[V]** Verified (read or ran) · **[I]** Inferred · **[N]** No evidence found.

## 1. Repo map
- Two entrypoints: `server_local.py` (4,368 LOC, one file) **[V]** and `app/main.py` (111 LOC) **[V]**.
- `app/` modules: agents (base, planner, ux, ui, review, analyst, qa, engineering, design_complete, orchestrator), api/v1/endpoints (auth, projects, workflows, knowledge, artifacts), core, db (`base.py`, `base_local.py`), design_system, knowledge (indexer, retriever), models, pipeline (intent, decomposer, enricher, router), services, websocket **[V]**.
- Largest files: server_local.py 4368; app/agents/design_complete/flow_generator.py 1274; app/agents/qa/test_agent.py 753; app/design_system/registry.py 686; conversation_agent.py 639; tests/test_full_stack.py 614; services/workflow_service.py 519 **[V]**. About 15.5k Python LOC in total.
- Dockerfiles: `Dockerfile`, `Dockerfile.dev`, `Dockerfile.render`; `requirements.txt` and `requirements-local.txt` **[V]**.

## 2. Architecture
- **Confirmed: there are two backend paths and one is incomplete.** ARCHITECTURE.md:3-16 names `server_local.py` as the canonical backend. It says `app/` mounts none of the design/ai/analyst/qa/engineering routes and refers to a `app.worker` module that does not exist **[V]**. `app/main.py:57-61` mounts only auth, projects, workflows, knowledge and artifacts **[V]**. Every Dockerfile and compose file and the Makefile (`Makefile:22,40`) run `server_local.py` **[V]**.
- **Confirmed: the canonical path is one monolithic FastAPI app.** `server_local.py` holds the config/.env parsing (L55-86), the LLM provider clients (L225-345), RAG (L440-590), the ORM models (L1094-1190), the auth, the WS manager (L1251), the pipeline and every route (53 `@app` decorators) **[V]**. Some code in `app/` is imported by the monolith, for example `app.design_system.registry` and `flow_generator`, which the tests import (tests/test_core_design_system.py:22-23,349) **[V]**.

## 3. Database
- SQLAlchemy 2 async. `DATABASE_URL` defaults to SQLite through aiosqlite (server_local.py:68) and is meant to switch to Postgres through env in production **[V]**. docker-compose.yml:12-36 provides pgvector/pg16 and asyncpg **[V]**.
- Tables (server_local.py:1094-1190): users, projects, workflow_runs, artifacts, approval_gates, knowledge_documents, design_sessions **[V]**.
- **There are no migrations.** Both entrypoints call `Base.metadata.create_all` (server_local.py:1598; app/main.py:31) **[V]**. An `alembic.ini` file exists, but there is no alembic/versions directory **[V]**. pgvector is in requirements, but the monolith does not use it. RAG runs on Chroma **[I]**.

## 4. Auth / RBAC
- JWT HS256 through python-jose with access and refresh tokens (server_local.py:1212-1214; routes at L1748-1767). Login and register are rate-limited 10/60s by an in-memory deque limiter (L1702-1717) **[V]**.
- In production the server refuses to start with a weak or default JWT secret (L70-79) **[V]**.
- A `User.role` column exists with the default "designer" (L1103), **but no code enforces roles anywhere** **[V]** (grep finds no role checks).
- Project data is scoped by owner through `_owned_project_or_404` (L1801-1805) **[V]**.
- **Risk:** `POST /api/v1/ai/switch` and `/ai/config` need only an authenticated user. Through them, any user can replace the server-wide provider API keys, and `_persist_env` writes those keys into `packages/backend/.env` (≈L4247-4300) **[V]**.
- No SSO, OIDC or tenancy **[N]**.

## 5. API contracts, WebSocket, state
- Endpoint groups in server_local.py **[V]**:
  - auth (1748-1767)
  - projects (1790-1823)
  - workflows plus gate approve (1859-1886)
  - artifacts (1905-1910)
  - knowledge upload/list/search/ask/delete (1951-2218)
  - analyst research/flow (2406, 2492)
  - qa test-cases/accessibility/compliance (2593-2703)
  - engineering code/api-design/architecture (2761-2840)
  - design systems/plan/approve/regenerate/restore/export/prototype-links/sessions/generate/screenshot-to-design/handwritten-to-design (2876-3951)
  - chat (4025), teams (4110), health (4172), ai status/tokens/switch/config (4186-4341)
- WebSockets: `/ws/workflows/{run_id}` (L2228) and `/ws/design/{gen_id}` (L3870). The JWT travels in the query string (L1216-1238) **[V]**. Tokens in URLs can end up in proxy and access logs **[I]**.
- **Execution state is held in process memory:** `_active_generations`, `_design_sessions` (L2896-2900), `_gen_token_tracker` (L227), `_rate_buckets` (L1702) and the WS connection map (L1251). Design sessions also have a DB table, but in-flight generation does not survive a restart, and the server cannot scale beyond `WEB_CONCURRENCY=1` (L4362) **[V/I]**.
- No OpenAPI contract file is committed. FastAPI generates `/docs` automatically **[I]**.

## 6. AI providers
- The monolith calls the SDKs directly: anthropic, openai, google.generativeai (L284, 342) and Ollama over HTTP (L85, 2302) **[V]**.
- Keys are read from env at L82-84 and can be overridden at runtime through `/ai/switch` **[V]**.
- Model tiers come from env, with defaults such as claude-3-5-haiku-20241022, claude-sonnet-4-20250514, gpt-4o and gemini-1.5-pro (L134-154). These defaults are dated **[V]**.
- Cost tracking per generation (L227-242) and an LLM timeout of 120s (L268) **[V]**.
- In `app/`, `base_agent.py:39` creates `anthropic.AsyncAnthropic` directly, so agents call the SDK with no gateway in between **[V]**. langchain and langgraph are imported only by the incomplete path (`app/agents/orchestrator.py:16-17`) **[V]**.

## 7. Agents / orchestration
- Monolith: a fixed linear pipeline, "classify → planner → gate → ux → gate → ui → gate → review" (server_local.py:1298), with DB-backed `ApprovalGate` rows and WS `approval_required` events (L1289-1344) **[V]**.
- Design flow: `/design/plan` followed by `/design/approve` is a second human checkpoint (L2907, L3057) **[V]**.
- `app/agents/orchestrator.py:250-284` is a langgraph StateGraph with `interrupt_before` and an in-memory MemorySaver. This path is also fixed, not dynamic, and it is not deployed **[V]**.
- No dynamic planning or tool-use routing **[N]**.

## 8. RAG
- ChromaDB `PersistentClient` at `.chroma_db` with 6 collections (L440-458). It uses Chroma's default ONNX embedding (MiniLM), which is pre-downloaded in the Dockerfile **[V]**.
- Chunking is paragraph-based: 900 characters with 150 overlap (L487-508) **[V]**.
- Retrieval is plain `col.query(n_results=top_k)` with no reranking or filtering (L469, L583) **[V]**.
- The `knowledge/` directory is seeded at startup and skipped once populated (L523) **[V]**.
- No per-tenant isolation in collections **[V]**. The calls go through the sync client inside async code, which the comment at L1603 acknowledges **[V]**.

## 9. Generation output
- Output is HTML strings built with Tailwind from the CDN and Google Fonts (L3488-3490). It is exported as an HTML prototype (CHANGELOG 2.5.0) **[V]**.
- **No React output and no imports of real CORE components.** "CORE" exists only as tokens and prompt injection in `app/design_system/registry.py` / `tokens.py`, for example a test asserting that the Figma primary colour and Open Sans font match (tests L61-66) **[V/I]**.
- Accessibility checks are heuristic:
  - A substring check for `aria-`/`role=` (L3112) **[V]**.
  - LLM-produced WCAG reports whose fallback results are hard-coded "pass/warning" entries (L1016-1076) **[V]**.
  - A contrast-math path in `/qa/accessibility` (L2627-2664) **[V]**.
- No axe-core or other real DOM audit **[N]**.

## 10. Security
- **Secrets:** I scanned the full git history (`git log --all -p`) for sk-ant/sk-proj/sk-/AIza patterns and got 8 hits. All are UI placeholders or test fakes such as `"sk-ant-…"` and the monkeypatch value `sk-ant-***` **[V]**.
  - The key values in `.env.example` are placeholders: ANTHROPIC len 10 "sk-ant...", OPENAI len 6, JWT len 35 "change…" **[V]**.
  - `POSTGRES_PASSWORD` in `.env.example` holds a non-placeholder-looking 9-character value. It is probably a sample, but rotate it if it was ever used **[I]**.
  - No `.env` or `.db` files are tracked or present in history **[V]**.
- **CORS:** an explicit localhost allow-list plus the `CORS_ALLOWED_ORIGINS` env var, with credentials allowed and all methods/headers (L1676-1684). This is acceptable **[V]**.
- **Input validation:** Pydantic models on JSON bodies **[V]**. `/design/generate` uses untyped Form fields with free-text `fidelity`/`reference_mode` (L3703-3712) **[V]**. The upload cap is MAX_UPLOAD_SIZE_MB=50 (L1695) **[V]**.
- No exec, eval, subprocess, os.system or pickle anywhere in the backend **[V]**.
- **Generated HTML is not sanitised.** I found no bleach or html.escape calls. LLM output is returned as-is and served or exported as self-contained HTML, which is a stored-XSS risk once the frontend renders it **[V/I]**.
- **Prompt injection:** RAG and uploaded documents are concatenated straight into prompts **[I]**.
- The rate limiter is in-memory and per-process **[V]**.
- **Supply chain:** `Dockerfile.render` runs `git clone` of a GitHub repo at build time (Dockerfile.render ~L30) **[V]**.

## 11. Dependencies and licence
- `requirements.txt` (59 lines) **[V]**:
  - FastAPI 0.115.5 / starlette 0.41.3, SQLAlchemy 2.0.36, asyncpg, alembic, pgvector
  - redis, celery (unused in the monolith **[I]**)
  - python-jose 3.3.0, passlib
  - anthropic, openai 1.57, langgraph 0.2.56, langchain 0.3.9 and friends
  - chromadb, pypdf 5.1, pillow 11.0, python-docx, sentry-sdk, structlog
- **pip-audit** was not installed on the host, so I ran it inside a scratch venv only **[V]**. It reports known vulnerabilities, mainly in:
  - pypdf (many), pillow, starlette, python-multipart, langchain-core
  - python-jose and ecdsa (ecdsa has no fix; python-jose is unmaintained, so replace it with PyJWT)
  - langgraph-checkpoint, langsmith, chromadb, python-dotenv
- Every pin needs updating.
- **No LICENSE file in the repo** **[V]**, so legal status for reuse is unclear. The listed dependencies are MIT, BSD or Apache; ecdsa is MIT; psycopg is not used **[I]**. I found no copyleft licences.

## 12. Tests
- `tests/test_core_design_system.py` (unit, mocks llm_chat) and `tests/test_full_stack.py` (an integration test that needs a live server on localhost:8000) **[V]**. 49 `def test_` functions in total.
- **I ran** the unit file in a scratch venv (py3.13, requirements-local.txt): **50 passed in 2.7s** **[V]**.
- test_full_stack was **not run** because it needs a running server.
- No CI config was found in the backend scope **[N]**. Coverage is not measured **[N]**.

## 13. Deployment / observability
- `docker-compose.yml`: Postgres with pgvector, plus the backend running server_local, plus the frontend. Postgres requires `POSTGRES_PASSWORD` (`:?`). `docker-compose.dev.yml` runs on SQLite. `Dockerfile.render` targets Render through uvicorn **[V]**.
- Healthchecks are `/api/health` (Dockerfile HEALTHCHECK) and `/api/health/ready` in `app/` **[V]**.
- sentry-sdk and structlog are installed, but the monolith does not initialise Sentry (grep found no matches) **[V]**.
- No metrics, tracing or LLM observability apart from the in-memory token/cost counter and `/ai/tokens` **[V]**.
- One worker. SQLite and the Chroma directory sit on local disk **[V]**.

## 14. Classification
| Capability | Decision | Reason |
|---|---|---|
| server_local.py monolith | Refactor | Working product logic, but 4.4k LOC in one file with global state; split it into modules |
| app/ package (routers, langgraph orchestrator) | Retire | Incomplete and undeployed; ARCHITECTURE.md already marks it non-canonical |
| app/design_system registry and tokens | Reuse | Tested (50 pass) CORE token and prompt source |
| flow_generator / conversation_agent | Refactor | Core prompt logic worth keeping; route it through a gateway |
| ORM models | Refactor | Reasonable schema; add tenancy and indexes, and move to Alembic |
| create_all schema management | Replace | Production needs Alembic migrations |
| SQLite default | Replace | Use Postgres only in production |
| JWT auth (python-jose) | Replace | Library is unmaintained and has CVEs; move to PyJWT or OIDC/SSO |
| RBAC | Build new | Only a role column with no enforcement |
| /ai/switch runtime key editing | Retire | Any user can rewrite server secrets and write them to .env |
| Direct provider SDK calls | Replace | Build an LLM gateway with policy, logging, retries and model registry |
| Fixed pipeline plus approval gates | Refactor | Gate concept is good; give execution a durable queue |
| In-memory generation/session state | Replace | Lost on restart; blocks horizontal scaling |
| WS progress | Refactor | Keep the event schema; drop the URL token; add pub/sub (Redis) |
| ChromaDB RAG | Refactor or Replace | Naive chunking and retrieval, no tenant isolation; consider pgvector |
| HTML/Tailwind CDN output | Replace | Production needs React output that uses the real CORE components |
| Accessibility checks | Build new | Heuristic or LLM based; add axe-core and contrast checks on rendered DOM |
| Output sanitisation | Build new | No sanitisation of LLM HTML |
| Rate limiting | Replace | In-memory and per-process |
| Observability | Build new | Sentry not initialised; no metrics or tracing |
| Dependencies | Refactor | Upgrade all; pip-audit flags many CVEs |
| Tests | Refactor | Keep the unit tests; add CI and runnable integration tests |
| LICENSE | Build new | Missing |
