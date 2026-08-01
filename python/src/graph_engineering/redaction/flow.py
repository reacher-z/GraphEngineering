"""The deterministic ``source-sink-intersection/v1alpha1`` evaluator.

Section 1.2 and Section 7 require the guard to perform a total source x sink
evaluation before representation selection: locate the unique 57-source row and
54-sink row, verify the row's named policy control, deny every unknown or missing
row, then intersect source disposition, policy enablement, and sink acceptance
without promotion.  The domain is 3,078 pairs even though the implementation is a
table join rather than a materialized file.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final, Literal, TypeAlias

from .errors import RedactionFailure, failure
from .inventory import (
    CARTESIAN_PAIR_COUNT,
    SINK_CLASSES,
    SOURCE_CLASSES,
    sink_row,
    source_row,
)

ALGORITHM: Final = "source-sink-intersection/v1alpha1"

SOURCE_RULE_COUNT: Final = len(SOURCE_CLASSES)
SINK_RULE_COUNT: Final = len(SINK_CLASSES)
CARTESIAN_PRODUCT_COUNT: Final = CARTESIAN_PAIR_COUNT

FlowOutcome: TypeAlias = Literal[
    "suppressed",
    "metadata-only",
    "protected-ref",
    "failed",
]


@dataclass(frozen=True, slots=True)
class FlowDecision:
    """One evaluator result.

    ``identifier_replacement_required`` records the mandated opaque replacement
    for a caller-controlled identifier: the host replaces the identifier and
    protects the original before persistence.
    """

    outcome: FlowOutcome
    write_authorized: bool
    identifier_replacement_required: bool = False
    failure: RedactionFailure | None = None


def evaluate_flow(
    source_class: object,
    sink: object,
    policy_control: object,
    *,
    policy_enabled: bool,
    known_source: bool | None = None,
    known_sink: bool | None = None,
    known_control: bool | None = None,
) -> FlowDecision:
    """Evaluate one classified source/sink pair.

    ``known_*`` default to inventory membership.  They are accepted explicitly so
    a caller can model a future enum member that this version has not adopted;
    the answer is denial either way.
    """

    row = source_row(source_class) if type(source_class) is str else None
    destination = sink_row(sink) if type(sink) is str else None

    if known_source is None:
        known_source = row is not None
    if known_sink is None:
        known_sink = destination is not None

    if not known_source or row is None:
        return _failed("sourceClass", str(source_class) if type(source_class) is str else "")
    if not known_sink or destination is None:
        return _failed("sink", str(sink) if type(sink) is str else "")

    # Section 7: the guard locates the sink row and then verifies *the row's*
    # named policy control.  Global vocabulary membership is not the test: a
    # control this version knows about but which this sink does not own is not a
    # control for this write, and `spec/conformance/redaction.validate.mjs`
    # refuses to accept a flow case whose control the named sink does not
    # declare.  Membership of the closed vocabulary is implied, because every
    # sink-declared control is a vocabulary member.
    control_known = type(policy_control) is str and policy_control in destination.policy_controls
    if known_control is None:
        known_control = control_known

    if not known_control or not control_known:
        return _failed("policyControl", str(policy_control) if type(policy_control) is str else "")

    # The mandated opaque replacement for a caller-controlled identifier is a
    # property of the source row alone. It is reported even when the write is
    # suppressed, because the host must still replace the identifier.
    identifier_replacement = (
        row.identifier_treatment == "replace-with-runtime-opaque-and-protect-original"
    )

    # A source whose own control is ``deny`` has no enabling policy mode in this
    # version and can never be widened by a sink row.
    if row.policy_control == "deny" or not policy_enabled:
        return FlowDecision(
            outcome="suppressed",
            write_authorized=False,
            identifier_replacement_required=identifier_replacement,
        )

    if row.default_action == "metadata-only-allowlist":
        requested: FlowOutcome = "metadata-only"
    else:
        # Both ``off`` (now explicitly enabled) and ``protected-ref`` sources
        # request protection. There is no promotion and no fallback.
        requested = "protected-ref"

    if requested == "protected-ref" and not destination.accepts_protected:
        return FlowDecision(
            outcome="suppressed",
            write_authorized=False,
            identifier_replacement_required=identifier_replacement,
        )
    if requested == "metadata-only" and not destination.accepts_metadata:
        return FlowDecision(
            outcome="suppressed",
            write_authorized=False,
            identifier_replacement_required=identifier_replacement,
        )

    return FlowDecision(
        outcome=requested,
        write_authorized=True,
        identifier_replacement_required=identifier_replacement,
    )


def default_matrix_policy_enabled(source_class: str, sink: str) -> bool:
    """Policy enablement for the default profile.

    Section 1.2: for the default matrix, ``policyEnabled`` is true only when the
    sink's ``defaultEnabled`` is true and the source's ``defaultAction`` is not
    ``off``.
    """

    row = source_row(source_class)
    destination = sink_row(sink)
    if row is None or destination is None:
        return False
    return destination.default_enabled and row.default_action != "off"


def _failed(field: str, observed: str) -> FlowDecision:
    detail: dict[str, str] = {"field": field}
    if field == "sourceClass" and observed:
        # Only an inventory member is ever echoed; an unknown class name is
        # caller-derived text and is deliberately omitted.
        detail = {"field": field}
    return FlowDecision(
        outcome="failed",
        write_authorized=False,
        failure=failure("REDACTION_POLICY_INVALID", "classification", **detail),
    )
