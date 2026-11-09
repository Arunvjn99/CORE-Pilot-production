# Credential vault: Azure validation, KEK rotation and cleanup

Related: ADR-0010, `docs/security/provider-endpoint-ssrf.md`.

## 1. Azure Key Vault integration gap

**Status:** the `azure-key-vault` wrappers (API `wrapKey` and AI runtime `unwrapKey`) are implemented and covered by unit tests against a stubbed `CryptographyClient`. They have **never run against a real Key Vault**. Everything else in the vault was verified with the local KEK.

Unverified until run in Azure:

- Managed identity token acquisition (`DefaultAzureCredential`) in Container Apps.
- RBAC: API identity can wrap only, runtime identity can unwrap only.
- RSA-OAEP-256 interoperability between the Node and Python SDKs on a real HSM key.
- Behaviour on throttling (Key Vault limits), network failure and disabled key versions.
- Private endpoint and firewall configuration.

### Validation steps (needs someone with Azure deploy rights)

1. Provision a Key Vault (Premium for HSM) with RBAC authorisation, purge protection and soft delete. Create an RSA 3072 key `llm-kek`, with key operations limited to `wrapKey` and `unwrapKey`.
2. Create a custom role with only the data action `Microsoft.KeyVault/vaults/keys/wrap/action` and assign it to the **API** managed identity on that key. Assign the role with only `.../keys/unwrap/action` to the **AI runtime** identity.
3. Set the API env `CREDENTIAL_KEK_PROVIDER=azure-key-vault` and `AZURE_KEY_VAULT_KEY_ID=https://<vault>.vault.azure.net/keys/llm-kek` (versionless), and set the same on the runtime.
4. Smoke test:
   - Create a credential through the UI or API (step-up required).
   - Confirm the row has `kek_id` set to the versioned key URL and `wrap_algorithm=RSA-OAEP-256`.
   - Run the runtime's decrypt self-test (gateway test-connection, slice 2.4b) and confirm it succeeds.
5. Negative tests:
   - The API identity calling `unwrapKey` must get **403**.
   - The runtime identity calling `wrapKey` must get 403.
   - With the key version disabled, the runtime must fail closed with `CredentialDecryptionError` and no plaintext in the logs.
6. Check Key Vault diagnostic logs in Log Analytics. Each wrap and unwrap must appear with the expected identity.
7. Record the results in TEST_REPORT.md and close this gap in SECURITY_REVIEW.md.

## 2. Master key (KEK) rotation

- Each sealed credential stores the **versioned** KEK id it was wrapped with. New seals use the current version. Unwrap uses the stored version, so rotating the key in Key Vault does not break existing credentials.
- **Implications:**
  - Old key versions **must stay enabled** until no credential references them. Disabling one makes those credentials undecryptable (fail closed: the model calls fail and the user must re-enter the key).
  - Rotation does **not** re-encrypt data by itself. A compromised old version stays useful to an attacker who also has the ciphertext until the credentials are re-sealed.
  - Only the DEK is re-wrapped. Secret ciphertext and the AAD are unchanged.
- **Planned (Phase 7):** a re-seal job running under a dedicated identity with unwrap and wrap rights. It selects rows where `kek_id` is not the current version, unwraps the DEK and re-wraps it with the current version in the same transaction, then writes a security event per row. Disable the old version after `count = 0`.
- **Local KEK:** rotation is not supported. Changing `LOCAL_KEK` makes existing local credentials undecryptable. That is acceptable for development; re-enter the keys.

## 3. Credential cleanup implications

| Case                                     | Current behaviour                                                                                                                          | Risk                                                                  | Plan                                                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Revoke                                   | Material nulled in place, row kept (no DELETE grant)                                                                                       | None: nothing left to decrypt                                         | —                                                                                                           |
| Member removed from a team               | Their **personal** credentials in that team stay active but unusable: membership is required to act in the team, and RLS still scopes them | Stale encrypted data; it comes back to life if the person is re-added | Phase 7 offboarding job: revoke personal credentials on removal (or immediately in the removal transaction) |
| User leaves the company (Entra disabled) | Sign-in blocked; rows remain                                                                                                               | Same as above                                                         | Phase 7: a scheduled job using Entra account status                                                         |
| Team deleted                             | Not supported yet                                                                                                                          | —                                                                     | Team deletion must revoke all credentials first                                                             |
| Company credential entitlement removed   | The team loses access immediately; the credential remains                                                                                  | None                                                                  | —                                                                                                           |
| Audit retention                          | Revoked rows and audit events are kept indefinitely                                                                                        | Grows slowly; no secret material                                      | Retention policy decision (13 months proposed for usage data)                                               |

Revocation is cryptographic erasure: once the wrapped DEK is nulled, the secret cannot be recovered even from backups taken **after** revocation. Backups taken **before** revocation still contain the wrapped DEK. They are useless without the KEK, but this matters for the KEK rotation policy above.
