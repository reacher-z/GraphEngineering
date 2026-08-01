"""Emit Python results for the shared adapter conformance corpus.

This report is one half of a cross-language join (``D13-ADAPTERS-049``). It
reads exactly one input — ``spec/conformance/adapter.case.json`` — and computes
every value it prints with the native Python package
(``graph_engineering.adapters``). It never imports, spawns, or reads anything
produced by the TypeScript implementation, and it never copies an
``expected*`` block from the corpus into its own output: the ``expectedCode``,
``expectedRule``, ``expectedMessage``, ``expectedDenialReason``,
``expectedNormalized``, ``expectedSummary`` and ``expected`` members are read
only to enumerate case identity, never to supply a result. The consuming join
in ``tools/conformance/run.mjs`` computes the TypeScript half natively and
compares the two member for member before either is compared to the corpus.

Every section is driven through the package's public export surface — the names
``graph_engineering.adapters.__all__`` publishes — and never through a private
rule function. The mock dispatch probes go further and drive the real public
adapter object (``create_mock_adapter`` and its ``call``), so the join also
compares what a graph would actually observe from a dispatch rather than only
what the validators decide.

No network, no subprocess and no wall clock: the corpus asserts
``networkAccess: false`` and ``injectedClockOnly: true``, the package imports no
socket or process module, and the only clock any code path reads is the
``nowMs`` value the corpus scripts inject.

The corpus declares ``implementationClaim: false``. Nothing here upgrades that
claim: this is deterministic-mock evidence about a frozen contract, not
evidence that any provider was ever contacted.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Callable
from copy import deepcopy
from pathlib import Path
from typing import Any

from graph_engineering.adapters import (
    ADAPTER_CAPABILITIES,
    ADAPTER_ERROR_CODES,
    ADAPTER_KINDS,
    CAPABILITY_GATED_RESOURCES,
    CAPABILITY_IMPLICATIONS,
    DENIAL_REASONS,
    FINISH_REASONS,
    MOCK_ONLY_CAPABILITIES,
    MODEL_ADAPTER_KINDS,
    REPORTABLE_RESOURCES,
    RESOURCE_UNITS,
    SIDE_EFFECT_ORDER,
    STREAM_FRAME_KINDS,
    TAXONOMY_FACTS,
    USAGE_UNIT_RESOURCES,
    AdapterCallOptions,
    AdapterContractError,
    AdapterDescriptor,
    AdapterErrorEnvelope,
    AdapterRequest,
    AdapterUsage,
    CircuitStep,
    MockOutcome,
    ProviderMetricDeclaration,
    StreamFrame,
    ToolCallResponse,
    circuit_fold,
    computed_backoff_ms,
    create_mock_adapter,
    derive_budget_cost_state,
    derive_ledger_action,
    derive_usage_disposition,
    is_sorted_by_code_point,
    normalize_stream,
    preflight,
    requires_in_doubt_record,
    retry_decision,
    side_effect_permits_retry,
    taxonomy_facts,
    validate_descriptor,
    validate_descriptor_against_budget_policy,
    validate_error_envelope,
    validate_tool_calls,
    validate_usage,
)

ROOT = Path(__file__).resolve().parents[2]
CASE_PATH = ROOT / "spec" / "conformance" / "adapter.case.json"

#: The rule-producing sections, in the order the join walks them. Each name is a
#: corpus key; the counts are read from the corpus, never restated here.
CASE_SECTIONS = (
    "descriptorCases",
    "preflightCases",
    "streamCases",
    "usageCases",
    "toolCases",
    "errorCases",
    "retryCases",
    "circuitCases",
)

#: The descriptor the mock dispatch probes drive. It is the only shipped
#: descriptor that declares `fault-injection`, `provider-request-id` and
#: `retry-after-hint` together, so it is the only one that can inject every
#: code and still carry a provider identity and a backoff hint. This is a
#: corpus input (an adapterId), not an expectation.
MOCK_PROBE_DESCRIPTOR = "mock-full"

#: The backoff hint the retryable dispatch probes script. An injected integer,
#: never a clock reading.
MOCK_PROBE_RETRY_AFTER_MS = 250

#: The clock readings the circuit probe injects, in order.
MOCK_PROBE_CLOCK_MS = (0, 10, 20)


def load_corpus() -> dict[str, Any]:
    corpus: dict[str, Any] = json.loads(CASE_PATH.read_text(encoding="utf-8"))
    return corpus


CORPUS = load_corpus()


# ---------------------------------------------------------------------------
# The corpus mutation language
# ---------------------------------------------------------------------------


def pointer_segments(pointer: str) -> list[str]:
    if pointer == "":
        return []
    if not pointer.startswith("/"):
        raise ValueError(f"JSON Pointer must be empty or start with '/': {pointer}")
    return [segment.replace("~1", "/").replace("~0", "~") for segment in pointer[1:].split("/")]


def apply_mutations(document: Any, entries: object = None) -> Any:
    """Apply the corpus mutation language to a raw JSON document.

    This is corpus input handling, not an expectation: a mutation says what to
    feed the engine, never what the engine should answer.
    """

    if entries is None:
        return document
    if not isinstance(entries, list):
        raise TypeError("mutations must be a list")
    for entry in entries:
        if not isinstance(entry, dict):
            raise TypeError("a mutation must be an object")
        path = str(entry["path"])
        op = str(entry["op"])
        segments = pointer_segments(path)
        if not segments:
            raise ValueError(f"root mutation is not supported: {path}")
        leaf = segments.pop()
        parent = document
        for segment in segments:
            parent = parent[int(segment)] if isinstance(parent, list) else parent[segment]
        if op == "remove":
            if isinstance(parent, list):
                parent.pop(int(leaf))
            else:
                del parent[leaf]
            continue
        value = deepcopy(entry.get("value"))
        if op == "add":
            if isinstance(parent, list):
                parent.insert(int(leaf), value)
            else:
                parent[leaf] = value
            continue
        if op != "replace":
            raise ValueError(f"unknown mutation op: {op}")
        if isinstance(parent, list):
            parent[int(leaf)] = value
        else:
            parent[leaf] = value
    return document


def template(name: str) -> Any:
    return deepcopy(CORPUS[name])


def descriptor_document(adapter_id: str) -> dict[str, Any]:
    for item in CORPUS["descriptors"]:
        if item["adapterId"] == adapter_id:
            return deepcopy(item)
    raise KeyError(f"unknown corpus descriptor {adapter_id!r}")


def descriptor_for(adapter_id: str, entries: object = None) -> AdapterDescriptor:
    return AdapterDescriptor.from_document(apply_mutations(descriptor_document(adapter_id), entries))


def request_from(entries: object = None) -> AdapterRequest:
    return AdapterRequest.from_document(apply_mutations(template("requestTemplate"), entries))


POLICY_METRICS: tuple[ProviderMetricDeclaration, ...] = tuple(
    ProviderMetricDeclaration.from_document(item)
    for item in CORPUS["budgetPolicyAllowedProviderMetrics"]
)
FORBIDDEN_MARKERS: tuple[str, ...] = tuple(str(item) for item in CORPUS["forbiddenMarkers"])


# ---------------------------------------------------------------------------
# Observation
# ---------------------------------------------------------------------------

#: Every rule identifier this process produced, and every portable code.
EXERCISED: set[str] = set()
OBSERVED_CODES: set[str] = set()
OBSERVED_DENIALS: set[str] = set()


def observe(run: Callable[[], Any]) -> dict[str, Any]:
    """Run one public-surface call and project what it decided.

    A rejection is the ``AdapterContractError`` the surface raises; an
    acceptance is ``code: null, rule: null`` plus whatever projection the
    surface returned. Nothing else is caught: a ``TypeError`` from a malformed
    corpus document is a corpus defect and must not be laundered into a
    contract verdict.
    """

    try:
        value = run()
    except AdapterContractError as error:
        EXERCISED.add(error.rule)
        OBSERVED_CODES.add(error.code)
        if error.denial_reason is not None:
            OBSERVED_DENIALS.add(error.denial_reason)
        return {
            "code": error.code,
            "rule": error.rule,
            "message": error.message,
            "denialReason": error.denial_reason,
            "accepted": False,
            "projection": None,
        }
    return {
        "code": None,
        "rule": None,
        "message": None,
        "denialReason": None,
        "accepted": True,
        "projection": value,
    }


def case_ids(section: str) -> list[str]:
    entries = CORPUS[section]
    if not isinstance(entries, list) or not entries:
        raise AssertionError(f"{section}: the corpus declares no cases")
    ids = [str(case["id"]) for case in entries]
    if len(set(ids)) != len(ids):
        raise AssertionError(f"{section}: the corpus declares a duplicate case id")
    return ids


def check_complete(section: str, report: dict[str, Any], declared: list[str]) -> None:
    """A skipped case is the failure mode this join exists to prevent."""

    missing = [item for item in declared if item not in report]
    if missing:
        raise AssertionError(f"{section}: Python skipped corpus case(s) {missing}")
    stray = [item for item in report if item not in declared]
    if stray:
        raise AssertionError(f"{section}: Python reported undeclared case(s) {stray}")
    if len(report) != len(declared):
        raise AssertionError(
            f"{section}: Python reported {len(report)} cases for {len(declared)} declared"
        )


# ---------------------------------------------------------------------------
# Vocabularies, taxonomy and composition, recomputed rather than read
# ---------------------------------------------------------------------------


def vocabulary_report() -> dict[str, Any]:
    return {
        "adapterCapabilities": list(ADAPTER_CAPABILITIES),
        "adapterErrorCodes": list(ADAPTER_ERROR_CODES),
        "adapterKinds": list(ADAPTER_KINDS),
        "denialReasons": list(DENIAL_REASONS),
        "finishReasons": list(FINISH_REASONS),
        "modelAdapterKinds": list(MODEL_ADAPTER_KINDS),
        "reportableResources": list(REPORTABLE_RESOURCES),
        "resourceUnits": {key: RESOURCE_UNITS[key] for key in sorted(RESOURCE_UNITS)},
        "sideEffectOrder": list(SIDE_EFFECT_ORDER),
        "streamFrameKinds": list(STREAM_FRAME_KINDS),
        "usageUnitResources": list(USAGE_UNIT_RESOURCES),
        "capabilityImplications": [
            {"rule": row.rule, "capability": row.capability, "requires": row.requires}
            for row in CAPABILITY_IMPLICATIONS
        ],
        "mockOnlyCapabilities": [
            {"rule": row.rule, "capability": row.capability} for row in MOCK_ONLY_CAPABILITIES
        ],
        "capabilityGatedResources": [
            {"rule": row.rule, "resource": row.resource, "capability": row.capability}
            for row in CAPABILITY_GATED_RESOURCES
        ],
        "sortedByCodePoint": {
            "adapterCapabilities": is_sorted_by_code_point(ADAPTER_CAPABILITIES),
            "adapterErrorCodes": is_sorted_by_code_point(ADAPTER_ERROR_CODES),
            "adapterKinds": is_sorted_by_code_point(ADAPTER_KINDS),
            "denialReasons": is_sorted_by_code_point(DENIAL_REASONS),
            "finishReasons": is_sorted_by_code_point(FINISH_REASONS),
            "reportableResources": is_sorted_by_code_point(REPORTABLE_RESOURCES),
        },
        "counts": {
            "adapterCapabilities": len(ADAPTER_CAPABILITIES),
            "adapterErrorCodes": len(ADAPTER_ERROR_CODES),
            "adapterKinds": len(ADAPTER_KINDS),
            "denialReasons": len(DENIAL_REASONS),
            "finishReasons": len(FINISH_REASONS),
            "reportableResources": len(REPORTABLE_RESOURCES),
        },
    }


def taxonomy_report() -> dict[str, Any]:
    """Recompute every taxonomy row from the code alone.

    Retryability, boundary and effect disposition are properties of the code;
    usage disposition and ledger action are derived from the effect
    disposition. Nothing here reads ``corpus.errorTaxonomy``.
    """

    rows: list[dict[str, Any]] = []
    retryable = 0
    pre_dispatch = 0
    for code in ADAPTER_ERROR_CODES:
        facts = taxonomy_facts(code)
        table = TAXONOMY_FACTS[code]
        if (facts.boundary, facts.retryable, facts.effect_disposition) != (
            table.boundary,
            table.retryable,
            table.effect_disposition,
        ):
            raise AssertionError(f"{code}: the accessor disagrees with the table")
        usage_disposition = derive_usage_disposition(facts.effect_disposition)
        rows.append(
            {
                "code": code,
                "boundary": facts.boundary,
                "retryable": facts.retryable,
                "effectDisposition": facts.effect_disposition,
                "usageDisposition": usage_disposition,
                "ledgerAction": derive_ledger_action(usage_disposition),
            }
        )
        if facts.retryable:
            retryable += 1
        if facts.boundary == "pre-dispatch":
            pre_dispatch += 1
    return {"rows": rows, "retryableCount": retryable, "preDispatchCount": pre_dispatch}


def cycle_matrix_report() -> list[dict[str, Any]]:
    """The 3x3 in-doubt composition matrix of cycle-semantics 13.4."""

    return [
        {
            "effectDisposition": disposition,
            "recordsInDoubtIdentity": requires_in_doubt_record(disposition, side_effect_class),
            "retryPermittedBySideEffect": side_effect_permits_retry(disposition, side_effect_class),
            "sideEffectClass": side_effect_class,
        }
        for disposition in ("applied", "in-doubt", "not-applied")
        for side_effect_class in SIDE_EFFECT_ORDER
    ]


def cost_state_report() -> list[dict[str, Any]]:
    trusts = sorted({str(row["trust"]) for row in CORPUS["budgetComposition"]["costStateBindings"]})
    return [{"trust": trust, "budgetCostState": derive_budget_cost_state(trust)} for trust in trusts]


def descriptor_inventory_report() -> dict[str, Any]:
    entries: dict[str, Any] = {}
    for document in CORPUS["descriptors"]:
        adapter_id = str(document["adapterId"])
        descriptor = descriptor_for(adapter_id)
        entries[adapter_id] = {
            "adapterKind": descriptor.adapter_kind,
            "capabilities": list(descriptor.capabilities),
            "evidenceClass": descriptor.evidence_class,
            "sideEffectClass": descriptor.side_effect_class,
            "valid": validate_descriptor(descriptor),
            "budgetPolicyValid": validate_descriptor_against_budget_policy(
                descriptor, POLICY_METRICS
            ),
            "roundTrips": descriptor.as_document() == descriptor_document(adapter_id),
        }
    return entries


# ---------------------------------------------------------------------------
# The case sections
# ---------------------------------------------------------------------------


def descriptor_cases() -> dict[str, Any]:
    report: dict[str, Any] = {}
    for case in CORPUS["descriptorCases"]:
        candidate = descriptor_for(str(case["base"]), case["mutations"])

        def run(candidate: AdapterDescriptor = candidate) -> Any:
            validate_descriptor(candidate)
            validate_descriptor_against_budget_policy(candidate, POLICY_METRICS)
            return {"valid": True}

        report[str(case["id"])] = observe(run)
    return report


def preflight_cases() -> dict[str, Any]:
    report: dict[str, Any] = {}
    for case in CORPUS["preflightCases"]:
        descriptor = descriptor_for(str(case["descriptor"]), case.get("descriptorMutations"))
        request = request_from(case.get("requestMutations"))

        def run(
            descriptor: AdapterDescriptor = descriptor, request: AdapterRequest = request
        ) -> Any:
            outcome = preflight(descriptor, request, POLICY_METRICS)
            return {
                "admitted": outcome.admitted,
                "adapterId": outcome.adapter_id,
                "requestId": outcome.request_id,
                "sideEffectClass": outcome.side_effect_class,
                "idempotencyKey": outcome.idempotency_key,
            }

        report[str(case["id"])] = observe(run)
    return report


def stream_cases() -> dict[str, Any]:
    report: dict[str, Any] = {}
    for case in CORPUS["streamCases"]:
        descriptor = descriptor_for(str(case["descriptor"]), case.get("descriptorMutations"))
        documents = apply_mutations(template("streamTemplate"), case.get("mutations"))
        frames = tuple(StreamFrame.from_document(item) for item in documents)

        def run(
            descriptor: AdapterDescriptor = descriptor,
            frames: tuple[StreamFrame, ...] = frames,
        ) -> Any:
            return normalize_stream(descriptor, frames).as_document()

        report[str(case["id"])] = observe(run)
    return report


def usage_cases() -> dict[str, Any]:
    report: dict[str, Any] = {}
    for case in CORPUS["usageCases"]:
        descriptor = descriptor_for(str(case["descriptor"]), case.get("descriptorMutations"))
        usage = AdapterUsage.from_document(
            apply_mutations(template("usageTemplate"), case.get("mutations"))
        )

        def run(descriptor: AdapterDescriptor = descriptor, usage: AdapterUsage = usage) -> Any:
            return validate_usage(descriptor, usage).as_document()

        report[str(case["id"])] = observe(run)
    return report


def tool_cases() -> dict[str, Any]:
    report: dict[str, Any] = {}
    for case in CORPUS["toolCases"]:
        descriptor = descriptor_for(str(case["descriptor"]), case.get("descriptorMutations"))
        request = request_from(case.get("requestMutations"))
        response = ToolCallResponse.from_document(
            apply_mutations(template("toolResponseTemplate"), case.get("mutations"))
        )

        def run(
            descriptor: AdapterDescriptor = descriptor,
            request: AdapterRequest = request,
            response: ToolCallResponse = response,
        ) -> Any:
            summary = validate_tool_calls(descriptor, request, response)
            return {
                "toolCalls": summary.tool_calls,
                "responseToolCalls": len(response.tool_calls),
            }

        report[str(case["id"])] = observe(run)
    return report


def error_cases() -> dict[str, Any]:
    report: dict[str, Any] = {}
    for case in CORPUS["errorCases"]:
        descriptor = descriptor_for(str(case["descriptor"]), case.get("descriptorMutations"))
        envelope = AdapterErrorEnvelope.from_document(
            apply_mutations(template("errorTemplate"), case.get("mutations"))
        )

        def run(
            descriptor: AdapterDescriptor = descriptor,
            envelope: AdapterErrorEnvelope = envelope,
        ) -> Any:
            return validate_error_envelope(descriptor, envelope, FORBIDDEN_MARKERS).as_document()

        entry = observe(run)
        # An accepted envelope still witnesses its own code: the closed
        # taxonomy is covered by acceptances as well as by rejections.
        entry["envelopeCode"] = envelope.code
        if entry["accepted"]:
            OBSERVED_CODES.add(envelope.code)
        report[str(case["id"])] = entry
    return report


def retry_cases() -> dict[str, Any]:
    report: dict[str, Any] = {}
    for case in CORPUS["retryCases"]:
        descriptor = descriptor_for(str(case["descriptor"]), case.get("descriptorMutations"))
        decision = retry_decision(
            descriptor,
            str(case["code"]),
            str(case["sideEffectClass"]),
            int(case["attempt"]),
            case["retryAfterMs"],
        )
        EXERCISED.add(decision.rule)
        report[str(case["id"])] = {
            "decision": decision.as_document(),
            "rule": decision.rule,
            # The backoff a retry would use, recomputed from the policy alone.
            "computedBackoffMs": computed_backoff_ms(
                descriptor.retry_policy, int(case["attempt"])
            ),
            "retryableByCode": taxonomy_facts(str(case["code"])).retryable,
        }
    return report


def circuit_cases() -> dict[str, Any]:
    report: dict[str, Any] = {}
    for case in CORPUS["circuitCases"]:
        descriptor = descriptor_for(str(case["descriptor"]))
        script = tuple(CircuitStep.from_document(step) for step in case["script"])
        projection = circuit_fold(descriptor, script)
        rules = [str(rule) for rule in case["rules"]]
        for rule in rules:
            EXERCISED.add(rule)
        report[str(case["id"])] = {
            "projection": projection.as_document(),
            "rules": rules,
            "steps": len(script),
        }
    return report


# ---------------------------------------------------------------------------
# The real public adapter object
# ---------------------------------------------------------------------------


def project_usage(usage: AdapterUsage | None) -> Any:
    return None if usage is None else usage.as_document()


def project_outcome(outcome: Any) -> dict[str, Any]:
    if outcome.ok:
        response = outcome.value
        return {
            "ok": True,
            "requestId": response.request_id,
            "providerRequestId": response.provider_request_id,
            "finishReason": response.finish_reason,
            "text": response.text,
            "toolCalls": [call.id for call in response.tool_calls],
            "usage": project_usage(response.usage),
            "normalizedStream": (
                None
                if response.normalized_stream is None
                else response.normalized_stream.as_document()
            ),
        }
    error = outcome.error
    return {"ok": False, "error": error.as_document()}


def dispatch(
    adapter: Any,
    request: AdapterRequest,
    options: AdapterCallOptions | None = None,
) -> dict[str, Any]:
    """Drive one call through the real public adapter object.

    ``asyncio.run`` is the only way to await a public coroutine surface. It
    reads a monotonic deadline for scheduling and never a wall clock, and no
    code path under it sleeps, opens a socket or spawns a process.
    """

    return project_outcome(asyncio.run(adapter.call(request, options)))


def mock_dispatch_report() -> dict[str, Any]:
    """Inject every code in the closed taxonomy through the public mock.

    This is the probe that a validator-only join cannot make: it asks what a
    graph would actually observe from a dispatch, including whether the mock
    can produce the code at all.
    """

    descriptor = descriptor_for(MOCK_PROBE_DESCRIPTOR)
    report: dict[str, Any] = {}
    for code in ADAPTER_ERROR_CODES:
        facts = taxonomy_facts(code)
        outcome = MockOutcome(
            fail=code,
            retry_after_ms=MOCK_PROBE_RETRY_AFTER_MS if facts.retryable else None,
            # A denial reason is meaningful on exactly one code. The mock must
            # be able to carry it, or GE_ADAPTER_POLICY_DENIED is not
            # injectable at all and every consumer of the mock is untested
            # against it.
            denial_reason=(
                DENIAL_REASONS[0] if code == "GE_ADAPTER_POLICY_DENIED" else None
            ),
        )
        adapter = create_mock_adapter(
            descriptor,
            script=(outcome,),
            budget_policy_allowed_provider_metrics=POLICY_METRICS,
            forbidden_markers=FORBIDDEN_MARKERS,
        )
        entry = dispatch(adapter, request_from())
        entry["injectableAsRequested"] = (
            entry["ok"] is False and entry["error"]["code"] == code
        )
        report[code] = entry
    return report


def mock_policy_denied_report() -> dict[str, Any]:
    """The one code whose injectability depends on a scripted denial reason.

    Reported as its own member so the join can name both values rather than
    burying the answer inside a fourteen-code sweep.
    """

    entry = mock_dispatch_report()["GE_ADAPTER_POLICY_DENIED"]
    error = entry.get("error")
    return {
        "requestedCode": "GE_ADAPTER_POLICY_DENIED",
        "requestedDenialReason": DENIAL_REASONS[0],
        "observedCode": None if error is None else error["code"],
        "observedDenialReason": None if error is None else error["denialReason"],
        "observedMessage": None if error is None else error["message"],
        "injectable": error is not None and error["code"] == "GE_ADAPTER_POLICY_DENIED",
        # Whether the public scripted-outcome type declares the denial-reason
        # member that makes the code injectable.  Observed rather than asserted:
        # the scripted reason survived into the envelope, which is impossible
        # unless the member exists and is passed through.  The two halves spell
        # the member differently (`denialReason` / `denial_reason`), so the join
        # compares the fact and not the identifier.
        "declaresDenialReasonMember": (
            error is not None and error["denialReason"] == DENIAL_REASONS[0]
        ),
    }


def mock_success_report() -> dict[str, Any]:
    """One unscripted call and one streamed call through the public object."""

    descriptor = descriptor_for(MOCK_PROBE_DESCRIPTOR)
    adapter = create_mock_adapter(
        descriptor,
        budget_policy_allowed_provider_metrics=POLICY_METRICS,
        forbidden_markers=FORBIDDEN_MARKERS,
    )
    plain = dispatch(adapter, request_from())

    streaming = create_mock_adapter(
        descriptor,
        budget_policy_allowed_provider_metrics=POLICY_METRICS,
        forbidden_markers=FORBIDDEN_MARKERS,
    )
    request = request_from([{"op": "replace", "path": "/streaming", "value": True}])

    async def collect() -> dict[str, Any]:
        stream = await streaming.stream(request)
        frames = [frame.as_document() async for frame in stream]
        return {
            "outcome": project_outcome(stream.outcome),
            "frames": frames,
        }

    return {"call": plain, "stream": asyncio.run(collect())}


def mock_circuit_report() -> dict[str, Any]:
    """Fold the public breaker on injected clock readings only."""

    descriptor = descriptor_for(MOCK_PROBE_DESCRIPTOR)
    steps = tuple(
        CircuitStep(event="failure", now_ms=now_ms, code="GE_ADAPTER_TIMEOUT")
        for now_ms in MOCK_PROBE_CLOCK_MS
    )
    return {
        "clockReadings": list(MOCK_PROBE_CLOCK_MS),
        "projection": circuit_fold(descriptor, steps).as_document(),
    }


# ---------------------------------------------------------------------------
# Assembly
# ---------------------------------------------------------------------------


def register_report() -> dict[str, Any]:
    registered = sorted({str(row["rule"]) for row in CORPUS["ruleRegister"]})
    exercised = sorted(EXERCISED)
    missing = [rule for rule in registered if rule not in EXERCISED]
    stray = [rule for rule in exercised if rule not in set(registered)]
    if missing:
        raise AssertionError(f"ruleRegister: Python left {len(missing)} rule(s) unexercised: {missing}")
    if stray:
        raise AssertionError(f"ruleRegister: Python produced unregistered rule(s) {stray}")
    return {
        "registeredCount": len(registered),
        "exercised": exercised,
        "exercisedCount": len(exercised),
        "missing": missing,
        "stray": stray,
    }


def main() -> None:
    sections: dict[str, dict[str, Any]] = {}
    builders: dict[str, Callable[[], dict[str, Any]]] = {
        "descriptorCases": descriptor_cases,
        "preflightCases": preflight_cases,
        "streamCases": stream_cases,
        "usageCases": usage_cases,
        "toolCases": tool_cases,
        "errorCases": error_cases,
        "retryCases": retry_cases,
        "circuitCases": circuit_cases,
    }
    declared: dict[str, list[str]] = {}
    for section in CASE_SECTIONS:
        declared[section] = case_ids(section)
        sections[section] = builders[section]()
        check_complete(section, sections[section], declared[section])

    observed_counts = {
        "circuitCases": len(CORPUS["circuitCases"]),
        "descriptorCases": len(CORPUS["descriptorCases"]),
        "descriptors": len(CORPUS["descriptors"]),
        "errorCases": len(CORPUS["errorCases"]),
        "preflightCases": len(CORPUS["preflightCases"]),
        "retryCases": len(CORPUS["retryCases"]),
        "rules": len(CORPUS["ruleRegister"]),
        "schemaNegativeCases": len(CORPUS["schemaNegativeCases"]),
        "streamCases": len(CORPUS["streamCases"]),
        "toolCases": len(CORPUS["toolCases"]),
        "usageCases": len(CORPUS["usageCases"]),
    }

    report: dict[str, Any] = {
        "apiVersion": CORPUS["apiVersion"],
        "kind": CORPUS["kind"],
        "contractVersion": CORPUS["contractVersion"],
        "contractStatus": CORPUS["contractStatus"],
        # Read by this process from the corpus file; the join proves the Node
        # process read literally the same flag.
        "implementationClaim": CORPUS["implementationClaim"],
        "evidenceClass": CORPUS["evidenceClass"],
        "environmentAssertions": CORPUS["environmentAssertions"],
        "declaredCounts": CORPUS["declaredCounts"],
        "observedCounts": observed_counts,
        "caseSections": list(CASE_SECTIONS),
        "caseOrder": declared,
        # The probe vectors this half states. They are inputs, never
        # expectations, and the join asserts the Node half stated the same
        # four before either half's probe result is read.
        "probeVectors": {
            "descriptor": MOCK_PROBE_DESCRIPTOR,
            "retryAfterMs": MOCK_PROBE_RETRY_AFTER_MS,
            "clockReadings": list(MOCK_PROBE_CLOCK_MS),
            "denialReason": DENIAL_REASONS[0],
        },
        "vocabularies": vocabulary_report(),
        "taxonomy": taxonomy_report(),
        "cycleMatrix": cycle_matrix_report(),
        "costStateBindings": cost_state_report(),
        "descriptorInventory": descriptor_inventory_report(),
        "sections": sections,
        "mockDispatch": mock_dispatch_report(),
        "mockPolicyDenied": mock_policy_denied_report(),
        "mockSuccess": mock_success_report(),
        "mockCircuit": mock_circuit_report(),
    }
    report["ruleRegister"] = register_report()
    report["codesObserved"] = sorted(OBSERVED_CODES)
    report["denialReasonsObserved"] = sorted(OBSERVED_DENIALS)
    print(json.dumps(report, ensure_ascii=True, sort_keys=True, separators=(",", ":")))


if __name__ == "__main__":
    main()
