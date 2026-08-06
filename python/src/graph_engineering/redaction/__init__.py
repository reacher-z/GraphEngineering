"""Durable payload protection and redaction, ``redaction-semantics.md`` v1alpha2.

This package implements the Python side of the contract frozen by
``D9-REDACTION-039``: the closed source and sink inventories, the deterministic
source x sink evaluator, the immutable effective capture policy, the exact RFC
6901 pointer transform, the bound redaction receipt, the protected payload
primitives, the payload-disposition truth table, and the shared
sink-before-write guard.

It does not claim D9 complete.  Section 12.1 requires both native runtimes, the
shared conformance join, the packaged canary campaign, and an independent
security review before any such claim.
"""

from .disposition import (
    DISPOSITION_TRUTH_TABLE,
    PAYLOAD_DISPOSITIONS,
    DispositionFacts,
    PayloadDisposition,
    validate_disposition,
)
from .errors import (
    FAILURE_CODES,
    ExecutorOutcome,
    FailureCode,
    GuardPhase,
    RedactionDenied,
    RedactionFailure,
    RetryDisposition,
    SideEffects,
    failure,
)
from .flow import ALGORITHM, FlowDecision, evaluate_flow
from .guard import (
    GuardFailed,
    GuardOutcome,
    GuardPayloadField,
    GuardPrepared,
    GuardSuppressed,
    OccurrenceContext,
    PreparedSinkWrite,
    PreparedSinkWriteMisuse,
    SinkGuard,
    SinkGuardDecision,
    SinkWriteRequest,
    normalize_side_effects,
    open_attempt_retry_disposition,
    retry_disposition_for,
)
from .inventory import (
    SINK_CLASSES,
    SOURCE_CLASSES,
    SinkRow,
    SourceRow,
    sink_row,
    source_row,
)
from .keys import (
    DeterministicTestKeyProvider,
    EphemeralKeyProvider,
    KeyProvider,
    Protector,
    ReferenceProtector,
)
from .legacy import LegacyDisposition, classify_history, classify_record
from .limits import DEFAULT_LIMITS, PortableLimits, portable_snapshot
from .pointer import (
    REDACTION_TOKEN,
    PointerTransformDenied,
    PointerTransformResult,
    apply_pointer_transform,
    decode_pointer,
)
from .policy import (
    CapturePolicy,
    RedactionRule,
    capture_policy_hash,
    default_stable_profile,
    normalize_capture_policy,
)
from .protect import (
    FileProtectedPayloadStore,
    MemoryProtectedPayloadStore,
    ProtectedAad,
    ProtectedBlob,
    ProtectedPayloadStore,
    ProtectedValueRef,
    activity_key,
    key_ref_hash,
    protect_value,
    unprotect_value,
    value_mac,
)
from .receipt import RedactionReceipt, TransformOccurrence, build_receipt, verify_receipt
from .scan import CanaryDetection, CanaryRegistry

__all__ = [
    "ALGORITHM",
    "DEFAULT_LIMITS",
    "DISPOSITION_TRUTH_TABLE",
    "FAILURE_CODES",
    "PAYLOAD_DISPOSITIONS",
    "REDACTION_TOKEN",
    "SINK_CLASSES",
    "SOURCE_CLASSES",
    "CanaryDetection",
    "CanaryRegistry",
    "CapturePolicy",
    "DeterministicTestKeyProvider",
    "DispositionFacts",
    "EphemeralKeyProvider",
    "ExecutorOutcome",
    "FailureCode",
    "FileProtectedPayloadStore",
    "FlowDecision",
    "GuardFailed",
    "GuardOutcome",
    "GuardPayloadField",
    "GuardPhase",
    "GuardPrepared",
    "GuardSuppressed",
    "KeyProvider",
    "LegacyDisposition",
    "MemoryProtectedPayloadStore",
    "OccurrenceContext",
    "PayloadDisposition",
    "PointerTransformDenied",
    "PointerTransformResult",
    "PortableLimits",
    "PreparedSinkWrite",
    "PreparedSinkWriteMisuse",
    "ProtectedAad",
    "ProtectedBlob",
    "ProtectedPayloadStore",
    "ProtectedValueRef",
    "Protector",
    "RedactionDenied",
    "RedactionFailure",
    "RedactionReceipt",
    "RedactionRule",
    "ReferenceProtector",
    "RetryDisposition",
    "SideEffects",
    "SinkGuard",
    "SinkGuardDecision",
    "SinkRow",
    "SinkWriteRequest",
    "SourceRow",
    "TransformOccurrence",
    "activity_key",
    "apply_pointer_transform",
    "build_receipt",
    "capture_policy_hash",
    "classify_history",
    "classify_record",
    "decode_pointer",
    "default_stable_profile",
    "evaluate_flow",
    "failure",
    "key_ref_hash",
    "normalize_capture_policy",
    "normalize_side_effects",
    "open_attempt_retry_disposition",
    "portable_snapshot",
    "protect_value",
    "retry_disposition_for",
    "sink_row",
    "source_row",
    "unprotect_value",
    "validate_disposition",
    "value_mac",
    "verify_receipt",
]
