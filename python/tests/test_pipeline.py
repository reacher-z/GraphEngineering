from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Sequence
from typing import Any

import pytest

from graph_engineering import (
    PipelineFailureCode,
    PipelineFailurePolicy,
    PipelineItemStatus,
    PipelineRetryOptions,
    PipelineRun,
    PipelineRunFailureCode,
    PipelineRunStatus,
    PipelineStage,
    run_pipeline,
)


def test_pipeline_is_lazy_and_identity_preserves_null() -> None:
    class Source:
        pulls = 0
        iterated = False

        def __iter__(self) -> Source:
            self.iterated = True
            return self

        def __next__(self) -> object:
            self.pulls += 1
            if self.pulls == 1:
                return None
            raise StopIteration

    source = Source()
    run = run_pipeline(source, [], max_items=2, max_in_flight=1)
    assert source.pulls == 0

    async def consume() -> None:
        results = [item async for item in run]
        assert len(results) == 1
        assert results[0].status is PipelineItemStatus.SUCCEEDED
        assert results[0].input_bound
        assert results[0].input is None
        assert results[0].output is None
        summary = await run.completion()
        assert summary.status is PipelineRunStatus.SUCCEEDED
        assert summary.accepted == summary.emitted == 1

    asyncio.run(consume())


def test_pipeline_retries_and_dead_letters_without_stopping_siblings() -> None:
    attempts: dict[int, int] = {}

    async def handler(context: Any) -> object:
        attempts[context.item_index] = attempts.get(context.item_index, 0) + 1
        if context.item_index == 0 and context.attempt == 1:
            raise RuntimeError("transient")
        if context.item_index == 2:
            return float("inf")
        return {"value": context.input}

    run = run_pipeline(
        [1, 2, 3],
        [
            PipelineStage(
                "prepare",
                handler,
                concurrency=2,
                retry=PipelineRetryOptions(max_attempts=2),
            )
        ],
        buffer_capacity=1,
        max_in_flight=3,
        max_items=4,
    )

    async def consume() -> None:
        results = [item async for item in run]
        assert [item.item_index for item in results] == [0, 1, 2]
        assert [item.status for item in results] == [
            PipelineItemStatus.SUCCEEDED,
            PipelineItemStatus.SUCCEEDED,
            PipelineItemStatus.FAILED,
        ]
        assert results[0].total_attempts == 2
        assert results[2].failure is not None
        assert results[2].failure.code is PipelineFailureCode.INVALID_OUTPUT
        assert results[2].total_attempts == 1
        summary = await run.completion()
        assert summary.status is PipelineRunStatus.FAILED
        assert summary.succeeded == 2
        assert summary.failed == 1
        assert summary.max_observed_in_flight <= 3
        assert summary.stage_max_observed_concurrency["prepare"] <= 2
        assert summary.stage_max_observed_queue_depth["prepare"] <= 1

    asyncio.run(consume())


def test_hostile_exception_stringification_is_structured_and_releases_stage_slot() -> None:
    class HostileError(Exception):
        def __str__(self) -> str:
            raise RuntimeError("exception stringification failed")

    calls: list[int] = []

    async def handler(context: Any) -> object:
        calls.append(context.item_index)
        if context.item_index == 0:
            raise HostileError
        return context.input

    async def consume() -> None:
        run = run_pipeline(
            [0, 1],
            [PipelineStage("work", handler, concurrency=1)],
            buffer_capacity=2,
            max_in_flight=2,
            max_items=3,
        )
        results = await asyncio.wait_for(_collect(run), timeout=1)

        assert calls == [0, 1]
        assert [item.status for item in results] == [
            PipelineItemStatus.FAILED,
            PipelineItemStatus.SUCCEEDED,
        ]
        first = results[0]
        assert first.total_attempts == 1
        assert first.failure is not None
        assert first.failure.code is PipelineFailureCode.STAGE_EXECUTION_FAILED
        assert first.failure.attempt == 1
        assert first.failure.cause_name == "HostileError"
        assert "HostileError" in first.failure.message
        summary = await run.completion()
        assert summary.accepted == summary.emitted == 2
        assert summary.failed == 1
        assert summary.succeeded == 1

    asyncio.run(consume())


def test_hostile_invalid_input_diagnostic_is_structured_without_hanging() -> None:
    calls: list[str] = []

    class HostileTypeName(type):
        def __getattribute__(cls, name: str) -> object:
            if name == "__name__":
                calls.append(name)
                raise RuntimeError("hostile type name")
            return super().__getattribute__(name)

    class InvalidInput(metaclass=HostileTypeName):
        pass

    async def consume() -> None:
        run = run_pipeline([InvalidInput()], [], max_items=2)
        results = await asyncio.wait_for(_collect(run), timeout=1)

        assert len(results) == 1
        result = results[0]
        assert result.status is PipelineItemStatus.FAILED
        assert not result.input_bound
        assert result.total_attempts == 0
        assert result.failure is not None
        assert result.failure.code is PipelineFailureCode.INVALID_INPUT
        assert result.failure.message == "value is not portable JSON"
        assert calls == []
        summary = await run.completion()
        assert summary.status is PipelineRunStatus.FAILED
        assert summary.accepted == summary.emitted == 1
        assert summary.failed == 1

    asyncio.run(consume())


def test_hostile_invalid_output_diagnostic_remains_invalid_output() -> None:
    calls: list[str] = []

    class HostileTypeName(type):
        def __getattribute__(cls, name: str) -> object:
            if name == "__name__":
                calls.append(name)
                raise RuntimeError("hostile output type name")
            return super().__getattribute__(name)

    class InvalidOutput(metaclass=HostileTypeName):
        pass

    async def consume() -> None:
        run = run_pipeline(
            [1],
            [PipelineStage("work", lambda _: InvalidOutput())],
            max_items=2,
        )
        result = await asyncio.wait_for(anext(run), timeout=1)

        assert result.status is PipelineItemStatus.FAILED
        assert result.total_attempts == 1
        assert result.failure is not None
        assert result.failure.code is PipelineFailureCode.INVALID_OUTPUT
        assert result.failure.message == "value is not portable JSON"
        assert result.failure.cause_name == "PortableJsonError"
        assert calls == []
        with pytest.raises(StopAsyncIteration):
            await anext(run)

    asyncio.run(consume())


def test_retry_receives_a_fresh_input_snapshot() -> None:
    async def consume() -> None:
        seen: list[object] = []

        def handler(context: Any) -> object:
            seen.append(context.input)
            context.input["values"].append(context.attempt)
            if context.attempt == 1:
                raise RuntimeError("retry")
            return context.input

        run = run_pipeline(
            [{"values": []}],
            [
                PipelineStage(
                    "work",
                    handler,
                    retry=PipelineRetryOptions(max_attempts=2),
                )
            ],
            max_items=2,
        )
        result = await anext(run)
        assert seen == [{"values": [1]}, {"values": [2]}]
        assert result.output == {"values": [2]}
        assert [item async for item in run] == []

    asyncio.run(consume())


def test_stop_policy_closes_without_one_extra_pull() -> None:
    class Source:
        def __init__(self) -> None:
            self.pulls = 0
            self.closes = 0

        def __iter__(self) -> Source:
            return self

        def __next__(self) -> str:
            self.pulls += 1
            return "stop" if self.pulls == 1 else "must-not-pull"

        def close(self) -> None:
            self.closes += 1

    source = Source()

    def fail(_: Any) -> object:
        raise RuntimeError("stop")

    run = run_pipeline(
        source,
        [PipelineStage("gate", fail, on_failure=PipelineFailurePolicy.STOP)],
        buffer_capacity=1,
        max_in_flight=1,
        max_items=3,
    )

    async def consume() -> None:
        results = [item async for item in run]
        assert len(results) == 1
        assert results[0].status is PipelineItemStatus.FAILED
        assert source.pulls == 1
        assert source.closes == 1

    asyncio.run(consume())


def test_stop_policy_drains_every_already_accepted_sibling() -> None:
    async def consume() -> None:
        sibling_started = asyncio.Event()
        release_sibling = asyncio.Event()

        async def handler(context: Any) -> object:
            if context.item_index == 0:
                await sibling_started.wait()
                raise RuntimeError("stop")
            sibling_started.set()
            await release_sibling.wait()
            return "sibling-finished"

        run = run_pipeline(
            ["stop", "sibling", "must-not-pull"],
            [
                PipelineStage(
                    "work",
                    handler,
                    concurrency=2,
                    on_failure="stop",
                )
            ],
            buffer_capacity=2,
            max_in_flight=2,
            max_items=4,
        )
        release_sibling.set()
        results = [item async for item in run]
        assert len(results) == 2
        assert results[0].status is PipelineItemStatus.FAILED
        assert results[1].status is PipelineItemStatus.SUCCEEDED
        summary = await run.completion()
        assert summary.accepted == 2
        assert summary.failed == 1
        assert summary.succeeded == 1

    asyncio.run(consume())


def test_item_limit_stops_without_probing_source() -> None:
    class Source:
        def __init__(self) -> None:
            self.pulls = 0

        def __iter__(self) -> Source:
            return self

        def __next__(self) -> int:
            self.pulls += 1
            return self.pulls

    source = Source()
    run = run_pipeline(source, [], max_items=2, max_in_flight=2)

    async def consume() -> None:
        assert len([item async for item in run]) == 2
        summary = await run.completion()
        assert source.pulls == 2
        assert summary.run_failure is not None
        assert summary.run_failure.code is PipelineRunFailureCode.ITEM_LIMIT_REACHED

    asyncio.run(consume())


def test_async_source_failure_drains_accepted_prefix() -> None:
    async def source() -> AsyncIterator[int]:
        yield 1
        yield 2
        raise RuntimeError("offline")

    run = run_pipeline(source(), [], max_items=4, max_in_flight=3)

    async def consume() -> None:
        assert [item.output async for item in run] == [1, 2]
        summary = await run.completion()
        assert summary.status is PipelineRunStatus.FAILED
        assert summary.run_failure is not None
        assert summary.run_failure.code is PipelineRunFailureCode.SOURCE_FAILED

    asyncio.run(consume())


def test_async_source_self_cancellation_is_a_source_failure() -> None:
    async def source() -> AsyncIterator[int]:
        yield 1
        raise asyncio.CancelledError

    run = run_pipeline(source(), [], max_items=3, max_in_flight=2)

    async def consume() -> None:
        assert [item.output async for item in run] == [1]
        summary = await run.completion()
        assert summary.status is PipelineRunStatus.FAILED
        assert summary.run_failure is not None
        assert summary.run_failure.code is PipelineRunFailureCode.SOURCE_FAILED
        assert summary.run_failure.cause_name == "CancelledError"

    asyncio.run(consume())


def test_async_source_task_self_cancellation_is_a_source_failure() -> None:
    class Source:
        def __aiter__(self) -> Source:
            return self

        async def __anext__(self) -> int:
            current = asyncio.current_task()
            assert current is not None
            current.cancel()
            await asyncio.sleep(0)
            raise AssertionError("self-cancellation must interrupt the source pull")

    async def consume() -> None:
        run = run_pipeline(Source(), [], max_items=2)
        assert await asyncio.wait_for(_collect(run), timeout=1) == []
        summary = await run.completion()
        assert summary.status is PipelineRunStatus.FAILED
        assert summary.run_failure is not None
        assert summary.run_failure.code is PipelineRunFailureCode.SOURCE_FAILED
        assert summary.run_failure.cause_name == "CancelledError"

    asyncio.run(consume())


def test_fast_item_enters_later_stage_without_whole_stage_barrier() -> None:
    release_slow = asyncio.Event()
    fast_reached_second = asyncio.Event()

    async def first(context: Any) -> str:
        if context.item_index == 0:
            await release_slow.wait()
            return "slow-first"
        return "fast-first"

    async def second(context: Any) -> str:
        if context.item_index == 1:
            fast_reached_second.set()
            release_slow.set()
            return "fast-done"
        return "slow-done"

    run = run_pipeline(
        ["slow", "fast"],
        [
            PipelineStage("first", first, concurrency=2),
            PipelineStage("second", second),
        ],
        buffer_capacity=1,
        max_in_flight=2,
        max_items=3,
    )

    async def consume() -> None:
        results = [item async for item in run]
        assert fast_reached_second.is_set()
        assert [item.item_index for item in results] == [0, 1]
        assert [item.output for item in results] == ["slow-done", "fast-done"]

    asyncio.run(consume())


def test_completion_order_delivers_the_first_committed_terminal_item() -> None:
    async def consume() -> None:
        release_slow = asyncio.Event()
        fast_finished = asyncio.Event()

        async def handler(context: Any) -> object:
            if context.item_index == 0:
                await release_slow.wait()
                return "slow"
            fast_finished.set()
            return "fast"

        run = run_pipeline(
            [0, 1],
            [PipelineStage("work", handler, concurrency=2)],
            max_items=3,
            max_in_flight=2,
            ordering="completion",
        )
        first = await anext(run)
        assert fast_finished.is_set()
        assert first.item_index == 1
        release_slow.set()
        second = await anext(run)
        assert second.item_index == 0
        assert [item async for item in run] == []

    asyncio.run(consume())


def test_slow_consumer_bounds_source_pull_ahead() -> None:
    class Source:
        def __init__(self) -> None:
            self.pulls = 0

        def __iter__(self) -> Source:
            return self

        def __next__(self) -> int:
            if self.pulls >= 5:
                raise StopIteration
            value = self.pulls
            self.pulls += 1
            return value

    source = Source()
    run = run_pipeline(
        source,
        [],
        buffer_capacity=1,
        max_in_flight=2,
        max_items=6,
        ordering="completion",
    )

    async def consume() -> None:
        first = await anext(run)
        assert first.item_index == 0
        for _ in range(20):
            if source.pulls == 3:
                break
            await asyncio.sleep(0)
        assert source.pulls <= 3
        remainder = [item async for item in run]
        assert {item.item_index for item in [first, *remainder]} == set(range(5))

    asyncio.run(consume())


def test_full_downstream_buffer_stops_additional_upstream_attempts() -> None:
    async def consume() -> None:
        downstream_started = asyncio.Event()
        release_downstream = asyncio.Event()
        upstream_calls = 0

        async def upstream(context: Any) -> object:
            nonlocal upstream_calls
            upstream_calls += 1
            return context.input

        async def downstream(context: Any) -> object:
            if context.item_index == 0:
                downstream_started.set()
                await release_downstream.wait()
            return context.input

        run = run_pipeline(
            list(range(5)),
            [
                PipelineStage("upstream", upstream, concurrency=1),
                PipelineStage("downstream", downstream, concurrency=1),
            ],
            buffer_capacity=1,
            max_in_flight=5,
            max_items=6,
        )
        pending_read = asyncio.create_task(anext(run))
        await downstream_started.wait()
        for _ in range(10):
            await asyncio.sleep(0)
        # One item is active downstream, one is buffered, and at most one
        # upstream worker may be blocked trying to enqueue its completed output.
        assert upstream_calls <= 3
        release_downstream.set()
        first = await pending_read
        assert len([first, *[item async for item in run]]) == 5

    asyncio.run(consume())


def test_large_run_keeps_fixed_in_flight_and_queue_high_water() -> None:
    async def consume() -> None:
        async def increment(context: Any) -> int:
            await asyncio.sleep(0)
            return context.input + 1

        run = run_pipeline(
            range(1_000),
            [
                PipelineStage("one", increment, concurrency=4),
                PipelineStage("two", increment, concurrency=4),
                PipelineStage("three", increment, concurrency=4),
            ],
            buffer_capacity=2,
            max_in_flight=8,
            max_items=1_001,
            ordering="completion",
        )
        results = [item async for item in run]
        assert len(results) == 1_000
        summary = await run.completion()
        assert summary.max_observed_in_flight <= 8
        assert max(summary.stage_max_observed_queue_depth.values()) <= 2
        assert max(summary.stage_max_observed_concurrency.values()) <= 4

    asyncio.run(consume())


def test_stage_concurrency_metric_reaches_but_never_exceeds_the_limit() -> None:
    async def consume() -> None:
        active = 0
        observed = 0
        all_slots_used = asyncio.Event()
        release = asyncio.Event()

        async def handler(context: Any) -> object:
            nonlocal active, observed
            active += 1
            observed = max(observed, active)
            if active == 3:
                all_slots_used.set()
            try:
                await release.wait()
                return context.input
            finally:
                active -= 1

        run = run_pipeline(
            [0, 1, 2, 3],
            [PipelineStage("work", handler, concurrency=3)],
            buffer_capacity=4,
            max_in_flight=4,
            max_items=5,
        )
        collecting = asyncio.create_task(_collect(run))
        await asyncio.wait_for(all_slots_used.wait(), timeout=1)
        assert active == observed == 3
        release.set()
        assert len(await collecting) == 4
        summary = await run.completion()
        assert summary.stage_max_observed_concurrency == {"work": 3}

    asyncio.run(consume())


def test_pre_cancelled_pipeline_never_pulls_source() -> None:
    class Source:
        pulls = 0
        iterated = False

        def __iter__(self) -> Source:
            self.iterated = True
            return self

        def __next__(self) -> int:
            self.pulls += 1
            return 1

    source = Source()

    async def consume() -> None:
        cancelled = asyncio.Event()
        cancelled.set()
        run = run_pipeline(source, [], cancellation_signal=cancelled)
        assert [item async for item in run] == []
        summary = await run.completion()
        assert summary.status is PipelineRunStatus.CANCELLED
        assert source.pulls == 0
        assert not source.iterated

    asyncio.run(consume())


def test_cancellation_during_iterator_construction_prevents_first_pull() -> None:
    class Source:
        def __init__(self, cancellation: asyncio.Event) -> None:
            self.cancellation = cancellation
            self.pulls = 0
            self.closes = 0

        def __iter__(self) -> Source:
            self.cancellation.set()
            return self

        def __next__(self) -> int:
            self.pulls += 1
            return 1

        def close(self) -> None:
            self.closes += 1

    async def consume() -> None:
        cancellation = asyncio.Event()
        source = Source(cancellation)
        run = run_pipeline(source, [], cancellation_signal=cancellation)
        assert [item async for item in run] == []
        summary = await run.completion()
        assert summary.status is PipelineRunStatus.CANCELLED
        assert summary.accepted == 0
        assert source.pulls == 0
        assert source.closes == 1

    asyncio.run(consume())


def test_source_iterator_construction_failure_is_structured() -> None:
    class Source:
        def __iter__(self) -> Source:
            raise RuntimeError("cannot open")

        def __next__(self) -> int:
            raise AssertionError("unreachable")

    run = run_pipeline(Source(), [], max_items=2)

    async def consume() -> None:
        assert [item async for item in run] == []
        summary = await run.completion()
        assert summary.status is PipelineRunStatus.FAILED
        assert summary.run_failure is not None
        assert summary.run_failure.code is PipelineRunFailureCode.SOURCE_FAILED
        assert summary.run_failure.cause_name == "RuntimeError"

    asyncio.run(consume())


def test_source_iterator_construction_self_cancellation_is_structured() -> None:
    class Source:
        def __iter__(self) -> Source:
            raise asyncio.CancelledError

    async def consume() -> None:
        run = run_pipeline(Source(), [], max_items=2)
        assert await asyncio.wait_for(_collect(run), timeout=1) == []
        summary = await run.completion()
        assert summary.status is PipelineRunStatus.FAILED
        assert summary.run_failure is not None
        assert summary.run_failure.code is PipelineRunFailureCode.SOURCE_FAILED
        assert summary.run_failure.cause_name == "CancelledError"

    asyncio.run(consume())


def test_running_cancellation_is_structured() -> None:
    async def consume() -> None:
        started = asyncio.Event()
        cancelled = asyncio.Event()

        async def handler(context: Any) -> object:
            started.set()
            await context.cancel_signal.wait()
            return "late-success"

        run = run_pipeline(
            [1],
            [PipelineStage("work", handler)],
            max_items=2,
            max_in_flight=1,
            cancellation_signal=cancelled,
        )
        next_result = asyncio.create_task(anext(run))
        await started.wait()
        cancelled.set()
        result = await asyncio.wait_for(next_result, timeout=1)
        assert result.status is PipelineItemStatus.CANCELLED
        assert result.failure is not None
        assert result.failure.code is PipelineFailureCode.ITEM_CANCELLED
        assert [item async for item in run] == []
        assert (await run.completion()).status is PipelineRunStatus.CANCELLED

    asyncio.run(consume())


def test_stage_timeout_retries_to_exact_bound() -> None:
    calls = 0

    async def consume() -> None:
        nonlocal calls

        async def handler(_: Any) -> object:
            nonlocal calls
            calls += 1
            await asyncio.Event().wait()
            return "never"

        run = run_pipeline(
            [1],
            [
                PipelineStage(
                    "work",
                    handler,
                    timeout_ms=1,
                    retry=PipelineRetryOptions(max_attempts=2),
                )
            ],
            max_items=2,
            max_in_flight=1,
        )
        result = await anext(run)
        assert result.status is PipelineItemStatus.FAILED
        assert result.total_attempts == 2
        assert result.failure is not None
        assert result.failure.code is PipelineFailureCode.STAGE_TIMEOUT
        assert calls == 2
        assert [item async for item in run] == []

    asyncio.run(consume())


def test_cancellation_wakes_retry_delay_and_preserves_attempt_count() -> None:
    async def consume() -> None:
        first_failed = asyncio.Event()
        cancellation = asyncio.Event()

        async def handler(_: Any) -> object:
            first_failed.set()
            raise RuntimeError("retry")

        run = run_pipeline(
            [1],
            [
                PipelineStage(
                    "work",
                    handler,
                    retry=PipelineRetryOptions(max_attempts=2, initial_delay_ms=10_000),
                )
            ],
            max_items=2,
            cancellation_signal=cancellation,
        )
        pending = asyncio.create_task(anext(run))
        await first_failed.wait()
        await asyncio.sleep(0)
        cancellation.set()
        result = await asyncio.wait_for(pending, timeout=1)
        assert result.status is PipelineItemStatus.CANCELLED
        assert result.total_attempts == 1
        assert result.failure is not None
        assert result.failure.attempt == 1
        assert [item async for item in run] == []

    asyncio.run(consume())


def test_cancellation_accounts_items_waiting_in_a_stage_queue() -> None:
    async def consume() -> None:
        started = asyncio.Event()
        cancellation = asyncio.Event()
        calls: list[int] = []

        async def handler(context: Any) -> object:
            calls.append(context.item_index)
            if context.item_index == 0:
                started.set()
            await context.cancel_signal.wait()
            return context.input

        run = run_pipeline(
            [0, 1, 2],
            [PipelineStage("work", handler, concurrency=1)],
            buffer_capacity=1,
            max_in_flight=3,
            max_items=4,
            cancellation_signal=cancellation,
        )
        first_read = asyncio.create_task(anext(run))
        await started.wait()
        cancellation.set()
        first = await asyncio.wait_for(first_read, timeout=1)
        rest = [item async for item in run]
        results = [first, *rest]
        assert results
        assert all(item.status is PipelineItemStatus.CANCELLED for item in results)
        assert calls == [0]
        summary = await run.completion()
        assert summary.accepted == len(results)
        assert summary.cancelled == len(results)

    asyncio.run(consume())


def test_cancellation_after_slot_acquire_prevents_handler_start(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def consume() -> None:
        cancellation = asyncio.Event()
        calls = 0
        original_acquire = PipelineRun._acquire_unless_cancelled

        async def acquire_then_cancel(pipeline: PipelineRun, semaphore: asyncio.Semaphore) -> bool:
            acquired = await original_acquire(pipeline, semaphore)
            if acquired:
                cancellation.set()
            return acquired

        monkeypatch.setattr(
            PipelineRun,
            "_acquire_unless_cancelled",
            acquire_then_cancel,
        )

        async def handler(context: Any) -> object:
            nonlocal calls
            calls += 1
            return context.input

        run = run_pipeline(
            [1],
            [PipelineStage("work", handler)],
            max_items=2,
            cancellation_signal=cancellation,
        )
        results = [item async for item in run]

        assert calls == 0
        assert len(results) == 1
        assert results[0].status is PipelineItemStatus.CANCELLED
        assert results[0].total_attempts == 0
        assert results[0].failure is not None
        assert results[0].failure.attempt == 0
        summary = await run.completion()
        assert summary.status is PipelineRunStatus.CANCELLED
        assert summary.stage_max_observed_concurrency == {"work": 0}

    asyncio.run(consume())


def test_early_close_is_idempotent_and_accounts_accepted_items() -> None:
    async def consume() -> None:
        run = run_pipeline(range(10), [], max_items=11, max_in_flight=2)
        first = await anext(run)
        assert first.item_index == 0
        summary = await run.aclose()
        assert summary.status is PipelineRunStatus.CANCELLED
        assert summary.accepted == (
            summary.succeeded + summary.failed + summary.dropped + summary.cancelled
        )
        assert await run.aclose() == summary

    asyncio.run(consume())


def test_close_wakes_a_pending_read_and_summary_counts_any_delivery() -> None:
    async def consume() -> None:
        started = asyncio.Event()

        async def handler(context: Any) -> object:
            started.set()
            await context.cancel_signal.wait()
            return "late"

        run = run_pipeline([1], [PipelineStage("work", handler)], max_items=2)
        pending_read = asyncio.create_task(anext(run))
        await started.wait()
        summary = await asyncio.wait_for(run.aclose(), timeout=1)
        delivered = await asyncio.wait_for(pending_read, timeout=1)
        assert delivered.status is PipelineItemStatus.CANCELLED
        assert summary.emitted == 1
        assert summary.accepted == 1

    asyncio.run(consume())


def test_source_close_self_cancellation_is_diagnostic_only() -> None:
    async def consume() -> None:
        release_handler = asyncio.Event()

        class Source:
            def __init__(self) -> None:
                self.sent = False
                self.close_called = asyncio.Event()

            def __iter__(self) -> Source:
                return self

            def __next__(self) -> int:
                if self.sent:
                    raise StopIteration
                self.sent = True
                return 1

            def close(self) -> None:
                self.close_called.set()
                current = asyncio.current_task()
                assert current is not None
                current.cancel()

        async def handler(context: Any) -> object:
            await release_handler.wait()
            return context.input

        source = Source()
        run = run_pipeline(
            source,
            [PipelineStage("work", handler)],
            max_in_flight=2,
            max_items=2,
        )
        pending = asyncio.create_task(anext(run))
        await asyncio.wait_for(source.close_called.wait(), timeout=1)
        release_handler.set()

        result = await asyncio.wait_for(pending, timeout=1)
        assert result.status is PipelineItemStatus.SUCCEEDED
        with pytest.raises(StopAsyncIteration):
            await anext(run)
        summary = await run.completion()
        assert summary.status is PipelineRunStatus.SUCCEEDED
        assert summary.run_failure is None

    asyncio.run(consume())


def test_close_detaches_a_source_that_suppresses_cancellation() -> None:
    class Source:
        def __init__(self) -> None:
            self.started = asyncio.Event()
            self.release = asyncio.Event()
            self.cancel_seen = asyncio.Event()
            self.closes = 0

        def __aiter__(self) -> Source:
            return self

        async def __anext__(self) -> int:
            self.started.set()
            try:
                await self.release.wait()
            except asyncio.CancelledError:
                self.cancel_seen.set()
                await self.release.wait()
            return 1

        async def aclose(self) -> None:
            self.closes += 1

    async def consume() -> None:
        source = Source()
        run = run_pipeline(source, [], max_items=2, max_in_flight=1)
        pending_read = asyncio.create_task(anext(run))
        await source.started.wait()
        summary = await asyncio.wait_for(run.aclose(), timeout=1)
        with pytest.raises(StopAsyncIteration):
            await asyncio.wait_for(pending_read, timeout=1)
        assert source.cancel_seen.is_set()
        assert source.closes == 1
        assert summary.status is PipelineRunStatus.CANCELLED
        assert summary.accepted == 0

        source.release.set()
        for _ in range(3):
            await asyncio.sleep(0)

    asyncio.run(consume())


def test_caller_cancellation_does_not_promote_a_late_source_failure() -> None:
    class Source:
        def __init__(self) -> None:
            self.started = asyncio.Event()

        def __aiter__(self) -> Source:
            return self

        async def __anext__(self) -> int:
            self.started.set()
            try:
                await asyncio.Future()
            except asyncio.CancelledError:
                raise RuntimeError("late source failure after cancellation") from None

    async def consume() -> None:
        cancellation = asyncio.Event()
        source = Source()
        run = run_pipeline(
            source,
            [],
            max_items=2,
            max_in_flight=1,
            cancellation_signal=cancellation,
        )
        pending_read = asyncio.create_task(anext(run))
        await source.started.wait()
        cancellation.set()

        with pytest.raises(StopAsyncIteration):
            await asyncio.wait_for(pending_read, timeout=1)
        summary = await run.completion()
        assert summary.status is PipelineRunStatus.CANCELLED
        assert summary.run_failure is None

    asyncio.run(consume())


def test_stop_policy_does_not_recancel_source_for_item_cancellation() -> None:
    class Source:
        def __init__(self) -> None:
            self.calls = 0
            self.second_pull_started = asyncio.Event()
            self.release = asyncio.Event()
            self.cancel_count = 0

        def __aiter__(self) -> Source:
            return self

        async def __anext__(self) -> int:
            self.calls += 1
            if self.calls == 1:
                return 1
            self.second_pull_started.set()
            while not self.release.is_set():
                try:
                    await self.release.wait()
                except asyncio.CancelledError:
                    self.cancel_count += 1
            raise StopAsyncIteration

    async def consume() -> None:
        cancellation = asyncio.Event()
        source = Source()

        async def handler(context: Any) -> object:
            await context.cancel_signal.wait()
            return context.input

        run = run_pipeline(
            source,
            [PipelineStage("work", handler, on_failure=PipelineFailurePolicy.STOP)],
            buffer_capacity=2,
            max_in_flight=2,
            max_items=3,
            cancellation_signal=cancellation,
        )
        pending_read = asyncio.create_task(anext(run))
        await source.second_pull_started.wait()
        cancellation.set()

        result = await asyncio.wait_for(pending_read, timeout=1)
        assert result.status is PipelineItemStatus.CANCELLED
        assert [item async for item in run] == []
        summary = await run.completion()
        assert summary.status is PipelineRunStatus.CANCELLED
        assert source.cancel_count == 1

        source.release.set()
        for _ in range(3):
            await asyncio.sleep(0)
        assert source.cancel_count == 1

    asyncio.run(consume())


def test_async_context_closes_after_early_loop_break() -> None:
    async def consume() -> None:
        run = run_pipeline(range(10), [], max_items=11, max_in_flight=2)
        async with run as active:
            async for item in active:
                assert item.item_index == 0
                break
        summary = await run.completion()
        assert summary.status is PipelineRunStatus.CANCELLED
        assert summary.emitted == 1
        assert summary.accepted == (
            summary.succeeded + summary.failed + summary.dropped + summary.cancelled
        )

    asyncio.run(consume())


def test_normal_completion_leaves_no_pipeline_owned_tasks() -> None:
    async def consume() -> None:
        cancellation = asyncio.Event()
        run = run_pipeline(
            [1, 2],
            [PipelineStage("identity", lambda context: context.input)],
            max_items=3,
            cancellation_signal=cancellation,
        )
        assert len([item async for item in run]) == 2
        await run.completion()
        await asyncio.sleep(0)
        current = asyncio.current_task()
        assert {task for task in asyncio.all_tasks() if task is not current} == set()

    asyncio.run(consume())


def test_wire_projection_distinguishes_null_from_absence() -> None:
    async def consume() -> None:
        success_run = run_pipeline([None], [], max_items=2)
        success = await anext(success_run)
        assert success.to_dict()["input"] is None
        assert success.to_dict()["output"] is None
        assert "failure" not in success.to_dict()
        assert [item async for item in success_run] == []

        failed_run = run_pipeline([object()], [], max_items=2)
        failed = await anext(failed_run)
        document = failed.to_dict()
        assert document["inputBound"] is False
        assert "input" not in document
        assert "output" not in document
        assert document["failure"]["code"] == "INVALID_INPUT"  # type: ignore[index]
        assert [item async for item in failed_run] == []

    asyncio.run(consume())


def test_mathematical_integers_normalize_and_invalid_config_is_eager() -> None:
    class Source:
        iterated = False

        def __iter__(self) -> Source:
            self.iterated = True
            return self

        def __next__(self) -> int:
            raise StopIteration

    source = Source()
    run = run_pipeline(
        source,
        [PipelineStage("stage", lambda context: context.input, concurrency=1.0)],
        buffer_capacity=1.0,
        max_in_flight=1.0,
        max_items=2.0,
        max_stages=1.0,
    )
    assert not source.iterated
    asyncio.run(run.aclose())
    assert not source.iterated

    with pytest.raises(TypeError):
        run_pipeline(source, [], max_in_flight=True)
    with pytest.raises(TypeError):
        run_pipeline(source, [], max_items=1.5)
    with pytest.raises(TypeError):
        run_pipeline(source, [PipelineStage("bad", lambda _: None, timeout_ms=0.5)])
    with pytest.raises(ValueError, match="duplicate"):
        run_pipeline(
            source,
            [
                PipelineStage("same", lambda context: context.input),
                PipelineStage("same", lambda context: context.input),
            ],
        )
    with pytest.raises(ValueError, match="attempt"):
        run_pipeline(
            source,
            [
                PipelineStage(
                    "unsafe",
                    lambda context: context.input,
                    retry=PipelineRetryOptions(max_attempts=2),
                )
            ],
            max_items=2**53 - 1,
        )
    assert not source.iterated


@pytest.mark.parametrize("stage_count", [1, 2])
def test_max_stages_accepts_under_and_exact_limit(stage_count: int) -> None:
    async def consume() -> None:
        stages = [
            PipelineStage(f"stage-{index}", lambda context: context.input)
            for index in range(stage_count)
        ]
        run = run_pipeline(
            [1],
            stages,
            max_items=2,
            max_stages=2,
        )

        result = await anext(run)
        assert result.status is PipelineItemStatus.SUCCEEDED
        assert result.output == 1
        assert result.completed_stages == stage_count
        assert [item async for item in run] == []

    asyncio.run(consume())


def test_stage_overflow_does_not_read_extra_stage_or_construct_source() -> None:
    reads: list[str] = []

    class Source:
        iterated = False

        def __iter__(self) -> Source:
            self.iterated = True
            return self

        def __next__(self) -> int:
            raise StopIteration

    class ExtraStage:
        def __getattribute__(self, name: str) -> object:
            reads.append(name)
            raise AssertionError("overflow stage properties must not be read")

    source = Source()
    stages: list[object] = [
        PipelineStage("first", lambda context: context.input),
        PipelineStage("second", lambda context: context.input),
        ExtraStage(),
    ]

    with pytest.raises(
        ValueError,
        match=r"^pipeline stage count exceeds max_stages limit of 2$",
    ):
        run_pipeline(source, stages, max_stages=2)  # type: ignore[arg-type]

    assert reads == []
    assert not source.iterated


def test_infinite_stage_sequence_stops_after_limit_plus_one_pull() -> None:
    class InfiniteStages(Sequence[PipelineStage]):
        def __init__(self) -> None:
            self.pulls = 0

        def __getitem__(
            self,
            index: int | slice,
        ) -> PipelineStage | Sequence[PipelineStage]:
            if isinstance(index, slice):
                return ()
            self.pulls += 1
            return PipelineStage(f"stage-{index}", lambda context: context.input)

        def __len__(self) -> int:
            return 0

    stages = InfiniteStages()

    with pytest.raises(
        ValueError,
        match=r"^pipeline stage count exceeds max_stages limit of 2$",
    ):
        run_pipeline([], stages, max_stages=2)

    assert stages.pulls == 3


def test_stage_overflow_closes_iterator_and_preserves_overflow_error() -> None:
    class Stages(Sequence[PipelineStage]):
        def __init__(self) -> None:
            self.iterator: Any | None = None

        def __iter__(self) -> Any:
            owner = self

            class TrackingIterator:
                def __init__(self) -> None:
                    self.pulls = 0
                    self.close_calls = 0

                def __iter__(self) -> TrackingIterator:
                    return self

                def __next__(self) -> PipelineStage:
                    index = self.pulls
                    self.pulls += 1
                    return PipelineStage(f"stage-{index}", lambda context: context.input)

                def close(self) -> None:
                    self.close_calls += 1
                    raise RuntimeError("hostile close")

            owner.iterator = TrackingIterator()
            return owner.iterator

        def __getitem__(self, index: int | slice) -> PipelineStage:
            raise AssertionError("iteration must use __iter__")

        def __len__(self) -> int:
            return 0

    stages = Stages()

    with pytest.raises(
        ValueError,
        match=r"^pipeline stage count exceeds max_stages limit of 2$",
    ):
        run_pipeline([], stages, max_stages=2)

    assert stages.iterator is not None
    assert stages.iterator.pulls == 3
    assert stages.iterator.close_calls == 1


@pytest.mark.parametrize(
    "value",
    [0, -1, True, 1.5, float("nan"), float("inf"), 2049],
)
def test_invalid_max_stages_is_rejected_eagerly(value: object) -> None:
    class Source:
        iterated = False

        def __iter__(self) -> Source:
            self.iterated = True
            return self

        def __next__(self) -> int:
            raise StopIteration

    source = Source()

    with pytest.raises(TypeError, match="max_stages"):
        run_pipeline(source, [], max_stages=value)  # type: ignore[arg-type]

    assert not source.iterated


def test_empty_source_succeeds_without_invoking_a_stage() -> None:
    def forbidden(_: Any) -> object:
        raise AssertionError("an empty source must not invoke handlers")

    run = run_pipeline([], [PipelineStage("unused", forbidden)], max_items=1)

    async def consume() -> None:
        assert [item async for item in run] == []
        summary = await run.completion()
        assert summary.status is PipelineRunStatus.SUCCEEDED
        assert summary.accepted == summary.emitted == 0
        assert summary.stage_max_observed_concurrency == {"unused": 0}

    asyncio.run(consume())


def test_completion_waiter_does_not_start_source_without_consumer_demand() -> None:
    async def consume() -> None:
        class Source:
            def __init__(self) -> None:
                self.pulls = 0

            def __iter__(self) -> Source:
                return self

            def __next__(self) -> int:
                if self.pulls:
                    raise StopIteration
                self.pulls += 1
                return 1

        source = Source()
        run = run_pipeline(source, [], max_items=2)
        waiting = asyncio.create_task(run.completion())
        await asyncio.sleep(0)
        assert source.pulls == 0
        assert not waiting.done()
        assert (await anext(run)).output == 1
        assert [item async for item in run] == []
        assert (await waiting).status is PipelineRunStatus.SUCCEEDED

    asyncio.run(consume())


def test_completion_settles_after_last_result_without_reading_end_marker() -> None:
    async def consume() -> None:
        run = run_pipeline([1], [], max_in_flight=1, max_items=2)
        result = await anext(run)
        assert result.output == 1

        summary = await asyncio.wait_for(run.completion(), timeout=1)
        assert summary.status is PipelineRunStatus.SUCCEEDED
        assert summary.accepted == summary.emitted == 1

        with pytest.raises(StopAsyncIteration):
            await anext(run)
        assert await run.completion() is summary

    asyncio.run(consume())


def test_stop_cancels_an_outstanding_async_source_pull_and_closes_once() -> None:
    async def consume() -> None:
        class Source:
            def __init__(self) -> None:
                self.pulls = 0
                self.closes = 0
                self.second_pull_started = asyncio.Event()

            def __aiter__(self) -> Source:
                return self

            async def __anext__(self) -> str:
                self.pulls += 1
                if self.pulls == 1:
                    return "stop"
                self.second_pull_started.set()
                await asyncio.Event().wait()
                raise AssertionError("unreachable")

            async def aclose(self) -> None:
                self.closes += 1

        source = Source()

        async def fail(_: Any) -> object:
            await source.second_pull_started.wait()
            raise RuntimeError("stop while pull is pending")

        run = run_pipeline(
            source,
            [PipelineStage("gate", fail, on_failure="stop")],
            buffer_capacity=1,
            max_in_flight=2,
            max_items=3,
        )
        results = await asyncio.wait_for(
            _collect(run),
            timeout=1,
        )
        assert len(results) == 1
        assert results[0].status is PipelineItemStatus.FAILED
        assert source.pulls == 2
        assert source.closes == 1

    asyncio.run(consume())


def test_stop_does_not_promote_a_late_source_failure() -> None:
    class Source:
        def __init__(self) -> None:
            self.calls = 0
            self.second_pull_started = asyncio.Event()

        def __aiter__(self) -> Source:
            return self

        async def __anext__(self) -> str:
            self.calls += 1
            if self.calls == 1:
                return "stop"
            self.second_pull_started.set()
            try:
                await asyncio.Future()
            except asyncio.CancelledError:
                raise RuntimeError("late source failure after stop") from None

    async def consume() -> None:
        source = Source()

        async def handler(_: Any) -> object:
            await source.second_pull_started.wait()
            raise ValueError("stop item")

        run = run_pipeline(
            source,
            [PipelineStage("work", handler, on_failure=PipelineFailurePolicy.STOP)],
            buffer_capacity=2,
            max_in_flight=2,
            max_items=3,
        )
        results = [item async for item in run]

        assert len(results) == 1
        assert results[0].status is PipelineItemStatus.FAILED
        summary = await run.completion()
        assert summary.status is PipelineRunStatus.FAILED
        assert summary.run_failure is None

    asyncio.run(consume())


def test_timeout_observes_a_late_non_cooperative_failure() -> None:
    async def consume() -> None:
        started = asyncio.Event()
        release = asyncio.Event()
        loop_errors: list[dict[str, Any]] = []
        loop = asyncio.get_running_loop()
        old_handler = loop.get_exception_handler()
        loop.set_exception_handler(lambda _loop, context: loop_errors.append(context))

        async def handler(_: Any) -> object:
            started.set()
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                await release.wait()
                raise RuntimeError("late failure") from None

        try:
            run = run_pipeline(
                [1],
                [PipelineStage("work", handler, timeout_ms=1)],
                max_items=2,
                max_in_flight=1,
            )
            result = await anext(run)
            assert started.is_set()
            assert result.failure is not None
            assert result.failure.code is PipelineFailureCode.STAGE_TIMEOUT
            assert [item async for item in run] == []
            release.set()
            await asyncio.sleep(0)
            await asyncio.sleep(0)
            assert loop_errors == []
        finally:
            loop.set_exception_handler(old_handler)

    asyncio.run(consume())


def test_concurrent_next_is_rejected_without_stealing_a_result() -> None:
    async def consume() -> None:
        started = asyncio.Event()
        release = asyncio.Event()

        async def handler(context: Any) -> object:
            started.set()
            await release.wait()
            return context.input

        run = run_pipeline([1], [PipelineStage("work", handler)], max_items=2)
        first_read = asyncio.create_task(anext(run))
        await started.wait()
        with pytest.raises(RuntimeError, match="concurrent"):
            await anext(run)
        release.set()
        assert (await first_read).output == 1
        assert [item async for item in run] == []

    asyncio.run(consume())


def test_drop_is_explicit_and_mutation_cannot_change_snapshots() -> None:
    owned_output = {"value": [1]}
    source_value = {"input": [1]}
    stages = [
        PipelineStage(
            "stage",
            lambda context: (
                (_ for _ in ()).throw(RuntimeError("drop"))
                if context.item_index == 0
                else owned_output
            ),
            on_failure="drop",
        )
    ]
    run = run_pipeline(["bad", source_value], stages, max_items=3)
    stages.clear()

    async def consume() -> None:
        results = [item async for item in run]
        source_value["input"].append(2)
        owned_output["value"].append(2)
        assert results[0].status is PipelineItemStatus.DROPPED
        assert results[0].failure is not None
        assert results[0].failure.code is PipelineFailureCode.STAGE_EXECUTION_FAILED
        assert results[1].status is PipelineItemStatus.SUCCEEDED
        assert results[1].input == {"input": [1]}
        assert results[1].output == {"value": [1]}

    asyncio.run(consume())


def test_source_value_is_snapshotted_before_the_next_pull_can_mutate_it() -> None:
    class Source:
        def __init__(self) -> None:
            self.shared = {"values": [1]}
            self.pull = 0

        def __iter__(self) -> Source:
            return self

        def __next__(self) -> object:
            self.pull += 1
            if self.pull == 1:
                return self.shared
            if self.pull == 2:
                self.shared["values"].append(2)
                return "second"
            raise StopIteration

    run = run_pipeline(Source(), [], max_items=3, max_in_flight=2)

    async def consume() -> None:
        results = [item async for item in run]
        assert results[0].input == {"values": [1]}
        assert results[0].output == {"values": [1]}

    asyncio.run(consume())


def test_handler_output_is_snapshotted_in_the_attempt_completion_turn() -> None:
    async def consume() -> None:
        owned = {"values": [1]}

        async def handler(_: Any) -> object:
            asyncio.get_running_loop().call_soon(owned["values"].append, 2)
            return owned

        run = run_pipeline([0], [PipelineStage("work", handler)], max_items=2)
        result = await anext(run)
        assert result.output == {"values": [1]}
        assert owned == {"values": [1, 2]}
        assert [item async for item in run] == []

    asyncio.run(consume())


async def _collect(run: Any) -> list[Any]:
    return [item async for item in run]
