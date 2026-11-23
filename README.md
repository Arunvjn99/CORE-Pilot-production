# CORE AI Design Studio

Enterprise AI-powered design and application platform. **Status: Phase 1 (Foundation) implemented and verified.** See [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).

## Repository layout

| Path                    | What                                                           |
| ----------------------- | -------------------------------------------------------------- |
| `apps/web`              | Vite + React SPA (ADR-0001)                                    |
| `apps/api`              | NestJS control plane / BFF, Drizzle + PostgreSQL migrations    |
| `services/ai-runtime`   | Python FastAPI AI runtime (uv)                                 |
| `packages/contracts`    | Shared Zod contracts (error envelope, health, correlation IDs) |
| `packages/config`       | Shared TypeScript / ESLint configuration                       |
| `infrastructure/docker` | Production Dockerfiles, nginx, Postgres role provisioning      |
| `docs`                  | Architecture blueprint, POC audit, ADRs, plans                 |
| `azure-pipelines.yml`   | CI: build, test, scan, publish tested images (no deploy)       |

## Prerequisites

Node 24 (≥24.15 recommended), Corepack, uv ≥0.11, Docker with Compose v2.

## Run locally (same images as production)

```bash
./scripts/init-local-env.sh        # creates .env with generated local secrets (never committed)
docker compose up -d --build --wait
```

- Web: http://localhost:8080 (API reverse-proxied at `/api`)
- API: http://localhost:${API_HOST_PORT:-3000}/api/v1/health/ready (docs at `/api/docs` when `API_DOCS_ENABLED=true`, never in production)
- AI runtime: internal only (compose network)

Change `API_HOST_PORT` / `WEB_HOST_PORT` in `.env` if those ports are taken.

### First sign-in (local)

Locally, "Sign in with Microsoft" goes to a test login page (production uses Microsoft Entra ID).
Run `./scripts/local-sign-in.sh` and paste the username and claims it prints. You are the company
admin: create a team when asked, then you land in **Files → Recents**.

### Connect a model (one key for every agent)

The agents need one model. With [Ollama](https://ollama.com) on your machine (`ollama pull qwen2.5-coder:7b`):

1. **Settings → AI providers → Add credential** → Ollama, endpoint `http://host.docker.internal:11434`
   (allowed by `LLM_ENDPOINT_ALLOWED_PRIVATE_HOSTS` in `.env`) → **Test connection**.
2. **Default model** → choose the credential → **Load models** → **Set as default**.

OpenAI, Anthropic, Gemini and Azure OpenAI keys work the same way.

### Try it

**Files → + New design file** → in the editor, **AI** tab: describe the screens → watch the agents
plan, design, build and review → click an element on the canvas to edit it in the **Design** panel
(⌘/Ctrl+Z undoes) → **Prototype** tab for links and triggers → **Present** → **Comments** (C) to pin
feedback → **History** to restore or **Export** a runnable React project.

## Develop and test

```bash
corepack enable && pnpm install --frozen-lockfile
pnpm turbo run lint typecheck test build      # TypeScript workspace
./scripts/test-integration.sh                 # API vs real Postgres/Redis (needs compose postgres + redis)
E2E_BASE_URL=http://localhost:8080 pnpm --filter @core-studio/web test:e2e
cd services/ai-runtime && uv sync --frozen && uv run ruff check . && uv run mypy src tests && uv run pytest
```

## Shipping

CI builds the three images once, tests them as a running stack, scans them, and publishes them as artifacts tagged with the commit SHA. The same images are deployable unchanged: all behaviour is driven by environment variables, which are validated at startup (production requires TLS for Postgres/Redis, HTTPS CORS origins, and API docs disabled). Migrations run as a separate job using the `migrate` command of the API image; the API itself connects as the least-privilege `core_app` role.
