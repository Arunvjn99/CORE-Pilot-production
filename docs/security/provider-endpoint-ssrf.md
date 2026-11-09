# Provider endpoint SSRF review (slice 2.3 follow-up)

Scope: customer-supplied endpoints for Azure OpenAI and Ollama. The other providers (OpenAI, Anthropic, Gemini) cannot set an endpoint (contract rule). The API never connects to these endpoints itself; only the AI runtime gateway will (Phase 2 gateway slice).

## Threats

| Threat                                   | Example                                                 | Control                                                                                                                                  |
| ---------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Internal service access                  | `https://10.0.0.5`, `https://ollama`                    | Save-time policy blocks private, loopback, link-local, CGNAT, multicast IP literals and single-label or internal host names (production) |
| Cloud metadata theft                     | `https://169.254.169.254`, `https://[::ffff:a9fe:a9fe]` | Link-local range blocked, including IPv4-mapped IPv6 forms                                                                               |
| Credential smuggling or parser confusion | `https://user:pw@host`, query or fragment               | Always rejected                                                                                                                          |
| Protocol downgrade                       | `http://`                                               | HTTPS required in production                                                                                                             |
| **DNS rebinding**                        | Public name that later resolves to `10.x`               | **Cannot be solved at save time.** Must be enforced at connect time (below)                                                              |
| Redirect to an internal address          | 302 to `http://169.254.169.254`                         | Gateway must not follow redirects                                                                                                        |

## Implemented (API, save time)

- `apps/api/src/credentials/endpoint-policy.ts` (`checkProviderEndpoint`, `isBlockedAddress`), applied on create and rotate for team, personal and company-managed credentials.
- In production, operators can exempt specific private hosts (e.g. a VNet Ollama) through `LLM_ENDPOINT_ALLOWED_PRIVATE_HOSTS`. Exact host matches only, no wildcards.
- Development and test allow `http://localhost` so local Ollama works. The always-on rules still apply.
- Tests: `apps/api/test/unit/endpoint-policy.test.ts`, with 17 blocked production cases and 4 always-blocked cases.

## AI runtime gateway (implemented in slice 2.4, `services/ai-runtime/src/ai_runtime/gateway/egress.py`)

1. Resolve the host once, and check **every** returned address with the same ranges as `isBlockedAddress` (shared list in `packages/contracts` or a mirrored Python list with a parity test).
2. Connect to the checked IP (pin it), sending the original Host header and SNI. Do not let the HTTP client re-resolve.
3. Disable redirects. Apply short connect and read timeouts and a response size cap.
4. Production egress through a network policy or Azure Firewall that only allows 443 to the internet plus the allow-listed private hosts. This is defence in depth if the code checks are bypassed.
5. Never return upstream error bodies verbatim to users (avoids it being used as a port scanner or to read internal pages). Map to a fixed error code set.

## Residual risk

Connect-time enforcement is implemented and tested (`tests/test_gateway.py`). Item 4 (network-level egress policy) and item 1's shared list are partially met: classification is shared via `packages/contracts/test-vectors/egress-address-cases.json`; Azure egress rules come with the infrastructure in Phase 7. The rows that currently store endpoints have passed only the save-time check. The gateway re-checks them at call time, so tightening the policy later does not require a data migration.
