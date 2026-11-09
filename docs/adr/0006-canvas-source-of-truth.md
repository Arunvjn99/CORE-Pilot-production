# ADR-0006: Canvas — DOM-backed, oid-mapped editing over real React source

Status: **Proposed** (detailed design in Phase 6)

## Decision

Adopt Onlook-style patterns (Apache-2.0, reference only): build-time `data-oid` injection in dev builds only, AST edits keyed by oid (Babel + Prettier + tailwind-merge), separate-origin preview iframes with origin-pinned typed RPC, git checkpoints. Fabric.js retired. React source in git is the only source of truth; Screen IR is used for planning/first generation only and is not round-tripped.

## Rejected

WebContainers (commercial licence for production), CodeSandbox SaaS (third-party execution of customer code), selector-only selection, whole-file LLM rewrites.
