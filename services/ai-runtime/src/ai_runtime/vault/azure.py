"""Production unwrap via Azure Key Vault (RSA-OAEP-256).

The AI runtime managed identity holds only the `unwrapKey` permission.
"""

from azure.identity import DefaultAzureCredential
from azure.keyvault.keys.crypto import CryptographyClient, KeyWrapAlgorithm

from ai_runtime.vault.envelope import CredentialDecryptionError, SealedCredential


class AzureKeyVaultUnwrapper:
    def __init__(self, allowed_key_id: str) -> None:
        self._allowed_key_id = allowed_key_id.rstrip("/")
        self._credential = DefaultAzureCredential()

    def unwrap(self, sealed: SealedCredential) -> bytes:
        if sealed.wrap_algorithm != "RSA-OAEP-256" or sealed.kek_id.rstrip("/") != self._allowed_key_id:
            raise CredentialDecryptionError("credential was not wrapped with the configured Key Vault key")
        client = CryptographyClient(f"{sealed.kek_id}/{sealed.kek_version}", self._credential)
        try:
            return client.unwrap_key(KeyWrapAlgorithm.rsa_oaep_256, sealed.wrapped_dek).key
        except Exception as exc:
            raise CredentialDecryptionError("key unwrap failed") from exc
