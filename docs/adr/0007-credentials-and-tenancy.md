# ADR-0007: Credential storage and tenant isolation

Status: **Proposed — requires product-owner decision**

## Proposal

- Tenancy: shared PostgreSQL schema, `organization_id` on every tenant table, enforced by RLS + app-layer checks.
- LLM credentials: envelope encryption — per-record data key encrypted by a Key Vault key (managed identity); ciphertext in PostgreSQL; plaintext only in AI-runtime memory at call time. Precedence: personal (if org allows) → org default → none (no platform fallback).

## Open questions

Single-tenant vs multi-tenant SaaS; data residency; whether personal keys are allowed; provider data-retention policy.
