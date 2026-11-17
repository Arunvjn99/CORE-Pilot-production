# @core-studio/studio-library

Default content shipped with CORE Studio. Teams edit their own copies in **Settings**; these files are
only the starting point and the "reset to default" target.

- `agents/<key>.md` — default `AGENT.md` per agent (front matter: `name`, `description`).
- `design-systems/<slug>/DESIGN.md` — design-system guidance for the agents.
- `design-systems/<slug>/tokens.css` — CSS variables. **Every design system defines the same variable
  names**, so generated screens work with any of them.

Sources: agent roles adapted from the CORE Studio POC agents (planner, research, flow → orchestrator;
ux; ui; validator + QA → reviewer). Design systems: CORE 2.0 (company design system, from the POC
knowledge base) and three generic styles from the POC library. Brand-named third-party systems are
deliberately not included.
