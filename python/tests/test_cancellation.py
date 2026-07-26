from __future__ import annotations

import asyncio
from typing import Any

import pytest

from graph_engineering import (
    CancellationSignal,
    FailureCode,
    NodeContext,
    NodeStatus,
    RunStatus,
    compile_graph,
    run_graph,
)


def node(node_id: str, **overrides: Any) -> dict[str, Any]:
    return {
        "id": node_id,
        "kind": "transform",
        "inputSchema": {},
        "outputSchema": {},
        "config": {},
        **overrides,
    }


def graph(**overrides: Any) -> dict[str, Any]:
    document: dict[str, Any] = {
        "apiVersion": "graphengineering.reacher-z.github.io/v1alpha1",
        "kind": "Graph",
        "metadata": {"name": "cancellation-test", "version": "1"},
        "inputSchema": {},
        "outputSchema": {},
        "entrypoints": ["root"],
        "outputs": {"result": {"node": "root"}},
        "nodes": [node("root")],
        "edges": [],
    }
    document.update(overrides)
    return document


def test_run_cancelled_before_scheduling_skips_every_node() -> None:
    cancel_event = asyncio.Event()
    cancel_event.set()
    calls = 0

    def handler(_: NodeContext) -> Any:
        nonlocal calls
        calls += 1
        return "should-not-run"

    result = asyncio.run(
        run_graph(
            compile_graph(graph()),
            {},
            {"root": handler},
            cancel_event=cancel_event,
        )
    )

    assert result.status is RunStatus.CANCELLED
    assert calls == 0
    assert result.total_attempts == 0
    assert result.nodes["root"].status is NodeStatus.SKIPPED
    assert result.nodes["root"].failure is not None
    assert result.nodes["root"].failure.code is FailureCode.NODE_CANCELLED


def test_running_async_handler_is_cooperatively_cancelled_and_ancestor_is_preserved() -> None:
    compiled = compile_graph(
        graph(
            outputs={"result": {"node": "never"}},
            nodes=[node("root"), node("running"), node("never")],
            edges=[
                {"id": "root-running", "from": {"node": "root"}, "to": {"node": "running"}},
                {"id": "running-never", "from": {"node": "running"}, "to": {"node": "never"}},
            ],
        )
    )

    async def scenario() -> tuple[Any, bool]:
        cancel_event = asyncio.Event()
        started = asyncio.Event()
        cleaned_up = asyncio.Event()

        async def running(context: NodeContext) -> Any:
            assert isinstance(context.cancel_signal, CancellationSignal)
            assert not hasattr(context.cancel_signal, "set")
            assert not context.cancel_signal.cancelled
            started.set()
            try:
                await asyncio.sleep(60)
            finally:
                assert context.cancel_signal.is_set()
                cleaned_up.set()

        task = asyncio.create_task(
            run_graph(
                compiled,
                {},
                {"root": lambda _: "kept", "running": running, "never": lambda _: "no"},
                cancel_event=cancel_event,
            )
        )
        await asyncio.wait_for(started.wait(), 0.5)
        cancel_event.set()
        result = await asyncio.wait_for(task, 0.5)
        return result, cleaned_up.is_set()

    result, cleaned_up = asyncio.run(scenario())

    assert result.status is RunStatus.CANCELLED
    assert cleaned_up
    assert result.nodes["root"].status is NodeStatus.SUCCEEDED
    assert result.nodes["root"].value == "kept"
    assert result.nodes["running"].status is NodeStatus.FAILED
    assert result.nodes["running"].attempts == 1
    assert result.nodes["running"].failure is not None
    assert result.nodes["running"].failure.code is FailureCode.NODE_CANCELLED
    assert result.nodes["never"].status is NodeStatus.SKIPPED
    assert result.nodes["never"].failure is not None
    assert result.nodes["never"].failure.code is FailureCode.NODE_CANCELLED


def test_cancellation_wakes_node_waiting_for_attempt_semaphore() -> None:
    compiled = compile_graph(
        graph(
            entrypoints=["running", "waiting"],
            outputs={"running": {"node": "running"}, "waiting": {"node": "waiting"}},
            nodes=[node("running"), node("waiting")],
            edges=[],
            policies={"maxConcurrency": 1},
        )
    )

    async def scenario() -> tuple[Any, bool]:
        cancel_event = asyncio.Event()
        started = asyncio.Event()
        waiting_called = False

        async def running(_: NodeContext) -> Any:
            started.set()
            await asyncio.sleep(60)

        def waiting(_: NodeContext) -> Any:
            nonlocal waiting_called
            waiting_called = True
            return "unexpected"

        task = asyncio.create_task(
            run_graph(
                compiled,
                {},
                {"running": running, "waiting": waiting},
                cancel_event=cancel_event,
            )
        )
        await asyncio.wait_for(started.wait(), 0.5)
        cancel_event.set()
        return await asyncio.wait_for(task, 0.5), waiting_called

    result, waiting_called = asyncio.run(scenario())

    assert result.status is RunStatus.CANCELLED
    assert not waiting_called
    assert result.max_observed_concurrency == 1
    assert result.nodes["running"].attempts == 1
    assert result.nodes["waiting"].attempts == 0
    assert result.nodes["waiting"].status is NodeStatus.FAILED
    assert result.nodes["waiting"].failure is not None
    assert result.nodes["waiting"].failure.code is FailureCode.NODE_CANCELLED


def test_cancellation_interrupts_retry_delay_without_polling_or_second_attempt() -> None:
    compiled = compile_graph(
        graph(
            nodes=[
                node(
                    "root",
                    retry={
                        "maxAttempts": 3,
                        "initialDelayMs": 60000,
                        "maxDelayMs": 60000,
                    },
                )
            ]
        )
    )

    async def scenario() -> tuple[Any, int]:
        cancel_event = asyncio.Event()
        attempted = asyncio.Event()
        calls = 0

        def retrying(_: NodeContext) -> Any:
            nonlocal calls
            calls += 1
            attempted.set()
            raise RuntimeError("retry later")

        task = asyncio.create_task(
            run_graph(
                compiled,
                {},
                {"root": retrying},
                cancel_event=cancel_event,
            )
        )
        await asyncio.wait_for(attempted.wait(), 0.5)
        await asyncio.sleep(0)
        cancel_event.set()
        return await asyncio.wait_for(task, 0.5), calls

    result, calls = asyncio.run(scenario())

    assert result.status is RunStatus.CANCELLED
    assert calls == 1
    assert result.total_attempts == 1
    assert result.nodes["root"].attempts == 1
    assert result.nodes["root"].failure is not None
    assert result.nodes["root"].failure.code is FailureCode.NODE_CANCELLED
    assert not result.nodes["root"].failure.retryable


def test_ordinary_node_failure_does_not_cancel_independent_work() -> None:
    compiled = compile_graph(
        graph(
            entrypoints=["bad", "good"],
            outputs={"bad": {"node": "bad"}, "good": {"node": "good"}},
            nodes=[node("bad"), node("good")],
            edges=[],
        )
    )
    cancel_event = asyncio.Event()
    good_ran = False

    def bad(_: NodeContext) -> Any:
        raise RuntimeError("ordinary failure")

    def good(_: NodeContext) -> Any:
        nonlocal good_ran
        good_ran = True
        return "good"

    result = asyncio.run(
        run_graph(
            compiled,
            {},
            {"bad": bad, "good": good},
            cancel_event=cancel_event,
        )
    )

    assert result.status is RunStatus.FAILED
    assert not cancel_event.is_set()
    assert good_ran
    assert result.nodes["good"].status is NodeStatus.SUCCEEDED
    assert result.nodes["bad"].failure is not None
    assert result.nodes["bad"].failure.code is FailureCode.NODE_EXECUTION_FAILED


def test_handler_self_cancellation_is_a_structured_node_failure() -> None:
    cancel_event = asyncio.Event()

    async def handler(_: NodeContext) -> Any:
        task = asyncio.current_task()
        assert task is not None
        task.cancel()
        await asyncio.sleep(0)

    result = asyncio.run(
        run_graph(
            compile_graph(graph()),
            {},
            {"root": handler},
            cancel_event=cancel_event,
        )
    )

    assert result.status is RunStatus.FAILED
    assert not cancel_event.is_set()
    assert result.nodes["root"].failure is not None
    assert result.nodes["root"].failure.code is FailureCode.NODE_EXECUTION_FAILED
    assert result.nodes["root"].failure.exception_type == "CancelledError"


def test_cancel_event_type_is_checked_at_api_boundary() -> None:
    with pytest.raises(TypeError, match=r"asyncio\.Event"):
        asyncio.run(
            run_graph(
                compile_graph(graph()),
                {},
                cancel_event=object(),  # type: ignore[arg-type]
            )
        )
