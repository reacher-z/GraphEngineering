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
import hmac
import os
from typing import Final, Protocol, runtime_checkable

from .aead import aes_256_gcm_decrypt, aes_256_gcm_encrypt

_KEY_BYTES: Final = 32
_NONCE_BYTES: Final = 12


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

    def nonce(self) -> bytes:
        """A fresh 12-byte AEAD nonce, unique for a protection key."""


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


class DeterministicTestKeyProvider:
    """A clearly named test provider producing fixed conformance vectors.

    Section 5.2 permits deterministic nonces and keys only here.  Two independent
    keys are derived from one seed with domain separation so protection authority
    and identity authority are cryptographically independent, and the nonce
    counter is per protection key so no nonce repeats within a run.

    This class MUST NOT be used in production: its keys are reproducible from the
    seed, which is the opposite of what a key provider is for.
    """

    def __init__(
        self,
        seed: bytes = b"graph-engineering/redaction-test-seed",
        *,
        key_ref: str = "test://deterministic/key-1",
    ) -> None:
        if type(seed) is not bytes or not seed:
            raise ValueError("the deterministic test provider requires a non-empty seed")
        self._seed = seed
        self._key_ref = key_ref
        self._nonce_counter = 0

    @property
    def key_ref(self) -> str:
        return self._key_ref

    def protection_key(self, run_id: str) -> bytes:
        return self._derive(b"protection-key/v1alpha1", run_id)

    def run_identity_key(self, run_id: str) -> bytes:
        return self._derive(b"run-identity-key/v1alpha1", run_id)

    def nonce(self) -> bytes:
        self._nonce_counter += 1
        return self._nonce_counter.to_bytes(_NONCE_BYTES, "big")

    def _derive(self, domain: bytes, run_id: str) -> bytes:
        return hmac.new(
            self._seed, domain + b"\x00" + run_id.encode("utf-8"), hashlib.sha256
        ).digest()[:_KEY_BYTES]


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

    def nonce(self) -> bytes:
        return os.urandom(_NONCE_BYTES)
