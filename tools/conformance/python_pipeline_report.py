"""Emit deterministic bounded-pipeline projections for cross-language comparison."""

from __future__ import annotations

import asyncio
import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

from graph_engineering import (
    PipelineRetryOptions,
    PipelineStage,
    run_pipeline,
)

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = json.loads(
    (ROOT / "spec" / "conformance" / "pipeline.case.json").read_text(encoding="utf-8")
)


class _Source:
    def __init__(self, document: dict[str, Any]) -> None:
        self.document = document
        self.items = list(document.get("items", []))
        self.index = 0
        self.pulls = 0
        self.closes = 0
        self.pull_changed = asyncio.Event()

    def __iter__(self) -> Iterator[object]:
        return self

    def __next__(self) -> object:
        kind = self.document["kind"]
        if kind == "throwing-array" and self.index >= len(self.items):
            failure = self.document["thenThrow"]
            error_type = type(failure["causeName"], (RuntimeError,), {})
            raise error_type(failure["message"])
        if self.index >= len(self.items):
            raise StopIteration
        value = self.items[self.index]
        self.index += 1
        self.pulls += 1
        self.pull_changed.set()
        return value

    async def wait_for_pull_count(self, target: int) -> None:
        while self.pulls < target:
            self.pull_changed.clear()
            if self.pulls >= target:
                return
            await self.pull_changed.wait()

    def close(self) -> None:
        self.closes += 1


def _compact_item(item: Any, expected: dict[str, Any] | None) -> dict[str, Any]:
    document = dict(item.to_dict())
    if "failure" in document:
        failure = dict(document["failure"])
        failure.pop("message", None)
        expected_failure = None if expected is None else expected.get("failure")
        if not isinstance(expected_failure, dict) or "causeName" not in expected_failure:
            # causeName is diagnostic rather than byte-identical conformance
            # data. Preserve it only where the fixture explicitly contracts its
            # presence and value.
            failure.pop("causeName", None)
        document["failure"] = failure
    return document


def _compact_summary(summary: Any, expected: dict[str, Any] | None) -> dict[str, Any]:
    document = dict(summary.to_dict())
    document.pop("maxObservedInFlight", None)
    document.pop("stageMaxObservedConcurrency", None)
    document.pop("stageMaxObservedQueueDepth", None)
    failure = document.get("runFailure")
    if failure is None:
        document["runFailure"] = None
    else:
        compact = dict(failure)
        compact.pop("message", None)
        expected_failure = None if expected is None else expected.get("runFailure")
        if not isinstance(expected_failure, dict) or "causeName" not in expected_failure:
            compact.pop("causeName", None)
        document["runFailure"] = compact
    return document


async def _run_case(case: dict[str, Any]) -> dict[str, Any]:
    source_document = case["source"]
    source = _Source(source_document)
    gates = {name: asyncio.Event() for name in case.get("gates", [])}
    trace: list[str] = []

    async def action(
        document: dict[str, Any],
        *,
        stage_id: str,
        item_index: int,
    ) -> object:
        kind = document["kind"]
        if kind == "wait-for-gate":
            await gates[document["gate"]].wait()
            return await action(document["then"], stage_id=stage_id, item_index=item_index)
        if kind == "throw":
            error_type = type(document["causeName"], (RuntimeError,), {})
            raise error_type(document["message"])
        if kind == "invalid-output":
            return float("inf")
        if kind == "return":
            trace.append(f"stage:{stage_id}:item:{item_index}:return")
            return document["value"]
        raise AssertionError(f"unknown pipeline fixture action {kind!r}")

    stages: list[PipelineStage] = []
    for stage_index, stage_document in enumerate(case["stages"]):
        async def handler(context: Any, document: dict[str, Any] = stage_document) -> object:
            trace.append(f"stage:{document['id']}:item:{context.item_index}:start")
            for effect in document.get("onStartByItem", {}).get(str(context.item_index), []):
                gates[effect["releaseGate"]].set()
            outcomes = document.get("outcomesByItem", {}).get(str(context.item_index))
            if not outcomes:
                return context.input
            selected = outcomes[min(context.attempt - 1, len(outcomes) - 1)]
            return await action(
                selected,
                stage_id=document["id"],
                item_index=context.item_index,
            )

        retry_document = stage_document.get("retry")
        retry = None
        if retry_document is not None:
            retry = PipelineRetryOptions(
                max_attempts=retry_document.get("maxAttempts", 1),
                initial_delay_ms=retry_document.get("initialDelayMs", 0),
                backoff_multiplier=retry_document.get("backoffMultiplier", 1),
                max_delay_ms=retry_document.get("maxDelayMs"),
            )
        stages.append(
            PipelineStage(
                id=stage_document["id"],
                handler=handler,
                concurrency=stage_document.get("concurrency", 1),
                retry=retry,
                on_failure=stage_document.get("onFailure", "dead-letter"),
            )
        )

    options = case["options"]
    run = run_pipeline(
        source,
        stages,
        buffer_capacity=options["bufferCapacity"],
        max_in_flight=options["maxInFlight"],
        max_items=options["maxItems"],
        max_stages=options.get("maxStages", FIXTURE["defaults"]["maxStages"]),
        ordering=options["ordering"],
    )
    results: list[Any] = []
    pull_count_while_paused: int | None = None
    consumer = case.get("consumer")
    if consumer is not None:
        for _ in range(consumer["readResults"]):
            results.append(await anext(run))
        if consumer.get("thenPauseUntil") != "pipeline-idle" or stages:
            raise AssertionError(
                "the deterministic pause probe currently requires an identity pipeline"
            )
        pause_target = min(
            len(source.items), consumer["readResults"] + options["maxInFlight"]
        )
        await source.wait_for_pull_count(pause_target)
        pull_count_while_paused = source.pulls
    results.extend([item async for item in run])
    summary = await run.completion()
    observations: dict[str, int] = {
        "maxObservedInFlight": summary.max_observed_in_flight,
        "maxObservedQueueDepth": max(
            summary.stage_max_observed_queue_depth.values(), default=0
        ),
    }
    if pull_count_while_paused is not None:
        observations["sourcePullCountWhilePaused"] = pull_count_while_paused
    expectation = case.get("expect", {})
    expected_items = {
        item["itemIndex"]: item for item in expectation.get("items", [])
    }

    report: dict[str, Any] = {
        "deliveryOrder": [item.item_index for item in results],
        "items": [
            _compact_item(item, expected_items.get(item.item_index)) for item in results
        ],
        "summary": _compact_summary(summary, expectation.get("summary")),
        "sourcePullCount": source.pulls,
        "sourceCloseCount": source.closes,
        "observations": observations,
    }
    if case.get("expect", {}).get("mustOccurBefore"):
        report["requiredTraceRelations"] = [
            trace.index(before) < trace.index(after)
            for before, after in case["expect"]["mustOccurBefore"]
        ]
    return report


async def _main() -> None:
    report = {case["id"]: await _run_case(case) for case in FIXTURE["cases"]}
    print(json.dumps(report, sort_keys=True, separators=(",", ":")))


asyncio.run(_main())
