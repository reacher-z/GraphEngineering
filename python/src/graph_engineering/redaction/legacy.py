"""Section 9 legacy detection. Silent repair is forbidden.

A ``scheduler-recovery/v1alpha1`` history that claims or defaults to
``redacted: true`` over an inline payload is a misleading history.  Detection
happens before ``RunResumed``, before append, and before any executor
invocation, and a terminal stream is not exempt.

Nothing in this module rewrites, scrubs, truncates, or reinterprets the original
bytes.  Section 9.2 forbids flipping a flag in place, adding a default and
reinterpreting old bytes as protected, recomputing hashes and rewriting JSONL,
scrubbing the original history, copying a nonterminal stream under a new run ID
while retaining refs or activity keys, and automatically resuming externally
effectful work.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Final, Literal, TypeAlias

from ..models import JsonValue
from .errors import RedactionFailure, failure

CONTRACT_VERSION_V1ALPHA1: Final = "scheduler-recovery/v1alpha1"

InlineShape: TypeAlias = Literal["input", "output", "result", "failure", "checkpoint"]

INLINE_SHAPES: Final[tuple[InlineShape, ...]] = (
    "input",
    "output",
    "result",
    "failure",
    "checkpoint",
)

RedactedField: TypeAlias = Literal["true", "false", "absent"]

REDACTED_FIELDS: Final[tuple[RedactedField, ...]] = ("true", "false", "absent")

LegacyAuthorization: TypeAlias = Literal["none", "unsafe-inspect", "migration"]

LegacyAction: TypeAlias = Literal[
    "reject",
    "unsafe-read-only",
    "quarantine",
    "sealed-archive",
    "new-run",
]

# Section 9.1: the known inline payload shapes, by event type and data field.
KNOWN_INLINE_EVENT_FIELDS: Final[dict[str, tuple[str, ...]]] = {
    "RunCreated": ("input",),
    "NodeScheduled": ("input",),
    "NodeSucceeded": ("output",),
    "NodeAttemptFailed": ("failure",),
    "NodeSettledWithoutAttempt": ("result",),
    "RunCancelled": ("result",),
    "RunFailed": ("result",),
    "RunSucceeded": ("result",),
}

_INLINE_FAILURE_MEMBERS: Final[tuple[str, ...]] = ("message", "causeName")


@dataclass(frozen=True, slots=True)
class LegacyDisposition:
    """One detection result for a legacy history or record."""

    action: LegacyAction
    failure: RedactionFailure | None = None
    executor_calls: int = 0
    source_rewritten: bool = False


def event_carries_inline_payload(event: Mapping[str, JsonValue]) -> bool:
    """Whether a v1alpha1 event document carries a known inline payload shape."""

    event_type = event.get("type")
    if type(event_type) is not str:
        return False
    fields = KNOWN_INLINE_EVENT_FIELDS.get(event_type)
    if not fields:
        return False
    data = event.get("data")
    if not isinstance(data, Mapping):
        return False
    for field_name in fields:
        if field_name not in data:
            continue
        if field_name != "failure":
            return True
        member = data["failure"]
        if isinstance(member, Mapping) and any(
            name in member for name in _INLINE_FAILURE_MEMBERS
        ):
            return True
    return False


def redacted_field_state(event: Mapping[str, JsonValue]) -> RedactedField:
    """Absence remains absence: no default is applied while reading."""

    if "redacted" not in event:
        return "absent"
    value = event["redacted"]
    if value is True:
        return "true"
    if value is False:
        return "false"
    return "absent"


def classify_history(
    events: Sequence[Mapping[str, JsonValue]],
    *,
    contract_version: str = CONTRACT_VERSION_V1ALPHA1,
    terminal: bool = False,
    authorization: LegacyAuthorization = "none",
) -> LegacyDisposition | None:
    """Classify a v1alpha1 history before ``RunResumed`` and before any executor.

    ``None`` means the history carries no known misleading or inline shape and
    the ordinary recovery path may continue.
    """

    if contract_version != CONTRACT_VERSION_V1ALPHA1:
        return None
    misleading = False
    truthful_inline = False
    for event in events:
        if not event_carries_inline_payload(event):
            continue
        state = redacted_field_state(event)
        if state in ("true", "absent"):
            misleading = True
        else:
            truthful_inline = True
    if misleading:
        return classify_record(
            redacted_field="true",
            inline_shape="input",
            terminal=terminal,
            authorization=authorization,
        )
    if truthful_inline:
        return classify_record(
            redacted_field="false",
            inline_shape="input",
            terminal=terminal,
            authorization=authorization,
        )
    return None


def classify_record(
    *,
    redacted_field: RedactedField,
    inline_shape: InlineShape,
    terminal: bool,
    authorization: LegacyAuthorization,
) -> LegacyDisposition:
    """The declarative field x shape x terminal x authorization matrix."""

    if redacted_field in ("true", "absent"):
        # A misleading history is rejected regardless of shape or terminality.
        # With migration authority the same detection selects quarantine, which
        # preserves the original bytes read-only rather than repairing them.
        mismatch = failure(
            "LEGACY_REDACTION_MISMATCH",
            "classification",
            contractVersion=CONTRACT_VERSION_V1ALPHA1,
        )
        if authorization == "migration":
            return LegacyDisposition(action="quarantine", failure=mismatch)
        return LegacyDisposition(action="reject", failure=mismatch)

    # ``redacted: false`` is truthful but still unsafe.
    if authorization == "migration":
        if terminal:
            return LegacyDisposition(action="sealed-archive")
        return LegacyDisposition(action="new-run")
    if authorization == "unsafe-inspect" and terminal:
        return LegacyDisposition(action="unsafe-read-only")
    return LegacyDisposition(
        action="reject",
        failure=failure(
            "INLINE_CAPTURE_NOT_AUTHORIZED",
            "policy",
            contractVersion=CONTRACT_VERSION_V1ALPHA1,
        ),
    )
