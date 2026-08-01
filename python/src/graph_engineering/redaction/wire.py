"""Native closed validation for every machine artifact in the Section 1.1 set.

JSON Schema proves structural closure only.  These validators are the native
runtime's own reading of the same contract: they check closed key sets, closed
vocabularies, byte-level crypto field rules, record-kind relations, and the
conditional-presence rules that a schema alone cannot express, and they return
the stable Section 10 code for each rejection.

They are deliberately independent of any schema file so a shipped wheel needs no
``spec/`` directory at runtime; the conformance tests replay the frozen corpus
against them.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Final

from ..models import JsonValue
from .disposition import validate_disposition
from .errors import RedactionFailure, failure
from .inventory import sink_row, source_row
from .policy import normalize_capture_policy, normalize_redaction_rule
from .protect import (
    CONTRACT_VERSION_V1ALPHA2,
    DURABLE_JSON_CODEC,
    PROTECTED_AAD_API_VERSION,
    PROTECTED_STORE_CONTRACT,
    PROTECTED_STORE_ENVELOPE_API_VERSION,
    decode_blob_document,
    validate_reference_document,
)
from .receipt import validate_receipt_document

_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
_RECORD_TYPE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$")
_POINTER = re.compile(r"^(?:/(?:[^~/]|~[01])*)+$")
_TIMESTAMP = re.compile(
    r"^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])"
    r"T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$"
)
_MAX_SAFE_INTEGER: Final = 2**53 - 1

EVENT_V1ALPHA2_API_VERSION: Final = "graphengineering.reacher-z.github.io/events/v1alpha2"
CHECKPOINT_V1ALPHA2_API_VERSION: Final = (
    "graphengineering.reacher-z.github.io/checkpoints/v1alpha2"
)
CHECKPOINT_PROJECTION_TYPE: Final = "scheduler-projection/v1alpha2"
SINK_GUARD_DECISION_API_VERSION: Final = (
    "graphengineering.reacher-z.github.io/sink-guard-decision/v1alpha1"
)

# Section 3.2 / event-v1alpha2.schema.json: one disposition per event type.
EVENT_TYPE_DISPOSITIONS: Final[dict[str, tuple[str, ...]]] = {
    "RunCreated": ("protected-ref",),
    "RunStarted": ("metadata-only",),
    "RunResumed": ("metadata-only",),
    "NodeScheduled": ("protected-ref",),
    "NodeStarted": ("metadata-only",),
    "NodeAttemptFailed": ("metadata-only", "protected-ref"),
    "NodeSettledWithoutAttempt": ("protected-ref",),
    "NodeRetried": ("metadata-only",),
    "NodeSucceeded": ("protected-ref",),
    "EdgeEmitted": ("metadata-only",),
    "RunCancelled": ("protected-ref",),
    "RunFailed": ("protected-ref",),
    "RunSucceeded": ("protected-ref",),
}

# Section 6.1: legacy aliases and inline payloads are forbidden in a protected
# v1alpha2 payload.
FORBIDDEN_DATA_FIELDS: Final[frozenset[str]] = frozenset(
    {"input", "output", "result", "state", "inputHash", "outputHash", "resultHash"}
)

_GUARD_OUTCOMES: Final[frozenset[str]] = frozenset(
    {"suppressed", "metadata-only", "protected-ref", "redacted", "inline-unredacted", "failed"}
)
_GUARD_FAILURE_FIELDS: Final[tuple[str, ...]] = (
    "failureCode",
    "executorOutcome",
    "retryDisposition",
)
_EXECUTOR_OUTCOMES: Final[frozenset[str]] = frozenset(
    {"not-started", "succeeded", "failed", "not-applicable"}
)
_RETRY_DISPOSITIONS: Final[frozenset[str]] = frozenset(
    {"not-applicable", "safe-new-attempt", "in-doubt-effect", "forbidden"}
)
_FAILURE_CODES: Final[frozenset[str]] = frozenset(
    {
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
    }
)

_NODE_STATUSES: Final[frozenset[str]] = frozenset(
    {"pending", "running", "retry-wait", "succeeded", "failed", "skipped"}
)


def _policy_invalid() -> RedactionFailure:
    return failure("REDACTION_POLICY_INVALID", "sink-write")


def _hex(value: object) -> bool:
    return type(value) is str and _SHA256.fullmatch(value) is not None


def _identifier(value: object) -> bool:
    return (
        type(value) is str
        and _IDENTIFIER.fullmatch(value) is not None
        and value not in (".", "..")
    )


def _integer(value: object, minimum: int) -> bool:
    return type(value) is int and minimum <= value <= _MAX_SAFE_INTEGER


def validate_source_class(document: object) -> RedactionFailure | None:
    """Unknown source classes are denied; never mapped to the nearest member."""

    if type(document) is not str or source_row(document) is None:
        return _policy_invalid()
    return None


def validate_sink(document: object) -> RedactionFailure | None:
    """Unknown sinks are denied; never mapped to the nearest enum value."""

    if type(document) is not str or sink_row(document) is None:
        return _policy_invalid()
    return None


def validate_aad_document(document: object) -> RedactionFailure | None:
    """Section 5.5 associated data, including the record-kind relations."""

    corrupt = failure("PROTECTED_PAYLOAD_CORRUPT", "protect")
    if not isinstance(document, Mapping):
        return corrupt
    required = {
        "apiVersion",
        "contractVersion",
        "runId",
        "graphRevision",
        "recordKind",
        "recordType",
        "sequence",
        "fieldPath",
        "capturePolicyHash",
        "keyRefHash",
        "authorityBindingHash",
        "tenantScopeHash",
        "codec",
        "valueMac",
    }
    optional = {"nodeId", "edgeId", "attempt", "eventId", "checkpointId"}
    keys = set(document.keys())
    if not required <= keys or not keys <= (required | optional):
        return corrupt
    if document["apiVersion"] != PROTECTED_AAD_API_VERSION:
        return corrupt
    if document["contractVersion"] != CONTRACT_VERSION_V1ALPHA2:
        return corrupt
    if document["codec"] != DURABLE_JSON_CODEC:
        return corrupt
    if not _identifier(document["runId"]):
        return corrupt
    if not _integer(document["graphRevision"], 1) or not _integer(document["sequence"], 0):
        return corrupt
    record_kind = document["recordKind"]
    if record_kind not in ("event", "checkpoint"):
        return corrupt
    record_type = document["recordType"]
    if type(record_type) is not str or _RECORD_TYPE.fullmatch(record_type) is None:
        return corrupt
    field_path = document["fieldPath"]
    if (
        type(field_path) is not str
        or _POINTER.fullmatch(field_path) is None
        or len(field_path.encode("utf-8")) > 1024
    ):
        return corrupt
    for name in (
        "capturePolicyHash",
        "keyRefHash",
        "authorityBindingHash",
        "tenantScopeHash",
        "valueMac",
    ):
        if not _hex(document[name]):
            return corrupt
    for name in ("nodeId", "edgeId"):
        if name in document and not _identifier(document[name]):
            return corrupt
    if "attempt" in document and not _integer(document["attempt"], 1):
        return corrupt
    if record_kind == "event":
        if "eventId" not in document or "checkpointId" in document:
            return corrupt
        if not _identifier(document["eventId"]):
            return corrupt
    else:
        if "checkpointId" not in document or "eventId" in document:
            return corrupt
        if not _identifier(document["checkpointId"]):
            return corrupt
    return None


def validate_store_envelope_document(document: object) -> RedactionFailure | None:
    """The closed guarded store operation shape.

    It never accepts a logical plaintext value, encryption key, nonce source,
    free-form metadata, or raw provider error.
    """

    if not isinstance(document, Mapping):
        return _policy_invalid()
    if document.get("apiVersion") != PROTECTED_STORE_ENVELOPE_API_VERSION:
        return _policy_invalid()
    operation = document.get("operation")
    if operation not in ("put", "get", "delete"):
        return _policy_invalid()

    common = {
        "apiVersion",
        "operationId",
        "operation",
        "runId",
        "capturePolicyHash",
        "keyRefHash",
        "authorityBindingHash",
        "tenantScopeHash",
        "protectedValue",
        "aad",
    }
    allowed = common | ({"blob"} if operation == "put" else set())
    if operation == "delete":
        allowed = allowed | {"deleteReason"}
    keys = set(document.keys())
    if not keys <= allowed:
        if keys - allowed & {"plaintext", "value", "key", "nonce"} or "plaintext" in keys:
            # A logical plaintext value can never enter the store envelope.
            return failure("PAYLOAD_PROTECTION_REQUIRED", "protect")
        return failure("PAYLOAD_PROTECTION_REQUIRED", "protect")
    if not common <= keys:
        return _policy_invalid()
    if operation == "put" and "blob" not in keys:
        return _policy_invalid()
    if not _identifier(document["operationId"]) or not _identifier(document["runId"]):
        return _policy_invalid()
    for name in (
        "capturePolicyHash",
        "keyRefHash",
        "authorityBindingHash",
        "tenantScopeHash",
    ):
        if not _hex(document[name]):
            return _policy_invalid()

    reference = document["protectedValue"]
    reference_failure = validate_reference_document(reference)
    if reference_failure is not None:
        return reference_failure
    aad = document["aad"]
    aad_failure = validate_aad_document(aad)
    if aad_failure is not None:
        return aad_failure
    assert isinstance(reference, Mapping)
    assert isinstance(aad, Mapping)

    # Section 5.6 put semantics: exact equality of envelope and AAD context.
    for name in (
        "runId",
        "capturePolicyHash",
        "keyRefHash",
        "authorityBindingHash",
        "tenantScopeHash",
    ):
        if document[name] != aad[name]:
            return failure("PROTECTED_PAYLOAD_UNAUTHORIZED", "protect")
    if reference["keyRefHash"] != aad["keyRefHash"]:
        return failure("PROTECTED_PAYLOAD_UNAUTHORIZED", "protect")
    if reference["valueMac"] != aad["valueMac"]:
        return failure("PROTECTED_PAYLOAD_CORRUPT", "protect")
    if operation == "put":
        blob = decode_blob_document(document["blob"])
        if isinstance(blob, RedactionFailure):
            return blob
    return None


def validate_event_shape(document: object) -> RedactionFailure | None:
    """Closed ``events/v1alpha2`` envelope validation, without hash relations."""

    if not isinstance(document, Mapping):
        return _policy_invalid()
    required = {
        "apiVersion",
        "eventId",
        "type",
        "timestamp",
        "runId",
        "graphRevision",
        "sequence",
        "payloadHash",
        "capturePolicyHash",
        "redacted",
        "payloadDisposition",
        "data",
    }
    optional = {"traceId", "spanId", "parentSpanId", "nodeId", "edgeId", "attempt"}
    keys = set(document.keys())
    if not required <= keys or not keys <= (required | optional):
        return _policy_invalid()
    if document["apiVersion"] != EVENT_V1ALPHA2_API_VERSION:
        return _policy_invalid()
    event_type = document["type"]
    if type(event_type) is not str or event_type not in EVENT_TYPE_DISPOSITIONS:
        return _policy_invalid()

    # The disposition/redacted truth pair is checked before anything else that
    # could mask a false claim about these exact bytes.
    disposition_failure = validate_disposition(
        {
            "payloadDisposition": document["payloadDisposition"],
            "redacted": document["redacted"],
        }
    )
    if disposition_failure is not None:
        return disposition_failure

    data = document["data"]
    if not isinstance(data, Mapping):
        return _policy_invalid()
    if set(data.keys()) & FORBIDDEN_DATA_FIELDS:
        return failure("PAYLOAD_PROTECTION_REQUIRED", "sink-write")

    if document["payloadDisposition"] not in EVENT_TYPE_DISPOSITIONS[event_type]:
        return _policy_invalid()
    if not _identifier(document["eventId"]) or not _identifier(document["runId"]):
        return _policy_invalid()
    if not _integer(document["graphRevision"], 1) or not _integer(document["sequence"], 0):
        return _policy_invalid()
    if not _hex(document["payloadHash"]) or not _hex(document["capturePolicyHash"]):
        return _policy_invalid()
    timestamp = document["timestamp"]
    if type(timestamp) is not str or _TIMESTAMP.fullmatch(timestamp) is None:
        return _policy_invalid()

    for identity, width in (("traceId", 32), ("spanId", 16), ("parentSpanId", 16)):
        if identity not in document:
            continue
        value = document[identity]
        if (
            type(value) is not str
            or len(value) != width
            or any(character not in "0123456789abcdef" for character in value)
            or set(value) == {"0"}
        ):
            return _policy_invalid()
    if "parentSpanId" in document and "spanId" not in document:
        return _policy_invalid()

    for name in ("nodeId", "edgeId"):
        if name in document and not _identifier(document[name]):
            return _policy_invalid()
    if "attempt" in document and not _integer(document["attempt"], 1):
        return _policy_invalid()

    for name, value in data.items():
        if name.endswith("Ref"):
            reference_failure = validate_reference_document(value)
            if reference_failure is not None:
                return reference_failure
        elif name.endswith("Mac") or name == "activityKey":
            if not _hex(value):
                return _policy_invalid()
    # Section 6.1: an adjacent MAC must equal the referenced object's valueMac.
    for name, value in data.items():
        if not name.endswith("Ref") or not isinstance(value, Mapping):
            continue
        adjacent = f"{name[:-3]}Mac"
        if adjacent in data and data[adjacent] != value.get("valueMac"):
            return failure("PROTECTED_PAYLOAD_CORRUPT", "sink-write")
    return None


def validate_checkpoint_shape(document: object) -> RedactionFailure | None:
    """Closed ``checkpoints/v1alpha2`` projection validation."""

    if not isinstance(document, Mapping):
        return _policy_invalid()
    required = {
        "apiVersion",
        "projectionType",
        "runId",
        "checkpointId",
        "sequence",
        "createdAt",
        "graphRevision",
        "graphHash",
        "implementationHash",
        "capturePolicyHash",
        "protectedStoreContract",
        "keyRefHash",
        "historyPrefixHash",
        "totalAttempts",
        "protectedRefCount",
        "redacted",
        "payloadDisposition",
        "graphInputRef",
        "graphInputMac",
        "nodes",
        "contentHash",
    }
    keys = set(document.keys())
    if not required <= keys:
        return _policy_invalid()
    if keys - required:
        # Existing `checkpoints/v1alpha1` arbitrary inline state is legacy
        # inline data; it never becomes a protected v1alpha2 projection.
        return failure("PAYLOAD_PROTECTION_REQUIRED", "sink-write")
    if document["apiVersion"] != CHECKPOINT_V1ALPHA2_API_VERSION:
        return _policy_invalid()
    if document["projectionType"] != CHECKPOINT_PROJECTION_TYPE:
        return _policy_invalid()
    if document["protectedStoreContract"] != PROTECTED_STORE_CONTRACT:
        return _policy_invalid()

    disposition_failure = validate_disposition(
        {
            "payloadDisposition": document["payloadDisposition"],
            "redacted": document["redacted"],
        }
    )
    if disposition_failure is not None:
        return disposition_failure
    if document["payloadDisposition"] != "protected-ref":
        return _policy_invalid()

    if not _identifier(document["runId"]) or not _identifier(document["checkpointId"]):
        return _policy_invalid()
    for name in (
        "graphHash",
        "implementationHash",
        "capturePolicyHash",
        "keyRefHash",
        "historyPrefixHash",
        "graphInputMac",
        "contentHash",
    ):
        if not _hex(document[name]):
            return _policy_invalid()
    if not _integer(document["sequence"], 0) or not _integer(document["graphRevision"], 1):
        return _policy_invalid()
    if not _integer(document["totalAttempts"], 0):
        return _policy_invalid()
    reference_count = document["protectedRefCount"]
    if type(reference_count) is not int or not 1 <= reference_count <= 1024:
        return _policy_invalid()
    created_at = document["createdAt"]
    if type(created_at) is not str or _TIMESTAMP.fullmatch(created_at) is None:
        return _policy_invalid()

    reference_failure = validate_reference_document(document["graphInputRef"])
    if reference_failure is not None:
        return reference_failure
    nodes = document["nodes"]
    if type(nodes) is not list or len(nodes) > 2048:
        return _policy_invalid()
    seen: set[str] = set()
    for node in nodes:
        if not isinstance(node, Mapping):
            return _policy_invalid()
        node_id = node.get("nodeId")
        status = node.get("status")
        if not _identifier(node_id) or status not in _NODE_STATUSES:
            return _policy_invalid()
        assert type(node_id) is str
        if node_id in seen:
            return _policy_invalid()
        seen.add(node_id)
        for name, value in node.items():
            if name.endswith("Ref"):
                node_failure = validate_reference_document(value)
                if node_failure is not None:
                    return node_failure
    return None


def validate_guard_decision_document(document: object) -> RedactionFailure | None:
    """The closed metadata-only audit projection of one guard decision."""

    if not isinstance(document, Mapping):
        return _policy_invalid()
    required = {
        "apiVersion",
        "decisionId",
        "sourceClass",
        "sink",
        "authorityClass",
        "capturePolicyHash",
        "outcome",
        "writeAuthorized",
    }
    optional = {
        "preparedPayloadHash",
        "protectedRefs",
        "redactionReceipt",
        "inlineRiskAuthorizationHash",
        *_GUARD_FAILURE_FIELDS,
    }
    keys = set(document.keys())
    if not required <= keys or not keys <= (required | optional):
        return _policy_invalid()
    if document["apiVersion"] != SINK_GUARD_DECISION_API_VERSION:
        return _policy_invalid()
    if not _identifier(document["decisionId"]) or not _hex(document["capturePolicyHash"]):
        return _policy_invalid()
    if validate_source_class(document["sourceClass"]) is not None:
        return _policy_invalid()
    if validate_sink(document["sink"]) is not None:
        return _policy_invalid()
    if document["authorityClass"] not in ("authoritative", "observational"):
        return _policy_invalid()
    outcome = document["outcome"]
    if outcome not in _GUARD_OUTCOMES:
        return _policy_invalid()
    if type(document["writeAuthorized"]) is not bool:
        return _policy_invalid()

    present_failure_fields = [name for name in _GUARD_FAILURE_FIELDS if name in document]
    if outcome == "failed":
        # A failed decision always includes all three failure-disposition fields.
        if len(present_failure_fields) != len(_GUARD_FAILURE_FIELDS):
            return _policy_invalid()
        if document["failureCode"] not in _FAILURE_CODES:
            return _policy_invalid()
        if document["executorOutcome"] not in _EXECUTOR_OUTCOMES:
            return _policy_invalid()
        if document["retryDisposition"] not in _RETRY_DISPOSITIONS:
            return _policy_invalid()
        if document["writeAuthorized"] is not False:
            return _policy_invalid()
        if keys & {"preparedPayloadHash", "protectedRefs", "redactionReceipt"}:
            return _policy_invalid()
        return None

    # Every non-failed decision forbids those three fields.
    if present_failure_fields:
        return _policy_invalid()
    if outcome == "suppressed":
        if document["writeAuthorized"] is not False:
            return _policy_invalid()
        if keys & {"preparedPayloadHash", "protectedRefs", "redactionReceipt"}:
            return _policy_invalid()
        return None
    if document["writeAuthorized"] is not True:
        return _policy_invalid()
    if "preparedPayloadHash" not in document or not _hex(document["preparedPayloadHash"]):
        return _policy_invalid()
    if outcome == "protected-ref":
        references = document.get("protectedRefs")
        if type(references) is not list or not references or len(references) > 1024:
            return _policy_invalid()
        for reference in references:
            reference_failure = validate_reference_document(reference)
            if reference_failure is not None:
                return reference_failure
        if "redactionReceipt" in document:
            return _policy_invalid()
        return None
    if outcome == "redacted":
        if document["authorityClass"] != "observational":
            return _policy_invalid()
        if "protectedRefs" in document:
            return _policy_invalid()
        return validate_receipt_document(document.get("redactionReceipt"))
    if keys & {"protectedRefs", "redactionReceipt"}:
        return _policy_invalid()
    if outcome == "inline-unredacted" and not _hex(document.get("inlineRiskAuthorizationHash")):
        return _policy_invalid()
    return None


_VALIDATORS: Final[dict[str, object]] = {}


def validate_wire_document(schema: str, document: object) -> RedactionFailure | None:
    """Dispatch one corpus wire case to its native validator."""

    if schema == "capture-policy.schema.json":
        result = normalize_capture_policy(document)
        return result if isinstance(result, RedactionFailure) else None
    if schema == "payload-disposition.schema.json":
        return validate_disposition(document)
    if schema == "protected-value.schema.json":
        return validate_reference_document(document)
    if schema == "protected-blob.schema.json":
        blob = decode_blob_document(document)
        return blob if isinstance(blob, RedactionFailure) else None
    if schema == "protected-aad.schema.json":
        return validate_aad_document(document)
    if schema == "protected-store-envelope.schema.json":
        return validate_store_envelope_document(document)
    if schema == "event-v1alpha2.schema.json":
        return validate_event_shape(document)
    if schema == "checkpoint-v1alpha2.schema.json":
        return validate_checkpoint_shape(document)
    if schema == "capture-source.schema.json":
        return validate_source_class(document)
    if schema == "capture-sink.schema.json":
        return validate_sink(document)
    if schema == "redaction-rule.schema.json":
        rule = normalize_redaction_rule(document)
        return rule if isinstance(rule, RedactionFailure) else None
    if schema == "redaction-receipt.schema.json":
        return validate_receipt_document(document)
    if schema == "sink-guard-decision.schema.json":
        return validate_guard_decision_document(document)
    raise KeyError(f"no native validator for {schema!r}")


def wire_document_json(document: object) -> JsonValue:
    return document  # type: ignore[return-value]
