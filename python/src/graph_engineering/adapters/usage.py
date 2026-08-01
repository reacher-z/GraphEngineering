"""Usage envelope normalization, rules ``U-001`` through ``U-018``.

adapter-semantics 7.1: an adapter reports meters, never money.  The envelope has
no currency, no minor-unit exponent and no ``money-nano-minor`` entry; money is
produced only by applying an immutable pricing snapshot to these meters.  A zero
meter is represented by absence.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Final

from .contract import (
    CAPABILITY_GATED_RESOURCES,
    RESOURCE_UNITS,
    SAFE_INTEGER_MAX,
    USAGE_UNIT_RESOURCES,
    derive_budget_cost_state,
)
from .errors import fail
from .ordering import is_sorted_by_code_point
from .types import (
    AdapterDescriptor,
    AdapterErrorCode,
    AdapterUsage,
    FinishReason,
    NormalizedUsage,
    ProviderQuantity,
    ReportableResource,
    UsageQuantity,
    UsageTrust,
)

_MALFORMED: Final[AdapterErrorCode] = "GE_ADAPTER_MALFORMED_RESPONSE"
_NUL = "\x00"


def _metric_key(metric: ProviderQuantity) -> str:
    return f"{metric.metric_id}{_NUL}{metric.unit_id}"


def validate_usage(descriptor: AdapterDescriptor, usage: AdapterUsage) -> NormalizedUsage:
    declared = frozenset(descriptor.capabilities)
    resources = [quantity.resource for quantity in usage.quantities]

    for resource in resources:
        if resource not in RESOURCE_UNITS:
            fail(
                _MALFORMED,
                "U-005",
                f"resource {resource!r} is not adapter-reportable; "
                "adapters report meters, never money",
            )
    if len(set(resources)) != len(resources):
        fail(_MALFORMED, "U-002", "usage resources must be unique")
    if not is_sorted_by_code_point(resources):
        fail(
            _MALFORMED,
            "U-001",
            "usage quantities must be in Unicode code-point order by resource",
        )
    for quantity in usage.quantities:
        expected_unit = RESOURCE_UNITS[quantity.resource]  # type: ignore[index]
        if quantity.unit != expected_unit:
            fail(
                _MALFORMED,
                "U-003",
                f"resource {quantity.resource!r} has a fixed unit {expected_unit!r}",
            )
        if quantity.aggregation != "sum":
            fail(_MALFORMED, "U-004", "an adapter reports only sum-aggregated resources")
        if quantity.amount < 1 or quantity.amount > SAFE_INTEGER_MAX:
            fail(
                _MALFORMED,
                "U-016",
                "usage amounts must be positive portable integers; zero is absence",
            )

    if usage.budget_cost_state != derive_budget_cost_state(usage.trust):
        fail(_MALFORMED, "U-006", "budgetCostState must be the derivation of trust")

    by_resource = {quantity.resource: quantity.amount for quantity in usage.quantities}
    if "provider-calls" not in by_resource:
        fail(
            _MALFORMED,
            "U-007",
            "every dispatch-boundary usage envelope records at least one provider call",
        )

    if usage.trust == "provider-reported" and "usage-reporting" not in declared:
        fail(_MALFORMED, "U-008", "provider-reported trust requires the usage-reporting capability")

    for gate in CAPABILITY_GATED_RESOURCES:
        if gate.resource in by_resource and gate.capability not in declared:
            fail(
                _MALFORMED,
                gate.rule,
                f"resource {gate.resource!r} requires capability {gate.capability!r}",
            )

    if usage.provider_request_id is not None and "provider-request-id" not in declared:
        fail(
            _MALFORMED,
            "U-013",
            "a provider request identity requires the provider-request-id capability",
        )

    metric_keys = [_metric_key(metric) for metric in usage.provider_specific]
    if not is_sorted_by_code_point(metric_keys):
        fail(
            _MALFORMED,
            "U-014",
            "provider metrics must be unique and ordered by metricId + U+0000 + unitId",
        )
    allowed_metrics = {
        f"{metric.metric_id}{_NUL}{metric.unit_id}"
        for metric in descriptor.allowed_provider_metrics
    }
    for key in metric_keys:
        if key not in allowed_metrics:
            fail(
                _MALFORMED,
                "U-015",
                "a provider metric outside the descriptor allowlist is never silently bucketed",
            )

    if usage.finish_reason == "content-filter" and "content-filter-reporting" not in declared:
        fail(
            _MALFORMED,
            "U-017",
            "a content-filter finish reason requires content-filter-reporting",
        )

    if "usage-reporting" not in declared:
        if usage.trust != "unknown":
            fail(
                _MALFORMED,
                "U-018",
                "an adapter without usage-reporting must report unknown trust",
            )
        for resource in USAGE_UNIT_RESOURCES:
            if resource in by_resource:
                fail(
                    _MALFORMED,
                    "U-018",
                    "an adapter without usage-reporting cannot report a usage-unit meter",
                )

    return NormalizedUsage(
        resources=len(resources),
        provider_calls=by_resource.get("provider-calls"),
        budget_cost_state=usage.budget_cost_state,
    )


def compose_usage(
    descriptor: AdapterDescriptor,
    *,
    request_id: str,
    provider_request_id: str | None,
    trust: UsageTrust,
    finish_reason: FinishReason | None,
    meters: Mapping[ReportableResource, int],
    provider_specific: Sequence[ProviderQuantity] = (),
) -> AdapterUsage:
    """Build a canonical usage envelope.

    Meters are ordered by resource, zeros are absent, ``budgetCostState`` is
    derived from trust, and the whole document is proved against
    ``U-001``..``U-018`` before it is returned.
    """
    quantities = tuple(
        UsageQuantity(
            resource=resource,
            unit=RESOURCE_UNITS[resource],
            aggregation="sum",
            amount=amount,
        )
        for resource, amount in sorted(meters.items())
        if amount > 0
    )
    ordered_provider = tuple(sorted(provider_specific, key=_metric_key))

    usage = AdapterUsage(
        adapter_id=descriptor.adapter_id,
        adapter_kind=descriptor.adapter_kind,
        request_id=request_id,
        provider_request_id=provider_request_id,
        trust=trust,
        budget_cost_state=derive_budget_cost_state(trust),
        finish_reason=finish_reason,
        quantities=quantities,
        provider_specific=ordered_provider,
    )
    validate_usage(descriptor, usage)
    return usage
