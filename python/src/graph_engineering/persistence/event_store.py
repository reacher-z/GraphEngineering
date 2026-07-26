"""In-memory and fsync-backed JSONL event stores."""

from __future__ import annotations

import asyncio
import json
import os
from collections.abc import Sequence
from pathlib import Path
from typing import Protocol, runtime_checkable

from pydantic import ValidationError

from ..canonical import canonical_json
from ..events import GraphEvent
from ..models import MAX_SAFE_INTEGER, capture_graph_model_document
from .errors import (
    CorruptEventLogError,
    PersistenceIOError,
    PersistenceValidationError,
    ValidationIssue,
    VersionConflictError,
)
from .identifiers import assert_safe_identifier, identifier_hash
from .locks import process_lock


@runtime_checkable
class EventStore(Protocol):
    async def append(
        self,
        run_id: str,
        expected_version: int,
        events: Sequence[GraphEvent],
    ) -> int: ...

    async def read(
        self,
        run_id: str,
        from_sequence: int = 0,
    ) -> tuple[GraphEvent, ...]: ...


def _validate_version(value: int, name: str, *, minimum: int) -> None:
    if type(value) is not int or value < minimum or value > MAX_SAFE_INTEGER:
        raise PersistenceValidationError(
            f"{name} is invalid",
            (
                ValidationIssue(
                    f"#/{name}",
                    f"expected an integer from {minimum} through {MAX_SAFE_INTEGER}",
                ),
            ),
        )


def _validate_append(
    run_id: str,
    expected_version: int,
    actual_version: int,
    events: Sequence[GraphEvent],
) -> None:
    _validate_version(expected_version, "expectedVersion", minimum=-1)
    if expected_version != actual_version:
        raise VersionConflictError(run_id, expected_version, actual_version)

    next_sequence = actual_version + 1
    issues: list[ValidationIssue] = []
    for index, event in enumerate(events):
        if type(event) is not GraphEvent:
            issues.append(
                ValidationIssue(f"#/events/{index}", "expected a validated GraphEvent")
            )
            continue
        if event.run_id != run_id:
            issues.append(
                ValidationIssue(
                    f"#/events/{index}/runId",
                    f"expected {run_id!r}, received {event.run_id!r}",
                )
            )
        expected_sequence = next_sequence + index
        if event.sequence != expected_sequence:
            issues.append(
                ValidationIssue(
                    f"#/events/{index}/sequence",
                    f"expected {expected_sequence}, received {event.sequence}",
                )
            )
    if issues:
        raise PersistenceValidationError("event append validation failed", issues)


def _clone_event(event: GraphEvent) -> GraphEvent:
    return event.model_copy(deep=True)


def _normalize_events(events: object) -> tuple[GraphEvent, ...]:
    if not isinstance(events, Sequence) or isinstance(events, (str, bytes, bytearray)):
        raise PersistenceValidationError(
            "event append validation failed",
            (ValidationIssue("#/events", "expected an event sequence"),),
        )
    return tuple(events)


class MemoryEventStore:
    """Process-local event store with the same CAS contract as disk storage."""

    def __init__(self) -> None:
        self._events: dict[str, list[GraphEvent]] = {}
        self._locks: dict[str, asyncio.Lock] = {}

    def _lock(self, run_id: str) -> asyncio.Lock:
        return self._locks.setdefault(run_id, asyncio.Lock())

    async def append(
        self,
        run_id: str,
        expected_version: int,
        events: Sequence[GraphEvent],
    ) -> int:
        assert_safe_identifier(run_id, "runId")
        _validate_version(expected_version, "expectedVersion", minimum=-1)
        normalized_events = _normalize_events(events)
        async with self._lock(run_id):
            stream = self._events.setdefault(run_id, [])
            actual_version = stream[-1].sequence if stream else -1
            _validate_append(run_id, expected_version, actual_version, normalized_events)
            stream.extend(_clone_event(event) for event in normalized_events)
            return stream[-1].sequence if stream else -1

    async def read(
        self,
        run_id: str,
        from_sequence: int = 0,
    ) -> tuple[GraphEvent, ...]:
        assert_safe_identifier(run_id, "runId")
        _validate_version(from_sequence, "fromSequence", minimum=0)
        async with self._lock(run_id):
            return tuple(
                _clone_event(event)
                for event in self._events.get(run_id, ())
                if event.sequence >= from_sequence
            )


class JsonlEventStore:
    """Single-process-coordinated, durable JSONL event storage.

    Each append is serialized by a per-run asyncio lock, written in one binary
    append, flushed, and fsynced. Cross-process locking is intentionally outside
    this local pre-alpha contract.
    """

    def __init__(self, root: str | os.PathLike[str]) -> None:
        self.root = Path(root).resolve()
        self.events_directory = self.root / "events"
        try:
            self.events_directory.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            raise PersistenceIOError(
                "create event directory", str(self.events_directory), exc
            ) from exc
    def _lock(self, run_id: str) -> asyncio.Lock:
        return process_lock(f"event:{self.path_for_run(run_id)}")

    def path_for_run(self, run_id: str) -> Path:
        """Return the opaque on-disk path; primarily useful for diagnostics."""

        assert_safe_identifier(run_id, "runId")
        return self.events_directory / f"{identifier_hash(run_id)}.jsonl"

    @staticmethod
    def _fsync_directory(path: Path) -> None:
        flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
        descriptor = os.open(path, flags)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)

    @staticmethod
    def _decode_log(run_id: str, path: Path) -> tuple[GraphEvent, ...]:
        if not path.exists():
            return ()
        try:
            raw = path.read_bytes()
        except OSError as exc:
            raise PersistenceIOError("read event log", str(path), exc) from exc

        if not raw:
            raise CorruptEventLogError(run_id, "empty event log file")
        if raw and not raw.endswith(b"\n"):
            raise CorruptEventLogError(run_id, "truncated final JSONL record")
        events: list[GraphEvent] = []
        for line_number, raw_line in enumerate(raw.splitlines(), start=1):
            if not raw_line:
                raise CorruptEventLogError(run_id, "blank JSONL record", line_number)
            try:
                document = json.loads(raw_line)
                event = GraphEvent.model_validate(document)
            except (UnicodeDecodeError, json.JSONDecodeError, ValidationError) as exc:
                raise CorruptEventLogError(run_id, str(exc), line_number) from exc
            expected_sequence = len(events)
            if event.run_id != run_id:
                raise CorruptEventLogError(
                    run_id,
                    f"record runId {event.run_id!r} does not match file stream",
                    line_number,
                )
            if event.sequence != expected_sequence:
                raise CorruptEventLogError(
                    run_id,
                    f"expected sequence {expected_sequence}, received {event.sequence}",
                    line_number,
                )
            events.append(event)
        return tuple(events)

    @classmethod
    def _append_sync(
        cls,
        run_id: str,
        path: Path,
        expected_version: int,
        events: Sequence[GraphEvent],
    ) -> int:
        existing = cls._decode_log(run_id, path)
        actual_version = existing[-1].sequence if existing else -1
        _validate_append(run_id, expected_version, actual_version, events)
        if not events:
            return actual_version

        payload = "".join(
            f"{canonical_json(capture_graph_model_document(event, GraphEvent))}\n"
            for event in events
        ).encode("utf-8")
        created = not path.exists()
        try:
            descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
            with os.fdopen(descriptor, "ab") as handle:
                handle.write(payload)
                handle.flush()
                os.fsync(handle.fileno())
            if created:
                cls._fsync_directory(path.parent)
        except OSError as exc:
            raise PersistenceIOError("append event log", str(path), exc) from exc
        return events[-1].sequence

    async def append(
        self,
        run_id: str,
        expected_version: int,
        events: Sequence[GraphEvent],
    ) -> int:
        path = self.path_for_run(run_id)
        _validate_version(expected_version, "expectedVersion", minimum=-1)
        normalized_events = _normalize_events(events)
        async with self._lock(run_id):
            return await asyncio.to_thread(
                self._append_sync,
                run_id,
                path,
                expected_version,
                normalized_events,
            )

    async def read(
        self,
        run_id: str,
        from_sequence: int = 0,
    ) -> tuple[GraphEvent, ...]:
        path = self.path_for_run(run_id)
        _validate_version(from_sequence, "fromSequence", minimum=0)
        async with self._lock(run_id):
            events = await asyncio.to_thread(self._decode_log, run_id, path)
        return tuple(event for event in events if event.sequence >= from_sequence)
