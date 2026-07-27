"""Emit native-Python D7-H06 lineage-manifest conformance evidence."""

from __future__ import annotations

import asyncio
import copy
import hashlib
import json
from pathlib import Path
from typing import Any, cast

from graph_engineering import (
    CYCLE_LINEAGE_MANIFEST_DOMAIN,
    MemoryCycleStore,
    canonical_json,
    export_cycle_lineage_manifest,
    replay_cycle_lineage_manifest,
    validate_cycle_lineage_manifest,
)
from graph_engineering.cycle_contract import (
    CycleRuntimeError,
    ValidatedCycleRequest,
    domain_hash,
    make_cycle_event,
    validate_cycle_request,
)

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "spec" / "conformance"
STARTED_AT = "2026-07-26T00:00:00Z"
DEADLINE_AT = "2026-07-26T00:00:01Z"


def _request(
    template: dict[str, Any],
    suffix: str,
    lineage: dict[str, Any],
) -> ValidatedCycleRequest:
    document = copy.deepcopy(template)
    document.update(
        {
            "controllerRunId": f"lineage-{suffix}",
            "controllerId": f"lineage-controller-{suffix}",
            "hostRun": {
                "relationship": "standalone-child-controller",
                "runId": "lineage-host",
            },
            "eventStreamId": f"lineage-{suffix}.events",
            "checkpointScope": f"lineage-{suffix}.checkpoints",
            "lineage": lineage,
        }
    )
    return validate_cycle_request(document)


def _created(request: ValidatedCycleRequest, event_id: str) -> Any:
    return make_cycle_event(
        event_id=event_id,
        event_type="ControllerCreated",
        timestamp=STARTED_AT,
        request=request,
        graph_revision=request.model.initial_graph.graph_revision,
        sequence=0,
        previous_event_hash=None,
        lease=None,
        data={
            "request": request.document,
            "requestHash": request.request_hash,
            "identity": request.identity,
            "controllerHash": request.controller_hash,
            "startedAt": STARTED_AT,
            "deadlineAt": DEADLINE_AT,
        },
    )


def _acquired(request: ValidatedCycleRequest, previous: Any) -> Any:
    return make_cycle_event(
        event_id="lineage-root-1",
        event_type="LeaseAcquired",
        timestamp=STARTED_AT,
        request=request,
        graph_revision=request.model.initial_graph.graph_revision,
        sequence=1,
        previous_event_hash=previous.record_hash,
        lease={
            "leaseId": "lineage-root-lease",
            "holderId": "lineage-holder",
            "leaseEpoch": 1,
            "fencingToken": 1,
            "acquiredAt": STARTED_AT,
            "expiresAt": "2026-07-26T00:01:00Z",
        },
        data={"reason": "start", "previousLeaseId": None},
    )


async def _seeds(template: dict[str, Any]) -> dict[str, dict[str, Any]]:
    store = MemoryCycleStore()
    root = _request(template, "root", {"origin": "start"})
    root_created = _created(root, "lineage-root-0")
    root_lease = _acquired(root, root_created)
    await store.append(root.model.event_stream_id, -1, (root_created, root_lease))

    child = _request(
        template,
        "child",
        {
            "origin": "fork",
            "parentControllerRunId": root.model.controller_run_id,
            "parentSequence": 1,
            "parentHistoryHash": root_lease.record_hash,
        },
    )
    child_created = _created(child, "lineage-child-0")
    await store.append(child.model.event_stream_id, -1, (child_created,))

    grandchild = _request(
        template,
        "grandchild",
        {
            "origin": "fork",
            "parentControllerRunId": child.model.controller_run_id,
            "parentSequence": 0,
            "parentHistoryHash": child_created.record_hash,
        },
    )
    await store.append(
        grandchild.model.event_stream_id,
        -1,
        (_created(grandchild, "lineage-grandchild-0"),),
    )

    sibling = _request(
        template,
        "sibling",
        {
            "origin": "fork",
            "parentControllerRunId": root.model.controller_run_id,
            "parentSequence": 1,
            "parentHistoryHash": root_lease.record_hash,
        },
    )
    await store.append(
        sibling.model.event_stream_id,
        -1,
        (_created(sibling, "lineage-sibling-0"),),
    )

    early = _request(
        template,
        "early",
        {
            "origin": "fork",
            "parentControllerRunId": root.model.controller_run_id,
            "parentSequence": 0,
            "parentHistoryHash": root_created.record_hash,
        },
    )
    await store.append(
        early.model.event_stream_id,
        -1,
        (_created(early, "lineage-early-0"),),
    )

    return {
        "grandchild": await export_cycle_lineage_manifest(
            grandchild.model.event_stream_id, store=store
        ),
        "sibling": await export_cycle_lineage_manifest(
            sibling.model.event_stream_id, store=store
        ),
        "early": await export_cycle_lineage_manifest(early.model.event_stream_id, store=store),
    }


def _reseal(value: dict[str, Any]) -> None:
    body = {key: item for key, item in value.items() if key != "manifestHash"}
    value["manifestHash"] = domain_hash(CYCLE_LINEAGE_MANIFEST_DOMAIN, body)


def _mutate(source: dict[str, Any], scenario: str) -> dict[str, Any]:
    value = copy.deepcopy(source)
    streams = cast(list[dict[str, Any]], value["streams"])
    reseal_after = True
    if scenario == "extra-field":
        value["unexpected"] = True
    elif scenario == "api-version":
        value["apiVersion"] = "invalid"
    elif scenario == "limit-substitution":
        cast(dict[str, Any], value["limits"])["maxDepth"] -= 1
    elif scenario == "manifest-hash-drift":
        value["eventCount"] = cast(int, value["eventCount"]) + 1
        reseal_after = False
    elif scenario == "missing-root":
        removed = streams.pop(0)
        value["eventCount"] = cast(int, value["eventCount"]) - len(removed["events"])
    elif scenario == "duplicate-root":
        duplicate = copy.deepcopy(streams[0])
        streams.insert(1, duplicate)
        value["eventCount"] = cast(int, value["eventCount"]) + len(duplicate["events"])
    elif scenario == "cycle-run-id":
        streams[1]["controllerRunId"] = streams[0]["controllerRunId"]
    elif scenario == "reordered-streams":
        streams[0], streams[1] = streams[1], streams[0]
    elif scenario == "parent-binding":
        cast(dict[str, Any], streams[1]["parent"])["requestHash"] = "f" * 64
    elif scenario == "parent-event-byte":
        cast(list[dict[str, Any]], streams[0]["events"])[0]["timestamp"] = (
            "2026-07-26T00:00:01Z"
        )
    elif scenario == "truncated-prefix":
        cast(list[Any], streams[0]["events"]).pop()
        value["eventCount"] = cast(int, value["eventCount"]) - 1
    elif scenario == "target-binding":
        cast(dict[str, Any], value["target"])["controllerHash"] = "e" * 64
    elif scenario == "event-count":
        value["eventCount"] = cast(int, value["eventCount"]) + 1
    elif scenario == "record-prefix-disagreement":
        streams[0]["historyPrefixHash"] = "d" * 64
    elif scenario == "stream-binding":
        streams[1]["eventStreamId"] = "substituted.events"
    elif scenario == "stream-overflow":
        while len(streams) <= 33:
            duplicate = copy.deepcopy(streams[-1])
            streams.append(duplicate)
            value["eventCount"] = cast(int, value["eventCount"]) + len(
                duplicate["events"]
            )
    else:
        raise TypeError(f"unknown lineage attack scenario {scenario}")
    if reseal_after:
        _reseal(value)
    return value


def _category_counts(cases: list[dict[str, Any]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for item in cases:
        category = cast(str, item["category"])
        counts[category] = counts.get(category, 0) + 1
    return dict(sorted(counts.items()))


async def _report() -> dict[str, Any]:
    fixture = json.loads(
        (FIXTURES / "cycle-controller-lineage.case.json").read_text(encoding="utf-8")
    )
    request_fixture = json.loads(
        (FIXTURES / fixture["requestFixture"]).read_text(encoding="utf-8")
    )
    template = cast(dict[str, Any], request_fixture["validRequests"][0]["document"])
    manifests = await _seeds(template)
    grandchild = manifests["grandchild"]
    cases = cast(list[dict[str, Any]], fixture["cases"])
    case_results: list[dict[str, Any]] = []
    for item in cases:
        if item["expectOutcome"] == "replayed":
            scenario = item["scenario"]
            if scenario == "grandchild-replay":
                replay = replay_cycle_lineage_manifest(grandchild)
                case_results.append(
                    {
                        "id": item["id"],
                        "outcome": "replayed",
                        "streamCount": len(replay.folds),
                        "targetRunId": replay.target.request.model.controller_run_id,
                        "targetSequence": replay.target.tail_sequence,
                    }
                )
            elif scenario == "sibling-isolation":
                grandchild_streams = cast(list[dict[str, Any]], grandchild["streams"])
                sibling_streams = cast(
                    list[dict[str, Any]], manifests["sibling"]["streams"]
                )
                assert canonical_json(grandchild_streams[0]) == canonical_json(
                    sibling_streams[0]
                )
                assert grandchild["target"] != manifests["sibling"]["target"]
                case_results.append(
                    {
                        "id": item["id"],
                        "outcome": "replayed",
                        "sharedPrefix": True,
                        "isolatedTarget": True,
                    }
                )
            elif scenario == "distinct-parent-prefix":
                early_streams = cast(list[dict[str, Any]], manifests["early"]["streams"])
                grandchild_streams = cast(list[dict[str, Any]], grandchild["streams"])
                assert early_streams[0]["throughSequence"] == 0
                assert grandchild_streams[0]["throughSequence"] == 1
                case_results.append(
                    {
                        "id": item["id"],
                        "outcome": "replayed",
                        "earlySequence": 0,
                        "fullSequence": 1,
                    }
                )
            elif scenario == "deterministic-revalidation":
                one = validate_cycle_lineage_manifest(grandchild)
                two = validate_cycle_lineage_manifest(copy.deepcopy(one))
                assert canonical_json(one) == canonical_json(two)
                case_results.append(
                    {"id": item["id"], "outcome": "replayed", "stable": True}
                )
            else:
                raise TypeError(f"unknown lineage behavior scenario {scenario}")
            continue
        code: str | None = None
        try:
            replay_cycle_lineage_manifest(_mutate(grandchild, cast(str, item["scenario"])))
        except CycleRuntimeError as exc:
            code = exc.code.value
        assert code == item["expectCode"], item["id"]
        case_results.append({"id": item["id"], "outcome": "rejected", "code": code})

    attacks = [item for item in cases if item["expectOutcome"] == "rejected"]
    behaviors = [item for item in cases if item["expectOutcome"] == "replayed"]
    expected = fixture["expect"]
    assert len(cases) == expected["caseCount"]
    assert len(attacks) == expected["attackCaseCount"]
    assert len(behaviors) == expected["behaviorCaseCount"]
    assert _category_counts(cases) == expected["categoryCounts"]
    canonical = canonical_json(grandchild)
    return {
        "campaign": fixture["id"],
        "caseCount": len(cases),
        "attackCaseCount": len(attacks),
        "behaviorCaseCount": len(behaviors),
        "categoryCounts": _category_counts(cases),
        "manifestCanonical": canonical,
        "manifestCanonicalUtf8Bytes": len(canonical.encode("utf-8")),
        "manifestSha256": hashlib.sha256(canonical.encode("utf-8")).hexdigest(),
        "manifestHash": grandchild["manifestHash"],
        "streamCount": len(cast(list[Any], grandchild["streams"])),
        "eventCount": grandchild["eventCount"],
        "caseResults": case_results,
    }


if __name__ == "__main__":
    print(json.dumps(asyncio.run(_report()), separators=(",", ":"), sort_keys=True))
