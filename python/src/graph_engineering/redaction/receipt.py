"""The bound redaction receipt of Section 3.3.

A receipt is proof of one exact transform occurrence.  It is constructed only
from a completed transform, and it is accepted only when the guard
deterministically replays that transform from the immutable pre-transform
snapshot and byte-compares the canonical result.  A caller-provided boolean or a
receipt without that comparison is not proof of redaction.
"""

from __future__ import annotations

import hashlib
import hmac
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Final, Literal, TypeAlias

from ..canonical import canonical_bytes
from ..models import JsonValue
from .errors import RedactionFailure, failure
from .inventory import (
    NEVER_REDACTABLE_SINKS,
    NEVER_REDACTABLE_SOURCE_CLASSES,
    sink_row,
    source_row,
)
from .limits import DEFAULT_LIMITS, MAX_POINTERS_PER_RULE, PortableLimits
from .pointer import (
    PointerSyntaxError,
    PointerTransformResult,
    apply_pointer_transform,
    decode_pointer,
)
from .policy import RedactionRule
from .protect import canonical_tagged

REDACTION_RECEIPT_API_VERSION: Final = (
    "graphengineering.reacher-z.github.io/redaction-receipt/v1alpha2"
)
REDACTION_TRANSFORM: Final = "json-pointer-rules/v1alpha2"
SOURCE_DOMAIN: Final = "redaction-source/v1alpha2"
RESULT_DOMAIN: Final = "redaction-result/v1alpha2"

_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
_TIMESTAMP = re.compile(
    r"^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])"
    r"T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$"
)

OccurrenceKind: TypeAlias = Literal["event", "checkpoint", "sink-write"]
_OCCURRENCE_KINDS: Final = ("event", "checkpoint", "sink-write")

RECEIPT_REQUIRED_FIELDS: Final[tuple[str, ...]] = (
    "apiVersion",
    "policyHash",
    "sourceHash",
    "resultHash",
    "ruleSetHash",
    "transform",
    "transformImplementationHash",
    "ruleRegistryHash",
    "ruleRegistryVersion",
    "ruleResolutionId",
    "authorityBindingHash",
    "tenantScopeHash",
    "sourceClass",
    "sink",
    "decisionId",
    "runId",
    "graphRevision",
    "occurrenceKind",
    "occurrenceId",
    "occurrenceSequence",
    "occurredAt",
    "fieldPath",
    "paths",
    "replacementMode",
    "count",
)


@dataclass(frozen=True, slots=True)
class TransformOccurrence:
    """The write context a receipt must equal exactly."""

    source_class: str
    sink: str
    decision_id: str
    run_id: str
    graph_revision: int
    occurrence_kind: OccurrenceKind
    occurrence_id: str
    occurrence_sequence: int
    occurred_at: str
    field_path: str


@dataclass(frozen=True, slots=True)
class RedactionReceipt:
    """The closed proof object."""

    policy_hash: str
    source_hash: str
    result_hash: str
    rule_set_hash: str
    transform_implementation_hash: str
    rule_registry_hash: str
    rule_registry_version: int
    rule_resolution_id: str
    authority_binding_hash: str
    tenant_scope_hash: str
    occurrence: TransformOccurrence
    paths: tuple[str, ...]
    replacement_mode: Literal["remove", "constant-token"]

    @property
    def count(self) -> int:
        return len(self.paths)

    def as_document(self) -> dict[str, JsonValue]:
        return {
            "apiVersion": REDACTION_RECEIPT_API_VERSION,
            "policyHash": self.policy_hash,
            "sourceHash": self.source_hash,
            "resultHash": self.result_hash,
            "ruleSetHash": self.rule_set_hash,
            "transform": REDACTION_TRANSFORM,
            "transformImplementationHash": self.transform_implementation_hash,
            "ruleRegistryHash": self.rule_registry_hash,
            "ruleRegistryVersion": self.rule_registry_version,
            "ruleResolutionId": self.rule_resolution_id,
            "authorityBindingHash": self.authority_binding_hash,
            "tenantScopeHash": self.tenant_scope_hash,
            "sourceClass": self.occurrence.source_class,
            "sink": self.occurrence.sink,
            "decisionId": self.occurrence.decision_id,
            "runId": self.occurrence.run_id,
            "graphRevision": self.occurrence.graph_revision,
            "occurrenceKind": self.occurrence.occurrence_kind,
            "occurrenceId": self.occurrence.occurrence_id,
            "occurrenceSequence": self.occurrence.occurrence_sequence,
            "occurredAt": self.occurrence.occurred_at,
            "fieldPath": self.occurrence.field_path,
            "paths": list(self.paths),
            "replacementMode": self.replacement_mode,
            "count": self.count,
        }


def rule_set_hash(rules: Sequence[RedactionRule]) -> str:
    """SHA-256 of canonical Tagged Durable JSON for the ordered resolved rules."""

    ordered: list[JsonValue] = [
        {
            "ruleId": rule.rule_id,
            "registryVersion": rule.registry_version,
            "sink": rule.sink,
            "paths": list(rule.paths),
            "replacementMode": rule.replacement_mode,
        }
        for rule in rules
    ]
    return hashlib.sha256(canonical_tagged(ordered)).hexdigest()


def source_hash(
    identity_key: bytes,
    *,
    source_class: str,
    sink: str,
    field_path: str,
    source_snapshot: JsonValue,
) -> str:
    return hmac.new(
        identity_key,
        canonical_tagged([SOURCE_DOMAIN, source_class, sink, field_path, source_snapshot]),
        hashlib.sha256,
    ).hexdigest()


def result_hash(
    identity_key: bytes,
    *,
    source_class: str,
    sink: str,
    field_path: str,
    transformed: JsonValue,
) -> str:
    return hmac.new(
        identity_key,
        canonical_tagged([RESULT_DOMAIN, source_class, sink, field_path, transformed]),
        hashlib.sha256,
    ).hexdigest()


def validate_receipt_document(
    document: object,
    *,
    limits: PortableLimits = DEFAULT_LIMITS,
) -> RedactionFailure | None:
    """Closed structural plus semantic receipt validation."""

    invalid = _receipt_invalid
    if not isinstance(document, Mapping):
        return invalid()
    if set(document.keys()) != set(RECEIPT_REQUIRED_FIELDS):
        return invalid()
    if document["apiVersion"] != REDACTION_RECEIPT_API_VERSION:
        return invalid()
    if document["transform"] != REDACTION_TRANSFORM:
        return invalid()
    for field_name in (
        "policyHash",
        "sourceHash",
        "resultHash",
        "ruleSetHash",
        "transformImplementationHash",
        "ruleRegistryHash",
        "authorityBindingHash",
        "tenantScopeHash",
    ):
        value = document[field_name]
        if type(value) is not str or _SHA256.fullmatch(value) is None:
            return invalid()
    for field_name in ("ruleResolutionId", "decisionId", "runId", "occurrenceId"):
        value = document[field_name]
        if type(value) is not str or _IDENTIFIER.fullmatch(value) is None:
            return invalid()
    for field_name, minimum in (("ruleRegistryVersion", 1), ("graphRevision", 1)):
        value = document[field_name]
        if type(value) is not int or value < minimum:
            return invalid()
    sequence = document["occurrenceSequence"]
    if type(sequence) is not int or sequence < 0:
        return invalid()
    occurred_at = document["occurredAt"]
    if type(occurred_at) is not str or _TIMESTAMP.fullmatch(occurred_at) is None:
        return invalid()
    if document["occurrenceKind"] not in _OCCURRENCE_KINDS:
        return invalid()
    if document["replacementMode"] not in ("remove", "constant-token"):
        return invalid()

    source_class = document["sourceClass"]
    if type(source_class) is not str or source_row(source_class) is None:
        return invalid()
    if source_class in NEVER_REDACTABLE_SOURCE_CLASSES:
        # Section 2.2: redacted data can never be authoritative.
        return invalid()
    sink = document["sink"]
    if type(sink) is not str or sink_row(sink) is None:
        return invalid()
    if sink in NEVER_REDACTABLE_SINKS:
        # Section 2.3: encryption is not redaction.
        return invalid()

    field_path = document["fieldPath"]
    try:
        decode_pointer(field_path, limits=limits)
    except PointerSyntaxError:
        return invalid()

    paths = document["paths"]
    if type(paths) is not list or not paths or len(paths) > MAX_POINTERS_PER_RULE:
        return invalid()
    for index, path in enumerate(paths):
        try:
            decode_pointer(path, limits=limits)
        except PointerSyntaxError:
            return invalid()
        if index and not paths[index - 1] < path:
            # Strictly increasing Unicode code-point order after normalization.
            return invalid()
    if document["count"] != len(paths):
        return invalid()
    return None


def build_receipt(
    *,
    identity_key: bytes,
    policy_hash: str,
    transform_implementation_hash: str,
    rule_registry_hash: str,
    rule_registry_version: int,
    rule_resolution_id: str,
    authority_binding_hash: str,
    tenant_scope_hash: str,
    occurrence: TransformOccurrence,
    rules: Sequence[RedactionRule],
    source_snapshot: JsonValue,
    transformed: JsonValue,
    paths: Sequence[str],
    replacement_mode: Literal["remove", "constant-token"],
) -> RedactionReceipt:
    """Construct the receipt from a completed transform."""

    return RedactionReceipt(
        policy_hash=policy_hash,
        source_hash=source_hash(
            identity_key,
            source_class=occurrence.source_class,
            sink=occurrence.sink,
            field_path=occurrence.field_path,
            source_snapshot=source_snapshot,
        ),
        result_hash=result_hash(
            identity_key,
            source_class=occurrence.source_class,
            sink=occurrence.sink,
            field_path=occurrence.field_path,
            transformed=transformed,
        ),
        rule_set_hash=rule_set_hash(rules),
        transform_implementation_hash=transform_implementation_hash,
        rule_registry_hash=rule_registry_hash,
        rule_registry_version=rule_registry_version,
        rule_resolution_id=rule_resolution_id,
        authority_binding_hash=authority_binding_hash,
        tenant_scope_hash=tenant_scope_hash,
        occurrence=occurrence,
        paths=tuple(paths),
        replacement_mode=replacement_mode,
    )


def verify_receipt(
    receipt: RedactionReceipt,
    *,
    identity_key: bytes,
    source_snapshot: JsonValue,
    persisted_result: JsonValue,
    occurrence: TransformOccurrence,
    limits: PortableLimits = DEFAULT_LIMITS,
) -> RedactionFailure | None:
    """Deterministically replay the transform and byte-compare the result.

    Changing source, result, rule order, registry, transform identity,
    authority, tenant, sink, occurrence, timestamp, or field path while retaining
    an old receipt yields ``REDACTION_RECEIPT_INVALID``.
    """

    structural = validate_receipt_document(receipt.as_document(), limits=limits)
    if structural is not None:
        return structural
    if receipt.occurrence != occurrence:
        return _receipt_invalid()

    replayed = apply_pointer_transform(
        source_snapshot,
        list(receipt.paths),
        receipt.replacement_mode,
        limits=limits,
    )
    if not isinstance(replayed, PointerTransformResult):
        return replayed.failure
    if canonical_bytes(replayed.output) != canonical_bytes(persisted_result):
        return _receipt_invalid()

    expected_source = source_hash(
        identity_key,
        source_class=occurrence.source_class,
        sink=occurrence.sink,
        field_path=occurrence.field_path,
        source_snapshot=source_snapshot,
    )
    expected_result = result_hash(
        identity_key,
        source_class=occurrence.source_class,
        sink=occurrence.sink,
        field_path=occurrence.field_path,
        transformed=replayed.output,
    )
    if not hmac.compare_digest(expected_source, receipt.source_hash):
        return _receipt_invalid()
    if not hmac.compare_digest(expected_result, receipt.result_hash):
        return _receipt_invalid()
    return None


def _receipt_invalid() -> RedactionFailure:
    return failure("REDACTION_RECEIPT_INVALID", "receipt")
