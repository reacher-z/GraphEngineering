"""Key and protector boundaries.

Section 5.3 makes the operator own the ``KeyProvider``: it supplies protection
authority, a 32-byte run identity key for HMAC-SHA-256, and a stable key
reference identity.  Protection and identity keys must be cryptographically
independent, and the identity key is stable for the lifetime of a run including
resume and key wrapping rotation.

Production key derivation, KMS protocol, hardware boundary, escrow, and rotation
schedule are provider responsibilities.  This module ships the two boundaries and
one clearly named deterministic test provider, exactly as Section 5.2 and
Section 12 permit for fixed conformance vectors.  Nothing here is a KMS.
"""

from __future__ import annotations

import hashlib
import os
from typing import Final, Protocol, runtime_checkable

from ..canonical import canonical_bytes
from ..durable_json import encode_durable_json
from .aead import aes_256_gcm_decrypt, aes_256_gcm_encrypt

_KEY_BYTES: Final = 32
_NONCE_BYTES: Final = 12

#: The one key reference the shared deterministic test provider uses in both
#: languages.  It is an input to every derivation below, so two lanes that
#: configure a different reference derive different keys instead of silently
#: agreeing.
DETERMINISTIC_TEST_KEY_REF: Final = "test-key-provider/deterministic/v1alpha1"

_PROTECTION_KEY_DOMAIN: Final = "test-protection-key/v1alpha1"
_IDENTITY_KEY_DOMAIN: Final = "test-identity-key/v1alpha1"
_NONCE_DOMAIN: Final = "test-nonce/v1alpha1"


@runtime_checkable
class KeyProvider(Protocol):
    """Operator-owned key authority for one run."""

    @property
    def key_ref(self) -> str:
        """The stable, opaque key-reference identity. Never persisted raw."""

    def protection_key(self, run_id: str) -> bytes:
        """32 bytes of protection authority for the protected blob."""

    def run_identity_key(self, run_id: str) -> bytes:
        """32 bytes of HMAC-SHA-256 identity key, stable across resume."""

    def nonce(self, run_id: str, aad_hash: str) -> bytes:
        """A 12-byte AEAD nonce that MUST be unique for a protection key.

        The occurrence is named explicitly rather than left implicit in provider
        state: Section 5.5 makes the associated data occurrence-specific, so a
        provider that wants a reproducible nonce can derive it from
        ``(run_id, aad_hash)`` and a provider that wants a random one may ignore
        both arguments.  A provider MUST NOT depend on call order.
        """


@runtime_checkable
class Protector(Protocol):
    """The AEAD boundary. A deployment may replace it with a vetted module."""

    def seal(self, key: bytes, nonce: bytes, plaintext: bytes, aad: bytes) -> tuple[bytes, bytes]:
        """Return ``(ciphertext, tag)``."""

    def open(self, key: bytes, nonce: bytes, ciphertext: bytes, tag: bytes, aad: bytes) -> bytes:
        """Authenticate and decrypt, or raise."""


class ReferenceProtector:
    """The shipped ``A256GCM`` protector built on :mod:`.aead`."""

    def seal(self, key: bytes, nonce: bytes, plaintext: bytes, aad: bytes) -> tuple[bytes, bytes]:
        return aes_256_gcm_encrypt(key, nonce, plaintext, aad)

    def open(self, key: bytes, nonce: bytes, ciphertext: bytes, tag: bytes, aad: bytes) -> bytes:
        return aes_256_gcm_decrypt(key, nonce, ciphertext, tag, aad)


def _derive(domain: str, key_ref: str, run_id: str, size: int) -> bytes:
    """``SHA-256(canonicalTagged([domain, keyRef, runId]))`` truncated to ``size``.

    This is the one derivation both language lanes implement.  ``canonicalTagged``
    is the shared Tagged Durable JSON encoding, so the tag is unambiguous, the key
    reference is an input rather than decoration, and the domain string separates
    protection authority from identity authority.
    """

    digest = hashlib.sha256(canonical_bytes(encode_durable_json([domain, key_ref, run_id])))
    return digest.digest()[:size]


class DeterministicTestKeyProvider:
    """A clearly named test provider producing fixed conformance vectors.

    Section 5.2 permits deterministic nonces and keys only here.  It exists so
    shared conformance can compare exact ciphertext vectors across the TypeScript
    and Python lanes, which requires that both lanes derive byte-identical
    material from byte-identical inputs.  The derivation, the domain strings, the
    default key reference, and the nonce rule are therefore fixed here and
    mirrored exactly by ``DeterministicTestKeyProvider`` in
    ``packages/persistence/src/redaction/key-provider.ts``:

    * ``protection_key(runId)``
      ``= SHA-256(canonicalTagged(["test-protection-key/v1alpha1", keyRef, runId]))``
    * ``run_identity_key(runId)``
      ``= SHA-256(canonicalTagged(["test-identity-key/v1alpha1", keyRef, runId]))``
    * ``nonce(runId, aadHash)``
      ``= SHA-256(canonicalTagged(["test-nonce/v1alpha1/" + aadHash, keyRef, runId]))[:12]``

    The nonce is a pure function of the occurrence-specific associated data
    (Section 5.5), so a distinct occurrence yields a distinct nonce under one
    protection key and the same occurrence yields the same ciphertext in either
    language, in either process, in any call order.  A counter cannot do that.

    This class MUST NOT be used in production: its keys are a pure function of
    ``(key_ref, run_id)``, which is the opposite of what a key provider is for.
    """

    def __init__(self, *, key_ref: str = DETERMINISTIC_TEST_KEY_REF) -> None:
        if type(key_ref) is not str or not key_ref:
            raise ValueError("the deterministic test provider requires a non-empty key reference")
        self._key_ref = key_ref

    @property
    def key_ref(self) -> str:
        return self._key_ref

    def protection_key(self, run_id: str) -> bytes:
        return _derive(_PROTECTION_KEY_DOMAIN, self._key_ref, run_id, _KEY_BYTES)

    def run_identity_key(self, run_id: str) -> bytes:
        return _derive(_IDENTITY_KEY_DOMAIN, self._key_ref, run_id, _KEY_BYTES)

    def nonce(self, run_id: str, aad_hash: str) -> bytes:
        return _derive(f"{_NONCE_DOMAIN}/{aad_hash}", self._key_ref, run_id, _NONCE_BYTES)


class EphemeralKeyProvider:
    """A process-local provider with random keys and a CSPRNG nonce source.

    It is still not a KMS: the keys live only in this process and are lost on
    exit, so a run protected with it cannot be recovered later.  It exists so a
    caller that needs non-deterministic behaviour in a test does not reach for
    the deterministic provider.
    """

    def __init__(self, *, key_ref: str = "memory://ephemeral/key-1") -> None:
        self._key_ref = key_ref
        self._protection = os.urandom(_KEY_BYTES)
        self._identity = os.urandom(_KEY_BYTES)

    @property
    def key_ref(self) -> str:
        return self._key_ref

    def protection_key(self, run_id: str) -> bytes:
        return self._protection

    def run_identity_key(self, run_id: str) -> bytes:
        return self._identity

    def nonce(self, run_id: str, aad_hash: str) -> bytes:
        return os.urandom(_NONCE_BYTES)
