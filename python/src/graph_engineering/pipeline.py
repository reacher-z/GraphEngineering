"""Bounded, standalone per-item pipeline runtime."""

from __future__ import annotations

import asyncio
import inspect
import math
from collections.abc import (
    AsyncIterable,
    AsyncIterator,
    Awaitable,
    Callable,
    Iterable,
    Iterator,
    Mapping,
    Sequence,
)
from dataclasses import dataclass
from enum import StrEnum
from types import MappingProxyType
from typing import TypeAlias, TypeVar, cast

from .models import MAX_SAFE_INTEGER, JsonObject, JsonValue
from .portable_json import PortableJsonError, portable_json_snapshot
from .scheduler import CancellationSignal

MAX_TIMER_MILLISECONDS = 2**31 - 1
_DEFAULT_BUFFER_CAPACITY = 16
_DEFAULT_MAX_IN_FLIGHT = 16
_DEFAULT_MAX_ITEMS = 1000
_MAX_PIPELINE_STAGES = 2048
_DEFAULT_MAX_STAGES = _MAX_PIPELINE_STAGES


class PipelineItemStatus(StrEnum):
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    DROPPED = "dropped"
    CANCELLED = "cancelled"


class PipelineRunStatus(StrEnum):
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"


class PipelineFailureCode(StrEnum):
    INVALID_INPUT = "INVALID_INPUT"
    STAGE_EXECUTION_FAILED = "STAGE_EXECUTION_FAILED"
    STAGE_TIMEOUT = "STAGE_TIMEOUT"
    INVALID_OUTPUT = "INVALID_OUTPUT"
    ITEM_CANCELLED = "ITEM_CANCELLED"


class PipelineRunFailureCode(StrEnum):
    SOURCE_FAILED = "SOURCE_FAILED"
    ITEM_LIMIT_REACHED = "ITEM_LIMIT_REACHED"


class PipelineOrdering(StrEnum):
    INPUT = "input"
    COMPLETION = "completion"


class PipelineFailurePolicy(StrEnum):
    STOP = "stop"
    DROP = "drop"
    DEAD_LETTER = "dead-letter"


@dataclass(frozen=True, slots=True)
class PipelineRetryOptions:
    max_attempts: int | float = 1
    initial_delay_ms: int | float = 0
    backoff_multiplier: int | float = 1
    max_delay_ms: int | float | None = None


@dataclass(frozen=True, slots=True)
class PipelineHandlerContext:
    input: JsonValue
    item_index: int
    stage_id: str
    stage_index: int
    attempt: int
    cancel_signal: CancellationSignal


PipelineHandler: TypeAlias = Callable[[PipelineHandlerContext], object | Awaitable[object]]


@dataclass(frozen=True, slots=True)
class PipelineStage:
    id: str
    handler: PipelineHandler
    concurrency: int | float = 1
    timeout_ms: int | float | None = None
    retry: PipelineRetryOptions | None = None
    on_failure: PipelineFailurePolicy | str = PipelineFailurePolicy.DEAD_LETTER


@dataclass(frozen=True, slots=True)
class PipelineItemFailure:
    code: PipelineFailureCode
    message: str
    item_index: int
    attempt: int
    retryable: bool = False
    stage_id: str | None = None
    stage_index: int | None = None
    cause_name: str | None = None

    def to_dict(self) -> JsonObject:
        result: JsonObject = {
            "code": self.code,
            "message": self.message,
            "itemIndex": self.item_index,
        }
        if self.stage_id is not None:
            result["stageId"] = self.stage_id
        if self.stage_index is not None:
            result["stageIndex"] = self.stage_index
        result["attempt"] = self.attempt
        result["retryable"] = False
        if self.cause_name is not None:
            result["causeName"] = self.cause_name
        return result


@dataclass(frozen=True, slots=True)
class PipelineItemResult:
    item_index: int
    status: PipelineItemStatus
    input_bound: bool
    completed_stages: int
    total_attempts: int
    input: JsonValue = None
    output: JsonValue = None
    failure: PipelineItemFailure | None = None

    def to_dict(self) -> JsonObject:
        result: JsonObject = {
            "itemIndex": self.item_index,
            "status": self.status,
            "inputBound": self.input_bound,
        }
        if self.input_bound:
            result["input"] = portable_json_snapshot(self.input)
        if self.status is PipelineItemStatus.SUCCEEDED:
            result["output"] = portable_json_snapshot(self.output)
        result["completedStages"] = self.completed_stages
        result["totalAttempts"] = self.total_attempts
        if self.failure is not None:
            result["failure"] = self.failure.to_dict()
        return result


@dataclass(frozen=True, slots=True)
class PipelineRunFailure:
    code: PipelineRunFailureCode
    message: str
    cause_name: str | None = None

    def to_dict(self) -> JsonObject:
        result: JsonObject = {"code": self.code, "message": self.message}
        if self.cause_name is not None:
            result["causeName"] = self.cause_name
        return result


@dataclass(frozen=True, slots=True)
class PipelineSummary:
    status: PipelineRunStatus
    accepted: int
    emitted: int
    succeeded: int
    failed: int
    dropped: int
    cancelled: int
    max_observed_in_flight: int
    stage_max_observed_concurrency: Mapping[str, int]
    stage_max_observed_queue_depth: Mapping[str, int]
    run_failure: PipelineRunFailure | None = None

    def to_dict(self) -> JsonObject:
        result: JsonObject = {
            "status": self.status,
            "accepted": self.accepted,
            "emitted": self.emitted,
            "succeeded": self.succeeded,
            "failed": self.failed,
            "dropped": self.dropped,
            "cancelled": self.cancelled,
            "maxObservedInFlight": self.max_observed_in_flight,
            "stageMaxObservedConcurrency": dict(self.stage_max_observed_concurrency),
            "stageMaxObservedQueueDepth": dict(self.stage_max_observed_queue_depth),
        }
        if self.run_failure is not None:
            result["runFailure"] = self.run_failure.to_dict()
        return result


PipelineSource: TypeAlias = Iterable[object] | AsyncIterable[object]


@dataclass(frozen=True, slots=True)
class _Options:
    buffer_capacity: int
    max_in_flight: int
    max_items: int
    ordering: PipelineOrdering
    cancellation_signal: asyncio.Event | None


def _positive_integer(value: object, name: str) -> int:
    if type(value) is int:
        integer = value
    elif type(value) is float and math.isfinite(value):
        floating = value
        if not floating.is_integer():
            raise TypeError(f"{name} must be an integer from 1 to {MAX_SAFE_INTEGER}")
        integer = int(floating)
    else:
        raise TypeError(f"{name} must be an integer from 1 to {MAX_SAFE_INTEGER}")
    if integer < 1 or integer > MAX_SAFE_INTEGER:
        raise TypeError(f"{name} must be an integer from 1 to {MAX_SAFE_INTEGER}")
    return integer


def _max_stages(value: object) -> int:
    if type(value) is int:
        integer = value
    elif type(value) is float and math.isfinite(value):
        floating = value
        if not floating.is_integer():
            raise TypeError(f"max_stages must be an integer from 1 to {_MAX_PIPELINE_STAGES}")
        integer = int(floating)
    else:
        raise TypeError(f"max_stages must be an integer from 1 to {_MAX_PIPELINE_STAGES}")
    if integer < 1 or integer > _MAX_PIPELINE_STAGES:
        raise TypeError(f"max_stages must be an integer from 1 to {_MAX_PIPELINE_STAGES}")
    return integer


def _timer(value: object, name: str) -> int | float:
    if type(value) not in {int, float}:
        raise TypeError(f"{name} must be a finite number from 0 to {MAX_TIMER_MILLISECONDS}")
    numeric = cast(int | float, value)
    if not math.isfinite(numeric) or numeric < 0 or numeric > MAX_TIMER_MILLISECONDS:
        raise TypeError(f"{name} must be a finite number from 0 to {MAX_TIMER_MILLISECONDS}")
    return numeric


def _timeout_milliseconds(value: object, name: str) -> int:
    if type(value) is int:
        milliseconds = value
    elif type(value) is float and math.isfinite(value):
        floating = value
        if not floating.is_integer():
            raise TypeError(f"{name} must be an integer from 0 to {MAX_TIMER_MILLISECONDS}")
        milliseconds = int(floating)
    else:
        raise TypeError(f"{name} must be an integer from 0 to {MAX_TIMER_MILLISECONDS}")
    if milliseconds < 0 or milliseconds > MAX_TIMER_MILLISECONDS:
        raise TypeError(f"{name} must be an integer from 0 to {MAX_TIMER_MILLISECONDS}")
    return milliseconds


def _snapshot_stages(
    stages: object,
    max_items: int,
    max_stages: int,
) -> tuple[PipelineStage, ...]:
    if not isinstance(stages, Sequence) or isinstance(stages, (str, bytes, bytearray)):
        raise TypeError("stages must be a finite sequence of PipelineStage values")
    copied: list[PipelineStage] = []
    seen: set[str] = set()
    maximum_attempts_per_item = 0
    iterator = iter(stages)
    exhausted = False
    try:
        for index in range(max_stages + 1):
            try:
                stage = next(iterator)
            except StopIteration:
                exhausted = True
                break
            if index == max_stages:
                raise ValueError(f"pipeline stage count exceeds max_stages limit of {max_stages}")
            if type(stage) is not PipelineStage:
                raise TypeError(f"stages[{index}] must be a PipelineStage")
            if type(stage.id) is not str or not stage.id:
                raise TypeError(f"stages[{index}].id must be a non-empty string")
            if stage.id in seen:
                raise ValueError(f"duplicate pipeline stage id {stage.id!r}")
            seen.add(stage.id)
            if not callable(stage.handler):
                raise TypeError(f"stages[{index}].handler must be callable")
            concurrency = _positive_integer(stage.concurrency, f"stages[{index}].concurrency")
            timeout_ms = (
                None
                if stage.timeout_ms is None
                else _timeout_milliseconds(stage.timeout_ms, f"stages[{index}].timeout_ms")
            )
            retry = stage.retry or PipelineRetryOptions()
            if type(retry) is not PipelineRetryOptions:
                raise TypeError(f"stages[{index}].retry must be PipelineRetryOptions")
            max_attempts = _positive_integer(
                retry.max_attempts, f"stages[{index}].retry.max_attempts"
            )
            initial_delay_ms = _timer(
                retry.initial_delay_ms, f"stages[{index}].retry.initial_delay_ms"
            )
            if (
                type(retry.backoff_multiplier) not in {int, float}
                or not math.isfinite(retry.backoff_multiplier)
                or retry.backoff_multiplier < 1
            ):
                raise TypeError(
                    f"stages[{index}].retry.backoff_multiplier must be finite and at least 1"
                )
            max_delay_ms = (
                initial_delay_ms
                if retry.max_delay_ms is None
                else _timer(retry.max_delay_ms, f"stages[{index}].retry.max_delay_ms")
            )
            try:
                policy = PipelineFailurePolicy(stage.on_failure)
            except ValueError:
                raise ValueError(f"stages[{index}].on_failure is invalid") from None
            maximum_attempts_per_item += max_attempts
            if maximum_attempts_per_item > MAX_SAFE_INTEGER:
                raise ValueError("pipeline attempt bound exceeds the portable safe range")
            copied.append(
                PipelineStage(
                    id=stage.id,
                    handler=stage.handler,
                    concurrency=concurrency,
                    timeout_ms=timeout_ms,
                    retry=PipelineRetryOptions(
                        max_attempts=max_attempts,
                        initial_delay_ms=initial_delay_ms,
                        backoff_multiplier=retry.backoff_multiplier,
                        max_delay_ms=max_delay_ms,
                    ),
                    on_failure=policy,
                )
            )
    except BaseException:
        # Match JavaScript IteratorClose on abrupt configuration failure.  A
        # hostile close hook must not replace the deterministic validation
        # error that caused the unwind.
        if not exhausted:
            try:
                close = getattr(iterator, "close", None)
                if callable(close):
                    close()
            except BaseException:
                pass
        raise
    if maximum_attempts_per_item and max_items > MAX_SAFE_INTEGER // maximum_attempts_per_item:
        raise ValueError("pipeline maximum attempt count exceeds the portable safe range")
    return tuple(copied)


async def _invoke(handler: PipelineHandler, context: PipelineHandlerContext) -> object:
    value = handler(context)
    return await value if inspect.isawaitable(value) else value


async def _invoke_and_snapshot(
    handler: PipelineHandler,
    context: PipelineHandlerContext,
) -> JsonValue:
    output = await _invoke(handler, context)
    try:
        return portable_json_snapshot(output)
    except PortableJsonError:
        raise
    except (Exception, asyncio.CancelledError) as exc:
        # Snapshotting is a distinct protocol boundary from handler execution.
        # Even if portable-JSON diagnostics encounter hostile application
        # metadata, a returned unsupported value remains INVALID_OUTPUT.
        raise PortableJsonError(_exception_message(exc)) from exc


_END = object()
_T = TypeVar("_T")


def _consume_future_outcome(future: asyncio.Future[_T]) -> None:
    try:
        future.result()
    except BaseException:
        return


def _exception_name(error: BaseException) -> str:
    try:
        name = type(error).__name__
    except BaseException:
        return "Exception"
    return name if type(name) is str and name else "Exception"


def _exception_message(error: BaseException) -> str:
    name = _exception_name(error)
    try:
        message = str(error)
    except BaseException:
        return name
    return message or name


class _SourceAdapter:
    def __init__(self, source: PipelineSource) -> None:
        self._source = source
        self._iterator: AsyncIterator[object] | None = None
        self._sync_iterator: Iterator[object] | None = None
        self._closed = False

    def start(self) -> None:
        if isinstance(self._source, AsyncIterable):
            self._iterator = self._source.__aiter__()
        else:
            self._sync_iterator = iter(self._source)

    async def next(self) -> tuple[bool, object | None]:
        if self._iterator is not None:
            try:
                return True, await anext(self._iterator)
            except StopAsyncIteration:
                return False, None
        if self._sync_iterator is None:
            raise AssertionError("pipeline source was not started")
        try:
            return True, next(self._sync_iterator)
        except StopIteration:
            return False, None

    async def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        target = self._iterator if self._iterator is not None else self._sync_iterator
        if target is None:
            return
        closer = getattr(target, "aclose", None)
        if callable(closer):
            outcome = closer()
            if inspect.isawaitable(outcome):
                close_future = asyncio.ensure_future(outcome)
                await asyncio.sleep(0)
                if close_future.done():
                    _consume_future_outcome(close_future)
                else:
                    close_future.add_done_callback(_consume_future_outcome)
            return
        closer = getattr(target, "close", None)
        if callable(closer):
            outcome = closer()
            if inspect.isawaitable(outcome):
                close_future = asyncio.ensure_future(outcome)
                await asyncio.sleep(0)
                if close_future.done():
                    _consume_future_outcome(close_future)
                else:
                    close_future.add_done_callback(_consume_future_outcome)


class PipelineRun(AsyncIterator[PipelineItemResult]):
    """Single-pass asynchronous view over one bounded pipeline execution."""

    def __init__(
        self,
        source: PipelineSource,
        stages: tuple[PipelineStage, ...],
        options: _Options,
    ) -> None:
        self._source = _SourceAdapter(source)
        self._stages = stages
        self._options = options
        self._initialized = False
        self._started = False
        self._closed = False
        self._advancing = False
        self._cancel_event: asyncio.Event | None = None
        self._delivery: asyncio.Queue[PipelineItemResult | object] | None = None
        self._completion_future: asyncio.Future[PipelineSummary] | None = None
        self._producer_task: asyncio.Task[None] | None = None
        self._producer_cancel_requested = False
        self._cancellation_task: asyncio.Task[None] | None = None
        self._drain_task: asyncio.Task[None] | None = None
        self._item_tasks: set[asyncio.Task[None]] = set()
        self._credit: asyncio.Semaphore | None = None
        self._stage_slots: tuple[asyncio.Semaphore, ...] = ()
        self._stage_queues: tuple[asyncio.Semaphore, ...] = ()
        self._queue_depths = [0 for _ in stages]
        self._queue_maxima = [0 for _ in stages]
        self._active_attempts = [0 for _ in stages]
        self._active_maxima = [0 for _ in stages]
        self._commit_lock: asyncio.Lock | None = None
        self._reorder: dict[int, PipelineItemResult] = {}
        self._next_input_result = 0
        self._accepted = 0
        self._emitted = 0
        self._max_observed_in_flight = 0
        self._status_counts = {status: 0 for status in PipelineItemStatus}
        self._run_failure: PipelineRunFailure | None = None
        self._intake_stopped = False
        self._end_signalled = False

    def __aiter__(self) -> PipelineRun:
        return self

    async def __aenter__(self) -> PipelineRun:
        self._ensure_started()
        return self

    async def __aexit__(self, *_: object) -> None:
        await self.aclose()

    def _ensure_initialized(self) -> None:
        if self._initialized:
            return
        loop = asyncio.get_running_loop()
        self._initialized = True
        self._cancel_event = asyncio.Event()
        # One non-item slot is reserved for the end marker. Item records remain
        # bounded by the independently enforced in-flight credit window.
        self._delivery = asyncio.Queue(maxsize=self._options.max_in_flight + 1)
        self._completion_future = loop.create_future()
        self._credit = asyncio.Semaphore(self._options.max_in_flight)
        self._stage_slots = tuple(
            asyncio.Semaphore(cast(int, stage.concurrency)) for stage in self._stages
        )
        self._stage_queues = tuple(
            asyncio.Semaphore(self._options.buffer_capacity) for _ in self._stages
        )
        self._commit_lock = asyncio.Lock()

    def _ensure_started(self) -> None:
        self._ensure_initialized()
        if self._started:
            return
        if self._cancel_event is None or self._delivery is None:
            raise AssertionError("pipeline initialization omitted runtime primitives")
        loop = asyncio.get_running_loop()
        self._started = True
        if (
            self._options.cancellation_signal is not None
            and self._options.cancellation_signal.is_set()
        ):
            self._cancel_event.set()
            self._end_signalled = True
            self._delivery.put_nowait(_END)
            return
        try:
            self._source.start()
        except (Exception, asyncio.CancelledError) as exc:
            cause_name = _exception_name(exc)
            self._run_failure = PipelineRunFailure(
                PipelineRunFailureCode.SOURCE_FAILED,
                f"pipeline source failed to create its iterator: {_exception_message(exc)}",
                cause_name,
            )
            self._end_signalled = True
            self._delivery.put_nowait(_END)
            return
        self._producer_task = loop.create_task(self._produce())
        if self._options.cancellation_signal is not None:
            self._cancellation_task = loop.create_task(self._watch_cancellation())

    async def __anext__(self) -> PipelineItemResult:
        if self._advancing:
            raise RuntimeError("concurrent pipeline iteration is not allowed")
        if self._closed:
            raise StopAsyncIteration
        self._advancing = True
        try:
            self._ensure_started()
            if self._delivery is None or self._credit is None:
                raise AssertionError("pipeline delivery queue was not initialized")
            delivered = await self._delivery.get()
            if delivered is _END:
                self._closed = True
                await self._stop_cancellation_watcher()
                self._finish_summary(PipelineRunStatus.CANCELLED if self._cancelled else None)
                raise StopAsyncIteration
            if not isinstance(delivered, PipelineItemResult):
                raise AssertionError("pipeline delivered an invalid internal record")
            self._emitted += 1
            self._credit.release()
            await self._finish_summary_if_drained()
            return delivered
        finally:
            self._advancing = False

    @property
    def _cancelled(self) -> bool:
        return bool(
            (self._cancel_event is not None and self._cancel_event.is_set())
            or (
                self._options.cancellation_signal is not None
                and self._options.cancellation_signal.is_set()
            )
        )

    async def completion(self) -> PipelineSummary:
        self._ensure_initialized()
        if self._completion_future is None:
            raise AssertionError("pipeline completion future was not initialized")
        return await asyncio.shield(self._completion_future)

    async def _watch_cancellation(self) -> None:
        signal = self._options.cancellation_signal
        if signal is None:
            return
        await signal.wait()
        await self._cancel()
        await self._drain_after_intake_stop()

    async def _stop_cancellation_watcher(self) -> None:
        task = self._cancellation_task
        if task is None or task is asyncio.current_task() or task.done():
            return
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)

    async def _produce(self) -> None:
        try:
            while not self._intake_stopped and not self._cancelled:
                if self._accepted >= self._options.max_items:
                    self._run_failure = PipelineRunFailure(
                        PipelineRunFailureCode.ITEM_LIMIT_REACHED,
                        f"pipeline accepted its maxItems limit of {self._options.max_items}",
                    )
                    self._intake_stopped = True
                    break
                if self._credit is None:
                    raise AssertionError("pipeline credit semaphore was not initialized")
                await self._credit.acquire()
                if self._intake_stopped or self._cancelled:
                    self._credit.release()
                    break
                queue_index: int | None = None
                if self._stages:
                    queue_index = 0
                    await self._enter_stage_queue(queue_index)
                    if self._intake_stopped or self._cancelled:
                        self._leave_stage_queue(queue_index)
                        self._credit.release()
                        break
                try:
                    present, raw_item = await self._source.next()
                except (Exception, asyncio.CancelledError) as exc:
                    if queue_index is not None:
                        self._leave_stage_queue(queue_index)
                    self._credit.release()
                    if not self._producer_cancel_requested:
                        cause_name = _exception_name(exc)
                        self._run_failure = PipelineRunFailure(
                            PipelineRunFailureCode.SOURCE_FAILED,
                            f"pipeline source failed: {_exception_message(exc)}",
                            cause_name,
                        )
                        self._intake_stopped = True
                    break
                if self._intake_stopped or self._cancelled:
                    if queue_index is not None:
                        self._leave_stage_queue(queue_index)
                    self._credit.release()
                    break
                if not present:
                    if queue_index is not None:
                        self._leave_stage_queue(queue_index)
                    self._credit.release()
                    break
                item_index = self._accepted
                self._accepted += 1
                self._max_observed_in_flight = max(
                    self._max_observed_in_flight, self._accepted - self._emitted
                )
                try:
                    item_snapshot = portable_json_snapshot(raw_item)
                except (Exception, asyncio.CancelledError) as exc:
                    task = asyncio.create_task(
                        self._settle_invalid_input(
                            item_index,
                            _exception_message(exc),
                            queued=queue_index is not None,
                        )
                    )
                else:
                    task = asyncio.create_task(
                        self._process_item(
                            item_index,
                            item_snapshot,
                            queued=queue_index is not None,
                        )
                    )
                self._item_tasks.add(task)
                task.add_done_callback(self._item_tasks.discard)
            await self._close_source_safely()
            if self._item_tasks:
                await asyncio.shield(
                    asyncio.gather(*tuple(self._item_tasks), return_exceptions=False)
                )
            await self._signal_end()
        except asyncio.CancelledError:
            if (
                not self._producer_cancel_requested
                and not self._cancelled
                and not self._intake_stopped
            ):
                self._run_failure = PipelineRunFailure(
                    PipelineRunFailureCode.SOURCE_FAILED,
                    "pipeline source cancelled its own iteration",
                    "CancelledError",
                )
                await self._close_source_safely()
                if self._item_tasks:
                    await asyncio.shield(
                        asyncio.gather(*tuple(self._item_tasks), return_exceptions=False)
                    )
                await self._signal_end()
            return
        except BaseException as exc:
            if self._completion_future is not None and not self._completion_future.done():
                self._completion_future.set_exception(exc)

    async def _settle_invalid_input(
        self,
        item_index: int,
        message: str,
        *,
        queued: bool,
    ) -> None:
        if queued:
            self._leave_stage_queue(0)
        if self._cancelled:
            await self._commit_result(
                PipelineItemResult(
                    item_index=item_index,
                    status=PipelineItemStatus.CANCELLED,
                    input_bound=False,
                    completed_stages=0,
                    total_attempts=0,
                    failure=PipelineItemFailure(
                        PipelineFailureCode.ITEM_CANCELLED,
                        "pipeline cancellation won before invalid input committed",
                        item_index,
                        0,
                    ),
                )
            )
            return
        await self._commit_result(
            PipelineItemResult(
                item_index=item_index,
                status=PipelineItemStatus.FAILED,
                input_bound=False,
                completed_stages=0,
                total_attempts=0,
                failure=PipelineItemFailure(
                    PipelineFailureCode.INVALID_INPUT,
                    message,
                    item_index,
                    0,
                ),
            )
        )

    async def _process_item(
        self,
        item_index: int,
        original: JsonValue,
        *,
        queued: bool,
    ) -> None:
        try:
            if self._cancelled:
                if queued:
                    self._leave_stage_queue(0)
                await self._commit_result(
                    PipelineItemResult(
                        item_index=item_index,
                        status=PipelineItemStatus.CANCELLED,
                        input_bound=True,
                        input=portable_json_snapshot(original),
                        completed_stages=0,
                        total_attempts=0,
                        failure=PipelineItemFailure(
                            PipelineFailureCode.ITEM_CANCELLED,
                            "pipeline was cancelled after item admission",
                            item_index,
                            0,
                        ),
                    )
                )
                return
            current = original
            total_attempts = 0
            completed_stages = 0
            for stage_index, stage in enumerate(self._stages):
                if not queued:
                    entered = await self._enter_stage_queue(stage_index, cancel_on_run=True)
                    if not entered:
                        await self._commit_result(
                            self._cancelled_result(
                                item_index,
                                original,
                                completed_stages,
                                total_attempts,
                                stage_index,
                            )
                        )
                        return
                queued = False
                if self._cancelled:
                    self._leave_stage_queue(stage_index)
                    await self._commit_result(
                        self._cancelled_result(
                            item_index, original, completed_stages, total_attempts, stage_index
                        )
                    )
                    return
                value, attempts, failure, output_slot = await self._execute_stage(
                    stage, stage_index, item_index, current
                )
                total_attempts += attempts
                if self._cancelled and (
                    failure is None or failure.code is not PipelineFailureCode.ITEM_CANCELLED
                ):
                    failure = PipelineItemFailure(
                        PipelineFailureCode.ITEM_CANCELLED,
                        "pipeline cancellation won before the stage outcome committed",
                        item_index,
                        max(1, attempts),
                        stage_id=stage.id,
                        stage_index=stage_index,
                    )
                if failure is not None:
                    if output_slot is not None:
                        output_slot.release()
                    if failure.code is PipelineFailureCode.ITEM_CANCELLED:
                        status = PipelineItemStatus.CANCELLED
                    elif stage.on_failure is PipelineFailurePolicy.DROP:
                        status = PipelineItemStatus.DROPPED
                    else:
                        status = PipelineItemStatus.FAILED
                    if (
                        stage.on_failure is PipelineFailurePolicy.STOP
                        and failure.code is not PipelineFailureCode.ITEM_CANCELLED
                    ):
                        self._intake_stopped = True
                        self._schedule_intake_drain()
                    await self._commit_result(
                        PipelineItemResult(
                            item_index=item_index,
                            status=status,
                            input_bound=True,
                            input=portable_json_snapshot(original),
                            completed_stages=completed_stages,
                            total_attempts=total_attempts,
                            failure=failure,
                        )
                    )
                    return
                current = value
                completed_stages += 1
                if stage_index + 1 < len(self._stages):
                    try:
                        entered = await self._enter_stage_queue(stage_index + 1, cancel_on_run=True)
                    finally:
                        if output_slot is not None:
                            output_slot.release()
                    if not entered:
                        await self._commit_result(
                            self._cancelled_result(
                                item_index,
                                original,
                                completed_stages,
                                total_attempts,
                                stage_index + 1,
                            )
                        )
                        return
                    queued = True
                elif output_slot is not None:
                    output_slot.release()
            if self._cancelled:
                final_result = PipelineItemResult(
                    item_index=item_index,
                    status=PipelineItemStatus.CANCELLED,
                    input_bound=True,
                    input=portable_json_snapshot(original),
                    completed_stages=completed_stages,
                    total_attempts=total_attempts,
                    failure=PipelineItemFailure(
                        PipelineFailureCode.ITEM_CANCELLED,
                        "pipeline cancellation won before item success committed",
                        item_index,
                        0,
                    ),
                )
            else:
                final_result = PipelineItemResult(
                    item_index=item_index,
                    status=PipelineItemStatus.SUCCEEDED,
                    input_bound=True,
                    input=portable_json_snapshot(original),
                    output=portable_json_snapshot(current),
                    completed_stages=completed_stages,
                    total_attempts=total_attempts,
                )
            await self._commit_result(final_result)
        except asyncio.CancelledError:
            if queued and self._stages:
                self._leave_stage_queue(min(completed_stages, len(self._stages) - 1))
            raise

    async def _execute_stage(
        self,
        stage: PipelineStage,
        stage_index: int,
        item_index: int,
        stage_input: JsonValue,
    ) -> tuple[
        JsonValue,
        int,
        PipelineItemFailure | None,
        asyncio.Semaphore | None,
    ]:
        slot = self._stage_slots[stage_index]
        retry = stage.retry
        if retry is None:
            raise AssertionError("pipeline stage retry policy was not normalized")
        last_failure: PipelineItemFailure | None = None
        maximum_attempts = cast(int, retry.max_attempts)
        for attempt in range(1, maximum_attempts + 1):
            acquired = await self._acquire_unless_cancelled(slot)
            # Acquiring the slot is an await boundary. Cancellation can become
            # visible after the helper's final check but before control resumes
            # here, so recheck before creating the handler task.
            if not acquired or self._cancelled:
                if acquired:
                    slot.release()
                if attempt == 1:
                    self._leave_stage_queue(stage_index)
                return (
                    stage_input,
                    attempt - 1,
                    PipelineItemFailure(
                        PipelineFailureCode.ITEM_CANCELLED,
                        "pipeline was cancelled before the stage attempt",
                        item_index,
                        attempt - 1,
                        stage_id=stage.id,
                        stage_index=stage_index,
                    ),
                    None,
                )
            if attempt == 1:
                self._leave_stage_queue(stage_index)
            self._active_attempts[stage_index] += 1
            self._active_maxima[stage_index] = max(
                self._active_maxima[stage_index], self._active_attempts[stage_index]
            )
            try:
                outcome, failure = await self._run_attempt(
                    stage, stage_index, item_index, stage_input, attempt
                )
            except BaseException:
                self._active_attempts[stage_index] -= 1
                slot.release()
                raise
            self._active_attempts[stage_index] -= 1
            if failure is None:
                # Retain this stage's worker permit until the validated output
                # enters the downstream bounded queue. This is what propagates
                # a full downstream buffer back into upstream admission.
                return outcome, attempt, None, slot
            slot.release()
            last_failure = failure
            if (
                failure.code
                not in {
                    PipelineFailureCode.STAGE_EXECUTION_FAILED,
                    PipelineFailureCode.STAGE_TIMEOUT,
                }
                or attempt >= maximum_attempts
                or self._cancelled
            ):
                return stage_input, attempt, failure, None
            if not await self._retry_delay(retry, attempt):
                return (
                    stage_input,
                    attempt,
                    PipelineItemFailure(
                        PipelineFailureCode.ITEM_CANCELLED,
                        "pipeline cancellation interrupted retry delay",
                        item_index,
                        attempt,
                        stage_id=stage.id,
                        stage_index=stage_index,
                    ),
                    None,
                )
        if last_failure is None:
            raise AssertionError("bounded pipeline retry loop omitted its outcome")
        return stage_input, maximum_attempts, last_failure, None

    async def _run_attempt(
        self,
        stage: PipelineStage,
        stage_index: int,
        item_index: int,
        stage_input: JsonValue,
        attempt: int,
    ) -> tuple[JsonValue, PipelineItemFailure | None]:
        if self._cancel_event is None:
            raise AssertionError("pipeline cancellation signal was not initialized")
        attempt_cancel = asyncio.Event()
        context = PipelineHandlerContext(
            input=portable_json_snapshot(stage_input),
            item_index=item_index,
            stage_id=stage.id,
            stage_index=stage_index,
            attempt=attempt,
            cancel_signal=CancellationSignal(attempt_cancel),
        )
        execution = asyncio.create_task(_invoke_and_snapshot(stage.handler, context))
        cancelled = asyncio.create_task(self._cancel_event.wait())
        timeout: asyncio.Task[None] | None = None
        waiters: set[asyncio.Task[object]] = {execution, cancelled}
        if stage.timeout_ms is not None:
            timeout = asyncio.create_task(asyncio.sleep(stage.timeout_ms / 1000))
            waiters.add(timeout)
        done, _ = await asyncio.wait(waiters, return_when=asyncio.FIRST_COMPLETED)
        if execution in done:
            cancelled.cancel()
            if timeout is not None:
                timeout.cancel()
                await asyncio.gather(cancelled, timeout, return_exceptions=True)
            else:
                await asyncio.gather(cancelled, return_exceptions=True)
            try:
                raw_output = execution.result()
            except asyncio.CancelledError:
                return stage_input, PipelineItemFailure(
                    PipelineFailureCode.STAGE_EXECUTION_FAILED,
                    "stage handler cancelled itself",
                    item_index,
                    attempt,
                    stage_id=stage.id,
                    stage_index=stage_index,
                    cause_name="CancelledError",
                )
            except PortableJsonError as exc:
                return stage_input, PipelineItemFailure(
                    PipelineFailureCode.INVALID_OUTPUT,
                    _exception_message(exc),
                    item_index,
                    attempt,
                    stage_id=stage.id,
                    stage_index=stage_index,
                    cause_name="PortableJsonError",
                )
            except Exception as exc:
                cause_name = _exception_name(exc)
                return stage_input, PipelineItemFailure(
                    PipelineFailureCode.STAGE_EXECUTION_FAILED,
                    f"stage {stage.id!r} failed: {_exception_message(exc)}",
                    item_index,
                    attempt,
                    stage_id=stage.id,
                    stage_index=stage_index,
                    cause_name=cause_name,
                )
            return raw_output, None

        attempt_cancel.set()
        execution.cancel()
        execution.add_done_callback(_consume_future_outcome)
        if timeout is not None and timeout not in done:
            timeout.cancel()
        if cancelled in done or self._cancelled:
            if timeout is not None:
                await asyncio.gather(cancelled, timeout, return_exceptions=True)
            else:
                await asyncio.gather(cancelled, return_exceptions=True)
            return stage_input, PipelineItemFailure(
                PipelineFailureCode.ITEM_CANCELLED,
                "pipeline cancellation interrupted the stage",
                item_index,
                attempt,
                stage_id=stage.id,
                stage_index=stage_index,
            )
        cancelled.cancel()
        if timeout is not None:
            await asyncio.gather(cancelled, timeout, return_exceptions=True)
        else:
            await asyncio.gather(cancelled, return_exceptions=True)
        return stage_input, PipelineItemFailure(
            PipelineFailureCode.STAGE_TIMEOUT,
            f"stage {stage.id!r} timed out after {stage.timeout_ms} ms",
            item_index,
            attempt,
            stage_id=stage.id,
            stage_index=stage_index,
            cause_name="TimeoutError",
        )

    async def _retry_delay(self, retry: PipelineRetryOptions, failed_attempt: int) -> bool:
        maximum = retry.max_delay_ms
        if maximum is None:
            raise AssertionError("pipeline retry maximum delay was not normalized")
        try:
            computed = retry.initial_delay_ms * retry.backoff_multiplier ** (failed_attempt - 1)
        except OverflowError:
            computed = math.inf
        delay_ms = min(maximum, computed)
        if delay_ms <= 0:
            return not self._cancelled
        if self._cancel_event is None:
            raise AssertionError("pipeline cancellation signal was not initialized")
        delay = asyncio.create_task(asyncio.sleep(delay_ms / 1000))
        cancelled = asyncio.create_task(self._cancel_event.wait())
        done, _ = await asyncio.wait({delay, cancelled}, return_when=asyncio.FIRST_COMPLETED)
        if cancelled in done:
            delay.cancel()
            await asyncio.gather(delay, cancelled, return_exceptions=True)
            return False
        cancelled.cancel()
        await asyncio.gather(delay, cancelled, return_exceptions=True)
        return True

    async def _acquire_unless_cancelled(self, semaphore: asyncio.Semaphore) -> bool:
        if self._cancelled:
            return False
        if self._cancel_event is None:
            raise AssertionError("pipeline cancellation signal was not initialized")
        acquire = asyncio.create_task(semaphore.acquire())
        cancelled = asyncio.create_task(self._cancel_event.wait())
        done, _ = await asyncio.wait({acquire, cancelled}, return_when=asyncio.FIRST_COMPLETED)
        if cancelled in done or self._cancelled:
            if acquire in done:
                acquire.result()
                semaphore.release()
            else:
                acquire.cancel()
            if cancelled not in done:
                cancelled.cancel()
            await asyncio.gather(acquire, cancelled, return_exceptions=True)
            return False
        cancelled.cancel()
        await asyncio.gather(cancelled, return_exceptions=True)
        acquire.result()
        return True

    async def _enter_stage_queue(self, stage_index: int, *, cancel_on_run: bool = False) -> bool:
        queue = self._stage_queues[stage_index]
        if cancel_on_run:
            if not await self._acquire_unless_cancelled(queue):
                return False
        else:
            await queue.acquire()
        self._queue_depths[stage_index] += 1
        self._queue_maxima[stage_index] = max(
            self._queue_maxima[stage_index], self._queue_depths[stage_index]
        )
        return True

    def _leave_stage_queue(self, stage_index: int) -> None:
        if self._queue_depths[stage_index] <= 0:
            return
        self._queue_depths[stage_index] -= 1
        self._stage_queues[stage_index].release()

    async def _commit_result(self, result: PipelineItemResult) -> None:
        self._status_counts[result.status] += 1
        if self._delivery is None or self._commit_lock is None:
            raise AssertionError("pipeline result coordinator was not initialized")
        if self._options.ordering is PipelineOrdering.COMPLETION:
            await self._delivery.put(result)
            return
        async with self._commit_lock:
            self._reorder[result.item_index] = result
            while self._next_input_result in self._reorder:
                await self._delivery.put(self._reorder.pop(self._next_input_result))
                self._next_input_result += 1

    def _cancelled_result(
        self,
        item_index: int,
        original: JsonValue,
        completed_stages: int,
        total_attempts: int,
        stage_index: int,
    ) -> PipelineItemResult:
        stage = self._stages[stage_index]
        return PipelineItemResult(
            item_index=item_index,
            status=PipelineItemStatus.CANCELLED,
            input_bound=True,
            input=portable_json_snapshot(original),
            completed_stages=completed_stages,
            total_attempts=total_attempts,
            failure=PipelineItemFailure(
                PipelineFailureCode.ITEM_CANCELLED,
                "pipeline was cancelled before the next stage attempt",
                item_index,
                0,
                stage_id=stage.id,
                stage_index=stage_index,
            ),
        )

    async def _signal_end(self) -> None:
        if not self._end_signalled:
            self._end_signalled = True
            if self._delivery is not None:
                await self._delivery.put(_END)
        await self._finish_summary_if_drained()

    async def _finish_summary_if_drained(self) -> None:
        if not self._end_signalled or self._emitted != self._accepted:
            return
        await self._stop_cancellation_watcher()
        self._finish_summary(PipelineRunStatus.CANCELLED if self._cancelled else None)

    def _schedule_intake_drain(self) -> None:
        if self._drain_task is None:
            self._drain_task = asyncio.create_task(self._drain_after_intake_stop())

    async def _drain_after_intake_stop(self) -> None:
        producer = self._producer_task
        if producer is not None and producer is not asyncio.current_task() and not producer.done():
            await self._cancel_or_detach_producer(producer)
        active_items = tuple(self._item_tasks)
        if active_items:
            await asyncio.gather(*active_items, return_exceptions=True)
        await self._close_source_safely()
        await self._signal_end()

    async def _close_source_safely(self) -> None:
        close_task = asyncio.create_task(self._source.close())
        try:
            await asyncio.shield(close_task)
        except asyncio.CancelledError:
            # Runtime cancellation of the producer must not cancel the
            # isolated cleanup task before the source hook is invoked.
            try:
                await asyncio.shield(close_task)
            except BaseException:
                return
        except BaseException:
            # Cleanup failure is diagnostic-only under the standalone contract.
            return

    async def _cancel_or_detach_producer(self, producer: asyncio.Task[None]) -> None:
        self._producer_cancel_requested = True
        producer.cancel()
        # Cooperative sources finish in this turn. A source that suppresses
        # cancellation is detached and its eventual outcome remains observed,
        # so explicit close cannot be held hostage by arbitrary user code.
        await asyncio.sleep(0)
        if producer.done():
            await asyncio.gather(producer, return_exceptions=True)
        else:
            producer.add_done_callback(_consume_future_outcome)

    async def _cancel(self) -> None:
        if self._cancel_event is None or self._cancel_event.is_set():
            return
        self._cancel_event.set()
        self._intake_stopped = True

    def _finish_summary(self, forced: PipelineRunStatus | None = None) -> PipelineSummary:
        if self._completion_future is not None and self._completion_future.done():
            return self._completion_future.result()
        status = forced
        if status is None:
            status = (
                PipelineRunStatus.FAILED
                if self._run_failure is not None
                or self._status_counts[PipelineItemStatus.FAILED]
                or self._status_counts[PipelineItemStatus.DROPPED]
                else PipelineRunStatus.SUCCEEDED
            )
        summary = PipelineSummary(
            status=status,
            accepted=self._accepted,
            emitted=self._emitted,
            succeeded=self._status_counts[PipelineItemStatus.SUCCEEDED],
            failed=self._status_counts[PipelineItemStatus.FAILED],
            dropped=self._status_counts[PipelineItemStatus.DROPPED],
            cancelled=self._status_counts[PipelineItemStatus.CANCELLED],
            max_observed_in_flight=self._max_observed_in_flight,
            stage_max_observed_concurrency=MappingProxyType(
                {stage.id: self._active_maxima[index] for index, stage in enumerate(self._stages)}
            ),
            stage_max_observed_queue_depth=MappingProxyType(
                {stage.id: self._queue_maxima[index] for index, stage in enumerate(self._stages)}
            ),
            run_failure=self._run_failure,
        )
        if self._completion_future is not None and not self._completion_future.done():
            self._completion_future.set_result(summary)
        return summary

    async def aclose(self) -> PipelineSummary:
        self._ensure_initialized()
        if self._closed and self._completion_future is not None and self._completion_future.done():
            return self._completion_future.result()
        await self._cancel()
        self._closed = True
        if self._drain_task is not None and not self._drain_task.done():
            self._drain_task.cancel()
            await asyncio.gather(self._drain_task, return_exceptions=True)
        if self._producer_task is not None and not self._producer_task.done():
            await self._cancel_or_detach_producer(self._producer_task)
        active_items = tuple(self._item_tasks)
        if active_items:
            await asyncio.gather(*active_items, return_exceptions=True)
        await self._close_source_safely()
        await self._stop_cancellation_watcher()
        await self._signal_end()
        while self._advancing:
            await asyncio.sleep(0)
        return self._finish_summary(PipelineRunStatus.CANCELLED)


def run_pipeline(
    source: PipelineSource,
    stages: Sequence[PipelineStage],
    *,
    buffer_capacity: int | float = _DEFAULT_BUFFER_CAPACITY,
    max_in_flight: int | float = _DEFAULT_MAX_IN_FLIGHT,
    max_items: int | float = _DEFAULT_MAX_ITEMS,
    max_stages: int | float = _DEFAULT_MAX_STAGES,
    ordering: PipelineOrdering | str = PipelineOrdering.INPUT,
    cancellation_signal: asyncio.Event | None = None,
) -> PipelineRun:
    """Construct a lazy bounded pipeline without advancing ``source``."""

    if not isinstance(source, (Iterable, AsyncIterable)):
        raise TypeError("source must be an iterable or async iterable")
    validated_buffer = _positive_integer(buffer_capacity, "buffer_capacity")
    validated_in_flight = _positive_integer(max_in_flight, "max_in_flight")
    validated_max_items = _positive_integer(max_items, "max_items")
    validated_max_stages = _max_stages(max_stages)
    try:
        validated_ordering = PipelineOrdering(ordering)
    except ValueError:
        raise ValueError("ordering must be 'input' or 'completion'") from None
    if cancellation_signal is not None and not isinstance(cancellation_signal, asyncio.Event):
        raise TypeError("cancellation_signal must be an asyncio.Event")
    copied_stages = _snapshot_stages(
        stages,
        validated_max_items,
        validated_max_stages,
    )
    return PipelineRun(
        source,
        copied_stages,
        _Options(
            buffer_capacity=validated_buffer,
            max_in_flight=validated_in_flight,
            max_items=validated_max_items,
            ordering=validated_ordering,
            cancellation_signal=cancellation_signal,
        ),
    )
