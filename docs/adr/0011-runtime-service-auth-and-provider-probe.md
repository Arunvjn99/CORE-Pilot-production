# ADR-0011: API → AI runtime service authentication and provider probes

Status: **Accepted** (slice 2.4, 2026-11-09)

## Context

Slice 2.4 needs real connection tests and model discovery for stored credentials. Only the AI runtime can decrypt credentials (ADR-0010), so the API must call it. Until now the runtime was protected only by network isolation. Adding an internal endpoint that decrypts secrets and makes outbound calls needs real authentication, and the outbound calls need SSRF protection (`docs/security/provider-endpoint-ssrf.md`).

## Decision

1. **Service auth = OAuth2 access tokens from the company IdP.**
   - Azure: the API's managed identity obtains a token for the runtime's app ID URI (`AI_RUNTIME_AUTH_MODE=managed-identity`, required in production, together with an https `AI_RUNTIME_URL`).
   - Local/CI: client-credentials from the mock IdP with the BFF client (`client-credentials`).
   - The runtime validates RS256 signature (JWKS via discovery), `iss`, `aud`, `exp`/`iat` and that `sub` is in `SERVICE_AUTH_ALLOWED_CALLERS`. Production settings require all of them, with an https issuer. Same code path in every environment; no shared secrets.
2. **The API sends the sealed envelope, never plaintext.** `POST /internal/v1/providers/probe` carries provider, endpoint, deployment and the base64 envelope. The runtime unwraps, calls the provider and returns only a fixed outcome code, latency and model ids. Upstream bodies are never relayed.
3. **Probe = the vendor's model-listing endpoint.** It proves key and endpoint without spending tokens. For Azure OpenAI the listing proves the key and resource; the configured deployment is reported as the model (the deployment name itself is not verified).
4. **Egress is pinned.** Resolve once, reject if any address is non-global (unless operator allow-listed, or non-production), connect to the checked IP with the original Host and SNI, try the remaining checked addresses on connection refusal, no redirects, no ambient proxies, a 2 MB response cap and timeouts. Address classification is shared with the API through `packages/contracts/test-vectors/egress-address-cases.json`.
5. **Persistence.** `last_test_code` and `last_tested_at` are stored on team and company credential rows (a team testing a company credential gets an audit entry only). The team default model is a new RLS table `organization_llm_defaults` that references exactly one team or entitled company credential. It is cleared when that credential is revoked or the team loses access.
6. **Activity feed.** `GET /llm/activity` reads `llm_*` audit events for the active team. Events about personal credentials are visible only to their actor.

## Consequences

- A compromised API could still ask the runtime to use a stored key against an endpoint the API supplies (for Azure/Ollama). It cannot read the key back, and egress rules still apply. Binding the endpoint into the envelope AAD (envelope v2) would close this; it is tracked as R16.
- Test-connection costs one runtime round-trip plus one Key Vault unwrap in Azure. Rate limits apply per user through the global throttler.
- `httpx2` and `PyJWT` became runtime dependencies of the AI runtime.
