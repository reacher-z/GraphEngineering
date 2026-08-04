"""Constructor tests for the Pattern 02 cited deep research (reduced) Python peer.

These mirror ``packages/patterns/test/cited-research.test.ts``: constructor
validation (including hostile inputs), the pinned claim-id determinism
literals, agreement between the committed bundle documents and the
constructor output, and the shape of the expected-event fixtures (real
fan-out, real resume).  The two language constructors are additionally proven
equal by both bundle runners, which compare against the same committed graph.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from graph_engineering import canonical_sha256, compile_graph
from graph_engineering.patterns import (
    CitedSource,
    PatternInputError,
    cited_research,
    claim_id,
)

BUNDLE = Path(__file__).resolve().parents[2] / "examples" / "patterns" / "cited-research"

SOURCES = [
    {"key": "changelog", "role": "release history and changelog entries"},
    {"key": "docs", "role": "reference documentation and manifests"},
    {"key": "interviews", "role": "practitioner interview notes"},
]


def bundle_json(name: str) -> object:
    return json.loads((BUNDLE / name).read_text(encoding="utf-8"))


def test_builds_scope_parallel_sources_two_barriers_and_static_skeptic_stage() -> None:
    document = cited_research(sources=SOURCES)
    graph = compile_graph(document)
    assert graph.topological_layers == (
        ("scope",),
        ("source-changelog", "source-docs", "source-interviews"),
        ("claims",),
        ("skeptic-1", "skeptic-2", "skeptic-3"),
        ("adjudicate",),
    )
    assert document["entrypoints"] == ["scope"]
    assert document["outputs"] == {"verdicts": {"node": "adjudicate"}}
    nodes = {node["id"]: node for node in document["nodes"]}  # type: ignore[index]
    for barrier in ("claims", "adjudicate"):
        assert nodes[barrier]["kind"] == "barrier"
        assert nodes[barrier]["config"] == {"condition": "all"}
    for slot in (1, 2, 3):
        node = nodes[f"skeptic-{slot}"]
        # `agent`, never `validator`: the validator node kind is
        # capability-gated and refused before dispatch.
        assert node["kind"] == "agent"
        assert node["config"] == {"operation": "adversarial-review", "slot": slot}


def test_every_fan_in_arrives_on_a_named_port_and_adjudicate_sees_claims_directly() -> None:
    document = cited_research(sources=SOURCES)
    edges = document["edges"]
    into_claims = [edge for edge in edges if edge["to"]["node"] == "claims"]  # type: ignore[index]
    assert [edge["to"]["port"] for edge in into_claims] == ["changelog", "docs", "interviews"]
    for slot in (1, 2, 3):
        incoming = [edge for edge in edges if edge["to"]["node"] == f"skeptic-{slot}"]  # type: ignore[index]
        assert len(incoming) == 1
        assert incoming[0]["from"] == {"node": "claims"}
        assert "port" not in incoming[0]["to"]
    into_adjudicate = [edge for edge in edges if edge["to"]["node"] == "adjudicate"]  # type: ignore[index]
    assert [edge["to"]["port"] for edge in into_adjudicate] == [
        "skeptic-1",
        "skeptic-2",
        "skeptic-3",
        "claims",
    ]
    assert into_adjudicate[-1]["from"] == {"node": "claims"}


def test_source_order_never_changes_the_graph() -> None:
    forward = cited_research(sources=SOURCES)
    reversed_document = cited_research(sources=list(reversed(SOURCES)))
    assert forward == reversed_document
    assert canonical_sha256(forward) == canonical_sha256(reversed_document)


def test_dataclass_sources_are_accepted() -> None:
    document = cited_research(
        sources=[CitedSource(key=item["key"], role=item["role"]) for item in SOURCES]
    )
    assert document == cited_research(sources=SOURCES)


def test_each_agent_node_declares_resume_retry_headroom() -> None:
    document = cited_research(sources=SOURCES, max_attempts_per_agent=3)
    nodes = {node["id"]: node for node in document["nodes"]}  # type: ignore[index]
    for node_id in (
        "source-changelog",
        "source-docs",
        "source-interviews",
        "skeptic-1",
        "skeptic-2",
        "skeptic-3",
    ):
        node = nodes[node_id]
        assert node["retry"] == {"maxAttempts": 3}
        assert node["sideEffects"] == "none"
    assert document["policies"] == {
        "maxConcurrency": 3,
        "maxDepth": 5,
        "maxFanOut": 4,
        "maxTotalAttempts": 21,
    }


def test_the_skeptic_stage_is_a_construction_time_constant() -> None:
    wide = cited_research(sources=SOURCES, skeptic_slots=5)
    skeptics = [
        node["id"]
        for node in wide["nodes"]  # type: ignore[index, union-attr]
        if str(node["id"]).startswith("skeptic-")  # type: ignore[index]
    ]
    assert skeptics == ["skeptic-1", "skeptic-2", "skeptic-3", "skeptic-4", "skeptic-5"]
    assert wide["policies"]["maxConcurrency"] == 5  # type: ignore[index]
    assert wide["policies"]["maxFanOut"] == 6  # type: ignore[index]
    # Dynamic per-claim fan-out would need the `dynamic-graph-patch` runtime
    # capability, which every runtime refuses; the slot bounds are enforced
    # here, before a graph exists.
    with pytest.raises(PatternInputError) as failure:
        cited_research(sources=SOURCES, skeptic_slots=9)
    assert failure.value.code == "GE_PATTERN_INVALID_INPUT"
    assert failure.value.path == "#/skepticSlots"


def test_claim_ids_are_the_pinned_deterministic_hash_rule() -> None:
    # Pinned literals: the first 12 hex characters of SHA-256 over the exact
    # UTF-8 text. `packages/patterns/test/cited-research.test.ts` pins the
    # same values through `claimId`, which is the cross-language identity
    # contract.
    assert (
        claim_id(
            "A resumed durable run reuses committed node results "
            "instead of re-invoking their executors."
        )
        == "82329aad7ca5"
    )
    assert claim_id("x") == "2d711642b726"
    assert claim_id("x") == claim_id("x")
    assert claim_id("x") != claim_id("x ")
    assert len(claim_id("x")) == 12
    assert set(claim_id("x")) <= set("0123456789abcdef")


@pytest.mark.parametrize("hostile", ["", 42, None, ["x"]])
def test_hostile_claim_texts_are_refused(hostile: object) -> None:
    with pytest.raises(PatternInputError) as failure:
        claim_id(hostile)
    assert failure.value.code == "GE_PATTERN_INVALID_INPUT"
    assert failure.value.path == "#/text"


@pytest.mark.parametrize(
    ("kwargs", "code", "path"),
    [
        ({"sources": []}, "GE_PATTERN_EMPTY_COLLECTION", "#/sources"),
        (
            {
                "sources": [
                    {"key": "docs", "role": "one"},
                    {"key": "docs", "role": "two"},
                ]
            },
            "GE_PATTERN_DUPLICATE_KEY",
            "#/sources/1/key",
        ),
        (
            {"sources": [{"key": "docs", "role": ""}]},
            "GE_PATTERN_INVALID_INPUT",
            "#/sources/0/role",
        ),
        (
            {"sources": [{"key": "__proto__", "role": "x"}]},
            "GE_PATTERN_INVALID_IDENTIFIER",
            "#/sources/0/key",
        ),
        (
            {"sources": [{"key": "docs", "role": "x", "extra": 1}]},
            "GE_PATTERN_UNKNOWN_FIELD",
            "#/sources/0/extra",
        ),
        (
            {"sources": SOURCES, "max_attempts_per_agent": 0},
            "GE_PATTERN_INVALID_INPUT",
            "#/maxAttemptsPerAgent",
        ),
        (
            {"sources": SOURCES, "skeptic_slots": 0},
            "GE_PATTERN_INVALID_INPUT",
            "#/skepticSlots",
        ),
        (
            {"sources": SOURCES, "skeptic_slots": True},
            "GE_PATTERN_INVALID_INPUT",
            "#/skepticSlots",
        ),
        ({"sources": SOURCES, "name": "Not-Valid"}, "GE_PATTERN_INVALID_IDENTIFIER", "#/name"),
        ({"sources": SOURCES, "version": ""}, "GE_PATTERN_INVALID_INPUT", "#/version"),
        ({"sources": "not-a-sequence"}, "GE_PATTERN_INVALID_INPUT", "#/sources"),
    ],
)
def test_invalid_inputs_are_refused_before_a_graph_exists(
    kwargs: dict[str, object], code: str, path: str
) -> None:
    with pytest.raises(PatternInputError) as failure:
        cited_research(**kwargs)  # type: ignore[arg-type]
    assert failure.value.code == code
    assert failure.value.path == path


def test_committed_bundle_graph_is_exactly_what_the_constructor_produces() -> None:
    committed = bundle_json("cited-research.graph.json")
    assert cited_research(sources=SOURCES, skeptic_slots=3) == committed


def test_bundle_fixtures_agree_with_the_committed_graph_identity() -> None:
    committed = bundle_json("cited-research.graph.json")
    expected_run = bundle_json("fixtures/expected-run.json")
    assert canonical_sha256(committed) == expected_run["graphHash"]  # type: ignore[index, arg-type]
    assert expected_run["maxObservedConcurrency"] == 3  # type: ignore[index]

    # The committed run really contains all four verdict cases, every table
    # row's id re-derives from its committed text, and the coverage gate
    # really rejected the uncited claim.
    report = expected_run["output"]["verdicts"]  # type: ignore[index]
    table = report["evidenceTable"]
    assert sorted(row["verdict"] for row in table) == [
        "contradicted",
        "insufficient-evidence",
        "rejected",
        "supported",
    ]
    for row in table:
        assert claim_id(row["text"]) == row["claimId"]
    assert report["verdicts"]["rejected"] == (
        report["citationCoverage"]["claimsRejectedForNoCitation"]
    )
    assert len(report["verdicts"]["rejected"]) == 1


def test_expected_event_fixtures_describe_real_fanout_and_real_resume() -> None:
    events = bundle_json("fixtures/expected-events.json")
    nominal = events["nominal"]  # type: ignore[index]

    # Every source is started before any source succeeds, and every skeptic is
    # started before any skeptic succeeds: two real fan-outs.
    for prefix in ("source-", "skeptic-"):
        first_success = next(
            index
            for index, (_, event_type, node_id) in enumerate(nominal)
            if event_type == "NodeSucceeded" and str(node_id).startswith(prefix)
        )
        started = [
            node_id
            for _, event_type, node_id in nominal[:first_success]
            if event_type == "NodeStarted" and str(node_id).startswith(prefix)
        ]
        assert len(started) == 3

    # The skeptics only ever run after the claims barrier has succeeded, and
    # the adjudicator only after every skeptic has.
    claims_succeeded = next(
        index
        for index, (_, event_type, node_id) in enumerate(nominal)
        if event_type == "NodeSucceeded" and node_id == "claims"
    )
    first_skeptic_started = next(
        index
        for index, (_, event_type, node_id) in enumerate(nominal)
        if event_type == "NodeStarted" and str(node_id).startswith("skeptic-")
    )
    assert first_skeptic_started > claims_succeeded
    last_skeptic_succeeded = max(
        index
        for index, (_, event_type, node_id) in enumerate(nominal)
        if event_type == "NodeSucceeded" and str(node_id).startswith("skeptic-")
    )
    adjudicate_started = next(
        index
        for index, (_, event_type, node_id) in enumerate(nominal)
        if event_type == "NodeStarted" and node_id == "adjudicate"
    )
    assert adjudicate_started > last_skeptic_succeeded

    injected = events["injectedSourceFailure"]  # type: ignore[index]
    assert any(
        event_type == "NodeAttemptFailed" and node_id == "source-docs"
        for _, event_type, node_id in injected
    )
    assert any(
        event_type == "NodeRetried" and node_id == "source-docs"
        for _, event_type, node_id in injected
    )

    crash = events["crashResume"]  # type: ignore[index]
    committed_before = [
        node_id
        for _, event_type, node_id in crash["beforeResume"]
        if event_type == "NodeSucceeded"
    ]
    assert "source-changelog" in committed_before
    assert crash["afterResume"][0][1] == "RunResumed"
    assert not any(node_id == "source-changelog" for _, _, node_id in crash["afterResume"])
    assert crash["afterResume"][-1][1] == "RunSucceeded"
