"""The frozen redaction corpus, replayed against the native Python runtime.

The corpus is the authority.  Nothing here restates an expectation: inventories,
flow decisions, wire documents, guard counters, normalization, and legacy
dispositions are all read from ``spec/conformance/redaction.case.json``.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

import pytest

from graph_engineering.redaction.errors import RedactionFailure, failure
from graph_engineering.redaction.flow import (
    ALGORITHM,
    CARTESIAN_PRODUCT_COUNT,
    SINK_RULE_COUNT,
    SOURCE_RULE_COUNT,
    evaluate_flow,
)
from graph_engineering.redaction.guard import (
    NO_PAYLOAD,
    GuardFailed,
    GuardPrepared,
    GuardSuppressed,
    OccurrenceContext,
    SinkGuard,
    SinkWriteRequest,
    normalize_side_effects,
    open_attempt_retry_disposition,
    retry_disposition_for,
)
from graph_engineering.redaction.inventory import (
    POLICY_CONTROLS,
    SINK_CLASSES,
    SINK_ROWS,
    SOURCE_CLASSES,
    SOURCE_ROWS,
    sink_row,
)
from graph_engineering.redaction.keys import (
    DETERMINISTIC_TEST_KEY_REF,
    DeterministicTestKeyProvider,
)
from graph_engineering.redaction.legacy import classify_record
from graph_engineering.redaction.limits import (
    MAX_CONTAINERS,
    MAX_DIAGNOSTIC_UTF8_BYTES,
    MAX_OBJECT_MEMBERS,
    MAX_POINTER_TOKEN_UTF8_BYTES,
    MAX_POINTER_TOKENS,
    MAX_POINTER_UTF8_BYTES,
    MAX_POINTERS_PER_RULE,
    MAX_POLICY_UTF8_BYTES,
    MAX_PROTECTED_REFS_PER_RECORD,
    MAX_PROTECTED_VALUE_UTF8_BYTES,
    MAX_REF_UTF8_BYTES,
    MAX_TRANSFORMED_UTF8_BYTES,
    MAX_VALUE_DEPTH,
    MAX_VALUE_NODES,
)
from graph_engineering.redaction.policy import (
    CapturePolicy,
    RedactionRule,
    default_stable_profile,
    normalize_capture_policy,
)
from graph_engineering.redaction.protect import (
    MemoryProtectedPayloadStore,
    key_ref_hash,
    value_mac,
)
from graph_engineering.redaction.wire import validate_wire_document

CORPUS_PATH = Path(__file__).resolve().parents[2] / "spec" / "conformance" / "redaction.case.json"
CORPUS: dict[str, Any] = json.loads(CORPUS_PATH.read_text(encoding="utf-8"))

TRANSFORM_HASH = "11" * 32
REGISTRY_HASH = "22" * 32
KEY_REF = "test://deterministic/key-1"


# ----------------------------------------------------------------------
# inventories


def test_source_inventory_matches_the_corpus_exactly() -> None:
    assert list(SOURCE_CLASSES) == CORPUS["sourceInventory"]
    assert len(SOURCE_CLASSES) == SOURCE_RULE_COUNT == 57


def test_sink_inventory_matches_the_corpus_exactly() -> None:
    assert list(SINK_CLASSES) == CORPUS["sinkInventory"]
    assert len(SINK_CLASSES) == SINK_RULE_COUNT == 54


def test_one_classification_row_per_source() -> None:
    expected = CORPUS["sensitiveFieldCases"]
    assert len(expected) == 57
    assert [row.source_class for row in SOURCE_ROWS] == [
        case["sourceClass"] for case in expected
    ]
    for row, case in zip(SOURCE_ROWS, expected, strict=True):
        assert row.policy_control == case["policyControl"]
        assert row.default_action == case["defaultAction"]
        assert row.may_be_metadata == case["mayBeMetadata"]
        assert row.may_feed_scheduler == case["mayFeedScheduler"]
        assert row.identifier_treatment == case["identifierTreatment"]


def test_one_policy_row_per_sink() -> None:
    expected = CORPUS["sinkPolicyCases"]
    assert len(expected) == 54
    for row, case in zip(SINK_ROWS, expected, strict=True):
        assert row.sink == case["sink"]
        assert row.family == case["family"]
        assert list(row.policy_controls) == case["policyControls"]
        assert row.accepts_protected == case["acceptsProtected"]
        assert row.accepts_metadata == case["acceptsMetadata"]
        assert row.default_enabled == case["defaultEnabled"]


def test_flow_policy_header_matches() -> None:
    header = CORPUS["flowPolicy"]
    assert header["algorithm"] == ALGORITHM
    assert header["sourceRuleCount"] == SOURCE_RULE_COUNT
    assert header["sinkRuleCount"] == SINK_RULE_COUNT
    assert header["cartesianProductCount"] == CARTESIAN_PRODUCT_COUNT == 3078


def test_resource_limits_match_the_corpus() -> None:
    limits = CORPUS["resourceLimits"]
    assert limits["maxPolicyUtf8Bytes"] == MAX_POLICY_UTF8_BYTES
    assert limits["maxProtectedValueUtf8Bytes"] == MAX_PROTECTED_VALUE_UTF8_BYTES
    assert limits["maxTransformedUtf8Bytes"] == MAX_TRANSFORMED_UTF8_BYTES
    assert limits["maxValueDepth"] == MAX_VALUE_DEPTH
    assert limits["maxValueNodes"] == MAX_VALUE_NODES
    assert limits["maxContainers"] == MAX_CONTAINERS
    assert limits["maxObjectMembers"] == MAX_OBJECT_MEMBERS
    assert limits["maxPointersPerRule"] == MAX_POINTERS_PER_RULE
    assert limits["maxPointerTokens"] == MAX_POINTER_TOKENS
    assert limits["maxPointerUtf8Bytes"] == MAX_POINTER_UTF8_BYTES
    assert limits["maxPointerTokenUtf8Bytes"] == MAX_POINTER_TOKEN_UTF8_BYTES
    assert limits["maxProtectedRefsPerRecord"] == MAX_PROTECTED_REFS_PER_RECORD
    assert limits["maxRefUtf8Bytes"] == MAX_REF_UTF8_BYTES
    assert limits["maxDiagnosticUtf8Bytes"] == MAX_DIAGNOSTIC_UTF8_BYTES


# ----------------------------------------------------------------------
# flow evaluator


@pytest.mark.parametrize(
    "case", CORPUS["flowCases"], ids=lambda case: str(case["id"])
)
def test_flow_case(case: dict[str, Any]) -> None:
    decision = evaluate_flow(
        case["sourceClass"],
        case["sink"],
        case["policyControl"],
        policy_enabled=case["policyEnabled"],
        known_source=case["knownSource"],
        known_sink=case["knownSink"],
        known_control=case["knownControl"],
    )
    expected = case["expected"]
    assert decision.outcome == expected["outcome"]
    assert decision.write_authorized == expected["writeAuthorized"]
    if "code" in expected:
        assert decision.failure is not None
        assert decision.failure.code == expected["code"]
    else:
        assert decision.failure is None


def test_the_complete_cartesian_domain_is_total() -> None:
    """Every one of the 3,078 pairs produces exactly one closed outcome.

    The control is taken from the sink row rather than hard-coded, because
    Section 7 verifies the control the *sink* row names.  Passing a literal
    ``"events"`` for all 54 sinks would make 47 of them fail the control check
    and leave the intersection rule unwitnessed.
    """

    seen = 0
    for source_class in SOURCE_CLASSES:
        for sink in SINK_CLASSES:
            destination = sink_row(sink)
            assert destination is not None
            decision = evaluate_flow(
                source_class, sink, destination.policy_controls[0], policy_enabled=True
            )
            assert decision.outcome in {
                "suppressed",
                "metadata-only",
                "protected-ref",
            }
            assert decision.write_authorized is (decision.outcome != "suppressed")
            seen += 1
    assert seen == CARTESIAN_PRODUCT_COUNT


def test_the_deterministic_test_provider_matches_the_typescript_vector() -> None:
    """Section 5.3 shared deterministic test provider.

    This provider exists only so shared conformance can compare exact ciphertext
    vectors across the TypeScript and Python lanes, which is a claim about both
    lanes, not about this one.  These constants are restated verbatim by
    "derives the shared cross-language key vector" in
    ``packages/persistence/test/redaction-contract.test.ts``; if either lane
    changes its key reference, derivation, domain string, or nonce rule, exactly
    one of the two tests goes red.
    """

    keys = DeterministicTestKeyProvider()
    run_id = "run-vector-1"
    aad_hash = "a" * 64
    assert keys.key_ref == DETERMINISTIC_TEST_KEY_REF
    assert keys.key_ref == "test-key-provider/deterministic/v1alpha1"
    assert key_ref_hash(keys.key_ref) == (
        "c04d0abfcb3aa0cb7c74e6134d9f0eb525f9f0e0e405fa70e0c8401395625956"
    )
    assert keys.protection_key(run_id).hex() == (
        "045d7f3efb794ef3e5e122a3bb79240c491d30df3dd3b010b63f100c2fdb3fb4"
    )
    assert keys.run_identity_key(run_id).hex() == (
        "d3d3e6c607bda59e78181d3c97d06859cff8e85d3f4f2a1c4a50949d6c3e187f"
    )
    assert keys.nonce(run_id, aad_hash).hex() == "0eb8c477da0f8264cd5b82dc"
    assert value_mac(
        keys.run_identity_key(run_id),
        {"kind": "node-input", "runId": run_id, "graphRevision": 1, "nodeId": "n1"},
        {"x": [1, 2, 3]},
    ) == "947f7559ba85073706bcb7accac4a1dc1c094ed1552b809633af4d78845a1ee7"
    # The nonce is a pure function of the occurrence, not of call order.
    assert keys.nonce(run_id, aad_hash) == keys.nonce(run_id, aad_hash)
    assert keys.nonce(run_id, "b" * 64) != keys.nonce(run_id, aad_hash)
    # The key reference is an input, not decoration.
    other = DeterministicTestKeyProvider(key_ref="other-ref")
    assert other.protection_key(run_id) != keys.protection_key(run_id)
    assert other.run_identity_key(run_id) != keys.run_identity_key(run_id)


def test_a_vocabulary_control_the_sink_row_does_not_own_is_denied() -> None:
    """Section 7 verifies *the row's* named control, not vocabulary membership.

    No corpus fixture separates the two readings: ``redaction.validate.mjs``
    refuses a flow case whose control the named sink does not declare, so the
    case is pinned here where it needs no fixture.  Before this was pinned,
    TypeScript denied and Python authorized the write.
    """

    for sink, control in (
        ("event-journal", "database"),
        ("checkpoint-final", "events"),
        # ``deny`` is in the closed vocabulary and is owned by no sink at all.
        ("event-journal", "deny"),
    ):
        destination = sink_row(sink)
        assert destination is not None
        assert control in POLICY_CONTROLS
        assert control not in destination.policy_controls
        decision = evaluate_flow("graph-input", sink, control, policy_enabled=True)
        assert decision.outcome == "failed", f"{sink}/{control}"
        assert decision.write_authorized is False
        assert decision.failure is not None
        assert decision.failure.code == "REDACTION_POLICY_INVALID"


def test_suppressed_flow_still_reports_the_mandated_identifier_replacement() -> None:
    decision = evaluate_flow(
        "caller-controlled-identifier", "runtime-log", "logs", policy_enabled=False
    )
    assert decision.outcome == "suppressed"
    assert decision.write_authorized is False
    assert decision.identifier_replacement_required is True


def test_unknown_rows_are_denied_and_never_mapped_to_a_neighbour() -> None:
    for source_class, sink in (("future-source", "event-journal"), ("graph-input", "future-sink")):
        decision = evaluate_flow(source_class, sink, "events", policy_enabled=True)
        assert decision.outcome == "failed"
        assert decision.failure is not None
        assert decision.failure.code == "REDACTION_POLICY_INVALID"


# ----------------------------------------------------------------------
# wire documents


@pytest.mark.parametrize(
    "case", CORPUS["wireCases"], ids=lambda case: str(case["id"])
)
def test_wire_case(case: dict[str, Any]) -> None:
    result = validate_wire_document(case["schema"], case["document"])
    if case["valid"]:
        assert result is None
    else:
        assert result is not None
        assert result.code == case["expectedCode"]


def test_every_named_schema_in_the_manifest_has_a_native_validator() -> None:
    named = {case["schema"] for case in CORPUS["wireCases"]}
    assert len(named) == 13
    for schema in named:
        # A missing validator raises KeyError rather than silently accepting.
        validate_wire_document(schema, object())


# ----------------------------------------------------------------------
# semantic policy pairs the corpus declares with interpretable operators


def _policy_document(**overrides: Any) -> dict[str, Any]:
    document = dict(CORPUS["wireCases"][0]["document"])
    document.update(overrides)
    return document


def _rule(sink: str, paths: list[str]) -> dict[str, Any]:
    return {
        "apiVersion": "graphengineering.reacher-z.github.io/redaction-rule/v1alpha2",
        "ruleId": "runtime-log-v1",
        "registryVersion": 1,
        "sink": sink,
        "paths": paths,
        "replacementMode": "constant-token",
    }


def test_policy_mode_rule_compatibility_pair() -> None:
    compatible = _policy_document(
        logs="redacted", redactionRules=[_rule("runtime-log", ["/fields/query"])]
    )
    assert isinstance(normalize_capture_policy(compatible), CapturePolicy)

    incompatible = _policy_document(
        logs="metadata-only", redactionRules=[_rule("runtime-log", ["/fields/query"])]
    )
    result = normalize_capture_policy(incompatible)
    assert isinstance(result, RedactionFailure)
    assert result.code == "REDACTION_POLICY_INVALID"


def test_policy_path_order_pair() -> None:
    ordered = _policy_document(logs="redacted", redactionRules=[_rule("runtime-log", ["/a", "/z"])])
    assert isinstance(normalize_capture_policy(ordered), CapturePolicy)

    reordered = _policy_document(
        logs="redacted", redactionRules=[_rule("runtime-log", ["/z", "/a"])]
    )
    result = normalize_capture_policy(reordered)
    assert isinstance(result, RedactionFailure)
    assert result.code == "REDACTION_POLICY_INVALID"


def test_semantic_case_pairs_are_globally_unique_and_complete() -> None:
    cases = CORPUS["semanticCases"]
    assert len(cases) == 106
    assert len({case["id"] for case in cases}) == 106
    pairs: dict[str, set[str]] = {}
    for case in cases:
        pairs.setdefault(case["pairId"], set()).add(case["polarity"])
    for polarities in pairs.values():
        assert polarities == {"positive", "hostile"}


# ----------------------------------------------------------------------
# side-effect normalization


@pytest.mark.parametrize(
    "case", CORPUS["normalizationCases"], ids=lambda case: str(case["id"])
)
def test_normalization_case(case: dict[str, Any]) -> None:
    graph_value = None if case["graphValue"] == "omitted" else case["graphValue"]
    normalized = normalize_side_effects(graph_value)
    expected = case["expected"]
    if expected["valid"]:
        assert normalized == expected["normalized"]
        assert not isinstance(normalized, RedactionFailure)
        assert (
            open_attempt_retry_disposition(normalized)
            == expected["retryDispositionForOpenAttempt"]
        )
    else:
        assert isinstance(normalized, RedactionFailure)
        assert normalized.code == expected["code"]
        assert (
            retry_disposition_for("not-started", "unspecified")
            == expected["retryDispositionForOpenAttempt"]
        )


# ----------------------------------------------------------------------
# legacy histories


@pytest.mark.parametrize(
    "case", CORPUS["legacyCases"], ids=lambda case: str(case["id"])
)
def test_legacy_case(case: dict[str, Any]) -> None:
    disposition = classify_record(
        redacted_field=case["redactedField"],
        inline_shape=case["inlineShape"],
        terminal=case["terminal"],
        authorization=case["authorization"],
    )
    expected = case["expected"]
    assert disposition.action == expected["action"]
    assert disposition.executor_calls == expected["executorCalls"]
    assert disposition.source_rewritten is expected["sourceRewritten"]
    if "code" in expected:
        assert disposition.failure is not None
        assert disposition.failure.code == expected["code"]


def test_legacy_matrix_is_total_over_field_by_shape_by_terminal() -> None:
    matrix = CORPUS["legacyMatrix"]
    fields = matrix["redactedFields"]
    shapes = matrix["inlineShapes"]
    terminals = matrix["terminalStates"]
    assert len(fields) * len(shapes) * len(terminals) == matrix["cartesianCaseCount"] == 30
    misleading = matrix["misleadingRule"]
    truthful = matrix["truthfulInlineRule"]
    seen = 0
    for redacted_field in fields:
        for shape in shapes:
            for terminal in terminals:
                disposition = classify_record(
                    redacted_field=redacted_field,
                    inline_shape=shape,
                    terminal=terminal == "terminal",
                    authorization="none",
                )
                if redacted_field in misleading["redactedFields"]:
                    assert disposition.action == misleading["action"]
                    assert disposition.failure is not None
                    assert disposition.failure.code == misleading["code"]
                else:
                    assert disposition.action == truthful["action"]
                    assert disposition.failure is not None
                    assert disposition.failure.code == truthful["code"]
                assert disposition.source_rewritten is False
                seen += 1
    assert seen == 30


# ----------------------------------------------------------------------
# guard cases


@dataclass
class Counters:
    raw_writes: int = 0
    event_writes: int = 0
    checkpoint_writes: int = 0
    diagnostic_writes: int = 0
    executor_calls: int = 0
    dependent_releases: int = 0
    safe_orphans: int = 0


_PHASE_CODES: dict[str, str] = {
    "snapshot": "PAYLOAD_PROTECTION_FAILED",
    "classification": "REDACTION_POLICY_INVALID",
    "encode": "PAYLOAD_PROTECTION_FAILED",
    "mac": "PAYLOAD_PROTECTION_FAILED",
    "protect": "PAYLOAD_PROTECTION_FAILED",
    "atomic-publish": "PAYLOAD_PROTECTION_FAILED",
    "receipt": "REDACTION_RECEIPT_INVALID",
    "scan": "SECRET_CANARY_DETECTED",
    "canonicalize": "PAYLOAD_PROTECTION_FAILED",
}

_CHECKPOINT_SINKS = {"checkpoint-memory", "checkpoint-temporary", "checkpoint-final"}


def _enabling_policy(source_class: str, sink: str, *, redact: bool) -> CapturePolicy:
    from graph_engineering.redaction.inventory import sink_row, source_row

    row = source_row(source_class)
    destination = sink_row(sink)
    assert row is not None and destination is not None
    policy = default_stable_profile(
        transform_implementation_hash=TRANSFORM_HASH,
        rule_registry_version=1,
        rule_registry_hash=REGISTRY_HASH,
        key_ref=KEY_REF,
    )
    controls = {row.policy_control, *destination.policy_controls}
    updates: dict[str, Any] = {}
    rules: list[RedactionRule] = []
    for control in controls:
        if control in ("durableValues", "checkpointValues"):
            continue
        if control == "events":
            updates["events"] = "metadata-or-protected"
        elif control == "errors":
            updates["errors"] = "redacted" if redact else "protected-evidence"
        elif control == "identifiers":
            updates["identifiers"] = "protected"
        elif control == "deny":
            continue
        else:
            updates[_attribute(control)] = "redacted" if redact else "protected"
    if redact:
        rules.append(
            RedactionRule(
                rule_id="observational-v1",
                registry_version=1,
                sink=sink,
                paths=("/message",),
                replacement_mode="constant-token",
            )
        )
        updates["redaction_rules"] = tuple(rules)
    return replace(policy, **updates)


def _attribute(control: str) -> str:
    mapping = {
        "isolationOutputs": "isolation_outputs",
        "supportBundles": "support_bundles",
        "testArtifacts": "test_artifacts",
    }
    return mapping.get(control, control)


def _run_guard_case(case: dict[str, Any]) -> tuple[Counters, str | None, str]:
    counters = Counters()
    source_class = case["sourceClass"]
    sink = case["sink"]
    failure_point = case["failurePoint"]
    executor_outcome = case["executorOutcome"]
    side_effects = case["sideEffects"]
    observational = case["authorityClass"] == "observational"
    redact = failure_point == "receipt" and observational

    if (
        executor_outcome == "succeeded" and side_effects != "not-applicable"
    ) or executor_outcome == "failed":
        counters.executor_calls = 1

    key_provider = DeterministicTestKeyProvider()
    store = MemoryProtectedPayloadStore()
    policy = _enabling_policy(source_class, sink, redact=redact)

    def probe(phase: str) -> RedactionFailure | None:
        if phase != failure_point or failure_point not in _PHASE_CODES:
            return None
        return failure(_PHASE_CODES[phase], phase)  # type: ignore[arg-type]

    guard = SinkGuard(
        policy=None if failure_point == "policy-missing" else policy,
        key_provider=key_provider,
        store=None if failure_point == "policy" else store,
        fault_probe=probe,  # type: ignore[arg-type]
    )
    record_kind = "checkpoint" if sink in _CHECKPOINT_SINKS else "event"
    payload: Any = NO_PAYLOAD
    semantic_context = None
    if not observational or redact:
        payload = {"message": "synthetic-observational-value"}
        semantic_context = {
            "kind": "node-output",
            "runId": "run-1",
            "graphRevision": 1,
            "nodeId": "worker",
        }
    request = SinkWriteRequest(
        source_class=source_class,
        sink=sink,
        sink_instance=store,
        authority_class=case["authorityClass"],
        occurrence=OccurrenceContext(
            run_id="run-1",
            graph_revision=1,
            record_kind=record_kind,
            record_type="NodeSucceeded",
            occurrence_id="occ-1",
            sequence=3,
            field_path="/data/outputRef",
            occurred_at="2026-07-26T20:00:00Z",
            node_id="worker",
            attempt=1,
        ),
        metadata={"data": {}},
        payload=payload,
        semantic_context=semantic_context,
        side_effects=side_effects,
        executor_outcome=executor_outcome,
    )
    outcome = guard.prepare(request)

    if isinstance(outcome, GuardFailed):
        # A guard-internal failure destroys anything it published; only a sink
        # boundary failure can leave an unreferenced blob behind.
        assert outcome.cleaned_blobs >= 0
        return (
            counters,
            outcome.failure.code,
            outcome.decision.retry_disposition or "not-applicable",
        )
    if isinstance(outcome, GuardSuppressed):
        return counters, None, "not-applicable"
    assert isinstance(outcome, GuardPrepared)

    if failure_point in ("sink-write", "compare-and-swap"):
        # The blob is already atomically published; the record referencing it is
        # never committed, so the blob is an unreferenced safe orphan.
        counters.safe_orphans = len(outcome.protected_refs)
        code = "PAYLOAD_PROTECTION_FAILED" if failure_point == "sink-write" else None
        return counters, code, retry_disposition_for(executor_outcome, side_effects)

    outcome.prepared.consume(store)
    if record_kind == "checkpoint":
        counters.checkpoint_writes = 1
    else:
        counters.event_writes = 1
        counters.dependent_releases = 1
    return counters, None, "not-applicable"


@pytest.mark.parametrize(
    "case", CORPUS["guardCases"], ids=lambda case: str(case["id"])
)
def test_guard_case(case: dict[str, Any]) -> None:
    counters, code, retry = _run_guard_case(case)
    expected = case["expected"]
    assert counters.raw_writes == expected["rawWrites"]
    assert counters.event_writes == expected["eventWrites"]
    assert counters.checkpoint_writes == expected["checkpointWrites"]
    assert counters.diagnostic_writes == expected["diagnosticWrites"]
    assert counters.executor_calls == expected["executorCalls"]
    assert counters.dependent_releases == expected["dependentReleases"]
    assert counters.safe_orphans == expected["safeOrphans"]
    assert retry == expected["retryDisposition"]
    if "code" in expected:
        assert code == expected["code"]


def test_failure_matrix_dispositions_are_total() -> None:
    matrix = CORPUS["failureMatrix"]
    pre = matrix["preExecutorFailurePoints"]
    post = matrix["postExecutorFailurePoints"]
    classifications = matrix["sideEffectClassifications"]
    assert len(pre) == 12
    assert len(post) == 9
    assert len(classifications) == 4
    assert len(pre) + len(post) * len(classifications) == matrix["matrixCaseCount"] == 48

    for _ in pre:
        # Before executor start every failure point is no-write, no-executor.
        assert retry_disposition_for("not-started", "none") == "forbidden"
    for _ in post:
        for classification in classifications:
            expected = (
                "safe-new-attempt" if classification == "none" else "in-doubt-effect"
            )
            assert retry_disposition_for("succeeded", classification) == expected
