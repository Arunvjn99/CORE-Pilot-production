# Figma-style app: layout, flow and plan (update to the v2 plan)

Status: **Proposed 2026-11-17**, building F1 → F4 in order. Updates §5 (Product screens) and §9 (Delivery plan) of [v2-rebaseline-plan.md](v2-rebaseline-plan.md). Decision record: [ADR-0014](../adr/0014-files-and-projects-hierarchy.md).

## 1. Hierarchy and words (as in Figma)

```
Team ─┬─ Project (a folder)  ─┬─ File  ─┬─ Screens (frames on the canvas, one route each)
      │                       │         ├─ DESIGN.md + tokens (design system copy)
      │                       │         └─ History (checkpoints) · Export
      ├─ Drafts (files not in a project, shared with the team)
      └─ Trash (files moved to trash, restorable)
```

| UI word | What it is                                                                   | Stored as                                       |
| ------- | ---------------------------------------------------------------------------- | ----------------------------------------------- |
| Project | A folder of files in a team                                                  | `folders` table (new)                           |
| File    | One design file: its own git repository with screens, design system, history | `projects` table (unchanged name; see ADR-0014) |
| Screen  | One frame on the canvas = one React page with a route                        | `project_pages` + `src/pages/**`                |
| Layer   | An element inside a screen (JSX element)                                     | the screen's source (no table)                  |

## 2. Flow

```
Sign in ─► File browser (/files/recent)
            ├─ Recents · Drafts · Projects ▸ <project> · Trash
            ├─ + New design file ──► (choose project, name, design system) ──► Editor
            ├─ + New project ──► project page (empty: "Create a file")
            └─ File card ⋯ ─► Open · Rename · Duplicate · Move to… · Export · Move to trash
Editor (/file/:id)
            ├─ File menu (name ▾): Rename · Duplicate · Move to… · Version history · Export · Move to trash
            ├─ Prompt the AI agents ─► screens appear live on the canvas
            ├─ Select a screen / layer ─► Design · Prototype · Verify panels (edits write source)
            ├─ ▶ Present (prototype) · ⤓ Export
            └─ ← back to the file's project in the browser
Trash ─► Restore (back to its project, or Drafts if the project was deleted)
```

## 3. Layout — file browser

```
┌────────────────────────┬─────────────────────────────────────────────────────────────────┐
│ CORE Studio      Team ▾│  Recents                          [ + New design file ]           │
│ 🔍 Search files        │  Sort: Last modified ▾   ▦ Grid ☰ List                           │
│                        │ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐               │
│ 🕘 Recents             │ │  thumbnail   │ │  thumbnail   │ │  thumbnail   │               │
│ 📝 Drafts              │ │              │ │              │ │              │               │
│                        │ ├──────────────┤ ├──────────────┤ ├──────────────┤               │
│ PROJECTS            +  │ │ Checkout  ⋯  │ │ Onboarding ⋯ │ │ Retirement ⋯ │               │
│ ▸ Payments          ⋯  │ │ Payments ·2h │ │ Drafts · 1d  │ │ Plans · 3d   │               │
│ ▸ Plans             ⋯  │ └──────────────┘ └──────────────┘ └──────────────┘               │
│                        │                                                                   │
│ 🗑 Trash               │                                                                   │
│ ───────────────        │                                                                   │
│ 📊 Metrics  ⚙ Settings │                                                                   │
└────────────────────────┴─────────────────────────────────────────────────────────────────┘
```

- Card: screen count, design system, project, last modified by/when. Thumbnail v1 = design-system colour band + screen count; rendered thumbnails come with V2 (off-screen frames).
- Card menu and right-click: Open · Rename · Duplicate · Move to… · Export · Move to trash. In Trash: Restore.
- Project menu (sidebar ⋯): Rename · Delete (its files move to Trash; confirmation lists how many).
- Keyboard: Enter opens the focused card; F2 renames; Delete moves to trash. Mobile: sidebar becomes a drawer, cards one column.

## 4. Layout — editor (Figma UI3 style)

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│ ◧ Plans / Retirement ▾      Desktop Tablet Mobile          − 29% + ⤢   ⤓  ⚙  [▶ Present] 👤│
├──────────────────────┬──────────────────────────────────────────────────┬───────────────────┤
│ Layers  AI  History  │                                                  │ Design Prototype  │
│ ─────────────────    │   01 Sign in /            02 Dashboard /dashboard│ Verify            │
│ SCREENS          +   │  ┌──────────────┐        ┌──────────────┐        │ ───────────────── │
│ ▣ Sign in      /     │  │ live screen  │  ───►  │ live screen  │        │ <h1>  Line 8      │
│ ▣ Dashboard /dash..  │  │              │        │              │        │ Text, Layout,     │
│ ─────────────────    │  └──────────────┘        └──────────────┘        │ Spacing, Size,    │
│ LAYERS (selected)    │                                                  │ Typography, Fill, │
│ ▾ main               │                                                  │ Border, Effects   │
│   ▾ section          │        ┌──────────────────────────────────┐      │                   │
│     h1  Welcome back │        │ ▸ Move  ✋ Hand  ▣ Screen  💬  ✨ │      │ DESIGN SYSTEM     │
│     button Continue  │        └──────────────────────────────────┘      │ CORE 2.0 ▾        │
└──────────────────────┴──────────────────────────────────────────────────┴───────────────────┘
```

- **Top bar:** breadcrumb `Project / File ▾` (file menu), device frames, zoom, Export, file settings, Present, account. The ◧ button toggles the panels (UI3 "minimise UI").
- **Left panel tabs:** **Layers** (Screens list with add/rename/delete + the selected screen's layer tree), **AI** (agent chat, run timeline, todos), **History** (checkpoints, restore, download). An Assets tab (tokens, later CORE components) follows in F4.
- **Bottom floating toolbar:** Move (V), Hand (H, or hold Space), Add screen (S), Comment (C, V9b), AI prompt (/). Shortcuts: Shift+1 fit, ⌘/Ctrl +/− zoom, Esc clears selection, ⌘/Ctrl Z / Shift Z undo/redo (V6).
- **Right panel:** unchanged tabs (Design · Prototype · Verify), plus the file's design system card.

## 5. CRUD (what each action does)

| Object           | Create                                   | Read                                       | Update                                                                                                           | Delete                                                                                                                  |
| ---------------- | ---------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Project (folder) | name (unique per team)                   | list with file counts                      | rename                                                                                                           | delete → its files go to Trash (restorable; restored files land in Drafts)                                              |
| File             | name, project (or Drafts), design system | recents, by project, drafts, trash, search | rename, move to project, duplicate (copies the repository with history, new name "… (copy)"), restore from trash | move to trash (read-only, restorable). **Delete forever: later** (retention job; checkpoints are append-only by design) |
| Screen           | add (name + route)                       | list, live preview                         | rename/route, content via AI or Design panel                                                                     | delete with confirmation                                                                                                |

Permissions stay as today (R8): viewers read and export; designers and above create, edit, move, duplicate and trash.

## 6. Delivery (inserted before V6; replaces the project dashboard)

| #      | Slice                                                  | Delivers                                                                                                                                                  |
| ------ | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F1** | Projects and files API                                 | `folders` CRUD; files gain `folderId`, move, duplicate, trash/restore semantics; search and sort; contracts; integration tests incl. RLS                  |
| **F2** | File browser                                           | Sidebar (Recents, Drafts, Projects, Trash), grid/list, sort, search, file and project dialogs and menus, keyboard, mobile drawer; unit + E2E + axe        |
| **F3** | Editor shell (UI3)                                     | Route `/file/:id` (old `/projects/:id` redirects), breadcrumb file menu, left tabs Layers/AI/History, bottom floating toolbar and shortcuts, panel toggle |
| **F4** | Layers tree + Assets                                   | Preview reports the element tree with source locations; select from layers; Assets tab with tokens                                                        |
| then   | V6 undo/redo · V9b comments · V7 triggers · thumbnails | as in the v2 plan                                                                                                                                         |
