"""Structured, non-sensitive failures for the durable payload guard.

``redaction-semantics.md`` Section 10 freezes twelve portable failure codes and
requires that a failure never echoes the offending value.  Every failure in this
package is therefore a value, not an exception carrying provider text: detail
keys are a closed allowlist of stable identifiers, integers, and digests.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Literal, TypeAlias

FailureCode: TypeAlias = Literal[
    "REDACTION_POLICY_REQUIRED",
    "REDACTION_POLICY_INVALID",
    "CAPTURE_POLICY_MISMATCH",
    "INLINE_CAPTURE_NOT_AUTHORIZED",
    "PAYLOAD_PROTECTION_REQUIRED",
    "PAYLOAD_PROTECTION_FAILED",
    "PROTECTED_PAYLOAD_NOT_FOUND",
    "PROTECTED_PAYLOAD_UNAUTHORIZED",
    "PROTECTED_PAYLOAD_CORRUPT",
    "REDACTION_RECEIPT_INVALID",
    "LEGACY_REDACTION_MISMATCH",
    "SECRET_CANARY_DETECTED",
]

FAILURE_CODES: tuple[FailureCode, ...] = (
    "REDACTION_POLICY_REQUIRED",
    "REDACTION_POLICY_INVALID",
    "CAPTURE_POLICY_MISMATCH",
    "INLINE_CAPTURE_NOT_AUTHORIZED",
    "PAYLOAD_PROTECTION_REQUIRED",
    "PAYLOAD_PROTECTION_FAILED",
    "PROTECTED_PAYLOAD_NOT_FOUND",
    "PROTECTED_PAYLOAD_UNAUTHORIZED",
    "PROTECTED_PAYLOAD_CORRUPT",
    "REDACTION_RECEIPT_INVALID",
    "LEGACY_REDACTION_MISMATCH",
    "SECRET_CANARY_DETECTED",
)

GuardPhase: TypeAlias = Literal[
    "snapshot",
    "classification",
    "policy",
    "encode",
    "mac",
    "protect",
    "atomic-publish",
    "receipt",
    "scan",
    "canonicalize",
    "sink-write",
    "compare-and-swap",
]

PRE_EXECUTOR_FAILURE_POINTS: tuple[GuardPhase, ...] = (
    "snapshot",
    "classification",
    "policy",
    "encode",
    "mac",
    "protect",
    "atomic-publish",
    "receipt",
    "scan",
    "canonicalize",
    "sink-write",
    "compare-and-swap",
)

POST_EXECUTOR_FAILURE_POINTS: tuple[GuardPhase, ...] = (
    "encode",
    "mac",
    "protect",
    "atomic-publish",
    "receipt",
    "scan",
    "canonicalize",
    "sink-write",
    "compare-and-swap",
)

SideEffects: TypeAlias = Literal["none", "idempotent", "non-idempotent", "unspecified"]

SIDE_EFFECT_CLASSIFICATIONS: tuple[SideEffects, ...] = (
    "none",
    "idempotent",
    "non-idempotent",
    "unspecified",
)

RetryDisposition: TypeAlias = Literal[
    "not-applicable",
    "safe-new-attempt",
    "in-doubt-effect",
    "forbidden",
]

ExecutorOutcome: TypeAlias = Literal["not-started", "succeeded", "failed", "not-applicable"]

DetailValue: TypeAlias = str | int | bool

# Detail keys are a closed allowlist. Section 10 forbids offending bytes, keys,
# plaintext, raw exception or provider messages, and detected canary values, so
# an unlisted key cannot be attached even by internal code.
SAFE_DETAIL_KEYS: frozenset[str] = frozenset(
    {
        "attempt",
        "capturePolicyHash",
        "contractVersion",
        "count",
        "decisionId",
        "edgeId",
        "eventId",
        "expected",
        "expectedContractVersion",
        "field",
        "index",
        "limit",
        "measured",
        "nodeId",
        "observed",
        "occurrenceId",
        "policyControl",
        "policyHash",
        "recordKind",
        "recordType",
        "rule",
        "runId",
        "sequence",
        "sink",
        "sourceClass",
        "canaryId",
    }
)


class UnsafeFailureDetailError(ValueError):
    """Raised when internal code attempts to attach an unlisted detail key."""


@dataclass(frozen=True, slots=True)
class RedactionFailure:
    """One structured guard denial.

    The value is safe to serialize into an error envelope: it holds a stable
    code, the phase that denied the write, and closed metadata only.
    """

    code: FailureCode
    phase: GuardPhase
    detail: Mapping[str, DetailValue] = field(default_factory=dict)

    def __post_init__(self) -> None:
        unsafe = sorted(key for key in self.detail if key not in SAFE_DETAIL_KEYS)
        if unsafe:
            raise UnsafeFailureDetailError(
                "redaction failure detail keys are a closed allowlist: " + ", ".join(unsafe)
            )
        for key, value in self.detail.items():
            if type(value) not in (str, int, bool):
                raise UnsafeFailureDetailError(
                    f"redaction failure detail {key!r} must be a stable scalar"
                )

    def as_document(self) -> dict[str, DetailValue | dict[str, DetailValue]]:
        """Return the metadata-only projection used by diagnostics."""

        return {"code": self.code, "phase": self.phase, "detail": dict(self.detail)}


class RedactionDenied(Exception):
    """Edge-of-API carrier for a :class:`RedactionFailure`.

    The guard itself is a total function returning values; this exception exists
    only so callers that write through a ``Protocol``-shaped store still fail
    closed instead of receiving ``None``.
    """

    def __init__(self, failure: RedactionFailure) -> None:
        super().__init__(f"{failure.code} at {failure.phase}")
        self.failure = failure


def failure(
    code: FailureCode,
    phase: GuardPhase,
    **detail: DetailValue,
) -> RedactionFailure:
    """Construct a failure with allowlisted detail only."""

    return RedactionFailure(code=code, phase=phase, detail=dict(detail))
