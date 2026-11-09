# Preview communication protocol and source mapping

Status: **Approved 2026-11-09.** Part of [SLICE_2_6_ARCHITECTURE.md](SLICE_2_6_ARCHITECTURE.md).

## 1. Channels

```
 Studio (apps/web)                     Preview document (preview origin)              Control plane
 ─────────────────                     ─────────────────────────────────              ─────────────
 PreviewFrame ── protocol client ◄═══► inspector script (preview-inspector)           apps/api
      │        (window.postMessage      │   reads data-core-oid / data-core-instance      ▲
      │         handshake, then a       │   observes DOM, errors, navigation              │
      │         private MessageChannel) │                                                  │
      │                                 └── Vite client (HMR WS to the same origin)        │
      └── HTTPS (fetch, cookie + CSRF) ───────────────────────────────────────────────────┘
          session status, code-index lookups, file reads, (2.7) edits
```

- **Studio ↔ preview document:** `postMessage` for the handshake only, then a `MessagePort` pair. This carries UI-level data: oids, rectangles, a DOM summary and errors.
- **Studio ↔ API:** the existing BFF. Source locations, file content and edits are **always** fetched from the API, never accepted from the preview. The preview can only point at an oid; the API decides what that oid means at a given revision.
- **API ↔ gateway ↔ agent:** the control plane in [PREVIEW_SERVICE_ARCHITECTURE.md](PREVIEW_SERVICE_ARCHITECTURE.md) §6. The preview document never talks to it.

## 2. Handshake (strict origin, no wildcard)

1. The API returns `{previewUrl, previewOrigin, sessionId, revision}`. The studio derives nothing from the URL; it uses `previewOrigin` exactly as returned.
2. The gateway gave the agent the **studio origin** at lease time. The agent serves the inspector with the studio origin and a per-session `channelNonce` embedded as constants in the inspector module (served from the preview origin, never read from the URL or `document.referrer`).
3. On load the inspector calls `window.parent.postMessage({t:'core.hello', v:1, nonce}, STUDIO_ORIGIN)`. The browser drops it if the parent isn't actually that origin.
4. The studio's listener accepts only if:
   - `event.origin === previewOrigin`;
   - `event.source === iframe.contentWindow`;
   - the payload parses as `hello` with a supported protocol version;
   - the `nonce` equals the one the studio received from the API for this session.
5. The studio creates a `MessageChannel` and posts `{t:'core.welcome', v:1, nonce}` with `port2` transferred to the iframe, again with `targetOrigin = previewOrigin`.
6. All later traffic uses the ports. The channel is torn down on iframe reload (a new handshake runs automatically) or when the session changes.

**Rules:**

- **Code checks:** an ESLint rule forbids `postMessage(…, '*')` across the repository. A protocol unit test asserts the client never posts without an exact origin.
- **Validation:** every inbound message is validated with `packages/preview-protocol` (Zod). It must be ≤ 64 KB (DOM tree snapshots ≤ 1 MB, chunked) and arrive within 120 messages/s, otherwise it is dropped and counted.
- **Rendering:** strings from the preview (tag names, class names, error text) are rendered as text only and truncated. They are never used as HTML or URLs, and never sent to the API except as typed, bounded fields.

## 3. Message catalogue (protocol v1)

Every message is `{t, v: 1, id?, revision?, ...payload}`. `revision` is the working revision the preview is rendering, as reported to the agent by the API on sync and exposed to the inspector via `/__core/status` on the same origin.

### Preview → studio

| `t`            | Payload                                                                                                                                                                             | Use                                                    |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `core.hello`   | `{nonce, protocol: 1, inspectorVersion}`                                                                                                                                            | Handshake                                              |
| `ready`        | `{path, revision, viewport:{w,h}, documentHeight}`                                                                                                                                  | App mounted / after HMR                                |
| `hover`        | `{oid \| null, instance?: oid, rect?: Rect}`                                                                                                                                        | Hover highlight (throttled to animation frames)        |
| `select`       | `{oid, instance?: oid, rect: Rect, tag, componentChain: oid[] (≤20), computed: {display, position, margin, padding, fontSize, fontWeight, color, backgroundColor, width, height} }` | Element selection                                      |
| `rects`        | `{items: [{oid, rect}] (≤200)}`                                                                                                                                                     | Re-measure after scroll, resize or HMR                 |
| `tree`         | `{root: TreeNode}` with `TreeNode = {oid?, instance?, tag, children: TreeNode[]}` (≤5,000 nodes, depth ≤ 64)                                                                        | Layers panel (2.7)                                     |
| `navigated`    | `{path}`                                                                                                                                                                            | In-app navigation; the studio syncs the selected page  |
| `runtimeError` | `{message ≤ 1 KB, stack? ≤ 4 KB (frames with file:line only), oid?, source: 'window' \| 'promise' \| 'react'}`                                                                      | Error banner                                           |
| `buildError`   | `{file, line, column, message ≤ 2 KB}`                                                                                                                                              | Vite overlay replacement                               |
| `hmr`          | `{revision, files: string[] (≤50)}`                                                                                                                                                 | Studio refreshes the index cache and re-requests rects |

### Studio → preview

| `t`                            | Payload                                             | Use                                                                                                                   |
| ------------------------------ | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `core.welcome`                 | `{nonce}` + transferred port                        | Handshake                                                                                                             |
| `setMode`                      | `{mode: 'select' \| 'interact'}`                    | In select mode the inspector captures pointer events (prevents app clicks); in interact mode the app behaves normally |
| `highlight`                    | `{oids: oid[] (≤50), style: 'hover' \| 'selected'}` | Selection from the layers panel or the code panel                                                                     |
| `clearHighlight`               | `{}`                                                |                                                                                                                       |
| `scrollIntoView`               | `{oid}`                                             |                                                                                                                       |
| `navigate`                     | `{path}` (validated against the manifest routes)    | Page switching in the studio                                                                                          |
| `requestTree` / `requestRects` | `{oids?}`                                           |                                                                                                                       |
| `reload`                       | `{}`                                                | Soft reload                                                                                                           |

**Who draws overlays:** the studio draws them on top of the iframe using reported rectangles, which keeps all editor UI out of the untrusted document. The inspector draws only an optional thin outline in `interact` mode.

**Viewport changes** are done by the studio resizing the iframe (desktop 1440, tablet 834, mobile 390, custom) and scaling with CSS transforms. They are not done by messages. The inspector reports the new `rects` after resize.

**Lifecycle events** (starting, syncing, ready, error, stopped) come from the API (heartbeat/poll), not from the preview. The preview can't fake a "ready" state for a session it doesn't own.

## 4. Sequence: select an element → identify source

```
user clicks in iframe (select mode)
 inspector: event.target.closest('[data-core-oid]') → oid, instance
 inspector ──select{oid, instance, rect, revision}──► studio
 studio: draws selection overlay from rect
 studio ──GET /api/v1/projects/:id/code-index/:oid?revision=N──► api
 api: index for revision N (cached; built from the working tree with packages/code-index)
 api ──{file:"src/pages/pricing/PricingPage.tsx", start:{line:14,col:6}, end:{line:18,col:12},
        elementName:"section", componentName:"PricingPage", instance?:{file, componentName}}──► studio
 studio: shows "PricingPage.tsx:14" and (2.7) opens the code panel and inspector at that range
 (if the revision moved on) api → 409 STALE_REVISION {current}; studio waits for the hmr message and retries once
```

## 5. Stable element ids and DOM → source mapping

### Algorithm (`packages/code-index`, used by both the API and the Vite plugin)

```
oid = base32( sha256( normalisedRepoPath + "\0" + structuralPath ) )[0..12)
structuralPath = "<ComponentName>/" + indexes of JSX elements from the component's return root, e.g. "PricingPage/0.2.1"
```

- **Parser:** `@babel/parser` with `typescript` and `jsx` plugins. The options are identical on both sides and pinned in one exported constant.
- **Indexing:** only `JSXElement` nodes are numbered. Fragments are transparent: their children are numbered as if they belonged to the fragment's parent. Elements inside `.map()` callbacks or conditionals keep their source-position index, so every rendered item of a list shares one oid. Selection then means "this JSX in source", which is what an edit changes. Items are disambiguated in the DOM by order only.
- **Components** are identified by the nearest enclosing function or arrow declaration with a capitalised name, or the default export.
- **Injection:**
  - Intrinsic elements (`div`, `section` …) get `data-core-oid`.
  - Elements that are component usages (`<PricingCard …/>`) get `data-core-instance="<oid>"` as a prop. Components forwarding `...props` or the template's `cn`/`className` conventions put it on their root DOM node.
  - When a component doesn't forward it, selection falls back to the definition's root oid and the studio shows "instance of PricingCard (props not forwarded)".
- **Never persisted:** ids exist only in the preview's transformed modules (the plugin runs in `serve` mode only) and in the API's index. Exported or built apps contain no `data-core-*` attributes; a CI test asserts this.

### Why derived ids instead of Onlook's persisted `data-oid`

|                        | Onlook (persisted ids in source)                            | CORE (derived ids)                                                                                                                                                                                             |
| ---------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Customer code          | Contains editor attributes that must be stripped            | Clean                                                                                                                                                                                                          |
| AI edits               | Models must preserve ids; duplicates and losses need repair | Nothing to preserve                                                                                                                                                                                            |
| Stability across edits | Stable through moves                                        | Shift when sibling structure changes                                                                                                                                                                           |
| Our mitigation         | —                                                           | Every edit response carries `oidRemap: {old → new}` computed by diffing the two indexes (matched by element name + structural hash of attributes and children). The studio remaps its selection and undo stack |

### API index

- **Build:** for a revision, parse every `*.tsx` under `src/` (about 50 ms per file, bounded by limits) and build `Map<oid, Location>`.
- **Cache:** in Redis keyed by `(project, revision, file sha256)` so unchanged files are reused across revisions.
- **Response:** `GET /code-index/:oid` returns the location. `GET /code-index?file=` returns the file's tree, which drives the layers panel in 2.7.

### Edge cases

| Case                                                             | Behaviour                                                                                                                                                             |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Element rendered by a library component (e.g. a router `<Link>`) | Gets `data-core-instance` from its usage; the DOM node may not carry it if the library doesn't forward unknown props → falls back to the nearest ancestor with an oid |
| Text node selection                                              | Resolves to the parent element; editing text is an op on that element (2.7)                                                                                           |
| Portals                                                          | Carry oids normally; rects are reported relative to the iframe viewport                                                                                               |
| HMR mid-selection                                                | `hmr` message → the studio re-requests rects; if the oid no longer exists, the selection is cleared with a notice                                                     |
| Same file imported by many pages                                 | Same oids everywhere (they identify source, not DOM instances)                                                                                                        |

## 6. Versioning and compatibility

- Protocol `v` is checked at the handshake; the studio supports `v1` only in 2.6–2.7.
- `inspectorVersion` and `pluginVersion` are reported in `hello`. Mismatches between the API's code-index version and the plugin version (baked in the agent image) are detected at session start (the agent reports its plugin version in `/status`), and the session fails with `error: index_version_mismatch` rather than producing wrong mappings.

## 7. Testing

- **Code index:**
  - Property tests: oid equality between the API index and the Vite plugin output for a corpus of TSX files (the template, generated pages, tricky fixtures).
  - Determinism across runs.
  - `oidRemap` correctness for insert, move and remove.
  - No `data-core-*` in `vite build` output.
- **Protocol:**
  - Schema tests for every message.
  - Handshake rejects a wrong origin, wrong source, wrong nonce or wrong version.
  - Oversize and flood messages are dropped.
  - The ESLint wildcard ban.
- **E2E (compose stack):**
  - Select → overlay drawn at the reported rect → file:line shown.
  - A rogue sibling iframe's messages are ignored.
  - HMR after a page create keeps the selection or clears it with a notice.
