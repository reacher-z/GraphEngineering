"""Normalized error envelope consistency, rules ``E-001`` through ``E-015``,
plus the single constructor every adapter in this package uses.

adapter-semantics 8.5: an error message is operator-facing and never
load-bearing.  ``message`` and every provider-safe detail field MUST NOT carry
credentials, prompts or unredacted provider payloads.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Final

from .contract import (
    derive_ledger_action,
    derive_usage_disposition,
    escalates_side_effect,
    requires_in_doubt_record,
    taxonomy_facts,
)
from .errors import fail
from .ordering import is_sorted_by_code_point
from .types import (
    AdapterDescriptor,
    AdapterErrorCode,
    AdapterErrorEnvelope,
    AdapterUsage,
    DenialReason,
    NormalizedErrorOutcome,
    ProviderSafeField,
    SideEffectClass,
)

_MALFORMED: Final[AdapterErrorCode] = "GE_ADAPTER_MALFORMED_RESPONSE"
_NUL = "\x00"
_MAX_MESSAGE_LENGTH = 512
_MAX_DETAIL_VALUE_LENGTH = 256


def validate_error_envelope(
    descriptor: AdapterDescriptor,
    error: AdapterErrorEnvelope,
    forbidden_markers: Sequence[str] = (),
) -> NormalizedErrorOutcome:
    facts = taxonomy_facts(error.code)
    declared = frozenset(descriptor.capabilities)

    if error.retryable != facts.retryable:
        fail(_MALFORMED, "E-001", "retryability is a property of the code and cannot be restated")
    if error.boundary != facts.boundary:
        fail(_MALFORMED, "E-002", "boundary is a property of the code")
    if error.effect_disposition != facts.effect_disposition:
        fail(_MALFORMED, "E-003", "external-effect disposition is a property of the code")
    if error.usage_disposition != derive_usage_disposition(facts.effect_disposition):
        fail(_MALFORMED, "E-004", "usage disposition is derived from the effect disposition")
    if (error.denial_reason is not None) != (error.code == "GE_ADAPTER_POLICY_DENIED"):
        fail(
            _MALFORMED,
            "E-005",
            "a denial reason accompanies GE_ADAPTER_POLICY_DENIED and nothing else",
        )
    if error.provider_request_id is not None and facts.boundary != "dispatch":
        fail(_MALFORMED, "E-006", "a pre-dispatch refusal never reached the provider")
    if error.provider_request_id is not None and "provider-request-id" not in declared:
        fail(
            _MALFORMED,
            "E-007",
            "a provider request identity requires the provider-request-id capability",
        )
    if error.retry_after_ms is not None and not facts.retryable:
        fail(_MALFORMED, "E-008", "a backoff hint on a non-retryable code is meaningless")
    if error.retry_after_ms is not None and "retry-after-hint" not in declared:
        fail(_MALFORMED, "E-009", "a backoff hint requires the retry-after-hint capability")
    if error.usage_disposition == "none" and error.usage is not None:
        fail(_MALFORMED, "E-010", "a refusal that performed no external work reports no usage")
    if error.usage is not None and (
        error.usage.adapter_id != error.adapter_id
        or error.usage.adapter_kind != error.adapter_kind
        or error.usage.request_id != error.request_id
    ):
        fail(
            _MALFORMED,
            "E-011",
            "an attached usage envelope must bind the same adapter and request",
        )
    if error.attempt > descriptor.retry_policy.max_attempts:
        fail(_MALFORMED, "E-012", "an attempt index cannot exceed the declared attempt ceiling")
    if escalates_side_effect(error.side_effect_class, descriptor.side_effect_class):
        fail(
            _MALFORMED,
            "E-013",
            "an error cannot report a stronger side-effect class than the adapter declares",
        )
    haystack = _NUL.join(
        [
            error.message,
            *(f"{field.name}={field.value}" for field in error.provider_safe_fields),
        ]
    )
    for marker in forbidden_markers:
        if marker in haystack:
            fail(
                _MALFORMED,
                "E-014",
                "an adapter error must not carry credentials, prompts or unredacted payloads",
            )
    names = [field.name for field in error.provider_safe_fields]
    if len(set(names)) != len(names) or not is_sorted_by_code_point(names):
        fail(_MALFORMED, "E-015", "provider-safe detail names must be unique and ordered")

    return NormalizedErrorOutcome(
        code=error.code,
        ledger_action=derive_ledger_action(error.usage_disposition),
        requires_in_doubt_record=requires_in_doubt_record(
            error.effect_disposition, error.side_effect_class
        ),
    )


def normalized_adapter_error(
    descriptor: AdapterDescriptor,
    *,
    request_id: str,
    attempt: int,
    code: AdapterErrorCode,
    side_effect_class: SideEffectClass | str,
    message: str,
    denial_reason: DenialReason | None = None,
    provider_request_id: str | None = None,
    retry_after_ms: int | None = None,
    rule: str = "none",
    detail: Sequence[ProviderSafeField] = (),
    usage: AdapterUsage | None = None,
    forbidden_markers: Sequence[str] = (),
) -> AdapterErrorEnvelope:
    """Build a normalized envelope and prove it before returning it.

    The boundary, retryability, effect disposition and usage disposition are
    *derived* from the code, then checked against ``E-001``..``E-015``.  An
    adapter cannot emit a non-conforming envelope through this constructor.

    ``rule`` is the stable identifier of adapter-semantics 12, reported as the
    ``rule`` provider-safe detail field.  It is ``"none"`` when the refusal is
    not one the register names — an implementation may never invent a register
    identifier.
    """
    facts = taxonomy_facts(code)
    fields: dict[str, str] = {"attempt": str(attempt), "rule": rule}
    for field in detail:
        fields[field.name] = field.value
    provider_safe_fields = tuple(
        ProviderSafeField(name=name, value=value[:_MAX_DETAIL_VALUE_LENGTH])
        for name, value in sorted(fields.items())
    )

    envelope = AdapterErrorEnvelope(
        adapter_id=descriptor.adapter_id,
        adapter_kind=descriptor.adapter_kind,
        request_id=request_id,
        attempt=attempt,
        code=code,
        boundary=facts.boundary,
        retryable=facts.retryable,
        effect_disposition=facts.effect_disposition,
        usage_disposition=derive_usage_disposition(facts.effect_disposition),
        side_effect_class=side_effect_class,
        denial_reason=denial_reason,
        provider_request_id=provider_request_id,
        retry_after_ms=retry_after_ms,
        message=message[:_MAX_MESSAGE_LENGTH],
        provider_safe_fields=provider_safe_fields,
        usage=usage,
    )
    validate_error_envelope(descriptor, envelope, forbidden_markers)
    return envelope
