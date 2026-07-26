"""Deterministic evaluation of already-settled work items."""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Literal, TypeAlias, TypedDict, TypeGuard, cast

from ..models import MAX_SAFE_INTEGER, JsonObject, JsonValue
from ._numbers import portable_integer
from ._serialization import compact_json
from .errors import (
    PrimitiveValidationError,
    PrimitiveValidationIssue,
    PrimitiveValidationIssueCode,
)

SettledStatus: TypeAlias = Literal["succeeded", "failed", "missing", "timed_out"]
SettledBarrierReasonCode: TypeAlias = Literal[
    "NO_ITEMS",
    "ALL_SUCCEEDED",
    "ALL_NOT_SUCCEEDED",
    "MINIMUM_MET",
    "MINIMUM_NOT_MET",
    "MINIMUM_EXCEEDS_TOTAL",
    "PERCENTAGE_MET",
    "PERCENTAGE_NOT_MET",
]
_PolicyKind: TypeAlias = Literal["all", "minimum", "percentage"]


class SucceededSettledItem(TypedDict):
    id: str
    status: Literal["succeeded"]
    value: JsonValue


class UnsuccessfulSettledItem(TypedDict):
    id: str
    status: Literal["failed", "missing", "timed_out"]


SettledItem: TypeAlias = SucceededSettledItem | UnsuccessfulSettledItem


class AllBarrierPolicy(TypedDict):
    kind: Literal["all"]


class MinimumBarrierPolicy(TypedDict):
    kind: Literal["minimum"]
    minimum: int | float


class PercentageBarrierPolicy(TypedDict):
    kind: Literal["percentage"]
    basisPoints: int | float


SettledBarrierPolicy: TypeAlias = (
    AllBarrierPolicy | MinimumBarrierPolicy | PercentageBarrierPolicy
)

_SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
_ITEM_FIELDS = frozenset({"id", "status", "value"})
_STATUSES = frozenset({"succeeded", "failed", "missing", "timed_out"})


@dataclass(frozen=True, slots=True)
class SettledBarrierResult:
    """Immutable barrier result with an exact TypeScript-compatible export."""

    satisfied: bool
    reason_code: SettledBarrierReasonCode
    total: int
    succeeded: int
    failed: int
    missing: int
    timed_out: int
    accepted_ids: tuple[str, ...]
    failed_ids: tuple[str, ...]
    missing_ids: tuple[str, ...]
    timed_out_ids: tuple[str, ...]

    def to_dict(self) -> JsonObject:
        return {
            "satisfied": self.satisfied,
            "reasonCode": self.reason_code,
            "total": self.total,
            "succeeded": self.succeeded,
            "failed": self.failed,
            "missing": self.missing,
            "timedOut": self.timed_out,
            "acceptedIds": list(self.accepted_ids),
            "failedIds": list(self.failed_ids),
            "missingIds": list(self.missing_ids),
            "timedOutIds": list(self.timed_out_ids),
        }

    def to_json(self) -> str:
        return compact_json(self.to_dict())

    def to_json_bytes(self) -> bytes:
        return self.to_json().encode("utf-8")


@dataclass(frozen=True, slots=True)
class _ValidatedItem:
    id: str
    status: SettledStatus


@dataclass(frozen=True, slots=True)
class _ValidatedPolicy:
    kind: _PolicyKind
    threshold: int | None = None


def _is_plain_record(value: object) -> TypeGuard[dict[str, object]]:
    return (
        isinstance(value, dict)
        and type(value) is dict
        and all(isinstance(key, str) and type(key) is str for key in value)
    )


def _add_issue(
    issues: list[PrimitiveValidationIssue],
    path: str,
    code: PrimitiveValidationIssueCode,
    message: str,
) -> None:
    issues.append(PrimitiveValidationIssue(path, code, message))


def _unknown_fields(
    record: dict[str, object],
    allowed: frozenset[str],
    path: str,
    issues: list[PrimitiveValidationIssue],
) -> None:
    for key in sorted(record):
        if key not in allowed:
            _add_issue(issues, f"{path}/{key}", "UNKNOWN_FIELD", "unknown field")


def _pointer_segment(value: str) -> str:
    return value.replace("~", "~0").replace("/", "~1")


def _append_json_issues(
    value: object,
    path: str,
    issues: list[PrimitiveValidationIssue],
) -> None:
    try:
        _validate_json(value, path, set(), issues)
    except RecursionError:
        _add_issue(issues, path, "INVALID_JSON", "JSON value is nested too deeply")


def _validate_json(
    value: object,
    path: str,
    ancestors: set[int],
    issues: list[PrimitiveValidationIssue],
) -> None:
    if value is None:
        return
    if isinstance(value, str) and type(value) is str:
        return
    if isinstance(value, bool) and type(value) is bool:
        return
    if isinstance(value, int) and type(value) is int:
        if abs(value) > MAX_SAFE_INTEGER:
            _add_issue(
                issues,
                path,
                "INVALID_JSON",
                "JSON integers must be within ±(2^53-1)",
            )
        return
    if isinstance(value, float) and type(value) is float:
        if not math.isfinite(value):
            _add_issue(issues, path, "INVALID_JSON", "expected a finite JSON number")
        elif value.is_integer() and abs(value) > MAX_SAFE_INTEGER:
            _add_issue(
                issues,
                path,
                "INVALID_JSON",
                "JSON integers must be within ±(2^53-1)",
            )
        return

    if isinstance(value, list) and type(value) is list:
        identity = id(value)
        if identity in ancestors:
            _add_issue(issues, path, "INVALID_JSON", "cyclic values are not JSON")
            return
        ancestors.add(identity)
        try:
            for index, item in enumerate(value):
                _validate_json(item, f"{path}/{index}", ancestors, issues)
        finally:
            ancestors.remove(identity)
        return

    if isinstance(value, dict) and type(value) is dict:
        identity = id(value)
        if identity in ancestors:
            _add_issue(issues, path, "INVALID_JSON", "cyclic values are not JSON")
            return
        string_keys = [
            key for key in value if isinstance(key, str) and type(key) is str
        ]
        if len(string_keys) != len(value):
            _add_issue(
                issues,
                path,
                "INVALID_JSON",
                "JSON object keys must be strings",
            )
        ancestors.add(identity)
        try:
            for key in sorted(string_keys):
                _validate_json(
                    value[key],
                    f"{path}/{_pointer_segment(key)}",
                    ancestors,
                    issues,
                )
        finally:
            ancestors.remove(identity)
        return

    if callable(value):
        message = f"unsupported JSON value {type(value).__name__}"
    else:
        message = "expected a plain JSON object"
    _add_issue(issues, path, "INVALID_JSON", message)


def _validate_items(
    value: object,
    issues: list[PrimitiveValidationIssue],
) -> list[_ValidatedItem]:
    if not isinstance(value, list) or type(value) is not list:
        _add_issue(issues, "#/items", "TYPE", "expected an item array")
        return []

    validated: list[_ValidatedItem] = []
    seen_ids: set[str] = set()
    for index, raw_item in enumerate(value):
        path = f"#/items/{index}"
        if not _is_plain_record(raw_item):
            _add_issue(issues, path, "TYPE", "expected a plain item object")
            continue

        _unknown_fields(raw_item, _ITEM_FIELDS, path, issues)

        item_id: str | None = None
        if "id" not in raw_item:
            _add_issue(issues, f"{path}/id", "REQUIRED", "id is required")
        else:
            raw_id = raw_item["id"]
            if (
                not isinstance(raw_id, str)
                or type(raw_id) is not str
                or _SAFE_ID.fullmatch(raw_id) is None
                or raw_id in {".", ".."}
            ):
                _add_issue(
                    issues,
                    f"{path}/id",
                    "UNSAFE_ID",
                    "expected a safe identifier",
                )
            else:
                item_id = raw_id
                if item_id in seen_ids:
                    _add_issue(
                        issues,
                        f"{path}/id",
                        "DUPLICATE_ID",
                        f"duplicate id '{item_id}'",
                    )
                else:
                    seen_ids.add(item_id)

        status: SettledStatus | None = None
        if "status" not in raw_item:
            _add_issue(
                issues,
                f"{path}/status",
                "REQUIRED",
                "status is required",
            )
        else:
            raw_status = raw_item["status"]
            if (
                not isinstance(raw_status, str)
                or type(raw_status) is not str
                or raw_status not in _STATUSES
            ):
                _add_issue(
                    issues,
                    f"{path}/status",
                    "INVALID_STATUS",
                    "unknown settled status",
                )
            else:
                status = cast(SettledStatus, raw_status)

        has_value = "value" in raw_item
        if status == "succeeded":
            if not has_value:
                _add_issue(
                    issues,
                    f"{path}/value",
                    "STATUS_VALUE_MISMATCH",
                    "succeeded items require a value",
                )
            else:
                _append_json_issues(raw_item["value"], f"{path}/value", issues)
        elif status is not None and has_value:
            _add_issue(
                issues,
                f"{path}/value",
                "STATUS_VALUE_MISMATCH",
                f"{status} items must not contain a value",
            )

        if item_id is not None and status is not None:
            validated.append(_ValidatedItem(item_id, status))
    return validated


def _validate_policy(
    value: object,
    issues: list[PrimitiveValidationIssue],
) -> _ValidatedPolicy:
    path = "#/policy"
    if not _is_plain_record(value):
        _add_issue(issues, path, "TYPE", "expected a plain policy object")
        return _ValidatedPolicy("all")

    kind = value.get("kind")
    if isinstance(kind, str) and type(kind) is str and kind == "minimum":
        allowed = frozenset({"kind", "minimum"})
    elif isinstance(kind, str) and type(kind) is str and kind == "percentage":
        allowed = frozenset({"kind", "basisPoints"})
    else:
        allowed = frozenset({"kind"})
    _unknown_fields(value, allowed, path, issues)

    if "kind" not in value:
        _add_issue(issues, f"{path}/kind", "REQUIRED", "policy kind is required")
        return _ValidatedPolicy("all")
    if (
        not isinstance(kind, str)
        or type(kind) is not str
        or kind not in {"all", "minimum", "percentage"}
    ):
        _add_issue(
            issues,
            f"{path}/kind",
            "INVALID_POLICY",
            "unknown barrier policy kind",
        )
        return _ValidatedPolicy("all")
    policy_kind = kind
    if policy_kind == "all":
        return _ValidatedPolicy("all")

    if policy_kind == "minimum":
        if "minimum" not in value:
            _add_issue(
                issues,
                f"{path}/minimum",
                "REQUIRED",
                "minimum is required",
            )
            return _ValidatedPolicy("minimum", 1)
        minimum = portable_integer(value["minimum"], minimum=1)
        if minimum is None:
            _add_issue(
                issues,
                f"{path}/minimum",
                "INVALID_POLICY",
                "minimum must be a safe integer >= 1",
            )
            return _ValidatedPolicy("minimum", 1)
        return _ValidatedPolicy("minimum", minimum)

    if "basisPoints" not in value:
        _add_issue(
            issues,
            f"{path}/basisPoints",
            "REQUIRED",
            "basisPoints is required",
        )
        return _ValidatedPolicy("percentage", 1)
    basis_points = portable_integer(
        value["basisPoints"],
        minimum=1,
        maximum=10_000,
    )
    if basis_points is None:
        _add_issue(
            issues,
            f"{path}/basisPoints",
            "INVALID_POLICY",
            "basisPoints must be a safe integer in [1, 10000]",
        )
        return _ValidatedPolicy("percentage", 1)
    return _ValidatedPolicy("percentage", basis_points)


def _outcome(
    total: int,
    succeeded: int,
    policy: _ValidatedPolicy,
) -> tuple[bool, SettledBarrierReasonCode]:
    if total == 0:
        return False, "NO_ITEMS"
    if policy.kind == "all":
        return (
            (True, "ALL_SUCCEEDED")
            if succeeded == total
            else (False, "ALL_NOT_SUCCEEDED")
        )
    if policy.kind == "minimum":
        minimum = cast(int, policy.threshold)
        if minimum > total:
            return False, "MINIMUM_EXCEEDS_TOTAL"
        return (
            (True, "MINIMUM_MET")
            if succeeded >= minimum
            else (False, "MINIMUM_NOT_MET")
        )
    basis_points = cast(int, policy.threshold)
    return (
        (True, "PERCENTAGE_MET")
        if succeeded * 10_000 >= total * basis_points
        else (False, "PERCENTAGE_NOT_MET")
    )


def _evaluate(
    items_value: object,
    policy_value: object,
) -> SettledBarrierResult:
    issues: list[PrimitiveValidationIssue] = []
    items = _validate_items(items_value, issues)
    policy = _validate_policy(policy_value, issues)
    if issues:
        raise PrimitiveValidationError(tuple(issues))

    accepted_ids: list[str] = []
    failed_ids: list[str] = []
    missing_ids: list[str] = []
    timed_out_ids: list[str] = []
    for item in items:
        if item.status == "succeeded":
            accepted_ids.append(item.id)
        elif item.status == "failed":
            failed_ids.append(item.id)
        elif item.status == "missing":
            missing_ids.append(item.id)
        else:
            timed_out_ids.append(item.id)

    satisfied, reason_code = _outcome(len(items), len(accepted_ids), policy)
    return SettledBarrierResult(
        satisfied=satisfied,
        reason_code=reason_code,
        total=len(items),
        succeeded=len(accepted_ids),
        failed=len(failed_ids),
        missing=len(missing_ids),
        timed_out=len(timed_out_ids),
        accepted_ids=tuple(accepted_ids),
        failed_ids=tuple(failed_ids),
        missing_ids=tuple(missing_ids),
        timed_out_ids=tuple(timed_out_ids),
    )


def evaluate_settled_barrier(
    items: object,
    policy: object,
) -> SettledBarrierResult:
    """Evaluate settled items without timers, model calls, or side effects."""

    try:
        return _evaluate(items, policy)
    except PrimitiveValidationError:
        raise
    except Exception:
        raise PrimitiveValidationError(
            (
                PrimitiveValidationIssue(
                    "#",
                    "TYPE",
                    "barrier input could not be inspected safely",
                ),
            )
        ) from None
