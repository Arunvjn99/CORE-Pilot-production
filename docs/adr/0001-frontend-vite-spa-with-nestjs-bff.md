# ADR-0001: Frontend — Vite SPA + NestJS BFF

Status: **Accepted** (2026-11-09, product owner)

## Context

The editor is a long-lived, client-heavy workspace (canvas, inspector, code editor, iframe previews). Auth must use Entra ID with no tokens in browser storage. The POC used Next.js 15 (audit: client-only auth guard, tokens in localStorage).

## Options

1. Next.js App Router — SSR/RSC, own server layer.
2. Vite SPA served as static assets; NestJS acts as Backend-for-Frontend (BFF) owning OIDC + session cookies.

## Decision

Option 2.

## Trade-offs

- One server tier (NestJS) for auth/session/API; no duplicate server logic; simple static hosting; fast HMR.
  − No SSR (not needed: authenticated app, no SEO); routing/data-loading conventions must be set by us.

## Risks

Marketing/public pages, if ever needed, would be a separate app.
