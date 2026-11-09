import base64
import json
from dataclasses import replace
from pathlib import Path

import pytest

from ai_runtime.vault.envelope import (
    CredentialDecryptionError,
    LocalKeyUnwrapper,
    SealedCredential,
    open_sealed,
)

VECTOR_PATH = (
    Path(__file__).resolve().parents[3] / "packages/contracts/test-vectors/credential-envelope-v1.json"
)


@pytest.fixture
def vector() -> dict[str, str | int]:
    data: dict[str, str | int] = json.loads(VECTOR_PATH.read_text())
    return data


def sealed_from(v: dict[str, str | int]) -> SealedCredential:
    def b(key: str) -> bytes:
        return base64.b64decode(str(v[key]))

    kind = str(v["kind"])
    assert kind in ("team", "platform")
    return SealedCredential(
        kind=kind,  # type: ignore[arg-type]
        credential_id=str(v["credentialId"]),
        envelope_version=int(v["envelopeVersion"]),
        ciphertext=b("ciphertext"),
        iv=b("iv"),
        auth_tag=b("authTag"),
        wrapped_dek=b("wrappedDek"),
        kek_id=str(v["kekId"]),
        kek_version=str(v["kekVersion"]),
        wrap_algorithm=str(v["wrapAlgorithm"]),
    )


def test_decrypts_envelope_sealed_by_the_api(vector: dict[str, str | int]) -> None:
    unwrapper = LocalKeyUnwrapper(str(vector["localKekBase64"]))
    assert open_sealed(sealed_from(vector), unwrapper) == vector["expectedSecret"]


def test_ciphertext_is_bound_to_its_credential_id(vector: dict[str, str | int]) -> None:
    sealed = replace(sealed_from(vector), credential_id="00000000-0000-4000-8000-000000000000")
    with pytest.raises(CredentialDecryptionError):
        open_sealed(sealed, LocalKeyUnwrapper(str(vector["localKekBase64"])))


def test_ciphertext_is_bound_to_its_kind(vector: dict[str, str | int]) -> None:
    with pytest.raises(CredentialDecryptionError):
        open_sealed(
            replace(sealed_from(vector), kind="platform"), LocalKeyUnwrapper(str(vector["localKekBase64"]))
        )


def test_wrong_kek_fails(vector: dict[str, str | int]) -> None:
    other = base64.b64encode(bytes(32)).decode()
    with pytest.raises(CredentialDecryptionError):
        open_sealed(sealed_from(vector), LocalKeyUnwrapper(other))


def test_tampered_ciphertext_fails(vector: dict[str, str | int]) -> None:
    sealed = sealed_from(vector)
    tampered = replace(sealed, ciphertext=bytes([sealed.ciphertext[0] ^ 1]) + sealed.ciphertext[1:])
    with pytest.raises(CredentialDecryptionError) as info:
        open_sealed(tampered, LocalKeyUnwrapper(str(vector["localKekBase64"])))
    assert str(vector["expectedSecret"]) not in str(info.value)


def test_unknown_envelope_version_rejected(vector: dict[str, str | int]) -> None:
    with pytest.raises(CredentialDecryptionError):
        open_sealed(
            replace(sealed_from(vector), envelope_version=2), LocalKeyUnwrapper(str(vector["localKekBase64"]))
        )


def test_key_vault_wrapped_credentials_are_not_opened_locally(vector: dict[str, str | int]) -> None:
    sealed = replace(
        sealed_from(vector), wrap_algorithm="RSA-OAEP-256", kek_id="https://v.vault.azure.net/keys/k"
    )
    with pytest.raises(CredentialDecryptionError):
        open_sealed(sealed, LocalKeyUnwrapper(str(vector["localKekBase64"])))
