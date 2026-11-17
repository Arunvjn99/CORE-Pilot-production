# ADR-0013: Studio v2 re-baseline — agent graph, versioned AGENT.md/DESIGN.md, static preview origin

Status: **Accepted** (2026-11-17). Plan: `docs/development/v2-rebaseline-plan.md` (decisions R1–R8). Supersedes the preview-service parts of `docs/architecture/slice-2.6/` (slices 2.6b–2.6f).

## Context

Slice 2.6 planned one preview **server container per open project** (Vite dev server, code index, preview agent, gateway). That is a large, operationally heavy build before a single AI-generated screen exists. The re-baseline (R6) moves the product to a studio that generates and edits React screens first, reusing the POC agents and open-source design-tool patterns (MIT), and keeps the project repository from slice 2.6a (ADR-0012) as the source of truth.

## Decision

1. **Agent graph in the existing AI runtime (R3).** A LangGraph graph — orchestrator → UX → UI designer per screen (in parallel) → reviewer → at most `maxFixRounds` fix rounds — runs in `services/ai-runtime`. Output contracts (plan/UX/review JSON, one `tsx` block per screen) live in code, not in team-editable text, so a team edit cannot break parsing. The runtime never writes project files; it streams NDJSON events to the API.
2. **One key per team (R4 §4).** Every agent uses the team's default credential and model (ADR-0007/0010 envelope encryption, sealed to the runtime). An agent may override the _model_, never the key.
3. **Editable, versioned agents and design systems.** `AGENT.md` per agent and `DESIGN.md` + `tokens.css` per design system ship in `@core-studio/studio-library`; teams edit them in Settings. Every save is a new row (`agent_definitions`, `design_system_versions`); revert writes a new version (history is never rewritten); optimistic concurrency via `expectedVersion` (`STALE_VERSION`). A project carries its **own copy** of `DESIGN.md`/`tokens.css` in its repository, so team edits never change existing projects silently.
4. **Runs.** The API resolves key, agents and project design, records each agent step (tokens, model, duration) for the metrics dashboard, relays events to browsers through a **Redis stream per run** (works across API replicas; SSE resumes with `Last-Event-ID`), validates each generated screen (TSX parse + default export) and commits accepted screens with a checkpoint. One running run per project.
5. **Static preview runtime on a separate site (replaces 2.6b–f).** `apps/preview` is a static app served from its own origin (`PREVIEW_ORIGIN`, a different _site_ from `PUBLIC_APP_ORIGIN`, enforced at API start-up). It compiles screen TSX in the browser (`@babel/standalone`, with source locations) and styles it with `@tailwindcss/browser` plus the project tokens. The studio talks to it only via a versioned, schema-validated `postMessage` protocol (`@core-studio/contracts` `preview.ts`) with exact-origin checks in both directions.
6. **Visual edits are source edits.** Selecting an element reports its JSX source location; the Design panel sends a typed operation (`setText`, `setClassName`, `setAttribute` from an allow-list) that the API applies with a Babel AST to the exact range, re-parses, and commits against `baseRevision` (`STALE_REVISION` on conflict). Untouched code keeps its exact formatting.

## Consequences

- No per-project containers, warm pools, or preview gateway to build or operate; the preview image is static files behind nginx.
- The preview origin needs `script-src 'unsafe-eval'` (in-browser compilation). This is acceptable only because that origin holds no credentials or user data, has `connect-src 'self'`, `frame-ancestors` limited to the studio, and the studio never trusts a message without origin + source + schema checks (see SECURITY_REVIEW, Studio v2). It must never be served on the same site as the studio.
- Screens currently use only React and Tailwind (`useState` from `react`; no other imports). Exporting a full Vite project from the repository and richer imports (CORE React components, blocked on B1) come later.
- LangSmith tracing exists but is **off** until the company decides where traces may go (R4); the default endpoint is the EU region.
- Superseded documents keep their content for history and carry a banner pointing here.
