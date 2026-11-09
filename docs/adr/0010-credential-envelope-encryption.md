# ADR-0010: LLM credential storage — envelope encryption with a crypto split

Status: **Accepted** (slice 2.3, 2026-11-09)

## Context

Teams, individuals (D3) and company admins (D4) store LLM API keys. These keys:

- must never reach the browser, logs or API responses;
- must be rotatable and revocable;
- must be configured at runtime, without redeploying.

A compromise of the control plane (NestJS API) should not expose stored keys.

## Decision

1. **Envelope encryption, v1:**
   - Each secret gets a fresh 256-bit DEK and is encrypted with AES-256-GCM (96-bit IV, 128-bit tag).
   - The AAD is `core-credential:v1:<team|platform>:<credentialId>`, so a ciphertext copied to another row or table fails integrity.
   - The DEK is wrapped by a KEK and then zeroed.
   - Stored per credential: ciphertext, IV, tag, wrapped DEK, KEK id and version, wrap algorithm, envelope version.
2. **KEK:**
   - Azure: an HSM-backed **Key Vault RSA key**, using RSA-OAEP-256 wrap and unwrap.
   - Local development and test: an AES-256-GCM key wrap with `LOCAL_KEK`. Production configuration refuses it.
3. **Crypto split (least privilege):**
   - The **API can only wrap**: its managed identity has only the `wrapKey` data action, and its source contains no decrypt or unwrap code. A unit test scans the source to enforce this.
   - The **AI runtime is the only component that can unwrap and decrypt**: its managed identity has only `unwrapKey`. It decrypts per call, in memory.
   - Both runtimes share one cross-language test vector (`packages/contracts/test-vectors/credential-envelope-v1.json`).
4. **Data model:**
   - **`llm_credentials`** holds team (`organization`) and personal (`user`) credentials:
     - RLS isolates each team.
     - A **RESTRICTIVE** policy means personal credentials are visible only to their owner, even to team owners and company admins.
     - The team policy `allow_personal_credentials` (default off) gates personal credentials.
   - **`platform_llm_credentials`** holds company-managed credentials (D4). Company admins manage them, and teams see only those they are entitled to (`platform_llm_entitlements`).
5. **Lifecycle:**
   - **Create:** every create requires step-up (D8).
   - **Rotate:** re-seals with a new DEK under the same id, and also requires step-up.
   - **Revoke:** an UPDATE that nulls all key material; a check constraint makes revoked rows hold none. It requires step-up too.
   - **No DELETE:** the runtime role has no `DELETE` grant on credentials, which keeps the audit trail.
6. **What is exposed:** responses return metadata only, plus at most the last 4 characters for secrets of 16+ characters. Team changes write `audit_events`; platform changes write `security_events`. Credential-like keys are stripped from audit metadata, and logs redact `secret` fields.
7. **Endpoint validation:** Azure OpenAI and Ollama require endpoints, and production requires HTTPS. Other providers cannot set an endpoint, which limits SSRF.

## Trade-offs

- Every model call will need an unwrap (a Key Vault round-trip). Mitigation for Phase 3+: a short-lived, in-memory DEK cache in the AI runtime, keyed by credential id and version, never persisted.
- The API cannot "test" a key itself. Connection tests go through the AI runtime (slice 2.4).

## Risks

- **KEK rotation:** new seals use the current key version, and old versions must stay enabled until every credential is re-sealed. A re-seal job is a Phase 7 item.
- **Personal credentials of removed members** remain until revoked by their owner or by a DB operation. An offboarding cleanup job is a Phase 7 item.
- **Plain-HTTP Ollama endpoints** are allowed outside production only.
