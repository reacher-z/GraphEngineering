"""Durable operational surface for the native Python CLI.

Everything in this module is a strictly read-only projection of a durable JSONL
event journal. It opens journal files for reading only, never creates or renames
a path, and never appends a record. Commands whose durable behaviour does not
exist in this runtime fail closed here rather than emitting a plausible answer;
see :data:`UNSUPPORTED_OPERATIONS`.

Redaction boundary (``spec/redaction-semantics.md`` 1.2): ``cli-json`` and
``cli-diagnostic`` are capture sinks. This module never reads, projects, or
prints ``event.data``, node inputs/outputs, run results, or resolved filesystem
paths. Only the closed envelope-metadata allowlist below leaves the process.

Every rule here is the byte-for-byte twin of ``packages/cli/src/operations.ts``.
Neither implementation reads the other; the shared conformance corpus proves
they agree.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final, Literal

#: Event envelope contract this reader understands.
JOURNAL_API_VERSION: Final = "graphengineering.reacher-z.github.io/events/v1alpha1"

#: Hard ceiling on a journal file this CLI will read into memory.
MAX_JOURNAL_BYTES: Final = 67_108_864

#: Default and maximum window for ``graph logs``.
DEFAULT_LOG_LIMIT: Final = 200
MAX_LOG_LIMIT: Final = 10_000

MAX_SAFE_INTEGER: Final = 9_007_199_254_740_991

#: Same safe-identifier grammar the persistence layer enforces for run ids.
_SAFE_RUN_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")

_RFC3339 = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$")

#: Closed v1alpha1 event-type vocabulary, in contract declaration order.
JOURNAL_EVENT_TYPES: Final = (
    "RunCreated",
    "RunStarted",
    "RunPaused",
    "RunResumed",
    "GraphPatched",
    "NodeScheduled",
    "NodeStarted",
    "NodeAttemptFailed",
    "NodeSettledWithoutAttempt",
    "NodeRetried",
    "NodeSucceeded",
    "EdgeEmitted",
    "BarrierSatisfied",
    "RouteSelected",
    "VerificationRecorded",
    "BudgetUpdated",
    "ArtifactCreated",
    "HumanInputRequested",
    "HumanInputReceived",
    "RunCancelled",
    "RunFailed",
    "RunSucceeded",
)

_EVENT_TYPE_SET = frozenset(JOURNAL_EVENT_TYPES)

_ENVELOPE_KEYS = frozenset(
    {
        "apiVersion",
        "eventId",
        "type",
        "timestamp",
        "runId",
        "graphRevision",
        "sequence",
        "traceId",
        "spanId",
        "parentSpanId",
        "nodeId",
        "edgeId",
        "attempt",
        "payloadHash",
        "artifactRef",
        "redacted",
        "data",
    }
)

_REQUIRED_KEYS: Final = (
    "apiVersion",
    "eventId",
    "type",
    "timestamp",
    "runId",
    "graphRevision",
    "sequence",
    "data",
)

_OPTIONAL_STRING_KEYS: Final = (
    "traceId",
    "spanId",
    "parentSpanId",
    "nodeId",
    "edgeId",
    "payloadHash",
    "artifactRef",
)

RunStatus = Literal["created", "running", "paused", "succeeded", "failed", "cancelled"]

OperationFailureCode = Literal[
    "GECLI_RUN_ID_INVALID",
    "GECLI_STORE_UNREADABLE",
    "GECLI_HISTORY_UNREADABLE",
    "GECLI_HISTORY_TOO_LARGE",
    "GECLI_RUN_NOT_FOUND",
    "GECLI_HISTORY_MALFORMED",
    "GECLI_UNSUPPORTED_CAPABILITY",
]


@dataclass(frozen=True, slots=True)
class JournalEntry:
    """The projection this CLI is allowed to emit for one journal record."""

    sequence: int
    type: str
    timestamp: str
    graph_revision: int
    node_id: str | None
    edge_id: str | None
    attempt: int | None
    redacted: bool


class OperationError(Exception):
    """A read failure carrying only run identity and a record ordinal."""

    def __init__(
        self,
        code: OperationFailureCode,
        message: str,
        run_id: str,
        record: int | None = None,
    ) -> None:
        self.code = code
        self.run_id = run_id
        self.record = record
        super().__init__(message)


@dataclass(frozen=True, slots=True)
class UnsupportedOperation:
    """A command whose durable capability does not exist in this runtime."""

    capability: str
    message: str


#: Fail-closed operational commands.
#:
#: Each entry names the durable capability the command would need. None of them
#: exist in this runtime, so the command refuses before it reads or writes
#: anything. A stub that returned a plausible envelope would be a false claim.
UNSUPPORTED_OPERATIONS: Final[dict[str, UnsupportedOperation]] = {
    "cancel": UnsupportedOperation(
        "durable.run-cancellation",
        "graph cancel requires out-of-band durable run cancellation: the v1alpha1 "
        "journal has no cancellation-request record, and a terminal RunCancelled "
        "record may only be written by the scheduler that owns the run",
    ),
    "resume": UnsupportedOperation(
        "durable.run-resume",
        "graph resume requires a durable run lease and a node executor registry: "
        "the CLI never executes graph nodes, and resuming without executors would "
        "durably fail every remaining node",
    ),
    "replay": UnsupportedOperation(
        "durable.run-replay",
        "graph replay requires durable replay, which this runtime does not implement",
    ),
    "fork": UnsupportedOperation(
        "durable.run-fork",
        "graph fork requires durable run forking, which this runtime does not implement",
    ),
    "retry": UnsupportedOperation(
        "durable.node-retry",
        "graph retry requires durable node-level retry scheduling, which this "
        "runtime does not implement",
    ),
}


def _redaction_block() -> dict[str, object]:
    """Constant honesty marker attached to every operational data envelope."""

    return {
        "sink": "cli-json",
        "eventDataEmitted": False,
        "payloadsEmitted": False,
        "pathsEmitted": False,
    }


def is_safe_run_id(value: str) -> bool:
    return bool(_SAFE_RUN_ID.fullmatch(value)) and value not in {".", ".."}


def run_id_hash(run_id: str) -> str:
    return hashlib.sha256(run_id.encode("utf-8")).hexdigest()


def _reject_constant(name: str) -> object:
    raise ValueError(f"{name} is not JSON")


def _is_bounded_integer(value: object, minimum: int) -> bool:
    # ECMAScript parses `5` and `5.0` to the same number, so an integral float
    # must be accepted here for the two readers to agree.
    if isinstance(value, bool):
        return False
    if isinstance(value, int):
        numeric = value
    elif isinstance(value, float):
        if not math.isfinite(value) or not value.is_integer():
            return False
        numeric = int(value)
    else:
        return False
    return minimum <= numeric <= MAX_SAFE_INTEGER


def _as_integer(value: object) -> int:
    """Narrow a value already accepted by :func:`_is_bounded_integer`."""

    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TypeError("value is not a bounded journal integer")
    return int(value)


def _malformed(run_id: str, message: str, record: int | None) -> OperationError:
    return OperationError("GECLI_HISTORY_MALFORMED", message, run_id, record)


def _decode_record(line: str, index: int, run_id: str) -> JournalEntry:
    record = index + 1
    if not line:
        raise _malformed(run_id, "durable history record is blank", record)
    try:
        parsed = json.loads(line, parse_constant=_reject_constant)
    except (ValueError, RecursionError):
        raise _malformed(run_id, "durable history record is not JSON", record) from None
    if not isinstance(parsed, dict):
        raise _malformed(run_id, "durable history record is not a JSON object", record)
    for key in parsed:
        if key not in _ENVELOPE_KEYS:
            raise _malformed(run_id, "durable history record has an unknown property", record)
    for key in _REQUIRED_KEYS:
        if key not in parsed:
            raise _malformed(
                run_id, "durable history record is missing a required property", record
            )
    if parsed["apiVersion"] != JOURNAL_API_VERSION:
        raise _malformed(
            run_id, "durable history record has an unsupported event apiVersion", record
        )
    event_type = parsed["type"]
    if not isinstance(event_type, str) or event_type not in _EVENT_TYPE_SET:
        raise _malformed(run_id, "durable history record has an unknown event type", record)
    event_id = parsed["eventId"]
    if not isinstance(event_id, str) or not event_id:
        raise _malformed(run_id, "durable history record has an invalid eventId", record)
    timestamp = parsed["timestamp"]
    if not isinstance(timestamp, str) or not _RFC3339.fullmatch(timestamp):
        raise _malformed(run_id, "durable history record has an invalid timestamp", record)
    record_run_id = parsed["runId"]
    if not isinstance(record_run_id, str) or not record_run_id:
        raise _malformed(run_id, "durable history record has an invalid runId", record)
    if record_run_id != run_id:
        raise _malformed(run_id, "durable history record does not belong to this run", record)
    if not _is_bounded_integer(parsed["graphRevision"], 1):
        raise _malformed(run_id, "durable history record has an invalid graphRevision", record)
    if not _is_bounded_integer(parsed["sequence"], 0):
        raise _malformed(run_id, "durable history record has an invalid sequence", record)
    if _as_integer(parsed["sequence"]) != index:
        raise _malformed(run_id, "durable history record is out of sequence", record)
    for key in _OPTIONAL_STRING_KEYS:
        if key in parsed and not isinstance(parsed[key], str):
            raise _malformed(run_id, f"durable history record has an invalid {key}", record)
    if "attempt" in parsed and not _is_bounded_integer(parsed["attempt"], 1):
        raise _malformed(run_id, "durable history record has an invalid attempt", record)
    if "redacted" in parsed and not isinstance(parsed["redacted"], bool):
        raise _malformed(run_id, "durable history record has an invalid redacted flag", record)
    if not isinstance(parsed.get("data"), dict):
        raise _malformed(run_id, "durable history record has a non-object data member", record)
    node_id = parsed.get("nodeId")
    edge_id = parsed.get("edgeId")
    # `data` is deliberately dropped here and never reaches any sink.
    return JournalEntry(
        sequence=index,
        type=event_type,
        timestamp=timestamp,
        graph_revision=_as_integer(parsed["graphRevision"]),
        node_id=node_id if isinstance(node_id, str) else None,
        edge_id=edge_id if isinstance(edge_id, str) else None,
        attempt=_as_integer(parsed["attempt"]) if "attempt" in parsed else None,
        redacted=parsed.get("redacted") is True,
    )


def read_journal(store_directory: str, run_id: str) -> tuple[JournalEntry, ...]:
    """Read one durable history without mutating it.

    The journal file is opened read-only. No directory is created, no lock file
    is taken, and no record is appended, so every caller of this function is a
    provable zero-append reader.
    """

    if not is_safe_run_id(run_id):
        raise OperationError(
            "GECLI_RUN_ID_INVALID",
            "run identifier is not a safe durable identifier",
            run_id,
        )
    try:
        store_state = os.stat(store_directory)
    except OSError:
        raise OperationError(
            "GECLI_STORE_UNREADABLE",
            "durable store directory is not readable",
            run_id,
        ) from None
    if not os.path.isdir(store_directory) or store_state.st_ino < 0:
        raise OperationError(
            "GECLI_STORE_UNREADABLE",
            "durable store directory is not readable",
            run_id,
        )

    path = os.path.join(store_directory, "events", f"{run_id_hash(run_id)}.jsonl")
    try:
        with open(path, "rb", buffering=0) as stream:
            metadata = os.fstat(stream.fileno())
            if metadata.st_size > MAX_JOURNAL_BYTES:
                raise OperationError(
                    "GECLI_HISTORY_TOO_LARGE",
                    "durable history exceeds the readable byte limit",
                    run_id,
                )
            chunks: list[bytes] = []
            total = 0
            while True:
                chunk = stream.read(min(65_536, MAX_JOURNAL_BYTES + 1 - total))
                if not chunk:
                    break
                chunks.append(chunk)
                total += len(chunk)
                if total > MAX_JOURNAL_BYTES:
                    raise OperationError(
                        "GECLI_HISTORY_TOO_LARGE",
                        "durable history exceeds the readable byte limit",
                        run_id,
                    )
            raw = b"".join(chunks)
    except OperationError:
        raise
    except FileNotFoundError:
        raise OperationError(
            "GECLI_RUN_NOT_FOUND", "durable run history does not exist", run_id
        ) from None
    except OSError:
        raise OperationError(
            "GECLI_HISTORY_UNREADABLE", "durable history is not readable", run_id
        ) from None

    if not raw:
        raise _malformed(run_id, "durable history is empty", None)
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        raise _malformed(run_id, "durable history is not valid UTF-8", None) from None
    if not text.endswith("\n"):
        raise _malformed(run_id, "durable history has a truncated final record", None)
    return tuple(
        _decode_record(line, index, run_id) for index, line in enumerate(text[:-1].split("\n"))
    )


def project_status(entries: Sequence[JournalEntry]) -> RunStatus:
    """Derive the run lifecycle status from event types only; nothing is inferred."""

    status: RunStatus = "created"
    for entry in entries:
        if entry.type in {"RunStarted", "RunResumed"}:
            status = "running"
        elif entry.type == "RunPaused":
            status = "paused"
        elif entry.type == "RunSucceeded":
            status = "succeeded"
        elif entry.type == "RunFailed":
            status = "failed"
        elif entry.type == "RunCancelled":
            status = "cancelled"
    return status


def is_terminal_status(status: RunStatus) -> bool:
    return status in {"succeeded", "failed", "cancelled"}


def _count_type(entries: Sequence[JournalEntry], event_type: str) -> int:
    return sum(1 for entry in entries if entry.type == event_type)


def _require_entries(entries: Sequence[JournalEntry]) -> JournalEntry:
    if not entries:
        raise RuntimeError("journal projection requires at least one record")
    return entries[-1]


def status_data(run_id: str, entries: Sequence[JournalEntry]) -> dict[str, object]:
    status = project_status(entries)
    last = _require_entries(entries)
    first = entries[0]
    observed_nodes = {entry.node_id for entry in entries if entry.node_id is not None}
    return {
        "runId": run_id,
        "runIdHash": run_id_hash(run_id),
        "journalApiVersion": JOURNAL_API_VERSION,
        "status": status,
        "terminal": is_terminal_status(status),
        "eventCount": len(entries),
        "lastSequence": last.sequence,
        "graphRevision": last.graph_revision,
        "firstEventTimestamp": first.timestamp,
        "lastEventTimestamp": last.timestamp,
        "resumeCount": _count_type(entries, "RunResumed"),
        "pauseCount": _count_type(entries, "RunPaused"),
        "observedNodeCount": len(observed_nodes),
        "redaction": _redaction_block(),
    }


@dataclass(slots=True)
class _NodeObservation:
    event_count: int
    first_sequence: int
    last_sequence: int
    observed_max_attempt: int
    scheduled: bool
    started: bool
    succeeded: bool
    attempt_failures: int
    retries: int
    settled_without_attempt: bool


@dataclass(slots=True)
class _EdgeObservation:
    event_count: int
    first_sequence: int
    last_sequence: int


def inspect_data(run_id: str, entries: Sequence[JournalEntry]) -> dict[str, object]:
    status = project_status(entries)
    last = _require_entries(entries)

    type_counts: dict[str, int] = {}
    nodes: dict[str, _NodeObservation] = {}
    edges: dict[str, _EdgeObservation] = {}
    for entry in entries:
        type_counts[entry.type] = type_counts.get(entry.type, 0) + 1
        if entry.node_id is not None:
            observation = nodes.get(entry.node_id)
            if observation is None:
                observation = _NodeObservation(
                    event_count=0,
                    first_sequence=entry.sequence,
                    last_sequence=entry.sequence,
                    observed_max_attempt=0,
                    scheduled=False,
                    started=False,
                    succeeded=False,
                    attempt_failures=0,
                    retries=0,
                    settled_without_attempt=False,
                )
                nodes[entry.node_id] = observation
            observation.event_count += 1
            observation.last_sequence = entry.sequence
            if entry.attempt is not None and entry.attempt > observation.observed_max_attempt:
                observation.observed_max_attempt = entry.attempt
            if entry.type == "NodeScheduled":
                observation.scheduled = True
            if entry.type == "NodeStarted":
                observation.started = True
            if entry.type == "NodeSucceeded":
                observation.succeeded = True
            if entry.type == "NodeAttemptFailed":
                observation.attempt_failures += 1
            if entry.type == "NodeRetried":
                observation.retries += 1
            if entry.type == "NodeSettledWithoutAttempt":
                observation.settled_without_attempt = True
        if entry.edge_id is not None:
            edge = edges.get(entry.edge_id)
            if edge is None:
                edge = _EdgeObservation(
                    event_count=0,
                    first_sequence=entry.sequence,
                    last_sequence=entry.sequence,
                )
                edges[entry.edge_id] = edge
            edge.event_count += 1
            edge.last_sequence = entry.sequence

    event_type_counts = {
        event_type: type_counts[event_type]
        for event_type in JOURNAL_EVENT_TYPES
        if event_type in type_counts
    }

    return {
        "runId": run_id,
        "runIdHash": run_id_hash(run_id),
        "journalApiVersion": JOURNAL_API_VERSION,
        "status": status,
        "terminal": is_terminal_status(status),
        "eventCount": len(entries),
        "lastSequence": last.sequence,
        "graphRevision": last.graph_revision,
        "eventTypeCounts": event_type_counts,
        "observedNodes": [
            {
                "nodeId": node_id,
                "eventCount": nodes[node_id].event_count,
                "firstSequence": nodes[node_id].first_sequence,
                "lastSequence": nodes[node_id].last_sequence,
                "observedMaxAttempt": nodes[node_id].observed_max_attempt,
                "scheduled": nodes[node_id].scheduled,
                "started": nodes[node_id].started,
                "succeeded": nodes[node_id].succeeded,
                "attemptFailures": nodes[node_id].attempt_failures,
                "retries": nodes[node_id].retries,
                "settledWithoutAttempt": nodes[node_id].settled_without_attempt,
            }
            for node_id in sorted(nodes)
        ],
        "observedEdges": [
            {
                "edgeId": edge_id,
                "eventCount": edges[edge_id].event_count,
                "firstSequence": edges[edge_id].first_sequence,
                "lastSequence": edges[edge_id].last_sequence,
            }
            for edge_id in sorted(edges)
        ],
        "redaction": _redaction_block(),
    }


def logs_data(
    run_id: str,
    entries: Sequence[JournalEntry],
    from_sequence: int,
    limit: int,
) -> dict[str, object]:
    selected = [entry for entry in entries if entry.sequence >= from_sequence]
    window = selected[:limit]
    remaining = len(selected) - len(window)
    return {
        "runId": run_id,
        "runIdHash": run_id_hash(run_id),
        "journalApiVersion": JOURNAL_API_VERSION,
        "eventCount": len(entries),
        "fromSequence": from_sequence,
        "limit": limit,
        "returned": len(window),
        "truncated": remaining > 0,
        "nextSequence": window[-1].sequence + 1 if remaining > 0 and window else None,
        "events": [
            {
                "sequence": entry.sequence,
                "type": entry.type,
                "timestamp": entry.timestamp,
                "nodeId": entry.node_id,
                "edgeId": entry.edge_id,
                "attempt": entry.attempt,
                "redacted": entry.redacted,
            }
            for entry in window
        ],
        "redaction": _redaction_block(),
    }


__all__ = [
    "DEFAULT_LOG_LIMIT",
    "JOURNAL_API_VERSION",
    "JOURNAL_EVENT_TYPES",
    "MAX_JOURNAL_BYTES",
    "MAX_LOG_LIMIT",
    "MAX_SAFE_INTEGER",
    "UNSUPPORTED_OPERATIONS",
    "JournalEntry",
    "OperationError",
    "RunStatus",
    "UnsupportedOperation",
    "inspect_data",
    "is_safe_run_id",
    "is_terminal_status",
    "logs_data",
    "project_status",
    "read_journal",
    "run_id_hash",
    "status_data",
]
