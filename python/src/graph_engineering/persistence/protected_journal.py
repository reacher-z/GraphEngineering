"""The guarded ``events/v1alpha2`` durable write path.

``events/v1alpha1`` cannot express a truthful protected disposition: its
envelope has no ``payloadDisposition``, its ``data`` is an open object, and the
current writer persists raw Tagged Durable JSON.  Section 3.1 makes that writer
honest by emitting ``redacted: false``, but honesty is not protection.  New
protected writes therefore use ``events/v1alpha2``, whose envelope pins exactly
one disposition per event type and whose payload fields are protected
references.

Everything in this module goes through :class:`~graph_engineering.redaction.
guard.SinkGuard`.  :class:`GuardedJsonlEventStore` accepts only a
:class:`~graph_engineering.redaction.guard.PreparedSinkWrite`; its byte writer is
private, so an adapter cannot opt out by calling a lower-level raw writer.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Final, Protocol, runtime_checkable

from pydantic import ValidationError

from ..canonical import canonical_bytes, canonical_json
from ..events import ProtectedGraphEvent
from ..models import MAX_SAFE_INTEGER, JsonValue
from ..redaction.disposition import PayloadDisposition, validate_disposition
from ..redaction.errors import RedactionDenied, RedactionFailure, failure
from ..redaction.guard import (
    NO_PAYLOAD,
    GuardFailed,
    GuardPrepared,
    GuardSuppressed,
    OccurrenceContext,
    PreparedSinkWrite,
    SinkGuard,
    SinkWriteRequest,
)
from ..redaction.legacy import classify_history
from ..redaction.protect import (
    PROTECTED_STORE_CONTRACT,
    ProtectedValueRef,
    activity_key,
    graph_input_context,
    node_input_context,
    node_output_context,
    run_result_context,
    value_mac,
)
from .errors import (
    CorruptEventLogError,
    PersistenceIOError,
    PersistenceValidationError,
    ValidationIssue,
    VersionConflictError,
)
from .identifiers import assert_safe_identifier, identifier_hash
from .locks import process_lock

EVENT_V1ALPHA2_API_VERSION: Final = "graphengineering.reacher-z.github.io/events/v1alpha2"
CONTRACT_VERSION_V1ALPHA2: Final = "scheduler-recovery/v1alpha2"
EVENT_JOURNAL_SINK: Final = "event-journal"

# Section 3.2 and event-v1alpha2.schema.json: the legal dispositions per event
# type. `inline-unredacted` is unrepresentable here, deliberately.
#
# Twelve of the thirteen types pin exactly one disposition. `NodeAttemptFailed`
# is the one type the schema gives two: `$defs.nodeAttemptFailedMetadataData`
# and `$defs.nodeAttemptFailedProtectedData`. Section 6.1 decides between them by
# what the record actually carries — "optional raw `evidenceRef`/`evidenceMac`
# only under explicit protected-evidence policy" — so the disposition is a
# function of the record, not of the type name. A table asserting one
# disposition per type is what silently pinned this runtime to `metadata-only`
# and made it reject the other lane's conforming record.
EVENT_DISPOSITIONS: Final[dict[str, frozenset[PayloadDisposition]]] = {
    "RunCreated": frozenset({"protected-ref"}),
    "RunStarted": frozenset({"metadata-only"}),
    "RunResumed": frozenset({"metadata-only"}),
    "NodeScheduled": frozenset({"protected-ref"}),
    "NodeStarted": frozenset({"metadata-only"}),
    "NodeAttemptFailed": frozenset({"metadata-only", "protected-ref"}),
    "NodeSettledWithoutAttempt": frozenset({"protected-ref"}),
    "NodeRetried": frozenset({"metadata-only"}),
    "NodeSucceeded": frozenset({"protected-ref"}),
    "EdgeEmitted": frozenset({"metadata-only"}),
    "RunCancelled": frozenset({"protected-ref"}),
    "RunFailed": frozenset({"protected-ref"}),
    "RunSucceeded": frozenset({"protected-ref"}),
}


def event_disposition(event_type: str, *, has_payload: bool) -> PayloadDisposition:
    """The one disposition this record claims.

    A record that carries an authoritative value to protect is `protected-ref`;
    one that carries none is `metadata-only`. Both languages decide it from this
    single fact, so the same input yields the same disposition on both lanes.
    """

    legal = EVENT_DISPOSITIONS[event_type]
    chosen: PayloadDisposition = "protected-ref" if has_payload else "metadata-only"
    if chosen in legal:
        return chosen
    # A type that pins exactly one disposition keeps it; the payload presence of
    # such a type is fixed by its own schema and is not a free choice.
    return next(iter(legal))


# `event-v1alpha2.schema.json` `$defs.attemptFailure`: a closed object whose
# `messageTemplate` and `causeCode` are closed enums. It carries no `nodeId`,
# `attempt`, `message` or `causeName`: the first two are envelope members and the
# last two are producer-derived text that belongs in the protected evidence.
ATTEMPT_FAILURE_REQUIRED: Final[frozenset[str]] = frozenset(
    {"phase", "code", "messageTemplate", "retryable"}
)
ATTEMPT_FAILURE_OPTIONAL: Final[frozenset[str]] = frozenset({"causeCode"})
ATTEMPT_FAILURE_CODES: Final[frozenset[str]] = frozenset(
    {
        "NODE_EXECUTION_FAILED",
        "NODE_TIMEOUT",
        "NODE_CANCELLED",
        "INVALID_OUTPUT",
        "NODE_EXECUTION_INTERRUPTED",
        "INVALID_ROUTE_SELECTION",
    }
)
ATTEMPT_FAILURE_TEMPLATES: Final[frozenset[str]] = frozenset(
    {
        "node-execution-failed/v1",
        "node-timeout/v1",
        "node-cancelled/v1",
        "invalid-output/v1",
        "process-interrupted/v1",
        "invalid-route-selection/v1",
    }
)
ATTEMPT_FAILURE_CAUSE_CODES: Final[frozenset[str]] = frozenset(
    {"EXECUTOR_REJECTED", "TIMEOUT", "CANCELLED", "VALIDATION", "PROCESS_LOST", "ROUTER_CONTRACT"}
)

SETTLED_FAILURE_CODES: Final[frozenset[str]] = frozenset(
    {
        "EXECUTOR_NOT_FOUND",
        "UPSTREAM_FAILED",
        "INPUT_BINDING_FAILED",
        "ATTEMPT_BUDGET_EXHAUSTED",
        "NODE_CANCELLED",
        "ROUTE_NOT_SELECTED",
        "UNSUPPORTED_EDGE_CONDITION",
        "UPSTREAM_UNKNOWN",
    }
)


def validate_attempt_failure(value: object) -> RedactionFailure | None:
    """Validate one `data.failure` against `$defs.attemptFailure`.

    This is the check whose absence let a non-conforming `NodeAttemptFailed`
    reach disk in both languages: the envelope was validated, the `data` members
    were counted, and the object inside `failure` was never looked at.
    """

    if not isinstance(value, Mapping):
        return failure("REDACTION_POLICY_INVALID", "sink-write", field="failure")
    keys = set(value.keys())
    if not keys >= ATTEMPT_FAILURE_REQUIRED:
        return failure("REDACTION_POLICY_INVALID", "sink-write", field="failure")
    if not keys <= (ATTEMPT_FAILURE_REQUIRED | ATTEMPT_FAILURE_OPTIONAL):
        # `nodeId`, `attempt`, `message` and `causeName` land here.
        return failure("PAYLOAD_PROTECTION_REQUIRED", "sink-write", field="failure")
    if value["phase"] != "execute":
        return failure("REDACTION_POLICY_INVALID", "sink-write", field="failure.phase")
    if value["code"] not in ATTEMPT_FAILURE_CODES:
        return failure("REDACTION_POLICY_INVALID", "sink-write", field="failure.code")
    if value["messageTemplate"] not in ATTEMPT_FAILURE_TEMPLATES:
        return failure(
            "REDACTION_POLICY_INVALID", "sink-write", field="failure.messageTemplate"
        )
    if not isinstance(value["retryable"], bool):
        return failure("REDACTION_POLICY_INVALID", "sink-write", field="failure.retryable")
    if "causeCode" in value and value["causeCode"] not in ATTEMPT_FAILURE_CAUSE_CODES:
        return failure("REDACTION_POLICY_INVALID", "sink-write", field="failure.causeCode")
    return None

# Section 6.1 legacy aliases forbidden in a protected v1alpha2 payload.
FORBIDDEN_LEGACY_DATA_FIELDS: Final[frozenset[str]] = frozenset(
    {"input", "output", "result", "inputHash", "outputHash", "resultHash"}
)


class UnguardedWriteError(RuntimeError):
    """Raised when a caller tries to write bytes that no guard prepared."""


@runtime_checkable
class ProtectedEventStore(Protocol):
    """The guarded durable journal sink the scheduler is allowed to write to.

    ``append`` accepts capabilities, never documents: the only way to obtain a
    :class:`~graph_engineering.redaction.guard.PreparedSinkWrite` is to pass a
    candidate record through the shared guard, so a caller cannot reach a raw
    byte writer and there is no legacy fallback to fall back to.
    """

    async def append(
        self,
        run_id: str,
        expected_version: int,
        prepared: Sequence[PreparedSinkWrite],
    ) -> int: ...

    async def read(
        self,
        run_id: str,
        from_sequence: int = 0,
    ) -> tuple[ProtectedGraphEvent, ...]: ...

    def legacy_documents(self, run_id: str) -> tuple[Mapping[str, JsonValue], ...]:
        """Return any co-located ``events/v1alpha1`` records, read-only.

        Section 9.1 requires legacy detection before ``RunResumed``, before
        append, and before any executor invocation.  The bytes are returned
        exactly as they are on disk; nothing here rewrites, scrubs, truncates,
        or reinterprets them.
        """
        ...


def _validate_expected_version(value: int) -> None:
    if type(value) is not int or value < -1 or value > MAX_SAFE_INTEGER:
        raise PersistenceValidationError(
            "expectedVersion is invalid",
            (
                ValidationIssue(
                    "#/expectedVersion",
                    f"expected an integer from -1 through {MAX_SAFE_INTEGER}",
                ),
            ),
        )


def _decode_protected_line(
    run_id: str,
    raw_line: bytes,
    line_number: int,
    expected_sequence: int,
) -> ProtectedGraphEvent:
    try:
        document = json.loads(raw_line)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise CorruptEventLogError(run_id, str(exc), line_number) from exc
    invalid = validate_protected_event(document)
    if invalid is not None:
        raise CorruptEventLogError(
            run_id, f"protected event is invalid: {invalid.code}", line_number
        )
    try:
        event = ProtectedGraphEvent.model_validate(document)
    except ValidationError as exc:
        raise CorruptEventLogError(run_id, str(exc), line_number) from exc
    if event.run_id != run_id:
        raise CorruptEventLogError(
            run_id,
            f"record runId {event.run_id!r} does not match file stream",
            line_number,
        )
    if event.sequence != expected_sequence:
        raise CorruptEventLogError(
            run_id,
            f"expected sequence {expected_sequence}, received {event.sequence}",
            line_number,
        )
    return event


def _consumed_events(
    run_id: str,
    expected_version: int,
    sink: object,
    prepared: Sequence[PreparedSinkWrite],
) -> tuple[tuple[ProtectedGraphEvent, ...], bytes]:
    """Consume each capability once and decode the exact bytes it authorized.

    Consumption happens only after the compare-and-swap comparison succeeded, so
    a lost race never burns a capability and never writes a partial batch.
    """

    events: list[ProtectedGraphEvent] = []
    payloads: list[bytes] = []
    for index, item in enumerate(prepared):
        if type(item) is not PreparedSinkWrite:
            raise UnguardedWriteError("this sink accepts only a PreparedSinkWrite")
        if item.sink != EVENT_JOURNAL_SINK:
            raise UnguardedWriteError("prepared write is bound to another sink class")
        payload = item.consume(sink)
        events.append(
            _decode_protected_line(run_id, payload, index + 1, expected_version + index + 1)
        )
        payloads.append(payload)
    return tuple(events), b"".join(payload + b"\n" for payload in payloads)


class GuardedMemoryEventStore:
    """A process-local guarded journal with the same compare-and-swap contract."""

    sink: Final = EVENT_JOURNAL_SINK

    def __init__(
        self,
        legacy_histories: Mapping[str, Sequence[Mapping[str, JsonValue]]] | None = None,
    ) -> None:
        self._streams: dict[str, list[ProtectedGraphEvent]] = {}
        self._locks: dict[str, asyncio.Lock] = {}
        self._legacy = {
            run_id: tuple(dict(document) for document in documents)
            for run_id, documents in (legacy_histories or {}).items()
        }

    def _lock(self, run_id: str) -> asyncio.Lock:
        return self._locks.setdefault(run_id, asyncio.Lock())

    async def append(
        self,
        run_id: str,
        expected_version: int,
        prepared: Sequence[PreparedSinkWrite],
    ) -> int:
        assert_safe_identifier(run_id, "runId")
        _validate_expected_version(expected_version)
        async with self._lock(run_id):
            stream = self._streams.setdefault(run_id, [])
            actual_version = stream[-1].sequence if stream else -1
            if expected_version != actual_version:
                raise VersionConflictError(run_id, expected_version, actual_version)
            events, _ = _consumed_events(run_id, expected_version, self, prepared)
            stream.extend(events)
            return stream[-1].sequence if stream else -1

    async def read(
        self,
        run_id: str,
        from_sequence: int = 0,
    ) -> tuple[ProtectedGraphEvent, ...]:
        assert_safe_identifier(run_id, "runId")
        async with self._lock(run_id):
            return tuple(
                event
                for event in self._streams.get(run_id, ())
                if event.sequence >= from_sequence
            )

    def legacy_documents(self, run_id: str) -> tuple[Mapping[str, JsonValue], ...]:
        return self._legacy.get(run_id, ())


@dataclass(frozen=True, slots=True)
class ProtectedAppend:
    """One accepted guarded append."""

    document: Mapping[str, JsonValue]
    payload_hash: str
    protected_refs: tuple[ProtectedValueRef, ...]
    decision_id: str


class GuardedJsonlEventStore:
    """A durable JSONL sink whose only public write method takes a prepared write.

    Section 7: the default runtime dependency graph exposes only sinks whose
    public write method accepts a ``PreparedSinkWrite``; raw byte, file, network,
    and store primitives are private implementation details and receive only the
    already prepared bytes.
    """

    sink: Final = EVENT_JOURNAL_SINK

    def __init__(self, root: str | os.PathLike[str]) -> None:
        self.root = Path(root).resolve()
        self.events_directory = self.root / "events-v1alpha2"
        # `events/` is where a `JsonlEventStore` keeps a legacy v1alpha1 journal
        # for the same root. It is only ever opened read-only, for detection.
        self.legacy_events_directory = self.root / "events"
        try:
            self.events_directory.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            raise PersistenceIOError(
                "create protected event directory", str(self.events_directory), exc
            ) from exc

    def path_for_run(self, run_id: str) -> Path:
        assert_safe_identifier(run_id, "runId")
        return self.events_directory / f"{identifier_hash(run_id)}.jsonl"

    def legacy_path_for_run(self, run_id: str) -> Path:
        assert_safe_identifier(run_id, "runId")
        return self.legacy_events_directory / f"{identifier_hash(run_id)}.jsonl"

    def legacy_documents(self, run_id: str) -> tuple[Mapping[str, JsonValue], ...]:
        path = self.legacy_path_for_run(run_id)
        if not path.exists():
            return ()
        documents: list[Mapping[str, JsonValue]] = []
        for line in path.read_bytes().splitlines():
            if not line:
                continue
            try:
                document = json.loads(line)
            except (UnicodeDecodeError, json.JSONDecodeError):
                # An undecodable legacy record is still a legacy record. It is
                # reported as an opaque marker rather than repaired or skipped.
                documents.append({"apiVersion": "unreadable"})
                continue
            documents.append(document if isinstance(document, dict) else {})
        return tuple(documents)

    def _decode_log(self, run_id: str) -> tuple[ProtectedGraphEvent, ...]:
        path = self.path_for_run(run_id)
        if not path.exists():
            return ()
        try:
            raw = path.read_bytes()
        except OSError as exc:
            raise PersistenceIOError("read protected event log", str(path), exc) from exc
        if not raw:
            raise CorruptEventLogError(run_id, "empty protected event log file")
        if not raw.endswith(b"\n"):
            raise CorruptEventLogError(run_id, "truncated final JSONL record")
        events: list[ProtectedGraphEvent] = []
        for line_number, raw_line in enumerate(raw.splitlines(), start=1):
            if not raw_line:
                raise CorruptEventLogError(run_id, "blank JSONL record", line_number)
            events.append(_decode_protected_line(run_id, raw_line, line_number, len(events)))
        return tuple(events)

    def _append_sync(
        self,
        run_id: str,
        expected_version: int,
        prepared: Sequence[PreparedSinkWrite],
    ) -> int:
        existing = self._decode_log(run_id)
        actual_version = existing[-1].sequence if existing else -1
        if expected_version != actual_version:
            raise VersionConflictError(run_id, expected_version, actual_version)
        events, payload = _consumed_events(run_id, expected_version, self, prepared)
        if not events:
            return actual_version
        path = self.path_for_run(run_id)
        try:
            descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
            with os.fdopen(descriptor, "ab") as handle:
                handle.write(payload)
                handle.flush()
                os.fsync(handle.fileno())
        except OSError as exc:
            raise PersistenceIOError("append protected event log", str(path), exc) from exc
        return events[-1].sequence

    async def append(
        self,
        run_id: str,
        expected_version: int,
        prepared: Sequence[PreparedSinkWrite],
    ) -> int:
        assert_safe_identifier(run_id, "runId")
        _validate_expected_version(expected_version)
        path = self.path_for_run(run_id)
        async with process_lock(f"protected-event:{path}"):
            return await asyncio.to_thread(
                self._append_sync, run_id, expected_version, prepared
            )

    async def read(
        self,
        run_id: str,
        from_sequence: int = 0,
    ) -> tuple[ProtectedGraphEvent, ...]:
        path = self.path_for_run(run_id)
        async with process_lock(f"protected-event:{path}"):
            events = await asyncio.to_thread(self._decode_log, run_id)
        return tuple(event for event in events if event.sequence >= from_sequence)

    async def write(self, run_id: str, prepared: PreparedSinkWrite) -> int:
        """Append exactly the prepared bytes. The token is consumed once."""

        if type(prepared) is not PreparedSinkWrite:
            # A serialized guard decision, store envelope, protected reference,
            # or forged structural object is not a capability.
            raise UnguardedWriteError("this sink accepts only a PreparedSinkWrite")
        if prepared.sink != self.sink:
            raise UnguardedWriteError("prepared write is bound to another sink class")
        payload = prepared.consume(self)
        path = self.path_for_run(run_id)
        async with process_lock(f"protected-event:{path}"):
            return await asyncio.to_thread(self._append_bytes, path, payload)

    def read_documents(self, run_id: str) -> tuple[Mapping[str, JsonValue], ...]:
        path = self.path_for_run(run_id)
        if not path.exists():
            return ()
        raw = path.read_bytes()
        documents: list[Mapping[str, JsonValue]] = []
        for line in raw.splitlines():
            if not line:
                continue
            documents.append(json.loads(line))
        return tuple(documents)

    @staticmethod
    def _append_bytes(path: Path, payload: bytes) -> int:
        try:
            descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
            with os.fdopen(descriptor, "ab") as handle:
                handle.write(payload + b"\n")
                handle.flush()
                os.fsync(handle.fileno())
        except OSError as exc:
            raise PersistenceIOError("append protected event log", str(path), exc) from exc
        return len(payload) + 1


def validate_protected_event(document: object) -> RedactionFailure | None:
    """Native closed validation of one ``events/v1alpha2`` envelope."""

    if not isinstance(document, Mapping):
        return failure("REDACTION_POLICY_INVALID", "sink-write")
    required = {
        "apiVersion",
        "eventId",
        "type",
        "timestamp",
        "runId",
        "graphRevision",
        "sequence",
        "payloadHash",
        "capturePolicyHash",
        "redacted",
        "payloadDisposition",
        "data",
    }
    optional = {"traceId", "spanId", "parentSpanId", "nodeId", "edgeId", "attempt"}
    keys = set(document.keys())
    if not required <= keys or not keys <= (required | optional):
        return failure("REDACTION_POLICY_INVALID", "sink-write")
    if document["apiVersion"] != EVENT_V1ALPHA2_API_VERSION:
        return failure("REDACTION_POLICY_INVALID", "sink-write")
    event_type = document["type"]
    if type(event_type) is not str or event_type not in EVENT_DISPOSITIONS:
        return failure("REDACTION_POLICY_INVALID", "sink-write")
    if document["payloadDisposition"] not in EVENT_DISPOSITIONS[event_type]:
        return failure("REDACTION_POLICY_INVALID", "sink-write")

    disposition_failure = validate_disposition(
        {
            "payloadDisposition": document["payloadDisposition"],
            "redacted": document["redacted"],
        }
    )
    if disposition_failure is not None:
        return disposition_failure

    for identity in ("traceId", "spanId", "parentSpanId"):
        value = document.get(identity)
        if value is None:
            continue
        width = 32 if identity == "traceId" else 16
        if (
            type(value) is not str
            or len(value) != width
            or any(character not in "0123456789abcdef" for character in value)
            or set(value) == {"0"}
        ):
            # Trace and span identities are lowercase fixed-width non-zero hex.
            return failure("REDACTION_POLICY_INVALID", "sink-write")
    if "parentSpanId" in document and "spanId" not in document:
        return failure("REDACTION_POLICY_INVALID", "sink-write")

    data = document["data"]
    if not isinstance(data, Mapping):
        return failure("REDACTION_POLICY_INVALID", "sink-write")
    if set(data.keys()) & FORBIDDEN_LEGACY_DATA_FIELDS:
        # Legacy field aliases and inline payloads are forbidden in a protected
        # v1alpha2 payload.
        return failure("PAYLOAD_PROTECTION_REQUIRED", "sink-write")

    if event_type == "NodeAttemptFailed":
        # The one sub-object the schema closes. Validating the `data` member
        # names without ever looking inside `failure` is what let a
        # non-conforming record reach disk.
        attempt_failure = validate_attempt_failure(data.get("failure"))
        if attempt_failure is not None:
            return attempt_failure
        protected = document["payloadDisposition"] == "protected-ref"
        if protected != ({"evidenceRef", "evidenceMac"} <= set(data.keys())):
            # Section 6.1 ties the disposition to the evidence, in both
            # directions: protected evidence means `protected-ref`, and no
            # evidence means `metadata-only`.
            return failure("REDACTION_POLICY_INVALID", "sink-write", field="payloadDisposition")
    if event_type == "NodeSettledWithoutAttempt" and (
        data.get("failureCode") not in SETTLED_FAILURE_CODES
    ):
        # `$defs.settledFailureCode` is closed and carries no
        # `SETTLED_WITHOUT_FAILURE` sentinel.
        return failure("REDACTION_POLICY_INVALID", "sink-write", field="failureCode")

    payload_hash = hashlib.sha256(canonical_bytes(dict(data))).hexdigest()
    if document["payloadHash"] != payload_hash:
        return failure("REDACTION_POLICY_INVALID", "sink-write")
    return None


class ProtectedEventJournal:
    """The guarded durable event writer.

    An event carrying an application payload cannot be written without passing
    the guard: the payload is never placed into the envelope by the caller, it is
    handed to the guard, and only the guard can produce the bytes this journal
    accepts.
    """

    def __init__(
        self,
        *,
        run_id: str,
        graph_revision: int,
        guard: SinkGuard,
        store: GuardedJsonlEventStore,
    ) -> None:
        assert_safe_identifier(run_id, "runId")
        self.run_id = run_id
        self.graph_revision = graph_revision
        self._guard = guard
        self._store = store
        self._sequence = -1
        self._decisions: list[str] = []

    @property
    def sequence(self) -> int:
        return self._sequence

    async def append_run_created(
        self,
        *,
        event_id: str,
        timestamp: str,
        graph_input: object,
        graph_hash: str,
        implementation_hash: str,
        key_ref_digest: str,
        max_total_attempts: int,
    ) -> ProtectedAppend:
        return await self._append(
            event_type="RunCreated",
            event_id=event_id,
            timestamp=timestamp,
            source_class="graph-input",
            payload=graph_input,
            semantic_context=graph_input_context(self.run_id, self.graph_revision),
            field_path="/data/inputRef",
            mac_field_path="/data/inputMac",
            data={
                "contractVersion": CONTRACT_VERSION_V1ALPHA2,
                "graphHash": graph_hash,
                "implementationHash": implementation_hash,
                "capturePolicyHash": self._guard.policy_hash,
                "protectedStoreContract": PROTECTED_STORE_CONTRACT,
                "keyRefHash": key_ref_digest,
                "maxTotalAttempts": max_total_attempts,
            },
        )

    async def append_node_scheduled(
        self,
        *,
        event_id: str,
        timestamp: str,
        node_id: str,
        attempt: int,
        node_input: object,
        identity_key: bytes,
        side_effects: str,
    ) -> ProtectedAppend:
        context = node_input_context(self.run_id, self.graph_revision, node_id)
        mac = value_mac(identity_key, context, node_input)
        return await self._append(
            event_type="NodeScheduled",
            event_id=event_id,
            timestamp=timestamp,
            source_class="bound-node-input",
            payload=node_input,
            semantic_context=context,
            field_path="/data/inputRef",
            mac_field_path="/data/inputMac",
            node_id=node_id,
            attempt=attempt,
            data={
                "activityKey": activity_key(
                    identity_key,
                    run_id=self.run_id,
                    graph_revision=self.graph_revision,
                    node_id=node_id,
                    input_mac=mac,
                ),
                "sideEffects": side_effects,
            },
            side_effects=side_effects,
        )

    async def append_node_succeeded(
        self,
        *,
        event_id: str,
        timestamp: str,
        node_id: str,
        attempt: int,
        output: object,
        input_mac: str,
        side_effects: str = "none",
    ) -> ProtectedAppend:
        return await self._append(
            event_type="NodeSucceeded",
            event_id=event_id,
            timestamp=timestamp,
            source_class="node-output",
            payload=output,
            semantic_context=node_output_context(self.run_id, self.graph_revision, node_id),
            field_path="/data/outputRef",
            mac_field_path="/data/outputMac",
            node_id=node_id,
            attempt=attempt,
            data={"inputMac": input_mac},
            side_effects=side_effects,
            executor_outcome="succeeded",
        )

    async def append_run_succeeded(
        self,
        *,
        event_id: str,
        timestamp: str,
        result: object,
    ) -> ProtectedAppend:
        return await self._append(
            event_type="RunSucceeded",
            event_id=event_id,
            timestamp=timestamp,
            source_class="run-result",
            payload=result,
            semantic_context=run_result_context(self.run_id, self.graph_revision),
            field_path="/data/resultRef",
            mac_field_path="/data/resultMac",
            data={"status": "succeeded"},
        )

    async def append_node_started(
        self,
        *,
        event_id: str,
        timestamp: str,
        node_id: str,
        attempt: int,
        input_mac: str,
        activity: str,
    ) -> ProtectedAppend:
        """A metadata-only event: no application payload field is sourced."""

        return await self._append_metadata_only(
            event_type="NodeStarted",
            event_id=event_id,
            timestamp=timestamp,
            data={"inputMac": input_mac, "activityKey": activity},
            node_id=node_id,
            attempt=attempt,
        )

    async def _append_metadata_only(
        self,
        *,
        event_type: str,
        event_id: str,
        timestamp: str,
        data: Mapping[str, JsonValue],
        node_id: str | None = None,
        edge_id: str | None = None,
        attempt: int | None = None,
    ) -> ProtectedAppend:
        return await self._prepare_and_write(
            event_type=event_type,
            event_id=event_id,
            timestamp=timestamp,
            source_class="runtime-generated-identifier",
            data=data,
            node_id=node_id,
            edge_id=edge_id,
            attempt=attempt,
            field_path="/data",
            mac_field_path=None,
            payload=None,
            semantic_context=None,
        )

    async def _append(
        self,
        *,
        event_type: str,
        event_id: str,
        timestamp: str,
        source_class: str,
        payload: object,
        semantic_context: Mapping[str, JsonValue],
        field_path: str,
        mac_field_path: str,
        data: Mapping[str, JsonValue],
        node_id: str | None = None,
        edge_id: str | None = None,
        attempt: int | None = None,
        side_effects: str = "not-applicable",
        executor_outcome: str = "not-applicable",
    ) -> ProtectedAppend:
        return await self._prepare_and_write(
            event_type=event_type,
            event_id=event_id,
            timestamp=timestamp,
            source_class=source_class,
            payload=payload,
            semantic_context=semantic_context,
            field_path=field_path,
            mac_field_path=mac_field_path,
            data=data,
            node_id=node_id,
            edge_id=edge_id,
            attempt=attempt,
            side_effects=side_effects,
            executor_outcome=executor_outcome,
        )

    async def _prepare_and_write(
        self,
        *,
        event_type: str,
        event_id: str,
        timestamp: str,
        source_class: str,
        payload: object,
        semantic_context: Mapping[str, JsonValue] | None,
        field_path: str,
        mac_field_path: str | None,
        data: Mapping[str, JsonValue],
        node_id: str | None = None,
        edge_id: str | None = None,
        attempt: int | None = None,
        side_effects: str = "not-applicable",
        executor_outcome: str = "not-applicable",
    ) -> ProtectedAppend:
        sequence = self._sequence + 1
        envelope: dict[str, JsonValue] = {
            "apiVersion": EVENT_V1ALPHA2_API_VERSION,
            "eventId": event_id,
            "type": event_type,
            "timestamp": timestamp,
            "runId": self.run_id,
            "graphRevision": self.graph_revision,
            "sequence": sequence,
            "capturePolicyHash": self._guard.policy_hash,
            "redacted": False,
            "payloadDisposition": event_disposition(
                event_type, has_payload=payload is not NO_PAYLOAD
            ),
            "data": dict(data),
        }
        if node_id is not None:
            envelope["nodeId"] = node_id
        if edge_id is not None:
            envelope["edgeId"] = edge_id
        if attempt is not None:
            envelope["attempt"] = attempt

        protected = envelope["payloadDisposition"] == "protected-ref"
        request = SinkWriteRequest(
            source_class=source_class,
            sink=GuardedJsonlEventStore.sink,
            sink_instance=self._store,
            authority_class="authoritative" if protected else "observational",
            occurrence=OccurrenceContext(
                run_id=self.run_id,
                graph_revision=self.graph_revision,
                record_kind="event",
                record_type=event_type,
                occurrence_id=event_id,
                sequence=sequence,
                field_path=field_path,
                occurred_at=timestamp,
                node_id=node_id,
                edge_id=edge_id,
                attempt=attempt,
            ),
            metadata=envelope,
            payload=payload if protected else NO_PAYLOAD,
            semantic_context=semantic_context,
            mac_field_path=mac_field_path,
            payload_hash_field="/payloadHash",
            payload_hash_source="/data",
            side_effects=side_effects,  # type: ignore[arg-type]
            executor_outcome=executor_outcome,  # type: ignore[arg-type]
        )
        outcome = self._guard.prepare(request)
        if isinstance(outcome, GuardFailed):
            raise RedactionDenied(outcome.failure)
        if isinstance(outcome, GuardSuppressed):
            raise RedactionDenied(
                failure("PAYLOAD_PROTECTION_REQUIRED", "policy", sink=request.sink)
            )
        assert isinstance(outcome, GuardPrepared)

        document = outcome.document
        invalid = validate_protected_event(document)
        if invalid is not None:
            # The prepared write is abandoned unconsumed; nothing reaches disk.
            raise RedactionDenied(invalid)

        await self._store.write(self.run_id, outcome.prepared)
        self._sequence = sequence
        self._decisions.append(outcome.decision.decision_id)
        return ProtectedAppend(
            document=document,
            payload_hash=str(document["payloadHash"]),
            protected_refs=outcome.protected_refs,
            decision_id=outcome.decision.decision_id,
        )


def reject_legacy_history(
    events: Sequence[Mapping[str, JsonValue]],
    *,
    terminal: bool = False,
    authorization: str = "none",
) -> RedactionFailure | None:
    """Section 9.1 detection, before ``RunResumed`` and before any executor.

    The original bytes are never rewritten, scrubbed, or reinterpreted.
    """

    disposition = classify_history(
        events,
        terminal=terminal,
        authorization=authorization,  # type: ignore[arg-type]
    )
    if disposition is None:
        return None
    return disposition.failure


def canonical_document_line(document: Mapping[str, JsonValue]) -> str:
    return canonical_json(dict(document))
