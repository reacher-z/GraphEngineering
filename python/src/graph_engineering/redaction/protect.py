"""Protected payload contract: identity, associated data, blob, and store.

Section 5 freezes the closed reference, the authenticated blob, the semantic
value MAC, and the occurrence-specific associated data.  Every hash and MAC here
is recomputed from canonical Tagged Durable JSON; nothing is copied from another
runtime.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import re
import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Final, Literal, Protocol, TypeAlias, runtime_checkable

from ..canonical import canonical_bytes
from ..durable_json import encode_durable_json
from ..models import JsonValue
from .errors import RedactionFailure, failure
from .keys import KeyProvider, Protector, ReferenceProtector
from .limits import (
    MAX_AAD_FIELD_PATH_UTF8_BYTES,
    MAX_PROTECTED_VALUE_UTF8_BYTES,
    MAX_REF_UTF8_BYTES,
)

PROTECTED_VALUE_API_VERSION: Final = (
    "graphengineering.reacher-z.github.io/protected-value/v1alpha1"
)
PROTECTED_BLOB_API_VERSION: Final = (
    "graphengineering.reacher-z.github.io/protected-blob/v1alpha1"
)
PROTECTED_AAD_API_VERSION: Final = "graphengineering.reacher-z.github.io/protected-aad/v1alpha1"
PROTECTED_STORE_ENVELOPE_API_VERSION: Final = (
    "graphengineering.reacher-z.github.io/protected-store-envelope/v1alpha1"
)
PROTECTED_STORE_CONTRACT: Final = "protected-payload-store/v1alpha1"
CONTRACT_VERSION_V1ALPHA2: Final = "scheduler-recovery/v1alpha2"
DURABLE_JSON_CODEC: Final = "durable-json/v1alpha1"

_REF_PATTERN = re.compile(r"^pv_[A-Za-z0-9][A-Za-z0-9._-]{0,124}$")
_BASE64URL_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")
_UNSAFE_REFS: Final[frozenset[str]] = frozenset({"pv_.", "pv_.."})

RecordKind: TypeAlias = Literal["event", "checkpoint"]


def canonical_tagged(value: object) -> bytes:
    """``canonical UTF-8 JSON(TaggedDurableJSON(value))``."""

    return canonical_bytes(encode_durable_json(value))


def _sha256_tagged(value: object) -> str:
    return hashlib.sha256(canonical_tagged(value)).hexdigest()


def _hmac_tagged(identity_key: bytes, value: object) -> str:
    return hmac.new(identity_key, canonical_tagged(value), hashlib.sha256).hexdigest()


def key_ref_hash(key_ref: str) -> str:
    """Identify the configured key reference without persisting it."""

    return _sha256_tagged(["key-ref/v1alpha1", key_ref])


def tenant_scope_hash(identity_key: bytes, tenant_scope_id: str) -> str:
    return _hmac_tagged(identity_key, ["tenant-scope/v1alpha1", tenant_scope_id])


def authority_binding_hash(
    identity_key: bytes,
    *,
    authority_provider_id: str,
    authority_subject_id: str,
    tenant_scope: str,
    run_id: str,
    capture_policy_hash: str,
    key_reference_hash: str,
) -> str:
    """The Section 5.5 closed, ordered authority binding."""

    return _hmac_tagged(
        identity_key,
        [
            "protected-authority/v1alpha1",
            authority_provider_id,
            authority_subject_id,
            tenant_scope,
            run_id,
            capture_policy_hash,
            key_reference_hash,
        ],
    )


def graph_input_context(run_id: str, graph_revision: int) -> dict[str, JsonValue]:
    return {"kind": "graph-input", "runId": run_id, "graphRevision": graph_revision}


def node_input_context(run_id: str, graph_revision: int, node_id: str) -> dict[str, JsonValue]:
    return {
        "kind": "node-input",
        "runId": run_id,
        "graphRevision": graph_revision,
        "nodeId": node_id,
    }


def node_output_context(run_id: str, graph_revision: int, node_id: str) -> dict[str, JsonValue]:
    return {
        "kind": "node-output",
        "runId": run_id,
        "graphRevision": graph_revision,
        "nodeId": node_id,
    }


def node_result_context(run_id: str, graph_revision: int, node_id: str) -> dict[str, JsonValue]:
    return {
        "kind": "node-result",
        "runId": run_id,
        "graphRevision": graph_revision,
        "nodeId": node_id,
    }


def run_result_context(run_id: str, graph_revision: int) -> dict[str, JsonValue]:
    return {"kind": "run-result", "runId": run_id, "graphRevision": graph_revision}


def diagnostic_evidence_context(
    run_id: str,
    graph_revision: int,
    node_id: str,
    attempt: int,
    code: str,
) -> dict[str, JsonValue]:
    return {
        "kind": "diagnostic-evidence",
        "runId": run_id,
        "graphRevision": graph_revision,
        "nodeId": node_id,
        "attempt": attempt,
        "code": code,
    }


def value_mac(
    identity_key: bytes,
    semantic_context: Mapping[str, JsonValue],
    logical_value: object,
) -> str:
    """The Section 5.4 logical identity used in recovery comparisons."""

    return _hmac_tagged(
        identity_key,
        ["value-mac/v1alpha1", dict(semantic_context), logical_value],
    )


def activity_key(
    identity_key: bytes,
    *,
    run_id: str,
    graph_revision: int,
    node_id: str,
    input_mac: str,
) -> str:
    """The Section 8.2 idempotency key. Attempt is deliberately excluded."""

    return _hmac_tagged(
        identity_key,
        ["activity/v1alpha2", run_id, graph_revision, node_id, input_mac],
    )


@dataclass(frozen=True, slots=True)
class ProtectedAad:
    """One occurrence-specific associated-data object."""

    run_id: str
    graph_revision: int
    record_kind: RecordKind
    record_type: str
    sequence: int
    field_path: str
    capture_policy_hash: str
    key_ref_hash: str
    authority_binding_hash: str
    tenant_scope_hash: str
    value_mac: str
    event_id: str | None = None
    checkpoint_id: str | None = None
    node_id: str | None = None
    edge_id: str | None = None
    attempt: int | None = None

    def as_document(self) -> dict[str, JsonValue]:
        document: dict[str, JsonValue] = {
            "apiVersion": PROTECTED_AAD_API_VERSION,
            "contractVersion": CONTRACT_VERSION_V1ALPHA2,
            "runId": self.run_id,
            "graphRevision": self.graph_revision,
            "recordKind": self.record_kind,
            "recordType": self.record_type,
        }
        if self.event_id is not None:
            document["eventId"] = self.event_id
        if self.checkpoint_id is not None:
            document["checkpointId"] = self.checkpoint_id
        document["sequence"] = self.sequence
        if self.node_id is not None:
            document["nodeId"] = self.node_id
        if self.edge_id is not None:
            document["edgeId"] = self.edge_id
        if self.attempt is not None:
            document["attempt"] = self.attempt
        document["fieldPath"] = self.field_path
        document["capturePolicyHash"] = self.capture_policy_hash
        document["keyRefHash"] = self.key_ref_hash
        document["authorityBindingHash"] = self.authority_binding_hash
        document["tenantScopeHash"] = self.tenant_scope_hash
        document["codec"] = DURABLE_JSON_CODEC
        document["valueMac"] = self.value_mac
        return document

    def validate(self) -> RedactionFailure | None:
        """Section 5.5 record-kind relations, checked before any protection."""

        if self.record_kind == "event":
            if self.event_id is None or self.checkpoint_id is not None:
                return failure(
                    "PAYLOAD_PROTECTION_FAILED", "protect", recordKind=self.record_kind
                )
        elif self.record_kind == "checkpoint":
            if self.checkpoint_id is None or self.event_id is not None:
                return failure(
                    "PAYLOAD_PROTECTION_FAILED", "protect", recordKind=self.record_kind
                )
        else:
            return failure("PAYLOAD_PROTECTION_FAILED", "protect")
        if len(self.field_path.encode("utf-8")) > MAX_AAD_FIELD_PATH_UTF8_BYTES:
            return failure("PAYLOAD_PROTECTION_FAILED", "protect", field="fieldPath")
        return None

    def bytes(self) -> bytes:
        return canonical_tagged(self.as_document())

    def digest(self) -> str:
        return hashlib.sha256(self.bytes()).hexdigest()


@dataclass(frozen=True, slots=True)
class ProtectedValueRef:
    """The Section 5.1 closed journal/checkpoint representation."""

    ref: str
    ciphertext_hash: str
    value_mac: str
    key_ref_hash: str
    aad_hash: str

    def as_document(self) -> dict[str, JsonValue]:
        return {
            "apiVersion": PROTECTED_VALUE_API_VERSION,
            "ref": self.ref,
            "codec": DURABLE_JSON_CODEC,
            "ciphertextHash": self.ciphertext_hash,
            "valueMac": self.value_mac,
            "keyRefHash": self.key_ref_hash,
            "aadHash": self.aad_hash,
        }


def validate_reference_document(document: object) -> RedactionFailure | None:
    """Validate a closed reference, including the unsafe-reference rules."""

    if not isinstance(document, Mapping):
        return failure("PROTECTED_PAYLOAD_CORRUPT", "protect")
    expected = {
        "apiVersion",
        "ref",
        "codec",
        "ciphertextHash",
        "valueMac",
        "keyRefHash",
        "aadHash",
    }
    if set(document.keys()) != expected:
        return failure("PROTECTED_PAYLOAD_CORRUPT", "protect")
    if document["apiVersion"] != PROTECTED_VALUE_API_VERSION:
        return failure("PROTECTED_PAYLOAD_CORRUPT", "protect")
    if document["codec"] != DURABLE_JSON_CODEC:
        return failure("PROTECTED_PAYLOAD_CORRUPT", "protect")
    reference = document["ref"]
    if (
        type(reference) is not str
        or _REF_PATTERN.fullmatch(reference) is None
        or reference in _UNSAFE_REFS
        or len(reference.encode("utf-8")) > MAX_REF_UTF8_BYTES
    ):
        # A reference is not a capability URL and must not contain a filename,
        # host path, tenant name, key identifier, or application-derived text.
        return failure("PROTECTED_PAYLOAD_UNAUTHORIZED", "protect")
    for field_name in ("ciphertextHash", "valueMac", "keyRefHash", "aadHash"):
        value = document[field_name]
        if type(value) is not str or re.fullmatch(r"[0-9a-f]{64}", value) is None:
            return failure("PROTECTED_PAYLOAD_CORRUPT", "protect", field=field_name)
    return None


def base64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def base64url_decode(text: str) -> bytes:
    """Strict canonical unpadded base64url decoding.

    Section 5.2: padding, non-alphabet characters, a length congruent to one
    modulo four, non-zero unused pad bits, and any spelling whose
    decode-then-re-encode differs from the input are all rejected.
    """

    if type(text) is not str or not text:
        raise ValueError("expected canonical unpadded base64url")
    if _BASE64URL_PATTERN.fullmatch(text) is None:
        raise ValueError("expected canonical unpadded base64url")
    if len(text) % 4 == 1:
        raise ValueError("expected canonical unpadded base64url")
    padded = text + "=" * (-len(text) % 4)
    raw = base64.urlsafe_b64decode(padded.encode("ascii"))
    if base64url_encode(raw) != text:
        raise ValueError("expected canonical unpadded base64url")
    return raw


@dataclass(frozen=True, slots=True)
class ProtectedBlob:
    """The Section 5.2 authenticated encrypted blob."""

    nonce: bytes
    ciphertext: bytes
    tag: bytes

    def as_document(self) -> dict[str, JsonValue]:
        return {
            "apiVersion": PROTECTED_BLOB_API_VERSION,
            "algorithm": "A256GCM",
            "nonce": base64url_encode(self.nonce),
            "ciphertext": base64url_encode(self.ciphertext),
            "tag": base64url_encode(self.tag),
        }

    def stored_bytes(self) -> bytes:
        """The exact stored blob bytes that ``ciphertextHash`` covers."""

        return canonical_bytes(self.as_document())

    def ciphertext_hash(self) -> str:
        return hashlib.sha256(self.stored_bytes()).hexdigest()


def decode_blob_document(document: object) -> ProtectedBlob | RedactionFailure:
    """Semantic blob decoding; schema length checks alone are not sufficient."""

    if not isinstance(document, Mapping):
        return failure("PROTECTED_PAYLOAD_CORRUPT", "protect")
    if set(document.keys()) != {"apiVersion", "algorithm", "nonce", "ciphertext", "tag"}:
        return failure("PROTECTED_PAYLOAD_CORRUPT", "protect")
    if document["apiVersion"] != PROTECTED_BLOB_API_VERSION or document["algorithm"] != "A256GCM":
        return failure("PROTECTED_PAYLOAD_CORRUPT", "protect")
    try:
        nonce = base64url_decode(str(document["nonce"]))
        ciphertext = base64url_decode(str(document["ciphertext"]))
        tag = base64url_decode(str(document["tag"]))
    except ValueError:
        return failure("PROTECTED_PAYLOAD_CORRUPT", "protect")
    if len(nonce) != 12 or len(tag) != 16 or not ciphertext:
        return failure("PROTECTED_PAYLOAD_CORRUPT", "protect")
    if len(ciphertext) > MAX_PROTECTED_VALUE_UTF8_BYTES:
        return failure("PROTECTED_PAYLOAD_CORRUPT", "protect")
    return ProtectedBlob(nonce=nonce, ciphertext=ciphertext, tag=tag)


@runtime_checkable
class ProtectedPayloadStore(Protocol):
    """Section 5.6 narrow store. It never accepts a logical plaintext value."""

    def put(self, reference: ProtectedValueRef, blob_bytes: bytes) -> None: ...

    def get(self, reference: ProtectedValueRef) -> bytes | None: ...

    def delete(self, reference: ProtectedValueRef) -> None: ...


class MemoryProtectedPayloadStore:
    """A process-local store used by tests and in-memory runs."""

    def __init__(self) -> None:
        self._blobs: dict[str, bytes] = {}

    def put(self, reference: ProtectedValueRef, blob_bytes: bytes) -> None:
        if hashlib.sha256(blob_bytes).hexdigest() != reference.ciphertext_hash:
            raise ValueError("protected blob does not match its ciphertext hash")
        self._blobs[reference.ref] = bytes(blob_bytes)

    def get(self, reference: ProtectedValueRef) -> bytes | None:
        stored = self._blobs.get(reference.ref)
        if stored is None:
            return None
        if hashlib.sha256(stored).hexdigest() != reference.ciphertext_hash:
            return None
        return stored

    def delete(self, reference: ProtectedValueRef) -> None:
        self._blobs.pop(reference.ref, None)


class FileProtectedPayloadStore:
    """Atomic local blob publication. It leaves no plaintext temporary file."""

    def __init__(self, root: str | os.PathLike[str]) -> None:
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, reference: ProtectedValueRef) -> Path:
        if _REF_PATTERN.fullmatch(reference.ref) is None or reference.ref in _UNSAFE_REFS:
            raise ValueError("unsafe protected reference")
        return self.root / f"{reference.ref}.blob"

    def put(self, reference: ProtectedValueRef, blob_bytes: bytes) -> None:
        if hashlib.sha256(blob_bytes).hexdigest() != reference.ciphertext_hash:
            raise ValueError("protected blob does not match its ciphertext hash")
        path = self._path(reference)
        temporary = path.with_suffix(".blob.partial")
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(blob_bytes)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)

    def get(self, reference: ProtectedValueRef) -> bytes | None:
        path = self._path(reference)
        if not path.exists():
            return None
        stored = path.read_bytes()
        if hashlib.sha256(stored).hexdigest() != reference.ciphertext_hash:
            return None
        return stored

    def delete(self, reference: ProtectedValueRef) -> None:
        path = self._path(reference)
        if path.exists():
            path.unlink()


@dataclass(frozen=True, slots=True)
class ProtectionResult:
    """One complete protected occurrence."""

    reference: ProtectedValueRef
    blob: ProtectedBlob
    blob_bytes: bytes


def new_reference_id() -> str:
    """An opaque reference carrying no filename, path, tenant, or key identity."""

    return f"pv_{uuid.uuid4().hex}"


def protect_value(
    logical_value: object,
    *,
    aad: ProtectedAad,
    key_provider: KeyProvider,
    protector: Protector | None = None,
    reference_id: str | None = None,
) -> ProtectionResult | RedactionFailure:
    """Run Section 8.1 steps 2 through 5 for one authoritative value.

    The caller has already computed the value MAC carried by ``aad`` and is
    responsible for step 1's detached snapshot.
    """

    aad_failure = aad.validate()
    if aad_failure is not None:
        return aad_failure

    try:
        plaintext = canonical_tagged(logical_value)
    except (TypeError, ValueError):
        return failure("PAYLOAD_PROTECTION_FAILED", "encode")
    if len(plaintext) > MAX_PROTECTED_VALUE_UTF8_BYTES:
        return failure("PAYLOAD_PROTECTION_FAILED", "encode", limit=MAX_PROTECTED_VALUE_UTF8_BYTES)

    engine = protector if protector is not None else ReferenceProtector()
    try:
        key = key_provider.protection_key(aad.run_id)
        nonce = key_provider.nonce(aad.run_id, aad.digest())
        ciphertext, tag = engine.seal(key, nonce, plaintext, aad.bytes())
    except Exception:
        # A raw key-provider error must never reach a sink.
        return failure("PAYLOAD_PROTECTION_FAILED", "protect", runId=aad.run_id)

    blob = ProtectedBlob(nonce=nonce, ciphertext=ciphertext, tag=tag)
    blob_bytes = blob.stored_bytes()
    reference = ProtectedValueRef(
        ref=reference_id if reference_id is not None else new_reference_id(),
        ciphertext_hash=hashlib.sha256(blob_bytes).hexdigest(),
        value_mac=aad.value_mac,
        key_ref_hash=key_ref_hash(key_provider.key_ref),
        aad_hash=aad.digest(),
    )
    invalid = validate_reference_document(reference.as_document())
    if invalid is not None:
        return invalid
    return ProtectionResult(reference=reference, blob=blob, blob_bytes=blob_bytes)


def unprotect_value(
    reference: ProtectedValueRef,
    *,
    aad: ProtectedAad,
    semantic_context: Mapping[str, JsonValue],
    store: ProtectedPayloadStore,
    key_provider: KeyProvider,
    protector: Protector | None = None,
) -> JsonValue | RedactionFailure:
    """Authorize, authenticate, decrypt, decode, and recompute before exposure."""

    from ..durable_json import DurableJsonError, decode_durable_json

    if reference.aad_hash != aad.digest():
        return failure("PROTECTED_PAYLOAD_CORRUPT", "protect", runId=aad.run_id)
    if reference.value_mac != aad.value_mac:
        return failure("PROTECTED_PAYLOAD_CORRUPT", "protect", runId=aad.run_id)
    stored = store.get(reference)
    if stored is None:
        return failure("PROTECTED_PAYLOAD_NOT_FOUND", "protect", runId=aad.run_id)
    if hashlib.sha256(stored).hexdigest() != reference.ciphertext_hash:
        return failure("PROTECTED_PAYLOAD_CORRUPT", "protect", runId=aad.run_id)

    import json as _json

    try:
        document = _json.loads(stored.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        return failure("PROTECTED_PAYLOAD_CORRUPT", "protect", runId=aad.run_id)
    blob = decode_blob_document(document)
    if isinstance(blob, RedactionFailure):
        return blob

    engine = protector if protector is not None else ReferenceProtector()
    try:
        plaintext = engine.open(
            key_provider.protection_key(aad.run_id),
            blob.nonce,
            blob.ciphertext,
            blob.tag,
            aad.bytes(),
        )
    except Exception:
        return failure("PROTECTED_PAYLOAD_CORRUPT", "protect", runId=aad.run_id)

    try:
        tagged = _json.loads(plaintext.decode("utf-8"))
        value = decode_durable_json(tagged)
    except (UnicodeDecodeError, ValueError, DurableJsonError):
        return failure("PROTECTED_PAYLOAD_CORRUPT", "protect", runId=aad.run_id)

    recomputed = value_mac(key_provider.run_identity_key(aad.run_id), semantic_context, value)
    if not hmac.compare_digest(recomputed, reference.value_mac):
        # The logical identity or its expected semantic context did not survive;
        # no detached value is exposed to the recovery fold.
        return failure("PROTECTED_PAYLOAD_CORRUPT", "protect", runId=aad.run_id)
    return value
