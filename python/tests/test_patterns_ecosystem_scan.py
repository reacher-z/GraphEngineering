"""Constructor tests for the Pattern 10 ecosystem scan (reduced) Python peer.

These mirror ``packages/patterns/test/ecosystem-scan.test.ts``: constructor
validation, agreement between the committed bundle documents and the
constructor output, and the shape of the expected-event fixtures (real
fan-out, real resume).  The two language constructors are additionally proven
equal by both bundle runners, which compare against the same committed graph.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from graph_engineering import canonical_sha256, compile_graph
from graph_engineering.patterns import PatternInputError, ScanSource, ecosystem_scan

BUNDLE = Path(__file__).resolve().parents[2] / "examples" / "patterns" / "ecosystem-scan"

SOURCES = [
    {"key": "advisories", "feed": "advisories://example.invalid/security"},
    {"key": "registry", "feed": "registry://example.invalid/packages"},
    {"key": "releases", "feed": "releases://example.invalid/graph-engineering"},
]


def bundle_json(name: str) -> object:
    return json.loads((BUNDLE / name).read_text(encoding="utf-8"))


def test_builds_inventory_parallel_fetches_one_barrier_and_digest_tail() -> None:
    document = ecosystem_scan(sources=SOURCES)
    graph = compile_graph(document)
    assert graph.topological_layers == (
        ("inventory",),
        ("fetch-advisories", "fetch-registry", "fetch-releases"),
        ("normalize",),
        ("digest",),
    )
    assert document["entrypoints"] == ["inventory"]
    assert document["outputs"] == {"digest": {"node": "digest"}}
    nodes = {node["id"]: node for node in document["nodes"]}  # type: ignore[index]
    assert nodes["normalize"]["kind"] == "barrier"
    assert nodes["normalize"]["config"] == {"condition": "all"}
    assert nodes["digest"]["kind"] == "transform"


def test_every_fetch_reaches_a_unique_normalize_port() -> None:
    document = ecosystem_scan(sources=SOURCES)
    incoming = [
        edge for edge in document["edges"] if edge["to"]["node"] == "normalize"  # type: ignore[index]
    ]
    assert [edge["to"]["port"] for edge in incoming] == ["advisories", "registry", "releases"]
    tail = [edge for edge in document["edges"] if edge["to"]["node"] == "digest"]  # type: ignore[index]
    assert len(tail) == 1
    assert tail[0]["from"] == {"node": "normalize"}
    assert "port" not in tail[0]["to"]


def test_source_order_never_changes_the_graph() -> None:
    forward = ecosystem_scan(sources=SOURCES)
    reversed_document = ecosystem_scan(sources=list(reversed(SOURCES)))
    assert forward == reversed_document
    assert canonical_sha256(forward) == canonical_sha256(reversed_document)


def test_dataclass_sources_are_accepted() -> None:
    document = ecosystem_scan(
        sources=[ScanSource(key=item["key"], feed=item["feed"]) for item in SOURCES]
    )
    assert document == ecosystem_scan(sources=SOURCES)


def test_each_fetch_declares_resume_retry_headroom() -> None:
    document = ecosystem_scan(sources=SOURCES, max_attempts_per_fetch=3)
    nodes = {node["id"]: node for node in document["nodes"]}  # type: ignore[index]
    for key in ("advisories", "registry", "releases"):
        node = nodes[f"fetch-{key}"]
        assert node["retry"] == {"maxAttempts": 3}
        assert node["sideEffects"] == "none"
    assert document["policies"] == {
        "maxConcurrency": 3,
        "maxDepth": 4,
        "maxFanOut": 3,
        "maxTotalAttempts": 12,
    }


@pytest.mark.parametrize(
    ("kwargs", "code", "path"),
    [
        ({"sources": []}, "GE_PATTERN_EMPTY_COLLECTION", "#/sources"),
        (
            {
                "sources": [
                    {"key": "registry", "feed": "one"},
                    {"key": "registry", "feed": "two"},
                ]
            },
            "GE_PATTERN_DUPLICATE_KEY",
            "#/sources/1/key",
        ),
        (
            {"sources": [{"key": "registry", "feed": ""}]},
            "GE_PATTERN_INVALID_INPUT",
            "#/sources/0/feed",
        ),
        (
            {"sources": [{"key": "__proto__", "feed": "x"}]},
            "GE_PATTERN_INVALID_IDENTIFIER",
            "#/sources/0/key",
        ),
        (
            {"sources": [{"key": "registry", "feed": "x", "extra": 1}]},
            "GE_PATTERN_UNKNOWN_FIELD",
            "#/sources/0/extra",
        ),
        (
            {"sources": SOURCES, "max_attempts_per_fetch": 0},
            "GE_PATTERN_INVALID_INPUT",
            "#/maxAttemptsPerFetch",
        ),
        (
            {"sources": SOURCES, "inventory_version": ""},
            "GE_PATTERN_INVALID_INPUT",
            "#/inventoryVersion",
        ),
        ({"sources": SOURCES, "name": "Not-Valid"}, "GE_PATTERN_INVALID_IDENTIFIER", "#/name"),
    ],
)
def test_invalid_inputs_are_refused_before_a_graph_exists(
    kwargs: dict[str, object], code: str, path: str
) -> None:
    with pytest.raises(PatternInputError) as failure:
        ecosystem_scan(**kwargs)  # type: ignore[arg-type]
    assert failure.value.code == code
    assert failure.value.path == path


def test_committed_bundle_graph_is_exactly_what_the_constructor_produces() -> None:
    committed = bundle_json("ecosystem-scan.graph.json")
    assert ecosystem_scan(sources=SOURCES, inventory_version="2026-01") == committed


def test_bundle_fixtures_agree_with_the_committed_graph_identity() -> None:
    committed = bundle_json("ecosystem-scan.graph.json")
    expected_run = bundle_json("fixtures/expected-run.json")
    assert canonical_sha256(committed) == expected_run["graphHash"]  # type: ignore[index, arg-type]
    assert expected_run["maxObservedConcurrency"] == 3  # type: ignore[index]
    entries = expected_run["output"]["digest"]["entries"]  # type: ignore[index]
    assert [entry["rank"] for entry in entries] == [1, 2, 3]


def test_expected_event_fixtures_describe_real_fanout_and_real_resume() -> None:
    events = bundle_json("fixtures/expected-events.json")
    nominal = events["nominal"]  # type: ignore[index]

    # Every fetch is started before any fetch succeeds: that is fan-out.
    first_success = next(
        index
        for index, (_, event_type, node_id) in enumerate(nominal)
        if event_type == "NodeSucceeded" and str(node_id).startswith("fetch-")
    )
    started = [
        node_id
        for _, event_type, node_id in nominal[:first_success]
        if event_type == "NodeStarted" and str(node_id).startswith("fetch-")
    ]
    assert len(started) == 3

    # The digest only ever runs after the barrier has succeeded.
    normalize_succeeded = next(
        index
        for index, (_, event_type, node_id) in enumerate(nominal)
        if event_type == "NodeSucceeded" and node_id == "normalize"
    )
    digest_started = next(
        index
        for index, (_, event_type, node_id) in enumerate(nominal)
        if event_type == "NodeStarted" and node_id == "digest"
    )
    assert digest_started > normalize_succeeded

    injected = events["injectedSourceFailure"]  # type: ignore[index]
    assert any(
        event_type == "NodeAttemptFailed" and node_id == "fetch-registry"
        for _, event_type, node_id in injected
    )
    assert any(
        event_type == "NodeRetried" and node_id == "fetch-registry"
        for _, event_type, node_id in injected
    )

    crash = events["crashResume"]  # type: ignore[index]
    committed_before = [
        node_id
        for _, event_type, node_id in crash["beforeResume"]
        if event_type == "NodeSucceeded"
    ]
    assert "fetch-advisories" in committed_before
    assert crash["afterResume"][0][1] == "RunResumed"
    assert not any(node_id == "fetch-advisories" for _, _, node_id in crash["afterResume"])
    assert crash["afterResume"][-1][1] == "RunSucceeded"
