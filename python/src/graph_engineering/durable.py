"""Event-sourced durable start and resume operations for the native scheduler."""

from __future__ import annotations

import asyncio
import re
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from types import MappingProxyType
from typing import Any, cast

from .canonical import canonical_sha256
from .compiler import (
    CompiledGraph,
    Diagnostic,
    DiagnosticCode,
    GraphCompileError,
    compile_graph,
)
from .durable_json import (
    DurableJsonError,
    decode_durable_json,
    durable_json_hash,
    encode_durable_json,
)
from .events import EventType, GraphEvent
from .models import MAX_SAFE_INTEGER, JsonValue, NodeSpec
from .persistence import EventStore, PersistenceError, VersionConflictError
from .portable_json import PortableJsonError, portable_json_snapshot
from .scheduler import (
    AsyncScheduler,
    FailureCode,
    NodeFailure,
    NodeHandler,
    NodeResult,
    NodeStatus,
    RunResult,
    RunStatus,
    _AttemptIdentity,
    _BindingError,
)

_CONTRACT_VERSION = "scheduler-recovery/v1alpha1"
_GRAPH_REVISION = 1
_RFC3339 = re.compile(
    r"^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])"
    r"T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?"
    r"(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$"
)

Clock = Callable[[], str]
EventIdFactory = Callable[[str, int], str]


class DurableRunErrorCode(StrEnum):
    RUN_NOT_FOUND = "RUN_NOT_FOUND"
    RUN_ALREADY_EXISTS = "RUN_ALREADY_EXISTS"
    GRAPH_HASH_MISMATCH = "GRAPH_HASH_MISMATCH"
    INPUT_HASH_MISMATCH = "INPUT_HASH_MISMATCH"
    IMPLEMENTATION_MISMATCH = "IMPLEMENTATION_MISMATCH"
    INVALID_RUN_HISTORY = "INVALID_RUN_HISTORY"
    NODE_EXECUTION_INTERRUPTED = "NODE_EXECUTION_INTERRUPTED"
    IN_DOUBT_SIDE_EFFECT = "IN_DOUBT_SIDE_EFFECT"
    RESUME_CONFLICT = "RESUME_CONFLICT"
    DURABILITY_STORE_FAILED = "DURABILITY_STORE_FAILED"


class DurableRunError(Exception):
    """A stable operational failure from durable run coordination."""

    def __init__(
        self,
        code: DurableRunErrorCode,
        run_id: str,
        message: str,
        details: Mapping[str, object] | None = None,
        *,
        cause: BaseException | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.run_id = run_id
        self.details = MappingProxyType(dict(details or {}))
        self.cause = cause

    def to_dict(self) -> dict[str, object]:
        return {
            "name": type(self).__name__,
            "code": self.code.value,
            "runId": self.run_id,
            "message": str(self),
            "details": dict(self.details),
        }


def _default_clock() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _default_event_id(run_id: str, sequence: int) -> str:
    return f"{run_id}:{sequence}"


def _side_effects(node: NodeSpec) -> str:
    return node.side_effects or "unspecified"


def _failure_document(failure: NodeFailure) -> dict[str, JsonValue]:
    if failure.code is FailureCode.OUTPUT_BINDING_FAILED:
        if failure.output_name is None:
            raise ValueError("output binding failure requires output_name")
        output_document: dict[str, JsonValue] = {
            "phase": "output",
            "code": failure.code.value,
            "message": failure.message,
            "outputName": failure.output_name,
            "nodeId": failure.node_id,
        }
        if failure.output_port is not None:
            output_document["port"] = failure.output_port
        return output_document

    document: dict[str, JsonValue] = {
        "phase": "execute",
        "code": failure.code.value,
        "message": failure.message,
        "nodeId": failure.node_id,
        "attempt": failure.attempt,
        "retryable": failure.retryable,
    }
    if failure.exception_type is not None:
        document["causeName"] = failure.exception_type
    if failure.upstream_nodes:
        document["upstreamNodeIds"] = list(failure.upstream_nodes)
    return document


def _node_result_document(result: NodeResult) -> dict[str, JsonValue]:
    document: dict[str, JsonValue] = {
        "nodeId": result.node_id,
        "sequence": result.sequence,
        "status": result.status.value,
        "attempts": result.attempts,
    }
    if result.input_bound:
        document["input"] = result.input
    if result.status is NodeStatus.SUCCEEDED:
        document["output"] = result.value
    if result.failure is not None:
        document["failure"] = _failure_document(result.failure)
    return document


def _run_result_document(result: RunResult) -> dict[str, JsonValue]:
    document: dict[str, JsonValue] = {
        "status": result.status.value,
        "graphHash": result.graph_hash,
        "nodes": [_node_result_document(item) for item in result.nodes.values()],
        "failures": [_failure_document(item) for item in result.failures],
        "scheduledOrder": list(result.scheduled_order),
        "completionOrder": list(result.completion_order),
        "maxObservedConcurrency": result.max_observed_concurrency,
        "totalAttempts": result.total_attempts,
    }
    if result.outputs is not None:
        document["output"] = dict(result.outputs)
    return cast(dict[str, JsonValue], portable_json_snapshot(document))


def _invalid_history(run_id: str, message: str, **details: object) -> DurableRunError:
    return DurableRunError(
        DurableRunErrorCode.INVALID_RUN_HISTORY,
        run_id,
        message,
        details,
    )


@dataclass(frozen=True, slots=True)
class _EventDraft:
    type: EventType
    data: dict[str, JsonValue]
    node_id: str | None = None
    edge_id: str | None = None
    attempt: int | None = None


class _DurableJournal:
    def __init__(
        self,
        *,
        graph: CompiledGraph,
        run_id: str,
        store: EventStore,
        version: int,
        clock: Clock,
        event_id_factory: EventIdFactory,
        pre_scheduled: Mapping[str, int] | None = None,
        activity_keys: Mapping[str, str] | None = None,
        prior_event_ids: Iterable[str] = (),
    ) -> None:
        self.graph = graph
        self.run_id = run_id
        self.store = store
        self.version = version
        self.clock = clock
        self.event_id_factory = event_id_factory
        self.pre_scheduled = dict(pre_scheduled or {})
        self.retry_available_at: dict[str, str] = {}
        self._activity_keys = dict(activity_keys or {})
        self._event_ids = set(prior_event_ids)
        self._lock = asyncio.Lock()
        self._fatal_error: BaseException | None = None

    def _event(self, draft: _EventDraft, sequence: int) -> GraphEvent:
        document: dict[str, Any] = {
            "apiVersion": "graphengineering.reacher-z.github.io/events/v1alpha1",
            "eventId": self.event_id_factory(self.run_id, sequence),
            "type": draft.type,
            "timestamp": self.clock(),
            "runId": self.run_id,
            "graphRevision": _GRAPH_REVISION,
            "sequence": sequence,
            "payloadHash": canonical_sha256(draft.data),
            "redacted": True,
            "data": draft.data,
        }
        if draft.node_id is not None:
            document["nodeId"] = draft.node_id
        if draft.edge_id is not None:
            document["edgeId"] = draft.edge_id
        if draft.attempt is not None:
            document["attempt"] = draft.attempt
        return GraphEvent.model_validate(document)

    async def append(
        self,
        drafts: list[_EventDraft],
        *,
        conflict_code: DurableRunErrorCode = DurableRunErrorCode.RESUME_CONFLICT,
    ) -> tuple[GraphEvent, ...]:
        async with self._lock:
            return await self._append_locked(drafts, conflict_code=conflict_code)

    async def _append_locked(
        self,
        drafts: list[_EventDraft],
        *,
        conflict_code: DurableRunErrorCode,
    ) -> tuple[GraphEvent, ...]:
        if self._fatal_error is not None:
            raise self._fatal_error
        expected_version = self.version
        try:
            events = tuple(
                self._event(draft, expected_version + index + 1)
                for index, draft in enumerate(drafts)
            )
            seen_ids = set(self._event_ids)
            duplicate_ids: set[str] = set()
            for event in events:
                if event.event_id in seen_ids:
                    duplicate_ids.add(event.event_id)
                seen_ids.add(event.event_id)
            if duplicate_ids:
                raise DurableRunError(
                    DurableRunErrorCode.DURABILITY_STORE_FAILED,
                    self.run_id,
                    "event id factory produced a duplicate durable event identity",
                    {"eventIds": sorted(duplicate_ids)},
                )
            returned_version = await self.store.append(
                self.run_id,
                expected_version,
                events,
            )
            required_version = expected_version + len(events)
            if type(returned_version) is not int or returned_version != required_version:
                raise DurableRunError(
                    DurableRunErrorCode.DURABILITY_STORE_FAILED,
                    self.run_id,
                    "durable event store returned an inconsistent stream version",
                    {
                        "expectedVersion": required_version,
                        "actualVersion": returned_version,
                    },
                )
        except VersionConflictError as exc:
            error = DurableRunError(
                conflict_code,
                self.run_id,
                "durable event append lost its expected-version comparison",
                exc.details,
                cause=exc,
            )
            self._fatal_error = error
            raise error from exc
        except PersistenceError as exc:
            error = DurableRunError(
                DurableRunErrorCode.DURABILITY_STORE_FAILED,
                self.run_id,
                "durable event append failed",
                {"persistenceCode": exc.code.value, **dict(exc.details)},
                cause=exc,
            )
            self._fatal_error = error
            raise error from exc
        except DurableRunError as exc:
            self._fatal_error = exc
            raise
        except Exception as exc:
            error = DurableRunError(
                DurableRunErrorCode.DURABILITY_STORE_FAILED,
                self.run_id,
                "durable event append failed",
                {"causeName": type(exc).__name__},
                cause=exc,
            )
            self._fatal_error = error
            raise error from exc
        except BaseException as exc:
            self._fatal_error = exc
            raise
        self.version = returned_version
        self._event_ids.update(event.event_id for event in events)
        return events

    def activity_key(self, node_id: str, input_hash: str) -> str:
        return durable_json_hash(
            ["activity/v1alpha1", self.run_id, _GRAPH_REVISION, node_id, input_hash]
        )

    async def before_attempt(
        self,
        node: NodeSpec,
        node_input: JsonValue,
        attempt: int,
    ) -> _AttemptIdentity:
        tagged_input = encode_durable_json(node_input)
        input_hash = durable_json_hash(node_input)
        activity_key = self.activity_key(node.id, input_hash)
        self._activity_keys[node.id] = activity_key
        drafts: list[_EventDraft] = []
        if self.pre_scheduled.pop(node.id, None) != attempt:
            drafts.append(
                _EventDraft(
                    "NodeScheduled",
                    {
                        "input": tagged_input,
                        "inputHash": input_hash,
                        "activityKey": activity_key,
                        "sideEffects": _side_effects(node),
                    },
                    node_id=node.id,
                    attempt=attempt,
                )
            )
        drafts.append(
            _EventDraft(
                "NodeStarted",
                {"inputHash": input_hash, "activityKey": activity_key},
                node_id=node.id,
                attempt=attempt,
            )
        )
        await self.append(drafts)
        return _AttemptIdentity(
            run_id=self.run_id,
            attempt_id=f"{self.run_id}/{node.id}/{attempt}",
            activity_key=activity_key,
        )

    async def attempt_failed(
        self,
        failure: NodeFailure,
        *,
        will_retry: bool,
        retry_delay_ms: float,
    ) -> int:
        async with self._lock:
            if self._fatal_error is not None:
                raise self._fatal_error
            available_at: str | None = None
            try:
                drafts = [
                    _EventDraft(
                        "NodeAttemptFailed",
                        {
                            "terminal": not will_retry,
                            "failure": _failure_document(failure),
                        },
                        node_id=failure.node_id,
                        attempt=failure.attempt,
                    )
                ]
                if will_retry:
                    node = self.graph.nodes[failure.node_id]
                    activity_key = self._activity_keys.get(failure.node_id, "")
                    if not activity_key:
                        raise _invalid_history(
                            self.run_id,
                            "cannot record a retry without its scheduled recovery identity",
                            nodeId=node.id,
                            attempt=failure.attempt,
                        )
                    available_at = _add_milliseconds(self.clock(), retry_delay_ms)
                    drafts.append(
                        _EventDraft(
                            "NodeRetried",
                            {"availableAt": available_at, "activityKey": activity_key},
                            node_id=failure.node_id,
                            attempt=failure.attempt + 1,
                        )
                    )
            except DurableRunError as exc:
                self._fatal_error = exc
                raise
            except Exception as exc:
                error = DurableRunError(
                    DurableRunErrorCode.DURABILITY_STORE_FAILED,
                    self.run_id,
                    "durable retry event could not be prepared",
                    {"causeName": type(exc).__name__},
                    cause=exc,
                )
                self._fatal_error = error
                raise error from exc
            except BaseException as exc:
                self._fatal_error = exc
                raise
            events = await self._append_locked(
                drafts,
                conflict_code=DurableRunErrorCode.RESUME_CONFLICT,
            )
            if available_at is not None:
                self.retry_available_at[failure.node_id] = available_at
            return events[0].sequence

    async def node_succeeded(
        self,
        node: NodeSpec,
        node_input: JsonValue,
        attempt: int,
        output: JsonValue,
    ) -> int:
        input_hash = durable_json_hash(node_input)
        tagged_output = encode_durable_json(output)
        output_hash = durable_json_hash(output)
        drafts = [
            _EventDraft(
                "NodeSucceeded",
                {
                    "inputHash": input_hash,
                    "output": tagged_output,
                    "outputHash": output_hash,
                },
                node_id=node.id,
                attempt=attempt,
            )
        ]
        drafts.extend(
            _EventDraft(
                "EdgeEmitted",
                {"outputHash": output_hash},
                node_id=node.id,
                edge_id=edge.id,
                attempt=attempt,
            )
            for edge in sorted(self.graph.outgoing[node.id], key=lambda item: item.id)
        )
        events = await self.append(drafts)
        return events[0].sequence

    async def node_settled_without_attempt(
        self,
        node: NodeSpec,
        result: NodeResult,
    ) -> int:
        events = await self.append(
            [
                _EventDraft(
                    "NodeSettledWithoutAttempt",
                    {"result": encode_durable_json(_node_result_document(result))},
                    node_id=node.id,
                )
            ]
        )
        return events[0].sequence

    async def run_terminal(self, result: RunResult) -> None:
        event_type = cast(
            EventType,
            {
                RunStatus.SUCCEEDED: "RunSucceeded",
                RunStatus.FAILED: "RunFailed",
                RunStatus.CANCELLED: "RunCancelled",
            }[result.status],
        )
        await self.append(
            [_EventDraft(event_type, {"result": encode_durable_json(_run_result_document(result))})]
        )


def _strict_rfc3339(value: str) -> datetime:
    if not _RFC3339.fullmatch(value):
        raise ValueError("timestamp must be strict RFC 3339 with a UTC offset")
    normalized = f"{value[:-1]}+00:00" if value.endswith("Z") else value
    parsed = datetime.fromisoformat(normalized)
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError("timestamp must include a UTC offset")
    return parsed


def _add_milliseconds(value: str, milliseconds: float) -> str:
    parsed = _strict_rfc3339(value) + timedelta(milliseconds=milliseconds)
    return parsed.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _object(value: object, run_id: str, context: str) -> dict[str, JsonValue]:
    if type(value) is not dict:
        raise _invalid_history(run_id, f"{context} must be an object")
    return cast(dict[str, JsonValue], value)


def _array(value: object, run_id: str, context: str) -> list[JsonValue]:
    if type(value) is not list:
        raise _invalid_history(run_id, f"{context} must be an array")
    return cast(list[JsonValue], value)


def _string(value: object, run_id: str, context: str) -> str:
    if type(value) is not str:
        raise _invalid_history(run_id, f"{context} must be a string")
    return value


def _integer(value: object, run_id: str, context: str, *, minimum: int = 0) -> int:
    if type(value) is not int or value < minimum or value > MAX_SAFE_INTEGER:
        raise _invalid_history(run_id, f"{context} must be a safe integer >= {minimum}")
    return value


def _exact_keys(
    value: Mapping[str, object],
    expected: set[str],
    run_id: str,
    context: str,
) -> None:
    if set(value) != expected:
        raise _invalid_history(
            run_id,
            f"{context} has unexpected fields",
            expected=sorted(expected),
            actual=sorted(value),
        )


def _decode_failure(value: object, run_id: str, context: str) -> NodeFailure:
    document = _object(value, run_id, context)
    phase = _string(document.get("phase"), run_id, f"{context}.phase")
    if phase == "output":
        required = {"phase", "code", "message", "outputName", "nodeId"}
        allowed = required | {"port"}
        if not required.issubset(document) or not set(document).issubset(allowed):
            raise _invalid_history(run_id, f"{context} has invalid output-failure fields")
        if document["code"] != FailureCode.OUTPUT_BINDING_FAILED.value:
            raise _invalid_history(run_id, f"{context} has invalid output-failure code")
        return NodeFailure(
            code=FailureCode.OUTPUT_BINDING_FAILED,
            message=_string(document["message"], run_id, f"{context}.message"),
            node_id=_string(document["nodeId"], run_id, f"{context}.nodeId"),
            attempt=0,
            output_name=_string(document["outputName"], run_id, f"{context}.outputName"),
            output_port=(
                _string(document["port"], run_id, f"{context}.port") if "port" in document else None
            ),
        )
    if phase != "execute":
        raise _invalid_history(run_id, f"{context}.phase must be 'execute' or 'output'")
    required = {"phase", "code", "message", "nodeId", "attempt", "retryable"}
    allowed = required | {"causeName", "upstreamNodeIds"}
    if not required.issubset(document) or not set(document).issubset(allowed):
        raise _invalid_history(run_id, f"{context} has invalid failure fields")
    try:
        code = FailureCode(_string(document["code"], run_id, f"{context}.code"))
    except ValueError as exc:
        raise _invalid_history(run_id, f"{context}.code is unknown") from exc
    if code is FailureCode.OUTPUT_BINDING_FAILED:
        raise _invalid_history(run_id, f"{context} uses an output code in execute phase")
    retryable = document["retryable"]
    if type(retryable) is not bool:
        raise _invalid_history(run_id, f"{context}.retryable must be a boolean")
    upstream: tuple[str, ...] = ()
    if "upstreamNodeIds" in document:
        upstream = tuple(
            _string(item, run_id, f"{context}.upstreamNodeIds")
            for item in _array(document["upstreamNodeIds"], run_id, context)
        )
        if len(upstream) != len(set(upstream)):
            raise _invalid_history(run_id, f"{context}.upstreamNodeIds contains duplicates")
    if code is FailureCode.UPSTREAM_FAILED:
        if not upstream:
            raise _invalid_history(run_id, f"{context} omits failed upstream nodes")
    elif "upstreamNodeIds" in document:
        raise _invalid_history(run_id, f"{context} has upstream nodes for a non-upstream failure")
    attempt = _integer(document["attempt"], run_id, f"{context}.attempt")
    return NodeFailure(
        code=code,
        message=_string(document["message"], run_id, f"{context}.message"),
        node_id=_string(document["nodeId"], run_id, f"{context}.nodeId"),
        attempt=attempt,
        retryable=retryable,
        exception_type=(
            _string(document["causeName"], run_id, f"{context}.causeName")
            if "causeName" in document
            else None
        ),
        upstream_nodes=upstream,
    )


def _decode_node_result(value: object, run_id: str, context: str) -> NodeResult:
    document = _object(value, run_id, context)
    required = {"nodeId", "sequence", "status", "attempts"}
    allowed = required | {"input", "output", "failure"}
    if not required.issubset(document) or not set(document).issubset(allowed):
        raise _invalid_history(run_id, f"{context} has invalid node-result fields")
    try:
        status = NodeStatus(_string(document["status"], run_id, f"{context}.status"))
    except ValueError as exc:
        raise _invalid_history(run_id, f"{context}.status is unknown") from exc
    node_id = _string(document["nodeId"], run_id, f"{context}.nodeId")
    attempts = _integer(document["attempts"], run_id, f"{context}.attempts")
    failure = (
        _decode_failure(document["failure"], run_id, f"{context}.failure")
        if "failure" in document
        else None
    )
    has_output = "output" in document
    if status is NodeStatus.SUCCEEDED:
        if not has_output or failure is not None:
            raise _invalid_history(run_id, f"{context} has an incoherent successful outcome")
    else:
        if has_output or failure is None:
            raise _invalid_history(run_id, f"{context} has an incoherent terminal failure")
        if failure.retryable:
            raise _invalid_history(run_id, f"{context} hides a retryable terminal outcome")
        if failure.node_id != node_id or failure.attempt != attempts:
            raise _invalid_history(run_id, f"{context} failure identity is inconsistent")
        if failure.code is FailureCode.OUTPUT_BINDING_FAILED:
            raise _invalid_history(run_id, f"{context} contains an output failure as a node result")
        skipped_codes = {FailureCode.UPSTREAM_FAILED, FailureCode.NODE_CANCELLED}
        if status is NodeStatus.SKIPPED and failure.code not in skipped_codes:
            raise _invalid_history(run_id, f"{context} has an invalid skipped-node failure")
        if status is NodeStatus.FAILED and failure.code is FailureCode.UPSTREAM_FAILED:
            raise _invalid_history(run_id, f"{context} reports an upstream skip as failed")
    return NodeResult(
        node_id=node_id,
        sequence=_integer(document["sequence"], run_id, f"{context}.sequence"),
        status=status,
        attempts=attempts,
        input=document.get("input"),
        value=document["output"] if has_output else None,
        failure=failure,
        input_bound="input" in document,
    )


def _decode_run_result(value: object, run_id: str, graph: CompiledGraph) -> RunResult:
    document = _object(value, run_id, "terminal result")
    required = {
        "status",
        "graphHash",
        "nodes",
        "failures",
        "scheduledOrder",
        "completionOrder",
        "maxObservedConcurrency",
        "totalAttempts",
    }
    if not required.issubset(document) or not set(document).issubset(required | {"output"}):
        raise _invalid_history(run_id, "terminal result has invalid fields")
    try:
        status = RunStatus(_string(document["status"], run_id, "terminal result.status"))
    except ValueError as exc:
        raise _invalid_history(run_id, "terminal result status is unknown") from exc
    graph_hash = _string(document["graphHash"], run_id, "terminal result.graphHash")
    if graph_hash != graph.graph_hash:
        raise _invalid_history(run_id, "terminal result graph hash is inconsistent")
    node_items = [
        _decode_node_result(item, run_id, f"terminal result.nodes[{index}]")
        for index, item in enumerate(_array(document["nodes"], run_id, "terminal nodes"))
    ]
    if [item.node_id for item in node_items] != list(graph.topological_order):
        raise _invalid_history(run_id, "terminal result nodes are not in topological order")
    failures = tuple(
        _decode_failure(item, run_id, f"terminal result.failures[{index}]")
        for index, item in enumerate(_array(document["failures"], run_id, "terminal failures"))
    )
    output: Mapping[str, JsonValue] | None = None
    if "output" in document:
        output = MappingProxyType(_object(document["output"], run_id, "terminal output"))
    return RunResult(
        status=status,
        graph_hash=graph_hash,
        nodes=MappingProxyType({item.node_id: item for item in node_items}),
        outputs=output,
        failures=failures,
        scheduled_order=tuple(
            _string(item, run_id, "terminal scheduled order")
            for item in _array(document["scheduledOrder"], run_id, "terminal scheduled order")
        ),
        completion_order=tuple(
            _string(item, run_id, "terminal completion order")
            for item in _array(document["completionOrder"], run_id, "terminal completion order")
        ),
        max_observed_concurrency=_integer(
            document["maxObservedConcurrency"],
            run_id,
            "terminal maxObservedConcurrency",
        ),
        total_attempts=_integer(document["totalAttempts"], run_id, "terminal totalAttempts"),
    )


@dataclass(slots=True)
class _NodeProjection:
    node_id: str
    input: JsonValue = None
    input_bound: bool = False
    input_hash: str | None = None
    activity_key: str | None = None
    side_effects: str | None = None
    scheduled_attempt: int | None = None
    open_attempt: int | None = None
    retry_attempt: int | None = None
    retry_available_at: str | None = None
    attempts: int = 0
    result: NodeResult | None = None
    output_hash: str | None = None


@dataclass(frozen=True, slots=True)
class _FoldedRun:
    graph_input: JsonValue
    graph_hash: str
    input_hash: str
    implementation_hash: str
    max_total_attempts: int
    projections: Mapping[str, _NodeProjection]
    total_attempts: int
    scheduled_order: tuple[str, ...]
    completion_order: tuple[str, ...]
    max_observed_concurrency: int
    terminal_result: RunResult | None
    version: int
    event_ids: frozenset[str]


def _terminal_outputs(
    graph: CompiledGraph,
    nodes: Mapping[str, NodeResult],
) -> tuple[Mapping[str, JsonValue] | None, tuple[NodeFailure, ...]]:
    output_values: dict[str, JsonValue] = {}
    failures: list[NodeFailure] = []
    complete = True
    for output_name in sorted(graph.spec.outputs):
        endpoint = graph.spec.outputs[output_name]
        result = nodes[endpoint.node]
        if result.status is not NodeStatus.SUCCEEDED:
            complete = False
            continue
        value = result.value
        if endpoint.port is not None:
            if type(value) is not dict or endpoint.port not in value:
                complete = False
                message = f"output from {endpoint.node!r} does not contain port {endpoint.port!r}"
                failures.append(
                    NodeFailure(
                        FailureCode.OUTPUT_BINDING_FAILED,
                        f"could not bind graph output {output_name!r}: {message}",
                        endpoint.node,
                        0,
                        output_name=output_name,
                        output_port=endpoint.port,
                    )
                )
                continue
            value = value[endpoint.port]
        output_values[output_name] = portable_json_snapshot(value)
    return (
        MappingProxyType(output_values) if complete else None,
        tuple(failures),
    )


def _same_failure_semantics(left: NodeFailure, right: NodeFailure) -> bool:
    """Compare portable failure facts while ignoring language-specific prose."""

    return (
        left.code is right.code
        and left.node_id == right.node_id
        and left.attempt == right.attempt
        and left.retryable is right.retryable
        and left.upstream_nodes == right.upstream_nodes
        and left.output_name == right.output_name
        and left.output_port == right.output_port
    )


def _same_node_result_semantics(left: NodeResult, right: NodeResult) -> bool:
    if (
        left.node_id != right.node_id
        or left.sequence != right.sequence
        or left.status is not right.status
        or left.attempts != right.attempts
        or left.input_bound is not right.input_bound
        or (left.input_bound and left.input != right.input)
        or left.value != right.value
        or (left.failure is None) != (right.failure is None)
    ):
        return False
    return left.failure is None or _same_failure_semantics(
        left.failure, cast(NodeFailure, right.failure)
    )


def _same_failure_sequence(
    left: tuple[NodeFailure, ...],
    right: tuple[NodeFailure, ...],
) -> bool:
    return len(left) == len(right) and all(
        _same_failure_semantics(item, expected) for item, expected in zip(left, right, strict=True)
    )


def _validate_terminal_result(
    *,
    run_id: str,
    event_type: EventType,
    terminal: RunResult,
    graph: CompiledGraph,
    projections: Mapping[str, _NodeProjection],
    folded_scheduled: tuple[str, ...],
    folded_completion: tuple[str, ...],
    max_observed_concurrency: int,
    total_attempts: int,
) -> None:
    expected_status = {
        "RunSucceeded": RunStatus.SUCCEEDED,
        "RunFailed": RunStatus.FAILED,
        "RunCancelled": RunStatus.CANCELLED,
    }[event_type]
    if terminal.status is not expected_status:
        raise _invalid_history(run_id, "terminal event and result status disagree")
    if terminal.total_attempts != total_attempts:
        raise _invalid_history(run_id, "terminal result attempt count is inconsistent")
    if terminal.max_observed_concurrency != max_observed_concurrency:
        raise _invalid_history(run_id, "terminal max concurrency contradicts event history")
    if any(item.open_attempt is not None for item in projections.values()):
        raise _invalid_history(run_id, "terminal event leaves an attempt open")

    expected_nodes: dict[str, NodeResult] = {}
    for index, node_id in enumerate(graph.topological_order):
        terminal_node = terminal.nodes[node_id]
        projection = projections[node_id]
        if terminal_node.sequence != index or terminal_node.attempts != projection.attempts:
            raise _invalid_history(
                run_id,
                "terminal node sequence or attempt count contradicts history",
                nodeId=node_id,
            )
        if projection.result is None:
            raise _invalid_history(
                run_id,
                "terminal result contains a node with no committed outcome",
                nodeId=node_id,
            )
        if not _same_node_result_semantics(terminal_node, projection.result):
            raise _invalid_history(
                run_id,
                "terminal result contradicts folded node history",
                nodeId=node_id,
            )
        expected_nodes[node_id] = projection.result

    expected_outputs, output_failures = _terminal_outputs(graph, expected_nodes)
    if (terminal.outputs is None) != (expected_outputs is None) or (
        terminal.outputs is not None
        and dict(terminal.outputs) != dict(cast(Mapping[str, JsonValue], expected_outputs))
    ):
        raise _invalid_history(run_id, "terminal output contradicts committed node outputs")
    expected_failures = (
        tuple(result.failure for result in expected_nodes.values() if result.failure is not None)
        + output_failures
    )
    if not _same_failure_sequence(terminal.failures, expected_failures):
        raise _invalid_history(run_id, "terminal failures contradict folded node outcomes")

    node_ids = set(graph.nodes)
    for name, order in (
        ("scheduledOrder", terminal.scheduled_order),
        ("completionOrder", terminal.completion_order),
    ):
        if len(order) != len(node_ids) or set(order) != node_ids:
            raise _invalid_history(run_id, f"terminal {name} is not a node permutation")
    if (
        terminal.scheduled_order != folded_scheduled
        or terminal.completion_order != folded_completion
    ):
        raise _invalid_history(run_id, "terminal node orders contradict folded history")

    succeeded = (
        not expected_failures
        and expected_outputs is not None
        and all(item.status is NodeStatus.SUCCEEDED for item in expected_nodes.values())
    )
    if terminal.status is RunStatus.SUCCEEDED and not succeeded:
        raise _invalid_history(run_id, "terminal status contradicts reconstructed graph result")
    if terminal.status is RunStatus.FAILED and succeeded:
        raise _invalid_history(run_id, "terminal status contradicts reconstructed graph result")


def _event_attempt(event: GraphEvent, run_id: str) -> int:
    if event.attempt is None:
        raise _invalid_history(run_id, f"{event.type} requires an attempt")
    return event.attempt


def _event_node(event: GraphEvent, graph: CompiledGraph, run_id: str) -> str:
    if event.node_id is None or event.node_id not in graph.nodes:
        raise _invalid_history(run_id, f"{event.type} references an unknown node")
    return event.node_id


def _max_node_attempts(node: NodeSpec) -> int:
    return node.retry.max_attempts if node.retry and node.retry.max_attempts else 1


def _bound_input_from_history(
    graph: CompiledGraph,
    node_id: str,
    graph_input: JsonValue,
    projections: Mapping[str, _NodeProjection],
    run_id: str,
) -> JsonValue:
    incoming = sorted(graph.incoming[node_id], key=lambda edge: edge.id)
    if not incoming:
        return portable_json_snapshot(graph_input)
    values: dict[str, JsonValue] = {}
    for edge in incoming:
        source = projections[edge.source.node].result
        if source is None or source.status is not NodeStatus.SUCCEEDED:
            raise _invalid_history(
                run_id,
                "NodeScheduled was emitted before every dependency succeeded",
                nodeId=node_id,
                sourceNodeId=edge.source.node,
            )
        value = source.value
        if edge.source.port is not None:
            if type(value) is not dict or edge.source.port not in value:
                raise _invalid_history(
                    run_id,
                    "NodeScheduled source port is absent from committed output",
                    nodeId=node_id,
                    sourceNodeId=edge.source.node,
                    port=edge.source.port,
                )
            value = value[edge.source.port]
        key = edge.target.port or edge.source.node
        if key in values:
            raise _invalid_history(
                run_id,
                "NodeScheduled input binding contains a duplicate target key",
                nodeId=node_id,
                key=key,
            )
        values[key] = value
    return portable_json_snapshot(values)


def _validate_settled_without_attempt(
    *,
    run_id: str,
    graph: CompiledGraph,
    graph_input: JsonValue,
    projections: Mapping[str, _NodeProjection],
    projection: _NodeProjection,
    result: NodeResult,
    total_attempts: int,
    max_total_attempts: int,
    retry_reservations: set[str],
) -> None:
    node_id = projection.node_id
    sequence = graph.topological_order.index(node_id)
    if (
        result.node_id != node_id
        or result.sequence != sequence
        or result.attempts != projection.attempts
        or result.status is NodeStatus.SUCCEEDED
        or result.failure is None
        or result.failure.node_id != node_id
        or result.failure.attempt != projection.attempts
    ):
        raise _invalid_history(
            run_id,
            "NodeSettledWithoutAttempt result identity is invalid",
            nodeId=node_id,
        )

    committed = {
        item_id: item.result for item_id, item in projections.items() if item.result is not None
    }
    incoming = graph.incoming[node_id]
    unresolved = sorted(
        {edge.source.node for edge in incoming if edge.source.node not in committed}
    )
    if unresolved:
        raise _invalid_history(
            run_id,
            "NodeSettledWithoutAttempt was emitted before every dependency settled",
            nodeId=node_id,
            unresolvedUpstreamNodeIds=unresolved,
        )
    failed_upstream = tuple(
        sorted(
            {
                edge.source.node
                for edge in incoming
                if committed[edge.source.node].status is not NodeStatus.SUCCEEDED
            }
        )
    )

    expected: NodeResult | None = None
    failure = result.failure
    if failure.code is FailureCode.NODE_CANCELLED:
        if result.status is NodeStatus.SKIPPED:
            expected = NodeResult(
                node_id=node_id,
                sequence=sequence,
                status=NodeStatus.SKIPPED,
                attempts=projection.attempts,
                failure=NodeFailure(
                    FailureCode.NODE_CANCELLED,
                    "node did not start because the run was cancelled",
                    node_id,
                    projection.attempts,
                ),
                input_bound=False,
            )
        else:
            try:
                node_input = AsyncScheduler._bind_input(
                    graph,
                    node_id,
                    graph_input,
                    cast(Mapping[str, NodeResult], committed),
                )
            except _BindingError as exc:
                raise _invalid_history(
                    run_id,
                    "cancelled node did not have bindable input",
                    nodeId=node_id,
                ) from exc
            expected = NodeResult(
                node_id=node_id,
                sequence=sequence,
                status=NodeStatus.FAILED,
                attempts=projection.attempts,
                input=node_input,
                failure=NodeFailure(
                    FailureCode.NODE_CANCELLED,
                    f"node {node_id!r} was cancelled",
                    node_id,
                    projection.attempts,
                ),
            )
    elif failed_upstream:
        expected = NodeResult(
            node_id=node_id,
            sequence=sequence,
            status=NodeStatus.SKIPPED,
            attempts=projection.attempts,
            failure=NodeFailure(
                FailureCode.UPSTREAM_FAILED,
                "node did not start because upstream dependencies failed",
                node_id,
                projection.attempts,
                upstream_nodes=failed_upstream,
            ),
            input_bound=False,
        )
    else:
        try:
            node_input = AsyncScheduler._bind_input(
                graph,
                node_id,
                graph_input,
                cast(Mapping[str, NodeResult], committed),
            )
        except _BindingError as exc:
            expected = NodeResult(
                node_id=node_id,
                sequence=sequence,
                status=NodeStatus.FAILED,
                attempts=projection.attempts,
                failure=NodeFailure(
                    FailureCode.INPUT_BINDING_FAILED,
                    f"could not bind input for node {node_id!r}: {exc}",
                    node_id,
                    projection.attempts,
                    exception_type=type(exc).__name__,
                ),
                input_bound=False,
            )
        else:
            node = graph.nodes[node_id]
            if failure.code is FailureCode.EXECUTOR_NOT_FOUND:
                expected_failure = NodeFailure(
                    FailureCode.EXECUTOR_NOT_FOUND,
                    f"no executor is registered for node {node_id!r} or kind {node.kind!r}",
                    node_id,
                    projection.attempts,
                )
            elif projection.attempts >= _max_node_attempts(node):
                expected_failure = NodeFailure(
                    FailureCode.ATTEMPT_BUDGET_EXHAUSTED,
                    f"node {node_id!r} has exhausted its durable attempt budget",
                    node_id,
                    projection.attempts,
                )
            elif (
                node_id not in retry_reservations
                and total_attempts + len(retry_reservations) >= max_total_attempts
            ):
                expected_failure = NodeFailure(
                    FailureCode.ATTEMPT_BUDGET_EXHAUSTED,
                    f"run attempt budget was exhausted before node {node_id!r} could start",
                    node_id,
                    projection.attempts,
                )
            else:
                expected_failure = None
            if expected_failure is not None:
                expected = NodeResult(
                    node_id=node_id,
                    sequence=sequence,
                    status=NodeStatus.FAILED,
                    attempts=projection.attempts,
                    input=node_input,
                    failure=expected_failure,
                )

    if expected is None or not _same_node_result_semantics(result, expected):
        raise _invalid_history(
            run_id,
            "NodeSettledWithoutAttempt result is not scheduler-derived",
            nodeId=node_id,
            code=failure.code.value,
        )


def _fold_history(
    events: tuple[GraphEvent, ...],
    *,
    graph: CompiledGraph,
    run_id: str,
    implementation_hash: str,
) -> _FoldedRun:
    if not events:
        raise DurableRunError(
            DurableRunErrorCode.RUN_NOT_FOUND,
            run_id,
            "durable run does not exist",
        )
    projections = {node_id: _NodeProjection(node_id) for node_id in graph.nodes}
    graph_input: JsonValue = None
    stored_graph_hash = ""
    stored_input_hash = ""
    stored_implementation_hash = ""
    max_total_attempts = 0
    started = False
    terminal_result: RunResult | None = None
    terminal_seen = False
    scheduled_order: list[str] = []
    completion_order: list[str] = []
    active: set[str] = set()
    max_observed = 0
    total_attempts = 0
    retry_reservations: set[str] = set()
    expected_edges: list[tuple[str, str, int, str]] = []
    expected_retry: tuple[str, int, str] | None = None
    declaration_order = {node_id: index for index, node_id in enumerate(graph.nodes)}
    event_ids: set[str] = set()

    for index, event in enumerate(events):
        if event.sequence != index or event.run_id != run_id:
            raise _invalid_history(run_id, "event identity or sequence is inconsistent")
        try:
            _strict_rfc3339(event.timestamp)
        except ValueError as exc:
            raise _invalid_history(
                run_id,
                "event timestamp is not strict RFC 3339",
                sequence=index,
            ) from exc
        if event.graph_revision != _GRAPH_REVISION:
            raise _invalid_history(run_id, "event graph revision is not 1", sequence=index)
        if event.event_id in event_ids:
            raise _invalid_history(
                run_id,
                "eventId is duplicated",
                eventId=event.event_id,
            )
        event_ids.add(event.event_id)
        if event.payload_hash is None or event.payload_hash != canonical_sha256(event.data):
            raise _invalid_history(run_id, "event payload hash is invalid", sequence=index)
        if terminal_seen:
            raise _invalid_history(run_id, "event appears after a terminal event", sequence=index)
        if event.type in {
            "RunCreated",
            "RunStarted",
            "RunResumed",
            "RunSucceeded",
            "RunFailed",
            "RunCancelled",
        } and (event.node_id is not None or event.edge_id is not None or event.attempt is not None):
            raise _invalid_history(
                run_id,
                f"{event.type} has unexpected node, edge, or attempt identity",
            )
        if (
            event.type
            in {
                "NodeScheduled",
                "NodeStarted",
                "NodeSucceeded",
                "NodeAttemptFailed",
                "NodeRetried",
                "NodeSettledWithoutAttempt",
            }
            and event.edge_id is not None
        ):
            raise _invalid_history(run_id, f"{event.type} has an edge identity")
        if event.type == "NodeSettledWithoutAttempt" and event.attempt is not None:
            raise _invalid_history(
                run_id,
                "NodeSettledWithoutAttempt has an attempt identity",
            )

        if expected_edges:
            edge_id, producer_id, attempt, output_hash = expected_edges.pop(0)
            if event.type != "EdgeEmitted" or event.edge_id != edge_id:
                raise _invalid_history(
                    run_id,
                    "NodeSucceeded is not followed by its ordered EdgeEmitted batch",
                    sequence=index,
                    expectedEdgeId=edge_id,
                )
            if event.node_id != producer_id or event.attempt != attempt:
                raise _invalid_history(run_id, "EdgeEmitted producer identity is invalid")
            _exact_keys(event.data, {"outputHash"}, run_id, "EdgeEmitted.data")
            if event.data["outputHash"] != output_hash:
                raise _invalid_history(run_id, "EdgeEmitted output hash is invalid")
            continue

        if expected_retry is not None:
            node_id, attempt, activity_key = expected_retry
            if event.type != "NodeRetried" or event.node_id != node_id or event.attempt != attempt:
                raise _invalid_history(
                    run_id,
                    "retryable NodeAttemptFailed is not followed by NodeRetried",
                    sequence=index,
                )
            _exact_keys(
                event.data,
                {"availableAt", "activityKey"},
                run_id,
                "NodeRetried.data",
            )
            available_at = _string(event.data["availableAt"], run_id, "availableAt")
            try:
                _strict_rfc3339(available_at)
            except ValueError as exc:
                raise _invalid_history(run_id, "NodeRetried.availableAt is invalid") from exc
            if event.data["activityKey"] != activity_key:
                raise _invalid_history(run_id, "NodeRetried activity key is invalid")
            projection = projections[node_id]
            if attempt > _max_node_attempts(graph.nodes[node_id]):
                raise _invalid_history(
                    run_id,
                    "NodeRetried exceeds the node retry budget",
                    nodeId=node_id,
                    attempt=attempt,
                )
            if node_id in retry_reservations:
                raise _invalid_history(run_id, "NodeRetried duplicates a retry reservation")
            if total_attempts + len(retry_reservations) >= max_total_attempts:
                raise _invalid_history(
                    run_id,
                    "NodeRetried is not eligible under the global attempt budget",
                    nodeId=node_id,
                    attempt=attempt,
                )
            projection.retry_attempt = attempt
            projection.retry_available_at = available_at
            retry_reservations.add(node_id)
            expected_retry = None
            continue

        if index == 0:
            if event.type != "RunCreated":
                raise _invalid_history(run_id, "RunCreated must be the first event")
            _exact_keys(
                event.data,
                {
                    "contractVersion",
                    "graphHash",
                    "implementationHash",
                    "input",
                    "inputHash",
                    "maxTotalAttempts",
                },
                run_id,
                "RunCreated.data",
            )
            if event.data["contractVersion"] != _CONTRACT_VERSION:
                raise _invalid_history(run_id, "RunCreated contract version is incompatible")
            stored_graph_hash = _string(event.data["graphHash"], run_id, "graphHash")
            stored_implementation_hash = _string(
                event.data["implementationHash"], run_id, "implementationHash"
            )
            stored_input_hash = _string(event.data["inputHash"], run_id, "inputHash")
            max_total_attempts = _integer(
                event.data["maxTotalAttempts"],
                run_id,
                "maxTotalAttempts",
                minimum=1,
            )
            try:
                graph_input = decode_durable_json(event.data["input"])
            except DurableJsonError as exc:
                raise DurableRunError(
                    DurableRunErrorCode.INPUT_HASH_MISMATCH,
                    run_id,
                    "stored graph input is not valid Durable JSON",
                    cause=exc,
                ) from exc
            if durable_json_hash(graph_input) != stored_input_hash:
                raise DurableRunError(
                    DurableRunErrorCode.INPUT_HASH_MISMATCH,
                    run_id,
                    "stored graph input does not match inputHash",
                )
            if stored_graph_hash != graph.graph_hash:
                raise DurableRunError(
                    DurableRunErrorCode.GRAPH_HASH_MISMATCH,
                    run_id,
                    "compiled graph does not match the durable run",
                    {"expected": stored_graph_hash, "actual": graph.graph_hash},
                )
            if stored_implementation_hash != implementation_hash:
                raise DurableRunError(
                    DurableRunErrorCode.IMPLEMENTATION_MISMATCH,
                    run_id,
                    "implementationId does not match the durable run",
                    {"expected": stored_implementation_hash, "actual": implementation_hash},
                )
            effective_limit = (
                graph.spec.policies.max_total_attempts
                if graph.spec.policies and graph.spec.policies.max_total_attempts is not None
                else MAX_SAFE_INTEGER
            )
            if max_total_attempts != effective_limit:
                raise _invalid_history(run_id, "stored attempt budget is inconsistent with graph")
            continue

        if event.type == "RunCreated":
            raise _invalid_history(run_id, "RunCreated appears more than once", sequence=index)
        if event.type == "RunStarted":
            if started or index != 1 or event.data:
                raise _invalid_history(run_id, "RunStarted is duplicate, misplaced, or non-empty")
            started = True
            continue
        if not started:
            raise _invalid_history(run_id, "lifecycle event appears before RunStarted")

        if event.type == "RunResumed":
            _exact_keys(
                event.data,
                {"reusedNodeIds", "interruptedNodeIds"},
                run_id,
                "RunResumed.data",
            )
            resume_lists: dict[str, list[str]] = {}
            for field_name in ("reusedNodeIds", "interruptedNodeIds"):
                node_ids = [
                    _string(item, run_id, field_name)
                    for item in _array(event.data[field_name], run_id, field_name)
                ]
                if any(node_id not in graph.nodes for node_id in node_ids):
                    raise _invalid_history(run_id, f"{field_name} contains an unknown node")
                if node_ids != sorted(node_ids, key=declaration_order.__getitem__):
                    raise _invalid_history(
                        run_id,
                        f"{field_name} is not in graph declaration order",
                    )
                if len(node_ids) != len(set(node_ids)):
                    raise _invalid_history(run_id, f"{field_name} contains duplicates")
                resume_lists[field_name] = node_ids
            if set(resume_lists["reusedNodeIds"]) & set(resume_lists["interruptedNodeIds"]):
                raise _invalid_history(run_id, "RunResumed node lists overlap")
            expected_reused: list[str] = []
            for node_id in graph.nodes:
                projected_result = projections[node_id].result
                if projected_result is not None and projected_result.status is NodeStatus.SUCCEEDED:
                    expected_reused.append(node_id)
            expected_interrupted = [
                node_id for node_id in graph.nodes if projections[node_id].open_attempt is not None
            ]
            if resume_lists["reusedNodeIds"] != expected_reused:
                raise _invalid_history(run_id, "RunResumed reusedNodeIds contradict history")
            if resume_lists["interruptedNodeIds"] != expected_interrupted:
                raise _invalid_history(
                    run_id,
                    "RunResumed interruptedNodeIds contradict history",
                )
            continue

        if event.type == "NodeSettledWithoutAttempt":
            node_id = _event_node(event, graph, run_id)
            projection = projections[node_id]
            if projection.open_attempt is not None or projection.result is not None:
                raise _invalid_history(
                    run_id,
                    "NodeSettledWithoutAttempt targets an open or settled node",
                    nodeId=node_id,
                )
            _exact_keys(
                event.data,
                {"result"},
                run_id,
                "NodeSettledWithoutAttempt.data",
            )
            try:
                decoded_result = decode_durable_json(event.data["result"])
            except DurableJsonError as exc:
                raise _invalid_history(
                    run_id,
                    "NodeSettledWithoutAttempt result is malformed",
                ) from exc
            result = _decode_node_result(
                decoded_result,
                run_id,
                "NodeSettledWithoutAttempt.result",
            )
            _validate_settled_without_attempt(
                run_id=run_id,
                graph=graph,
                graph_input=graph_input,
                projections=projections,
                projection=projection,
                result=result,
                total_attempts=total_attempts,
                max_total_attempts=max_total_attempts,
                retry_reservations=retry_reservations,
            )
            retry_reservations.discard(node_id)
            projection.retry_attempt = None
            projection.retry_available_at = None
            projection.result = result
            if node_id not in scheduled_order:
                scheduled_order.append(node_id)
            if node_id not in completion_order:
                completion_order.append(node_id)
            continue

        if event.type == "NodeScheduled":
            node_id = _event_node(event, graph, run_id)
            attempt = _event_attempt(event, run_id)
            projection = projections[node_id]
            if projection.result is not None or projection.open_attempt is not None:
                raise _invalid_history(run_id, "settled or running node was scheduled again")
            if projection.scheduled_attempt is not None and projection.retry_attempt is None:
                raise _invalid_history(run_id, "NodeScheduled is duplicated without a retry")
            owns_reservation = node_id in retry_reservations
            if (projection.retry_attempt is not None) is not owns_reservation:
                raise _invalid_history(
                    run_id,
                    "NodeScheduled retry reservation is inconsistent",
                    nodeId=node_id,
                )
            expected_attempt = projection.retry_attempt or projection.attempts + 1
            if attempt != expected_attempt:
                raise _invalid_history(run_id, "NodeScheduled attempt is non-contiguous")
            if attempt > _max_node_attempts(graph.nodes[node_id]):
                raise _invalid_history(
                    run_id,
                    "NodeScheduled exceeds the node retry budget",
                    nodeId=node_id,
                    attempt=attempt,
                )
            if (
                not owns_reservation
                and total_attempts + len(retry_reservations) >= max_total_attempts
            ):
                raise _invalid_history(
                    run_id,
                    "NodeScheduled is not eligible under the global attempt budget",
                    nodeId=node_id,
                    attempt=attempt,
                )
            _exact_keys(
                event.data,
                {"input", "inputHash", "activityKey", "sideEffects"},
                run_id,
                "NodeScheduled.data",
            )
            try:
                node_input = decode_durable_json(event.data["input"])
            except DurableJsonError as exc:
                raise _invalid_history(run_id, "NodeScheduled input is malformed") from exc
            input_hash = _string(event.data["inputHash"], run_id, "inputHash")
            if durable_json_hash(node_input) != input_hash:
                raise _invalid_history(run_id, "NodeScheduled inputHash is invalid")
            expected_input = _bound_input_from_history(
                graph,
                node_id,
                graph_input,
                projections,
                run_id,
            )
            if node_input != expected_input:
                raise _invalid_history(
                    run_id,
                    "NodeScheduled input does not match deterministic graph binding",
                    nodeId=node_id,
                    attempt=attempt,
                )
            if projection.attempts > 0 and node_input != projection.input:
                raise _invalid_history(
                    run_id,
                    "retry changed the original bound node input",
                    nodeId=node_id,
                    attempt=attempt,
                )
            activity_key = _string(event.data["activityKey"], run_id, "activityKey")
            expected_activity = durable_json_hash(
                ["activity/v1alpha1", run_id, _GRAPH_REVISION, node_id, input_hash]
            )
            if activity_key != expected_activity:
                raise _invalid_history(run_id, "NodeScheduled activityKey is invalid")
            side_effects = _string(event.data["sideEffects"], run_id, "sideEffects")
            if side_effects != _side_effects(graph.nodes[node_id]):
                raise _invalid_history(run_id, "NodeScheduled sideEffects is inconsistent")
            projection.input = node_input
            projection.input_bound = True
            projection.input_hash = input_hash
            projection.activity_key = activity_key
            projection.side_effects = side_effects
            projection.scheduled_attempt = attempt
            projection.retry_attempt = None
            if node_id not in scheduled_order:
                scheduled_order.append(node_id)
            continue

        if event.type == "NodeStarted":
            node_id = _event_node(event, graph, run_id)
            attempt = _event_attempt(event, run_id)
            projection = projections[node_id]
            if (
                projection.scheduled_attempt != attempt
                or projection.open_attempt is not None
                or projection.result is not None
                or projection.retry_attempt is not None
            ):
                raise _invalid_history(run_id, "NodeStarted lacks its required NodeScheduled")
            _exact_keys(event.data, {"inputHash", "activityKey"}, run_id, "NodeStarted.data")
            if (
                event.data["inputHash"] != projection.input_hash
                or event.data["activityKey"] != projection.activity_key
            ):
                raise _invalid_history(run_id, "NodeStarted recovery identity is invalid")
            if attempt > _max_node_attempts(graph.nodes[node_id]):
                raise _invalid_history(
                    run_id,
                    "NodeStarted exceeds the node retry budget",
                    nodeId=node_id,
                    attempt=attempt,
                )
            if node_id in retry_reservations:
                retry_reservations.remove(node_id)
            elif total_attempts + len(retry_reservations) >= max_total_attempts:
                raise _invalid_history(
                    run_id,
                    "NodeStarted is not eligible under the global attempt budget",
                    nodeId=node_id,
                    attempt=attempt,
                )
            projection.open_attempt = attempt
            projection.retry_available_at = None
            projection.scheduled_attempt = None
            projection.attempts = attempt
            total_attempts += 1
            if total_attempts + len(retry_reservations) > max_total_attempts:
                raise _invalid_history(run_id, "history exceeds the global attempt budget")
            active.add(node_id)
            policy_concurrency = (
                graph.spec.policies.max_concurrency if graph.spec.policies is not None else None
            )
            if policy_concurrency is not None and len(active) > policy_concurrency:
                raise _invalid_history(
                    run_id,
                    "history exceeds the graph concurrency policy",
                    maxConcurrency=policy_concurrency,
                    activeNodeIds=sorted(active, key=declaration_order.__getitem__),
                )
            max_observed = max(max_observed, len(active))
            continue

        if event.type == "NodeSucceeded":
            node_id = _event_node(event, graph, run_id)
            attempt = _event_attempt(event, run_id)
            projection = projections[node_id]
            if projection.open_attempt != attempt or projection.result is not None:
                raise _invalid_history(run_id, "NodeSucceeded lacks one open attempt")
            _exact_keys(
                event.data,
                {"inputHash", "output", "outputHash"},
                run_id,
                "NodeSucceeded.data",
            )
            if event.data["inputHash"] != projection.input_hash:
                raise _invalid_history(run_id, "NodeSucceeded inputHash is invalid")
            try:
                output = decode_durable_json(event.data["output"])
            except DurableJsonError as exc:
                raise _invalid_history(run_id, "NodeSucceeded output is malformed") from exc
            output_hash = _string(event.data["outputHash"], run_id, "outputHash")
            if durable_json_hash(output) != output_hash:
                raise _invalid_history(run_id, "NodeSucceeded outputHash is invalid")
            projection.output_hash = output_hash
            projection.open_attempt = None
            active.discard(node_id)
            projection.result = NodeResult(
                node_id=node_id,
                sequence=graph.topological_order.index(node_id),
                status=NodeStatus.SUCCEEDED,
                attempts=attempt,
                input=projection.input,
                value=output,
                input_bound=projection.input_bound,
            )
            if node_id not in completion_order:
                completion_order.append(node_id)
            expected_edges = [
                (edge.id, node_id, attempt, output_hash)
                for edge in sorted(graph.outgoing[node_id], key=lambda item: item.id)
            ]
            continue

        if event.type == "NodeAttemptFailed":
            node_id = _event_node(event, graph, run_id)
            attempt = _event_attempt(event, run_id)
            projection = projections[node_id]
            if projection.open_attempt != attempt or projection.result is not None:
                raise _invalid_history(run_id, "NodeAttemptFailed lacks one open attempt")
            _exact_keys(
                event.data,
                {"terminal", "failure"},
                run_id,
                "NodeAttemptFailed.data",
            )
            terminal = event.data["terminal"]
            if type(terminal) is not bool:
                raise _invalid_history(run_id, "NodeAttemptFailed.terminal must be boolean")
            failure = _decode_failure(event.data["failure"], run_id, "attempt failure")
            if failure.node_id != node_id or failure.attempt != attempt:
                raise _invalid_history(run_id, "attempt failure identity is invalid")
            allowed_attempt_codes = {
                FailureCode.NODE_EXECUTION_FAILED,
                FailureCode.NODE_TIMEOUT,
                FailureCode.NODE_CANCELLED,
                FailureCode.INVALID_OUTPUT,
                FailureCode.NODE_EXECUTION_INTERRUPTED,
            }
            if failure.code not in allowed_attempt_codes:
                raise _invalid_history(
                    run_id,
                    "NodeAttemptFailed uses a non-attempt outcome code",
                    nodeId=node_id,
                    code=failure.code.value,
                )
            if node_id in retry_reservations:
                raise _invalid_history(
                    run_id,
                    "open attempt retained a retry reservation",
                    nodeId=node_id,
                )
            retryable_codes = {
                FailureCode.NODE_EXECUTION_FAILED,
                FailureCode.NODE_TIMEOUT,
                FailureCode.INVALID_OUTPUT,
                FailureCode.NODE_EXECUTION_INTERRUPTED,
            }
            retry_is_safe = (
                failure.code is not FailureCode.NODE_EXECUTION_INTERRUPTED
                or projection.side_effects in {"none", "idempotent"}
            )
            should_retry = (
                failure.code in retryable_codes
                and retry_is_safe
                and attempt < _max_node_attempts(graph.nodes[node_id])
                and total_attempts + len(retry_reservations) < max_total_attempts
            )
            if terminal is should_retry or failure.retryable is not should_retry:
                raise _invalid_history(
                    run_id,
                    "attempt retryability contradicts deterministic eligibility",
                    nodeId=node_id,
                    attempt=attempt,
                    expectedRetryable=should_retry,
                )
            if failure.code is FailureCode.NODE_EXECUTION_INTERRUPTED and (
                failure.message != "process ended before the attempt outcome was durably recorded"
                or failure.exception_type != "ProcessLost"
            ):
                raise _invalid_history(
                    run_id,
                    "interrupted attempt failure is not canonical",
                    nodeId=node_id,
                    attempt=attempt,
                )
            if failure.code is FailureCode.NODE_CANCELLED and (not terminal or failure.retryable):
                raise _invalid_history(
                    run_id,
                    "cancelled attempt failure is not canonical",
                    nodeId=node_id,
                    attempt=attempt,
                )
            projection.open_attempt = None
            active.discard(node_id)
            if terminal:
                projection.result = NodeResult(
                    node_id=node_id,
                    sequence=graph.topological_order.index(node_id),
                    status=NodeStatus.FAILED,
                    attempts=attempt,
                    input=projection.input,
                    failure=failure,
                    input_bound=projection.input_bound,
                )
                if node_id not in completion_order:
                    completion_order.append(node_id)
            else:
                if projection.activity_key is None:
                    raise _invalid_history(run_id, "retry has no activity key")
                expected_retry = (node_id, attempt + 1, projection.activity_key)
            continue

        if event.type in {"RunSucceeded", "RunFailed", "RunCancelled"}:
            if retry_reservations:
                raise _invalid_history(
                    run_id,
                    "terminal event leaves retry reservations pending",
                    nodeIds=sorted(retry_reservations, key=declaration_order.__getitem__),
                )
            _exact_keys(event.data, {"result"}, run_id, f"{event.type}.data")
            try:
                decoded_result = decode_durable_json(event.data["result"])
            except DurableJsonError as exc:
                raise _invalid_history(run_id, "terminal result is malformed") from exc
            terminal_result = _decode_run_result(decoded_result, run_id, graph)
            _validate_terminal_result(
                run_id=run_id,
                event_type=event.type,
                terminal=terminal_result,
                graph=graph,
                projections=projections,
                folded_scheduled=tuple(scheduled_order),
                folded_completion=tuple(completion_order),
                max_observed_concurrency=max_observed,
                total_attempts=total_attempts,
            )
            terminal_seen = True
            continue

        raise _invalid_history(
            run_id,
            f"event type {event.type!r} is outside durable DAG recovery",
            sequence=index,
        )

    if expected_edges:
        raise _invalid_history(run_id, "event stream ends inside an EdgeEmitted batch")
    if expected_retry is not None:
        raise _invalid_history(run_id, "event stream ends before required NodeRetried")
    if not started:
        raise _invalid_history(run_id, "event stream omits RunStarted")
    return _FoldedRun(
        graph_input=graph_input,
        graph_hash=stored_graph_hash,
        input_hash=stored_input_hash,
        implementation_hash=stored_implementation_hash,
        max_total_attempts=max_total_attempts,
        projections=MappingProxyType(projections),
        total_attempts=total_attempts,
        scheduled_order=tuple(scheduled_order),
        completion_order=tuple(completion_order),
        max_observed_concurrency=max_observed,
        terminal_result=terminal_result,
        version=events[-1].sequence,
        event_ids=frozenset(event_ids),
    )


async def _read_history(store: EventStore, run_id: str) -> tuple[GraphEvent, ...]:
    try:
        return await store.read(run_id)
    except PersistenceError:
        # Corrupt bytes and invalid envelopes retain their persistence-layer
        # identity, as required by the recovery contract.
        raise
    except Exception as exc:
        raise DurableRunError(
            DurableRunErrorCode.DURABILITY_STORE_FAILED,
            run_id,
            "durable event history could not be read",
            {"causeName": type(exc).__name__},
            cause=exc,
        ) from exc


def _implementation_hash(implementation_id: str) -> str:
    if type(implementation_id) is not str or not implementation_id:
        raise ValueError("implementation_id must be a non-empty string")
    return durable_json_hash(implementation_id)


def _fresh_compiled_graph(graph: CompiledGraph) -> CompiledGraph:
    if not isinstance(graph, CompiledGraph):
        raise TypeError("graph must be a CompiledGraph")
    try:
        document = graph.spec.model_dump(
            mode="json",
            by_alias=True,
            exclude_unset=True,
        )
        snapshot = portable_json_snapshot(document)
    except Exception as exc:
        raise GraphCompileError(
            (
                Diagnostic(
                    DiagnosticCode.INVALID_GRAPH,
                    "compiled graph could not be snapshotted as portable JSON",
                ),
            )
        ) from exc
    if type(snapshot) is not dict:
        raise GraphCompileError(
            (
                Diagnostic(
                    DiagnosticCode.INVALID_GRAPH,
                    "compiled graph snapshot is not an object",
                ),
            )
        )
    return compile_graph(cast(Mapping[str, Any], snapshot))


def _effective_attempt_limit(graph: CompiledGraph) -> int:
    if graph.spec.policies and graph.spec.policies.max_total_attempts is not None:
        return graph.spec.policies.max_total_attempts
    return MAX_SAFE_INTEGER


def _remaining_delay(available_at: str, now: str) -> float:
    return max(
        0.0,
        (_strict_rfc3339(available_at) - _strict_rfc3339(now)).total_seconds(),
    )


async def start_graph_run(
    graph: CompiledGraph,
    graph_input: JsonValue,
    handlers: Mapping[str, NodeHandler] | None = None,
    *,
    run_id: str,
    implementation_id: str,
    event_store: EventStore,
    max_concurrency: int | None = None,
    cancel_event: asyncio.Event | None = None,
    clock: Clock | None = None,
    event_id_factory: EventIdFactory | None = None,
) -> RunResult:
    """Create and execute a new durable run; never silently resume one."""

    handler_snapshot = dict(handlers or {})
    graph = _fresh_compiled_graph(graph)
    implementation_hash = _implementation_hash(implementation_id)
    try:
        input_snapshot = portable_json_snapshot(graph_input)
    except PortableJsonError:
        raise TypeError("graph input must be a portable finite JSON value") from None
    if await _read_history(event_store, run_id):
        raise DurableRunError(
            DurableRunErrorCode.RUN_ALREADY_EXISTS,
            run_id,
            "durable run already exists",
        )
    input_hash = durable_json_hash(input_snapshot)
    journal = _DurableJournal(
        graph=graph,
        run_id=run_id,
        store=event_store,
        version=-1,
        clock=clock or _default_clock,
        event_id_factory=event_id_factory or _default_event_id,
    )
    await journal.append(
        [
            _EventDraft(
                "RunCreated",
                {
                    "contractVersion": _CONTRACT_VERSION,
                    "graphHash": graph.graph_hash,
                    "implementationHash": implementation_hash,
                    "input": encode_durable_json(input_snapshot),
                    "inputHash": input_hash,
                    "maxTotalAttempts": _effective_attempt_limit(graph),
                },
            ),
            _EventDraft("RunStarted", {}),
        ],
        conflict_code=DurableRunErrorCode.RUN_ALREADY_EXISTS,
    )
    scheduler = AsyncScheduler(handler_snapshot, max_concurrency=max_concurrency)
    return await scheduler._run(
        graph,
        input_snapshot,
        cancel_event=cancel_event,
        journal=journal,
    )


async def resume_graph_run(
    graph: CompiledGraph,
    handlers: Mapping[str, NodeHandler] | None = None,
    *,
    run_id: str,
    implementation_id: str,
    event_store: EventStore,
    max_concurrency: int | None = None,
    cancel_event: asyncio.Event | None = None,
    clock: Clock | None = None,
    event_id_factory: EventIdFactory | None = None,
) -> RunResult:
    """Resume one non-terminal durable history without replacing its input."""

    handler_snapshot = dict(handlers or {})
    graph = _fresh_compiled_graph(graph)
    implementation_hash = _implementation_hash(implementation_id)
    events = await _read_history(event_store, run_id)
    folded = _fold_history(
        events,
        graph=graph,
        run_id=run_id,
        implementation_hash=implementation_hash,
    )
    if folded.terminal_result is not None:
        return folded.terminal_result
    for node_id, projection in folded.projections.items():
        if (
            projection.result is not None
            and projection.result.failure is not None
            and projection.result.failure.code is FailureCode.NODE_EXECUTION_INTERRUPTED
            and projection.side_effects not in {"none", "idempotent"}
        ):
            raise DurableRunError(
                DurableRunErrorCode.IN_DOUBT_SIDE_EFFECT,
                run_id,
                "an interrupted node remains blocked on unsafe side-effect reconciliation",
                {
                    "nodeId": node_id,
                    "attempt": projection.result.attempts,
                    "sideEffects": projection.side_effects or "unspecified",
                },
            )

    effective_clock = clock or _default_clock
    journal = _DurableJournal(
        graph=graph,
        run_id=run_id,
        store=event_store,
        version=folded.version,
        clock=effective_clock,
        event_id_factory=event_id_factory or _default_event_id,
        pre_scheduled={
            node_id: projection.scheduled_attempt
            for node_id, projection in folded.projections.items()
            if projection.scheduled_attempt is not None
            and projection.open_attempt is None
            and projection.retry_attempt is None
            and projection.result is None
        },
        activity_keys={
            node_id: projection.activity_key
            for node_id, projection in folded.projections.items()
            if projection.activity_key is not None
        },
        prior_event_ids=folded.event_ids,
    )
    declaration_order = {node_id: index for index, node_id in enumerate(graph.nodes)}
    interrupted = sorted(
        [
            node_id
            for node_id, projection in folded.projections.items()
            if projection.open_attempt is not None
        ],
        key=declaration_order.__getitem__,
    )
    reused = sorted(
        [
            node_id
            for node_id, projection in folded.projections.items()
            if projection.result is not None and projection.result.status is NodeStatus.SUCCEEDED
        ],
        key=declaration_order.__getitem__,
    )
    await journal.append(
        [
            _EventDraft(
                "RunResumed",
                {
                    "reusedNodeIds": [cast(JsonValue, item) for item in reused],
                    "interruptedNodeIds": [cast(JsonValue, item) for item in interrupted],
                },
            )
        ]
    )
    initial_results = {
        node_id: projection.result
        for node_id, projection in folded.projections.items()
        if projection.result is not None
    }
    total_attempts = folded.total_attempts
    retry_delays = {
        node_id: _remaining_delay(
            projection.retry_available_at,
            effective_clock(),
        )
        for node_id, projection in folded.projections.items()
        if (
            projection.retry_available_at is not None
            and projection.open_attempt is None
            and projection.result is None
        )
    }
    initial_completion_order = list(folded.completion_order)

    for node_id in interrupted:
        projection = folded.projections[node_id]
        attempt = cast(int, projection.open_attempt)
        side_effects = projection.side_effects or "unspecified"
        node = graph.nodes[node_id]
        max_attempts = node.retry.max_attempts if node.retry and node.retry.max_attempts else 1
        automatic = side_effects in {"none", "idempotent"}
        can_retry = (
            automatic
            and attempt < max_attempts
            and total_attempts + len(retry_delays) < folded.max_total_attempts
        )
        interrupted_failure = NodeFailure(
            FailureCode.NODE_EXECUTION_INTERRUPTED,
            "process ended before the attempt outcome was durably recorded",
            node_id,
            attempt,
            retryable=can_retry,
            exception_type="ProcessLost",
        )
        retry_delay_ms = AsyncScheduler._retry_delay_ms(node, attempt) if can_retry else 0.0
        await journal.attempt_failed(
            interrupted_failure,
            will_retry=can_retry,
            retry_delay_ms=retry_delay_ms,
        )
        if not automatic:
            raise DurableRunError(
                DurableRunErrorCode.IN_DOUBT_SIDE_EFFECT,
                run_id,
                "an interrupted node may have produced an unsafe external effect",
                {"nodeId": node_id, "attempt": attempt, "sideEffects": side_effects},
            )
        if not can_retry:
            initial_results[node_id] = NodeResult(
                node_id=node_id,
                sequence=graph.topological_order.index(node_id),
                status=NodeStatus.FAILED,
                attempts=attempt,
                input=projection.input,
                failure=interrupted_failure,
                input_bound=projection.input_bound,
            )
            if node_id not in initial_completion_order:
                initial_completion_order.append(node_id)
        else:
            available_at = journal.retry_available_at[node_id]
            retry_delays[node_id] = _remaining_delay(available_at, effective_clock())

    scheduler = AsyncScheduler(handler_snapshot, max_concurrency=max_concurrency)
    return await scheduler._run(
        graph,
        folded.graph_input,
        cancel_event=cancel_event,
        journal=journal,
        initial_results=cast(Mapping[str, NodeResult], initial_results),
        attempt_offsets={
            node_id: projection.attempts for node_id, projection in folded.projections.items()
        },
        initial_total_attempts=total_attempts,
        initial_scheduled_order=folded.scheduled_order,
        initial_completion_order=tuple(initial_completion_order),
        initial_max_observed_concurrency=folded.max_observed_concurrency,
        initial_retry_delays=retry_delays,
    )
