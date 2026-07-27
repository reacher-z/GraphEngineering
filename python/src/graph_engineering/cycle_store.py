"""D7 cycle event/checkpoint store contracts and deterministic local adapter.

``MemoryCycleStore`` is intentionally a deterministic unit-test and local
simulation adapter.  It is process-local, has no crash durability, and must not
be used as evidence for production persistence or distributed fencing.
"""

from __future__ import annotations

import asyncio
import inspect
from collections.abc import Awaitable, Callable, Sequence
from typing import Protocol, TypeAlias, runtime_checkable

from .canonical import canonical_json
from .cycle_contract import (
    CycleErrorCode,
    CycleEvent,
    CycleRuntimeError,
    capture_portable_json,
    cycle_event_document,
    validate_cycle_event,
)
from .models import JsonObject

FaultHook: TypeAlias = Callable[[str], Awaitable[None] | None]


async def run_fault_hook(hook: FaultHook | None, boundary: str) -> None:
    """Run one deterministic crash/fault boundary without swallowing BaseException."""

    if hook is None:
        return
    outcome = hook(boundary)
    if inspect.isawaitable(outcome):
        await outcome


@runtime_checkable
class CycleStore(Protocol):
    async def read(
        self,
        stream_id: str,
        *,
        through_sequence: int | None = None,
    ) -> tuple[CycleEvent, ...]: ...

    async def append(
        self,
        stream_id: str,
        expected_tail_sequence: int,
        events: Sequence[CycleEvent],
    ) -> int: ...

    async def read_by_controller_run_id(
        self,
        controller_run_id: str,
        *,
        through_sequence: int | None = None,
    ) -> tuple[CycleEvent, ...]: ...

    async def load_checkpoint(
        self,
        checkpoint_scope: str,
        checkpoint_id: str,
    ) -> JsonObject | None: ...

    async def save_checkpoint(
        self,
        checkpoint_scope: str,
        checkpoint_id: str,
        expected_stream_tail: int,
        checkpoint: JsonObject,
    ) -> None: ...


class MemoryCycleStore:
    """Atomic process-local D7 adapter for tests and deterministic examples.

    The adapter deep-detaches every write and read, performs expected-version
    compare-and-swap under one lock, and supports fault injection around every
    store boundary.  It deliberately makes no fsync, multi-process, or
    production-durability claim.
    """

    production_durable = False
    distributed_fencing = False

    def __init__(self, *, fault_hook: FaultHook | None = None) -> None:
        self._events: dict[str, tuple[JsonObject, ...]] = {}
        self._controller_streams: dict[str, str] = {}
        self._checkpoints: dict[tuple[str, str], JsonObject] = {}
        self._lock = asyncio.Lock()
        self._fault_hook = fault_hook
        self.read_count = 0
        self.append_count = 0
        self.checkpoint_read_count = 0
        self.checkpoint_write_count = 0

    async def read(
        self,
        stream_id: str,
        *,
        through_sequence: int | None = None,
    ) -> tuple[CycleEvent, ...]:
        await run_fault_hook(self._fault_hook, "store:before-read")
        async with self._lock:
            self.read_count += 1
            documents = self._events.get(stream_id, ())
            if through_sequence is not None:
                if type(through_sequence) is not int or through_sequence < 0:
                    raise CycleRuntimeError(
                        CycleErrorCode.INVALID_HISTORY,
                        "through_sequence must be a nonnegative exact integer",
                    )
                documents = documents[: through_sequence + 1]
            result = tuple(validate_cycle_event(document) for document in documents)
        await run_fault_hook(self._fault_hook, "store:after-read")
        return result

    async def append(
        self,
        stream_id: str,
        expected_tail_sequence: int,
        events: Sequence[CycleEvent],
    ) -> int:
        await run_fault_hook(self._fault_hook, "store:before-append")
        if type(events) not in (tuple, list) or not events:
            raise CycleRuntimeError(
                CycleErrorCode.STORE_FAILED,
                "event append requires a nonempty exact sequence",
            )
        detached = tuple(
            cycle_event_document(validate_cycle_event(event)) for event in events
        )
        async with self._lock:
            current = self._events.get(stream_id, ())
            actual_tail = len(current) - 1
            if expected_tail_sequence != actual_tail:
                raise CycleRuntimeError(
                    CycleErrorCode.VERSION_CONFLICT,
                    "cycle event append lost expected-version CAS",
                    details={
                        "expectedTailSequence": expected_tail_sequence,
                        "actualTailSequence": actual_tail,
                    },
                )
            previous_hash = current[-1]["recordHash"] if current else None
            seen_ids = {str(item["eventId"]) for item in current}
            for offset, document in enumerate(detached, start=1):
                required_sequence = actual_tail + offset
                if document["sequence"] != required_sequence:
                    raise CycleRuntimeError(
                        CycleErrorCode.STORE_FAILED,
                        "event sequence does not continue the stream",
                    )
                if document["expectedPreviousSequence"] != required_sequence - 1:
                    raise CycleRuntimeError(
                        CycleErrorCode.STORE_FAILED,
                        "event expectedPreviousSequence does not continue the stream",
                    )
                if document["previousEventHash"] != previous_hash:
                    raise CycleRuntimeError(
                        CycleErrorCode.STORE_FAILED,
                        "event previousEventHash does not continue the stream",
                    )
                event_id = str(document["eventId"])
                if event_id in seen_ids:
                    raise CycleRuntimeError(
                        CycleErrorCode.STORE_FAILED,
                        "event identity is duplicated",
                        details={"eventId": event_id},
                    )
                seen_ids.add(event_id)
                previous_hash = document["recordHash"]
            await run_fault_hook(self._fault_hook, "store:inside-append-before-commit")
            for event in events:
                await run_fault_hook(
                    self._fault_hook,
                    f"store:event:{event.type}:before-commit",
                )
            if not current:
                first = detached[0]
                if first["type"] != "ControllerCreated":
                    raise CycleRuntimeError(
                        CycleErrorCode.STORE_FAILED,
                        "new cycle stream must begin with ControllerCreated",
                    )
                run_id = str(first["controllerRunId"])
                existing_stream = self._controller_streams.get(run_id)
                if existing_stream is not None and existing_stream != stream_id:
                    raise CycleRuntimeError(
                        CycleErrorCode.VERSION_CONFLICT,
                        "controllerRunId is already indexed by another stream",
                    )
            self._events[stream_id] = (*current, *detached)
            if not current:
                run_id = str(detached[0]["controllerRunId"])
                self._controller_streams[run_id] = stream_id
            self.append_count += 1
            committed_tail = len(self._events[stream_id]) - 1
            for event in events:
                await run_fault_hook(
                    self._fault_hook,
                    f"store:event:{event.type}:after-commit-before-return",
                )
        await run_fault_hook(self._fault_hook, "store:after-append")
        return committed_tail

    async def read_by_controller_run_id(
        self,
        controller_run_id: str,
        *,
        through_sequence: int | None = None,
    ) -> tuple[CycleEvent, ...]:
        async with self._lock:
            stream_id = self._controller_streams.get(controller_run_id)
        if stream_id is None:
            raise CycleRuntimeError(
                CycleErrorCode.INVALID_HISTORY,
                "controllerRunId does not resolve to a cycle stream",
            )
        return await self.read(stream_id, through_sequence=through_sequence)

    async def load_checkpoint(
        self,
        checkpoint_scope: str,
        checkpoint_id: str,
    ) -> JsonObject | None:
        await run_fault_hook(self._fault_hook, "checkpoint:before-load")
        async with self._lock:
            self.checkpoint_read_count += 1
            value = self._checkpoints.get((checkpoint_scope, checkpoint_id))
            detached = None if value is None else capture_portable_json(value)
        await run_fault_hook(self._fault_hook, "checkpoint:after-load")
        if detached is None:
            return None
        if type(detached) is not dict:  # pragma: no cover - internal invariant
            raise CycleRuntimeError(CycleErrorCode.STORE_FAILED, "checkpoint is not an object")
        return detached

    async def save_checkpoint(
        self,
        checkpoint_scope: str,
        checkpoint_id: str,
        expected_stream_tail: int,
        checkpoint: JsonObject,
    ) -> None:
        await run_fault_hook(self._fault_hook, "checkpoint:before-save")
        captured = capture_portable_json(checkpoint)
        if type(captured) is not dict:
            raise CycleRuntimeError(CycleErrorCode.STORE_FAILED, "checkpoint must be an object")
        # Canonicalization here proves the process-local cache is serializable;
        # semantic prefix validation remains the controller/fold's job.
        canonical_json(captured)
        async with self._lock:
            stream_id = str(captured.get("eventStreamId", ""))
            actual_tail = len(self._events.get(stream_id, ())) - 1
            if actual_tail != expected_stream_tail:
                raise CycleRuntimeError(
                    CycleErrorCode.VERSION_CONFLICT,
                    "checkpoint save lost event-tail CAS",
                    details={
                        "expectedTailSequence": expected_stream_tail,
                        "actualTailSequence": actual_tail,
                    },
                )
            if captured.get("lastSequence") != expected_stream_tail:
                raise CycleRuntimeError(
                    CycleErrorCode.STORE_FAILED,
                    "checkpoint does not name the expected stream tail",
                )
            await run_fault_hook(self._fault_hook, "checkpoint:inside-save-before-commit")
            self._checkpoints[(checkpoint_scope, checkpoint_id)] = captured
            self.checkpoint_write_count += 1
        await run_fault_hook(self._fault_hook, "checkpoint:after-save")

    async def unsafe_replace_events_for_test(
        self,
        stream_id: str,
        documents: Sequence[JsonObject],
    ) -> None:
        """Install hostile bytes for fold tests; never used by runtime code."""

        detached: list[JsonObject] = []
        for document in documents:
            value = capture_portable_json(document)
            if type(value) is not dict:
                raise TypeError("test event must be an object")
            detached.append(value)
        async with self._lock:
            self._events[stream_id] = tuple(detached)
            if detached:
                self._controller_streams[str(detached[0]["controllerRunId"])] = stream_id


__all__ = [
    "CycleStore",
    "FaultHook",
    "MemoryCycleStore",
    "run_fault_hook",
]
