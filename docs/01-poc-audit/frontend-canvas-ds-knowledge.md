# POC Audit: Frontend, Canvas, Design System, Figma Plugin, Knowledge

Source: `poc-CORE-Studio-V2` (read-only). Audit date 2026-11-09. Paths relative to repo root.
Legend: **[V]** Verified (read code / ran command), **[I]** Inferred, **[N]** No evidence found.

## 1. Frontend repo map
- `packages/frontend`: Next.js **15.0.3** App Router, React 18.3.1, TS 5.6, Tailwind 3.4, shadcn-style Radix UI (`src/components/ui/*`, 8 primitives) [V] `package.json`.
- ~7.8k LOC TS/TSX. Largest: `src/app/(studio)/studio/page.tsx` (1277 lines, god-component), `components/studio/DesignCanvas.tsx` (705), `documents/page.tsx` (664) [V].
- Routes: `(auth)/login`, `(auth)/register`; `(studio)/{studio,analyst,projects,projects/[id],qa,knowledge,documents,engineering,settings}` [V] (build route table).
- State: Zustand only for auth (`src/lib/store/auth-store.ts`, `persist` middleware, key `core-studio-auth`) [V]; server state via TanStack Query v5 (`useQuery` in studio/projects/knowledge/documents pages) [V]. Much local `useState` in studio page [V].
- API client: axios `src/lib/api/client.ts:5` baseURL `NEXT_PUBLIC_API_URL/api/v1`; Next rewrite proxy `next.config.ts` [V]. No typed/generated client (no OpenAPI codegen) [N].
- Auth: JWT access + **refresh token both persisted in localStorage** (`auth-store.ts` persist; `client.ts:13,34,46`) [V]. Refresh on 401 at `client.ts:27-55`. Route guard is client-side only (`(studio)/layout.tsx:83` `router.push("/login")`); no `middleware.ts` [V]. No httpOnly cookies, no SSO/OIDC [N].
- Also localStorage: last session id (`studio/page.tsx:296-338`) [V].
- `.env.example`: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WS_URL` only; no secrets in frontend [V].

## 2. Canvas
- **Fabric.js is a declared dependency (`fabric ^6.4.3`) but is not imported anywhere in `src`** [V] (grep). Dead dep that drags in native `canvas` build and a high-sev advisory.
- Real canvas: `components/studio/DesignCanvas.tsx` — custom pan/zoom board of screens, each rendered as **HTML string in `<iframe srcDoc sandbox="allow-scripts">`** (`:83-86`, `:370-375`, `:557-562`) [V].
- Screen model `CanvasScreen` (`DesignCanvas.tsx:25-38`): `screen_id, name, html, version, screen_type, canvas_size, refinement_history[], x, y` [V]. Canonical dims per type `:41-47`. Screens are **raw HTML (Tailwind CDN classes)**, not structured JSON [V].
- `wrapHTML` (`:658-705`) injects `https://cdn.tailwindcss.com` + Google Fonts into each iframe [V] — runtime CDN dependency, not production-grade.
- Editing: per-screen regenerate via prompt (`studio/page.tsx:389` `/design/regenerate-screen`); no direct-manipulation editing [V].
- Version history: `refinement_history` entries + restore (`studio/page.tsx:436` `/design/restore-screen-version`) [V].
- Prototypes: hotspot links (`PrototypeLink`, % rects) drawn in prototype mode, persisted via `GET/PUT /design/prototype-links/{session}` (`studio/page.tsx:317,326`) [V].
- Export: `/design/export` formats `html`, `html_prototype`, `figma_json`, downloaded as Blob (`studio/page.tsx:456-481, 907-925`) [V]. Figma JSON built backend-side by parsing HTML inline styles (`packages/backend/app/design_system/figma_export.py`) [V]. No React/code export of DS components [N].
- Flow canvas: `components/studio/FlowCanvas.tsx` custom grid/lane SVG-ish layout of `FlowNode/FlowEdge` JSON, used in `analyst/page.tsx:14` [V].
- Legacy second canvas: `components/canvas/DesignCanvas.tsx` + `DynamicComponent.tsx` (JSON `elements[]` -> shadcn components), only used by `ArtifactViewer.tsx:9` [V]. Two competing screen representations (HTML vs element JSON) [V].

## 3. Competing design-token definitions [V]
1. `packages/frontend/tailwind.config.ts` — `brand` scale, surface, shadows referencing CSS vars (264 lines).
2. `packages/frontend/src/styles/globals.css` — shadcn HSL vars (`--primary: 240 96% 60%`) **and** `--cs-*` hex vars (`--cs-primary: #5B5EF4`) claiming "single source of truth" (274 lines).
3. `packages/backend/app/design_system/tokens.py` — Python dict tokens, primary `#5B5EF4` + component CSS strings (441 lines).
4. `packages/backend/app/design_system/registry.py` `DESIGN_SYSTEMS` — ~9+ inline token sets (CORE 2.0 `#004DCB` at :29, `#5B5EF4` :257, `#5E6AD2`, `#533AFD`, `#0075DE`, `#171717`, `#0969DA`, `#18181B`, `#6750A4`).
5. `knowledge/design-systems/*/DESIGN.md` — **150 prose markdown design systems** (Apple, Ferrari, Uber, Vercel... and `core-2`), tokens in prose/tables.
6. `wrapHTML` inline Tailwind CDN config (Inter font) in `DesignCanvas.tsx:671-676`.
Note: the studio app UI's own brand (#5B5EF4, Inter) differs from CORE 2.0 (#004DCB, Open Sans) [V]. No DTCG/Style-Dictionary JSON tokens [N].

## 4. Design system
- **No real CORE React component package** (`@core-web/design-system` or similar) referenced or imported anywhere (grep across repo; only hit is eslint `next/core-web-vitals`) [V].
- `knowledge/design-systems/core-2/DESIGN.md` describes CORE 2.0 as "extracted from the company's real Figma component library" — tokens, 5 mined page templates (`shell_sidebar`, etc.) [V]; claimed Figma provenance not verifiable here [I].
- Other 149 folders are third-party-brand style imitations (e.g. apple, ferrari, starbucks, discord) [V] — brand/trademark & relevance risk for an enterprise product [I].
- Generated screens are LLM-written HTML+Tailwind approximating DS, not DS components [V].

## 5. Figma plugin (`packages/figma-plugin`)
- `manifest.json`: name "CORE Design Pilot AI Import", id `core-studio-import` (not a published Figma ID), `editorType: [figma]`, `networkAccess.allowedDomains: ["none"]` [V].
- Capabilities: user pastes JSON into textarea (`ui.html:21-40`), `code.ts:192` handles `import`, builds frames/text with auto-layout (`createFrame`, `createText`, font fallback cache) [V]. ~200 LOC.
- Consumes `ImportPayload { version, screens: ScreenSpec[] }` (`code.ts:60`) produced by backend `figma_export.py` [V]. No components/variables/styles binding to a Figma library [V]. One-way, manual paste [V].
- `code.js` compiled artifact committed alongside `code.ts` [V]; no tests [V].

## 6. Knowledge folder (2.7 MB, 234 md/MD files) [V]
- `design-systems/` 150 × `DESIGN.md`.
- `domain/` banking, healthcare, insurance, loan (UI-patterns md), retirement & compliance (numbered `.MD` docs, e.g. SECURE 2.0, EPCRS, Fiduciary).
- `company/` accessibility (WCAG), branding, compliance, ux-standards, retirement-world (`RW1.0.MD`, `RetirementworldSpec.MD`).
- `layout-references/` prompt "skills" (taste-brutalist/soft/editorial, checklist, layouts).
- Consumption: backend reads from filesystem (`registry.py:10-19` walks up to `knowledge/design-systems`, Docker fallback `/knowledge`); `get_system_prompt_injection` appends trimmed DESIGN.md to LLM prompts (`registry.py:560-684`) [V]. Also referenced by `context_enricher.py`, `base_agent.py`, analyst/qa agents [V]. No versioning, ownership metadata, or embeddings pipeline evidence for these files [N]/[I].

## 7. Tests / lint / build (run in scratch copy, not repo)
- `npm ci`: **FAILED** — lockfile out of sync (missing `@mapbox/node-pre-gyp`, `nan`, `simple-get`, `make-dir` — fabric's `canvas` deps) [V].
- `npm install --ignore-scripts`: OK. `tsc --noEmit`: **pass** (exit 0). `next build`: **pass**, 13 routes [V].
- `next lint`: passes with warnings only (`<img>` LCP, `FlowCanvas.tsx:85` exhaustive-deps) [V]. ESLint config is just `next/core-web-vitals`.
- **No frontend tests, no test runner** (no jest/vitest/playwright in package.json) [V]. Figma plugin: none [V].

## 8. npm dependencies
- Notable: next 15.0.3, react 18, @tanstack/react-query 5, zustand 5, axios, fabric (unused), framer-motion, react-markdown, radix, zod, react-hook-form, sonner [V].
- `npm audit` (after install): **21 vulnerabilities — 2 critical, 12 high, 7 moderate**; critical incl. `next` (<16.3 range), high incl. axios, fabric, follow-redirects, form-data, postcss, nanoid, sharp/libvips [V].
- Licences: all mainstream MIT/ISC/Apache [I] (no licence scan run). Main licence/IP risk is in knowledge content (third-party brand DESIGN.md) rather than npm [I].

## 9. Security
- No `dangerouslySetInnerHTML` in frontend [V]. Generated HTML rendered via `iframe srcDoc` with `sandbox="allow-scripts"` (no `allow-same-origin`) → opaque origin, cannot read app localStorage [V]. Good baseline.
- Risks: LLM HTML executes scripts inside iframe and can load arbitrary remote resources / exfiltrate prompt content via network; Tailwind CDN script loaded at runtime [V/I]. Exported HTML files are unsanitised [I].
- `react-markdown` used (safe by default unless rehype-raw) [I].
- **No CSP** or security headers (`next.config.ts` has no `headers()`; no middleware) [V].
- Tokens in localStorage (XSS → token theft) [V]; client-only route guard [V].
- Figma plugin `networkAccess: none` [V] — low risk.

## 10. Classification
| Capability | Decision | Reason |
|---|---|---|
| Next.js App Router shell, route layout | Refactor | Works and builds; upgrade Next (critical CVE), split 1277-line studio page |
| shadcn/Radix UI primitives | Replace | Should use real CORE React DS package (none exists in POC) |
| Zustand auth store + localStorage tokens | Replace | Move to httpOnly cookie / BFF session, SSO, server middleware guard |
| TanStack Query usage | Reuse | Appropriate pattern; add typed generated API client |
| axios client | Refactor | Generate from OpenAPI; remove manual token handling |
| HTML-string screens in sandboxed iframes | Refactor | Keep sandbox; move to structured screen schema / DS-component tree; drop Tailwind CDN |
| Legacy JSON `canvas/DesignCanvas` + DynamicComponent | Retire | Duplicate representation, single consumer |
| Fabric.js dep | Retire | Unused; adds vuln + native build breaking `npm ci` |
| Version history / restore | Reuse (logic) / Refactor | Concept sound; needs backend audit trail |
| Prototype hotspot links | Refactor | Useful; % rect model fragile vs responsive layouts |
| FlowCanvas | Refactor | Custom layout ok; consider React Flow |
| Export HTML / prototype | Refactor | Sanitise, self-contain assets |
| Export Figma JSON + plugin | Refactor | Valid approach; bind to Figma library components/variables, real plugin ID, tests |
| Token definitions (6 sources) | Replace | Single DTCG token source generated to CSS/TS/Python/Figma |
| knowledge/design-systems (149 brand clones) | Retire | Irrelevant / brand-IP risk; keep `core-2` only |
| knowledge core-2 DESIGN.md + layout templates | Refactor | Valuable; convert to versioned machine-readable spec |
| knowledge domain/company docs | Reuse | Content value; add ownership/versioning, ingest pipeline |
| Frontend tests | Build new | None exist |
| CSP / security headers | Build new | None exist |
