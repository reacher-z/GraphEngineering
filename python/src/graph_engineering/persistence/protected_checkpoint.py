"""The guarded ``checkpoints/v1alpha2`` durable write path.

``checkpoints/v1alpha1`` cannot express a truthful protected disposition: its
``state`` is an open object and :class:`FileCheckpointStore` persists it
verbatim, so plaintext application values reach the temporary and final
checkpoint files.  New protected checkpoint writes therefore use the closed
``checkpoints/v1alpha2`` scheduler projection, in which every application value
is a checkpoint-bound protected occurrence (redaction-semantics.md Section 6.2)
and arbitrary inline state is unrepresentable.

Everything in this module goes through the shared
:class:`~graph_engineering.redaction.guard.SinkGuard`.
:class:`GuardedFileCheckpointStore` accepts only a
:class:`~graph_engineering.redaction.guard.PreparedSinkWrite`, and it consumes
the capability *before* the temporary file is opened, so no byte the guard did
not authorize ever exists in a temporary or final file (Section 5.6).

``contentHash`` is Section 6.2's "SHA-256 of canonical UTF-8 JSON for the
entire closed checkpoint object with only ``contentHash`` omitted".  Only the
guard can compute it — the hash covers the protected references the guard
itself places — so the request names ``content_hash_field`` and the guard
performs the finalization, exactly like ``payload_hash_field`` on the event
path.  This module is the byte-for-byte mirror of
``packages/persistence/src/redaction/protected-checkpoint-writer.ts`` and
``protected-checkpoint-store.ts``.
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import json
import os
import re
import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Final, Literal

from ..canonical import canonical_bytes
from ..models import JsonValue
from ..redaction.errors import RedactionFailure, failure
from ..redaction.guard import (
    GuardFailed,
    GuardOutcome,
    GuardPayloadField,
    GuardPrepared,
    GuardSuppressed,
    OccurrenceContext,
    PreparedSinkWrite,
    SinkGuard,
    SinkWriteRequest,
)
from ..redaction.keys import KeyProvider, Protector
from ..redaction.policy import CapturePolicy
from ..redaction.protect import (
    PROTECTED_STORE_CONTRACT,
    ProtectedAad,
    ProtectedPayloadStore,
    ProtectedValueRef,
    authority_binding_hash,
    graph_input_context,
    key_ref_hash,
    node_input_context,
    node_output_context,
    node_result_context,
    tenant_scope_hash,
    unprotect_value,
    validate_reference_document,
)
from ..redaction.scan import CanaryRegistry
from ..redaction.wire import validate_checkpoint_shape
from .errors import (
    CheckpointProtectionRequiredError,
    CorruptCheckpointError,
    PersistenceIOError,
    PersistenceValidationError,
    ValidationIssue,
)
from .identifiers import assert_safe_identifier, identifier_hash
from .locks import process_lock

CHECKPOINT_V1ALPHA2_API_VERSION: Final = (
    "graphengineering.reacher-z.github.io/checkpoints/v1alpha2"
)
CHECKPOINT_PROJECTION_TYPE: Final = "scheduler-projection/v1alpha2"
CHECKPOINT_SINK: Final = "checkpoint-final"
CHECKPOINT_SOURCE_CLASS: Final = "checkpoint-state"

_ARRAY_INDEX: Final = re.compile(r"^(?:0|[1-9][0-9]*)$")

NodeStatus = Literal["pending", "running", "retry-wait", "succeeded", "failed", "skipped"]

_NO_VALUE: Final = object()


def _pointer(*tokens: str) -> str:
    return "".join(
        "/" + token.replace("~", "~0").replace("/", "~1") for token in tokens
    )


@dataclass(frozen=True, slots=True)
class CheckpointNodeSpec:
    """One node projection, carrying the raw logical values to protect.

    The values never enter the candidate record; the guard places
    checkpoint-bound references at ``/nodes/<index>/inputRef`` and friends.
    Which value members are meaningful is a function of ``status``, mirroring
    the closed variants of ``spec/checkpoint-v1alpha2.schema.json``.
    """

    node_id: str
    status: NodeStatus
    attempts: int = 0
    input: object = _NO_VALUE
    output: object = _NO_VALUE
    result: object = _NO_VALUE
    activity_key: str | None = None
    open_attempt: int | None = None
    next_attempt: int | None = None
    available_at: str | None = None
    failure_code: str | None = None


@dataclass(frozen=True, slots=True)
class ProtectedCheckpointSpec:
    """One candidate ``checkpoints/v1alpha2`` projection."""

    decision_id: str
    run_id: str
    checkpoint_id: str
    sequence: int
    created_at: str
    graph_revision: int
    graph_hash: str
    implementation_hash: str
    key_ref_hash: str
    history_prefix_hash: str
    total_attempts: int
    graph_input: object
    nodes: tuple[CheckpointNodeSpec, ...] = ()


def _node_payloads(
    run_id: str,
    graph_revision: int,
    index: int,
    node: CheckpointNodeSpec,
) -> list[GuardPayloadField]:
    fields: list[GuardPayloadField] = []
    position = str(index)
    if node.status in ("running", "retry-wait", "succeeded"):
        fields.append(
            GuardPayloadField(
                field_path=_pointer("nodes", position, "inputRef"),
                mac_field_path=_pointer("nodes", position, "inputMac"),
                semantic_context=node_input_context(run_id, graph_revision, node.node_id),
                value=node.input,
            )
        )
    if node.status == "succeeded":
        fields.append(
            GuardPayloadField(
                field_path=_pointer("nodes", position, "outputRef"),
                mac_field_path=_pointer("nodes", position, "outputMac"),
                semantic_context=node_output_context(run_id, graph_revision, node.node_id),
                value=node.output,
            )
        )
    if node.status in ("failed", "skipped"):
        fields.append(
            GuardPayloadField(
                field_path=_pointer("nodes", position, "resultRef"),
                mac_field_path=_pointer("nodes", position, "resultMac"),
                semantic_context=node_result_context(run_id, graph_revision, node.node_id),
                value=node.result,
            )
        )
    return fields


def _node_skeleton(node: CheckpointNodeSpec) -> dict[str, JsonValue]:
    if node.status == "pending":
        return {"nodeId": node.node_id, "status": node.status, "attempts": 0}
    if node.status == "running":
        return {
            "nodeId": node.node_id,
            "status": node.status,
            "attempts": node.attempts,
            "activityKey": node.activity_key,
            "openAttempt": node.open_attempt,
        }
    if node.status == "retry-wait":
        return {
            "nodeId": node.node_id,
            "status": node.status,
            "attempts": node.attempts,
            "activityKey": node.activity_key,
            "nextAttempt": node.next_attempt,
            "availableAt": node.available_at,
        }
    if node.status == "succeeded":
        return {
            "nodeId": node.node_id,
            "status": node.status,
            "attempts": node.attempts,
            "activityKey": node.activity_key,
        }
    return {
        "nodeId": node.node_id,
        "status": node.status,
        "attempts": node.attempts,
        "failureCode": node.failure_code,
    }


def prepare_protected_checkpoint(
    guard: SinkGuard,
    sink_instance: object,
    spec: ProtectedCheckpointSpec,
) -> GuardOutcome:
    """Build the guard request for one projection and evaluate it.

    Returns ``suppressed``, a structured failure, or one
    :class:`PreparedSinkWrite` bound to ``sink_instance`` — never ``None`` and
    never a partly built record.  This is the Python mirror of the TypeScript
    ``prepareProtectedCheckpoint``.
    """

    payloads: list[GuardPayloadField] = [
        GuardPayloadField(
            field_path=_pointer("graphInputRef"),
            mac_field_path=_pointer("graphInputMac"),
            semantic_context=graph_input_context(spec.run_id, spec.graph_revision),
            value=spec.graph_input,
        )
    ]
    for index, node in enumerate(spec.nodes):
        payloads.extend(_node_payloads(spec.run_id, spec.graph_revision, index, node))

    metadata: dict[str, JsonValue] = {
        "apiVersion": CHECKPOINT_V1ALPHA2_API_VERSION,
        "projectionType": CHECKPOINT_PROJECTION_TYPE,
        "runId": spec.run_id,
        "checkpointId": spec.checkpoint_id,
        "sequence": spec.sequence,
        "createdAt": spec.created_at,
        "graphRevision": spec.graph_revision,
        "graphHash": spec.graph_hash,
        "implementationHash": spec.implementation_hash,
        "capturePolicyHash": guard.policy_hash,
        "protectedStoreContract": PROTECTED_STORE_CONTRACT,
        "keyRefHash": spec.key_ref_hash,
        "historyPrefixHash": spec.history_prefix_hash,
        "totalAttempts": spec.total_attempts,
        "protectedRefCount": len(payloads),
        "redacted": False,
        "payloadDisposition": "protected-ref",
        "nodes": [_node_skeleton(node) for node in spec.nodes],
    }

    request = SinkWriteRequest(
        source_class=CHECKPOINT_SOURCE_CLASS,
        sink=CHECKPOINT_SINK,
        sink_instance=sink_instance,
        authority_class="authoritative",
        occurrence=OccurrenceContext(
            run_id=spec.run_id,
            graph_revision=spec.graph_revision,
            record_kind="checkpoint",
            record_type=CHECKPOINT_PROJECTION_TYPE,
            occurrence_id=spec.checkpoint_id,
            sequence=spec.sequence,
            field_path=_pointer("graphInputRef"),
            occurred_at=spec.created_at,
        ),
        metadata=metadata,
        payloads=tuple(payloads),
        content_hash_field="/contentHash",
        decision_id=spec.decision_id,
        policy_control="checkpointValues",
    )
    return guard.prepare(request)


def _validate_projection(document: object) -> RedactionFailure | None:
    invalid = validate_checkpoint_shape(document)
    if invalid is not None:
        return invalid
    assert isinstance(document, Mapping)
    body = {key: value for key, value in document.items() if key != "contentHash"}
    # Section 6.2: contentHash is SHA-256 of canonical UTF-8 JSON of the entire
    # closed checkpoint object with only contentHash omitted.
    if hashlib.sha256(canonical_bytes(body)).hexdigest() != document["contentHash"]:
        return failure("REDACTION_POLICY_INVALID", "sink-write", field="contentHash")
    return None


class GuardedFileCheckpointStore:
    """A durable checkpoint sink whose only write method takes a prepared write.

    Section 7: the default runtime dependency graph exposes only sinks whose
    public write method accepts a ``PreparedSinkWrite``; raw byte, file, and
    store primitives are private implementation details and receive only the
    already prepared bytes.  The on-disk layout and atomic-rename discipline
    mirror :class:`FileCheckpointStore`:
    ``<root>/checkpoints-v1alpha2/<runIdHash>/<checkpointIdHash>.checkpoint.json``,
    written to an exclusive ``0o600`` temporary in the same directory, fsynced,
    renamed into place, then the directory is fsynced.
    """

    sink: Final = CHECKPOINT_SINK

    def __init__(self, root: str | os.PathLike[str]) -> None:
        self.root = Path(root).resolve()
        self.checkpoints_directory = self.root / "checkpoints-v1alpha2"
        try:
            self.checkpoints_directory.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            raise PersistenceIOError(
                "create protected checkpoint directory",
                str(self.checkpoints_directory),
                exc,
            ) from exc

    def _run_directory(self, run_id: str) -> Path:
        assert_safe_identifier(run_id, "runId")
        return self.checkpoints_directory / identifier_hash(run_id)

    def path_for_checkpoint(self, run_id: str, checkpoint_id: str) -> Path:
        assert_safe_identifier(checkpoint_id, "checkpointId")
        return self._run_directory(run_id) / (
            f"{identifier_hash(checkpoint_id)}.checkpoint.json"
        )

    async def save(self, prepared: PreparedSinkWrite) -> dict[str, JsonValue]:
        """Persist one guarded projection.

        The only accepted argument is a ``PreparedSinkWrite`` this store
        instance is bound to; there is no raw checkpoint save.  The capability
        is consumed before the temporary file is opened, so a temporary file
        only ever contains guard-authorized bytes.
        """

        if type(prepared) is not PreparedSinkWrite:
            # A serialized guard decision, store envelope, protected reference,
            # or forged structural object is not a capability.
            raise CheckpointProtectionRequiredError(
                "save-accepts-only-a-prepared-sink-write"
            )
        if prepared.sink != self.sink:
            raise CheckpointProtectionRequiredError(
                "prepared-write-is-bound-to-another-sink"
            )
        payload = prepared.consume(self)

        try:
            document = json.loads(payload)
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise PersistenceValidationError(
                "prepared checkpoint bytes are not JSON",
                (ValidationIssue("#/record", str(exc)),),
            ) from exc
        invalid = _validate_projection(document)
        if invalid is not None:
            raise PersistenceValidationError(
                "checkpoint is not a valid checkpoints/v1alpha2 projection",
                (ValidationIssue("#/record", invalid.code),),
            )
        run_id = str(document["runId"])
        checkpoint_id = str(document["checkpointId"])
        path = self.path_for_checkpoint(run_id, checkpoint_id)
        async with process_lock(f"protected-checkpoint:{path}"):
            await asyncio.to_thread(self._write_atomically, path, payload)
        result: dict[str, JsonValue] = json.loads(payload)
        return result

    def _write_atomically(self, path: Path, payload: bytes) -> None:
        directory = path.parent
        temporary = directory / f".{path.stem}.{os.getpid()}.{uuid.uuid4().hex}.tmp"
        try:
            directory.mkdir(parents=True, exist_ok=True, mode=0o700)
            descriptor = os.open(
                temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600
            )
            with os.fdopen(descriptor, "wb") as handle:
                handle.write(payload + b"\n")
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, path)
            directory_descriptor = os.open(directory, os.O_RDONLY)
            try:
                os.fsync(directory_descriptor)
            finally:
                os.close(directory_descriptor)
        except OSError as exc:
            with_suppress_unlink(temporary)
            raise PersistenceIOError(
                "save protected checkpoint", str(path), exc
            ) from exc

    async def load(self, run_id: str, checkpoint_id: str) -> dict[str, JsonValue] | None:
        """Read back one persisted projection.

        Protected references are returned unresolved: this path holds no key
        provider and cannot materialize an application value.  Use
        :func:`resolve_protected_checkpoint_value` for authorized reads.
        """

        assert_safe_identifier(run_id, "runId")
        assert_safe_identifier(checkpoint_id, "checkpointId")
        path = self.path_for_checkpoint(run_id, checkpoint_id)
        async with process_lock(f"protected-checkpoint:{path}"):
            raw = await asyncio.to_thread(self._read_bytes, path)
        if raw is None:
            return None
        if not raw.endswith(b"\n"):
            raise CorruptCheckpointError(run_id, checkpoint_id, "truncated record")
        try:
            document = json.loads(raw)
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise CorruptCheckpointError(
                run_id, checkpoint_id, "record is not JSON"
            ) from None
        invalid = _validate_projection(document)
        if invalid is not None:
            raise CorruptCheckpointError(run_id, checkpoint_id, invalid.code)
        if document["runId"] != run_id:
            raise CorruptCheckpointError(
                run_id, checkpoint_id, "runId does not match checkpoint directory"
            )
        if document["checkpointId"] != checkpoint_id:
            raise CorruptCheckpointError(
                run_id, checkpoint_id, "checkpointId does not match file"
            )
        result: dict[str, JsonValue] = document
        return result

    @staticmethod
    def _read_bytes(path: Path) -> bytes | None:
        if not path.exists():
            return None
        try:
            return path.read_bytes()
        except OSError as exc:
            raise PersistenceIOError(
                "read protected checkpoint", str(path), exc
            ) from exc


def with_suppress_unlink(path: Path) -> None:
    with contextlib.suppress(OSError):
        path.unlink()


class ProtectedCheckpointWriter:
    """The high-level guarded checkpoint writer.

    Construction is fail-closed: a missing or malformed key provider, protected
    payload store, or capture policy raises ``CHECKPOINT_PROTECTION_REQUIRED``
    before a guard, byte, or file exists (Section 4.2).  ``save`` runs the
    shared sink-before-write guard and hands the resulting one-shot
    ``PreparedSinkWrite`` to the bound store; a guard refusal never leaves a
    partial record and never falls back to inline capture.
    """

    def __init__(
        self,
        *,
        key_provider: KeyProvider | None,
        store: ProtectedPayloadStore | None,
        policy: CapturePolicy | None,
        tenant_scope_id: str = "tenant-local",
        authority_provider_id: str = "authority-local",
        authority_subject_id: str = "subject-local",
        protector: Protector | None = None,
        canaries: CanaryRegistry | None = None,
    ) -> None:
        missing: list[str] = []
        if not isinstance(key_provider, KeyProvider) or not getattr(
            key_provider, "key_ref", ""
        ):
            missing.append("keys")
        if not isinstance(store, ProtectedPayloadStore):
            missing.append("store")
        if policy is None:
            missing.append("policy")
        if missing:
            raise CheckpointProtectionRequiredError(
                "missing-protection-dependency", {"missing": missing}
            )
        assert key_provider is not None and store is not None and policy is not None
        if policy.key_ref != key_provider.key_ref:
            # Section 5.1: a policy naming a different keyRef attests to a key
            # that is not protecting anything.
            raise CheckpointProtectionRequiredError(
                "capture-policy-keyRef-does-not-match-the-key-provider"
            )
        self._key_provider = key_provider
        self._guard = SinkGuard(
            policy=policy,
            key_provider=key_provider,
            store=store,
            tenant_scope_id=tenant_scope_id,
            authority_provider_id=authority_provider_id,
            authority_subject_id=authority_subject_id,
            protector=protector,
            canaries=canaries,
        )

    @property
    def capture_policy_hash(self) -> str:
        return self._guard.policy_hash

    @property
    def key_ref_hash(self) -> str:
        return key_ref_hash(self._key_provider.key_ref)

    def prepare(
        self, sink_instance: object, spec: ProtectedCheckpointSpec
    ) -> PreparedSinkWrite:
        """Guard one projection and mint the one-shot write for the sink."""

        outcome = prepare_protected_checkpoint(self._guard, sink_instance, spec)
        if isinstance(outcome, GuardPrepared):
            return outcome.prepared
        if isinstance(outcome, GuardSuppressed):
            raise CheckpointProtectionRequiredError(
                "capture-policy-suppressed-an-authoritative-checkpoint"
            )
        assert isinstance(outcome, GuardFailed)
        code = outcome.failure.code
        if code in ("PAYLOAD_PROTECTION_REQUIRED", "INLINE_CAPTURE_NOT_AUTHORIZED"):
            raise CheckpointProtectionRequiredError(
                "guard-refused-the-unprotected-write",
                {"failureCode": code, "phase": outcome.failure.phase},
            )
        raise PersistenceValidationError(
            "guarded checkpoint preparation failed",
            (ValidationIssue("#/checkpoint", f"{code}:{outcome.failure.phase}"),),
        )

    async def save(
        self, store: GuardedFileCheckpointStore, spec: ProtectedCheckpointSpec
    ) -> dict[str, JsonValue]:
        """Guard and persist one projection through the bound store."""

        return await store.save(self.prepare(store, spec))


def _value_at_pointer(document: object, pointer: str) -> object:
    tokens = [
        token.replace("~1", "/").replace("~0", "~")
        for token in pointer.split("/")[1:]
    ]
    current: object = document
    for token in tokens:
        if isinstance(current, list):
            if _ARRAY_INDEX.fullmatch(token) is None or int(token) >= len(current):
                return _NO_VALUE
            current = current[int(token)]
            continue
        if not isinstance(current, Mapping) or token not in current:
            return _NO_VALUE
        current = current[token]
    return current


def resolve_protected_checkpoint_value(
    checkpoint: Mapping[str, JsonValue],
    field_path: str,
    semantic_context: Mapping[str, JsonValue],
    *,
    store: ProtectedPayloadStore,
    key_provider: KeyProvider,
    capture_policy_hash: str,
    tenant_scope_id: str = "tenant-local",
    authority_provider_id: str = "authority-local",
    authority_subject_id: str = "subject-local",
    protector: Protector | None = None,
) -> JsonValue | RedactionFailure:
    """Authorize, authenticate, decrypt, and validate one protected field.

    Mirrors the TypeScript ``ProtectedCheckpointReader``: the occurrence AAD is
    rebuilt from the persisted projection envelope, so copying a blob or
    reference to another run, checkpoint, sequence, or field path fails
    authentication (Section 5.5).  A key provider is a parameter requirement —
    the plain load path never resolves references at all.
    """

    candidate = _value_at_pointer(checkpoint, field_path)
    invalid = validate_reference_document(candidate)
    if invalid is not None:
        return invalid
    assert isinstance(candidate, Mapping)
    reference = ProtectedValueRef(
        ref=str(candidate["ref"]),
        ciphertext_hash=str(candidate["ciphertextHash"]),
        value_mac=str(candidate["valueMac"]),
        key_ref_hash=str(candidate["keyRefHash"]),
        aad_hash=str(candidate["aadHash"]),
    )

    # Section 6.1: the adjacent MAC must equal the referenced object's valueMac.
    if field_path.endswith("Ref"):
        adjacent = _value_at_pointer(checkpoint, f"{field_path[:-3]}Mac")
        if adjacent is not _NO_VALUE and adjacent != reference.value_mac:
            return failure("PROTECTED_PAYLOAD_CORRUPT", "classification")
    if reference.key_ref_hash != key_ref_hash(key_provider.key_ref):
        return failure("PROTECTED_PAYLOAD_UNAUTHORIZED", "policy")

    run_id = str(checkpoint["runId"])
    identity_key = key_provider.run_identity_key(run_id)
    tenant = tenant_scope_hash(identity_key, tenant_scope_id)
    reference_key_hash = key_ref_hash(key_provider.key_ref)
    aad = ProtectedAad(
        run_id=run_id,
        graph_revision=int(str(checkpoint["graphRevision"])),
        record_kind="checkpoint",
        record_type=str(checkpoint["projectionType"]),
        sequence=int(str(checkpoint["sequence"])),
        field_path=field_path,
        capture_policy_hash=capture_policy_hash,
        key_ref_hash=reference_key_hash,
        authority_binding_hash=authority_binding_hash(
            identity_key,
            authority_provider_id=authority_provider_id,
            authority_subject_id=authority_subject_id,
            tenant_scope=tenant,
            run_id=run_id,
            capture_policy_hash=capture_policy_hash,
            key_reference_hash=reference_key_hash,
        ),
        tenant_scope_hash=tenant,
        value_mac=reference.value_mac,
        checkpoint_id=str(checkpoint["checkpointId"]),
    )
    if aad.digest() != reference.aad_hash:
        return failure("PROTECTED_PAYLOAD_CORRUPT", "classification")
    return unprotect_value(
        reference,
        aad=aad,
        semantic_context=semantic_context,
        store=store,
        key_provider=key_provider,
        protector=protector,
    )
