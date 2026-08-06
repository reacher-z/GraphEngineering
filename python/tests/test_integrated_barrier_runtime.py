"""Integrated barrier execution conformance and behaviour.

Every literal expectation is read from the shared corpus
``spec/conformance/integrated-barrier.case.json`` or recomputed here by the
native Python canonical serializer. Nothing is imported from, executed by, or
derived from the TypeScript runtime, and no test consults a wall clock, a
timer, ``asyncio``, or a thread: the barrier deadline is driven only by the
injected :class:`ManualClock`.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import pytest

from graph_engineering.integrated_barrier import (
    ValidBarrierPolicy,
    validate_integrated_barrier_policy,
)
from graph_engineering.integrated_barrier_runtime import (
    BARRIER_DECISION_DOMAIN,
    GRAPH_FAILURE_EXCLUDED_CODES,
    ROUTE_DECISION_DOMAIN,
    RUN_TERMINAL_PRECEDENCE,
    BarrierArrival,
    BarrierBallot,
    BarrierCensusVerdict,
    BarrierDisposition,
    BarrierExecutionState,
    BarrierFailureCode,
    BarrierReasonCode,
    BarrierResolution,
    DecisionAdoption,
    DecisionRejection,
    DecisionRejectionCode,
    IntegratedBarrier,
    InvalidBarrierVote,
    LateArrivalIgnored,
    LateArrivalRejected,
    MalformedBarrierVote,
    ManualClock,
    RunTerminal,
    UpstreamOutcome,
    barrier_decision_id,
    barrier_policy_hash,
    build_barrier_decision,
    descendant_terminal,
    evaluate_integrated_barrier,
    evidence_hash,
    fold_committed_decisions,
    is_graph_failure_code,
    parse_barrier_vote,
    resolve_run_terminal,
    route_decision_id,
    route_policy_hash,
    validate_decision_identifiers,
)

ROOT = Path(__file__).resolve().parents[2]
CORPUS: dict[str, Any] = json.loads(
    (ROOT / "spec/conformance/integrated-barrier.case.json").read_text()
)
EVALUATION_CASES: list[dict[str, Any]] = CORPUS["evaluationCases"]
IDENTITY_CASES: list[dict[str, Any]] = CORPUS["identityCases"]
IDENTIFIER_CASES: list[dict[str, Any]] = CORPUS["identifierCases"]
REPLAY_CASES: list[dict[str, Any]] = CORPUS["replayCases"]
IDENTIFIER_BASE_DOCUMENTS: dict[str, Any] = CORPUS["identifierBaseDocuments"]

VOTE_API_VERSION = "graphengineering.reacher-z.github.io/barrier/v1alpha1"


def _policy_snapshot(document: Any) -> Any:
    validation = validate_integrated_barrier_policy(document)
    assert isinstance(validation, ValidBarrierPolicy)
    return validation.policy


def _arrivals(entries: Sequence[dict[str, Any]]) -> list[BarrierArrival]:
    arrivals: list[BarrierArrival] = []
    for entry in entries:
        ballot: BarrierBallot | None = None
        if "vote" in entry:
            parsed = parse_barrier_vote(entry["vote"])
            assert isinstance(parsed, BarrierBallot)
            ballot = parsed
        arrivals.append(
            BarrierArrival(
                entry["sourceNodeId"],
                BarrierDisposition(entry["disposition"]),
                ballot,
            )
        )
    return arrivals


def _vote(verdict: str, **extra: Any) -> dict[str, Any]:
    return {
        "apiVersion": VOTE_API_VERSION,
        "kind": "BarrierVote",
        "verdict": verdict,
        **extra,
    }


def _policy(kind: str, **extra: Any) -> dict[str, Any]:
    return {
        "apiVersion": VOTE_API_VERSION,
        "kind": kind,
        "onUnsatisfied": "fail",
        "lateArrival": "ignore",
        **extra,
    }


# --------------------------------------------------------------------------- #
# evaluationCases                                                              #
# --------------------------------------------------------------------------- #


def test_every_evaluation_case_is_consumed() -> None:
    assert len(EVALUATION_CASES) == 41
    assert len({case["name"] for case in EVALUATION_CASES}) == 41


@pytest.mark.parametrize("case", EVALUATION_CASES, ids=lambda case: str(case["name"]))
def test_evaluation_case_matches_the_literal_corpus(case: dict[str, Any]) -> None:
    evaluation = evaluate_integrated_barrier(
        _policy_snapshot(case["policy"]),
        case["barrierNodeId"],
        _arrivals(case["dispositions"]),
    )
    assert evaluation.to_dict() == case["expect"]


@pytest.mark.parametrize("case", EVALUATION_CASES, ids=lambda case: str(case["name"]))
def test_counts_sum_to_total_and_id_lists_partition_the_entries(case: dict[str, Any]) -> None:
    expect = case["expect"]
    counts = ("succeeded", "failed", "missing", "timedOut", "abstained", "unknown")
    lists = (
        "acceptedIds",
        "failedIds",
        "missingIds",
        "timedOutIds",
        "abstainedIds",
        "unknownIds",
    )
    assert sum(expect[name] for name in counts) == expect["total"]
    partition = [node_id for name in lists for node_id in expect[name]]
    declared = [entry["sourceNodeId"] for entry in case["dispositions"]]
    assert sorted(partition) == sorted(declared)
    assert len(partition) == expect["total"]


@pytest.mark.parametrize("case", EVALUATION_CASES, ids=lambda case: str(case["name"]))
def test_votes_are_present_exactly_for_quorum_and_census_the_ballot(case: dict[str, Any]) -> None:
    is_quorum = case["policy"]["kind"] == "quorum"
    expect = case["expect"]
    assert ("votes" in expect) is is_quorum
    if not is_quorum:
        return
    assert len(expect["votes"]) == expect["total"]
    for entry, record in zip(case["dispositions"], expect["votes"], strict=True):
        assert record["sourceNodeId"] == entry["sourceNodeId"]
        if "vote" in entry:
            assert record["verdict"] == entry["vote"]["verdict"]
        else:
            # No ballot at all: `not-cast`, and exactly two members.
            assert record["verdict"] == "not-cast"
            assert set(record) == {"sourceNodeId", "verdict"}


@pytest.mark.parametrize("case", EVALUATION_CASES, ids=lambda case: str(case["name"]))
def test_deadline_elapsed_is_exactly_the_presence_of_a_timed_out_entry(
    case: dict[str, Any],
) -> None:
    expect = case["expect"]
    assert expect["deadlineElapsed"] is (expect["timedOut"] > 0)


@pytest.mark.parametrize("case", EVALUATION_CASES, ids=lambda case: str(case["name"]))
def test_resolution_follows_on_unsatisfied_and_never_implies_a_pass(
    case: dict[str, Any],
) -> None:
    expect = case["expect"]
    if expect["satisfied"]:
        assert expect["resolution"] == "satisfied"
        return
    assert expect["resolution"] == {
        "fail": "failed",
        "unknown": "unknown",
        "human": "awaiting_human",
    }[case["policy"]["onUnsatisfied"]]


def test_percentage_uses_exact_integer_products_not_a_float_ratio() -> None:
    # 2/3 against 6666 and 6667 basis points is the witness a float ratio loses.
    met = evaluate_integrated_barrier(
        _policy_snapshot(_policy("percentage", basisPoints=6666)),
        "gate",
        [
            BarrierArrival("a", BarrierDisposition.SUCCEEDED),
            BarrierArrival("b", BarrierDisposition.SUCCEEDED),
            BarrierArrival("c", BarrierDisposition.FAILED),
        ],
    )
    not_met = evaluate_integrated_barrier(
        _policy_snapshot(_policy("percentage", basisPoints=6667)),
        "gate",
        [
            BarrierArrival("a", BarrierDisposition.SUCCEEDED),
            BarrierArrival("b", BarrierDisposition.SUCCEEDED),
            BarrierArrival("c", BarrierDisposition.FAILED),
        ],
    )
    assert met.satisfied is True
    assert not_met.satisfied is False
    assert 2 * 10_000 >= 3 * 6666
    assert not 2 * 10_000 >= 3 * 6667


def test_abstained_and_unknown_are_unreachable_outside_quorum() -> None:
    for kind_document in (_policy("all"), _policy("minimum", minimum=1)):
        for disposition in (BarrierDisposition.ABSTAINED, BarrierDisposition.UNKNOWN):
            with pytest.raises(ValueError):
                evaluate_integrated_barrier(
                    _policy_snapshot(kind_document),
                    "gate",
                    [BarrierArrival("a", disposition)],
                )


def test_a_failed_upstream_without_a_ballot_is_recorded_not_cast() -> None:
    """The census key is the ballot, not the disposition name."""

    evaluation = evaluate_integrated_barrier(
        _policy_snapshot(
            _policy("quorum", quorum={"accepts": 1, "countAbstainAsParticipant": True})
        ),
        "gate",
        [
            BarrierArrival(
                "a",
                BarrierDisposition.SUCCEEDED,
                BarrierBallot(parse_barrier_vote(_vote("accept")).verdict),  # type: ignore[union-attr]
            ),
            # `failed` arising from upstream execution failure, no ballot.
            BarrierArrival("b", BarrierDisposition.FAILED, None),
        ],
    )
    assert evaluation.votes is not None
    assert evaluation.votes[1].verdict is BarrierCensusVerdict.NOT_CAST
    assert evaluation.votes[1].to_dict() == {"sourceNodeId": "b", "verdict": "not-cast"}
    # A ballot that said `reject` produces the same disposition but a cast record.
    with_ballot = evaluate_integrated_barrier(
        _policy_snapshot(
            _policy("quorum", quorum={"accepts": 1, "countAbstainAsParticipant": True})
        ),
        "gate",
        [
            BarrierArrival("b", BarrierDisposition.FAILED, parse_barrier_vote(_vote("reject"))),  # type: ignore[arg-type]
        ],
    )
    assert with_ballot.votes is not None
    assert with_ballot.votes[0].verdict is BarrierCensusVerdict.REJECT


# --------------------------------------------------------------------------- #
# Barrier vote carrier                                                         #
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    "value",
    [
        None,
        [],
        "accept",
        {"kind": "BarrierVote", "verdict": "accept"},
        {"apiVersion": VOTE_API_VERSION, "verdict": "accept"},
        _vote("accept", extra=1),
        _vote("maybe"),
        _vote("accept", confidenceBasisPoints=0),
        _vote("accept", confidenceBasisPoints=10001),
        _vote("accept", confidenceBasisPoints=True),
        {**_vote("accept"), "apiVersion": "other"},
        {**_vote("accept"), "kind": "Vote"},
    ],
)
def test_malformed_votes_are_never_coerced(value: Any) -> None:
    assert isinstance(parse_barrier_vote(value), MalformedBarrierVote)


@pytest.mark.parametrize(
    "value",
    [
        _vote("accept"),
        _vote("reject", confidenceBasisPoints=1),
        _vote("abstain", evidence={"citation": "x"}),
        _vote("unknown", confidenceBasisPoints=10000, evidence=[1, 2]),
        _vote("accept", confidenceBasisPoints=9000.0),
    ],
)
def test_conforming_votes_parse(value: Any) -> None:
    assert isinstance(parse_barrier_vote(value), BarrierBallot)


def test_evidence_hash_is_canonical() -> None:
    case = next(
        item
        for item in EVALUATION_CASES
        if item["name"] == "quorum-met-with-confidence-and-evidence-records"
    )
    expected = case["expect"]["votes"][0]["evidenceHash"]
    assert evidence_hash({"citation": "spec/integrated-barrier-semantics.md"}) == expected


# --------------------------------------------------------------------------- #
# identityCases                                                                #
# --------------------------------------------------------------------------- #


def test_every_identity_case_is_consumed() -> None:
    assert len(IDENTITY_CASES) == 12


@pytest.mark.parametrize("case", IDENTITY_CASES, ids=lambda case: str(case["name"]))
def test_identity_case_is_recomputed_natively(case: dict[str, Any]) -> None:
    is_barrier = case["documentKind"] == "BarrierDecision"
    assert case["decisionDomain"] == (
        BARRIER_DECISION_DOMAIN if is_barrier else ROUTE_DECISION_DOMAIN
    )
    policy_hash = (
        barrier_policy_hash(case["policy"]) if is_barrier else route_policy_hash(case["policy"])
    )
    decision_id = (
        barrier_decision_id(case["runId"], case["graphRevision"], case["nodeId"], case["document"])
        if is_barrier
        else route_decision_id(
            case["runId"], case["graphRevision"], case["nodeId"], case["document"]
        )
    )
    assert policy_hash == case["expect"]["policyHash"]
    assert decision_id == case["expect"]["decisionId"]
    assert case["document"]["policyHash"] == policy_hash
    assert case["document"]["decisionId"] == decision_id


@pytest.mark.parametrize("case", IDENTITY_CASES, ids=lambda case: str(case["name"]))
def test_identity_case_canonical_byte_lengths(case: dict[str, Any]) -> None:
    from graph_engineering.canonical import canonical_json

    without_identity = {
        key: value for key, value in case["document"].items() if key != "decisionId"
    }
    assert len(canonical_json(case["policy"]).encode("utf-8")) == (
        case["expect"]["canonicalPolicyUtf8Bytes"]
    )
    assert len(canonical_json(without_identity).encode("utf-8")) == (
        case["expect"]["canonicalDocumentWithoutDecisionIdUtf8Bytes"]
    )


def test_identity_binds_the_run_id_so_a_fork_cannot_reuse_a_parent_decision() -> None:
    parent = next(
        case for case in IDENTITY_CASES if case["name"] == "barrier-all-satisfied-identity"
    )
    fork = next(
        case for case in IDENTITY_CASES if case["name"] == "barrier-identity-binds-the-run-id"
    )
    assert parent["document"]["policyHash"] == fork["document"]["policyHash"]
    assert parent["expect"]["decisionId"] != fork["expect"]["decisionId"]


def test_framing_defeats_naive_concatenation() -> None:
    left, right = (
        case
        for case in IDENTITY_CASES
        if case.get("naiveConcatenationGroup") == "run-id-graph-revision-boundary"
    )
    assert left["runId"] + str(left["graphRevision"]) == right["runId"] + str(
        right["graphRevision"]
    )
    assert left["expect"]["decisionId"] != right["expect"]["decisionId"]


def test_evidence_key_order_is_unicode_code_point_order() -> None:
    from graph_engineering.canonical import canonical_json

    case = next(case for case in IDENTITY_CASES if case.get("evidenceInputs"))
    supplied = case["evidenceInputs"][0]
    assert evidence_hash(supplied["evidence"]) == supplied["evidenceHash"]
    serialized = canonical_json(supplied["evidence"])
    positions = [serialized.index(json.dumps(key, ensure_ascii=False)) for key in
                 case["canonicalEvidenceKeyOrder"]]
    assert positions == sorted(positions)


def test_a_route_decision_carries_absent_confidence_as_explicit_null() -> None:
    for case in IDENTITY_CASES:
        if case.get("nullMemberWitness") != "confidenceBasisPoints":
            continue
        assert "confidenceBasisPoints" in case["document"]
        assert case["document"]["confidenceBasisPoints"] is None


# --------------------------------------------------------------------------- #
# identifierCases                                                              #
# --------------------------------------------------------------------------- #


def _substitute(document: Any, pointer: str, value: Any) -> Any:
    segments = pointer.lstrip("/").split("/")
    patched = json.loads(json.dumps(document))
    cursor = patched
    for segment in segments[:-1]:
        cursor = cursor[int(segment)] if isinstance(cursor, list) else cursor[segment]
    last = segments[-1]
    if isinstance(cursor, list):
        cursor[int(last)] = value
    else:
        cursor[last] = value
    return patched


def test_every_identifier_case_is_consumed() -> None:
    assert len(IDENTIFIER_CASES) == 12


@pytest.mark.parametrize("case", IDENTIFIER_CASES, ids=lambda case: str(case["name"]))
def test_identifier_case(case: dict[str, Any]) -> None:
    base = IDENTIFIER_BASE_DOCUMENTS[case["documentKind"]]
    document = _substitute(base, case["path"], case["value"])
    assert validate_decision_identifiers(case["documentKind"], document) is (
        case["expect"]["valid"]
    )


def test_identifier_base_documents_are_themselves_valid_and_self_consistent() -> None:
    barrier = IDENTIFIER_BASE_DOCUMENTS["BarrierDecision"]
    route = IDENTIFIER_BASE_DOCUMENTS["RouteDecision"]
    assert validate_decision_identifiers("BarrierDecision", barrier) is True
    assert validate_decision_identifiers("RouteDecision", route) is True


# --------------------------------------------------------------------------- #
# Arming, deadlines, resolutions, late arrival, cancellation                   #
# --------------------------------------------------------------------------- #


def _barrier(
    policy_document: dict[str, Any],
    sources: Sequence[str],
    clock: ManualClock,
    *,
    run_id: str = "run-barrier",
    graph_revision: int = 1,
    node_id: str = "gate",
) -> IntegratedBarrier:
    return IntegratedBarrier(
        policy_document=policy_document,
        barrier_node_id=node_id,
        source_node_ids=sources,
        clock=clock,
        run_id=run_id,
        graph_revision=graph_revision,
    )


def test_a_barrier_arms_at_the_first_bound_settled_upstream_result() -> None:
    clock = ManualClock(7)
    barrier = _barrier(_policy("all", deadline={"afterMs": 100}), ("a", "b"), clock)
    assert barrier.state is BarrierExecutionState.PENDING
    assert barrier.armed_at_ms is None
    clock.advance(5)
    assert barrier.observe_upstream_settlement("a", UpstreamOutcome.SUCCEEDED) is None
    assert barrier.state is BarrierExecutionState.ARMED
    assert barrier.armed_at_ms == 12
    clock.advance(3)
    # A later settlement does not re-arm the barrier.
    barrier.observe_upstream_settlement("b", UpstreamOutcome.SUCCEEDED)
    assert barrier.armed_at_ms == 12


def test_a_barrier_without_a_deadline_is_never_deadline_settled() -> None:
    clock = ManualClock()
    barrier = _barrier(_policy("all"), ("a", "b"), clock)
    barrier.observe_upstream_settlement("a", UpstreamOutcome.SUCCEEDED)
    clock.advance(10_000_000)
    assert barrier.observe_tick() is None
    assert barrier.state is BarrierExecutionState.ARMED
    settlement = barrier.observe_upstream_settlement("b", UpstreamOutcome.SUCCEEDED)
    assert settlement is not None
    assert settlement.document is not None
    assert settlement.document["deadlineElapsed"] is False


def test_the_deadline_boundary_is_inclusive_and_one_millisecond_below_is_not() -> None:
    clock = ManualClock(10)
    barrier = _barrier(_policy("all", deadline={"afterMs": 100}), ("a", "b"), clock)
    barrier.observe_upstream_settlement("a", UpstreamOutcome.SUCCEEDED)
    clock.set_now(109)
    assert barrier.observe_tick() is None
    clock.set_now(110)
    settlement = barrier.observe_tick()
    assert settlement is not None
    document = settlement.document
    assert document is not None
    assert document["deadlineElapsed"] is True
    assert document["armedAtMs"] == 10
    assert document["decidedAtMs"] == 110
    assert document["timedOutIds"] == ["b"]
    assert document["satisfied"] is False
    assert document["reasonCode"] == BarrierReasonCode.ALL_NOT_SUCCEEDED.value


def test_completing_before_the_deadline_decides_with_deadline_elapsed_false() -> None:
    clock = ManualClock()
    barrier = _barrier(_policy("all", deadline={"afterMs": 100}), ("a", "b"), clock)
    barrier.observe_upstream_settlement("a", UpstreamOutcome.SUCCEEDED)
    clock.advance(50)
    settlement = barrier.observe_upstream_settlement("b", UpstreamOutcome.SUCCEEDED)
    assert settlement is not None
    assert settlement.document is not None
    assert settlement.document["deadlineElapsed"] is False
    assert settlement.document["decidedAtMs"] == 50
    # The clock later passing the deadline never revisits a committed decision.
    clock.advance(10_000)
    assert barrier.observe_tick() is None
    assert barrier.settlement is settlement


def test_decided_at_is_never_before_armed_at() -> None:
    clock = ManualClock(4321)
    barrier = _barrier(_policy("all"), ("a",), clock)
    settlement = barrier.observe_upstream_settlement("a", UpstreamOutcome.SUCCEEDED)
    assert settlement is not None
    assert settlement.document is not None
    assert settlement.document["decidedAtMs"] >= settlement.document["armedAtMs"]


def test_a_satisfied_barrier_binds_the_decision_document_as_its_output() -> None:
    clock = ManualClock()
    barrier = _barrier(_policy("all"), ("a",), clock)
    settlement = barrier.observe_upstream_settlement("a", UpstreamOutcome.SUCCEEDED)
    assert settlement is not None
    assert settlement.status is RunTerminal.SUCCEEDED
    assert settlement.attempts == 0
    assert settlement.output is settlement.document
    assert descendant_terminal(BarrierResolution.SATISFIED) is None
    assert [event.type for event in settlement.events] == ["BarrierSatisfied"]


@pytest.mark.parametrize(
    ("on_unsatisfied", "resolution", "terminal", "failure_code", "descendant_code", "scheduled"),
    [
        (
            "fail",
            BarrierResolution.FAILED,
            RunTerminal.FAILED,
            BarrierFailureCode.BARRIER_NOT_SATISFIED,
            BarrierFailureCode.UPSTREAM_FAILED,
            True,
        ),
        (
            "unknown",
            BarrierResolution.UNKNOWN,
            RunTerminal.UNKNOWN,
            None,
            BarrierFailureCode.UPSTREAM_UNKNOWN,
            True,
        ),
        (
            "human",
            BarrierResolution.AWAITING_HUMAN,
            RunTerminal.AWAITING_HUMAN,
            None,
            None,
            False,
        ),
    ],
)
def test_an_unsatisfied_barrier_never_succeeds_and_never_binds_an_output(
    on_unsatisfied: str,
    resolution: BarrierResolution,
    terminal: RunTerminal,
    failure_code: BarrierFailureCode | None,
    descendant_code: BarrierFailureCode | None,
    scheduled: bool,
) -> None:
    clock = ManualClock()
    document = _policy("all")
    document["onUnsatisfied"] = on_unsatisfied
    barrier = _barrier(document, ("a",), clock)
    settlement = barrier.observe_upstream_settlement("a", UpstreamOutcome.FAILED)
    assert settlement is not None
    assert settlement.resolution is resolution
    assert settlement.status is terminal
    assert settlement.attempts == 0
    assert settlement.failure_code is failure_code
    assert settlement.output is None
    assert settlement.document is not None
    assert settlement.document["satisfied"] is False
    inherited = descendant_terminal(resolution)
    assert inherited is not None
    assert inherited.failure_code is descendant_code
    assert inherited.scheduled is scheduled


def test_a_human_resolution_emits_the_decision_and_stops_the_run() -> None:
    clock = ManualClock()
    document = _policy("all")
    document["onUnsatisfied"] = "human"
    barrier = _barrier(document, ("a",), clock)
    settlement = barrier.observe_upstream_settlement("a", UpstreamOutcome.FAILED)
    assert settlement is not None
    assert settlement.stops_run is True
    assert [event.type for event in settlement.events] == [
        "BarrierSatisfied",
        "HumanInputRequested",
    ]
    assert settlement.events[1].data is settlement.document
    # A human resolution is never reported as satisfied, succeeded, failed, or
    # cancelled: resumption authority is D9-APPROVAL-077, not this tranche.
    assert settlement.status is RunTerminal.AWAITING_HUMAN
    assert settlement.resolution is BarrierResolution.AWAITING_HUMAN


def test_a_decision_is_emitted_for_every_committed_decision_satisfied_or_not() -> None:
    for outcome, satisfied in ((UpstreamOutcome.SUCCEEDED, True), (UpstreamOutcome.FAILED, False)):
        barrier = _barrier(_policy("all"), ("a",), ManualClock())
        settlement = barrier.observe_upstream_settlement("a", outcome)
        assert settlement is not None
        assert settlement.events[0].type == "BarrierSatisfied"
        assert settlement.events[0].data["satisfied"] is satisfied


def test_cancellation_of_an_armed_undecided_barrier_emits_no_decision() -> None:
    clock = ManualClock()
    barrier = _barrier(_policy("all", deadline={"afterMs": 5}), ("a", "b"), clock)
    barrier.observe_upstream_settlement("a", UpstreamOutcome.SUCCEEDED)
    settlement = barrier.observe_cancellation()
    assert settlement is not None
    assert settlement.status is RunTerminal.CANCELLED
    assert settlement.attempts == 0
    assert settlement.events == ()
    assert settlement.document is None
    assert settlement.output is None
    assert barrier.state is BarrierExecutionState.CANCELLED
    # A cancelled barrier never produces a partial decision document, and a
    # later clock tick cannot resurrect one.
    clock.advance(1_000)
    assert barrier.observe_tick() is None
    assert barrier.settlement is settlement
    # Cancellation propagates the existing cancellation terminal to descendants.
    inherited = descendant_terminal(settlement.resolution)
    assert inherited is not None
    assert inherited.status is RunTerminal.CANCELLED
    assert inherited.failure_code is BarrierFailureCode.NODE_CANCELLED
    assert inherited.scheduled is True


def test_cancellation_after_a_committed_decision_does_not_retract_it() -> None:
    barrier = _barrier(_policy("all"), ("a",), ManualClock())
    settlement = barrier.observe_upstream_settlement("a", UpstreamOutcome.SUCCEEDED)
    assert barrier.observe_cancellation() is None
    assert barrier.settlement is settlement


def test_late_arrival_under_ignore_leaves_the_decision_immutable() -> None:
    clock = ManualClock()
    barrier = _barrier(_policy("all", deadline={"afterMs": 10}), ("a", "b"), clock)
    barrier.observe_upstream_settlement("a", UpstreamOutcome.SUCCEEDED)
    clock.advance(10)
    settlement = barrier.observe_tick()
    assert settlement is not None
    before = json.dumps(settlement.document, sort_keys=True)
    outcome = barrier.observe_upstream_settlement("b", UpstreamOutcome.SUCCEEDED)
    assert isinstance(outcome, LateArrivalIgnored)
    assert outcome.source_node_id == "b"
    assert barrier.late_sources == ("b",)
    assert json.dumps(barrier.settlement.document, sort_keys=True) == before  # type: ignore[union-attr]
    assert barrier.settlement is settlement


def test_late_arrival_under_reject_is_a_non_retryable_run_failure() -> None:
    clock = ManualClock()
    document = _policy("all", deadline={"afterMs": 10})
    document["lateArrival"] = "reject"
    barrier = _barrier(document, ("a", "b"), clock)
    barrier.observe_upstream_settlement("a", UpstreamOutcome.SUCCEEDED)
    clock.advance(10)
    settlement = barrier.observe_tick()
    assert settlement is not None
    outcome = barrier.observe_upstream_settlement("b", UpstreamOutcome.SUCCEEDED)
    assert isinstance(outcome, LateArrivalRejected)
    assert outcome.code is BarrierFailureCode.BARRIER_LATE_ARRIVAL
    assert outcome.retryable is False
    assert outcome.barrier_node_id == "gate"
    assert outcome.source_node_id == "b"
    assert barrier.settlement is settlement


def test_a_malformed_vote_fails_the_upstream_once_and_contributes_no_entry() -> None:
    clock = ManualClock()
    barrier = _barrier(
        _policy("quorum", quorum={"accepts": 1, "countAbstainAsParticipant": False}),
        ("a", "b"),
        clock,
    )
    outcome = barrier.observe_upstream_settlement(
        "b",
        UpstreamOutcome.SUCCEEDED,
        output={"apiVersion": VOTE_API_VERSION, "kind": "BarrierVote", "verdict": "maybe"},
    )
    assert isinstance(outcome, InvalidBarrierVote)
    assert outcome.code is BarrierFailureCode.INVALID_BARRIER_VOTE
    assert outcome.attempts == 1
    assert outcome.retryable is False
    assert outcome.node_id == "b"
    settlement = barrier.observe_upstream_settlement(
        "a", UpstreamOutcome.SUCCEEDED, output=_vote("accept")
    )
    assert settlement is not None
    document = settlement.document
    assert document is not None
    # It is never coerced to abstain or unknown and never counts as a
    # participant, so it contributes no disposition entry at all.
    assert document["total"] == 1
    assert document["votes"] == [{"sourceNodeId": "a", "verdict": "accept"}]
    identifier_members = (
        "acceptedIds",
        "failedIds",
        "missingIds",
        "timedOutIds",
        "abstainedIds",
        "unknownIds",
    )
    assert not any("b" in document[member] for member in identifier_members)  # type: ignore[operator]


def test_a_non_quorum_barrier_never_requires_a_vote() -> None:
    barrier = _barrier(_policy("all"), ("a",), ManualClock())
    settlement = barrier.observe_upstream_settlement(
        "a", UpstreamOutcome.SUCCEEDED, output={"anything": True}
    )
    assert settlement is not None
    assert settlement.document is not None
    assert "votes" not in settlement.document
    assert settlement.document["satisfied"] is True


def test_quorum_dispositions_are_derived_from_the_ballot() -> None:
    barrier = _barrier(
        _policy("quorum", quorum={"accepts": 1, "countAbstainAsParticipant": True}),
        ("a", "b", "c", "d", "e"),
        ManualClock(),
    )
    barrier.observe_upstream_settlement("a", UpstreamOutcome.SUCCEEDED, output=_vote("accept"))
    barrier.observe_upstream_settlement("b", UpstreamOutcome.SUCCEEDED, output=_vote("reject"))
    barrier.observe_upstream_settlement("c", UpstreamOutcome.SUCCEEDED, output=_vote("abstain"))
    barrier.observe_upstream_settlement("d", UpstreamOutcome.SUCCEEDED, output=_vote("unknown"))
    settlement = barrier.observe_upstream_settlement("e", UpstreamOutcome.FAILED)
    assert settlement is not None
    document = settlement.document
    assert document is not None
    assert document["acceptedIds"] == ["a"]
    assert document["failedIds"] == ["b", "e"]
    assert document["abstainedIds"] == ["c"]
    assert document["unknownIds"] == ["d"]
    assert document["votes"] == [
        {"sourceNodeId": "a", "verdict": "accept"},
        {"sourceNodeId": "b", "verdict": "reject"},
        {"sourceNodeId": "c", "verdict": "abstain"},
        {"sourceNodeId": "d", "verdict": "unknown"},
        {"sourceNodeId": "e", "verdict": "not-cast"},
    ]


def test_a_pruned_or_cancelled_upstream_is_missing() -> None:
    barrier = _barrier(_policy("all"), ("a", "b"), ManualClock())
    barrier.observe_upstream_settlement("a", UpstreamOutcome.MISSING)
    settlement = barrier.observe_upstream_settlement("b", UpstreamOutcome.CANCELLED)
    assert settlement is not None
    assert settlement.document is not None
    assert settlement.document["missingIds"] == ["a", "b"]


def test_declaration_order_is_normative_in_the_document() -> None:
    barrier = _barrier(_policy("all", deadline={"afterMs": 1}), ("z", "m", "a"), ManualClock())
    barrier.observe_upstream_settlement("m", UpstreamOutcome.SUCCEEDED)
    barrier.observe_upstream_settlement("a", UpstreamOutcome.SUCCEEDED)
    settlement = barrier.observe_upstream_settlement("z", UpstreamOutcome.SUCCEEDED)
    assert settlement is not None
    assert settlement.document is not None
    assert settlement.document["acceptedIds"] == ["z", "m", "a"]


def test_the_decision_document_identity_is_recomputable_from_the_document() -> None:
    barrier = _barrier(
        _policy("minimum", minimum=1),
        ("a",),
        ManualClock(3),
        run_id="run-x",
        graph_revision=11,
        node_id="gate.check",
    )
    settlement = barrier.observe_upstream_settlement("a", UpstreamOutcome.SUCCEEDED)
    assert settlement is not None
    document = settlement.document
    assert document is not None
    assert document["policyHash"] == barrier_policy_hash(_policy("minimum", minimum=1))
    assert document["decisionId"] == barrier_decision_id("run-x", 11, "gate.check", document)
    assert validate_decision_identifiers("BarrierDecision", document) is True


def test_build_barrier_decision_rejects_a_decision_before_arming() -> None:
    evaluation = evaluate_integrated_barrier(
        _policy_snapshot(_policy("all")),
        "gate",
        [BarrierArrival("a", BarrierDisposition.SUCCEEDED)],
    )
    with pytest.raises(ValueError):
        build_barrier_decision(
            evaluation,
            policy_document=_policy("all"),
            run_id="run",
            graph_revision=1,
            armed_at_ms=10,
            decided_at_ms=9,
        )


def test_a_barrier_config_that_is_not_an_exact_policy_is_refused() -> None:
    for document in ({}, {"condition": "all"}, {**_policy("all"), "kynd": "all"}):
        with pytest.raises(ValueError):
            _barrier(document, ("a",), ManualClock())  # type: ignore[arg-type]


def test_a_source_outside_the_incoming_edges_is_refused() -> None:
    barrier = _barrier(_policy("all"), ("a",), ManualClock())
    with pytest.raises(ValueError):
        barrier.observe_upstream_settlement("z", UpstreamOutcome.SUCCEEDED)


def test_a_source_may_not_settle_twice_before_the_decision() -> None:
    barrier = _barrier(_policy("all"), ("a", "b"), ManualClock())
    barrier.observe_upstream_settlement("a", UpstreamOutcome.SUCCEEDED)
    with pytest.raises(ValueError):
        barrier.observe_upstream_settlement("a", UpstreamOutcome.SUCCEEDED)


# --------------------------------------------------------------------------- #
# Determinism of the injected clock                                            #
# --------------------------------------------------------------------------- #


def test_the_clock_is_injected_monotonic_and_never_a_wall_clock() -> None:
    clock = ManualClock(5)
    assert clock.now_ms() == 5
    assert clock.now_ms() == 5
    with pytest.raises(ValueError):
        clock.set_now(4)
    with pytest.raises(ValueError):
        clock.advance(-1)
    assert clock.advance(0) == 5
    assert clock.advance(7) == 12


def test_deadline_settlement_is_stable_under_cpu_load() -> None:
    """The same scripted tick list must decide identically under any load.

    ``D8-CYCLE-TIMEOUT-DIVERGENCE-090`` is a wall-clock/thread-hop race. Barrier
    execution has neither, so busy work between quiescence points cannot change
    the outcome. Real elapsed time here is arbitrary and deliberately ignored.
    """

    documents: list[str] = []
    for _ in range(25):
        clock = ManualClock()
        barrier = _barrier(_policy("all", deadline={"afterMs": 100}), ("a", "b"), clock)
        barrier.observe_upstream_settlement("a", UpstreamOutcome.SUCCEEDED)
        # Burn CPU without advancing the injected clock.
        total = 0
        for index in range(50_000):
            total += index * index
        assert total > 0
        assert barrier.observe_tick() is None
        clock.advance(100)
        settlement = barrier.observe_tick()
        assert settlement is not None
        documents.append(json.dumps(settlement.document, sort_keys=True))
    assert len(set(documents)) == 1


# --------------------------------------------------------------------------- #
# Run terminal precedence                                                      #
# --------------------------------------------------------------------------- #


def test_run_terminal_precedence_matches_the_corpus_vocabulary() -> None:
    assert [terminal.value for terminal in RUN_TERMINAL_PRECEDENCE] == (
        CORPUS["vocabulary"]["runTerminalPrecedence"]
    )


@pytest.mark.parametrize(
    ("terminals", "expected"),
    [
        ((), RunTerminal.SUCCEEDED),
        ((RunTerminal.SUCCEEDED,), RunTerminal.SUCCEEDED),
        ((RunTerminal.SUCCEEDED, RunTerminal.UNKNOWN), RunTerminal.UNKNOWN),
        (
            (RunTerminal.UNKNOWN, RunTerminal.AWAITING_HUMAN),
            RunTerminal.AWAITING_HUMAN,
        ),
        (
            (RunTerminal.AWAITING_HUMAN, RunTerminal.CANCELLED),
            RunTerminal.CANCELLED,
        ),
        (
            (RunTerminal.UNKNOWN, RunTerminal.AWAITING_HUMAN, RunTerminal.FAILED),
            RunTerminal.FAILED,
        ),
    ],
)
def test_run_terminal_precedence(
    terminals: tuple[RunTerminal, ...], expected: RunTerminal
) -> None:
    assert resolve_run_terminal(terminals) is expected


def test_a_mixed_run_of_three_barriers_is_failed() -> None:
    """A run with any failed node is failed even beside unknown and human."""

    terminals: list[RunTerminal] = []
    for on_unsatisfied in ("fail", "unknown", "human"):
        document = _policy("all")
        document["onUnsatisfied"] = on_unsatisfied
        barrier = _barrier(document, ("a",), ManualClock(), node_id=f"gate.{on_unsatisfied}")
        settlement = barrier.observe_upstream_settlement("a", UpstreamOutcome.FAILED)
        assert settlement is not None
        terminals.append(settlement.status)
    assert sorted(terminal.value for terminal in terminals) == [
        "awaiting_human",
        "failed",
        "unknown",
    ]
    assert resolve_run_terminal(terminals) is RunTerminal.FAILED


def test_upstream_unknown_is_excluded_from_graph_failure_codes() -> None:
    assert {"ROUTE_NOT_SELECTED", "UPSTREAM_UNKNOWN"} == GRAPH_FAILURE_EXCLUDED_CODES
    assert is_graph_failure_code("UPSTREAM_UNKNOWN") is False
    assert is_graph_failure_code("ROUTE_NOT_SELECTED") is False
    assert is_graph_failure_code("UPSTREAM_FAILED") is True
    assert is_graph_failure_code("BARRIER_NOT_SATISFIED") is True


# --------------------------------------------------------------------------- #
# replayCases                                                                  #
# --------------------------------------------------------------------------- #


class _ExecutorLedger:
    """Counts every executor call a replaying scheduler would make."""

    def __init__(self) -> None:
        self.calls: list[str] = []

    def execute(self, node_id: str) -> None:
        self.calls.append(node_id)


def _replay(case: dict[str, Any], ledger: _ExecutorLedger) -> Any:
    outcome = fold_committed_decisions(
        case["history"],
        run_id=case["runId"],
        graph_revision=case["graphRevision"],
        current_policies=case["currentPolicies"],
    )
    adopted = set(outcome.adopted_node_ids)
    if isinstance(outcome, DecisionAdoption):
        for node_id in case["currentPolicies"]:
            # A node with a committed decision MUST NOT be re-evaluated.
            if node_id not in adopted:
                ledger.execute(node_id)
    return outcome


def test_every_replay_case_is_consumed() -> None:
    assert len(REPLAY_CASES) == 8


@pytest.mark.parametrize("case", REPLAY_CASES, ids=lambda case: str(case["name"]))
def test_replay_case(case: dict[str, Any]) -> None:
    expect = case["expect"]
    ledger = _ExecutorLedger()
    outcome = _replay(case, ledger)
    assert list(outcome.adopted_node_ids) == expect["adoptedNodeIds"]
    assert outcome.appended_decision_events == expect["appendedDecisionEvents"]
    assert len(ledger.calls) == expect["expectedExecutorCalls"]
    if expect["outcome"] == "adopted":
        assert isinstance(outcome, DecisionAdoption)
        return
    assert isinstance(outcome, DecisionRejection)
    assert outcome.code is DecisionRejectionCode(expect["code"])
    assert outcome.node_id == expect["nodeId"]
    if "recordedPolicyHash" in expect:
        assert outcome.recorded_policy_hash == expect["recordedPolicyHash"]
        assert outcome.current_policy_hash == expect["currentPolicyHash"]
    if "recordedDecisionId" in expect:
        assert outcome.recorded_decision_id == expect["recordedDecisionId"]
        assert outcome.recomputed_decision_id == expect["recomputedDecisionId"]


@pytest.mark.parametrize("case", REPLAY_CASES, ids=lambda case: str(case["name"]))
def test_replay_recomputes_the_current_policy_hash_natively(case: dict[str, Any]) -> None:
    for event in case["history"]:
        node_id = event["nodeId"]
        policy = case["currentPolicies"][node_id]
        current = (
            barrier_policy_hash(policy)
            if event["type"] == "BarrierSatisfied"
            else route_policy_hash(policy)
        )
        assert len(current) == 64
        assert current == current.lower()


def test_a_fork_recomputes_its_own_identity_and_rejects_the_parent_verbatim() -> None:
    transplanted = next(
        case
        for case in REPLAY_CASES
        if case["name"] == "decision-identity-mismatch-rejects-a-transplanted-run-id"
    )
    child = next(
        case
        for case in REPLAY_CASES
        if case["name"] == "fork-recomputes-its-own-decision-identity-under-the-child-run-id"
    )
    assert transplanted["runId"] == child["runId"] == "run-child"
    parent_document = transplanted["history"][0]["data"]
    child_document = child["history"][0]["data"]
    assert parent_document["decisionId"] == child["expect"]["parentDecisionId"]
    assert child_document["decisionId"] == child["expect"]["childDecisionId"]
    assert barrier_decision_id("run-child", 5, "gate", child_document) == (
        child["expect"]["childDecisionId"]
    )


def test_duplicate_decision_is_detected_before_anything_is_adopted() -> None:
    case = next(
        item
        for item in REPLAY_CASES
        if item["name"] == "duplicate-decision-rejects-two-committed-events-for-one-node"
    )
    outcome = fold_committed_decisions(
        case["history"],
        run_id=case["runId"],
        graph_revision=case["graphRevision"],
        current_policies=case["currentPolicies"],
    )
    assert isinstance(outcome, DecisionRejection)
    assert outcome.code is DecisionRejectionCode.DUPLICATE_DECISION
    assert outcome.adopted_node_ids == ()


def test_non_decision_events_are_ignored_by_the_fold() -> None:
    case = next(
        item
        for item in REPLAY_CASES
        if item["name"] == "zero-rejudge-adoption-of-a-committed-barrier-decision"
    )
    history = [
        {"type": "NodeSucceeded", "nodeId": "a", "data": {}},
        *case["history"],
        {"type": "RunSucceeded", "nodeId": "gate", "data": {}},
    ]
    outcome = fold_committed_decisions(
        history,
        run_id=case["runId"],
        graph_revision=case["graphRevision"],
        current_policies=case["currentPolicies"],
    )
    assert isinstance(outcome, DecisionAdoption)
    assert outcome.adopted_node_ids == ("gate",)


# --------------------------------------------------------------------------- #
# The seam with runtime-capability/v1alpha1                                    #
# --------------------------------------------------------------------------- #


def test_the_ordinary_scheduler_owns_the_decision_and_never_calls_a_barrier_handler() -> None:
    """The ordinary scheduler now executes a policy-bearing barrier itself.

    The pre-dispatch refusal moved to the lanes that still cannot execute the
    contract: the durable entry points keep refusing under the
    ``integrated-barrier-policy`` capability (pinned in
    ``test_integrated_barrier_scheduler.py``), while the ordinary scheduler
    decides the barrier with zero executor attempts. A registered barrier
    handler is therefore never reached, so an exact policy can never be
    silently executed as an identity transform.
    """

    import asyncio

    from graph_engineering import FailureCode, NodeStatus, compile_graph, run_graph

    case = next(
        item
        for item in CORPUS["compilerCases"]
        if item["name"] == "valid-multi-barrier-graph-emits-no-barrier-diagnostics"
    )
    barriers = [node["id"] for node in case["graph"]["nodes"] if node["kind"] == "barrier"]
    assert barriers
    barrier_calls: list[str] = []

    def handler(context: Any) -> Any:
        if context.node.kind == "barrier":
            barrier_calls.append(context.node.id)
        return context.input

    result = asyncio.run(run_graph(compile_graph(case["graph"]), {}, {"*": handler}))
    assert barrier_calls == []
    assert not any(
        failure.code is FailureCode.UNSUPPORTED_RUNTIME_CAPABILITY
        for failure in result.failures
    )
    # Both transforms succeed, so `all` and `percentage` are satisfied, while
    # the quorum barrier received no ballot at all: a malformed vote fails the
    # barrier non-retryably after exactly one attempt and is never coerced.
    assert result.nodes["gate-all"].status is NodeStatus.SUCCEEDED
    assert result.nodes["gate-all"].attempts == 0
    assert result.nodes["gate-percentage"].status is NodeStatus.SUCCEEDED
    quorum = result.nodes["gate-quorum"]
    assert quorum.status is NodeStatus.FAILED
    assert quorum.attempts == 1
    assert quorum.failure is not None
    assert quorum.failure.code is FailureCode.INVALID_BARRIER_VOTE
    assert not quorum.failure.retryable
    # The engine in this module decides the same policies without the scheduler.
    for node in case["graph"]["nodes"]:
        if node["kind"] != "barrier":
            continue
        sources = [
            edge["from"]["node"]
            for edge in case["graph"]["edges"]
            if edge["to"]["node"] == node["id"]
        ]
        barrier = IntegratedBarrier(
            policy_document=node["config"],
            barrier_node_id=node["id"],
            source_node_ids=sources,
            clock=ManualClock(),
            run_id="run-seam",
            graph_revision=1,
        )
        settlement = None
        for source in sources:
            settlement = barrier.observe_upstream_settlement(
                source,
                UpstreamOutcome.SUCCEEDED,
                output=_vote("accept"),
            )
        assert settlement is not None
        assert settlement.document is not None


def test_a_settlement_after_cancellation_is_never_a_late_arrival() -> None:
    document = _policy("all")
    document["lateArrival"] = "reject"
    barrier = _barrier(document, ("a", "b"), ManualClock())
    barrier.observe_upstream_settlement("a", UpstreamOutcome.SUCCEEDED)
    barrier.observe_cancellation()
    assert barrier.observe_upstream_settlement("b", UpstreamOutcome.SUCCEEDED) is None
    assert barrier.late_sources == ()
    assert barrier.settlement is not None
    assert barrier.settlement.status is RunTerminal.CANCELLED


def test_a_malformed_last_vote_still_commits_the_barrier_settlement() -> None:
    barrier = _barrier(
        _policy("quorum", quorum={"accepts": 1, "countAbstainAsParticipant": True}),
        ("a", "b"),
        ManualClock(),
    )
    barrier.observe_upstream_settlement("a", UpstreamOutcome.SUCCEEDED, output=_vote("accept"))
    outcome = barrier.observe_upstream_settlement(
        "b", UpstreamOutcome.SUCCEEDED, output={"not": "a vote"}
    )
    assert isinstance(outcome, InvalidBarrierVote)
    assert barrier.state is BarrierExecutionState.DECIDED
    settlement = barrier.settlement
    assert settlement is not None
    assert settlement.document is not None
    assert settlement.document["total"] == 1
    assert settlement.document["votes"] == [{"sourceNodeId": "a", "verdict": "accept"}]
