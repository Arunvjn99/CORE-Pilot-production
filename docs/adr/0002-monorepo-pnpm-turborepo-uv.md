# ADR-0002: Monorepo — pnpm workspaces + Turborepo; uv workspace for Python

Status: **Proposed**

## Context

TypeScript apps/packages and Python services in one repo; reproducible installs; incremental CI.

## Options

pnpm+Turborepo · Nx · npm workspaces. Python: uv · Poetry · pip-tools.

## Decision

pnpm workspaces (lockfile committed, `packageManager` pinned via Corepack) + Turborepo for task graph/caching. Python services managed by a uv workspace (`uv.lock` committed). Cross-language contracts generated from OpenAPI/JSON Schema into `packages/contracts` (TS) and Pydantic models (Python).

## Trade-offs

- Light, fast, widely used. − Two toolchains; contract generation must be enforced in CI.

## Risks

Contract drift → mitigated by CI check that generated code is up to date.
