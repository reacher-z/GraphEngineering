"""The immutable effective capture policy and its canonical hash.

Section 4 freezes a closed object with a closed mode vocabulary, semantic rule
consistency, and one canonical hash.  Structural validation is followed by
semantic validation, and the complete policy must fail before its hash is
computed when any semantic rule is violated.
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Final, Literal, TypeAlias

from ..durable_json import durable_json_hash
from ..models import JsonValue
from .errors import RedactionFailure, failure
from .inventory import SINK_CLASSES, PolicyControl, sink_row
from .limits import (
    DEFAULT_LIMITS,
    MAX_POINTERS_PER_RULE,
    MAX_POLICY_UTF8_BYTES,
    MAX_REDACTION_RULES,
)
from .pointer import PointerSyntaxError, decode_pointer

CAPTURE_POLICY_API_VERSION: Final = (
    "graphengineering.reacher-z.github.io/capture-policy/v1alpha2"
)
REDACTION_RULE_API_VERSION: Final = (
    "graphengineering.reacher-z.github.io/redaction-rule/v1alpha2"
)
REDACTION_TRANSFORM: Final = "json-pointer-rules/v1alpha2"

_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
_KEY_REF = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$")
_MAX_SAFE_INTEGER: Final = 2**53 - 1

DurableMode: TypeAlias = Literal["protected", "inline-unredacted"]
EventsMode: TypeAlias = Literal["metadata-or-protected", "allow-redacted", "inline-unredacted"]
ErrorsMode: TypeAlias = Literal[
    "codes-only",
    "codes-and-sanitized-message",
    "redacted",
    "protected-evidence",
    "inline-unredacted",
]
ObservationalMode: TypeAlias = Literal[
    "off",
    "metadata-only",
    "redacted",
    "protected",
    "inline-unredacted",
]
IdentifiersMode: TypeAlias = Literal["generated-opaque-only", "protected", "inline-unredacted"]

_DURABLE_MODES: Final = ("protected", "inline-unredacted")
_EVENTS_MODES: Final = ("metadata-or-protected", "allow-redacted", "inline-unredacted")
_ERRORS_MODES: Final = (
    "codes-only",
    "codes-and-sanitized-message",
    "redacted",
    "protected-evidence",
    "inline-unredacted",
)
_OBSERVATIONAL_MODES: Final = ("off", "metadata-only", "redacted", "protected", "inline-unredacted")
_IDENTIFIER_MODES: Final = ("generated-opaque-only", "protected", "inline-unredacted")

# Field name -> closed mode vocabulary, in the order Section 4.1 prints them.
POLICY_FIELD_MODES: Final[dict[str, tuple[str, ...]]] = {
    "durableValues": _DURABLE_MODES,
    "checkpointValues": _DURABLE_MODES,
    "events": _EVENTS_MODES,
    "artifacts": _OBSERVATIONAL_MODES,
    "errors": _ERRORS_MODES,
    "logs": _OBSERVATIONAL_MODES,
    "traces": _OBSERVATIONAL_MODES,
    "metrics": _OBSERVATIONAL_MODES,
    "prompts": _OBSERVATIONAL_MODES,
    "responses": _OBSERVATIONAL_MODES,
    "tools": _OBSERVATIONAL_MODES,
    "mcp": _OBSERVATIONAL_MODES,
    "plugins": _OBSERVATIONAL_MODES,
    "isolationOutputs": _OBSERVATIONAL_MODES,
    "database": _OBSERVATIONAL_MODES,
    "exports": _OBSERVATIONAL_MODES,
    "supportBundles": _OBSERVATIONAL_MODES,
    "testArtifacts": _OBSERVATIONAL_MODES,
    "identifiers": _IDENTIFIER_MODES,
}

POLICY_REQUIRED_FIELDS: Final[tuple[str, ...]] = (
    "apiVersion",
    *POLICY_FIELD_MODES,
    "maxDiagnosticUtf8Bytes",
    "redactionTransform",
    "transformImplementationHash",
    "ruleRegistryVersion",
    "ruleRegistryHash",
    "redactionRules",
    "keyRef",
)

_SINK_ORDER: Final[dict[str, int]] = {sink: index for index, sink in enumerate(SINK_CLASSES)}

# ``deny`` is deliberately absent: it has no enabling policy mode in this version.
_CONTROL_ATTRIBUTES: Final[dict[str, str]] = {
    "durableValues": "durable_values",
    "checkpointValues": "checkpoint_values",
    "events": "events",
    "artifacts": "artifacts",
    "errors": "errors",
    "logs": "logs",
    "traces": "traces",
    "metrics": "metrics",
    "prompts": "prompts",
    "responses": "responses",
    "tools": "tools",
    "mcp": "mcp",
    "plugins": "plugins",
    "isolationOutputs": "isolation_outputs",
    "database": "database",
    "exports": "exports",
    "supportBundles": "support_bundles",
    "testArtifacts": "test_artifacts",
    "identifiers": "identifiers",
}


@dataclass(frozen=True, slots=True)
class RedactionRule:
    """One closed rule; at most one per sink."""

    rule_id: str
    registry_version: int
    sink: str
    paths: tuple[str, ...]
    replacement_mode: Literal["remove", "constant-token"]

    def as_document(self) -> dict[str, JsonValue]:
        return {
            "apiVersion": REDACTION_RULE_API_VERSION,
            "ruleId": self.rule_id,
            "registryVersion": self.registry_version,
            "sink": self.sink,
            "paths": list(self.paths),
            "replacementMode": self.replacement_mode,
        }


@dataclass(frozen=True, slots=True)
class CapturePolicy:
    """The normalized, immutable effective policy."""

    durable_values: DurableMode
    checkpoint_values: DurableMode
    events: EventsMode
    artifacts: ObservationalMode
    errors: ErrorsMode
    logs: ObservationalMode
    traces: ObservationalMode
    metrics: ObservationalMode
    prompts: ObservationalMode
    responses: ObservationalMode
    tools: ObservationalMode
    mcp: ObservationalMode
    plugins: ObservationalMode
    isolation_outputs: ObservationalMode
    database: ObservationalMode
    exports: ObservationalMode
    support_bundles: ObservationalMode
    test_artifacts: ObservationalMode
    identifiers: IdentifiersMode
    max_diagnostic_utf8_bytes: int
    transform_implementation_hash: str
    rule_registry_version: int
    rule_registry_hash: str
    redaction_rules: tuple[RedactionRule, ...]
    key_ref: str
    inline_risk_authorization_hash: str | None = None

    def mode(self, control: str) -> str:
        attribute = _CONTROL_ATTRIBUTES.get(control)
        if attribute is None:
            return "off"
        return str(getattr(self, attribute))

    def as_document(self) -> dict[str, JsonValue]:
        """Return the exact closed portable object that ``policy_hash`` covers."""

        document: dict[str, JsonValue] = {
            "apiVersion": CAPTURE_POLICY_API_VERSION,
            "durableValues": self.durable_values,
            "checkpointValues": self.checkpoint_values,
            "events": self.events,
            "artifacts": self.artifacts,
            "errors": self.errors,
            "logs": self.logs,
            "traces": self.traces,
            "metrics": self.metrics,
            "prompts": self.prompts,
            "responses": self.responses,
            "tools": self.tools,
            "mcp": self.mcp,
            "plugins": self.plugins,
            "isolationOutputs": self.isolation_outputs,
            "database": self.database,
            "exports": self.exports,
            "supportBundles": self.support_bundles,
            "testArtifacts": self.test_artifacts,
            "identifiers": self.identifiers,
            "maxDiagnosticUtf8Bytes": self.max_diagnostic_utf8_bytes,
            "redactionTransform": REDACTION_TRANSFORM,
            "transformImplementationHash": self.transform_implementation_hash,
            "ruleRegistryVersion": self.rule_registry_version,
            "ruleRegistryHash": self.rule_registry_hash,
            "redactionRules": [rule.as_document() for rule in self.redaction_rules],
            "keyRef": self.key_ref,
        }
        if self.inline_risk_authorization_hash is not None:
            document["inlineRiskAuthorizationHash"] = self.inline_risk_authorization_hash
        return document

    def rule_for_sink(self, sink: str) -> RedactionRule | None:
        for rule in self.redaction_rules:
            if rule.sink == sink:
                return rule
        return None

    def selects_inline(self) -> bool:
        return any(self.mode(control) == "inline-unredacted" for control in POLICY_FIELD_MODES)


def capture_policy_hash(policy: CapturePolicy) -> str:
    """``SHA-256(canonical UTF-8 JSON(TaggedDurableJSON(effectivePolicy)))``."""

    return durable_json_hash(policy.as_document())


def control_enabled(policy: CapturePolicy, control: PolicyControl) -> bool:
    """Whether the effective policy enables one named control.

    Section 4.1/1.2: a control is enabled when its selected mode permits any
    payload representation to reach the sink at all.  ``off``, ``codes-only``,
    and the ``deny`` pseudo-control are the only disabled modes in the closed
    vocabulary: codes-only means stable codes only, with no payload evidence in
    any form.  This is the TypeScript lane's ``controlEnabled`` verbatim.
    """

    if control == "deny":
        return False
    return policy.mode(control) not in ("off", "codes-only")


def policy_enabled_for(policy: CapturePolicy, source_class: str, sink: str) -> bool:
    """Section 1.2 ``policyEnabled`` for one classified pair.

    The source row's control and every control named by the sink row must be
    enabled.  The default-matrix condition is intersected in as well, because all
    applicable rows must allow the representation and no row may widen another.
    A pair outside the default matrix is enabled only when the effective policy
    explicitly widens it, and the widening formula — identical in the TypeScript
    lane's ``policyEnabledFor`` — is the union of the source row's control and
    every control named by the sink row: the pair is widened exactly when at
    least one control in that union selects a mode different from the Section
    4.1 default stable profile.  The source row's control matters because the
    operator lever the spec names for attempt-failure evidence,
    ``errors: "protected-evidence"``, is a mode of the *source* row's control.
    """

    from .inventory import source_row

    row = source_row(source_class)
    destination = sink_row(sink)
    if row is None or destination is None:
        return False
    # Section 1.2 default matrix. A pair that is off by default stays off until
    # the effective policy explicitly widens the union of its controls.
    if (not destination.default_enabled or row.default_action == "off") and not _explicitly_widened(
        policy, (row.policy_control, *destination.policy_controls)
    ):
        return False
    if not control_enabled(policy, row.policy_control):
        return False
    return all(control_enabled(policy, control) for control in destination.policy_controls)


def _explicitly_widened(policy: CapturePolicy, controls: Sequence[PolicyControl]) -> bool:
    default = default_stable_profile(
        transform_implementation_hash=policy.transform_implementation_hash,
        rule_registry_version=policy.rule_registry_version,
        rule_registry_hash=policy.rule_registry_hash,
        key_ref=policy.key_ref,
    )
    return any(policy.mode(control) != default.mode(control) for control in controls)


def default_stable_profile(
    *,
    transform_implementation_hash: str,
    rule_registry_version: int,
    rule_registry_hash: str,
    key_ref: str,
) -> CapturePolicy:
    """The Section 4.1 default stable profile."""

    return CapturePolicy(
        durable_values="protected",
        checkpoint_values="protected",
        events="metadata-or-protected",
        artifacts="off",
        errors="codes-and-sanitized-message",
        logs="metadata-only",
        traces="off",
        metrics="off",
        prompts="off",
        responses="off",
        tools="off",
        mcp="off",
        plugins="off",
        isolation_outputs="off",
        database="off",
        exports="off",
        support_bundles="off",
        test_artifacts="off",
        identifiers="generated-opaque-only",
        max_diagnostic_utf8_bytes=1024,
        transform_implementation_hash=transform_implementation_hash,
        rule_registry_version=rule_registry_version,
        rule_registry_hash=rule_registry_hash,
        redaction_rules=(),
        key_ref=key_ref,
    )


def normalize_capture_policy(document: object) -> CapturePolicy | RedactionFailure:
    """Validate one policy document structurally, then semantically.

    Returns the normalized immutable policy or one structured failure.  The hash
    is never computed for a policy that fails any rule.
    """

    if not isinstance(document, Mapping):
        return _invalid("apiVersion")
    keys = set(document.keys())
    allowed = set(POLICY_REQUIRED_FIELDS) | {"inlineRiskAuthorizationHash"}
    if not set(POLICY_REQUIRED_FIELDS) <= keys or not keys <= allowed:
        return _invalid("apiVersion")
    if document["apiVersion"] != CAPTURE_POLICY_API_VERSION:
        return _invalid("apiVersion")
    if document["redactionTransform"] != REDACTION_TRANSFORM:
        return _invalid("redactionTransform")

    modes: dict[str, str] = {}
    for field_name, vocabulary in POLICY_FIELD_MODES.items():
        value = document[field_name]
        if type(value) is not str or value not in vocabulary:
            return _invalid(field_name)
        modes[field_name] = value

    diagnostic = document["maxDiagnosticUtf8Bytes"]
    if type(diagnostic) is not int or not 0 <= diagnostic <= 1024:
        return _invalid("maxDiagnosticUtf8Bytes")
    for hash_field in ("transformImplementationHash", "ruleRegistryHash"):
        value = document[hash_field]
        if type(value) is not str or _SHA256.fullmatch(value) is None:
            return _invalid(hash_field)
    registry_version = document["ruleRegistryVersion"]
    if type(registry_version) is not int or not 1 <= registry_version <= _MAX_SAFE_INTEGER:
        return _invalid("ruleRegistryVersion")
    key_ref = document["keyRef"]
    if type(key_ref) is not str or _KEY_REF.fullmatch(key_ref) is None:
        return _invalid("keyRef")

    inline_selected = any(mode == "inline-unredacted" for mode in modes.values())
    inline_hash = document.get("inlineRiskAuthorizationHash")
    if inline_selected:
        if type(inline_hash) is not str or _SHA256.fullmatch(inline_hash) is None:
            # Section 4.3: inline capture requires a separately authenticated
            # risk authorization bound into the effective policy.
            return RedactionFailure(
                code="INLINE_CAPTURE_NOT_AUTHORIZED",
                phase="policy",
                detail={"field": "inlineRiskAuthorizationHash"},
            )
    elif inline_hash is not None:
        return _invalid("inlineRiskAuthorizationHash")

    rules_document = document["redactionRules"]
    if type(rules_document) is not list or len(rules_document) > MAX_REDACTION_RULES:
        return _invalid("redactionRules")
    rules: list[RedactionRule] = []
    for entry in rules_document:
        parsed = _normalize_rule(entry, registry_version)
        if isinstance(parsed, RedactionFailure):
            return parsed
        rules.append(parsed)

    ordering_failure = _validate_rule_set(rules, modes)
    if ordering_failure is not None:
        return ordering_failure

    policy = CapturePolicy(
        durable_values=modes["durableValues"],  # type: ignore[arg-type]
        checkpoint_values=modes["checkpointValues"],  # type: ignore[arg-type]
        events=modes["events"],  # type: ignore[arg-type]
        artifacts=modes["artifacts"],  # type: ignore[arg-type]
        errors=modes["errors"],  # type: ignore[arg-type]
        logs=modes["logs"],  # type: ignore[arg-type]
        traces=modes["traces"],  # type: ignore[arg-type]
        metrics=modes["metrics"],  # type: ignore[arg-type]
        prompts=modes["prompts"],  # type: ignore[arg-type]
        responses=modes["responses"],  # type: ignore[arg-type]
        tools=modes["tools"],  # type: ignore[arg-type]
        mcp=modes["mcp"],  # type: ignore[arg-type]
        plugins=modes["plugins"],  # type: ignore[arg-type]
        isolation_outputs=modes["isolationOutputs"],  # type: ignore[arg-type]
        database=modes["database"],  # type: ignore[arg-type]
        exports=modes["exports"],  # type: ignore[arg-type]
        support_bundles=modes["supportBundles"],  # type: ignore[arg-type]
        test_artifacts=modes["testArtifacts"],  # type: ignore[arg-type]
        identifiers=modes["identifiers"],  # type: ignore[arg-type]
        max_diagnostic_utf8_bytes=diagnostic,
        transform_implementation_hash=str(document["transformImplementationHash"]),
        rule_registry_version=registry_version,
        rule_registry_hash=str(document["ruleRegistryHash"]),
        redaction_rules=tuple(rules),
        key_ref=key_ref,
        inline_risk_authorization_hash=str(inline_hash) if inline_selected else None,
    )

    from ..canonical import canonical_bytes

    if len(canonical_bytes(policy.as_document())) > MAX_POLICY_UTF8_BYTES:
        return _invalid("apiVersion")
    return policy


def normalize_redaction_rule(
    entry: object,
    registry_version: int | None = None,
) -> RedactionRule | RedactionFailure:
    """Validate one closed rule document.

    ``registry_version`` defaults to the document's own value so a standalone
    rule can be validated outside a policy.
    """

    if isinstance(entry, Mapping) and registry_version is None:
        candidate = entry.get("registryVersion")
        registry_version = candidate if type(candidate) is int else 0
    return _normalize_rule(entry, registry_version if registry_version is not None else 0)


def _normalize_rule(entry: object, registry_version: int) -> RedactionRule | RedactionFailure:
    if not isinstance(entry, Mapping):
        return _invalid("redactionRules")
    expected_keys = {
        "apiVersion",
        "ruleId",
        "registryVersion",
        "sink",
        "paths",
        "replacementMode",
    }
    if set(entry.keys()) != expected_keys:
        return _invalid("redactionRules")
    if entry["apiVersion"] != REDACTION_RULE_API_VERSION:
        return _invalid("redactionRules")
    rule_id = entry["ruleId"]
    if type(rule_id) is not str or _IDENTIFIER.fullmatch(rule_id) is None:
        return _invalid("redactionRules")
    if entry["registryVersion"] != registry_version:
        # Every rule's registryVersion equals the policy snapshot version.
        return _invalid("redactionRules")
    sink = entry["sink"]
    if type(sink) is not str or sink_row(sink) is None:
        return _invalid("sink")
    replacement_mode = entry["replacementMode"]
    if replacement_mode not in ("remove", "constant-token"):
        return _invalid("redactionRules")
    paths = entry["paths"]
    if type(paths) is not list or not paths or len(paths) > MAX_POINTERS_PER_RULE:
        return _invalid("redactionRules")
    for index, path in enumerate(paths):
        try:
            decode_pointer(path, limits=DEFAULT_LIMITS)
        except PointerSyntaxError:
            return _invalid("redactionRules")
        if index and not paths[index - 1] < path:
            # Paths follow the receipt ordering rules: strictly increasing
            # normalized code-point order, never silently sorted.
            return _invalid("redactionRules")
    return RedactionRule(
        rule_id=rule_id,
        registry_version=registry_version,
        sink=sink,
        paths=tuple(str(path) for path in paths),
        replacement_mode=replacement_mode,
    )


def _validate_rule_set(
    rules: Sequence[RedactionRule],
    modes: Mapping[str, str],
) -> RedactionFailure | None:
    seen: set[str] = set()
    for rule in rules:
        if rule.sink in seen:
            return _invalid("redactionRules")
        seen.add(rule.sink)
    ordered = sorted(rules, key=lambda rule: (_SINK_ORDER[rule.sink], rule.rule_id))
    if [rule.sink for rule in rules] != [rule.sink for rule in ordered]:
        return _invalid("redactionRules")

    redacting_controls = {
        control
        for control, mode in modes.items()
        if mode == "redacted" or (control == "events" and mode == "allow-redacted")
    }
    for rule in rules:
        destination = sink_row(rule.sink)
        if destination is None:
            # A rule naming a sink outside the versioned inventory controls
            # nothing, so it can never be a valid redaction rule. Rejected
            # rather than asserted: an assertion is stripped under ``-O``.
            return _invalid("redactionRules")
        if not set(destination.policy_controls) & redacting_controls:
            # A rule is invalid for a sink whose mode is not redacted or
            # allow-redacted.
            return _invalid("redactionRules")
    for control in redacting_controls:
        if control == "events" and modes["events"] == "allow-redacted":
            # A redacted event derivative requires a rule only when one is
            # emitted; the policy alone cannot decide that.
            continue
        covered = False
        for rule in rules:
            row = sink_row(rule.sink)
            if row is None:
                # Unreachable: the loop above already rejected an unregistered
                # sink. Kept explicit so an unknown sink can never be read as
                # covering a redacting control.
                continue
            if control in row.policy_controls:
                covered = True
                break
        if not covered:
            # A redacted mode requires at least one matching rule.
            return _invalid("redactionRules")
    return None


def _invalid(field_name: str) -> RedactionFailure:
    return failure("REDACTION_POLICY_INVALID", "policy", field=field_name)
