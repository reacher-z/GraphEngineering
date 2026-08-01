"""The Section 3.2 payload-disposition truth table.

``redacted`` is a fact about the bytes in *this* record.  The table below is the
whole contract: a protected reference is not redacted, a redacted record needs a
valid receipt, and a receipt on any other disposition is invalid.  Nothing here
consults a producer's boolean.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Final, Literal, TypeAlias

from ..models import JsonValue
from .errors import RedactionFailure, failure
from .inventory import NEVER_REDACTABLE_SOURCE_CLASSES
from .receipt import validate_receipt_document

PayloadDisposition: TypeAlias = Literal[
    "metadata-only",
    "protected-ref",
    "redacted",
    "inline-unredacted",
]

PAYLOAD_DISPOSITIONS: Final[tuple[PayloadDisposition, ...]] = (
    "metadata-only",
    "protected-ref",
    "redacted",
    "inline-unredacted",
)

# Section 3.2: the complete set of valid (disposition, redacted) pairs and
# whether the disposition requires a receipt.
DISPOSITION_TRUTH_TABLE: Final[dict[PayloadDisposition, tuple[bool, bool]]] = {
    # disposition: (redacted, receipt required)
    "metadata-only": (False, False),
    "protected-ref": (False, False),
    "redacted": (True, True),
    "inline-unredacted": (False, False),
}

# The default stable profile permits only these two on a durable record.
DEFAULT_PROFILE_ALLOWED: Final[frozenset[PayloadDisposition]] = frozenset(
    {"metadata-only", "protected-ref"}
)

# Redaction is observational only.
OBSERVATIONAL_ONLY: Final[frozenset[PayloadDisposition]] = frozenset({"redacted"})

# Denied by the default profile; Section 4.3 requires explicit authorization.
DENIED_BY_DEFAULT: Final[frozenset[PayloadDisposition]] = frozenset({"inline-unredacted"})


@dataclass(frozen=True, slots=True)
class DispositionFacts:
    """The two required facts, plus the conditional receipt."""

    payload_disposition: PayloadDisposition
    redacted: bool
    redaction_receipt: Mapping[str, JsonValue] | None = None

    def as_document(self) -> dict[str, JsonValue]:
        document: dict[str, JsonValue] = {
            "payloadDisposition": self.payload_disposition,
            "redacted": self.redacted,
        }
        if self.redaction_receipt is not None:
            document["redactionReceipt"] = dict(self.redaction_receipt)
        return document


def validate_disposition(
    document: object,
    *,
    source_class: str | None = None,
) -> RedactionFailure | None:
    """Validate one disposition/redacted pair against the truth table.

    ``source_class`` is optional; when supplied, an authoritative class combined
    with ``redacted`` is rejected because redacted data can never be
    authoritative.
    """

    if not isinstance(document, Mapping):
        return _invalid()
    keys = set(document.keys())
    if not {"payloadDisposition", "redacted"} <= keys:
        return _invalid()
    if not keys <= {"payloadDisposition", "redacted", "redactionReceipt"}:
        return _invalid()

    disposition = document["payloadDisposition"]
    if disposition not in DISPOSITION_TRUTH_TABLE:
        return _invalid()
    expected_redacted, receipt_required = DISPOSITION_TRUTH_TABLE[disposition]

    redacted = document["redacted"]
    if type(redacted) is not bool or redacted != expected_redacted:
        # `protected-ref` with `redacted: true` and `redacted` with
        # `redacted: false` are both invalid.
        return _invalid()

    receipt = document.get("redactionReceipt")
    if receipt_required:
        if receipt is None:
            # `redacted: true` without a valid receipt is invalid.
            return _invalid()
        receipt_failure = validate_receipt_document(receipt)
        if receipt_failure is not None:
            return receipt_failure
    elif receipt is not None:
        # A receipt on any other disposition is invalid.
        return _invalid()

    if (
        disposition == "redacted"
        and source_class is not None
        and source_class in NEVER_REDACTABLE_SOURCE_CLASSES
    ):
        return _invalid()
    return None


def disposition_for_outcome(outcome: str) -> PayloadDisposition | None:
    """Map a guard outcome onto the disposition it must persist."""

    if outcome in PAYLOAD_DISPOSITIONS:
        return outcome
    return None


def _invalid() -> RedactionFailure:
    return failure("REDACTION_RECEIPT_INVALID", "receipt")
