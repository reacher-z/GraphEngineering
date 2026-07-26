"""Deterministic ready-queue scheduler for compiled acyclic graphs."""

from __future__ import annotations

import asyncio
import inspect
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from enum import StrEnum
from types import MappingProxyType

from .compiler import CompiledGraph
from .models import Endpoint, GraphSpec, JsonValue, NodeSpec
from .portable_json import PortableJsonError, portable_json_snapshot


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


@dataclass(frozen=True, slots=True)
class NodeResult:
    node_id: str
    sequence: int
    status: NodeStatus
    attempts: int
    input: JsonValue = None
    value: JsonValue = None
    failure: NodeFailure | None = None

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


class _BindingError(ValueError):
    pass


class _InvalidOutputError(TypeError):
    pass


class _NodeCancelled(Exception):
    pass


class _HandlerCancelled(Exception):
    pass


def _snapshot_node_output(value: object) -> JsonValue:
    try:
        return portable_json_snapshot(value)
    except PortableJsonError as exc:
        raise _InvalidOutputError(
            "node returned a value that is not a portable finite JSON value"
        ) from exc


async def _resolve_node_output(value: Awaitable[JsonValue]) -> JsonValue:
    """Snapshot an async handler result before its task yields completion."""

    return _snapshot_node_output(await value)


def _identity_handler(context: NodeContext) -> JsonValue:
    return context.input


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
) -> NodeResult:
    return NodeResult(
        node_id=node_id,
        sequence=sequence,
        status=status,
        attempts=attempts,
        input=node_input,
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
            self._handlers.get(node.id)
            or self._handlers.get(node.kind)
            or self._handlers.get("*")
        )
        if handler is None and node.kind in {"transform", "barrier"}:
            return _identity_handler
        return handler

    @staticmethod
    def _bind_input(
        graph: CompiledGraph,
        node_id: str,
        graph_input: JsonValue,
        results: Mapping[str, NodeResult],
    ) -> JsonValue:
        incoming = sorted(graph.incoming[node_id], key=lambda edge: edge.id)
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
        maximum = float(node.retry.max_delay_ms or initial) if node.retry else initial
        return min(maximum, initial * multiplier ** max(0, failed_attempt - 1))

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
        claim_attempt: Callable[[], bool],
        attempt_semaphore: asyncio.Semaphore,
        on_attempt_started: Callable[[], None],
        on_attempt_finished: Callable[[], None],
    ) -> NodeResult:
        node = graph.nodes[node_id]
        if cancel_signal.cancelled:
            return _cancelled_result(
                node_id,
                sequence,
                0,
                status=NodeStatus.FAILED,
                node_input=node_input,
            )
        handler = self._handler_for(node)
        if handler is None:
            return NodeResult(
                node_id=node_id,
                sequence=sequence,
                status=NodeStatus.FAILED,
                attempts=0,
                input=node_input,
                failure=NodeFailure(
                    FailureCode.EXECUTOR_NOT_FOUND,
                    f"no executor is registered for node {node_id!r} or kind {node.kind!r}",
                    node_id,
                    0,
                ),
            )

        max_attempts = (node.retry.max_attempts or 1) if node.retry else 1
        attempts = 0
        last_failure: NodeFailure | None = None
        while attempts < max_attempts:
            if not await _acquire_attempt_slot(attempt_semaphore, cancel_signal):
                return _cancelled_result(
                    node_id,
                    sequence,
                    attempts,
                    status=NodeStatus.FAILED,
                    node_input=node_input,
                )
            on_attempt_started()
            try:
                if cancel_signal.cancelled:
                    return _cancelled_result(
                        node_id,
                        sequence,
                        attempts,
                        status=NodeStatus.FAILED,
                        node_input=node_input,
                    )
                if not claim_attempt():
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
                    return NodeResult(
                        node_id=node_id,
                        sequence=sequence,
                        status=NodeStatus.FAILED,
                        attempts=attempts,
                        input=node_input,
                        failure=last_failure,
                    )

                attempts += 1
                attempt_input = portable_json_snapshot(node_input)
                attempt_graph_input = portable_json_snapshot(graph_input)
                attempt_completed = portable_json_snapshot(dict(completed))
                if not isinstance(attempt_completed, dict):
                    raise AssertionError("completed snapshot must be an object")
                mapping_input = (
                    MappingProxyType(attempt_input)
                    if graph.incoming[node_id] and isinstance(attempt_input, dict)
                    else MappingProxyType({})
                )
                context = NodeContext(
                    graph=graph.spec,
                    node=node,
                    input=attempt_input,
                    graph_input=attempt_graph_input,
                    inputs=mapping_input,
                    completed=MappingProxyType(attempt_completed),
                    attempt=attempts,
                    cancel_signal=cancel_signal,
                )
                try:
                    value = await self._attempt(handler, context)
                except _NodeCancelled:
                    code = FailureCode.NODE_CANCELLED
                    message = f"node {node_id!r} was cancelled"
                    exception_type = None
                except _HandlerCancelled:
                    code = FailureCode.NODE_EXECUTION_FAILED
                    message = (
                        f"node {node_id!r} failed: handler was cancelled without "
                        "run cancellation"
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
                    return NodeResult(
                        node_id=node_id,
                        sequence=sequence,
                        status=NodeStatus.SUCCEEDED,
                        attempts=attempts,
                        input=node_input,
                        value=value,
                    )
            finally:
                on_attempt_finished()
                attempt_semaphore.release()

            may_retry = attempts < max_attempts and code is not FailureCode.NODE_CANCELLED
            last_failure = NodeFailure(
                code,
                message,
                node_id,
                attempts,
                retryable=may_retry,
                exception_type=exception_type,
            )
            if not may_retry:
                return NodeResult(
                    node_id=node_id,
                    sequence=sequence,
                    status=NodeStatus.FAILED,
                    attempts=attempts,
                    input=node_input,
                    failure=last_failure,
                )
            delay_ms = self._retry_delay_ms(node, attempts)
            if delay_ms > 0 and not await _delay_or_cancel(
                delay_ms / 1000, cancel_signal
            ):
                return _cancelled_result(
                    node_id,
                    sequence,
                    attempts,
                    status=NodeStatus.FAILED,
                    node_input=node_input,
                )

        raise AssertionError("bounded retry loop exited unexpectedly")

    async def run(
        self,
        graph: CompiledGraph,
        graph_input: JsonValue,
        *,
        cancel_event: asyncio.Event | None = None,
    ) -> RunResult:
        """Run a compiled graph and return deterministic, structured results."""

        try:
            graph_input_snapshot = portable_json_snapshot(graph_input)
        except PortableJsonError:
            raise TypeError(
                "graph input must be a portable finite JSON value"
            ) from None
        if cancel_event is not None and not isinstance(cancel_event, asyncio.Event):
            raise TypeError("cancel_event must be an asyncio.Event")
        cancellation = CancellationSignal(cancel_event or asyncio.Event())

        sequence = {node_id: index for index, node_id in enumerate(graph.topological_order)}
        remaining = {node_id: len(graph.incoming[node_id]) for node_id in graph.nodes}
        ready = sorted(
            (node_id for node_id, count in remaining.items() if count == 0),
            key=sequence.__getitem__,
        )
        active: dict[asyncio.Task[NodeResult], str] = {}
        results: dict[str, NodeResult] = {}
        scheduled: list[str] = []
        completion: list[str] = []
        concurrency = self._effective_concurrency(graph)
        attempt_limit = (
            graph.spec.policies.max_total_attempts
            if graph.spec.policies and graph.spec.policies.max_total_attempts is not None
            else 2**63 - 1
        )
        total_attempts = 0
        running_attempts = 0
        max_observed_concurrency = 0
        attempt_semaphore = asyncio.Semaphore(concurrency)

        def claim_attempt() -> bool:
            nonlocal total_attempts
            if total_attempts >= attempt_limit:
                return False
            total_attempts += 1
            return True

        def on_attempt_started() -> None:
            nonlocal running_attempts, max_observed_concurrency
            running_attempts += 1
            max_observed_concurrency = max(max_observed_concurrency, running_attempts)

        def on_attempt_finished() -> None:
            nonlocal running_attempts
            running_attempts -= 1

        def settle(node_id: str, result: NodeResult) -> None:
            results[node_id] = result
            completion.append(node_id)
            for edge in graph.outgoing[node_id]:
                target = edge.target.node
                remaining[target] -= 1
                if remaining[target] == 0:
                    ready.append(target)
            ready.sort(key=sequence.__getitem__)

        def launch_ready() -> None:
            while ready:
                node_id = ready.pop(0)
                scheduled.append(node_id)
                if cancellation.cancelled:
                    settle(
                        node_id,
                        _cancelled_result(
                            node_id,
                            sequence[node_id],
                            0,
                            status=NodeStatus.SKIPPED,
                        ),
                    )
                    continue
                upstream_failed = tuple(
                    sorted(
                        {
                            edge.source.node
                            for edge in graph.incoming[node_id]
                            if results[edge.source.node].status is not NodeStatus.SUCCEEDED
                        }
                    )
                )
                if upstream_failed:
                    settle(
                        node_id,
                        NodeResult(
                            node_id=node_id,
                            sequence=sequence[node_id],
                            status=NodeStatus.SKIPPED,
                            attempts=0,
                            failure=NodeFailure(
                                FailureCode.UPSTREAM_FAILED,
                                "node did not start because upstream dependencies failed",
                                node_id,
                                0,
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
                    )
                except _BindingError as exc:
                    settle(
                        node_id,
                        NodeResult(
                            node_id=node_id,
                            sequence=sequence[node_id],
                            status=NodeStatus.FAILED,
                            attempts=0,
                            failure=NodeFailure(
                                FailureCode.INPUT_BINDING_FAILED,
                                f"could not bind input for node {node_id!r}: {exc}",
                                node_id,
                                0,
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
                        attempt_semaphore,
                        on_attempt_started,
                        on_attempt_finished,
                    )
                )
                active[task] = node_id

        while len(results) < len(graph.nodes):
            launch_ready()
            if not active:
                break
            done, _ = await asyncio.wait(active, return_when=asyncio.FIRST_COMPLETED)
            for task in sorted(done, key=lambda item: sequence[active[item]]):
                node_id = active.pop(task)
                settle(node_id, task.result())

        ordered_results = {node_id: results[node_id] for node_id in graph.topological_order}
        failures = [
            result.failure
            for result in ordered_results.values()
            if result.failure is not None
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
                    )
                )

        if cancellation.cancelled:
            status = RunStatus.CANCELLED
        elif not failures and outputs_complete and len(results) == len(graph.nodes):
            status = RunStatus.SUCCEEDED
        else:
            status = RunStatus.FAILED
        outputs = MappingProxyType(output_values) if outputs_complete else None
        return RunResult(
            status=status,
            graph_hash=graph.graph_hash,
            nodes=MappingProxyType(ordered_results),
            outputs=outputs,
            failures=tuple(failures),
            scheduled_order=tuple(scheduled),
            completion_order=tuple(completion),
            max_observed_concurrency=max_observed_concurrency,
            total_attempts=total_attempts,
        )


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
