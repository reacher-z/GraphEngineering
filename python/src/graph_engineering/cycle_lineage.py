"""Bounded, content-addressed offline lineage packages for D7 cycle replay."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Never, cast

from .canonical import canonical_json
from .cycle_contract import (
    CycleErrorCode,
    CycleEvent,
    CycleRuntimeError,
    capture_portable_json,
    cycle_event_document,
    domain_hash,
    validate_cycle_request,
)
from .cycle_fold import CycleFold, fold_cycle_events
from .cycle_store import CycleStore
from .models import JsonObject

CYCLE_LINEAGE_MANIFEST_DOMAIN = "graph-engineering/cycle-lineage-manifest/v1alpha1\0"
MAX_CYCLE_LINEAGE_DEPTH = 32
MAX_CYCLE_LINEAGE_STREAMS = MAX_CYCLE_LINEAGE_DEPTH + 1
MAX_CYCLE_LINEAGE_EVENTS = 1_024
MAX_CYCLE_LINEAGE_MANIFEST_BYTES = 16_777_216

_IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
_HASH = re.compile(r"^[0-9a-f]{64}$")
_BINDING_KEYS = frozenset(
    {
        "controllerRunId",
        "controllerId",
        "hostRunId",
        "eventStreamId",
        "throughSequence",
        "recordHash",
        "historyPrefixHash",
        "requestHash",
        "controllerHash",
    }
)


@dataclass(frozen=True, slots=True)
class CycleLineageReplayResult:
    """All validated root-to-target folds from one immutable manifest."""

    manifest: JsonObject
    folds: tuple[CycleFold, ...]

    @property
    def target(self) -> CycleFold:
        return self.folds[-1]


def _invalid(message: str, *, details: dict[str, Any] | None = None) -> Never:
    raise CycleRuntimeError(
        CycleErrorCode.INVALID_HISTORY,
        message,
        details=details or {},
    )


def _object(value: object, label: str) -> dict[str, Any]:
    if type(value) is not dict:
        _invalid(f"{label} must be an object")
    return cast(dict[str, Any], value)


def _closed(value: dict[str, Any], keys: frozenset[str], label: str) -> None:
    actual = frozenset(value)
    if actual != keys:
        _invalid(
            f"{label} must be closed",
            details={"actual": sorted(actual), "expected": sorted(keys)},
        )


def _identifier(value: object, label: str) -> str:
    if type(value) is not str or _IDENTIFIER.fullmatch(value) is None or value in {".", ".."}:
        _invalid(f"{label} is not a valid identifier")
    return value


def _hash(value: object, label: str) -> str:
    if type(value) is not str or _HASH.fullmatch(value) is None:
        _invalid(f"{label} is not a SHA-256 digest")
    return value


def _counter(value: object, label: str) -> int:
    if type(value) is not int or value < 0 or value > 9_007_199_254_740_991:
        _invalid(f"{label} is not a nonnegative safe integer")
    return value


def _parse_binding(value: object, label: str, *, require_closed: bool = True) -> JsonObject:
    item = _object(value, label)
    if require_closed:
        _closed(item, _BINDING_KEYS, label)
    binding: JsonObject = {
        "controllerRunId": _identifier(item.get("controllerRunId"), f"{label}.controllerRunId"),
        "controllerId": _identifier(item.get("controllerId"), f"{label}.controllerId"),
        "hostRunId": _identifier(item.get("hostRunId"), f"{label}.hostRunId"),
        "eventStreamId": _identifier(item.get("eventStreamId"), f"{label}.eventStreamId"),
        "throughSequence": _counter(item.get("throughSequence"), f"{label}.throughSequence"),
        "recordHash": _hash(item.get("recordHash"), f"{label}.recordHash"),
        "historyPrefixHash": _hash(
            item.get("historyPrefixHash"), f"{label}.historyPrefixHash"
        ),
        "requestHash": _hash(item.get("requestHash"), f"{label}.requestHash"),
        "controllerHash": _hash(item.get("controllerHash"), f"{label}.controllerHash"),
    }
    if binding["recordHash"] != binding["historyPrefixHash"]:
        _invalid(f"{label} record and prefix hashes differ")
    return binding


def _binding_from_fold(fold: CycleFold) -> JsonObject:
    request = fold.request
    return {
        "controllerRunId": request.model.controller_run_id,
        "controllerId": request.model.controller_id,
        "hostRunId": request.model.host_run.run_id,
        "eventStreamId": request.model.event_stream_id,
        "throughSequence": fold.tail_sequence,
        "recordHash": fold.tail_hash,
        "historyPrefixHash": fold.tail_hash,
        "requestHash": request.request_hash,
        "controllerHash": request.controller_hash,
    }


def _validate_limits(value: object) -> None:
    limits = _object(value, "lineage manifest limits")
    _closed(
        limits,
        frozenset({"maxDepth", "maxStreams", "maxEvents", "maxBytes"}),
        "lineage manifest limits",
    )
    if limits != {
        "maxDepth": MAX_CYCLE_LINEAGE_DEPTH,
        "maxStreams": MAX_CYCLE_LINEAGE_STREAMS,
        "maxEvents": MAX_CYCLE_LINEAGE_EVENTS,
        "maxBytes": MAX_CYCLE_LINEAGE_MANIFEST_BYTES,
    }:
        _invalid("lineage manifest limits differ from the contract bounds")


def _validate_and_replay(value: object) -> CycleLineageReplayResult:
    captured = capture_portable_json(value, error_code=CycleErrorCode.INVALID_HISTORY)
    if len(canonical_json(captured).encode("utf-8")) > MAX_CYCLE_LINEAGE_MANIFEST_BYTES:
        _invalid("lineage manifest exceeds the canonical byte bound")
    manifest = _object(captured, "lineage manifest")
    _closed(
        manifest,
        frozenset(
            {
                "apiVersion",
                "kind",
                "contractVersion",
                "payloadDisposition",
                "redacted",
                "limits",
                "target",
                "streams",
                "eventCount",
                "manifestHash",
            }
        ),
        "lineage manifest",
    )
    if (
        manifest.get("apiVersion")
        != "graphengineering.reacher-z.github.io/cycle-controller-lineage-manifests/v1alpha1"
        or manifest.get("kind") != "CycleControllerLineageManifest"
        or manifest.get("contractVersion") != "cycle-controller-lineage/v1alpha1"
        or manifest.get("payloadDisposition") != "inline-unredacted"
        or manifest.get("redacted") is not False
    ):
        _invalid("lineage manifest envelope is invalid")
    _validate_limits(manifest.get("limits"))
    declared_hash = _hash(manifest.get("manifestHash"), "lineage manifest hash")
    body: JsonObject = {key: value for key, value in manifest.items() if key != "manifestHash"}
    if domain_hash(CYCLE_LINEAGE_MANIFEST_DOMAIN, body) != declared_hash:
        _invalid("lineage manifest hash drifted")

    target = _parse_binding(manifest.get("target"), "lineage manifest target")
    raw_streams = manifest.get("streams")
    if (
        type(raw_streams) is not list
        or not raw_streams
        or len(raw_streams) > MAX_CYCLE_LINEAGE_STREAMS
    ):
        _invalid("lineage manifest stream count is outside the contract bounds")
    streams = cast(list[object], raw_streams)
    event_count = _counter(manifest.get("eventCount"), "lineage manifest eventCount")
    folds: list[CycleFold] = []
    run_ids: set[str] = set()
    stream_ids: set[str] = set()
    observed_events = 0

    stream_keys = _BINDING_KEYS | frozenset({"parent", "events"})
    for index, raw_value in enumerate(streams):
        raw = _object(raw_value, f"lineage stream {index}")
        _closed(raw, stream_keys, f"lineage stream {index}")
        binding = _parse_binding(raw, f"lineage stream {index}", require_closed=False)
        run_id = cast(str, binding["controllerRunId"])
        stream_id = cast(str, binding["eventStreamId"])
        if run_id in run_ids or stream_id in stream_ids:
            _invalid("lineage manifest contains a duplicate ancestor or ancestry cycle")
        run_ids.add(run_id)
        stream_ids.add(stream_id)
        raw_events = raw.get("events")
        if type(raw_events) is not list or not raw_events:
            _invalid("lineage stream event prefix is empty")
        events = cast(list[object], raw_events)
        observed_events += len(events)
        if observed_events > MAX_CYCLE_LINEAGE_EVENTS:
            _invalid("lineage manifest event count exceeds the contract bound")
        if len(events) != cast(int, binding["throughSequence"]) + 1:
            _invalid("lineage stream prefix length differs from throughSequence")
        parent_fold = folds[-1] if folds else None
        try:
            fold = fold_cycle_events(events, parent_fold=parent_fold)
        except CycleRuntimeError as exc:
            if exc.code is CycleErrorCode.INVALID_HISTORY:
                raise
            raise CycleRuntimeError(
                CycleErrorCode.INVALID_HISTORY,
                "lineage stream cannot be replayed",
                details={"causeCode": exc.code.value},
                cause=exc,
            ) from exc
        if canonical_json(binding) != canonical_json(_binding_from_fold(fold)):
            _invalid("lineage stream binding differs from its validated event prefix")
        if index == 0:
            if raw.get("parent") is not None or fold.request.model.lineage.origin != "start":
                _invalid("lineage root must be an origin=start stream with no parent")
        else:
            if raw.get("parent") is None or parent_fold is None:
                _invalid("lineage child is missing its immediate parent")
            if fold.request.model.lineage.origin != "fork":
                _invalid("a non-root lineage stream must have origin=fork")
            declared_parent = _parse_binding(
                raw.get("parent"), f"lineage stream {index}.parent"
            )
            if canonical_json(declared_parent) != canonical_json(_binding_from_fold(parent_fold)):
                _invalid("lineage child parent binding is missing, reordered, or substituted")
        folds.append(fold)

    if len(streams) - 1 > MAX_CYCLE_LINEAGE_DEPTH:
        _invalid("lineage manifest exceeds the ancestry depth bound")
    if observed_events != event_count:
        _invalid("lineage manifest eventCount differs from its prefixes")
    if canonical_json(target) != canonical_json(_binding_from_fold(folds[-1])):
        _invalid("lineage manifest target differs from the final stream")
    return CycleLineageReplayResult(cast(JsonObject, captured), tuple(folds))


def validate_cycle_lineage_manifest(value: object) -> JsonObject:
    """Validate and detach a complete root-to-target offline lineage package."""

    return _validate_and_replay(value).manifest


def replay_cycle_lineage_manifest(
    value: object,
    *,
    require_terminal: bool = False,
) -> CycleLineageReplayResult:
    """Replay a lineage package without a store, lease, clock, or handler."""

    replay = _validate_and_replay(value)
    if require_terminal and not replay.target.terminal:
        _invalid("lineage manifest target is not terminal")
    return replay


async def export_cycle_lineage_manifest(
    event_stream_id: str,
    *,
    store: CycleStore,
    through_sequence: int | None = None,
) -> JsonObject:
    """Export one exact target prefix and every immutable ancestor prefix."""

    if through_sequence is not None:
        _counter(through_sequence, "lineage export through_sequence")
    target_events = await store.read(event_stream_id, through_sequence=through_sequence)
    if not target_events:
        _invalid("lineage export target stream does not exist")
    if through_sequence is not None and len(target_events) != through_sequence + 1:
        _invalid("lineage export target prefix is outside history")

    reverse: list[tuple[CycleEvent, ...]] = []
    seen: set[str] = set()
    current = target_events
    while True:
        if len(reverse) >= MAX_CYCLE_LINEAGE_STREAMS:
            _invalid("lineage export exceeds the ancestry depth bound")
        first = current[0]
        if first.type != "ControllerCreated":
            _invalid("lineage event prefix does not begin with ControllerCreated")
        try:
            request = validate_cycle_request(first.data.get("request"))
        except CycleRuntimeError as exc:
            raise CycleRuntimeError(
                CycleErrorCode.INVALID_HISTORY,
                "lineage event prefix contains an invalid controller request",
                details={"causeCode": exc.code.value},
                cause=exc,
            ) from exc
        run_id = request.model.controller_run_id
        if run_id in seen:
            _invalid("lineage export detected an ancestry cycle")
        seen.add(run_id)
        reverse.append(current)
        lineage = request.model.lineage
        if lineage.origin == "start":
            break
        parent_events = await store.read_by_controller_run_id(
            lineage.parent_controller_run_id,
            through_sequence=lineage.parent_sequence,
        )
        if (
            len(parent_events) != lineage.parent_sequence + 1
            or parent_events[-1].record_hash != lineage.parent_history_hash
        ):
            _invalid("lineage ancestor prefix is missing, truncated, or substituted")
        current = parent_events

    prefixes = list(reversed(reverse))
    folds: list[CycleFold] = []
    streams: list[JsonObject] = []
    event_count = 0
    for events in prefixes:
        event_count += len(events)
        if event_count > MAX_CYCLE_LINEAGE_EVENTS:
            _invalid("lineage export exceeds the event-count bound")
        parent_fold = folds[-1] if folds else None
        fold = fold_cycle_events(events, parent_fold=parent_fold)
        binding = _binding_from_fold(fold)
        stream: JsonObject = {
            **binding,
            "parent": None if parent_fold is None else _binding_from_fold(parent_fold),
            "events": [cycle_event_document(event) for event in events],
        }
        streams.append(stream)
        folds.append(fold)

    if folds[-1].request.model.event_stream_id != event_stream_id:
        _invalid("lineage export target store key differs from the request eventStreamId")

    body: JsonObject = {
        "apiVersion": (
            "graphengineering.reacher-z.github.io/"
            "cycle-controller-lineage-manifests/v1alpha1"
        ),
        "kind": "CycleControllerLineageManifest",
        "contractVersion": "cycle-controller-lineage/v1alpha1",
        "payloadDisposition": "inline-unredacted",
        "redacted": False,
        "limits": {
            "maxDepth": MAX_CYCLE_LINEAGE_DEPTH,
            "maxStreams": MAX_CYCLE_LINEAGE_STREAMS,
            "maxEvents": MAX_CYCLE_LINEAGE_EVENTS,
            "maxBytes": MAX_CYCLE_LINEAGE_MANIFEST_BYTES,
        },
        "target": _binding_from_fold(folds[-1]),
        "streams": cast(Any, streams),
        "eventCount": event_count,
    }
    manifest: JsonObject = {
        **body,
        "manifestHash": domain_hash(CYCLE_LINEAGE_MANIFEST_DOMAIN, body),
    }
    return validate_cycle_lineage_manifest(manifest)
