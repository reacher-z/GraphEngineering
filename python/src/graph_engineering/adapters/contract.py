"""The frozen, irreducible facts of ``adapter-contract/v1alpha1``.

Everything derivable is derived here and nowhere else.  In particular the usage
disposition, the ledger action and the budget cost state are computed from the
taxonomy, never restated, so an adapter cannot declare a retry policy that
disagrees with the code it reports.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final

from .types import (
    AdapterBoundary,
    AdapterCapability,
    AdapterErrorCode,
    AdapterKind,
    BudgetCostState,
    DenialReason,
    EffectDisposition,
    FinishReason,
    LedgerAction,
    ReportableResource,
    ResourceUnit,
    SideEffectClass,
    StreamFrameKind,
    UsageDisposition,
    UsageTrust,
)

ADAPTER_CAPABILITIES: Final[tuple[AdapterCapability, ...]] = (
    "attachments",
    "cached-input-usage-reporting",
    "cancellation",
    "content-filter-reporting",
    "deterministic-replay",
    "fault-injection",
    "idempotency-key",
    "parallel-tool-calls",
    "provider-request-id",
    "rate-limit-reporting",
    "reasoning-usage-reporting",
    "retry-after-hint",
    "streaming",
    "structured-output",
    "tool-calling",
    "usage-reporting",
)

ADAPTER_KINDS: Final[tuple[AdapterKind, ...]] = (
    "anthropic",
    "google-gemini",
    "http",
    "mcp",
    "mock",
    "openai",
    "openai-compatible",
    "shell",
)

ADAPTER_ERROR_CODES: Final[tuple[AdapterErrorCode, ...]] = (
    "GE_ADAPTER_AUTHENTICATION",
    "GE_ADAPTER_BOUNDS_EXCEEDED",
    "GE_ADAPTER_CANCELLED",
    "GE_ADAPTER_CAPABILITY_UNSUPPORTED",
    "GE_ADAPTER_CONTENT_FILTERED",
    "GE_ADAPTER_DESCRIPTOR_INVALID",
    "GE_ADAPTER_INVALID_REQUEST",
    "GE_ADAPTER_MALFORMED_RESPONSE",
    "GE_ADAPTER_POLICY_DENIED",
    "GE_ADAPTER_QUOTA_EXCEEDED",
    "GE_ADAPTER_RATE_LIMITED",
    "GE_ADAPTER_TIMEOUT",
    "GE_ADAPTER_TOOL_VALIDATION_FAILED",
    "GE_ADAPTER_TRANSPORT_FAILURE",
)

DENIAL_REASONS: Final[tuple[DenialReason, ...]] = (
    "capability-approval",
    "circuit-open",
    "egress-not-allowlisted",
    "environment-not-allowlisted",
    "executable-not-authorized",
    "idempotency-key-missing",
    "mcp-mutation-not-approved",
    "mcp-tool-not-allowlisted",
    "redirect-not-reauthorized",
    "stdin-policy",
    "tls-policy",
)

FINISH_REASONS: Final[tuple[FinishReason, ...]] = (
    "cancelled",
    "content-filter",
    "max-output",
    "stop",
    "tool-calls",
)

REPORTABLE_RESOURCES: Final[tuple[ReportableResource, ...]] = (
    "audio-units",
    "cached-input-units",
    "image-units",
    "input-units",
    "output-units",
    "provider-calls",
    "reasoning-units",
    "tool-calls",
    "transport-bytes",
)

#: Exactly the cycle-controller ``sideEffects`` vocabulary, in escalation order.
SIDE_EFFECT_ORDER: Final[tuple[SideEffectClass, ...]] = ("none", "idempotent", "non-idempotent")

STREAM_FRAME_KINDS: Final[tuple[StreamFrameKind, ...]] = (
    "finish",
    "start",
    "text-delta",
    "tool-call",
    "usage",
)

MODEL_ADAPTER_KINDS: Final[tuple[AdapterKind, ...]] = (
    "anthropic",
    "google-gemini",
    "openai",
    "openai-compatible",
)

#: The portable integer ceiling this contract shares with the TypeScript lane.
SAFE_INTEGER_MAX: Final = 9007199254740991

#: Hosts a deterministic corpus is permitted to name.  RFC 2606 / RFC 6761
#: reserved names can never resolve to a routable address.
_NON_ROUTABLE_SUFFIXES: Final[tuple[str, ...]] = (".invalid", ".test")
_NON_ROUTABLE_EXACT: Final[frozenset[str]] = frozenset({"localhost"})


def is_non_routable_host(host: str) -> bool:
    if host in _NON_ROUTABLE_EXACT:
        return True
    return host.endswith(_NON_ROUTABLE_SUFFIXES)


@dataclass(frozen=True, slots=True)
class TaxonomyFacts:
    boundary: AdapterBoundary
    retryable: bool
    effect_disposition: EffectDisposition


#: The closed failure taxonomy of adapter-semantics 8.1.  Retryability is a
#: property of the code: no implementation may read a message string, an HTTP
#: status text or a provider payload to decide whether to retry.
TAXONOMY_FACTS: Final[dict[AdapterErrorCode, TaxonomyFacts]] = {
    "GE_ADAPTER_AUTHENTICATION": TaxonomyFacts("dispatch", False, "not-applied"),
    "GE_ADAPTER_BOUNDS_EXCEEDED": TaxonomyFacts("pre-dispatch", False, "not-applied"),
    "GE_ADAPTER_CANCELLED": TaxonomyFacts("dispatch", False, "in-doubt"),
    "GE_ADAPTER_CAPABILITY_UNSUPPORTED": TaxonomyFacts("pre-dispatch", False, "not-applied"),
    "GE_ADAPTER_CONTENT_FILTERED": TaxonomyFacts("dispatch", False, "applied"),
    "GE_ADAPTER_DESCRIPTOR_INVALID": TaxonomyFacts("pre-dispatch", False, "not-applied"),
    "GE_ADAPTER_INVALID_REQUEST": TaxonomyFacts("dispatch", False, "not-applied"),
    "GE_ADAPTER_MALFORMED_RESPONSE": TaxonomyFacts("dispatch", True, "applied"),
    "GE_ADAPTER_POLICY_DENIED": TaxonomyFacts("pre-dispatch", False, "not-applied"),
    "GE_ADAPTER_QUOTA_EXCEEDED": TaxonomyFacts("dispatch", False, "not-applied"),
    "GE_ADAPTER_RATE_LIMITED": TaxonomyFacts("dispatch", True, "not-applied"),
    "GE_ADAPTER_TIMEOUT": TaxonomyFacts("dispatch", True, "in-doubt"),
    "GE_ADAPTER_TOOL_VALIDATION_FAILED": TaxonomyFacts("pre-dispatch", False, "not-applied"),
    "GE_ADAPTER_TRANSPORT_FAILURE": TaxonomyFacts("dispatch", True, "in-doubt"),
}


def taxonomy_facts(code: str) -> TaxonomyFacts:
    """The taxonomy row for a code, by lookup and never by inference."""
    for known, facts in TAXONOMY_FACTS.items():
        if known == code:
            return facts
    raise ValueError(f"unknown adapter error code {code!r}")


def derive_usage_disposition(effect: str) -> UsageDisposition:
    """adapter-semantics 8.1: derived, never declared."""
    return "none" if effect == "not-applied" else "conservative"


def derive_ledger_action(usage_disposition: str) -> LedgerAction:
    """adapter-semantics 8.1: release only capacity proven unused."""
    return "release-reservation" if usage_disposition == "none" else "commit-conservative"


def derive_budget_cost_state(trust: str) -> BudgetCostState:
    """adapter-semantics 7.3: three of the seven public cost states."""
    if trust == "provider-reported":
        return "provider-reported"
    if trust == "adapter-conservative":
        return "estimated"
    if trust == "unknown":
        return "unknown"
    raise ValueError(f"unknown usage trust {trust!r}")


def requires_in_doubt_record(effect: str, side_effect_class: str) -> bool:
    """cycle-semantics 13.4.

    An in-doubt external effect produces a durable in-doubt identity only for an
    external side-effect class.
    """
    return effect == "in-doubt" and side_effect_class != "none"


def side_effect_permits_retry(effect: str, side_effect_class: str) -> bool:
    """cycle-semantics 13.4.

    ``none`` and ``idempotent`` may retry under the same stable key;
    ``non-idempotent`` stops after its first ambiguous outcome, and "ambiguous"
    is exactly ``effectDisposition != "not-applied"``.
    """
    if side_effect_class != "non-idempotent":
        return True
    return effect == "not-applied"


def escalates_side_effect(requested: str, authorized: str) -> bool:
    return _side_effect_rank(requested) > _side_effect_rank(authorized)


def _side_effect_rank(side_effect_class: str) -> int:
    for rank, known in enumerate(SIDE_EFFECT_ORDER):
        if known == side_effect_class:
            return rank
    raise ValueError(f"unknown side-effect class {side_effect_class!r}")


#: adapter-semantics 7.2.  Each resource carries exactly one unit.
RESOURCE_UNITS: Final[dict[ReportableResource, ResourceUnit]] = {
    "audio-units": "usage-unit",
    "cached-input-units": "usage-unit",
    "image-units": "usage-unit",
    "input-units": "usage-unit",
    "output-units": "usage-unit",
    "provider-calls": "count",
    "reasoning-units": "usage-unit",
    "tool-calls": "count",
    "transport-bytes": "byte",
}

USAGE_UNIT_RESOURCES: Final[tuple[ReportableResource, ...]] = (
    "audio-units",
    "cached-input-units",
    "image-units",
    "input-units",
    "output-units",
    "reasoning-units",
)

USAGE_TRUSTS: Final[tuple[UsageTrust, ...]] = (
    "adapter-conservative",
    "provider-reported",
    "unknown",
)


@dataclass(frozen=True, slots=True)
class CapabilityImplication:
    rule: str
    capability: AdapterCapability
    requires: AdapterCapability


#: adapter-semantics 4.2.  Table rows, so each row is separately falsifiable.
CAPABILITY_IMPLICATIONS: Final[tuple[CapabilityImplication, ...]] = (
    CapabilityImplication("D-009", "cached-input-usage-reporting", "usage-reporting"),
    CapabilityImplication("D-010", "reasoning-usage-reporting", "usage-reporting"),
    CapabilityImplication("D-011", "parallel-tool-calls", "tool-calling"),
    CapabilityImplication("D-012", "retry-after-hint", "rate-limit-reporting"),
)


@dataclass(frozen=True, slots=True)
class MockOnlyCapability:
    rule: str
    capability: AdapterCapability


MOCK_ONLY_CAPABILITIES: Final[tuple[MockOnlyCapability, ...]] = (
    MockOnlyCapability("D-013", "deterministic-replay"),
    MockOnlyCapability("D-014", "fault-injection"),
)


@dataclass(frozen=True, slots=True)
class CapabilityGatedResource:
    rule: str
    resource: ReportableResource
    capability: AdapterCapability


CAPABILITY_GATED_RESOURCES: Final[tuple[CapabilityGatedResource, ...]] = (
    CapabilityGatedResource("U-009", "cached-input-units", "cached-input-usage-reporting"),
    CapabilityGatedResource("U-010", "reasoning-units", "reasoning-usage-reporting"),
    CapabilityGatedResource("U-011", "image-units", "attachments"),
    CapabilityGatedResource("U-011", "audio-units", "attachments"),
    CapabilityGatedResource("U-012", "tool-calls", "tool-calling"),
)
