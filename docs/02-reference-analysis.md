# 02 — Reference Product Analysis (Onlook, bolt.diy, Archon, Flowise)

Date: 2026-11-09. Source read from shallow clones (code not run). **[V]** = Verified in source/API/web; **[I]** = Inferred.

| Repo | Commit SHA read | Commit date |
|---|---|---|
| onlook-dev/onlook | `423e2e924366419e418ee049093872d535eea41a` | 2026-07-21 |
| stackblitz-labs/bolt.diy | `353b44c8f386aeb15abdf277515d78ff50f7578e` | 2026-10-14 |

---

## 1. Onlook

**Licence [V]:** `Apache-2.0` — `LICENSE.md`, `package.json` (`"license": "Apache-2.0"`). Non-code terms: runtime depends on **CodeSandbox SDK** (`packages/code-provider/package.json`, `@codesandbox/sdk ^1.1.6`) — a paid hosted service with its own ToS [I]; fast-apply via Morph/Relace commercial APIs (`packages/ai/src/apply/client.ts`) [V].

**Structure [V]:** Bun monorepo (`package.json` workspaces). `apps/web/client` (Next.js 16.0.7, React 19.2, `ai` 5.0.26), `apps/web/preload` (script injected into preview), `apps/backend`, `apps/admin`; `packages/{parser,ai,code-provider,penpal,git,db,file-system,models,rpc,ui,...}`. DB via Supabase/Drizzle (`packages/db`) [I from name].

**Visual editing [V]:**
- DOM→source mapping: Babel pass injects `data-oid` on every JSX element — `packages/parser/src/ids.ts` (attribute name from `EditorAttributes.DATA_ONLOOK_ID`, `packages/constants/src/editor.ts`); handles duplicate OIDs and per-branch OID ownership. Tests: `packages/parser/test/data/ids/*`.
- AST stack: `@babel/standalone` (parser/traverse/generator/types) — `packages/parser/src/packages.ts`; prettier formatting in `packages/parser/src/prettier`. No recast/ts-morph.
- Edits: `transformAst(ast, oidToCodeDiff)` in `packages/parser/src/code-edit/transform.ts` looks up each JSX element's oid and applies `CodeDiffRequest` (attributes, text, structure: insert/move/remove/group/image) — files `insert.ts, move.ts, remove.ts, group.ts, text.ts, image.ts, layout.ts`.
- Style editing: Tailwind class manipulation via `customTwMerge` into `className` (or appended to `cn(...)` call args) — `code-edit/style.ts`. Style edits = class edits, not CSS files.
- Selection: preload script in iframe (`apps/web/preload/script/api/{dom,elements,style,events,state}.ts`) reports elements over penpal.

**AI flow [V]:** Tool-calling agent (`packages/ai/src/agents/root.ts`, `tools/classes/*`): `read-file`, `write-file`, `search-replace-edit`, `search-replace-multi-edit`, `fuzzy-edit-file`, `bash-read/edit`, `grep`, `glob`, `typecheck`, `check-errors`, `terminal-command`. Partial edits = search/replace or "fast apply" (`<instruction><code><update>` prompt to morph-v3-large / Relace).

**Preview/sandbox [V]:** Remote VM via CodeSandbox SDK (`packages/code-provider/src/providers/codesandbox`) plus a `nodefs` local provider. Preview iframe ↔ editor via **penpal** (`apps/web/preload/script/index.ts`, `packages/penpal`), supports nested iframes (Storybook). Security = isolation delegated to CodeSandbox microVMs [I].

**Versioning [V]:** `isomorphic-git` commit/checkout/log — `packages/git/src/git.ts`. Branch concept in OID logic suggests multi-branch canvas [I]. Multi-page: Next.js App Router pages; `create-page` prompt in `packages/ai/test/prompt/data/create-page-system.txt` [V].

**Maintenance [V]:** last commit 2026-07-21 (~3.5 months before this review) — slowing [I].

## 2. bolt.diy

**Licence [V]:** `MIT` (`LICENSE`, "Copyright (c) 2024 StackBlitz, Inc. and bolt.diy contributors"). **Non-code terms [V]:** depends on `@webcontainer/api` `1.6.5-internal.2` (`package.json`). Per https://webcontainers.io/enterprise: "Licensing is required for production usage of the API in a commercial, for-profit setting" (prototypes exempt). MIT code does **not** grant that.

**Structure [V]:** single app, React Router 8 + Vite, Cloudflare Workers (`wrangler.jsonc`) and Electron (`electron/`). `ai` 7.0.128, CodeMirror 6, `isomorphic-git ^1.43.1`. Key: `app/lib/runtime/{message-parser,action-runner}.ts`, `app/lib/common/prompts/*`, `app/lib/webcontainer/index.ts`, `app/lib/persistence/*`.

**Visual editing [V]:** Lightweight only. `public/inspector-script.js` injected via `webcontainer.setPreviewScript` (`app/lib/webcontainer/index.ts`); `app/components/workbench/Inspector.tsx` gets `ElementInfo` (tag, className, CSS selector, computed styles, rect) via `postMessage(..., '*')` (`Preview.tsx` L639–820). **No DOM→source mapping**; selection is fed to the LLM as context. No AST transforms.

**AI flow [V]:** LLM streams XML `<boltArtifact>` with `<boltAction type="file" filePath=...>` (full file contents) and `type="shell"`/start — `message-parser.ts` L6–9, `prompts.ts` L94–101; `action-runner.ts` executes into WebContainer. Whole-file rewrites, not diffs [V for examples; partial diff path not found]. Has `agentLoop.ts` and project MCP tools (newer).

**Preview/sandbox [V]:** In-browser WebContainers (WASM Node) booted with `coep: 'credentialless'`; preview in iframe with error forwarding. Security = browser sandbox; secrets/API keys are client-side (`app/lib/api/apiKeys.ts`) [I].

**Versioning [V]:** chat history + file snapshots in IndexedDB (`persistence/db.ts`, `chatCache.ts`, `useChatHistory.ts` "rewind"); `lockedFiles.ts`; git import/export via `useGit.ts`. Single SPA, multi-page by generated router [I].

**Maintenance [V]:** last commit 2026-10-14 — active.

## 3. Archon (coleam00/Archon)
**[V via GitHub API]** licence `MIT`, not archived, pushed 2026-11-07, ~23.9k stars. Pattern [I from README]: knowledge/RAG + task management served to coding agents over MCP — relevant as a model for exposing design-system docs and project tasks to the CORE codegen agent via MCP rather than prompt stuffing.

## 4. Flowise (FlowiseAI/Flowise)
**[V via API/LICENSE.md]** SPDX shows `NOASSERTION`: Apache-2.0 **except** `packages/server/src/enterprise` and files like `IdentityManager.ts` under a Commercial License. Repo **archived** (pushed 2026-08-13), ~55.6k stars. Pattern [I]: node-graph visual builder for LLM chains/agents — reference only for an agent-workflow canvas; do not copy enterprise code; archived status = do not depend on it.

---

## Adopt (for CORE AI Design Studio — Azure, isolated container preview, NestJS + Python)
1. **Stable element IDs injected at source** (Onlook `data-oid`) — Babel/SWC pass that writes IDs into JSX (or injects at build time only) so DOM ↔ AST is deterministic.
2. **AST-level structured edits keyed by ID** (Onlook `transformAst` + `CodeDiffRequest`) for style/text/move/insert; LLM not needed for direct manipulation.
3. **Tailwind-class style editing with tailwind-merge** — keeps source idiomatic.
4. **penpal (typed RPC over postMessage)** with explicit origin checks for editor ↔ preview.
5. **Preload/inspector script injected into preview** (both repos).
6. **Tool-calling agent with search/replace edits + typecheck/check-errors tools** (Onlook); optional fast-apply model self-hosted.
7. **Git-based checkpoints** (isomorphic-git or real git in container) per AI turn / visual edit batch.
8. **Streaming action protocol idea** (bolt `<boltAction>`) for shell/start actions — but with diffs, not full files.
9. Error forwarding from preview to the agent for self-repair (bolt `forwardPreviewErrors`).

## Avoid
1. **WebContainers in production** without a StackBlitz commercial licence; also conflicts with "isolated container preview".
2. **CodeSandbox SDK dependency** — external SaaS; replace with Azure Container Apps / ACI sandboxes.
3. **`postMessage(..., '*')`** (bolt Preview.tsx) — always pin target origin.
4. **Whole-file LLM rewrites** for small edits (bolt) — token cost, clobbers manual edits.
5. **Selector/computed-style-only selection** without source mapping (bolt) — not reversible to source.
6. Client-side API keys / BYO keys in the browser (bolt).
7. Copying Flowise `enterprise/` code; depending on archived Flowise.
8. Committing `data-oid` noise into customer repos — strip on export or inject only at dev-build time.

## Recommended canvas architecture (sketch)
```
Browser (Studio UI, React)
 ├─ Canvas: N iframes (one per page/breakpoint) on preview.<tenant>.core... (separate origin)
 │    └─ preload.js (penpal child): hover/select, rects, computed styles, oid lookup, live DOM patch
 ├─ Overlay layer (selection boxes, drag handles) in parent; penpal parent w/ origin pinning
 └─ Panels: layers tree (from AST), style (Tailwind tokens), chat
        │ REST/WebSocket
NestJS API (control plane): auth/RBAC, projects, sessions, edit queue, git checkpoint orchestration
 ├─ Code-edit service (Node): Babel/SWC parse → oid index → apply CodeDiffRequest → prettier → write
 └─ Python AI service: agent loop (tools: read/search-replace/typecheck/run), LLM via the provider-agnostic LLM Gateway (no hardcoded provider; see 03-architecture/llm-gateway.md)
        │
Per-session isolated container (Azure Container Apps / ACI, no egress by default)
 ├─ project repo (git; commit per checkpoint) — React source is source of truth
 ├─ Vite dev server with oid plugin (dev-only) + HMR → preview origin via ingress
 └─ file watcher → re-index oids → push layer tree to UI
```
Flow: select in iframe → oid → parent shows props → user edit → optimistic DOM patch in iframe → code-edit service applies AST change → file write → HMR confirms → git checkpoint (debounced). AI edits go through the same file layer and re-run oid injection.
