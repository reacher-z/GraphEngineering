"""Integrated barrier policy, compiler pass, and capability-gate conformance.

Every expectation is read from the literal shared corpus
``spec/conformance/integrated-barrier.case.json`` or recomputed here by the
native Python canonical serializer. Nothing is imported from, or derived from,
the TypeScript runtime.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

import pytest

from graph_engineering import (
    FailureCode,
    NodeContext,
    ProtectedGraphEvent,
    RunStatus,
    compile_graph,
    resume_graph_run,
    run_graph,
    start_graph_run,
)
from graph_engineering.compiler import Diagnostic, DiagnosticCode, try_compile_graph
from graph_engineering.integrated_barrier import (
    InvalidBarrierPolicy,
    UnclaimedBarrierConfig,
    ValidBarrierPolicy,
    claims_integrated_barrier_policy,
    validate_integrated_barrier_policy,
)
from graph_engineering.models import JsonValue
from graph_engineering.redaction.guard import PreparedSinkWrite
from tests.durable_support import memory_protection

ROOT = Path(__file__).resolve().parents[2]
CORPUS: dict[str, Any] = json.loads(
    (ROOT / "spec/conformance/integrated-barrier.case.json").read_text()
)
# Section 4.2: a durable run refuses before preflight without a configured
# protection authority, so the zero-store-IO assertion needs one.
PROTECTION = memory_protection()
POLICY_SCHEMA: dict[str, Any] = json.loads(
    (ROOT / "spec/integrated-barrier-policy.schema.json").read_text()
)
POLICY_CASES: list[dict[str, Any]] = CORPUS["policyCases"]
COMPILER_CASES: list[dict[str, Any]] = CORPUS["compilerCases"]
OWNERSHIP_CASES: list[dict[str, Any]] = CORPUS["ownershipCases"]

BARRIER_CODES = (
    DiagnosticCode.INVALID_BARRIER_POLICY,
    DiagnosticCode.BARRIER_POLICY_KIND_MISMATCH,
    DiagnosticCode.BARRIER_NO_INPUTS,
    DiagnosticCode.BARRIER_THRESHOLD_EXCEEDS_INPUTS,
)


def _projection(diagnostic: Diagnostic) -> dict[str, Any]:
    """Project a diagnostic exactly as ``diagnosticProjection`` requires."""

    projected: dict[str, Any] = {"code": diagnostic.code.value}
    if diagnostic.path is not None:
        projected["path"] = diagnostic.path
    if diagnostic.node_ids is not None:
        projected["nodeIds"] = list(diagnostic.node_ids)
    if diagnostic.edge_id is not None:
        projected["edgeId"] = diagnostic.edge_id
    return projected


def _snapshot_document(policy: Any) -> dict[str, Any]:
    document: dict[str, Any] = {
        "apiVersion": policy.api_version,
        "kind": policy.kind,
        "onUnsatisfied": policy.on_unsatisfied,
        "lateArrival": policy.late_arrival,
    }
    if policy.minimum is not None:
        document["minimum"] = policy.minimum
    if policy.basis_points is not None:
        document["basisPoints"] = policy.basis_points
    if policy.quorum is not None:
        document["quorum"] = {
            "accepts": policy.quorum.accepts,
            "countAbstainAsParticipant": policy.quorum.count_abstain_as_participant,
        }
    if policy.deadline is not None:
        document["deadline"] = {"afterMs": policy.deadline.after_ms}
    return document


def _config_diagnostics(config: Any) -> list[dict[str, Any]]:
    """Project one config's policy diagnostics as ``ownershipCases`` does."""

    result = validate_integrated_barrier_policy(config)
    if type(result) is not InvalidBarrierPolicy:
        return []
    return [{"code": result.code.value, "relativePath": result.relative_path}]


def test_corpus_claim_flags_are_untouched_and_literally_false() -> None:
    assert CORPUS["implementationClaim"] is False
    assert CORPUS["claims"] == {
        "implementationClaim": False,
        "typescriptRuntimeClaim": False,
        "pythonRuntimeClaim": False,
        "capabilityGateClaim": False,
    }
    assert CORPUS["provenance"]["expectationsImportedFromOtherFixtures"] == []


def test_corpus_shape_matches_the_tranche_one_surface() -> None:
    assert len(POLICY_CASES) == 79
    assert len(COMPILER_CASES) == 16
    assert len(OWNERSHIP_CASES) == 15
    assert CORPUS["diagnosticCodes"] == [code.value for code in BARRIER_CODES]
    assert CORPUS["diagnosticProjection"] == {
        "fieldsInOrder": ["code", "path", "nodeIds", "edgeId"],
        "absentFieldBehavior": "omit",
        "preserveDiagnosticOrder": True,
        "preserveNodeIdOrder": True,
    }
    assert CORPUS["diagnosticEmissionOrder"]["passOrder"][6] == "GE1421..GE1424"
    assert CORPUS["diagnosticEmissionOrder"]["passOrder"][7] == "GE1201..GE1208"


@pytest.mark.parametrize("case", POLICY_CASES, ids=[case["name"] for case in POLICY_CASES])
def test_every_policy_case_matches_the_literal_corpus(case: dict[str, Any]) -> None:
    expected = case["expect"]
    result = validate_integrated_barrier_policy(case["config"])

    assert result.valid is expected["valid"], case["name"]
    assert result.claimed is expected["claimed"], case["name"]
    assert claims_integrated_barrier_policy(case["config"]) is expected["claimed"], case["name"]

    if expected["valid"]:
        assert type(result) is ValidBarrierPolicy
        assert _snapshot_document(result.policy) == expected["policy"], case["name"]
    elif expected["claimed"]:
        assert type(result) is InvalidBarrierPolicy
        assert result.code.value == expected["code"], case["name"]
        assert result.relative_path == expected["relativePath"], case["name"]
    else:
        # An unclaimed config carries no diagnostic at all.
        assert type(result) is UnclaimedBarrierConfig
        assert "code" not in expected
        assert "relativePath" not in expected


@pytest.mark.parametrize("case", OWNERSHIP_CASES, ids=[case["name"] for case in OWNERSHIP_CASES])
def test_every_ownership_case_proves_the_discriminator(case: dict[str, Any]) -> None:
    expected = case["expect"]
    assert claims_integrated_barrier_policy(case["config"]) is expected["claimed"], case["name"]
    assert _config_diagnostics(case["config"]) == expected["diagnostics"], case["name"]


def test_ownership_cases_cover_both_directions_of_the_discriminator() -> None:
    unclaimed = [case for case in OWNERSHIP_CASES if case["expect"]["claimed"] is False]
    claimed = [case for case in OWNERSHIP_CASES if case["expect"]["claimed"] is True]
    assert len(unclaimed) == 11
    assert len(claimed) == 4
    # Every unclaimed config is silent, whatever its shape.
    assert all(case["expect"]["diagnostics"] == [] for case in unclaimed)
    # A claimed carrier is fully diagnosed; a typo is never a silent pass.
    typo = next(
        case
        for case in claimed
        if case["name"] == "claimed-carrier-with-a-misspelled-kind-is-diagnosed"
    )
    assert _config_diagnostics(typo["config"]) == [
        {"code": DiagnosticCode.INVALID_BARRIER_POLICY.value, "relativePath": "/kynd"}
    ]


def test_legacy_barrier_configs_stay_unclaimed_and_keep_compiling() -> None:
    for name in ("legacy-condition-all-config", "empty-config"):
        case = next(item for item in OWNERSHIP_CASES if item["name"].startswith(name))
        assert case["expect"]["claimed"] is False
        assert claims_integrated_barrier_policy(case["config"]) is False

    # The repository's canonical example graph still carries {"condition": "all"}.
    diamond = json.loads((ROOT / "spec/conformance/diamond.graph.json").read_text())
    barriers = [node for node in diamond["nodes"] if node["kind"] == "barrier"]
    assert barriers and all(
        claims_integrated_barrier_policy(node["config"]) is False for node in barriers
    )
    result = try_compile_graph(diamond)
    assert result.valid
    assert not [item for item in result.diagnostics if item.code in BARRIER_CODES]


def test_policy_cases_cover_both_diagnostic_categories_and_both_kind_directions() -> None:
    valid = [case for case in POLICY_CASES if case["expect"]["valid"]]
    unclaimed = [case for case in POLICY_CASES if case["expect"]["claimed"] is False]
    shape = [
        case
        for case in POLICY_CASES
        if case["expect"].get("code") == DiagnosticCode.INVALID_BARRIER_POLICY.value
    ]
    mismatch = [
        case
        for case in POLICY_CASES
        if case["expect"].get("code") == DiagnosticCode.BARRIER_POLICY_KIND_MISMATCH.value
    ]
    assert len(valid) + len(unclaimed) + len(shape) + len(mismatch) == len(POLICY_CASES)
    assert valid and unclaimed and shape and mismatch

    # Both GE1422 directions: a field required by kind is absent, and a field
    # forbidden by kind is present.
    absent = [case for case in mismatch if case["expect"]["relativePath"][1:] not in case["config"]]
    present = [case for case in mismatch if case["expect"]["relativePath"][1:] in case["config"]]
    assert len(absent) == 3
    assert len(present) == len(mismatch) - 3
    assert {case["config"]["kind"] for case in absent} == {"minimum", "percentage", "quorum"}
    assert {case["expect"]["relativePath"] for case in present} == {
        "/minimum",
        "/basisPoints",
        "/quorum",
    }


def test_portable_number_convention_is_the_repository_convention() -> None:
    literal_cases = [case for case in POLICY_CASES if "integerSourceLiteral" in case]
    assert len(literal_cases) == 4
    for case in literal_cases:
        result = validate_integrated_barrier_policy(case["config"])
        assert type(result) is ValidBarrierPolicy, case["name"]
        for value in _snapshot_document(result.policy).values():
            assert type(value) is not float
    # Booleans are never integers, at every integer-bearing member.
    boolean_cases = [case for case in POLICY_CASES if case["name"].startswith("boolean-is-not")]
    assert len(boolean_cases) == 4
    for case in boolean_cases:
        result = validate_integrated_barrier_policy(case["config"])
        assert type(result) is InvalidBarrierPolicy, case["name"]


def test_contract_order_witnesses_follow_the_declaration_block_not_the_schema() -> None:
    declaration_order = CORPUS["firstInvalidDescendantRule"]["policyFieldOrder"]
    assert declaration_order == [
        "apiVersion",
        "kind",
        "minimum",
        "basisPoints",
        "quorum",
        "deadline",
        "onUnsatisfied",
        "lateArrival",
    ]
    schema_order = list(POLICY_SCHEMA["properties"])
    # The two orders genuinely disagree; the declaration block is normative.
    assert schema_order != [name for name in declaration_order if name in schema_order]

    witnesses = [case for case in POLICY_CASES if case.get("contractOrderWitness") is True]
    assert len(witnesses) == 3
    by_name = {case["name"]: case for case in witnesses}

    threshold = by_name["threshold-field-precedes-resolution-field-in-contract-order"]
    result = validate_integrated_barrier_policy(threshold["config"])
    assert type(result) is InvalidBarrierPolicy
    # The schema `properties` order would have produced "/onUnsatisfied" here.
    assert result.relative_path == "/minimum"
    assert schema_order.index("onUnsatisfied") < schema_order.index("deadline")

    deadline = by_name["deadline-precedes-resolution-field-in-contract-order"]
    deadline_result = validate_integrated_barrier_policy(deadline["config"])
    assert type(deadline_result) is InvalidBarrierPolicy
    assert deadline_result.relative_path == "/deadline/afterMs"

    suppressed = by_name["shape-error-suppresses-a-cardinality-error-on-the-same-config"]
    suppressed_result = validate_integrated_barrier_policy(suppressed["config"])
    assert type(suppressed_result) is InvalidBarrierPolicy
    # `minimum` is absent on a `minimum` policy, but the shape error wins.
    assert suppressed_result.code is DiagnosticCode.INVALID_BARRIER_POLICY
    assert suppressed_result.relative_path == "/onUnsatisfied"


@pytest.mark.parametrize("case", COMPILER_CASES, ids=[case["name"] for case in COMPILER_CASES])
def test_every_compiler_case_matches_order_suppression_and_literal_graph_hash(
    case: dict[str, Any],
) -> None:
    result = try_compile_graph(case["graph"])

    # The graph hash is recomputed by the native Python canonical serializer.
    assert result.graph_hash == case["graphHash"], case["name"]
    assert [_projection(item) for item in result.diagnostics] == case["expectDiagnostics"], case[
        "name"
    ]
    assert result.valid is case["expectValid"], case["name"]
    assert (result.graph is not None) is case["expectValid"], case["name"]


def test_compiler_cases_emit_by_category_then_node_declaration_order() -> None:
    rank = {code.value: index for index, code in enumerate(BARRIER_CODES)}
    seen: set[str] = set()
    for case in COMPILER_CASES:
        diagnostics = [_projection(item) for item in try_compile_graph(case["graph"]).diagnostics]
        barrier = [item for item in diagnostics if item["code"] in rank]
        seen.update(item["code"] for item in barrier)
        ranks = [rank[item["code"]] for item in barrier]
        assert ranks == sorted(ranks), case["name"]

        nodes = [node["id"] for node in case["graph"]["nodes"]]
        for value in set(ranks):
            indexes = [
                nodes.index(item["nodeIds"][0]) for item in barrier if rank[item["code"]] == value
            ]
            assert indexes == sorted(indexes), case["name"]
    assert seen == set(rank)


def test_router_diagnostics_precede_barrier_diagnostics() -> None:
    case = next(
        item
        for item in COMPILER_CASES
        if item["name"] == "router-pass-emits-before-the-barrier-pass"
    )
    diagnostics = try_compile_graph(case["graph"]).diagnostics
    assert [item.code for item in diagnostics] == [
        DiagnosticCode.INVALID_ROUTER_POLICY,
        DiagnosticCode.INVALID_BARRIER_POLICY,
    ]


def test_suppression_chain_is_local_to_one_node() -> None:
    chain = next(
        item
        for item in COMPILER_CASES
        if item["name"] == "ge1421-suppresses-ge1422-and-ge1424-on-the-same-node-only"
    )
    diagnostics = [_projection(item) for item in try_compile_graph(chain["graph"]).diagnostics]
    bad = [item for item in diagnostics if item["nodeIds"] == ["gate-bad"]]
    other = [item for item in diagnostics if item["nodeIds"] == ["gate-other"]]
    # gate-bad carries an unknown key, a forbidden `minimum` and a `minimum`
    # above its incoming-edge count; only GE1421 survives on that node.
    assert [item["code"] for item in bad] == [DiagnosticCode.INVALID_BARRIER_POLICY.value]
    # The chain never reaches across nodes.
    assert [item["code"] for item in other] == [
        DiagnosticCode.BARRIER_POLICY_KIND_MISMATCH.value
    ]

    kind_chain = next(
        item
        for item in COMPILER_CASES
        if item["name"] == "ge1422-suppresses-ge1424-on-the-same-node"
    )
    kind_diagnostics = try_compile_graph(kind_chain["graph"]).diagnostics
    assert [item.code for item in kind_diagnostics] == [
        DiagnosticCode.BARRIER_POLICY_KIND_MISMATCH
    ]

    no_inputs = next(
        item
        for item in COMPILER_CASES
        if item["name"] == "ge1421-does-not-suppress-ge1423-on-the-same-node"
    )
    no_input_diagnostics = try_compile_graph(no_inputs["graph"]).diagnostics
    assert [item.code for item in no_input_diagnostics] == [
        DiagnosticCode.INVALID_BARRIER_POLICY,
        DiagnosticCode.BARRIER_NO_INPUTS,
    ]


def test_unclaimed_barrier_configs_are_never_ge1007_and_never_ge142x() -> None:
    for name in (
        "non-object-barrier-config-cannot-be-claimed-and-emits-nothing",
        "legacy-barrier-config-is-untouched-beside-a-claimed-policy",
        "empty-legacy-barrier-config-emits-nothing",
    ):
        case = next(item for item in COMPILER_CASES if item["name"] == name)
        result = try_compile_graph(case["graph"])
        assert result.graph_hash == case["graphHash"], name
        assert DiagnosticCode.INVALID_GRAPH not in {item.code for item in result.diagnostics}, name
        unclaimed = [
            node["id"]
            for node in case["graph"]["nodes"]
            if node["kind"] == "barrier" and not claims_integrated_barrier_policy(node["config"])
        ]
        assert unclaimed, name
        assert not [
            item
            for item in result.diagnostics
            if item.code in BARRIER_CODES and set(item.node_ids or ()) & set(unclaimed)
        ], name


POLICY_BEARING_CASE = next(
    case
    for case in COMPILER_CASES
    if case["name"] == "valid-multi-barrier-graph-emits-no-barrier-diagnostics"
)
POLICY_BEARING_BARRIERS = tuple(
    (index, node["id"])
    for index, node in enumerate(POLICY_BEARING_CASE["graph"]["nodes"])
    if node["kind"] == "barrier"
)


def _capability_message(path: str) -> str:
    return (
        f"Runtime capability 'node-config:barrier' at '{path}' "
        "is not implemented by runtime-capability/v1alpha1"
    )


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


def test_exact_policy_barriers_are_refused_before_dispatch_with_no_side_effect() -> None:
    assert len(POLICY_BEARING_BARRIERS) == 3
    for _, node_id in POLICY_BEARING_BARRIERS:
        config = next(
            node["config"]
            for node in POLICY_BEARING_CASE["graph"]["nodes"]
            if node["id"] == node_id
        )
        assert validate_integrated_barrier_policy(config).valid is True

    calls: list[str] = []

    def handler(context: NodeContext) -> Any:
        calls.append(context.node.id)
        return context.input

    compiled = compile_graph(POLICY_BEARING_CASE["graph"])
    result = asyncio.run(run_graph(compiled, {}, {"*": handler}))

    assert result.status is RunStatus.FAILED
    assert [failure.code for failure in result.failures] == [
        FailureCode.UNSUPPORTED_RUNTIME_CAPABILITY
    ] * 3
    # Grouped in node declaration order.
    assert [failure.node_id for failure in result.failures] == [
        node_id for _, node_id in POLICY_BEARING_BARRIERS
    ]
    assert [failure.message for failure in result.failures] == [
        _capability_message(f"#/nodes/{index}/config") for index, _ in POLICY_BEARING_BARRIERS
    ]
    assert [failure.attempt for failure in result.failures] == [0, 0, 0]
    assert calls == []
    assert dict(result.nodes) == {}
    assert result.outputs is None
    assert result.scheduled_order == ()
    assert result.completion_order == ()
    assert result.total_attempts == 0


def test_exact_policy_barriers_are_refused_with_zero_durable_store_io() -> None:
    async def scenario() -> None:
        calls: list[str] = []

        def handler(context: NodeContext) -> Any:
            calls.append(context.node.id)
            return context.input

        compiled = compile_graph(POLICY_BEARING_CASE["graph"])
        store = NoIoEventStore()
        started = await start_graph_run(
            compiled,
            {},
            {"*": handler},
            run_id="integrated-barrier-capability",
            implementation_id="integrated-barrier@1",
            event_store=store,
            payload_protection=PROTECTION,
        )
        resumed = await resume_graph_run(
            compiled,
            {"*": handler},
            run_id="integrated-barrier-capability",
            implementation_id="integrated-barrier@1",
            event_store=store,
            payload_protection=PROTECTION,
        )

        assert started.status is RunStatus.FAILED
        assert resumed == started
        assert store.read_calls == 0
        assert store.append_calls == 0
        assert calls == []
        assert dict(started.nodes) == {}
        assert started.total_attempts == 0

    asyncio.run(scenario())
