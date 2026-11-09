# Dependency Register

Versions are exact and locked (`pnpm-lock.yaml`, `services/ai-runtime/uv.lock`). Security status as of 2026-11-09 (pnpm audit, pip-audit, Trivy). "Prod" = shipped in an image.

## Toolchain

| Tool       | Version                             | Why                                                                         |
| ---------- | ----------------------------------- | --------------------------------------------------------------------------- |
| Node.js    | 24 LTS (images: 24.22.2-alpine3.24) | Runtime                                                                     |
| pnpm       | 10.34.9 (Corepack)                  | Workspace package manager                                                   |
| Turborepo  | 2.11.10                             | Task graph / caching                                                        |
| TypeScript | 5.9.3                               | Not 7.x: NestJS decorator-metadata compatibility unverified (ADR-0002 note) |
| uv         | 0.11.7                              | Python env/lock                                                             |
| Python     | 3.13 (images: 3.13.18-slim-trixie)  | AI runtime                                                                  |

## apps/api (NestJS) — all Prod unless noted

| Package                                                                                                                               | Version                 | Licence    | Purpose                                             |
| ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ---------- | --------------------------------------------------- |
| @nestjs/core, common, platform-express                                                                                                | 12.4.1                  | MIT        | Framework                                           |
| @nestjs/swagger                                                                                                                       | 12.1.1                  | MIT        | OpenAPI (disabled in production)                    |
| @nestjs/terminus                                                                                                                      | 12.1.0                  | MIT        | Health checks                                       |
| @nestjs/throttler                                                                                                                     | 6.7.1                   | MIT        | Rate limiting (Redis storage, own impl.)            |
| nestjs-pino / pino / pino-http                                                                                                        | 5.3.1 / 10.4.0 / 11.0.0 | MIT        | Structured logs + correlation IDs                   |
| helmet                                                                                                                                | 8.3.0                   | MIT        | Security headers                                    |
| drizzle-orm                                                                                                                           | 0.45.4                  | Apache-2.0 | ORM (ADR-0003)                                      |
| pg                                                                                                                                    | 8.23.1                  | MIT        | PostgreSQL driver                                   |
| ioredis                                                                                                                               | 6.0.0                   | MIT        | Redis client                                        |
| zod                                                                                                                                   | 4.6.7                   | MIT        | Validation (config, contracts)                      |
| @opentelemetry/sdk-node, api, exporter-trace-otlp-http, instrumentation-{http,express,pg,ioredis}                                     | 0.301.0 / 1.10.0 / …    | Apache-2.0 | Tracing via OTLP (ADR-0008)                         |
| openid-client                                                                                                                         | 6.8.9                   | MIT        | OIDC client (certified), PKCE, discovery (ADR-0009) |
| cookie                                                                                                                                | 2.0.2                   | MIT        | Cookie parse/serialise for session cookies          |
| reflect-metadata, rxjs                                                                                                                | 0.2.2 / 7.8.2           | Apache-2.0 | NestJS requirements                                 |
| _Dev:_ drizzle-kit 0.31.11, vitest 5.1.0, unplugin-swc 2.0.0, @swc/core 1.16.22, @swc-node/register, supertest 7.3.2, @nestjs/testing |                         | MIT/Apache | Migrations generation, tests, dev runner            |

## apps/web

| Package                                                                                                                                                                                                                                                       | Version | Licence | Purpose                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------- | ----------------------------------------------------- |
| react / react-dom                                                                                                                                                                                                                                             | 19.3.1  | MIT     | UI                                                    |
| react-router                                                                                                                                                                                                                                                  | 8.5.1   | MIT     | Routing                                               |
| @tanstack/react-query                                                                                                                                                                                                                                         | 5.107.1 | MIT     | Server state                                          |
| zustand                                                                                                                                                                                                                                                       | 5.1.0   | MIT     | Local UI state (installed for Phase 2+, not yet used) |
| zod                                                                                                                                                                                                                                                           | 4.6.7   | MIT     | Response validation                                   |
| _Build/dev:_ vite 8.3.6, @vitejs/plugin-react 6.3.0, tailwindcss + @tailwindcss/vite 4.3.5, vitest 5.1.0, jsdom 29.1.1, @testing-library/*, @playwright/test + playwright-core 1.65.0, @axe-core/playwright 4.14.0 (MPL-2.0), eslint-plugin-react-hooks 7.1.1 |         |         | Build, unit, E2E, accessibility                       |

Deferred to their phases: React Hook Form, Radix UI, Framer Motion, Monaco/CodeMirror, Babel/recast, isomorphic-git, MSAL/openid-client, Azure SDKs, LangGraph, LiteLLM.
Rejected: `eslint-plugin-jsx-a11y` (no ESLint 10 support; axe-core covers runtime a11y), `@azure/monitor-opentelemetry` (pulled duplicate/deprecated OTel SDK versions; OTLP + ACA managed agent instead), `@opentelemetry/auto-instrumentations-node` (excessive transitive surface).

## Shared

| Package                                 | Version               | Licence | Purpose                    |
| --------------------------------------- | --------------------- | ------- | -------------------------- |
| eslint / typescript-eslint / @eslint/js | 10.14.0 / latest / 10 | MIT     | Lint (strict type-checked) |
| prettier                                | 3.9.10                | MIT     | Formatting                 |

## services/ai-runtime (Python)

| Package                                                                       | Version         | Licence    | Purpose                    |
| ----------------------------------------------------------------------------- | --------------- | ---------- | -------------------------- |
| fastapi                                                                       | 0.162.2         | MIT        | HTTP                       |
| uvicorn[standard]                                                             | 0.54.0          | BSD-3      | ASGI server                |
| pydantic / pydantic-settings                                                  | 2.14.3 / 2.16.2 | MIT        | Models, validated settings |
| structlog                                                                     | 26.1.0          | MIT/Apache | JSON logging               |
| opentelemetry-sdk, exporter-otlp-proto-http, instrumentation-fastapi          | 1.45.2 / 0.66b2 | Apache-2.0 | Tracing                    |
| _Dev:_ pytest 9.2.0, httpx2 2.16.0, ruff 0.17.4, mypy 2.4.1, pip-audit 2.10.1 |                 |            | Tests, lint, types, audit  |

## Base images

`node:24.22.2-alpine3.24`, `nginxinc/nginx-unprivileged:1.31.7-alpine3.24`, `python:3.13.18-slim-trixie`, `ghcr.io/astral-sh/uv:0.11.7`, local-only `postgres:17.6-alpine`, `redis:8.2-alpine`. Scanners: `aquasec/trivy:0.76.2`, `zricethezav/gitleaks:v8.28.0`.

Local/CI only: `ghcr.io/navikt/mock-oauth2-server:3.0.1` (MIT), the OIDC test server (never in production).
