"""Deterministic ready-queue scheduler for compiled acyclic graphs."""

from __future__ import annotations

import asyncio
import inspect
import re
from collections.abc import Awaitable, Callable, Coroutine, Mapping, Sequence
from contextlib import suppress
from dataclasses import dataclass, field
from enum import StrEnum
from functools import partial
from types import MappingProxyType
from typing import Any, Protocol

from .compiler import CompiledGraph, compile_graph
from .integrated_barrier import (
    IntegratedBarrierPolicySnapshot,
    ValidBarrierPolicy,
    claims_integrated_barrier_policy,
    validate_integrated_barrier_policy,
)
from .integrated_barrier_runtime import (
    BarrierArrival,
    BarrierDecisionEvent,
    BarrierDisposition,
    BarrierResolution,
    DecisionRejection,
    MalformedBarrierVote,
    ManualClock,
    MonotonicClock,
    build_barrier_decision,
    evaluate_integrated_barrier,
    fold_committed_decisions,
    parse_barrier_vote,
)
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
    # `unknown`, `awaiting_human` and `cancelled` are integrated-barrier
    # terminals. None of them is a success and none of them binds an output.
    UNKNOWN = "unknown"
    AWAITING_HUMAN = "awaiting_human"
    CANCELLED = "cancelled"


class RunStatus(StrEnum):
    """Run terminals. Precedence, highest first, is failed, cancelled,
    awaiting_human, unknown, succeeded."""

    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"
    AWAITING_HUMAN = "awaiting_human"
    UNKNOWN = "unknown"


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
    UNSUPPORTED_RUNTIME_CAPABILITY = "UNSUPPORTED_RUNTIME_CAPABILITY"
    ROUTE_NOT_SELECTED = "ROUTE_NOT_SELECTED"
    UPSTREAM_UNKNOWN = "UPSTREAM_UNKNOWN"
    INVALID_BARRIER_VOTE = "INVALID_BARRIER_VOTE"
    BARRIER_NOT_SATISFIED = "BARRIER_NOT_SATISFIED"
    BARRIER_LATE_ARRIVAL = "BARRIER_LATE_ARRIVAL"
    DECISION_POLICY_DRIFT = "DECISION_POLICY_DRIFT"
    DECISION_IDENTITY_MISMATCH = "DECISION_IDENTITY_MISMATCH"
    DUPLICATE_DECISION = "DUPLICATE_DECISION"


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
    #: Durable decision events this run committed, in commit order. Empty when
    #: the run committed no decision.
    decision_events: tuple[BarrierDecisionEvent, ...] = ()

    @property
    def succeeded(self) -> bool:
        return self.status is RunStatus.SUCCEEDED


@dataclass(frozen=True, slots=True)
class DecisionContext:
    """Run identity every durable decision this run commits binds."""

    run_id: str = ""
    graph_revision: int = 1


class ScriptedClock:
    """A monotonic clock driven by a scripted tick list.

    ``now_ms`` starts at the first entry and advances to the next entry each
    time the scheduler consumes a tick from :meth:`next_tick`. Once the list is
    exhausted the driver reports that the clock will never advance again, so
    the scheduler stops waiting on it instead of deadlocking. Delivery yields
    to the event loop, which is what makes a tick a quiescence point rather
    than a race with deterministic settlements.
    """

    __slots__ = ("_cursor", "_script")

    def __init__(self, ticks: Sequence[int]) -> None:
        script = list(ticks)
        for index, value in enumerate(script):
            if type(value) is not int or value < 0 or value > MAX_SAFE_INTEGER:
                raise ValueError(f"scripted tick {index} must be a non-negative safe integer")
            if index > 0 and value < script[index - 1]:
                raise ValueError(f"scripted tick {index} moves a monotonic clock backwards")
        self._script = script
        self._cursor = 0

    def now_ms(self) -> int:
        return self._script[self._cursor] if self._script else 0

    @property
    def delivered_ticks(self) -> int:
        """Number of ticks the scheduler has already consumed."""

        return self._cursor

    def next_tick(self) -> Coroutine[Any, Any, None] | None:
        """The awaitable that advances ``now_ms``, or ``None`` when exhausted."""

        if self._cursor + 1 >= len(self._script):
            return None
        return self._deliver()

    async def _deliver(self) -> None:
        await asyncio.sleep(0)
        if self._cursor + 1 < len(self._script):
            self._cursor += 1


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


def _adopted_selected_routes(value: JsonValue, node_id: str) -> frozenset[str]:
    if type(value) is not dict:
        raise _InvalidRouteSelectionError(
            f"adopted route decision for {node_id!r} has no selectedRoutes"
        )
    selected = value.get("selectedRoutes")
    if type(selected) is not list:
        raise _InvalidRouteSelectionError(
            f"adopted route decision for {node_id!r} has no selectedRoutes"
        )
    return frozenset(str(route) for route in selected)


def _edge_selects(
    graph: CompiledGraph,
    edge: EdgeSpec,
    source: NodeResult,
    adopted_routes: frozenset[str],
) -> bool:
    """Whether one edge is active given its settled source result."""

    if (
        source.failure is not None
        and source.failure.code is FailureCode.UNSUPPORTED_EDGE_CONDITION
    ):
        return True
    route_key = _route_key(edge, graph)
    if route_key is None:
        return not _is_route_skip(source)
    if source.status is not NodeStatus.SUCCEEDED:
        return True
    if edge.source.node in adopted_routes:
        # An adopted RouteSelected decision is authoritative forever: selection
        # is never recomputed and upstream values are never re-read.
        return route_key in _adopted_selected_routes(source.value, edge.source.node)
    if not source.input_bound:
        raise _InvalidRouteSelectionError(
            f"router {edge.source.node!r} result has no authoritative input"
        )
    selected = _selected_routes(
        source.value,
        graph.nodes[edge.source.node],
        source.input,
    )
    return route_key in selected


def _active_incoming_edges(
    graph: CompiledGraph,
    node_id: str,
    results: Mapping[str, NodeResult],
    adopted_routes: frozenset[str] = frozenset(),
) -> tuple[EdgeSpec, ...]:
    """Return the dependencies selected by recorded router node outputs."""

    return tuple(
        edge
        for edge in graph.incoming[node_id]
        if _edge_selects(graph, edge, results[edge.source.node], adopted_routes)
    )


def _unsupported_condition_sources(graph: CompiledGraph) -> dict[str, str]:
    messages: dict[str, list[str]] = {}
    for edge in graph.spec.edges:
        try:
            _route_key(edge, graph)
        except _UnsupportedEdgeConditionError as exc:
            messages.setdefault(edge.source.node, []).append(str(exc))
    return {node_id: "; ".join(items) for node_id, items in messages.items()}


_RUNTIME_CAPABILITY_CONTRACT = "runtime-capability/v1alpha1"
_SUPPORTED_NODE_KINDS = frozenset({"agent", "model", "tool", "transform", "router", "barrier"})
_SUPPORTED_POLICY_KEYS = frozenset(
    {
        "maxConcurrency",
        "maxDepth",
        "maxFanOut",
        "maxTotalAttempts",
        "graphengineering.reacher-z.github.io/typed-ports",
    }
)


@dataclass(frozen=True, slots=True)
class _RuntimeCapabilityIssue:
    owner_node_id: str
    capability: str
    path: str


def _json_pointer_segment(value: str) -> str:
    return value.replace("~", "~0").replace("/", "~1")


#: Capability name for a `barrier` node whose config claims
#: `IntegratedBarrierPolicy` by `apiVersion`. An entry point that does not
#: implement barrier satisfaction must refuse such a graph before dispatch:
#: executing the node as an ordinary deterministic transform would silently
#: pass an unsatisfied barrier. The gate keys on the ownership claim, not on
#: the shape, so a pre-contract barrier config keeps `node-config:barrier`.
INTEGRATED_BARRIER_CAPABILITY = "integrated-barrier-policy"


def _runtime_capability_issues(
    graph: CompiledGraph,
    *,
    integrated_barrier: bool = False,
) -> tuple[_RuntimeCapabilityIssue, ...]:
    """Return every unsupported executable declaration in stable document order.

    Graph IR intentionally contains vocabulary ahead of the native scheduler.
    Accepting that vocabulary must never silently weaken it into ordinary value
    execution. This inventory is therefore checked before handlers, durable
    history reads, or durable appends.

    ``integrated_barrier`` is set only by an entry point that actually
    implements arming, satisfaction arithmetic, deadlines, resolutions, late
    arrival, cancellation and the durable decision document. The ordinary
    scheduler does; the durable scheduler does not journal ``BarrierSatisfied``
    yet, so it keeps refusing.
    """

    spec = graph.spec
    graph_owner = spec.entrypoints[0]
    issues: list[_RuntimeCapabilityIssue] = []

    def add(owner_node_id: str, capability: str, path: str) -> None:
        issues.append(_RuntimeCapabilityIssue(owner_node_id, capability, path))

    if spec.state_schema is not None:
        add(graph_owner, "graph-state", "#/stateSchema")

    for index, node in enumerate(spec.nodes):
        path = f"#/nodes/{index}"
        if node.kind not in _SUPPORTED_NODE_KINDS:
            add(node.id, f"node-kind:{node.kind}", f"{path}/kind")
        if node.kind == "barrier":
            # A claimed integrated barrier policy is refused under its own
            # capability name so the failure states the real reason. Every
            # other unsupported barrier config keeps the published
            # `node-config:barrier` name.
            if claims_integrated_barrier_policy(node.config):
                if not integrated_barrier:
                    add(node.id, INTEGRATED_BARRIER_CAPABILITY, f"{path}/config")
            elif node.config not in ({}, {"condition": "all"}):
                add(node.id, "node-config:barrier", f"{path}/config")
        if node.cache is not None:
            add(node.id, "node-cache", f"{path}/cache")
        if node.resources is not None:
            add(node.id, "resource-admission", f"{path}/resources")
        if node.isolation is not None:
            add(node.id, "isolation-provider", f"{path}/isolation")
        if node.retry is not None and node.retry.jitter is True:
            add(node.id, "retry-jitter", f"{path}/retry/jitter")

    for index, edge in enumerate(spec.edges):
        path = f"#/edges/{index}"
        if edge.mapping is not None:
            add(edge.source.node, "edge-map", f"{path}/map")
        if edge.mode in {"stream", "artifact-ref"}:
            add(edge.source.node, f"edge-mode:{edge.mode}", f"{path}/mode")

    policies = spec.policies
    if policies is not None:
        if policies.max_dynamic_nodes is not None:
            add(graph_owner, "dynamic-graph-patch", "#/policies/maxDynamicNodes")
        if policies.max_duration_ms is not None:
            add(graph_owner, "graph-deadline", "#/policies/maxDurationMs")
        if policies.max_cost_usd is not None:
            add(graph_owner, "cost-budget", "#/policies/maxCostUsd")
        policy_values = policies.model_extra or {}
        unknown_keys = sorted(
            set(policy_values)
            - _SUPPORTED_POLICY_KEYS
            - {
                "maxDynamicNodes",
                "maxDurationMs",
                "maxCostUsd",
            }
        )
        for key in unknown_keys:
            add(
                graph_owner,
                f"policy:{key}",
                f"#/policies/{_json_pointer_segment(key)}",
            )

    return tuple(issues)


def _condition_capability_failure(
    graph: CompiledGraph,
    *,
    integrated_barrier: bool = False,
) -> RunResult | None:
    """Fail before dispatch for unsupported runtime declarations or conditions.

    The compiler registry deliberately accepts conditions owned by other graph
    features, and the Graph IR contains additional forward vocabulary. This
    scheduler executes only its closed capability subset, so every unsupported
    declaration is projected as a graph-level execution failure without creating
    a node result or consuming an attempt.
    """

    runtime_issues = _runtime_capability_issues(graph, integrated_barrier=integrated_barrier)
    condition_issues = _unsupported_condition_sources(graph)
    if not runtime_issues and not condition_issues:
        return None
    failures = tuple(
        NodeFailure(
            FailureCode.UNSUPPORTED_RUNTIME_CAPABILITY,
            (
                f"Runtime capability '{issue.capability}' at '{issue.path}' "
                f"is not implemented by {_RUNTIME_CAPABILITY_CONTRACT}"
            ),
            issue.owner_node_id,
            0,
        )
        for issue in runtime_issues
    ) + tuple(
        NodeFailure(
            FailureCode.UNSUPPORTED_EDGE_CONDITION,
            condition_issues[node.id],
            node.id,
            0,
        )
        for node in graph.spec.nodes
        if node.id in condition_issues
    )
    return RunResult(
        status=RunStatus.FAILED,
        graph_hash=graph.graph_hash,
        nodes=MappingProxyType({}),
        outputs=None,
        failures=failures,
        scheduled_order=(),
        completion_order=(),
        max_observed_concurrency=0,
        total_attempts=0,
    )


@dataclass(frozen=True, slots=True)
class _BarrierBinding:
    """A barrier node the scheduler owns, with its incoming edges in graph
    declaration order. That order is normative and appears verbatim in the
    decision document, so it is deliberately not the sorted edge-ID ordering
    input binding uses."""

    node_id: str
    policy: IntegratedBarrierPolicySnapshot
    policy_document: JsonValue
    incoming: tuple[EdgeSpec, ...]


@dataclass(slots=True)
class _BarrierState:
    """Barrier state between arming and the single decision it may commit."""

    armed_at_ms: int | None = None
    decided: bool = False
    #: Sources still unsettled when the decision committed; every one is late.
    late_sources: set[str] = field(default_factory=set)


def _bind_integrated_barriers(graph: CompiledGraph) -> dict[str, _BarrierBinding]:
    bindings: dict[str, _BarrierBinding] = {}
    for node in graph.spec.nodes:
        if node.kind != "barrier":
            continue
        validation = validate_integrated_barrier_policy(node.config)
        if isinstance(validation, ValidBarrierPolicy):
            bindings[node.id] = _BarrierBinding(
                node.id,
                validation.policy,
                node.config,
                graph.incoming[node.id],
            )
    return bindings


#: Upstream failure codes that mean the source settled without ever attempting,
#: or was cancelled before settling. Every one is a `missing` arrival.
_MISSING_UPSTREAM_CODES = frozenset(
    {
        FailureCode.ROUTE_NOT_SELECTED,
        FailureCode.UPSTREAM_FAILED,
        FailureCode.UPSTREAM_UNKNOWN,
        FailureCode.NODE_CANCELLED,
    }
)
_VERDICT_DISPOSITION: Mapping[str, BarrierDisposition] = MappingProxyType(
    {
        "accept": BarrierDisposition.SUCCEEDED,
        "reject": BarrierDisposition.FAILED,
        "abstain": BarrierDisposition.ABSTAINED,
        "unknown": BarrierDisposition.UNKNOWN,
    }
)
#: Terminal node status each barrier resolution settles the barrier node with.
_BARRIER_RESOLUTION_STATUS: Mapping[BarrierResolution, NodeStatus] = MappingProxyType(
    {
        BarrierResolution.SATISFIED: NodeStatus.SUCCEEDED,
        BarrierResolution.FAILED: NodeStatus.FAILED,
        BarrierResolution.UNKNOWN: NodeStatus.UNKNOWN,
        BarrierResolution.AWAITING_HUMAN: NodeStatus.AWAITING_HUMAN,
    }
)
#: The three identity members an adopted route decision strips back off the
#: published eight-member route-selection output.
_ROUTE_IDENTITY_MEMBERS = frozenset({"routerNodeId", "policyHash", "decisionId"})


def _resolve_barrier_arrival(
    policy: IntegratedBarrierPolicySnapshot,
    edge: EdgeSpec,
    result: NodeResult | None,
    edge_active: bool,
    bound_value: Callable[[], JsonValue],
) -> BarrierArrival | str:
    """Classify one incoming edge into exactly one disposition entry.

    `all`, `minimum` and `percentage` barriers deliberately do not inspect
    upstream values: a source that executed successfully contributes
    `succeeded` regardless of what its output says. Only `quorum` reads the
    ballot. A malformed quorum ballot returns the source node ID instead of an
    arrival: it is never coerced and contributes no disposition entry.
    """

    source_node_id = edge.source.node
    if result is None:
        # Still unsettled at the deciding quiescence point, which is only
        # reachable when the deadline elapsed.
        return BarrierArrival(source_node_id, BarrierDisposition.TIMED_OUT)
    if not edge_active:
        return BarrierArrival(source_node_id, BarrierDisposition.MISSING)
    if result.status is not NodeStatus.SUCCEEDED:
        code = result.failure.code if result.failure is not None else None
        disposition = (
            BarrierDisposition.FAILED
            if result.status is NodeStatus.FAILED
            and (code is None or code not in _MISSING_UPSTREAM_CODES)
            else BarrierDisposition.MISSING
        )
        return BarrierArrival(source_node_id, disposition)
    if policy.kind != "quorum":
        return BarrierArrival(source_node_id, BarrierDisposition.SUCCEEDED)

    ballot = parse_barrier_vote(bound_value())
    if isinstance(ballot, MalformedBarrierVote):
        return source_node_id
    return BarrierArrival(source_node_id, _VERDICT_DISPOSITION[ballot.verdict.value], ballot)


def _is_unknown_terminal(result: NodeResult) -> bool:
    """An upstream that settled `unknown`, or inherited `UPSTREAM_UNKNOWN`.

    Neither is a failure: a run does not fail solely because a barrier
    resolved to unknown.
    """

    return result.status is NodeStatus.UNKNOWN or (
        result.status is NodeStatus.SKIPPED
        and result.failure is not None
        and result.failure.code is FailureCode.UPSTREAM_UNKNOWN
    )


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
        integrated_barrier: bool = False,
        clock: MonotonicClock | None = None,
        decision: DecisionContext | None = None,
        committed_decisions: Sequence[Mapping[str, JsonValue]] | None = None,
    ) -> RunResult:
        """Run a compiled graph and return deterministic, structured results."""

        graph = _snapshot_compiled_graph(graph)
        capability_failure = _condition_capability_failure(
            graph,
            integrated_barrier=integrated_barrier,
        )
        if capability_failure is not None:
            return capability_failure
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

        barrier_clock: MonotonicClock = clock if clock is not None else ManualClock(0)
        decision_context = decision if decision is not None else DecisionContext()
        barrier_bindings = _bind_integrated_barriers(graph) if integrated_barrier else {}
        barrier_states = {binding_id: _BarrierState() for binding_id in barrier_bindings}
        decision_events: list[BarrierDecisionEvent] = []
        late_arrival_failures: list[NodeFailure] = []
        adopted_routes: set[str] = set()
        halted_for_human = False

        # Fold the durable history before scheduling. A node with a committed
        # decision is never re-evaluated: no executor call, no recomputation,
        # no upstream re-read, and no second decision event.
        committed = tuple(committed_decisions or ())
        if committed:
            current_policies: dict[str, JsonValue] = {}
            for event in committed:
                if not isinstance(event, Mapping):
                    raise TypeError("committed_decisions entries must be mappings")
                if event.get("type") not in {"BarrierSatisfied", "RouteSelected"}:
                    continue
                event_node_id = event.get("nodeId")
                if not isinstance(event_node_id, str) or event_node_id not in graph.nodes:
                    raise TypeError(
                        f"committed decision targets unknown node {event_node_id!r}"
                    )
                current_policies[event_node_id] = graph.nodes[event_node_id].config
            outcome = fold_committed_decisions(
                committed,
                run_id=decision_context.run_id,
                graph_revision=decision_context.graph_revision,
                current_policies=current_policies,
            )
            if isinstance(outcome, DecisionRejection):
                return RunResult(
                    status=RunStatus.FAILED,
                    graph_hash=graph.graph_hash,
                    nodes=MappingProxyType({}),
                    outputs=None,
                    failures=(
                        NodeFailure(
                            FailureCode(outcome.code.value),
                            outcome.message,
                            outcome.node_id,
                            0,
                        ),
                    ),
                    scheduled_order=(),
                    completion_order=(),
                    max_observed_concurrency=0,
                    total_attempts=0,
                )
            for adopted in outcome.adopted:
                if adopted.event_type == "RouteSelected":
                    route_output = portable_json_snapshot(
                        {
                            key: value
                            for key, value in adopted.document.items()
                            if key not in _ROUTE_IDENTITY_MEMBERS
                        }
                    )
                    restored_results[adopted.node_id] = NodeResult(
                        node_id=adopted.node_id,
                        sequence=sequence[adopted.node_id],
                        status=NodeStatus.SUCCEEDED,
                        attempts=0,
                        value=route_output,
                        input_bound=False,
                    )
                    adopted_routes.add(adopted.node_id)
                    continue
                resolution_value = adopted.document.get("resolution")
                try:
                    resolution = BarrierResolution(str(resolution_value))
                except ValueError:
                    raise TypeError(
                        f"committed barrier decision for {adopted.node_id!r} "
                        "has no resolution"
                    ) from None
                adopted_status = _BARRIER_RESOLUTION_STATUS[resolution]
                restored_results[adopted.node_id] = NodeResult(
                    node_id=adopted.node_id,
                    sequence=sequence[adopted.node_id],
                    status=adopted_status,
                    attempts=0,
                    value=(
                        portable_json_snapshot(dict(adopted.document))
                        if adopted_status is NodeStatus.SUCCEEDED
                        else None
                    ),
                    input_bound=False,
                    failure=(
                        NodeFailure(
                            FailureCode.BARRIER_NOT_SATISFIED,
                            f"barrier {adopted.node_id!r} was not satisfied",
                            adopted.node_id,
                            0,
                        )
                        if adopted_status is NodeStatus.FAILED
                        else None
                    ),
                )
                adopted_state = barrier_states.get(adopted.node_id)
                if adopted_state is not None:
                    adopted_state.decided = True
                if adopted_status is NodeStatus.AWAITING_HUMAN:
                    halted_for_human = True

        remaining = {node_id: len(graph.incoming[node_id]) for node_id in graph.nodes}
        for restored_node_id in graph.topological_order:
            if restored_node_id not in restored_results:
                continue
            for edge in graph.outgoing[restored_node_id]:
                remaining[edge.target.node] -= 1
        # A bound integrated barrier never enters the ready queue: it is decided
        # by the scheduler at a quiescence point, with zero executor attempts.
        ready = sorted(
            (
                node_id
                for node_id, count in remaining.items()
                if count == 0
                and node_id not in restored_results
                and node_id not in barrier_bindings
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

        def observe_late_arrival(source_node_id: str) -> None:
            """A source that settles after a barrier already committed.

            The committed decision is immutable either way: a late arrival
            never mutates `total`, any count, any ID list, any vote, or the
            decision identity.
            """

            for barrier_node_id, state in barrier_states.items():
                if not state.decided or source_node_id not in state.late_sources:
                    continue
                state.late_sources.discard(source_node_id)
                binding = barrier_bindings[barrier_node_id]
                if binding.policy.late_arrival != "reject":
                    continue
                late_arrival_failures.append(
                    NodeFailure(
                        FailureCode.BARRIER_LATE_ARRIVAL,
                        (
                            f"barrier {barrier_node_id!r} had already decided when "
                            f"upstream {source_node_id!r} settled"
                        ),
                        barrier_node_id,
                        0,
                        upstream_nodes=(source_node_id,),
                    )
                )

        def settle(node_id: str, result: NodeResult) -> None:
            results[node_id] = result
            completion.append(node_id)
            for edge in graph.outgoing[node_id]:
                target = edge.target.node
                remaining[target] -= 1
                if (
                    remaining[target] == 0
                    and target not in results
                    and target not in barrier_bindings
                ):
                    ready.append(target)
            ready.sort(key=sequence.__getitem__)
            observe_late_arrival(node_id)

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
                    active_incoming = _active_incoming_edges(
                        graph,
                        node_id,
                        results,
                        frozenset(adopted_routes),
                    )
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
                unsucceeded_upstream = tuple(
                    sorted(
                        {
                            edge.source.node
                            for edge in active_incoming
                            if results[edge.source.node].status is not NodeStatus.SUCCEEDED
                        }
                    )
                )
                unknown_upstream = tuple(
                    upstream_id
                    for upstream_id in unsucceeded_upstream
                    if _is_unknown_terminal(results[upstream_id])
                )
                upstream_failed = tuple(
                    upstream_id
                    for upstream_id in unsucceeded_upstream
                    if not _is_unknown_terminal(results[upstream_id])
                )
                # A descendant reachable only through a barrier that resolved
                # `unknown` inherits the zero-attempt UPSTREAM_UNKNOWN
                # terminal. A genuine upstream failure still outranks it.
                if not cancellation.cancelled and not upstream_failed and unknown_upstream:
                    await settle_without_attempt(
                        node_id,
                        NodeResult(
                            node_id=node_id,
                            sequence=sequence[node_id],
                            status=NodeStatus.SKIPPED,
                            attempts=attempt_offset,
                            input_bound=False,
                            failure=NodeFailure(
                                FailureCode.UPSTREAM_UNKNOWN,
                                "node did not start because upstream dependencies "
                                "are unknown",
                                node_id,
                                attempt_offset,
                                upstream_nodes=unknown_upstream,
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

        def barrier_node_result(
            node_id: str,
            status: NodeStatus,
            *,
            attempts: int = 0,
            value: JsonValue = None,
            failure: NodeFailure | None = None,
        ) -> NodeResult:
            return NodeResult(
                node_id=node_id,
                sequence=sequence[node_id],
                status=status,
                attempts=attempts,
                value=value,
                failure=failure,
                input_bound=False,
            )

        def bound_vote_value(edge: EdgeSpec) -> JsonValue:
            """The value a barrier edge would bind, for ballot extraction only."""

            source = results.get(edge.source.node)
            if source is None:
                return None
            try:
                return _endpoint_value(edge.source, source.value)
            except _BindingError:
                return None

        async def decide_barrier(binding: _BarrierBinding, state: _BarrierState) -> None:
            nonlocal halted_for_human, total_attempts
            node_id = binding.node_id
            if node_id not in scheduled:
                scheduled.append(node_id)
            arrivals: list[BarrierArrival] = []
            for edge in binding.incoming:
                source_result = results.get(edge.source.node)
                edge_active = source_result is None or _edge_selects(
                    graph,
                    edge,
                    source_result,
                    frozenset(adopted_routes),
                )
                resolved = _resolve_barrier_arrival(
                    binding.policy,
                    edge,
                    source_result,
                    edge_active,
                    partial(bound_vote_value, edge),
                )
                if isinstance(resolved, str):
                    # A malformed vote is never coerced to abstain or unknown
                    # and produces no disposition entry: the barrier fails
                    # non-retryably after exactly one attempt.
                    state.decided = True
                    total_attempts += 1
                    await settle_without_attempt(
                        node_id,
                        barrier_node_result(
                            node_id,
                            NodeStatus.FAILED,
                            attempts=1,
                            failure=NodeFailure(
                                FailureCode.INVALID_BARRIER_VOTE,
                                (
                                    f"barrier {node_id!r} received a malformed vote "
                                    f"from {resolved!r}"
                                ),
                                node_id,
                                1,
                                upstream_nodes=(resolved,),
                            ),
                        ),
                    )
                    return
                arrivals.append(resolved)

            armed_at_ms = state.armed_at_ms
            if armed_at_ms is None:
                raise AssertionError(f"barrier {node_id!r} decided before it armed")
            evaluation = evaluate_integrated_barrier(binding.policy, node_id, arrivals)
            document = build_barrier_decision(
                evaluation,
                policy_document=binding.policy_document,
                run_id=decision_context.run_id,
                graph_revision=decision_context.graph_revision,
                armed_at_ms=armed_at_ms,
                decided_at_ms=barrier_clock.now_ms(),
            )
            state.decided = True
            state.late_sources = {
                edge.source.node
                for edge in binding.incoming
                if edge.source.node not in results
            }
            decision_events.append(BarrierDecisionEvent("BarrierSatisfied", node_id, document))
            if evaluation.resolution is BarrierResolution.AWAITING_HUMAN:
                decision_events.append(
                    BarrierDecisionEvent("HumanInputRequested", node_id, document)
                )
                halted_for_human = True
            status = _BARRIER_RESOLUTION_STATUS[evaluation.resolution]
            await settle_without_attempt(
                node_id,
                barrier_node_result(
                    node_id,
                    status,
                    # A satisfied barrier binds the decision document. An
                    # unsatisfied one NEVER binds an output, whichever
                    # resolution it declared.
                    value=(
                        portable_json_snapshot(document)
                        if status is NodeStatus.SUCCEEDED
                        else None
                    ),
                    failure=(
                        NodeFailure(
                            FailureCode.BARRIER_NOT_SATISFIED,
                            (
                                f"barrier {node_id!r} was not satisfied "
                                f"({evaluation.reason_code.value})"
                            ),
                            node_id,
                            0,
                        )
                        if status is NodeStatus.FAILED
                        else None
                    ),
                ),
            )

        async def observe_barrier_quiescence() -> bool:
            """One quiescence point: arm every barrier that now has a bound
            upstream, then decide every barrier that is complete or whose
            deadline has elapsed. Returns True when anything settled."""

            settled_any = False
            for node_id in graph.topological_order:
                binding = barrier_bindings.get(node_id)
                state = barrier_states.get(node_id)
                if binding is None or state is None or state.decided:
                    continue

                if cancellation.cancelled:
                    # A cancelled armed barrier emits no decision event and
                    # never produces a partial decision document.
                    state.decided = True
                    settled_any = True
                    await settle_without_attempt(
                        node_id,
                        _cancelled_result(
                            node_id,
                            sequence[node_id],
                            0,
                            status=NodeStatus.SKIPPED,
                            input_bound=False,
                        )
                        if state.armed_at_ms is None
                        else barrier_node_result(node_id, NodeStatus.CANCELLED),
                    )
                    continue

                settled_sources = [
                    edge for edge in binding.incoming if edge.source.node in results
                ]
                if not settled_sources:
                    continue
                if state.armed_at_ms is None:
                    state.armed_at_ms = barrier_clock.now_ms()
                complete = len(settled_sources) == len(binding.incoming)
                deadline = binding.policy.deadline
                elapsed = (
                    deadline is not None
                    and barrier_clock.now_ms() - state.armed_at_ms >= deadline.after_ms
                )
                if not complete and not elapsed:
                    continue
                await decide_barrier(binding, state)
                settled_any = True
            return settled_any

        def awaits_deadline() -> bool:
            """True while some armed barrier can only be decided by the clock."""

            for node_id, state in barrier_states.items():
                if state.decided or state.armed_at_ms is None:
                    continue
                if barrier_bindings[node_id].policy.deadline is not None:
                    return True
            return False

        pending_tick: asyncio.Task[None] | None = None

        def tick_contender() -> asyncio.Task[None] | None:
            # At most one tick is ever outstanding, so a tick the race did not
            # win is reused rather than pulling a second scripted value.
            nonlocal pending_tick
            if pending_tick is not None:
                return pending_tick
            next_tick = getattr(barrier_clock, "next_tick", None)
            if next_tick is None:
                return None
            delivery = next_tick()
            if delivery is None:
                return None
            pending_tick = asyncio.create_task(delivery)
            return pending_tick

        try:
            while len(results) < len(graph.nodes):
                if not halted_for_human:
                    await launch_ready()
                if await observe_barrier_quiescence():
                    continue
                # A human resolution schedules no descendant and stops.
                if halted_for_human and not active:
                    break
                wait_for_tick = not halted_for_human and awaits_deadline()
                contenders: set[asyncio.Task[Any]] = set(active)
                tick_task: asyncio.Task[None] | None = None
                cancel_task: asyncio.Task[None] | None = None
                if wait_for_tick:
                    tick_task = tick_contender()
                    if tick_task is not None:
                        contenders.add(tick_task)
                    if not cancellation.cancelled:
                        # Cancellation is a quiescence point of its own, so a
                        # barrier waiting on a deadline must never outlive the
                        # run's cancellation.
                        cancel_task = asyncio.create_task(cancellation.wait())
                        contenders.add(cancel_task)
                if not active and tick_task is None:
                    if cancel_task is not None:
                        cancel_task.cancel()
                        await asyncio.gather(cancel_task, return_exceptions=True)
                    break
                try:
                    done, _ = await asyncio.wait(
                        contenders, return_when=asyncio.FIRST_COMPLETED
                    )
                finally:
                    if cancel_task is not None and not cancel_task.done():
                        cancel_task.cancel()
                        await asyncio.gather(cancel_task, return_exceptions=True)
                if pending_tick is not None and pending_tick.done():
                    delivered = pending_tick
                    pending_tick = None
                    await delivered
                # Node settlements are handled ahead of the tick so a
                # deterministic settlement is always observed at the earliest
                # quiescence point it could have produced.
                for task in sorted(
                    (item for item in done if item in active),
                    key=lambda item: sequence[active[item]],
                ):
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
        finally:
            if pending_tick is not None:
                pending_tick.cancel()
                await asyncio.gather(pending_tick, return_exceptions=True)

        # A run halted by a human resolution legitimately leaves nodes
        # unscheduled, so only settled nodes are projected.
        ordered_results = {
            node_id: results[node_id]
            for node_id in graph.topological_order
            if node_id in results
        }
        # `UPSTREAM_UNKNOWN` is excluded from graph failure codes exactly as
        # `ROUTE_NOT_SELECTED` already is: neither invents a node failure.
        failures = [
            result.failure
            for result in ordered_results.values()
            if result.failure is not None
            and result.failure.code
            not in (FailureCode.ROUTE_NOT_SELECTED, FailureCode.UPSTREAM_UNKNOWN)
        ]
        failures.extend(late_arrival_failures)
        output_values: dict[str, JsonValue] = {}
        outputs_complete = True
        for output_name in sorted(graph.spec.outputs):
            endpoint = graph.spec.outputs[output_name]
            result = results.get(endpoint.node)
            if result is None or result.status is not NodeStatus.SUCCEEDED:
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

        # Run terminal precedence, highest first: failed, cancelled,
        # awaiting_human, unknown, succeeded. A node whose only failure is its
        # own cancellation counts as a cancellation rather than a failure, so
        # the shipped `cancelled` terminal keeps outranking the NODE_CANCELLED
        # failures it necessarily emits.
        genuinely_failed = any(
            failure.code is not FailureCode.NODE_CANCELLED for failure in failures
        )
        awaiting_human = any(
            result.status is NodeStatus.AWAITING_HUMAN for result in ordered_results.values()
        )
        unknown_terminal = any(
            result.status is NodeStatus.UNKNOWN for result in ordered_results.values()
        )
        if genuinely_failed:
            status = RunStatus.FAILED
        elif cancellation.cancelled:
            status = RunStatus.CANCELLED
        elif awaiting_human:
            status = RunStatus.AWAITING_HUMAN
        elif unknown_terminal:
            status = RunStatus.UNKNOWN
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
            decision_events=tuple(decision_events),
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
        clock: MonotonicClock | None = None,
        decision: DecisionContext | None = None,
        committed_decisions: Sequence[Mapping[str, JsonValue]] | None = None,
    ) -> RunResult:
        """Run a compiled graph and return deterministic, structured results.

        This ordinary entry point implements integrated barrier execution, so
        it opts in to the `integrated-barrier-policy` capability. The durable
        entry points do not journal ``BarrierSatisfied`` yet and keep refusing.
        """

        return await self._run(
            graph,
            graph_input,
            cancel_event=cancel_event,
            integrated_barrier=True,
            clock=clock,
            decision=decision,
            committed_decisions=committed_decisions,
        )


async def run_graph(
    graph: CompiledGraph,
    graph_input: JsonValue,
    handlers: Mapping[str, NodeHandler] | None = None,
    *,
    max_concurrency: int | None = None,
    cancel_event: asyncio.Event | None = None,
    clock: MonotonicClock | None = None,
    decision: DecisionContext | None = None,
    committed_decisions: Sequence[Mapping[str, JsonValue]] | None = None,
) -> RunResult:
    """Convenience wrapper for a single scheduler run."""

    return await AsyncScheduler(handlers, max_concurrency=max_concurrency).run(
        graph,
        graph_input,
        cancel_event=cancel_event,
        clock=clock,
        decision=decision,
        committed_decisions=committed_decisions,
    )
