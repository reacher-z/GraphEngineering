"""The D13 conformance corpus executed against the native Python rule engine.

Every expectation is a literal read from ``spec/conformance/adapter.case.json``.
Nothing here restates a contract fact, and a disagreement between the
implementation and the corpus fails here rather than being reconciled.

No TypeScript output is imported and no Node process is started: this lane
recomputes every projection from the corpus in Python.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import pytest

from graph_engineering.adapters import (
    ADAPTER_CAPABILITIES,
    ADAPTER_ERROR_CODES,
    ADAPTER_KINDS,
    DENIAL_REASONS,
    FINISH_REASONS,
    REPORTABLE_RESOURCES,
    RESOURCE_UNITS,
    SIDE_EFFECT_ORDER,
    TAXONOMY_FACTS,
    AdapterContractError,
    AdapterErrorEnvelope,
    AdapterUsage,
    CircuitStep,
    StreamFrame,
    ToolCallResponse,
    circuit_fold,
    derive_budget_cost_state,
    derive_ledger_action,
    derive_usage_disposition,
    is_sorted_by_code_point,
    normalize_stream,
    preflight,
    requires_in_doubt_record,
    retry_decision,
    side_effect_permits_retry,
    validate_descriptor,
    validate_descriptor_against_budget_policy,
    validate_error_envelope,
    validate_tool_calls,
    validate_usage,
)
from tests.adapter_corpus import (
    CORPUS,
    CORPUS_PATH,
    apply_mutations,
    budget_policy_metrics,
    case_ids,
    cases,
    descriptor_document,
    descriptor_for,
    forbidden_markers,
    request_from,
)

POLICY_METRICS = budget_policy_metrics()
MARKERS = forbidden_markers()

#: Rules produced anywhere in this module; the register must be fully covered.
EXERCISED: set[str] = set()
OBSERVED_CODES: set[str] = set()
DENIALS_OBSERVED: set[str] = set()


@dataclass(frozen=True, slots=True)
class Observation:
    code: str | None
    rule: str | None
    message: str | None
    denial_reason: str | None = None


def observe(run: Callable[[], None]) -> Observation:
    try:
        run()
    except AdapterContractError as error:
        return Observation(
            code=error.code,
            rule=error.rule,
            message=error.message,
            denial_reason=error.denial_reason,
        )
    return Observation(code=None, rule=None, message=None)


def record(observation: Observation, expected_code: object, expected_rule: object) -> None:
    assert observation.code == expected_code
    assert observation.rule == expected_rule
    if observation.rule is not None:
        EXERCISED.add(observation.rule)
        if observation.code is not None:
            OBSERVED_CODES.add(observation.code)


def _template(name: str) -> Any:
    return json.loads(json.dumps(CORPUS[name]))


# ---------------------------------------------------------------------------
# Corpus honesty flags
# ---------------------------------------------------------------------------


def test_corpus_is_deterministic_mock_evidence_claiming_no_implementation() -> None:
    assert CORPUS["apiVersion"] == (
        "graphengineering.reacher-z.github.io/adapter-conformance/v1alpha1"
    )
    assert CORPUS["contractStatus"] == "contract-only-native-implementation-required"
    assert CORPUS["implementationClaim"] is False
    assert isinstance(CORPUS["implementationClaim"], bool)
    assert CORPUS["evidenceClass"] == "deterministic-mock"
    assert CORPUS["environmentAssertions"] == {
        "credentialRequired": False,
        "injectedClockOnly": True,
        "networkAccess": False,
        "wallClockDependence": False,
    }


def test_three_agent_harness_integrations_are_not_official_adapters() -> None:
    notes = CORPUS["integrationNotes"]
    assert len(notes) == 3
    for note in notes:
        assert note["officialV1Adapter"] is False
        assert note["privateApiClaim"] is False
        assert note["mechanism"] in {"mcp", "shell"}
        assert note["integration"] not in ADAPTER_KINDS


# ---------------------------------------------------------------------------
# Closed inventories
# ---------------------------------------------------------------------------


def test_inventories_match_the_corpus_exactly_and_in_order() -> None:
    assert list(ADAPTER_CAPABILITIES) == CORPUS["capabilityInventory"]
    assert list(ADAPTER_KINDS) == CORPUS["adapterKindInventory"]
    assert list(DENIAL_REASONS) == CORPUS["denialReasonInventory"]
    assert list(FINISH_REASONS) == CORPUS["finishReasonInventory"]
    assert list(REPORTABLE_RESOURCES) == CORPUS["reportableResourceInventory"]
    assert list(SIDE_EFFECT_ORDER) == CORPUS["cycleComposition"]["sideEffectClasses"]


def test_every_inventory_is_in_unicode_code_point_order() -> None:
    for values in (
        ADAPTER_CAPABILITIES,
        ADAPTER_KINDS,
        DENIAL_REASONS,
        FINISH_REASONS,
        REPORTABLE_RESOURCES,
        ADAPTER_ERROR_CODES,
    ):
        assert is_sorted_by_code_point(values)
    assert len(ADAPTER_CAPABILITIES) == 16
    assert len(ADAPTER_ERROR_CODES) == 14
    assert len(ADAPTER_KINDS) == 8


def test_every_meter_binds_the_unit_and_aggregation_the_budget_contract_fixes() -> None:
    bindings = CORPUS["budgetComposition"]["resourceBindings"]
    assert [row["resource"] for row in bindings] == list(REPORTABLE_RESOURCES)
    for row in bindings:
        assert row["unit"] == RESOURCE_UNITS[row["resource"]]
        assert row["aggregation"] == "sum"
    forbidden = CORPUS["budgetComposition"]["forbiddenResources"]
    # adapter-semantics 7.1: money is not adapter-reportable.
    assert "money-nano-minor" in forbidden
    assert "money-nano-minor" not in REPORTABLE_RESOURCES
    assert len(forbidden) == 16


def test_every_cost_state_binding_is_derived_from_trust() -> None:
    for binding in CORPUS["budgetComposition"]["costStateBindings"]:
        assert binding["budgetCostState"] == derive_budget_cost_state(binding["trust"])


# ---------------------------------------------------------------------------
# Closed failure taxonomy
# ---------------------------------------------------------------------------


def test_every_taxonomy_row_is_recomputed_rather_than_read() -> None:
    rows = CORPUS["errorTaxonomy"]
    assert [row["code"] for row in rows] == list(ADAPTER_ERROR_CODES)
    retryable = 0
    pre_dispatch = 0
    for row in rows:
        facts = TAXONOMY_FACTS[row["code"]]
        usage_disposition = derive_usage_disposition(facts.effect_disposition)
        assert {
            "boundary": row["boundary"],
            "retryable": row["retryable"],
            "effectDisposition": row["effectDisposition"],
            "usageDisposition": row["usageDisposition"],
            "ledgerAction": row["ledgerAction"],
        } == {
            "boundary": facts.boundary,
            "retryable": facts.retryable,
            "effectDisposition": facts.effect_disposition,
            "usageDisposition": usage_disposition,
            "ledgerAction": derive_ledger_action(usage_disposition),
        }
        if facts.boundary == "pre-dispatch":
            pre_dispatch += 1
            assert facts.retryable is False
            assert facts.effect_disposition == "not-applied"
        if facts.retryable:
            retryable += 1
    assert retryable == 4
    assert pre_dispatch == 5


def test_in_doubt_composition_matrix_of_cycle_semantics_13_4() -> None:
    expected = [
        {
            "effectDisposition": disposition,
            "recordsInDoubtIdentity": requires_in_doubt_record(disposition, side_effect_class),
            "retryPermittedBySideEffect": side_effect_permits_retry(
                disposition, side_effect_class
            ),
            "sideEffectClass": side_effect_class,
        }
        for disposition in ("applied", "in-doubt", "not-applied")
        for side_effect_class in SIDE_EFFECT_ORDER
    ]
    assert CORPUS["cycleComposition"]["matrix"] == expected
    assert len([row for row in expected if row["recordsInDoubtIdentity"]]) == 2


# ---------------------------------------------------------------------------
# Shipped descriptors
# ---------------------------------------------------------------------------


def test_all_twelve_descriptors_are_accepted_and_cover_every_kind_and_capability() -> None:
    declared: set[str] = set()
    kinds: set[str] = set()
    for document in CORPUS["descriptors"]:
        assert document["evidenceClass"] == "deterministic-mock"
        descriptor = descriptor_for(document["adapterId"])
        assert validate_descriptor(descriptor) is True
        assert validate_descriptor_against_budget_policy(descriptor, POLICY_METRICS) is True
        kinds.add(descriptor.adapter_kind)
        declared.update(descriptor.capabilities)
    for kind in ADAPTER_KINDS:
        assert kind in kinds
    for capability in ADAPTER_CAPABILITIES:
        assert capability in declared


# ---------------------------------------------------------------------------
# The case sections
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("case", cases("descriptorCases"), ids=case_ids("descriptorCases"))
def test_descriptor_case(case: dict[str, Any]) -> None:
    candidate = descriptor_for(case["base"], case["mutations"])

    def run() -> None:
        validate_descriptor(candidate)
        validate_descriptor_against_budget_policy(candidate, POLICY_METRICS)

    record(observe(run), case["expectedCode"], case["expectedRule"])


@pytest.mark.parametrize("case", cases("preflightCases"), ids=case_ids("preflightCases"))
def test_preflight_case(case: dict[str, Any]) -> None:
    descriptor = descriptor_for(case["descriptor"], case.get("descriptorMutations"))
    request = request_from(case.get("requestMutations"))

    def run() -> None:
        outcome = preflight(descriptor, request, POLICY_METRICS)
        assert outcome.admitted is True
        assert outcome.request_id == request.request_id

    observation = observe(run)
    record(observation, case["expectedCode"], case["expectedRule"])
    if "expectedMessage" in case:
        assert observation.message == case["expectedMessage"]
    # A denial reason is a corpus literal, not a restatement: the reason the
    # engine produced must be the reason the corpus names, and it accompanies
    # GE_ADAPTER_POLICY_DENIED and nothing else.
    assert observation.denial_reason == case.get("expectedDenialReason")
    if observation.denial_reason is not None:
        assert observation.code == "GE_ADAPTER_POLICY_DENIED"
        assert observation.denial_reason in DENIAL_REASONS
        DENIALS_OBSERVED.add(observation.denial_reason)


@pytest.mark.parametrize("case", cases("streamCases"), ids=case_ids("streamCases"))
def test_stream_case(case: dict[str, Any]) -> None:
    descriptor = descriptor_for(case["descriptor"], case.get("descriptorMutations"))
    documents = apply_mutations(_template("streamTemplate"), case.get("mutations"))
    frames = tuple(StreamFrame.from_document(item) for item in documents)

    def run() -> None:
        normalized = normalize_stream(descriptor, frames)
        if case.get("expectedNormalized") is not None:
            assert normalized.as_document() == case["expectedNormalized"]

    record(observe(run), case["expectedCode"], case["expectedRule"])


@pytest.mark.parametrize("case", cases("usageCases"), ids=case_ids("usageCases"))
def test_usage_case(case: dict[str, Any]) -> None:
    descriptor = descriptor_for(case["descriptor"], case.get("descriptorMutations"))
    usage = AdapterUsage.from_document(
        apply_mutations(_template("usageTemplate"), case.get("mutations"))
    )

    def run() -> None:
        summary = validate_usage(descriptor, usage)
        if case.get("expectedSummary") is not None:
            assert summary.as_document() == case["expectedSummary"]

    record(observe(run), case["expectedCode"], case["expectedRule"])


@pytest.mark.parametrize("case", cases("toolCases"), ids=case_ids("toolCases"))
def test_tool_case(case: dict[str, Any]) -> None:
    descriptor = descriptor_for(case["descriptor"], case.get("descriptorMutations"))
    request = request_from(case.get("requestMutations"))
    response = ToolCallResponse.from_document(
        apply_mutations(_template("toolResponseTemplate"), case.get("mutations"))
    )

    def run() -> None:
        summary = validate_tool_calls(descriptor, request, response)
        assert summary.tool_calls == len(response.tool_calls)

    record(observe(run), case["expectedCode"], case["expectedRule"])


@pytest.mark.parametrize("case", cases("errorCases"), ids=case_ids("errorCases"))
def test_error_case(case: dict[str, Any]) -> None:
    descriptor = descriptor_for(case["descriptor"], case.get("descriptorMutations"))
    envelope = AdapterErrorEnvelope.from_document(
        apply_mutations(_template("errorTemplate"), case.get("mutations"))
    )

    def run() -> None:
        summary = validate_error_envelope(descriptor, envelope, MARKERS)
        if case.get("expectedSummary") is not None:
            assert summary.as_document() == case["expectedSummary"]

    record(observe(run), case["expectedCode"], case["expectedRule"])
    if case["expectedCode"] is None:
        OBSERVED_CODES.add(envelope.code)


@pytest.mark.parametrize("case", cases("retryCases"), ids=case_ids("retryCases"))
def test_retry_case(case: dict[str, Any]) -> None:
    descriptor = descriptor_for(case["descriptor"], case.get("descriptorMutations"))
    decision = retry_decision(
        descriptor,
        case["code"],
        case["sideEffectClass"],
        case["attempt"],
        case["retryAfterMs"],
    )
    assert decision.as_document() == case["expected"]
    EXERCISED.add(decision.rule)


@pytest.mark.parametrize("case", cases("circuitCases"), ids=case_ids("circuitCases"))
def test_circuit_case(case: dict[str, Any]) -> None:
    descriptor = descriptor_for(case["descriptor"])
    script = tuple(CircuitStep.from_document(step) for step in case["script"])
    projection = circuit_fold(descriptor, script)
    assert projection.as_document() == case["expected"]
    for rule in case["rules"]:
        EXERCISED.add(rule)


# ---------------------------------------------------------------------------
# Coverage is a hard failure
# ---------------------------------------------------------------------------


def _replay_every_case() -> None:
    """Run every rule-producing section once, independently of test ordering."""
    for case in cases("descriptorCases"):
        test_descriptor_case(case)
    for case in cases("preflightCases"):
        test_preflight_case(case)
    for case in cases("streamCases"):
        test_stream_case(case)
    for case in cases("usageCases"):
        test_usage_case(case)
    for case in cases("toolCases"):
        test_tool_case(case)
    for case in cases("errorCases"):
        test_error_case(case)
    for case in cases("retryCases"):
        test_retry_case(case)
    for case in cases("circuitCases"):
        test_circuit_case(case)


def test_every_registered_rule_is_exercised_and_no_unregistered_rule_is_produced() -> None:
    _replay_every_case()
    registered = {str(row["rule"]) for row in CORPUS["ruleRegister"]}
    assert sorted(rule for rule in registered if rule not in EXERCISED) == []
    assert sorted(rule for rule in EXERCISED if rule not in registered) == []
    assert len(registered) == CORPUS["declaredCounts"]["rules"]


def test_every_code_in_the_closed_taxonomy_is_produced() -> None:
    _replay_every_case()
    for code in ADAPTER_ERROR_CODES:
        assert code in OBSERVED_CODES


def test_the_engine_produces_every_denial_reason_in_the_closed_set() -> None:
    _replay_every_case()
    for reason in DENIAL_REASONS:
        assert reason in DENIALS_OBSERVED


def test_the_register_agrees_on_every_rule_code_and_denial_reason() -> None:
    rows = {str(row["rule"]): row for row in CORPUS["ruleRegister"]}
    denials: set[str] = set()
    for case in cases("preflightCases"):
        reason = case.get("expectedDenialReason")
        if reason is None:
            continue
        assert case["expectedCode"] == "GE_ADAPTER_POLICY_DENIED"
        assert rows[str(case["expectedRule"])]["denialReason"] == reason
        denials.add(str(reason))
    for reason in DENIAL_REASONS:
        assert reason in denials


def test_a_decision_rule_never_carries_a_portable_code() -> None:
    for row in CORPUS["ruleRegister"]:
        if row["kind"] == "decision":
            assert row["code"] is None
            assert row["denialReason"] is None
        else:
            assert row["code"] in ADAPTER_ERROR_CODES


def test_every_finish_reason_and_every_reportable_meter_is_exercised() -> None:
    finishes: set[str] = set()
    for case in cases("streamCases"):
        normalized = case.get("expectedNormalized")
        if normalized is not None and normalized.get("finishReason") is not None:
            finishes.add(str(normalized["finishReason"]))
        if case.get("finishReasonExercised") is not None:
            finishes.add(str(case["finishReasonExercised"]))
    for reason in FINISH_REASONS:
        assert reason in finishes

    resources: set[str] = set()
    for case in cases("usageCases"):
        for resource in case.get("resourcesExercised") or ():
            resources.add(str(resource))
    for resource in REPORTABLE_RESOURCES:
        assert resource in resources


def test_exactly_the_section_counts_the_corpus_declares_are_consumed() -> None:
    assert {
        "circuitCases": len(cases("circuitCases")),
        "descriptorCases": len(cases("descriptorCases")),
        "descriptors": len(CORPUS["descriptors"]),
        "errorCases": len(cases("errorCases")),
        "preflightCases": len(cases("preflightCases")),
        "retryCases": len(cases("retryCases")),
        "rules": len(CORPUS["ruleRegister"]),
        "schemaNegativeCases": len(cases("schemaNegativeCases")),
        "streamCases": len(cases("streamCases")),
        "toolCases": len(cases("toolCases")),
        "usageCases": len(cases("usageCases")),
    } == CORPUS["declaredCounts"]


def test_no_host_in_the_corpus_could_ever_resolve() -> None:
    text = CORPUS_PATH.read_text(encoding="utf-8")
    document = json.loads(text)
    hosts: list[str] = []

    def walk(node: object) -> None:
        if isinstance(node, dict):
            for key, value in node.items():
                if key == "host" and isinstance(value, str):
                    hosts.append(value)
                walk(value)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(document)
    assert hosts
    for host in hosts:
        assert host == "localhost" or host.endswith((".invalid", ".test"))
    assert "http://" not in text
    assert "https://" not in text


def test_the_shipped_corpus_declares_no_live_provider_descriptor() -> None:
    for document in CORPUS["descriptors"]:
        assert document["evidenceClass"] != "live-provider"


def test_a_descriptor_document_round_trips_through_the_reader() -> None:
    for document in CORPUS["descriptors"]:
        descriptor = descriptor_for(document["adapterId"])
        assert descriptor.as_document() == descriptor_document(document["adapterId"])
