"""Stable validation failures for model-free orchestration primitives."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal, TypeAlias

from ..models import JsonObject, JsonValue
from ._serialization import compact_json

PrimitiveErrorCode: TypeAlias = Literal["PRIMITIVE_VALIDATION"]
PrimitiveValidationIssueCode: TypeAlias = Literal[
    "TYPE",
    "REQUIRED",
    "UNKNOWN_FIELD",
    "UNSAFE_ID",
    "DUPLICATE_ID",
    "INVALID_STATUS",
    "STATUS_VALUE_MISMATCH",
    "INVALID_JSON",
    "INVALID_POLICY",
    "DUPLICATE_SELECTION",
    "INVALID_CONFIDENCE",
    "CONFIDENCE_CONFIGURATION",
]


@dataclass(frozen=True, slots=True)
class PrimitiveValidationIssue:
    """One deterministic validation issue detached from caller input."""

    path: str
    code: PrimitiveValidationIssueCode
    message: str

    def to_dict(self) -> JsonObject:
        return {"path": self.path, "code": self.code, "message": self.message}


class PrimitiveValidationError(ValueError):
    """Stable, serializable settled-barrier validation failure."""

    __slots__ = ("_issues", "_message")

    def __init__(
        self,
        issues: Sequence[PrimitiveValidationIssue],
        *,
        message: str = "Settled barrier input is invalid",
    ) -> None:
        self._message = message
        self._issues = tuple(issues)
        super().__init__(self._message)

    @property
    def name(self) -> Literal["PrimitiveValidationError"]:
        return "PrimitiveValidationError"

    @property
    def code(self) -> Literal["PRIMITIVE_VALIDATION"]:
        return "PRIMITIVE_VALIDATION"

    @property
    def message(self) -> str:
        return self._message

    @property
    def issues(self) -> tuple[PrimitiveValidationIssue, ...]:
        return self._issues

    def to_dict(self) -> JsonObject:
        serialized_issues: list[JsonValue] = [issue.to_dict() for issue in self.issues]
        return {
            "name": self.name,
            "code": self.code,
            "message": self.message,
            "issues": serialized_issues,
        }

    def to_json(self) -> str:
        return compact_json(self.to_dict())

    def to_json_bytes(self) -> bytes:
        return self.to_json().encode("utf-8")
