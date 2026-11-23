# CORE AI Design Studio — re-baseline plan (v2)

Status: **Proposed — awaiting approval.** Date: 2026-11-17. Baseline: `main` @ `09cd423`.
Revision 2: adds the POC agents and CORE 2.0 design system, editable agent/design files, a single API key, the metrics dashboard, and moves user permissions to later.

## 1. Direction

Build the product **end to end first**: prompt → agents → designed screens on a canvas → Figma-style editing → prototype → verify → export. To get there faster we reuse three open-source studios and the POC, on top of the enterprise foundation already built (sign-in, teams, credential vault, AI runtime gateway, projects, git repos, CI).

**User permissions:** one working role for now. Every signed-in member of a team can do everything in the product. The existing role system stays in the code untouched and comes back as a pipeline item (§9) once the product works.

## 2. What we reuse — and whether we may

| Source                   | Licence | Can we use the code?                                                                                                                                                                      | What we take                                                                                                                                                                                        |
| ------------------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **open-codesign**        | MIT     | **Yes.** Copy, modify and ship it, keeping the MIT copyright notice in a `THIRD_PARTY_NOTICES` file. Only its 25 third-party brand files (Stripe, Apple, Nike…) are excluded (trademarks) | Agent tool contracts, prompt sections and design skills, the preview self-check loop, the click-to-edit source engine, comments, tweaks, design-system parsing, the quality-judge rubric, exporters |
| **dsh-design-studio**    | MIT     | **Yes**, same terms. In practice we rewrite it in TypeScript because it is untyped, very large files and tied to its host app                                                             | Canvas pan/zoom over live screens, element picker, style panel pattern, link lines between screens, design checks, colour/contrast maths                                                            |
| **codexdesign**          | GPL-3.0 | **No code.** Interface ideas only, rebuilt by us                                                                                                                                          | Storyboard canvas layout, "visual direction" card, several directions side by side, floating toolbar, annotate mode                                                                                 |
| **POC (CORE Studio V2)** | Ours    | **Yes**                                                                                                                                                                                   | The LangGraph agent set, the **CORE 2.0 design system**, the company and domain knowledge base, the layout references                                                                               |

## 3. Agents (from the POC, upgraded)

POC agents found in `packages/backend/app/agents/`:

- **Pipeline:** intent classify → decompose → enrich.
- **Agents:** planner, research, flow, UX, UI, review/validator, QA test, screenshot, conversation and code.
- **Orchestrator:** a linear LangGraph `pipeline → planner → ux → ui → review`, with approval interrupts.

### v2 agent graph (LangGraph, in the existing AI runtime)

```
prompt + attachments + selected element + comments
   │
   ▼
 Orchestrator ──ask user (interrupt)──► chat card ─┐
   │  intent · plan · todos                        │ answer
   ▼                                               │
 Research / Requirements  (company + domain knowledge, compliance rules)
   ▼
 Flow agent        → screens and navigation flow (feeds Prototype mode)
   ▼
 UX agent          → layout per screen from CORE layout grammar
   ▼
 Design-direction  → 1–3 directions → DESIGN.md + tokens (CORE 2.0 by default)
   ▼
 UI agents ×N      → one per screen, in parallel; write screen source through the API
   ▼
 Verifier          → render worker: errors, layout, contrast, accessibility, screenshots
   ▼
 Reviewer (judge)  → checklist scores per screen (CORE 2.0 rules + WCAG + brand)
   ▼
 Fix loop (max 2) → done  ──► optional Code agent: export a React/Vite project
```

Every step, prompt, tool call, token count and score is traced to **LangSmith** (§6) and recorded for the dashboard (§7).

### Customisable agents — `AGENT.md`

- **Each agent has an `AGENT.md`** holding its role, instructions, rules, output format, model choice and temperature, and which knowledge it may use.
  - Defaults are shipped from the POC prompts.
  - A team can edit any agent's file at any time in **Settings → Agents**: an editor with preview, a "test this agent" run, version history, diff and revert.
- **Project-level override:** a project can override an agent's file for that project only.
- **Version pinning:** each run records the exact version of every agent file it used. This is shown in the run details and in LangSmith, so results are reproducible and comparable.
- **Graph changes:** the order of agents stays fixed in code for v2. Agents can be turned off per project (e.g. skip Research), and the Fix loop limit is configurable.

### Customisable design systems — `DESIGN.md`

- **Library:** **CORE 2.0 is the default** design system, plus a curated set of generic styles from the POC (minimal, flat, corporate, …).
  - Brand-named files (Apple, Uber, Notion…) from the POC and open-codesign are left out (trademarks).
- **Editing:** each design system has a `DESIGN.md` and tokens, editable in **Settings → Design systems** with a live token preview, versions and revert.
- **Per project:** a project picks a design system and can override it in its own `DESIGN.md`. This file lives in the project's git repository, so every design change is versioned with the screens.
- **Knowledge base:** the POC's company and domain documents (accessibility, branding, compliance, UX standards, Retirement World spec, banking and healthcare patterns, 401(k) compliance) can be edited the same way and are retrieved by the agents.

## 4. One API key

- **One company-wide model key** is configured once in **Settings → AI provider**. Every agent, the judge and the verifier use it through the AI runtime.
  - The key stays encrypted (built in slices 2.3–2.4).
  - The browser never sees it.
- **Model choice:** one default model for all agents. An agent's `AGENT.md` may name a different model _on the same key_ (e.g. a cheaper model for research, a stronger one for UI).
- Personal keys and per-team keys stay in the code but are hidden in the UI for now.

## 5. Product screens

> **Updated 2026-11-17:** the app follows Figma's structure (Team → Projects → Files → Screens) with a file browser and a UI3-style editor. Layout, flow and CRUD: [figma-style-app-plan.md](figma-style-app-plan.md) (ADR-0014). The sketch below remains the editor's intent.

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ Toolbar: project ▾ · page ▾ · Design | Prototype | Code · zoom · ▶ Play · Share · Export │
├───────────────┬──────────────────────────────────────────────────┬───────────────────────┤
│ LEFT          │ CANVAS (infinite, pan/zoom, multi-select,        │ RIGHT (Figma-style)   │
│ • AI chat:    │  resize handles, snapping, guides)               │ Design: position/size,│
│   agent steps,│  ┌ Visual direction card ┐                       │  constraints, auto-   │
│   todos, ask  │  01 Login → 02 Home → 03 Detail (live screens)  │  layout, spacing,     │
│   cards       │  directions A / B / C side by side               │  typography, fill,    │
│ • Layers      │  comment pins · selection overlay                │  stroke, effects,     │
│ • Pages/flows │  floating toolbar: select · frame · text · hand  │  tokens               │
│ • Assets      │                    · comment · +                 │ Prototype: triggers,  │
│               │                                                  │  actions, transitions,│
│               │                                                  │  flows, start screen  │
│               │                                                  │ Verify: checks/scores │
└───────────────┴──────────────────────────────────────────────────┴───────────────────────┘
Other screens: Projects dashboard · Settings (AI provider, Agents, Design systems, Knowledge) · Metrics dashboard
```

**How editing stays honest to code:** every visual change in the right panel or on the canvas becomes a precise change to the screen's React source. For example, moving or resizing changes layout classes and padding changes spacing tokens. The change goes through the click-to-edit source engine with no AI call and becomes undoable. The source in git remains the single source of truth.

## 6. LangSmith verification

- **Tracing:** every agent run becomes a LangSmith trace, with the agent-file versions and the design-system version attached.
- **Scores:** the Verifier's checks and the Reviewer's checklist are attached as feedback scores. The studio's Verify tab shows the same results.
- **Human feedback:** accepting, rejecting or editing a generated screen is sent as feedback.
- **Regression gate:** a fixed test set of prompts runs in CI whenever an agent file default, prompt or model changes. The build fails if the average score drops.
- **Hosting (decision R4):** traces contain prompts and designs. The options are LangSmith cloud EU (needs company approval), LangSmith self-hosted (Enterprise licence) or Langfuse self-hosted (open source). The code sits behind a small switchable interface, and tracing stays off until you decide.

## 7. Metrics dashboard

Built from data we record ourselves (LangSmith is optional), so it works whatever R4 decides.

- **Usage and cost:** tokens and estimated cost per run, agent, model, screen, project and day.
- **Quality:** checklist pass rate, scores per agent and per design-system version, fix-loop rounds, accept/reject rate.
- **Speed and errors:** time per agent and per run, failures by type, provider errors.
- **Product activity:** projects, screens generated, edits, prototypes played, exports.
- **Comparison:** compare agent-file versions (before/after an `AGENT.md` change).

Layout follows the studio's design language. If you have a Figma design for this dashboard, share it and I'll match it (the Figma connector needs authorising in `/mcp` first).

## 8. What happens to what we built

| Keep as-is                                               | Change                                                                             | Retire                                                        |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Build system, CI, hardened containers                    | Workspace layout → the new studio screen                                           | Per-preview server containers plan (slices 2.6b–f)            |
| Sign-in, teams, audit, team separation                   | Project files → React screens + `DESIGN.md` + tokens; full Vite app only on export | Derived element-id index (replaced by open-codesign's engine) |
| Encrypted key vault, AI runtime gateway, provider checks | AI provider settings → simplified to "one key"                                     | —                                                             |
| Projects dashboard, git repo per project, checkpoints    | Roles → one role for now (code kept)                                               | —                                                             |

Nothing is removed until the slice that replaces it is built.

## 9. Delivery plan

Each slice ends tested, demoable and committable.

| #        | Slice                              | Delivers                                                                                                                                                                  | Size |
| -------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| **V1**   | Studio shell + canvas              | 3-pane screen, infinite canvas (pan, zoom, fit, multi-select, resize handles, snapping, guides), frames at device sizes, layers and pages panels, floating toolbar        | L    |
| **V2**   | Live screens                       | Separate preview origin, React screens rendered live in frames, hot update, error overlay, thumbnails for off-screen frames                                               | M    |
| **V3**   | Agents v1 + chat                   | POC agents ported to the v2 LangGraph graph with open-codesign tool contracts; streamed steps, todos and ask cards; one API key; CORE 2.0 default; screens written to git | L    |
| **V4**   | Agent and design-system management | Settings → Agents (`AGENT.md` editor, test run, versions), Design systems (`DESIGN.md` + tokens editor), Knowledge base editor, per-project overrides                     | M    |
| **V5**   | Verify + LangSmith                 | Render worker, checks, reviewer checklist, fix loop, Verify tab, LangSmith tracing/feedback, CI regression set                                                            | M–L  |
| **V6**   | Figma-style right panel            | Element picking, position/size, constraints, auto-layout, spacing, typography, fill, stroke, effects, tokens; source write-back; undo/redo                                | L    |
| **V7**   | Prototyping                        | Triggers (click, hover, after delay), actions (navigate, overlay, back, scroll), transitions, flows, start screen, Play mode                                              | M    |
| **V8**   | Metrics dashboard                  | §7                                                                                                                                                                        | M    |
| **V9**   | Comments, versions, export         | Comment pins + annotate, version history on checkpoints, export HTML/PDF/PNG/PPTX/ZIP/React project                                                                       | M    |
| Pipeline | Later                              | User roles and permissions UI, Figma plugin import/export (POC has one), real-time co-editing, Azure deployment and hardening                                             | —    |

**Update 2026-11-17:** slices F1–F4 (projects and files, file browser, editor shell, layers) come before V6 — see [figma-style-app-plan.md](figma-style-app-plan.md) §6.

**Order:**

- V1 and V3 run in parallel (frontend vs Python).
- V2 follows V1.
- V4 and V5 follow V3.
- V6 and V7 follow V2.
- V8 and V9 come last.

## 10. Decisions needed

| ID  | Question              | Recommendation                                                                        |
| --- | --------------------- | ------------------------------------------------------------------------------------- |
| R1  | Design source format  | React screens + `DESIGN.md` + tokens in the project repo; full Vite project on export |
| R2  | Canvas engine         | Trial React Flow vs a custom canvas in V1's first two days                            |
| R3  | Agent runtime         | POC LangGraph agents in our AI runtime, upgraded with open-codesign's tool contracts  |
| R4  | LangSmith hosting     | Company decision; tracing off until then                                              |
| R5  | codexdesign           | Interface ideas only                                                                  |
| R6  | Retire 2.6b–f         | Yes                                                                                   |
| R7  | Design-system library | CORE 2.0 default + generic POC styles; no brand-named systems                         |
| R8  | Permissions           | One role now; roles UI in the pipeline                                                |
