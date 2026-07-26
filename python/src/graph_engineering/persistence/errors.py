"""Stable, serializable persistence failures."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from enum import StrEnum
from types import MappingProxyType
from typing import Any, Literal


class PersistenceErrorCode(StrEnum):
    VALIDATION = "PERSISTENCE_VALIDATION"
    UNSAFE_IDENTIFIER = "UNSAFE_IDENTIFIER"
    VERSION_CONFLICT = "VERSION_CONFLICT"
    CORRUPT_EVENT_LOG = "CORRUPT_EVENT_LOG"
    CORRUPT_CHECKPOINT = "CORRUPT_CHECKPOINT"
    IO = "PERSISTENCE_IO"


@dataclass(frozen=True, slots=True)
class ValidationIssue:
    path: str
    message: str


class PersistenceError(Exception):
    """Base error with a stable machine code and JSON-safe details."""

    def __init__(
        self,
        code: PersistenceErrorCode,
        message: str,
        details: Mapping[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.details = MappingProxyType(dict(details or {}))

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": type(self).__name__,
            "code": self.code.value,
            "message": str(self),
            "details": dict(self.details),
        }


class PersistenceValidationError(PersistenceError):
    def __init__(self, message: str, issues: Sequence[ValidationIssue]) -> None:
        self.issues = tuple(issues)
        super().__init__(
            PersistenceErrorCode.VALIDATION,
            message,
            {"issues": tuple({"path": item.path, "message": item.message} for item in issues)},
        )


class UnsafeIdentifierError(PersistenceError):
    def __init__(self, identifier_kind: Literal["runId", "checkpointId"], value: str) -> None:
        self.identifier_kind = identifier_kind
        super().__init__(
            PersistenceErrorCode.UNSAFE_IDENTIFIER,
            f"{identifier_kind} is not a safe persistence identifier",
            {"identifierKind": identifier_kind, "value": value},
        )
class VersionConflictError(PersistenceError):
    def __init__(self, run_id: str, expected_version: int, actual_version: int) -> None:
        self.run_id = run_id
        self.expected_version = expected_version
        self.actual_version = actual_version
        super().__init__(
            PersistenceErrorCode.VERSION_CONFLICT,
            (
                f"event stream {run_id!r} expected version {expected_version}, "
                f"but is at {actual_version}"
            ),
            {
                "runId": run_id,
                "expectedVersion": expected_version,
                "actualVersion": actual_version,
            },
        )


class CorruptEventLogError(PersistenceError):
    def __init__(self, run_id: str, reason: str, line: int | None = None) -> None:
        details: dict[str, Any] = {"runId": run_id, "reason": reason}
        if line is not None:
            details["line"] = line
        super().__init__(
            PersistenceErrorCode.CORRUPT_EVENT_LOG,
            f"event log {run_id!r} is corrupt: {reason}",
            details,
        )


class CorruptCheckpointError(PersistenceError):
    def __init__(self, run_id: str, checkpoint_id: str, reason: str) -> None:
        super().__init__(
            PersistenceErrorCode.CORRUPT_CHECKPOINT,
            f"checkpoint {run_id!r}/{checkpoint_id!r} is corrupt: {reason}",
            {"runId": run_id, "checkpointId": checkpoint_id, "reason": reason},
        )


class PersistenceIOError(PersistenceError):
    def __init__(self, operation: str, path: str, cause: BaseException) -> None:
        self.cause = cause
        super().__init__(
            PersistenceErrorCode.IO,
            f"persistence {operation} failed",
            {"operation": operation, "path": path, "causeName": type(cause).__name__},
        )
