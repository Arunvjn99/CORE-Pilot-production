# ADR-0004: Service topology

Status: **Proposed**

## Decision

| Deployable                                                                        | Tech                                  | Why separate                                                          |
| --------------------------------------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------- |
| `apps/web`                                                                        | Vite SPA (static)                     | UI                                                                    |
| `apps/api`                                                                        | NestJS                                | Control plane + BFF, authN/Z, tenancy, jobs, audit                    |
| `services/ai-runtime`                                                             | Python/FastAPI + LangGraph            | Agent runtime; different language/runtime                             |
| `services/preview-runtime`                                                        | Node, per-session isolated containers | Runs **untrusted** generated code; security boundary                  |
| Code-edit (AST)                                                                   | TS library `packages/code-edit`       | Library first; promoted to a service only if isolation/scale requires |
| `apps/admin` is **not** a separate app: admin is a role-gated area of `apps/web`. |

## Trade-offs

Fewer deployables (rule: no unnecessary microservices); the sandbox is the only mandatory extra boundary.

## Status of build-out

Phase 1 creates only `apps/web`, `apps/api`, `services/ai-runtime` and shared config/contracts. Preview runtime and code-edit arrive in Phase 6.
