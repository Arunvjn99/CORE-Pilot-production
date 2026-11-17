# CORE 2.0 Design System

> Category: Enterprise Platform (Retirement / 401k plan administration)
> Extracted directly from the company's real Figma component library and reference screens.
> Tokens and layout grammar below are ground truth — not stylistic approximation.

## 1. Visual Theme & Atmosphere

CORE 2.0 is the company's real enterprise design system, mined from an actual Figma file
containing a 154-frame component/style-guide library (component variants plus paired
Overview/Accessibility/Style/Usage documentation pages) and 150+ real product screens
(Dashboard, Payroll File Info, Choose Investment, Questionnaire wizard, Login, Loan,
Contributions, Manage Plan, Admin Dashboard, Employee details, Plan configuration, etc).

The aesthetic is flat and restrained: white/light-grey surfaces, hairline borders, a single
strong primary blue used sparingly, semantic status colours with tinted backgrounds, and soft
ambient drop-shadows (never colored glows). There are no gradients, no decorative blobs, no
glassmorphism anywhere in the source screens — any generation that introduces these is wrong.

**Key Characteristics:**
- Pure white (`#FFFFFF`) canvas, light neutral surfaces (`#F5F5F5`, `#E6E6E6`) for layering
- Single primary accent (`#004DCB`) used only on primary buttons, active/selected states, links, focus rings
- Semantic status colours: green success, amber warning, red critical, teal highlight — tinted light backgrounds
- 4px base spacing grid: 4/8/12/16/24/32/48px
- Border radius: 2px (hairlines) / 4px (inputs) / 8px (buttons, cards) / 16px (badges, large radii)
- Elevation: 3 named shadows (Shadow1/2/3), all neutral-grey, plus 3 focus-ring shadows (default/error/success)
- Typography: Open Sans
- WCAG 2.1 AA mandatory
- **Layout grammar exists and is locked** — see Section 11. Do not compose new page shells; reuse the mined templates.

## 2. Page Templates & Layout Grammar

This is the piece a components-and-tokens spec normally omits — and the actual cause of
generated screens "feeling like a different company" even when colors/components matched.
Five structural templates were mined from real screens (3-9 consistent duplicate samples each).
**Generation must reuse these exact skeletons and vary only the named content slot** — never
invent a new shell, resize the sidebar/navbar, or reorder sections.

### `shell_sidebar` — mined from Payroll File Info (4 samples)
- Canvas: 1440×900
- Fixed left sidebar `Side Menu bar - Light`: width=100px, full height
- Top navbar `Navbar - Top`: height=66px, spans x=100..1440
- Content region: x=100, y=66, width=1340, height=834 — **the only slot that varies**

### `shell_topnav` — mined from Dashboard-enrolled (3 samples)
- Canvas: 1440×1024
- Full-width top `Navbar`: height=72px, x=0,y=0,width=1440
- Slim icon rail `Menubar`: width=96px, below navbar
- Content region: x=96, y=72, width=1344, height=952 — **the only slot that varies**
- This is a **distinct shell** from `shell_sidebar` (66px vs 72px navbar, 100px vs 96px rail) — never mix the two on one screen

### `split_wizard` — mined from Questionnaire-1..6 (4+ samples per step)
- Canvas: 1440×1024
- Left rail: width=592px, full height (step indicator / illustration / context)
- Right form panel: width=848px, x=592; inner content padded x=84,y=72, width=680, height≈649
- Use for any multi-step form, questionnaire, or onboarding flow

### `panel_header_body_footer` — mined from Choose Investment (9 samples) + Risk level acknowledgement (7 samples)
- Canvas: 1100×1024 — this is an **embedded panel/drawer, not a full page shell** (no sidebar/navbar)
- Header: height=61px, title left-aligned, ~24px padding
- Body: height=890px, scrollable primary content
- Footer: height=73px, right-aligned action buttons, ~24px right margin
- Use for modal-like selection/review/acknowledgement steps embedded within a larger flow

### `auth_split` — mined from Login with password (5 samples)
- Canvas: 1441×1019 — **no app shell** (auth screens are shell-free)
- Left decorative/illustration column: width=638px
- Right form column: width=803px

### `shell_appbar` — mined from Admin Dashborad (4 samples) + Employee details
- Canvas: 1440×900
- Icon rail `App Bar`: width=96px, full height, x=0,y=0
- Top navbar `Navbar - Top`: height=64px, spans x=98..1440
- Content region: x=98, y=67, width=1342, height=833 — **the only slot that varies**
- **Distinct** from `shell_topnav` (72px navbar) and `shell_sidebar` (100px sidebar/66px navbar) — this uses a 96px rail with a 64px navbar. Use for record-detail / admin dashboards.

### `shell_config_nested` — mined from Plan -Sponsor, Plan - Basic Details, Confg - Plan details (3 samples)
- Canvas: 1440×900
- Same outer shell as `shell_appbar` (96px App Bar rail + 64px Navbar-Top)
- **Plus** a secondary in-page `Plan details-sidemenu` panel: width=317px, full content height (836px), directly after the rail/navbar
- Remaining content area: ~1025px wide — **the only slot that varies**
- Use for settings/configuration/multi-section-form screens — the secondary side menu is the key structural signal, not a generic tab bar or accordion.

### Known gaps (fewer than 2 verified samples — treat cautiously, prefer the closest template above)
Full data-table/list page, multi-tab content page, empty/error states. If asked for one of
these, fall back to the nearest structural match above rather than inventing new composition.

## 3. Color System

### Primary (Brand/background/*, Brand/Text/*, Brand/Borders/* in Figma)
- `#004DCB` — primary actions, active controls, links, focus indicators, selected states
- `#00368E` — hover state of primary
- `#002F7C` — active/pressed state of primary
- `#E6EDFA` — tinted background behind primary elements (active rows, info surfaces)
- `#96B6EA` — primary disabled state / focus ring color

### Success (Semantics/Success/*)
- `#105F27` — success text/icons; `#178737` — strong success background; `#E8F3EB` — light background

### Warning (Semantics/Warning/*)
- `#A56811` — warning text/icons/background; `#FDF4E8` — light background

### Critical (Semantics/Critical/*)
- `#9C2227` — critical text/icons; `#C92830` — strong critical background; `#FCEAEB` — light background

### Highlight / Info (Semantics/Highlights/*)
- `#037EA0` — highlight text/icons; `#E6F2F6` — light background; `#025870` — border

### Neutral (Neutral/Text/*, Neutral/Surfaces/*, Neutral/border/*)
- `#292929` — primary text
- `#3D3D3D` — secondary text
- `#575757` — tertiary/helper text
- `#A8A8A8` — placeholder / disabled text
- `#E0E0E0` — subtle border, `#B8B8B8` — strong border, `#D9D9D9` — light border
- `#FFFFFF` — layer-01 (card/input surface), `#F5F5F5` — layer-02, `#E6E6E6` — layer-03, `#E0E0E0` — layer-04, `#D9D9D9` — layer-05
- `#1A1A1A` — high-contrast surface (rare — dark UI elements only)

## 4. Typography

### Font Family
`"Open Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`

### Scale
| Level | Size | Weight | Line Height | Letter Spacing | Usage |
|---|---|---|---|---|---|
| H2 | 32px | 600 (SemiBold) | 24 | 1 | Major section headers |
| Page Title | 24px | 700 (Bold) | 32 | 0 | Application/page headers |
| Heading | 22px | 700 (Bold) | 24 | 1 | Sub-page headings |
| H6 | 18px | 600 (SemiBold) | 24 | 1 | Card/section titles |
| Body Large | 16px | 500 (Medium) | 16 | 0-2 | Emphasized body text |
| Body Regular | 14px | 400 (Regular) | 16-100 | 0 | Default body/labels |
| Body Small | 14px | 600 (SemiBold) | 16 | 0 | Table cells, dense labels |
| Extra Small | 12px | 500/600 (Medium/SemiBold) | 16 | 0 | Helper text, badges, uppercase overlines |

### Rules
- Headings and values: colour `#292929`
- Secondary/body: colour `#3D3D3D`
- Helper/muted: colour `#575757`
- Disabled: colour `#A8A8A8`

## 5. Spacing System

Base unit: 4px — scale: **4 / 8 / 12 / 16 / 24 / 32 / 48px**

| Token | Value | Usage |
|---|---|---|
| XS | 4px | Icon spacing, tight internal gaps |
| S | 8px | Label-to-control spacing, icon-label gap |
| SM | 12px | Compact component internal padding |
| M | 16px | Component internal padding (inputs, buttons, cells) |
| L | 24px | Card padding, panel header/footer padding, form field group spacing |
| XL | 32px | Section spacing within a page |
| XXL | 48px | Page-level section spacing, major layout gaps |

## 6. Radius System

| Token | Value | Usage |
|---|---|---|
| XS | 2px | Hairline dividers, minor accents |
| Small | 4px | Inputs, selects, checkboxes, table cells |
| Medium | 8px | Buttons, cards, containers |
| Large | 16px | Badges, pill-shaped elements |
| Pill | 9999px | Chips, tags |

## 7. Elevation System

All shadows are **neutral grey — never colored glows.** Reconciled against the formal
"Shadows" style-guide page added to Figma (Elevation-01/02/03 spec: X/Y/Blur/Spread/Opacity/
Color) — this supersedes the earlier raw Shadow1/2/3 effect-token values.

| Level | Shadow | Usage |
|---|---|---|
| 0 | none | Flat surfaces: forms, tables, page background |
| Elevation-01 | `0 2px 4px -1px rgba(0,0,0,0.05)` | Cards, panels |
| Elevation-02 | `0 5px 5px -3px rgba(0,0,0,0.06)` | Dropdowns, floating elements |
| Elevation-03 | `0 8px 10px -5px rgba(0,0,0,0.08)` | Modals, top-level floating panels |

### Focus Shadows (state-specific, from Figma `Focus Shadow/*` tokens)
- Default: `0 0 0 2px #96B6EA`
- Error: `0 0 0 2px #F2AAAD`
- Success: `0 0 0 2px #A0CEAD`

## 8. Focus System

- Every interactive element must expose a visible focus ring using the Focus Shadow tokens above
- Never suppress outline — use `focus-visible` so focus only shows on keyboard, not mouse click

## 9. Component Library (from the real Figma component section — 154 frames, 34 core component groups plus paired Overview/Accessibility/Style/Usage documentation pages per component)

Accordion, Avatar, Badges, Buttons, Checkboxes, Loader, Chips & Pills, Date Range, Select,
Input, Tree tab, Pagination, Scroll, Label, Progress-bar, Stepper, Selector, Tabs, Tooltips,
Toggle, Logo, Notifications, Cards, Searchbar, File Uploader, Table, Side Menubar, Time Picker,
Calendar, App-bar, Nav-bar, Links, Telerik Data Table, Radio buttons. Plus dedicated
documentation sections: Color - Tokens/Light theme/Accessibility/Usage, Typography - Styles/
Accessibility, Grid-overview/usage, Iconography, Layout-UIShell, Shadows, DataTables-Overview.

### Button
- Primary: `background:#004DCB; color:#FFFFFF; border-radius:8px; padding:10px 20px; font-weight:600`
- Secondary: `background:#FFFFFF; color:#292929; border:1.5px solid #E0E0E0; border-radius:8px; padding:9px 20px; font-weight:500`
- Disabled: 40% opacity, `cursor:not-allowed`

### Input Text
- `background:#FFFFFF; border:1.5px solid #E0E0E0; border-radius:4px; padding:10px 14px; font-size:14px; color:#292929`
- Focus: box-shadow `0 0 0 2px #96B6EA`
- Error: border-color `#9C2227`, box-shadow `0 0 0 2px #F2AAAD`

### Card
- `background:#FFFFFF; border:1px solid #E0E0E0; border-radius:8px; padding:24px; box-shadow: 0 2px 5px rgba(184,184,184,0.5)`

### Badge / Status
Exactly 5 semantic variants — never invent a 6th color or use raw Tailwind color classes:
- Success: `background:#E8F3EB; color:#105F27; border-radius:16px; padding:3px 10px; font-size:12px; font-weight:600`
- Warning: `background:#FDF4E8; color:#A56811; border-radius:16px; padding:3px 10px; font-size:12px; font-weight:600`
- Critical: `background:#FCEAEB; color:#9C2227; border-radius:16px; padding:3px 10px; font-size:12px; font-weight:600`
- Highlight: `background:#E6F2F6; color:#037EA0; border-radius:16px; padding:3px 10px; font-size:12px; font-weight:600`
- Neutral: `background:#F5F5F5; color:#3D3D3D; border-radius:16px; padding:3px 10px; font-size:12px; font-weight:600`

### Data Table
- Two size variants (from the real Figma `Table` component): **Small** (40px row height) and **Regular** (48px row height) — pick one and stay consistent within a screen.
- Header row: `background:#F5F5F5; border-bottom:2px solid #E0E0E0; font-size:12px; font-weight:600; text-transform:uppercase; letter-spacing:0.04em; color:#575757; padding:12px 16px`
- Header cells support independent toggles, mined as real variants: **Filter**, **Sort**, **Search**, **More-Option** — combine only the ones actually needed per column, don't add all four decoratively.
- Checkbox column states (mined variants): Default, Unselected, Selected, Group — use for multi-row selection.
- Data row: `border-bottom:1px solid #E0E0E0; padding:14px 16px; font-size:14px; color:#3D3D3D`
- Selected row: `background:#E6EDFA; border-left:3px solid #004DCB`
- Use 8-12 realistic rows for any generated table — a 2-3 row table under-represents the real product's data density.

### Accordion
- Header: `padding:16px; border-bottom:1px solid #E0E0E0; font-size:14px; font-weight:600; color:#292929`
- Panel: `padding:16px; background:#F5F5F5; font-size:14px; color:#3D3D3D`
- Summary variant (mined from Figma): the collapsed header can show a right-aligned muted summary value (e.g. a running total) — use this for grouped financial/plan data instead of a plain collapsed row.

## 10. Accessibility Standards

- **Keyboard**: Tab to focus, Enter/Space to activate, Escape to close modals/dropdowns
- **Screen reader**: `aria-label` on icon-only buttons, `aria-describedby` on inputs, `aria-invalid` on errors
- **Focus visibility**: focus ring per Section 8, never removed
- **Colour contrast**: 4.5:1 minimum body text, 3:1 large text/UI components
- **Disabled states**: `aria-disabled="true"` so element remains focusable and discoverable

## 11. Design Patterns

### Forms
- Labels always above inputs
- Group related fields in flat cards (Elevation-01)
- Validation inline, on blur — error message below field
- Multi-step forms use the `split_wizard` template (Section 2), not a generic progress bar page

### Tables
- Use Data Table with sorting/filtering for datasets > 10 rows, inside the `shell_sidebar` or `shell_topnav` content region
- Row actions: icon buttons visible on hover
- Empty state: centred illustration + title + description + primary CTA

### Progressive Disclosure
- Accordion for grouped financial data, plan details, investment breakdowns
- `panel_header_body_footer` for actions requiring focus/confirmation (not a full-page modal)
- Never show more than 7 fields without sectioning into accordions or wizard steps

### Settings / Configuration
- Use the `shell_config_nested` template (Section 2) — App Bar + Navbar outer shell plus a
  secondary 317px `Plan details-sidemenu` — for any multi-section settings/plan-configuration
  screen, mined from the real `Plan - *` screen series (Sponsor, Basic Details, Restrictions,
  Enrollment, Eligibility, Compensation, Transfers, Rollovers, Loans, etc.)

## 12. Brand Mark / Logo

The real `Logo` component: a "CORE" wordmark with a red target/crosshair ring replacing the
"O", navy letters. **Exact** vector paths and exact colors (`#292670` navy, `#BA141A` red)
were pulled directly from Figma's Dev Mode MCP asset server (`get_design_context` succeeded
on this node and returned real per-letter/icon asset URLs; each SVG was downloaded and
verified by rendering — pixel-accurate, not an approximation). Also saved as a standalone
asset at `packages/frontend/public/brand/core-logo.svg`.

```html
<svg width="108" height="40" viewBox="0 0 400 148" xmlns="http://www.w3.org/2000/svg">
  <g transform="translate(0,19)"><path fill="#292670" d="M103.666 23.583L92.8668 31.883L91.7807 30.4823C87.6658 25.1092 82.5901 20.8233 76.4909 17.8754C70.3081 14.9066 63.6658 13.5895 56.8146 13.5895C49.107 13.5895 41.859 15.4084 35.1332 19.2135C28.658 22.8722 23.436 27.8271 19.718 34.2664C15.9373 40.8312 14.2454 48.0023 14.2454 55.5706C14.2454 67.2157 18.1097 77.2092 26.4648 85.3838C35.0287 93.7466 45.5144 97.3426 57.4204 97.3426C71.3943 97.3426 82.7363 91.7813 91.8224 81.2024L92.9086 79.9271L103.708 88.1226L102.601 89.5443C97.3159 96.2763 90.7363 101.44 82.9661 105.036C74.7154 108.883 65.859 110.493 56.7937 110.493C39.7285 110.493 24.6266 105.162 13.3264 92.074C4.13577 81.3906 0 68.721 0 54.6507C0 39.4304 5.30548 26.3845 16.2089 15.7638C27.4047 4.87131 41.1488 0 56.6893 0C65.9217 0 74.9034 1.73527 83.1958 5.81212C91.0287 9.65899 97.5666 15.1157 102.663 22.1822L103.666 23.583Z"/></g>
  <g transform="translate(102.68,-2.63) scale(0.819,0.834)">
    <path fill="#BA141A" transform="translate(10,10)" d="M20.9561 83C22.4556 113.264 46.717 137.554 76.998 139.068V160C35.1745 158.458 1.54165 124.825 0.000976562 83H20.9561ZM160 83C158.459 124.825 124.825 158.458 83.002 160V139.068C113.283 137.554 137.544 113.264 139.044 83H160ZM83.002 0.000976562C124.825 1.54342 158.458 35.1763 160 77H139.041C137.516 46.7394 113.244 22.4965 83.002 20.9834V0.000976562ZM76.998 20.9834C46.7339 22.4952 22.4831 46.7385 20.959 77H0C1.5183 35.1755 35.1509 1.54139 76.998 0V20.9834Z"/>
    <path fill="#292670" transform="translate(50,50)" d="M79.7793 43C78.3238 62.7659 62.5995 78.536 42.8896 80V43H79.7793ZM36.8896 43V79.999C17.1806 78.5334 1.45691 62.7461 0 43H36.8896ZM42.8896 0C62.5991 1.46396 78.3222 17.2347 79.7783 37H42.8896V0ZM36.8896 37H0C1.45757 17.2544 17.181 1.46657 36.8896 0.000976562V37Z"/>
    <rect fill="#BA141A" x="87" y="0" width="6" height="10"/>
    <rect fill="#BA141A" x="87" y="170" width="6" height="10"/>
    <rect fill="#BA141A" x="170" y="87" width="10" height="6"/>
    <rect fill="#BA141A" x="0" y="87" width="10" height="6"/>
  </g>
  <g transform="translate(255.96,21.5)"><path fill="#292670" d="M13.7441 13.5268V44.5944L29.5143 44.7199C33.859 44.7617 39.812 44.5317 43.906 42.901C46.7467 41.772 49.0235 39.974 50.6945 37.4025C52.3655 34.7891 53.1593 31.9458 53.1593 28.8515C53.1593 25.82 52.3655 23.0603 50.6945 20.5306C49.0861 18.0845 46.9556 16.3074 44.2402 15.2202C40.3968 13.694 34.0261 13.5477 29.9321 13.5477H13.7441V13.5268ZM33.859 58.0167L70.496 105.371H53.4308L16.8355 58.1003H13.7232V105.371H0V0H22.0365C26.7989 0 31.6031 0.0627209 36.3446 0.355418C39.2898 0.522673 42.5065 0.773557 45.389 1.44258C51.6553 2.88515 56.9608 5.97938 61.0966 10.9552C65.3785 16.0983 67.1749 22.245 67.1749 28.8933C67.1749 34.4337 65.9216 39.7231 62.9973 44.4481C60.1148 49.1103 56.0209 52.4554 51.0287 54.6716C45.9321 56.9295 39.6867 57.7867 33.859 58.0167Z"/></g>
  <g transform="translate(338.16,21.5)"><path fill="#292670" d="M13.7233 13.5268V41.8765H61.4517V55.4033H13.7233V91.865H61.4517V105.371H0V0H61.8486V13.5268H13.7233Z"/></g>
</svg>
```

Use this exact markup verbatim in the shell header (navbar/topbar) of every generated screen —
do not invent a different logotype, icon mark, or color for it.

### Anti-patterns (things the real screens never do)
- No gradients — solid flat fills only
- No decorative blobs/orbs/blur shapes
- No glassmorphism / backdrop-filter
- No colored box-shadow glows — shadows are always neutral grey
- No resizing the sidebar/navbar dimensions specified in Section 2
