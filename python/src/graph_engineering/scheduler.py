"""Deterministic ready-queue scheduler for compiled acyclic graphs."""

from __future__ import annotations

import asyncio
import inspect
import re
from collections.abc import Awaitable, Callable, Mapping
from contextlib import suppress
from dataclasses import dataclass
from enum import StrEnum
from types import MappingProxyType
from typing import Protocol

from .compiler import CompiledGraph, compile_graph
from .models import MAX_SAFE_INTEGER, EdgeSpec, Endpoint, GraphSpec, JsonValue, NodeSpec
from .portable_json import PortableJsonError, portable_json_snapshot
from .primitives.router import evaluate_route_selection

_ROUTE_CONDITION_API_VERSION = "graphengineering.reacher-z.github.io/pattern-conditions/v1alpha1"
_ROUTE_CONDITION_FIELDS = frozenset({"apiVersion", "kind", "routeKey"})
_ROUTE_RESULT_FIELDS = frozenset(
    {
        "routed",
        "reasonCode",
        "requestedRoutes",
        "selectedRoutes",
        "unknownRoutes",
        "confidenceBasisPoints",
        "usedDefault",
        "escalated",
    }
)
_ROUTE_REASON_CODES = frozenset(
    {
        "REQUESTED_ROUTES_SELECTED",
        "DEFAULT_SELECTED_NO_REQUEST",
        "DEFAULT_SELECTED_UNKNOWN_ROUTE",
        "ESCALATION_SELECTED_LOW_CONFIDENCE",
        "NO_REQUESTED_ROUTE",
        "UNKNOWN_ROUTE",
        "MULTIPLE_ROUTES_FOR_SINGLE",
        "MULTICAST_LIMIT_EXCEEDED",
    }
)
_SAFE_ROUTE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


class NodeStatus(StrEnum):
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    SKIPPED = "skipped"


class RunStatus(StrEnum):
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"


class FailureCode(StrEnum):
    EXECUTOR_NOT_FOUND = "EXECUTOR_NOT_FOUND"
    NODE_EXECUTION_FAILED = "NODE_EXECUTION_FAILED"
    NODE_TIMEOUT = "NODE_TIMEOUT"
    NODE_CANCELLED = "NODE_CANCELLED"
    INVALID_OUTPUT = "INVALID_OUTPUT"
    UPSTREAM_FAILED = "UPSTREAM_FAILED"
    INPUT_BINDING_FAILED = "INPUT_BINDING_FAILED"
    OUTPUT_BINDING_FAILED = "OUTPUT_BINDING_FAILED"
    ATTEMPT_BUDGET_EXHAUSTED = "ATTEMPT_BUDGET_EXHAUSTED"
    NODE_EXECUTION_INTERRUPTED = "NODE_EXECUTION_INTERRUPTED"
    INVALID_ROUTE_SELECTION = "INVALID_ROUTE_SELECTION"
    UNSUPPORTED_EDGE_CONDITION = "UNSUPPORTED_EDGE_CONDITION"
    ROUTE_NOT_SELECTED = "ROUTE_NOT_SELECTED"


@dataclass(frozen=True, slots=True)
class NodeFailure:
    code: FailureCode
    message: str
    node_id: str
    attempt: int
    retryable: bool = False
    exception_type: str | None = None
    upstream_nodes: tuple[str, ...] = ()
    output_name: str | None = None
    output_port: str | None = None


@dataclass(frozen=True, slots=True)
class NodeResult:
    node_id: str
    sequence: int
    status: NodeStatus
    attempts: int
    input: JsonValue = None
    value: JsonValue = None
    failure: NodeFailure | None = None
    # JSON null is a valid bound input, so durable recovery needs a separate
    # presence bit for outcomes that settled before input binding completed.
    input_bound: bool = True

    @property
    def succeeded(self) -> bool:
        return self.status is NodeStatus.SUCCEEDED


class CancellationSignal:
    """Read-only view of a caller-owned :class:`asyncio.Event`."""

    __slots__ = ("__event",)

    def __init__(self, event: asyncio.Event) -> None:
        self.__event = event

    @property
    def cancelled(self) -> bool:
        return self.__event.is_set()

    def is_set(self) -> bool:
        return self.__event.is_set()

    async def wait(self) -> None:
        await self.__event.wait()


@dataclass(frozen=True, slots=True)
class NodeContext:
    """Explicit, read-only data passed to one node attempt."""

    graph: GraphSpec
    node: NodeSpec
    input: JsonValue
    graph_input: JsonValue
    inputs: Mapping[str, JsonValue]
    completed: Mapping[str, JsonValue]
    attempt: int
    cancel_signal: CancellationSignal
    run_id: str | None = None
    attempt_id: str | None = None
    idempotency_key: str | None = None
    activity_key: str | None = None


@dataclass(frozen=True, slots=True)
class RunResult:
    status: RunStatus
    graph_hash: str
    nodes: Mapping[str, NodeResult]
    outputs: Mapping[str, JsonValue] | None
    failures: tuple[NodeFailure, ...]
    scheduled_order: tuple[str, ...]
    completion_order: tuple[str, ...]
    max_observed_concurrency: int
    total_attempts: int

    @property
    def succeeded(self) -> bool:
        return self.status is RunStatus.SUCCEEDED


NodeHandler = Callable[[NodeContext], JsonValue | Awaitable[JsonValue]]


@dataclass(frozen=True, slots=True)
class _AttemptIdentity:
    run_id: str
    attempt_id: str
    activity_key: str
    scheduled_ordinal: int | None = None


class _SchedulerJournal(Protocol):
    async def before_attempt(
        self,
        node: NodeSpec,
        node_input: JsonValue,
        attempt: int,
    ) -> _AttemptIdentity: ...

    async def attempt_failed(
        self,
        failure: NodeFailure,
        *,
        will_retry: bool,
        retry_delay_ms: float,
    ) -> int: ...

    async def node_succeeded(
        self,
        node: NodeSpec,
        node_input: JsonValue,
        attempt: int,
        output: JsonValue,
    ) -> int: ...

    async def node_settled_without_attempt(
        self,
        node: NodeSpec,
        result: NodeResult,
    ) -> int: ...

    async def run_terminal(self, result: RunResult) -> None: ...


class _BindingError(ValueError):
    pass


class _InvalidRouteSelectionError(_BindingError):
    pass


class _UnsupportedEdgeConditionError(_BindingError):
    pass


class _InvalidOutputError(TypeError):
    pass


class _NodeCancelled(Exception):
    pass


class _HandlerCancelled(Exception):
    pass


def _consume_background_task_outcome(task: asyncio.Task[NodeResult]) -> None:
    """Observe a detached durable task so a late failure is never unhandled."""

    if task.cancelled():
        return
    with suppress(asyncio.CancelledError):
        _ = task.exception()


def _snapshot_node_output(value: object) -> JsonValue:
    try:
        return portable_json_snapshot(value)
    except PortableJsonError as exc:
        raise _InvalidOutputError(
            "node returned a value that is not a portable finite JSON value"
        ) from exc


def _snapshot_context_graph(graph: GraphSpec) -> GraphSpec:
    document = portable_json_snapshot(
        graph.model_dump(mode="json", by_alias=True, exclude_unset=True)
    )
    if type(document) is not dict:
        raise AssertionError("graph context snapshot must be an object")
    return GraphSpec.model_validate(document)


def _snapshot_compiled_graph(graph: CompiledGraph) -> CompiledGraph:
    return compile_graph(_snapshot_context_graph(graph.spec))


async def _resolve_node_output(value: Awaitable[JsonValue]) -> JsonValue:
    """Snapshot an async handler result before its task yields completion."""

    return _snapshot_node_output(await value)


def _identity_handler(context: NodeContext) -> JsonValue:
    return context.input


def _router_handler(context: NodeContext) -> JsonValue:
    """Apply the pure route evaluator when a router has no custom executor."""

    try:
        return evaluate_route_selection(context.input, context.node.config).to_dict()
    except Exception as exc:
        raise _InvalidRouteSelectionError("router input or policy is invalid") from exc


def _is_route_skip(result: NodeResult) -> bool:
    return (
        result.status is NodeStatus.SKIPPED
        and result.failure is not None
        and result.failure.code is FailureCode.ROUTE_NOT_SELECTED
    )


def _route_key(edge: EdgeSpec, graph: CompiledGraph) -> str | None:
    condition = edge.condition
    if condition is None:
        return None
    if type(condition) is not dict or set(condition) != _ROUTE_CONDITION_FIELDS:
        raise _UnsupportedEdgeConditionError(
            f"Edge {edge.id!r} has an unsupported or malformed condition"
        )
    if (
        condition.get("apiVersion") != _ROUTE_CONDITION_API_VERSION
        or condition.get("kind") != "RouteEquals"
    ):
        raise _UnsupportedEdgeConditionError(
            f"Edge {edge.id!r} has an unsupported or malformed condition"
        )
    route_key = condition.get("routeKey")
    if (
        not isinstance(route_key, str)
        or type(route_key) is not str
        or _SAFE_ROUTE_ID.fullmatch(route_key) is None
        or route_key in {".", ".."}
    ):
        raise _UnsupportedEdgeConditionError(
            f"Edge {edge.id!r} has an unsupported or malformed condition"
        )
    if graph.nodes[edge.source.node].kind != "router":
        raise _UnsupportedEdgeConditionError(
            f"Edge {edge.id!r} uses RouteEquals but source {edge.source.node!r} is not a router"
        )
    return route_key


def _route_array(output: dict[str, JsonValue], name: str, node_id: str) -> list[str]:
    value = output[name]
    if type(value) is not list:
        raise _InvalidRouteSelectionError(f"router {node_id!r} output has invalid {name}")
    routes: list[str] = []
    for item in value:
        if (
            not isinstance(item, str)
            or type(item) is not str
            or _SAFE_ROUTE_ID.fullmatch(item) is None
            or item in {".", ".."}
        ):
            raise _InvalidRouteSelectionError(f"router {node_id!r} output has invalid {name}")
        routes.append(item)
    if len(routes) != len(set(routes)):
        raise _InvalidRouteSelectionError(f"router {node_id!r} output has duplicate {name}")
    return routes


def _selected_routes(
    value: JsonValue,
    node: NodeSpec,
    authoritative_request: JsonValue,
) -> frozenset[str]:
    node_id = node.id
    if type(value) is not dict or set(value) != _ROUTE_RESULT_FIELDS:
        raise _InvalidRouteSelectionError(
            f"router {node_id!r} output is not an exact RouteSelectionResult"
        )
    requested = _route_array(value, "requestedRoutes", node_id)
    selected = _route_array(value, "selectedRoutes", node_id)
    unknown = _route_array(value, "unknownRoutes", node_id)
    if any(route not in requested for route in unknown):
        raise _InvalidRouteSelectionError(
            f"router {node_id!r} output has unknownRoutes outside requestedRoutes"
        )
    confidence = value["confidenceBasisPoints"]
    if confidence is not None and (
        type(confidence) is not int or confidence < 0 or confidence > 10_000
    ):
        raise _InvalidRouteSelectionError(
            f"router {node_id!r} output has invalid confidenceBasisPoints"
        )
    routed = value["routed"]
    used_default = value["usedDefault"]
    escalated = value["escalated"]
    if type(routed) is not bool or type(used_default) is not bool or type(escalated) is not bool:
        raise _InvalidRouteSelectionError(f"router {node_id!r} output has invalid decision flags")
    if routed is not bool(selected):
        raise _InvalidRouteSelectionError(
            f"router {node_id!r} output violates routed/selectedRoutes invariance"
        )
    reason = value["reasonCode"]
    if type(reason) is not str or reason not in _ROUTE_REASON_CODES:
        raise _InvalidRouteSelectionError(f"router {node_id!r} output has invalid reasonCode")
    try:
        expected = evaluate_route_selection(authoritative_request, node.config).to_dict()
    except Exception as exc:
        raise _InvalidRouteSelectionError(
            f"router {node_id!r} output cannot be verified against its policy"
        ) from exc
    if value != expected:
        raise _InvalidRouteSelectionError(
            f"router {node_id!r} output contradicts its deterministic policy decision"
        )
    return frozenset(selected)


def _active_incoming_edges(
    graph: CompiledGraph,
    node_id: str,
    results: Mapping[str, NodeResult],
) -> tuple[EdgeSpec, ...]:
    """Return the dependencies selected by recorded router node outputs."""

    active: list[EdgeSpec] = []
    for edge in graph.incoming[node_id]:
        source = results[edge.source.node]
        if (
            source.failure is not None
            and source.failure.code is FailureCode.UNSUPPORTED_EDGE_CONDITION
        ):
            active.append(edge)
            continue
        route_key = _route_key(edge, graph)
        if route_key is None:
            if not _is_route_skip(source):
                active.append(edge)
            continue
        if source.status is not NodeStatus.SUCCEEDED:
            active.append(edge)
            continue
        if not source.input_bound:
            raise _InvalidRouteSelectionError(
                f"router {edge.source.node!r} result has no authoritative input"
            )
        selected = _selected_routes(
            source.value,
            graph.nodes[edge.source.node],
            source.input,
        )
        if route_key in selected:
            active.append(edge)
    return tuple(active)


def _unsupported_condition_sources(graph: CompiledGraph) -> dict[str, str]:
    messages: dict[str, list[str]] = {}
    for edge in sorted(graph.spec.edges, key=lambda item: item.id):
        try:
            _route_key(edge, graph)
        except _UnsupportedEdgeConditionError as exc:
            messages.setdefault(edge.source.node, []).append(str(exc))
    return {node_id: "; ".join(items) for node_id, items in messages.items()}


def _endpoint_value(endpoint: Endpoint, value: JsonValue) -> JsonValue:
    if endpoint.port is None:
        return value
    if not isinstance(value, dict) or endpoint.port not in value:
        raise _BindingError(
            f"output from {endpoint.node!r} does not contain port {endpoint.port!r}"
        )
    return value[endpoint.port]


async def _acquire_attempt_slot(
    semaphore: asyncio.Semaphore,
    signal: CancellationSignal,
) -> bool:
    """Acquire a permit or return immediately when cancellation wins."""

    if signal.cancelled:
        return False
    acquire_task = asyncio.create_task(semaphore.acquire())
    cancel_task = asyncio.create_task(signal.wait())
    granted = False
    try:
        await asyncio.wait(
            (acquire_task, cancel_task),
            return_when=asyncio.FIRST_COMPLETED,
        )
        if signal.cancelled:
            return False
        await acquire_task
        granted = True
        return True
    finally:
        if not granted:
            if acquire_task.done() and not acquire_task.cancelled():
                acquired: bool
                try:
                    acquired = acquire_task.result()
                except Exception:
                    acquired = False
                if acquired:
                    semaphore.release()
            else:
                acquire_task.cancel()
        if not cancel_task.done():
            cancel_task.cancel()
        await asyncio.gather(acquire_task, cancel_task, return_exceptions=True)


async def _delay_or_cancel(seconds: float, signal: CancellationSignal) -> bool:
    """Return ``False`` if cancellation interrupts the delay."""

    if signal.cancelled:
        return False
    delay_task = asyncio.create_task(asyncio.sleep(seconds))
    cancel_task = asyncio.create_task(signal.wait())
    try:
        await asyncio.wait((delay_task, cancel_task), return_when=asyncio.FIRST_COMPLETED)
        return not signal.cancelled
    finally:
        for task in (delay_task, cancel_task):
            if not task.done():
                task.cancel()
        await asyncio.gather(delay_task, cancel_task, return_exceptions=True)


def _cancelled_result(
    node_id: str,
    sequence: int,
    attempts: int,
    *,
    status: NodeStatus,
    node_input: JsonValue = None,
    input_bound: bool = True,
) -> NodeResult:
    return NodeResult(
        node_id=node_id,
        sequence=sequence,
        status=status,
        attempts=attempts,
        input=node_input,
        input_bound=input_bound,
        failure=NodeFailure(
            FailureCode.NODE_CANCELLED,
            f"node {node_id!r} was cancelled",
            node_id,
            attempts,
        ),
    )


class AsyncScheduler:
    """Execute ready nodes concurrently without introducing layer barriers.

    Handlers are resolved by node id, then node kind, then ``"*"``. Transform
    and barrier nodes default to an identity handler. Failures do not cancel
    independent work; only descendants are skipped.
    """

    def __init__(
        self,
        handlers: Mapping[str, NodeHandler] | None = None,
        *,
        max_concurrency: int | None = None,
    ) -> None:
        if max_concurrency is not None and max_concurrency < 1:
            raise ValueError("max_concurrency must be at least 1")
        self._handlers = dict(handlers or {})
        self._max_concurrency = max_concurrency

    def _effective_concurrency(self, graph: CompiledGraph) -> int:
        policy_limit = graph.spec.policies.max_concurrency if graph.spec.policies else None
        desired = self._max_concurrency or policy_limit or 4
        return min(desired, policy_limit) if policy_limit is not None else desired

    def _handler_for(self, node: NodeSpec) -> NodeHandler | None:
        handler = (
            self._handlers.get(node.id) or self._handlers.get(node.kind) or self._handlers.get("*")
        )
        if handler is None and node.kind in {"transform", "barrier"}:
            return _identity_handler
        if handler is None and node.kind == "router":
            return _router_handler
        return handler

    @staticmethod
    def _bind_input(
        graph: CompiledGraph,
        node_id: str,
        graph_input: JsonValue,
        results: Mapping[str, NodeResult],
        incoming_edges: tuple[EdgeSpec, ...] | None = None,
    ) -> JsonValue:
        incoming = sorted(
            graph.incoming[node_id] if incoming_edges is None else incoming_edges,
            key=lambda edge: edge.id,
        )
        if not incoming:
            return portable_json_snapshot(graph_input)

        values: dict[str, JsonValue] = {}
        for edge in incoming:
            key = edge.target.port or edge.source.node
            if key in values:
                raise _BindingError(
                    f"node {node_id!r} receives more than one value for input key {key!r}"
                )
            values[key] = _endpoint_value(edge.source, results[edge.source.node].value)
        return portable_json_snapshot(values)

    @staticmethod
    def _retry_delay_ms(node: NodeSpec, failed_attempt: int) -> float:
        initial = float(node.retry.initial_delay_ms or 0) if node.retry else 0.0
        multiplier = float(node.retry.backoff_multiplier or 1) if node.retry else 1.0
        configured_maximum = (
            float(node.retry.max_delay_ms)
            if node.retry and node.retry.max_delay_ms is not None
            else initial
        )
        maximum = max(initial, configured_maximum)
        try:
            scaled = initial * multiplier ** max(0, failed_attempt - 1)
        except OverflowError:
            scaled = float("inf")
        return min(maximum, scaled)

    async def _attempt(self, handler: NodeHandler, context: NodeContext) -> JsonValue:
        if context.cancel_signal.cancelled:
            raise _NodeCancelled
        try:
            value_or_awaitable = handler(context)
        except asyncio.CancelledError as exc:
            if context.cancel_signal.cancelled:
                raise _NodeCancelled from exc
            raise _HandlerCancelled from exc
        if inspect.isawaitable(value_or_awaitable):
            handler_task = asyncio.create_task(_resolve_node_output(value_or_awaitable))
            cancel_task = asyncio.create_task(context.cancel_signal.wait())
            try:
                done, _ = await asyncio.wait(
                    (handler_task, cancel_task),
                    timeout=(
                        context.node.timeout_ms / 1000
                        if context.node.timeout_ms is not None
                        else None
                    ),
                    return_when=asyncio.FIRST_COMPLETED,
                )
                if context.cancel_signal.cancelled:
                    raise _NodeCancelled
                if handler_task not in done:
                    raise TimeoutError
                try:
                    value = handler_task.result()
                except asyncio.CancelledError as exc:
                    if context.cancel_signal.cancelled:
                        raise _NodeCancelled from exc
                    raise _HandlerCancelled from exc
            finally:
                for task in (handler_task, cancel_task):
                    if not task.done():
                        task.cancel()
                await asyncio.gather(handler_task, cancel_task, return_exceptions=True)
        else:
            value = _snapshot_node_output(value_or_awaitable)
            if context.cancel_signal.cancelled:
                raise _NodeCancelled
        return value

    async def _execute_node(
        self,
        graph: CompiledGraph,
        node_id: str,
        sequence: int,
        node_input: JsonValue,
        graph_input: JsonValue,
        completed: Mapping[str, JsonValue],
        cancel_signal: CancellationSignal,
        claim_attempt: Callable[[str], bool],
        reserve_retry: Callable[[str], bool],
        release_retry_reservation: Callable[[str], None],
        attempt_semaphore: asyncio.Semaphore,
        on_attempt_started: Callable[[], None],
        on_attempt_finished: Callable[[], None],
        on_node_scheduled: Callable[[str, int], None],
        on_outcome_committed: Callable[[str, int], None],
        *,
        attempt_offset: int = 0,
        journal: _SchedulerJournal | None = None,
        initial_retry_delay_seconds: float = 0,
    ) -> NodeResult:
        node = graph.nodes[node_id]
        attempts = attempt_offset

        async def settled_without_attempt(result: NodeResult) -> NodeResult:
            if journal is not None:
                ordinal = await journal.node_settled_without_attempt(node, result)
                on_node_scheduled(node_id, ordinal)
                on_outcome_committed(node_id, ordinal)
            release_retry_reservation(node_id)
            return result

        if cancel_signal.cancelled:
            return await settled_without_attempt(
                _cancelled_result(
                    node_id,
                    sequence,
                    attempts,
                    status=NodeStatus.FAILED,
                    node_input=node_input,
                )
            )
        handler = self._handler_for(node)
        if handler is None:
            return await settled_without_attempt(
                NodeResult(
                    node_id=node_id,
                    sequence=sequence,
                    status=NodeStatus.FAILED,
                    attempts=attempts,
                    input=node_input,
                    failure=NodeFailure(
                        FailureCode.EXECUTOR_NOT_FOUND,
                        f"no executor is registered for node {node_id!r} or kind {node.kind!r}",
                        node_id,
                        attempts,
                    ),
                )
            )

        max_attempts = (node.retry.max_attempts or 1) if node.retry else 1
        last_failure: NodeFailure | None = None
        if initial_retry_delay_seconds > 0 and not await _delay_or_cancel(
            initial_retry_delay_seconds,
            cancel_signal,
        ):
            return await settled_without_attempt(
                _cancelled_result(
                    node_id,
                    sequence,
                    attempts,
                    status=NodeStatus.FAILED,
                    node_input=node_input,
                )
            )
        if attempts >= max_attempts:
            failure = NodeFailure(
                FailureCode.ATTEMPT_BUDGET_EXHAUSTED,
                f"node {node_id!r} has exhausted its durable attempt budget",
                node_id,
                attempts,
            )
            return await settled_without_attempt(
                NodeResult(
                    node_id=node_id,
                    sequence=sequence,
                    status=NodeStatus.FAILED,
                    attempts=attempts,
                    input=node_input,
                    failure=failure,
                )
            )
        while attempts < max_attempts:
            if not await _acquire_attempt_slot(attempt_semaphore, cancel_signal):
                return await settled_without_attempt(
                    _cancelled_result(
                        node_id,
                        sequence,
                        attempts,
                        status=NodeStatus.FAILED,
                        node_input=node_input,
                    )
                )
            attempt_counted = False
            may_retry = False
            delay_ms = 0.0
            try:
                if cancel_signal.cancelled:
                    return await settled_without_attempt(
                        _cancelled_result(
                            node_id,
                            sequence,
                            attempts,
                            status=NodeStatus.FAILED,
                            node_input=node_input,
                        )
                    )
                if not claim_attempt(node_id):
                    if last_failure is None:
                        last_failure = NodeFailure(
                            FailureCode.ATTEMPT_BUDGET_EXHAUSTED,
                            f"run attempt budget was exhausted before node {node_id!r} could start",
                            node_id,
                            attempts,
                        )
                    else:
                        last_failure = NodeFailure(
                            last_failure.code,
                            last_failure.message,
                            node_id,
                            last_failure.attempt,
                            retryable=False,
                            exception_type=last_failure.exception_type,
                        )
                    return await settled_without_attempt(
                        NodeResult(
                            node_id=node_id,
                            sequence=sequence,
                            status=NodeStatus.FAILED,
                            attempts=attempts,
                            input=node_input,
                            failure=last_failure,
                        )
                    )

                attempts += 1
                identity = (
                    await journal.before_attempt(node, node_input, attempts)
                    if journal is not None
                    else None
                )
                if identity is not None and identity.scheduled_ordinal is not None:
                    on_node_scheduled(node_id, identity.scheduled_ordinal)
                on_attempt_started()
                attempt_counted = True
                attempt_input = portable_json_snapshot(node_input)
                attempt_graph_input = portable_json_snapshot(graph_input)
                attempt_completed = portable_json_snapshot(dict(completed))
                context_graph = _snapshot_context_graph(graph.spec)
                context_node = next(item for item in context_graph.nodes if item.id == node_id)
                if not isinstance(attempt_completed, dict):
                    raise AssertionError("completed snapshot must be an object")
                mapping_input = (
                    MappingProxyType(attempt_input)
                    if graph.incoming[node_id] and isinstance(attempt_input, dict)
                    else MappingProxyType({})
                )
                context = NodeContext(
                    graph=context_graph,
                    node=context_node,
                    input=attempt_input,
                    graph_input=attempt_graph_input,
                    inputs=mapping_input,
                    completed=MappingProxyType(attempt_completed),
                    attempt=attempts,
                    cancel_signal=cancel_signal,
                    run_id=identity.run_id if identity is not None else None,
                    attempt_id=identity.attempt_id if identity is not None else None,
                    idempotency_key=(identity.activity_key if identity is not None else None),
                    activity_key=identity.activity_key if identity is not None else None,
                )
                try:
                    value = await self._attempt(handler, context)
                    if node.kind == "router":
                        _selected_routes(value, node, node_input)
                except _NodeCancelled:
                    code = FailureCode.NODE_CANCELLED
                    message = f"node {node_id!r} was cancelled"
                    exception_type = None
                except _HandlerCancelled:
                    code = FailureCode.NODE_EXECUTION_FAILED
                    message = (
                        f"node {node_id!r} failed: handler was cancelled without run cancellation"
                    )
                    exception_type = "CancelledError"
                except TimeoutError as exc:
                    code = FailureCode.NODE_TIMEOUT
                    message = f"node {node_id!r} timed out after {node.timeout_ms} ms"
                    exception_type = type(exc).__name__
                except _InvalidOutputError as exc:
                    code = FailureCode.INVALID_OUTPUT
                    message = str(exc)
                    exception_type = "InvalidOutputError"
                except _InvalidRouteSelectionError as exc:
                    code = FailureCode.INVALID_ROUTE_SELECTION
                    message = str(exc)
                    exception_type = "InvalidRouteSelectionError"
                except Exception as exc:
                    code = (
                        FailureCode.NODE_CANCELLED
                        if cancel_signal.cancelled
                        else FailureCode.NODE_EXECUTION_FAILED
                    )
                    message = (
                        f"node {node_id!r} was cancelled"
                        if cancel_signal.cancelled
                        else f"node {node_id!r} failed: {str(exc) or type(exc).__name__}"
                    )
                    exception_type = type(exc).__name__
                else:
                    if journal is not None:
                        ordinal = await journal.node_succeeded(
                            node,
                            node_input,
                            attempts,
                            value,
                        )
                        on_outcome_committed(node_id, ordinal)
                    return NodeResult(
                        node_id=node_id,
                        sequence=sequence,
                        status=NodeStatus.SUCCEEDED,
                        attempts=attempts,
                        input=node_input,
                        value=value,
                    )

                may_retry = (
                    attempts < max_attempts
                    and code
                    not in {
                        FailureCode.NODE_CANCELLED,
                        FailureCode.INVALID_ROUTE_SELECTION,
                    }
                    and reserve_retry(node_id)
                )
                last_failure = NodeFailure(
                    code,
                    message,
                    node_id,
                    attempts,
                    retryable=may_retry,
                    exception_type=exception_type,
                )
                delay_ms = self._retry_delay_ms(node, attempts) if may_retry else 0.0
                if journal is not None:
                    ordinal = await journal.attempt_failed(
                        last_failure,
                        will_retry=may_retry,
                        retry_delay_ms=delay_ms,
                    )
                    if not may_retry:
                        on_outcome_committed(node_id, ordinal)
            finally:
                if attempt_counted:
                    on_attempt_finished()
                attempt_semaphore.release()

            if last_failure is None:
                raise AssertionError("failed node attempt omitted its failure")
            if not may_retry:
                return NodeResult(
                    node_id=node_id,
                    sequence=sequence,
                    status=NodeStatus.FAILED,
                    attempts=attempts,
                    input=node_input,
                    failure=last_failure,
                )
            if delay_ms > 0 and not await _delay_or_cancel(delay_ms / 1000, cancel_signal):
                return await settled_without_attempt(
                    _cancelled_result(
                        node_id,
                        sequence,
                        attempts,
                        status=NodeStatus.FAILED,
                        node_input=node_input,
                    )
                )

        raise AssertionError("bounded retry loop exited unexpectedly")

    async def _run(
        self,
        graph: CompiledGraph,
        graph_input: JsonValue,
        *,
        cancel_event: asyncio.Event | None = None,
        journal: _SchedulerJournal | None = None,
        initial_results: Mapping[str, NodeResult] | None = None,
        attempt_offsets: Mapping[str, int] | None = None,
        initial_total_attempts: int = 0,
        initial_scheduled_order: tuple[str, ...] = (),
        initial_completion_order: tuple[str, ...] = (),
        initial_max_observed_concurrency: int = 0,
        initial_retry_delays: Mapping[str, float] | None = None,
    ) -> RunResult:
        """Run a compiled graph and return deterministic, structured results."""

        graph = _snapshot_compiled_graph(graph)
        try:
            graph_input_snapshot = portable_json_snapshot(graph_input)
        except PortableJsonError:
            raise TypeError("graph input must be a portable finite JSON value") from None
        if cancel_event is not None and not isinstance(cancel_event, asyncio.Event):
            raise TypeError("cancel_event must be an asyncio.Event")
        cancellation = CancellationSignal(cancel_event or asyncio.Event())

        sequence = {node_id: index for index, node_id in enumerate(graph.topological_order)}
        restored_results = dict(initial_results or {})
        if not set(restored_results).issubset(graph.nodes):
            raise ValueError("initial_results contains a node outside the compiled graph")
        unsupported_conditions = _unsupported_condition_sources(graph)
        for node_id, restored in restored_results.items():
            if node_id in unsupported_conditions:
                attempt_offset = (attempt_offsets or {}).get(node_id, 0)
                expected = NodeResult(
                    node_id=node_id,
                    sequence=sequence[node_id],
                    status=NodeStatus.FAILED,
                    attempts=attempt_offset,
                    input_bound=False,
                    failure=NodeFailure(
                        FailureCode.UNSUPPORTED_EDGE_CONDITION,
                        unsupported_conditions[node_id],
                        node_id,
                        attempt_offset,
                    ),
                )
                if restored != expected:
                    raise TypeError(
                        f"initial_results contains an invalid unsupported-condition "
                        f"settlement for {node_id!r}"
                    )
                continue
            node = graph.nodes[node_id]
            if node.kind == "router" and restored.status is NodeStatus.SUCCEEDED:
                try:
                    if not restored.input_bound:
                        raise _InvalidRouteSelectionError(
                            f"router {node_id!r} result has no authoritative input"
                        )
                    _selected_routes(restored.value, node, restored.input)
                except _InvalidRouteSelectionError as exc:
                    raise TypeError(
                        f"initial_results contains an invalid successful router decision "
                        f"for {node_id!r}"
                    ) from exc
        remaining = {node_id: len(graph.incoming[node_id]) for node_id in graph.nodes}
        for restored_node_id in graph.topological_order:
            if restored_node_id not in restored_results:
                continue
            for edge in graph.outgoing[restored_node_id]:
                remaining[edge.target.node] -= 1
        ready = sorted(
            (
                node_id
                for node_id, count in remaining.items()
                if count == 0 and node_id not in restored_results
            ),
            key=sequence.__getitem__,
        )
        active: dict[asyncio.Task[NodeResult], str] = {}
        results: dict[str, NodeResult] = restored_results
        scheduled: list[str] = list(initial_scheduled_order)
        completion: list[str] = list(initial_completion_order)
        durable_completion_prefix = tuple(initial_completion_order)
        durable_scheduled_prefix = tuple(initial_scheduled_order)
        scheduled_ordinals: dict[str, int] = {}
        completion_ordinals: dict[str, int] = {}
        concurrency = self._effective_concurrency(graph)
        attempt_limit = (
            graph.spec.policies.max_total_attempts
            if graph.spec.policies and graph.spec.policies.max_total_attempts is not None
            else MAX_SAFE_INTEGER
        )
        if (
            type(initial_total_attempts) is not int
            or initial_total_attempts < 0
            or initial_total_attempts > MAX_SAFE_INTEGER
        ):
            raise TypeError("initial_total_attempts must be a non-negative safe integer")
        total_attempts = initial_total_attempts
        retry_reservations = set((initial_retry_delays or {}).keys())
        for node_id in retry_reservations:
            if node_id not in graph.nodes:
                raise ValueError(f"initial_retry_delays contains unknown node {node_id!r}")
            if node_id in restored_results:
                raise ValueError(f"initial retry reservation targets settled node {node_id!r}")
        if total_attempts + len(retry_reservations) > attempt_limit:
            raise ValueError(
                "initial durable attempts and retry reservations exceed maxTotalAttempts"
            )
        running_attempts = 0
        max_observed_concurrency = initial_max_observed_concurrency
        attempt_semaphore = asyncio.Semaphore(concurrency)

        def claim_attempt(node_id: str) -> bool:
            nonlocal total_attempts
            if node_id in retry_reservations:
                retry_reservations.remove(node_id)
                total_attempts += 1
                return True
            if total_attempts + len(retry_reservations) >= attempt_limit:
                return False
            total_attempts += 1
            return True

        def reserve_retry(node_id: str) -> bool:
            if node_id in retry_reservations:
                return False
            if total_attempts + len(retry_reservations) >= attempt_limit:
                return False
            retry_reservations.add(node_id)
            return True

        def release_retry_reservation(node_id: str) -> None:
            retry_reservations.discard(node_id)

        def on_attempt_started() -> None:
            nonlocal running_attempts, max_observed_concurrency
            running_attempts += 1
            max_observed_concurrency = max(max_observed_concurrency, running_attempts)

        def on_attempt_finished() -> None:
            nonlocal running_attempts
            running_attempts -= 1

        def on_outcome_committed(node_id: str, ordinal: int) -> None:
            if node_id in completion_ordinals:
                raise RuntimeError(f"node {node_id!r} committed more than one terminal outcome")
            completion_ordinals[node_id] = ordinal

        def on_node_scheduled(node_id: str, ordinal: int) -> None:
            if node_id not in durable_scheduled_prefix:
                scheduled_ordinals.setdefault(node_id, ordinal)

        def settle(node_id: str, result: NodeResult) -> None:
            results[node_id] = result
            completion.append(node_id)
            for edge in graph.outgoing[node_id]:
                target = edge.target.node
                remaining[target] -= 1
                if remaining[target] == 0:
                    ready.append(target)
            ready.sort(key=sequence.__getitem__)

        async def settle_without_attempt(node_id: str, result: NodeResult) -> None:
            if journal is not None:
                ordinal = await journal.node_settled_without_attempt(graph.nodes[node_id], result)
                on_node_scheduled(node_id, ordinal)
                on_outcome_committed(node_id, ordinal)
            release_retry_reservation(node_id)
            settle(node_id, result)

        async def launch_ready() -> None:
            while ready:
                node_id = ready.pop(0)
                attempt_offset = (attempt_offsets or {}).get(node_id, 0)
                if node_id not in scheduled:
                    scheduled.append(node_id)
                if node_id in unsupported_conditions:
                    await settle_without_attempt(
                        node_id,
                        NodeResult(
                            node_id=node_id,
                            sequence=sequence[node_id],
                            status=NodeStatus.FAILED,
                            attempts=attempt_offset,
                            input_bound=False,
                            failure=NodeFailure(
                                FailureCode.UNSUPPORTED_EDGE_CONDITION,
                                unsupported_conditions[node_id],
                                node_id,
                                attempt_offset,
                            ),
                        ),
                    )
                    continue

                try:
                    active_incoming = _active_incoming_edges(graph, node_id, results)
                except (_UnsupportedEdgeConditionError, _InvalidRouteSelectionError) as exc:
                    code = (
                        FailureCode.UNSUPPORTED_EDGE_CONDITION
                        if isinstance(exc, _UnsupportedEdgeConditionError)
                        else FailureCode.INVALID_ROUTE_SELECTION
                    )
                    await settle_without_attempt(
                        node_id,
                        NodeResult(
                            node_id=node_id,
                            sequence=sequence[node_id],
                            status=NodeStatus.FAILED,
                            attempts=attempt_offset,
                            input_bound=False,
                            failure=NodeFailure(
                                code,
                                str(exc),
                                node_id,
                                attempt_offset,
                                exception_type=type(exc).__name__,
                            ),
                        ),
                    )
                    continue
                if graph.incoming[node_id] and not active_incoming:
                    await settle_without_attempt(
                        node_id,
                        NodeResult(
                            node_id=node_id,
                            sequence=sequence[node_id],
                            status=NodeStatus.SKIPPED,
                            attempts=attempt_offset,
                            input_bound=False,
                            failure=NodeFailure(
                                FailureCode.ROUTE_NOT_SELECTED,
                                (
                                    f"Node {node_id!r} did not start because "
                                    "no incoming route was selected"
                                ),
                                node_id,
                                attempt_offset,
                            ),
                        ),
                    )
                    continue
                if cancellation.cancelled:
                    await settle_without_attempt(
                        node_id,
                        _cancelled_result(
                            node_id,
                            sequence[node_id],
                            attempt_offset,
                            status=NodeStatus.SKIPPED,
                            input_bound=False,
                        ),
                    )
                    continue
                upstream_failed = tuple(
                    sorted(
                        {
                            edge.source.node
                            for edge in active_incoming
                            if results[edge.source.node].status is not NodeStatus.SUCCEEDED
                        }
                    )
                )
                if upstream_failed:
                    await settle_without_attempt(
                        node_id,
                        NodeResult(
                            node_id=node_id,
                            sequence=sequence[node_id],
                            status=NodeStatus.SKIPPED,
                            attempts=attempt_offset,
                            input_bound=False,
                            failure=NodeFailure(
                                FailureCode.UPSTREAM_FAILED,
                                "node did not start because upstream dependencies failed",
                                node_id,
                                attempt_offset,
                                upstream_nodes=upstream_failed,
                            ),
                        ),
                    )
                    continue

                try:
                    node_input = self._bind_input(
                        graph,
                        node_id,
                        graph_input_snapshot,
                        results,
                        active_incoming,
                    )
                except _BindingError as exc:
                    await settle_without_attempt(
                        node_id,
                        NodeResult(
                            node_id=node_id,
                            sequence=sequence[node_id],
                            status=NodeStatus.FAILED,
                            attempts=attempt_offset,
                            input_bound=False,
                            failure=NodeFailure(
                                FailureCode.INPUT_BINDING_FAILED,
                                f"could not bind input for node {node_id!r}: {exc}",
                                node_id,
                                attempt_offset,
                                exception_type=type(exc).__name__,
                            ),
                        ),
                    )
                    continue

                completed = MappingProxyType(
                    {
                        item_id: item.value
                        for item_id, item in results.items()
                        if item.status is NodeStatus.SUCCEEDED
                    }
                )
                task = asyncio.create_task(
                    self._execute_node(
                        graph,
                        node_id,
                        sequence[node_id],
                        node_input,
                        graph_input_snapshot,
                        completed,
                        cancellation,
                        claim_attempt,
                        reserve_retry,
                        release_retry_reservation,
                        attempt_semaphore,
                        on_attempt_started,
                        on_attempt_finished,
                        on_node_scheduled,
                        on_outcome_committed,
                        attempt_offset=attempt_offset,
                        journal=journal,
                        initial_retry_delay_seconds=(initial_retry_delays or {}).get(node_id, 0),
                    )
                )
                active[task] = node_id

        try:
            while len(results) < len(graph.nodes):
                await launch_ready()
                if not active:
                    break
                done, _ = await asyncio.wait(active, return_when=asyncio.FIRST_COMPLETED)
                for task in sorted(done, key=lambda item: sequence[active[item]]):
                    node_id = active.pop(task)
                    settle(node_id, task.result())
        except BaseException:
            active_tasks = tuple(active)
            if journal is not None:
                # A journal failure is authoritative and must be surfaced even
                # when an unrelated handler ignores cancellation. Observe each
                # detached task's eventual outcome without delaying the error.
                for task in active_tasks:
                    task.add_done_callback(_consume_background_task_outcome)
            for task in active_tasks:
                if not task.done():
                    task.cancel()
            if journal is None:
                await asyncio.gather(*active_tasks, return_exceptions=True)
            raise

        ordered_results = {node_id: results[node_id] for node_id in graph.topological_order}
        failures = [
            result.failure
            for result in ordered_results.values()
            if result.failure is not None
            and result.failure.code is not FailureCode.ROUTE_NOT_SELECTED
        ]
        output_values: dict[str, JsonValue] = {}
        outputs_complete = True
        for output_name in sorted(graph.spec.outputs):
            endpoint = graph.spec.outputs[output_name]
            result = results[endpoint.node]
            if result.status is not NodeStatus.SUCCEEDED:
                outputs_complete = False
                continue
            try:
                output_values[output_name] = portable_json_snapshot(
                    _endpoint_value(endpoint, result.value)
                )
            except _BindingError as exc:
                outputs_complete = False
                failures.append(
                    NodeFailure(
                        FailureCode.OUTPUT_BINDING_FAILED,
                        f"could not bind graph output {output_name!r}: {exc}",
                        endpoint.node,
                        0,
                        exception_type=type(exc).__name__,
                        output_name=output_name,
                        output_port=endpoint.port,
                    )
                )

        if cancellation.cancelled:
            status = RunStatus.CANCELLED
        elif not failures and outputs_complete and len(results) == len(graph.nodes):
            status = RunStatus.SUCCEEDED
        else:
            status = RunStatus.FAILED
        outputs = MappingProxyType(output_values) if outputs_complete else None
        completion_order = tuple(completion)
        scheduled_order = tuple(scheduled)
        if journal is not None:
            committed_scheduled_suffix = tuple(
                node_id
                for node_id, _ in sorted(
                    scheduled_ordinals.items(),
                    key=lambda item: item[1],
                )
            )
            missing_scheduled = tuple(
                node_id
                for node_id in scheduled
                if node_id not in durable_scheduled_prefix and node_id not in scheduled_ordinals
            )
            scheduled_order = (
                durable_scheduled_prefix + committed_scheduled_suffix + missing_scheduled
            )
            committed_suffix = tuple(
                node_id
                for node_id, _ in sorted(
                    completion_ordinals.items(),
                    key=lambda item: item[1],
                )
                if node_id not in durable_completion_prefix
            )
            completion_order = durable_completion_prefix + committed_suffix
            if len(scheduled_order) != len(results) or set(scheduled_order) != set(results):
                raise RuntimeError("durable run is missing an explicit scheduled node outcome")
            if len(completion_order) != len(results) or set(completion_order) != set(results):
                raise RuntimeError("durable run is missing an explicit committed node outcome")
        run_result = RunResult(
            status=status,
            graph_hash=graph.graph_hash,
            nodes=MappingProxyType(ordered_results),
            outputs=outputs,
            failures=tuple(failures),
            scheduled_order=scheduled_order,
            completion_order=completion_order,
            max_observed_concurrency=max_observed_concurrency,
            total_attempts=total_attempts,
        )
        if journal is not None:
            await journal.run_terminal(run_result)
        return run_result

    async def run(
        self,
        graph: CompiledGraph,
        graph_input: JsonValue,
        *,
        cancel_event: asyncio.Event | None = None,
    ) -> RunResult:
        """Run a compiled graph and return deterministic, structured results."""

        return await self._run(graph, graph_input, cancel_event=cancel_event)


async def run_graph(
    graph: CompiledGraph,
    graph_input: JsonValue,
    handlers: Mapping[str, NodeHandler] | None = None,
    *,
    max_concurrency: int | None = None,
    cancel_event: asyncio.Event | None = None,
) -> RunResult:
    """Convenience wrapper for a single scheduler run."""

    return await AsyncScheduler(handlers, max_concurrency=max_concurrency).run(
        graph,
        graph_input,
        cancel_event=cancel_event,
    )
