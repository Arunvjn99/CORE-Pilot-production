# ADR-0003: Persistence — PostgreSQL + Drizzle ORM with versioned SQL migrations

Status: **Accepted** (2026-11-09, product owner)

## Context

Tenant isolation via PostgreSQL Row-Level Security with a per-transaction tenant setting; explicit transactions; reviewable migrations; no `create_all`.

## Options

Prisma · TypeORM · Drizzle.

## Decision

Drizzle ORM + drizzle-kit generated SQL migrations committed to the repo and applied by a dedicated migration job (never at app startup in production).

## Trade-offs

- SQL-first, typed, transparent SQL, easy `SET LOCAL app.tenant_id` in transactions, RLS policies in migrations.
  − Pre-1.0 (0.45.x); smaller ecosystem than Prisma.

## Risks

API changes before 1.0 → pin exact versions; wrap in a repository layer.
