"""Ordinary-scheduler integrated barrier execution.

Mirrors the TypeScript scheduler-integration suite
(``packages/runtime/test/integrated-barrier-runtime.test.ts`` and the
scheduler-facing halves of ``integrated-barrier-capability.test.ts`` and
``integrated-barrier-replay.test.ts``) against the native Python scheduler.
Every literal expectation is read from the shared corpus
``spec/conformance/integrated-barrier.case.json`` or recomputed natively;
nothing is imported from the TypeScript runtime. Barrier deadlines are driven
only by the injected :class:`ScriptedClock` — no test consults a wall clock or
a timer for a barrier decision.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Callable, Mapping, Sequence
from pathlib import Path
from typing import Any

import pytest

from graph_engineering import (
    DecisionContext,
    FailureCode,
    NodeContext,
    NodeStatus,
    ProtectedGraphEvent,
    RunStatus,
    ScriptedClock,
    compile_graph,
    resume_graph_run,
    run_graph,
    start_graph_run,
)
from graph_engineering.integrated_barrier import (
    BARRIER_POLICY_API_VERSION,
    ValidBarrierPolicy,
    validate_integrated_barrier_policy,
)
from graph_engineering.integrated_barrier_runtime import (
    barrier_decision_id,
    barrier_policy_hash,
)
from graph_engineering.models import JsonValue
from graph_engineering.redaction.guard import PreparedSinkWrite
from graph_engineering.scheduler import RunResult
from tests.durable_support import memory_protection

ROOT = Path(__file__).resolve().parents[2]
CORPUS: dict[str, Any] = json.loads(
    (ROOT / "spec/conformance/integrated-barrier.case.json").read_text()
)
REPLAY_CASES: list[dict[str, Any]] = CORPUS["replayCases"]
VOCABULARY: dict[str, Any] = CORPUS["vocabulary"]

PROTECTION = memory_protection()


def node(node_id: str, **overrides: Any) -> dict[str, Any]:
    return {
        "id": node_id,
        "kind": "transform",
        "inputSchema": {},
        "outputSchema": {},
        "config": {},
        **overrides,
    }


def barrier_graph(
    policy_document: Any,
    source_ids: Sequence[str],
    *,
    sink: bool = False,
    output_from_sink: bool = False,
) -> dict[str, Any]:
    """`source_ids` become the barrier's incoming edges in declaration order,
    which is the order the decision document must preserve."""

    return {
        "apiVersion": "graphengineering.reacher-z.github.io/v1alpha1",
        "kind": "Graph",
        "metadata": {"name": "integrated-barrier", "version": "1"},
        "inputSchema": {},
        "outputSchema": {},
        "entrypoints": ["root"],
        "outputs": {
            "result": {"node": "sink"} if sink and output_from_sink else {"node": "gate"}
        },
        "nodes": [
            node("root"),
            *(node(source_id) for source_id in source_ids),
            node("gate", kind="barrier", config=policy_document),
            *((node("sink"),) if sink else ()),
        ],
        "edges": [
            *(
                {
                    "id": f"root-{source_id}",
                    "from": {"node": "root"},
                    "to": {"node": source_id, "port": source_id},
                }
                for source_id in source_ids
            ),
            *(
                {
                    "id": f"{source_id}-gate",
                    "from": {"node": source_id},
                    "to": {"node": "gate", "port": source_id},
                }
                for source_id in source_ids
            ),
            *(
                ({"id": "gate-sink", "from": {"node": "gate"}, "to": {"node": "sink"}},)
                if sink
                else ()
            ),
        ],
    }


def policy(**fields: Any) -> dict[str, Any]:
    return {"apiVersion": BARRIER_POLICY_API_VERSION, **fields}


def ballot(verdict: str, **extra: Any) -> dict[str, Any]:
    return {
        "apiVersion": BARRIER_POLICY_API_VERSION,
        "kind": "BarrierVote",
        "verdict": verdict,
        **extra,
    }


def returning(value: Any) -> Callable[[NodeContext], Any]:
    return lambda _context: value


def failing(_context: NodeContext) -> Any:
    raise RuntimeError("upstream failed")


class Held:
    """A handler that settles only when the test releases it."""

    def __init__(self) -> None:
        self._event: asyncio.Event | None = None
        self._value: Any = "late"
        self._released = False

    async def handler(self, _context: NodeContext) -> Any:
        self._event = asyncio.Event()
        if self._released:
            self._event.set()
        await self._event.wait()
        return self._value

    def release(self, value: Any = "late") -> None:
        self._value = value
        self._released = True
        if self._event is not None:
            self._event.set()


async def drain(condition: Callable[[], bool], *, rounds: int = 400) -> None:
    """Yield to the scheduler until `condition` holds, then a few more times."""

    for _ in range(rounds):
        if condition():
            for _ in range(10):
                await asyncio.sleep(0)
            return
        await asyncio.sleep(0)
    raise AssertionError("scheduler never reached the awaited state")


def decision_of(result: RunResult, node_id: str = "gate") -> Mapping[str, Any]:
    for event in result.decision_events:
        if event.type == "BarrierSatisfied" and event.node_id == node_id:
            return event.data
    raise AssertionError(f"no committed decision for {node_id!r}")


def run(
    graph_document: dict[str, Any],
    handlers: Mapping[str, Any],
    **options: Any,
) -> RunResult:
    return asyncio.run(run_graph(compile_graph(graph_document), {}, handlers, **options))


def test_decides_an_all_barrier_and_binds_the_decision_document() -> None:
    result = run(
        barrier_graph(
            policy(kind="all", onUnsatisfied="fail", lateArrival="ignore"),
            ["a", "b"],
        ),
        {"a": returning("ok"), "b": returning("ok")},
        decision=DecisionContext("run-alpha", 1),
        clock=ScriptedClock([12, 40]),
    )

    assert result.status is RunStatus.SUCCEEDED
    gate = result.nodes["gate"]
    assert gate.status is NodeStatus.SUCCEEDED
    assert gate.attempts == 0
    decision = decision_of(result)
    assert decision["barrierNodeId"] == "gate"
    assert decision["satisfied"] is True
    assert decision["reasonCode"] == "ALL_SUCCEEDED"
    assert decision["resolution"] == "satisfied"
    assert decision["deadlineElapsed"] is False
    assert decision["total"] == 2
    assert decision["succeeded"] == 2
    assert decision["acceptedIds"] == ["a", "b"]
    # The bound output is the decision document itself.
    assert gate.value == dict(decision)
    assert result.outputs is not None
    assert result.outputs["result"] == dict(decision)


def test_recomputes_policy_hash_and_decision_id_natively() -> None:
    declared = policy(kind="all", onUnsatisfied="fail", lateArrival="ignore")
    document = barrier_graph(declared, ["a", "b"])
    handlers = {"a": returning("ok"), "b": returning("ok")}
    result = run(document, handlers, decision=DecisionContext("run-alpha", 1))
    decision = dict(decision_of(result))

    validation = validate_integrated_barrier_policy(declared)
    assert isinstance(validation, ValidBarrierPolicy)
    assert decision["policyHash"] == barrier_policy_hash(declared)
    assert decision["decisionId"] == barrier_decision_id("run-alpha", 1, "gate", decision)

    # The same run under a different run ID recomputes a different identity.
    forked = run(document, handlers, decision=DecisionContext("run-alpha-fork", 1))
    assert decision_of(forked)["decisionId"] != decision["decisionId"]
    assert decision_of(forked)["policyHash"] == decision["policyHash"]


@pytest.mark.parametrize("on_unsatisfied", ["fail", "unknown", "human"])
def test_never_binds_an_output_and_never_runs_a_descendant(on_unsatisfied: str) -> None:
    descendant_calls: list[str] = []

    def descendant(context: NodeContext) -> Any:
        descendant_calls.append(context.node.id)
        return "must-not-run"

    result = run(
        barrier_graph(
            policy(kind="all", onUnsatisfied=on_unsatisfied, lateArrival="ignore"),
            ["a", "b"],
            sink=True,
            output_from_sink=True,
        ),
        {"a": returning("ok"), "b": failing, "sink": descendant},
    )

    gate = result.nodes["gate"]
    assert gate.status is {
        "fail": NodeStatus.FAILED,
        "unknown": NodeStatus.UNKNOWN,
        "human": NodeStatus.AWAITING_HUMAN,
    }[on_unsatisfied]
    assert gate.attempts == 0
    assert gate.value is None
    assert result.outputs is None
    assert descendant_calls == []
    decision = decision_of(result)
    assert decision["resolution"] == VOCABULARY["resolutionByOnUnsatisfied"][on_unsatisfied]
    assert decision["satisfied"] is False


def test_fail_resolution_is_barrier_not_satisfied_with_zero_attempts() -> None:
    result = run(
        barrier_graph(
            policy(kind="minimum", minimum=2, onUnsatisfied="fail", lateArrival="ignore"),
            ["a", "b"],
            sink=True,
            output_from_sink=True,
        ),
        {"a": returning("ok"), "b": failing, "sink": returning("never")},
    )
    gate = result.nodes["gate"]
    assert gate.failure is not None
    assert gate.failure.code is FailureCode.BARRIER_NOT_SATISFIED
    assert gate.failure.attempt == 0
    assert not gate.failure.retryable
    # Descendants inherit the existing zero-attempt UPSTREAM_FAILED terminal.
    sink = result.nodes["sink"]
    assert sink.status is NodeStatus.SKIPPED
    assert sink.failure is not None
    assert sink.failure.code is FailureCode.UPSTREAM_FAILED
    assert result.status is RunStatus.FAILED


def test_propagates_upstream_unknown_without_failing_the_run() -> None:
    # Every upstream node succeeds; only the ballots refuse, so the run holds
    # no node failure at all and `unknown` is the whole terminal story.
    result = run(
        barrier_graph(
            policy(
                kind="quorum",
                quorum={"accepts": 2, "countAbstainAsParticipant": True},
                onUnsatisfied="unknown",
                lateArrival="ignore",
            ),
            ["a", "b"],
            sink=True,
            output_from_sink=True,
        ),
        {
            "a": returning(ballot("accept")),
            "b": returning(ballot("reject")),
            "sink": returning("never"),
        },
    )
    gate = result.nodes["gate"]
    assert gate.status is NodeStatus.UNKNOWN
    assert gate.failure is None
    sink = result.nodes["sink"]
    assert sink.status is NodeStatus.SKIPPED
    assert sink.failure is not None
    assert sink.failure.code is FailureCode.UPSTREAM_UNKNOWN
    assert sink.attempts == 0
    # Exactly like ROUTE_NOT_SELECTED, UPSTREAM_UNKNOWN is not a graph failure.
    assert result.failures == ()
    assert result.status is RunStatus.UNKNOWN


def test_suspends_the_run_on_a_human_resolution() -> None:
    descendant_calls: list[str] = []

    def descendant(context: NodeContext) -> Any:
        descendant_calls.append(context.node.id)
        return "must-not-run"

    result = run(
        barrier_graph(
            policy(
                kind="quorum",
                quorum={"accepts": 2, "countAbstainAsParticipant": True},
                onUnsatisfied="human",
                lateArrival="ignore",
            ),
            ["a", "b"],
            sink=True,
            output_from_sink=True,
        ),
        {
            "a": returning(ballot("accept")),
            "b": returning(ballot("reject")),
            "sink": descendant,
        },
    )
    assert result.status is RunStatus.AWAITING_HUMAN
    assert descendant_calls == []
    # A human resolution schedules no descendant and stops: `sink` never
    # settles at all.
    assert "sink" not in result.nodes
    human = [event for event in result.decision_events if event.type == "HumanInputRequested"]
    assert len(human) == 1
    # HumanInputRequested carries the same decision document.
    assert human[0].data == decision_of(result)
    gate = result.nodes["gate"]
    assert gate.status is NodeStatus.AWAITING_HUMAN


def test_run_terminal_precedence_failed_outranks_awaiting_human_and_unknown() -> None:
    assert VOCABULARY["runTerminalPrecedence"] == [
        "failed",
        "cancelled",
        "awaiting_human",
        "unknown",
        "succeeded",
    ]
    quorum = {"accepts": 2, "countAbstainAsParticipant": True}
    mixed = {
        "apiVersion": "graphengineering.reacher-z.github.io/v1alpha1",
        "kind": "Graph",
        "metadata": {"name": "mixed-terminals", "version": "1"},
        "inputSchema": {},
        "outputSchema": {},
        "entrypoints": ["root"],
        "outputs": {"result": {"node": "root"}},
        "nodes": [
            node("root"),
            node("a"),
            node("b"),
            node("boom"),
            node(
                "gate-unknown",
                kind="barrier",
                config=policy(
                    kind="quorum",
                    quorum=quorum,
                    onUnsatisfied="unknown",
                    lateArrival="ignore",
                ),
            ),
            node(
                "gate-human",
                kind="barrier",
                config=policy(
                    kind="quorum",
                    quorum=quorum,
                    onUnsatisfied="human",
                    lateArrival="ignore",
                ),
            ),
        ],
        "edges": [
            {"id": "root-a", "from": {"node": "root"}, "to": {"node": "a"}},
            {"id": "root-b", "from": {"node": "root"}, "to": {"node": "b"}},
            {"id": "root-boom", "from": {"node": "root"}, "to": {"node": "boom"}},
            {"id": "a-unknown", "from": {"node": "a"}, "to": {"node": "gate-unknown", "port": "a"}},
            {"id": "b-unknown", "from": {"node": "b"}, "to": {"node": "gate-unknown", "port": "b"}},
            {"id": "a-human", "from": {"node": "a"}, "to": {"node": "gate-human", "port": "a"}},
            {"id": "b-human", "from": {"node": "b"}, "to": {"node": "gate-human", "port": "b"}},
        ],
    }
    ballots = {"a": returning(ballot("accept")), "b": returning(ballot("reject"))}

    with_failure = run(mixed, {**ballots, "boom": failing})
    assert with_failure.nodes["gate-unknown"].status is NodeStatus.UNKNOWN
    assert with_failure.nodes["gate-human"].status is NodeStatus.AWAITING_HUMAN
    # A run with any failed node is failed even beside unknown/awaiting_human.
    assert with_failure.status is RunStatus.FAILED

    without_failure = run(mixed, {**ballots, "boom": returning("ok")})
    # awaiting_human outranks unknown once no node has failed.
    assert without_failure.status is RunStatus.AWAITING_HUMAN


def test_quorum_counts_the_ballot_not_the_upstream_success() -> None:
    result = run(
        barrier_graph(
            policy(
                kind="quorum",
                quorum={"accepts": 2, "countAbstainAsParticipant": True},
                onUnsatisfied="fail",
                lateArrival="ignore",
            ),
            ["a", "b", "c"],
        ),
        {
            "a": returning(ballot("accept", confidenceBasisPoints=9000)),
            # A node that executes correctly and returns a refutation is a
            # reject, not an acceptance. Only quorum reads the ballot.
            "b": returning(ballot("reject", evidence={"note": "contradicted"})),
            "c": returning(ballot("abstain")),
        },
    )
    decision = decision_of(result)
    assert decision["satisfied"] is False
    assert decision["reasonCode"] == "QUORUM_NOT_MET"
    assert decision["succeeded"] == 1
    assert decision["failed"] == 1
    assert decision["abstained"] == 1
    assert decision["acceptedIds"] == ["a"]
    assert decision["failedIds"] == ["b"]
    assert decision["abstainedIds"] == ["c"]
    votes = decision["votes"]
    assert votes[0] == {"sourceNodeId": "a", "verdict": "accept", "confidenceBasisPoints": 9000}
    assert votes[1]["sourceNodeId"] == "b"
    assert votes[1]["verdict"] == "reject"
    assert isinstance(votes[1]["evidenceHash"], str)
    assert votes[2] == {"sourceNodeId": "c", "verdict": "abstain"}
    # Raw evidence is never embedded in the event; only evidenceHash is.
    assert "contradicted" not in json.dumps(dict(decision))
    assert VOCABULARY["verdictToDisposition"]["reject"] == "failed"


def test_all_barrier_counts_successes_regardless_of_their_values() -> None:
    # The same panel of refuters satisfies a non-quorum barrier. That silent
    # inversion is why a barrier that consumes verdicts MUST declare quorum.
    result = run(
        barrier_graph(
            policy(kind="all", onUnsatisfied="fail", lateArrival="ignore"),
            ["a", "b", "c"],
        ),
        {name: returning(ballot("reject")) for name in ("a", "b", "c")},
    )
    decision = decision_of(result)
    assert decision["satisfied"] is True
    assert decision["reasonCode"] == "ALL_SUCCEEDED"
    # The non-quorum decision carries no census at all.
    assert "votes" not in decision


def test_malformed_vote_fails_non_retryably_after_exactly_one_attempt() -> None:
    assert "INVALID_BARRIER_VOTE" in VOCABULARY["nodeFailureCodes"]
    result = run(
        barrier_graph(
            policy(
                kind="quorum",
                quorum={"accepts": 1, "countAbstainAsParticipant": True},
                onUnsatisfied="fail",
                lateArrival="ignore",
            ),
            ["a", "b"],
        ),
        {"a": returning(ballot("accept")), "b": returning({"verdict": "accept"})},
    )
    gate = result.nodes["gate"]
    assert gate.status is NodeStatus.FAILED
    assert gate.attempts == 1
    assert gate.failure is not None
    assert gate.failure.code is FailureCode.INVALID_BARRIER_VOTE
    assert not gate.failure.retryable
    assert gate.failure.upstream_nodes == ("b",)
    # No disposition entry, so no decision event at all: never coerced.
    assert result.decision_events == ()
    assert result.status is RunStatus.FAILED


def test_arms_at_first_bound_upstream_and_settles_at_the_exact_deadline() -> None:
    declared = policy(
        kind="all",
        deadline={"afterMs": 100},
        onUnsatisfied="fail",
        lateArrival="ignore",
    )
    slow = Held()
    clock = ScriptedClock([10, 109, 110])

    async def scenario() -> RunResult:
        task = asyncio.create_task(
            run_graph(
                compile_graph(barrier_graph(declared, ["a", "slow"])),
                {},
                {"a": returning("ok"), "slow": slow.handler},
                clock=clock,
            )
        )
        # 109 - 10 < 100, so the first tick decides nothing; the second tick
        # reaches the exact boundary and settles the barrier immediately.
        await drain(lambda: clock.delivered_ticks >= 2)
        slow.release()
        return await task

    result = asyncio.run(scenario())
    decision = decision_of(result)
    assert decision["armedAtMs"] == 10
    assert decision["decidedAtMs"] == 110
    assert decision["deadlineElapsed"] is True
    assert decision["satisfied"] is False
    assert decision["reasonCode"] == "ALL_NOT_SUCCEEDED"
    assert decision["timedOut"] == 1
    assert decision["timedOutIds"] == ["slow"]
    assert decision["acceptedIds"] == ["a"]
    assert decision["decidedAtMs"] >= decision["armedAtMs"]


def test_decides_before_the_deadline_with_deadline_elapsed_false() -> None:
    result = run(
        barrier_graph(
            policy(
                kind="all",
                deadline={"afterMs": 100},
                onUnsatisfied="fail",
                lateArrival="ignore",
            ),
            ["a", "b"],
        ),
        {"a": returning("ok"), "b": returning("ok")},
        clock=ScriptedClock([10, 500]),
    )
    decision = decision_of(result)
    # Complete before the deadline, even though the clock later passes it.
    assert decision["armedAtMs"] == 10
    assert decision["decidedAtMs"] == 10
    assert decision["deadlineElapsed"] is False
    assert decision["satisfied"] is True
    assert decision["timedOut"] == 0


def test_never_deadline_settles_a_barrier_without_a_deadline() -> None:
    slow = Held()
    clock = ScriptedClock([0, 10_000, 20_000])

    async def scenario() -> RunResult:
        task = asyncio.create_task(
            run_graph(
                compile_graph(
                    barrier_graph(
                        policy(kind="all", onUnsatisfied="fail", lateArrival="ignore"),
                        ["a", "slow"],
                    )
                ),
                {},
                {"a": returning("ok"), "slow": slow.handler},
                clock=clock,
            )
        )
        # Let the run block on the held upstream, then release it.
        for _ in range(50):
            await asyncio.sleep(0)
        slow.release("ok")
        return await task

    result = asyncio.run(scenario())
    # No deadline, so no tick was ever pulled and nothing timed out.
    assert clock.delivered_ticks == 0
    decision = decision_of(result)
    assert decision["armedAtMs"] == 0
    assert decision["decidedAtMs"] == 0
    assert decision["deadlineElapsed"] is False
    assert decision["timedOut"] == 0
    assert decision["satisfied"] is True


def test_cancels_an_armed_undecided_barrier_with_no_decision_event() -> None:
    slow = Held()

    async def scenario() -> RunResult:
        cancel_event = asyncio.Event()
        a_settled = asyncio.Event()

        def a_handler(_context: NodeContext) -> Any:
            a_settled.set()
            return "ok"

        task = asyncio.create_task(
            run_graph(
                compile_graph(
                    barrier_graph(
                        policy(
                            kind="all",
                            deadline={"afterMs": 1000},
                            onUnsatisfied="fail",
                            lateArrival="ignore",
                        ),
                        ["a", "slow"],
                        sink=True,
                        output_from_sink=True,
                    )
                ),
                {},
                {"a": a_handler, "slow": slow.handler, "sink": returning("never")},
                cancel_event=cancel_event,
                clock=ScriptedClock([0, 1]),
            )
        )
        # Cancel once the barrier is armed by 'a' but still undecided. The
        # held upstream observes the cancellation cooperatively.
        await drain(a_settled.is_set)
        cancel_event.set()
        return await task

    result = asyncio.run(scenario())
    gate = result.nodes["gate"]
    assert gate.status is NodeStatus.CANCELLED
    assert gate.attempts == 0
    assert gate.value is None
    assert gate.failure is None
    # No decision event, and never a partial decision document.
    assert result.decision_events == ()
    assert result.status is RunStatus.CANCELLED
    # The cancellation terminal still propagates to descendants.
    sink = result.nodes["sink"]
    assert sink.failure is not None
    assert sink.failure.code is FailureCode.NODE_CANCELLED


def _late_arrival_run(late_arrival: str) -> RunResult:
    late = Held()
    declared = policy(
        kind="minimum",
        minimum=1,
        deadline={"afterMs": 50},
        onUnsatisfied="fail",
        lateArrival=late_arrival,
    )
    clock = ScriptedClock([0, 50])

    async def scenario() -> RunResult:
        task = asyncio.create_task(
            run_graph(
                compile_graph(barrier_graph(declared, ["a", "late"])),
                {},
                {"a": returning("ok"), "late": late.handler},
                clock=clock,
            )
        )
        await drain(lambda: clock.delivered_ticks >= 1)
        late.release()
        return await task

    return asyncio.run(scenario())


def test_keeps_a_committed_decision_immutable_under_late_arrival_ignore() -> None:
    result = _late_arrival_run("ignore")
    decision = decision_of(result)
    assert decision["total"] == 2
    assert decision["succeeded"] == 1
    assert decision["timedOut"] == 1
    assert decision["timedOutIds"] == ["late"]
    assert decision["deadlineElapsed"] is True
    assert decision["satisfied"] is True
    assert decision["reasonCode"] == "MINIMUM_MET"
    # Exactly one decision event; the late node's own success is recorded.
    assert len(result.decision_events) == 1
    assert result.nodes["late"].status is NodeStatus.SUCCEEDED
    assert FailureCode.BARRIER_LATE_ARRIVAL not in {
        failure.code for failure in result.failures
    }


def test_rejects_a_late_arrival_under_late_arrival_reject() -> None:
    result = _late_arrival_run("reject")
    assert [
        (failure.code, failure.node_id, failure.upstream_nodes, failure.retryable)
        for failure in result.failures
    ] == [(FailureCode.BARRIER_LATE_ARRIVAL, "gate", ("late",), False)]
    assert result.status is RunStatus.FAILED
    # The decision itself is untouched.
    decision = decision_of(result)
    assert decision["total"] == 2
    assert decision["timedOutIds"] == ["late"]
    assert decision["satisfied"] is True
    assert len(result.decision_events) == 1


def test_treats_an_upstream_failure_as_a_not_cast_census_record() -> None:
    result = run(
        barrier_graph(
            policy(
                kind="quorum",
                quorum={"accepts": 1, "countAbstainAsParticipant": True},
                onUnsatisfied="unknown",
                lateArrival="ignore",
            ),
            ["a", "broken"],
        ),
        {"a": returning(ballot("accept")), "broken": failing},
    )
    decision = decision_of(result)
    # The failed upstream cast no ballot at all, so its census record is
    # not-cast even though its disposition is `failed`.
    assert decision["failed"] == 1
    assert decision["failedIds"] == ["broken"]
    assert decision["succeeded"] == 1
    assert decision["votes"] == [
        {"sourceNodeId": "a", "verdict": "accept"},
        {"sourceNodeId": "broken", "verdict": "not-cast"},
    ]
    assert decision["satisfied"] is True


def test_keeps_the_incoming_edge_declaration_order_of_the_compiled_graph() -> None:
    # Edge IDs sort in the opposite order to their declaration, so an
    # implementation that reused the sorted edge-ID ordering would fail.
    document = barrier_graph(
        policy(kind="all", onUnsatisfied="fail", lateArrival="ignore"),
        ["zeta", "alpha"],
    )
    result = run(document, {"zeta": returning("ok"), "alpha": returning("ok")})
    incoming = [edge["id"] for edge in document["edges"] if edge["to"]["node"] == "gate"]
    assert incoming == ["zeta-gate", "alpha-gate"]
    assert decision_of(result)["acceptedIds"] == ["zeta", "alpha"]


def test_keeps_a_pre_contract_barrier_config_on_its_published_path() -> None:
    document = barrier_graph({"condition": "all"}, ["a", "b"])
    gate_calls: list[str] = []

    def gate_handler(context: NodeContext) -> Any:
        gate_calls.append(context.node.id)
        return context.input

    result = run(
        document,
        {"a": returning("ok"), "b": returning("ok"), "gate": gate_handler},
    )
    # Unclaimed configs are not integrated barriers: the ordinary executor
    # runs and no decision is committed.
    assert gate_calls == ["gate"]
    assert result.decision_events == ()
    assert result.status is RunStatus.SUCCEEDED


# --------------------------------------------------------------------------- #
# Zero-rejudge replay through the real scheduler                               #
# --------------------------------------------------------------------------- #


def replay_graph(replay_case: dict[str, Any]) -> dict[str, Any]:
    """A graph carrying exactly the corpus policies. Three upstreams keep every
    corpus threshold within the incoming-edge count, so GE1424 never fires."""

    entries = list(replay_case["currentPolicies"].items())
    barriers = [
        (node_id, config)
        for node_id, config in entries
        if config.get("apiVersion") == BARRIER_POLICY_API_VERSION
    ]
    routers = [
        (node_id, config)
        for node_id, config in entries
        if config.get("apiVersion") != BARRIER_POLICY_API_VERSION
    ]
    sources = ["a", "b", "c"]
    return {
        "apiVersion": "graphengineering.reacher-z.github.io/v1alpha1",
        "kind": "Graph",
        "metadata": {"name": "integrated-barrier-replay", "version": "1"},
        "inputSchema": {},
        "outputSchema": {},
        "entrypoints": ["root"],
        "outputs": {"result": {"node": "root"}},
        "nodes": [
            node("root"),
            *(node(source) for source in sources),
            *(node(node_id, kind="router", config=config) for node_id, config in routers),
            *(
                node(f"{node_id}-{route}")
                for node_id, config in routers
                for route in config["allowedRoutes"]
            ),
            *(node(node_id, kind="barrier", config=config) for node_id, config in barriers),
        ],
        "edges": [
            *(
                {
                    "id": f"root-{source}",
                    "from": {"node": "root"},
                    "to": {"node": source, "port": source},
                }
                for source in sources
            ),
            *(
                {"id": f"root-{node_id}", "from": {"node": "root"}, "to": {"node": node_id}}
                for node_id, _ in routers
            ),
            # GE1407 requires every allowed route to carry a case.
            *(
                {
                    "id": f"{node_id}-{route}",
                    "from": {"node": node_id},
                    "to": {"node": f"{node_id}-{route}"},
                    "condition": {
                        "apiVersion": (
                            "graphengineering.reacher-z.github.io/"
                            "pattern-conditions/v1alpha1"
                        ),
                        "kind": "RouteEquals",
                        "routeKey": route,
                    },
                }
                for node_id, config in routers
                for route in config["allowedRoutes"]
            ),
            *(
                {
                    "id": f"{source}-{node_id}",
                    "from": {"node": source},
                    "to": {"node": node_id, "port": source},
                }
                for node_id, _ in barriers
                for source in sources
            ),
        ],
    }


@pytest.mark.parametrize(
    "replay_case",
    REPLAY_CASES,
    ids=[case["name"] for case in REPLAY_CASES],
)
def test_the_scheduler_never_calls_an_executor_for_a_committed_decision(
    replay_case: dict[str, Any],
) -> None:
    spied: list[str] = []

    def spy(context: NodeContext) -> Any:
        spied.append(context.node.id)
        return "must-not-run"

    handlers: dict[str, Any] = {
        node_id: spy for node_id in replay_case["currentPolicies"]
    }
    handlers.update({"a": returning("ok"), "b": returning("ok"), "c": returning("ok")})

    result = run(
        replay_graph(replay_case),
        handlers,
        decision=DecisionContext(replay_case["runId"], replay_case["graphRevision"]),
        committed_decisions=replay_case["history"],
    )

    assert spied == []
    # No second decision event is ever appended for an adopted node.
    assert len(result.decision_events) == replay_case["expect"]["appendedDecisionEvents"]
    assert replay_case["expect"]["expectedExecutorCalls"] == 0

    if replay_case["expect"]["outcome"] == "rejected":
        assert result.status is RunStatus.FAILED
        assert dict(result.nodes) == {}
        assert result.total_attempts == 0
        assert [
            (failure.code.value, failure.node_id, failure.retryable, failure.attempt)
            for failure in result.failures
        ] == [(replay_case["expect"]["code"], replay_case["expect"]["nodeId"], False, 0)]
        return

    assert result.status is RunStatus.SUCCEEDED
    for node_id in replay_case["expect"]["adoptedNodeIds"]:
        assert result.nodes[node_id].attempts == 0


def test_adopts_a_committed_barrier_decision_as_the_bound_output() -> None:
    replay_case = next(
        case
        for case in REPLAY_CASES
        if case["name"] == "zero-rejudge-adoption-of-a-committed-barrier-decision"
    )
    result = run(
        replay_graph(replay_case),
        {"a": returning("ok"), "b": returning("ok"), "c": returning("ok")},
        decision=DecisionContext(replay_case["runId"], replay_case["graphRevision"]),
        committed_decisions=replay_case["history"],
    )
    gate = result.nodes["gate"]
    assert gate.status is NodeStatus.SUCCEEDED
    # Adopted verbatim: the recorded counts survive even though this graph's
    # upstreams would not reproduce them.
    assert gate.value == replay_case["history"][0]["data"]
    assert gate.attempts == 0


def test_projects_an_adopted_route_decision_back_to_the_published_members() -> None:
    replay_case = next(
        case
        for case in REPLAY_CASES
        if case["name"] == "adoption-of-a-committed-route-selected-decision"
    )
    result = run(
        replay_graph(replay_case),
        {"a": returning("ok"), "b": returning("ok"), "c": returning("ok")},
        decision=DecisionContext(replay_case["runId"], replay_case["graphRevision"]),
        committed_decisions=replay_case["history"],
    )
    route = result.nodes["route"]
    assert route.status is NodeStatus.SUCCEEDED
    assert route.attempts == 0
    assert isinstance(route.value, dict)
    assert sorted(route.value) == [
        "confidenceBasisPoints",
        "escalated",
        "reasonCode",
        "requestedRoutes",
        "routed",
        "selectedRoutes",
        "unknownRoutes",
        "usedDefault",
    ]
    # The adopted selection still steers downstream RouteEquals edges without
    # being re-judged.
    selected = route.value["selectedRoutes"]
    assert selected == ["quick"]
    assert result.nodes["route-quick"].status is NodeStatus.SUCCEEDED
    assert result.nodes["route-audit"].status is NodeStatus.SKIPPED


# --------------------------------------------------------------------------- #
# The durable lane keeps refusing                                              #
# --------------------------------------------------------------------------- #


class NoIoEventStore:
    """An event store that fails loudly if the preflight ever touches it."""

    def __init__(self) -> None:
        self.read_calls = 0
        self.append_calls = 0

    async def read(
        self, run_id: str, from_sequence: int = 0
    ) -> tuple[ProtectedGraphEvent, ...]:
        self.read_calls += 1
        raise AssertionError(f"unexpected durable read for {run_id!r} at {from_sequence}")

    async def append(
        self,
        run_id: str,
        expected_version: int,
        prepared: Sequence[PreparedSinkWrite],
    ) -> int:
        self.append_calls += 1
        raise AssertionError(
            f"unexpected durable append for {run_id!r} at {expected_version}"
        )

    def legacy_documents(self, run_id: str) -> tuple[Mapping[str, JsonValue], ...]:
        raise AssertionError(f"unexpected legacy history probe for {run_id!r}")


def test_durable_start_and_resume_still_refuse_a_claimed_policy() -> None:
    """The durable scheduler does not journal ``BarrierSatisfied`` yet, so it
    keeps refusing under the ``integrated-barrier-policy`` capability with zero
    executor calls, zero store reads, and zero store writes."""

    compiled = compile_graph(
        barrier_graph(
            policy(kind="all", onUnsatisfied="fail", lateArrival="ignore"),
            ["a", "b"],
        )
    )

    async def scenario() -> None:
        calls: list[str] = []

        def handler(context: NodeContext) -> Any:
            calls.append(context.node.id)
            return context.input

        store = NoIoEventStore()
        started = await start_graph_run(
            compiled,
            {},
            {"*": handler},
            run_id="integrated-barrier-durable-gate",
            implementation_id="integrated-barrier@1",
            event_store=store,
            payload_protection=PROTECTION,
        )
        resumed = await resume_graph_run(
            compiled,
            {"*": handler},
            run_id="integrated-barrier-durable-gate",
            implementation_id="integrated-barrier@1",
            event_store=store,
            payload_protection=PROTECTION,
        )

        for result in (started, resumed):
            assert result.status is RunStatus.FAILED
            assert dict(result.nodes) == {}
            assert result.total_attempts == 0
            assert result.max_observed_concurrency == 0
            assert [
                (failure.code, failure.node_id, failure.message)
                for failure in result.failures
            ] == [
                (
                    FailureCode.UNSUPPORTED_RUNTIME_CAPABILITY,
                    "gate",
                    "Runtime capability 'integrated-barrier-policy' at "
                    "'#/nodes/3/config' is not implemented by "
                    "runtime-capability/v1alpha1",
                )
            ]
        assert started == resumed
        assert store.read_calls == 0
        assert store.append_calls == 0
        assert calls == []

    asyncio.run(scenario())
