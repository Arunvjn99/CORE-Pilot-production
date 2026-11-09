"""Envelope v1 decryption. Mirrors apps/api/src/credentials/crypto/envelope.ts (seal side)."""

import base64
from dataclasses import dataclass
from typing import Literal, Protocol

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ENVELOPE_VERSION = 1
LOCAL_KEK_AAD = b"core-kek:local:v1"

CredentialKind = Literal["team", "platform"]


class CredentialDecryptionError(Exception):
    """Raised for any integrity or key failure. Never includes key material or plaintext."""


@dataclass(frozen=True, slots=True)
class SealedCredential:
    kind: CredentialKind
    credential_id: str
    envelope_version: int
    ciphertext: bytes
    iv: bytes
    auth_tag: bytes
    wrapped_dek: bytes
    kek_id: str
    kek_version: str
    wrap_algorithm: str


class KeyUnwrapper(Protocol):
    def unwrap(self, sealed: SealedCredential) -> bytes: ...


def credential_aad(kind: CredentialKind, credential_id: str) -> bytes:
    return f"core-credential:v{ENVELOPE_VERSION}:{kind}:{credential_id}".encode()


class LocalKeyUnwrapper:
    """Development/test only (A256GCM key wrap). Production configuration refuses it."""

    def __init__(self, kek_base64: str) -> None:
        kek = base64.b64decode(kek_base64, validate=True)
        if len(kek) != 32:
            raise ValueError("LOCAL_KEK must be 32 bytes")
        self._aead = AESGCM(kek)

    def unwrap(self, sealed: SealedCredential) -> bytes:
        if sealed.wrap_algorithm != "A256GCM-KW" or sealed.kek_id != "local":
            raise CredentialDecryptionError("credential was not wrapped with the local key")
        blob = sealed.wrapped_dek
        if len(blob) != 12 + 32 + 16:
            raise CredentialDecryptionError("malformed wrapped key")
        try:
            return self._aead.decrypt(blob[:12], blob[12:], LOCAL_KEK_AAD)
        except InvalidTag as exc:
            raise CredentialDecryptionError("key unwrap failed") from exc


def open_sealed(sealed: SealedCredential, unwrapper: KeyUnwrapper) -> str:
    """Returns the plaintext secret. Callers must not log, persist or return it."""
    if sealed.envelope_version != ENVELOPE_VERSION:
        raise CredentialDecryptionError("unsupported envelope version")
    dek = bytearray(unwrapper.unwrap(sealed))
    try:
        plaintext = AESGCM(bytes(dek)).decrypt(
            sealed.iv, sealed.ciphertext + sealed.auth_tag, credential_aad(sealed.kind, sealed.credential_id)
        )
    except InvalidTag as exc:
        raise CredentialDecryptionError("credential integrity check failed") from exc
    finally:
        for i in range(len(dek)):
            dek[i] = 0
    return plaintext.decode("utf-8")
