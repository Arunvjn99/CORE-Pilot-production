# ADR-0009: Identity, BFF sessions, teams and RBAC

Status: **Accepted** (slice 2.1, 2026-11-09)

## Context

- **Deployment:** a single company on one Microsoft Entra tenant, with many teams inside it (decision D2).
- **Constraints:** no tokens in the browser; no authentication shortcuts; credential changes require step-up (D8).
- **No Entra app registration yet (D1).**

## Decision

1. **OIDC Authorization Code + PKCE (S256) in the NestJS BFF** using `openid-client` 6.
   - Callbacks are validated for state (single-use, stored hashed in Redis), nonce, and a browser-binding cookie that blocks login CSRF.
   - Only identities whose `tid` equals `OIDC_ALLOWED_TENANT_ID` are accepted.
   - Production config accepts only `https://login.microsoftonline.com/<tenant>/v2.0`.
2. **Sessions:** opaque 256-bit ID in `__Host-core_sid` (HttpOnly, Secure, SameSite=Lax, Path=/).
   - Stored in Redis keyed by SHA-256 of the ID, with idle (sliding) and absolute timeouts.
   - A new ID is issued on every sign-in (fixation defence). Sessions can be revoked singly or per user.
   - ID tokens are kept server-side only, as the logout hint.
3. **CSRF:** synchronizer token returned by `GET /auth/session`, held in memory by the SPA and sent as `x-csrf-token`. Every unsafe method also requires `Origin == PUBLIC_APP_ORIGIN`.
4. **Step-up:** `GET /auth/step-up` re-runs the flow with `prompt=login`. On success for the same user and session it stamps `stepUpAt`, and `@RequireRecentAuth()` routes accept it for `STEP_UP_MAX_AGE_MINUTES` (default 10). This does not rely on `auth_time`, which Entra v2 ID tokens omit by default.
5. **Directory and teams:**
   - `users` is the company directory: no RLS, runtime role SELECT only. It is written only through the `auth_upsert_user` SECURITY DEFINER function.
   - Teams are `organizations` and memberships are `organization_memberships`, both with forced RLS. The context (`app.organization_id`, `app.user_id`, `app.platform_admin`) is set per transaction by `withDbContext`.
6. **Roles:**
   - Team roles: `org_owner` ⊃ `org_admin` ⊃ `designer` ⊃ `viewer` (permission sets in `permissions.ts`).
   - Company role `platform_admin`: created teams, all-team member admin, platform credentials, all usage. It is granted only via the deployment bootstrap list and never auto-revoked.
   - Only owners or company admins can grant or remove owners, and the last owner is protected with row locks.
7. **Deny by default:**
   - Guards run in order: Session, then CSRF, then Permission, then RecentAuth. Routes opt out with `@Public()` (health, login, callback).
   - Team-scoped routes evaluate permissions on the `:orgId` in the path.
8. **Audit:** team actions go to `audit_events` in the same transaction as the change. Sign-in, sign-out and step-up outcomes go to append-only `security_events`, which the runtime role cannot read. Credential-like metadata keys are dropped.
9. **Local and CI identity provider:** `navikt/mock-oauth2-server` (MIT), running the same code path with only the issuer differing. Production validation rejects it.

## Trade-offs

- Redis becomes required for authentication. It is already required for rate limiting and is HA in Azure (Phase 7).
- Company admins can administer every team, which is needed for bootstrap and support. Every action is audited.

## Risks

- **Revoking access when someone leaves:** a removed Entra user keeps an existing session until it expires (12h max absolute). Mitigation: per-user session revocation exists, and a Graph/SCIM-driven offboarding hook is a Phase 7 item.
- **Platform admin is grant-only from config.** Removal is a manual DB operation; an admin UI is planned.
