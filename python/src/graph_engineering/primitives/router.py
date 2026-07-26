"""Deterministic policy-based route selection."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal, NotRequired, TypeAlias, TypedDict, TypeGuard, cast

from ..models import JsonObject
from ._numbers import portable_integer
from ._serialization import compact_json
from .errors import (
    PrimitiveValidationError,
    PrimitiveValidationIssue,
    PrimitiveValidationIssueCode,
)

RouteSelectionReasonCode: TypeAlias = Literal[
    "REQUESTED_ROUTES_SELECTED",
    "DEFAULT_SELECTED_NO_REQUEST",
    "DEFAULT_SELECTED_UNKNOWN_ROUTE",
    "ESCALATION_SELECTED_LOW_CONFIDENCE",
    "NO_REQUESTED_ROUTE",
    "UNKNOWN_ROUTE",
    "MULTIPLE_ROUTES_FOR_SINGLE",
    "MULTICAST_LIMIT_EXCEEDED",
]
_PolicyKind: TypeAlias = Literal["single", "multi"]
_DuplicateCode: TypeAlias = Literal["DUPLICATE_ID", "DUPLICATE_SELECTION"]


class RouteSelectionRequest(TypedDict):
    requestedRoutes: list[str]
    confidenceBasisPoints: NotRequired[int | float]


class RouteConfidencePolicy(TypedDict):
    minimumBasisPoints: int | float
    escalationRoute: str


class _RouteSelectionPolicyBase(TypedDict):
    allowedRoutes: list[str]
    defaultRoute: NotRequired[str]
    confidence: NotRequired[RouteConfidencePolicy]


class SingleRouteSelectionPolicy(_RouteSelectionPolicyBase):
    kind: Literal["single"]


class MultiRouteSelectionPolicy(_RouteSelectionPolicyBase):
    kind: Literal["multi"]
    maxMulticast: int | float


RouteSelectionPolicy: TypeAlias = (
    SingleRouteSelectionPolicy | MultiRouteSelectionPolicy
)

_SAFE_ROUTE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
_REQUEST_FIELDS = frozenset({"requestedRoutes", "confidenceBasisPoints"})
_POLICY_FIELDS = frozenset(
    {"kind", "allowedRoutes", "defaultRoute", "confidence", "maxMulticast"}
)
_CONFIDENCE_FIELDS = frozenset({"minimumBasisPoints", "escalationRoute"})


@dataclass(frozen=True, slots=True)
class RouteSelectionResult:
    """Immutable route decision with an exact TypeScript-compatible export."""

    routed: bool
    reason_code: RouteSelectionReasonCode
    requested_routes: tuple[str, ...]
    selected_routes: tuple[str, ...]
    unknown_routes: tuple[str, ...]
    confidence_basis_points: int | None
    used_default: bool
    escalated: bool

    def to_dict(self) -> JsonObject:
        return {
            "routed": self.routed,
            "reasonCode": self.reason_code,
            "requestedRoutes": list(self.requested_routes),
            "selectedRoutes": list(self.selected_routes),
            "unknownRoutes": list(self.unknown_routes),
            "confidenceBasisPoints": self.confidence_basis_points,
            "usedDefault": self.used_default,
            "escalated": self.escalated,
        }

    def to_json(self) -> str:
        return compact_json(self.to_dict())

    def to_json_bytes(self) -> bytes:
        return self.to_json().encode("utf-8")


@dataclass(frozen=True, slots=True)
class _RequestSnapshot:
    requested_routes: tuple[str, ...]
    confidence_basis_points: int | None
    confidence_present: bool


@dataclass(frozen=True, slots=True)
class _ConfidenceSnapshot:
    minimum_basis_points: int
    escalation_route: str


@dataclass(frozen=True, slots=True)
class _PolicySnapshot:
    kind: _PolicyKind
    allowed_routes: tuple[str, ...]
    default_route: str | None
    confidence: _ConfidenceSnapshot | None
    confidence_present: bool
    max_multicast: int | None


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
    value: dict[str, object],
    allowed: frozenset[str],
    path: str,
    issues: list[PrimitiveValidationIssue],
) -> None:
    for name in sorted(value):
        if name not in allowed:
            _add_issue(issues, f"{path}/{name}", "UNKNOWN_FIELD", "unknown field")


def _valid_route_id(value: object) -> TypeGuard[str]:
    return (
        isinstance(value, str)
        and type(value) is str
        and _SAFE_ROUTE_ID.fullmatch(value) is not None
        and value not in {".", ".."}
    )


def _validate_route_array(
    value: object,
    path: str,
    *,
    duplicate_code: _DuplicateCode,
    require_non_empty: bool,
    issues: list[PrimitiveValidationIssue],
) -> tuple[str, ...]:
    if not isinstance(value, list) or type(value) is not list:
        _add_issue(issues, path, "TYPE", "expected a route ID array")
        return ()
    if require_non_empty and not value:
        _add_issue(
            issues,
            path,
            "INVALID_POLICY",
            "allowedRoutes must not be empty",
        )

    routes: list[str] = []
    seen: set[str] = set()
    for index, raw_route in enumerate(value):
        item_path = f"{path}/{index}"
        if not _valid_route_id(raw_route):
            _add_issue(issues, item_path, "UNSAFE_ID", "expected a safe route ID")
            continue
        if raw_route in seen:
            label = "requested" if duplicate_code == "DUPLICATE_SELECTION" else "allowed"
            _add_issue(
                issues,
                item_path,
                duplicate_code,
                f"duplicate {label} route '{raw_route}'",
            )
        else:
            seen.add(raw_route)
        routes.append(raw_route)
    return tuple(routes)


def _validate_request(
    value: object,
    issues: list[PrimitiveValidationIssue],
) -> _RequestSnapshot:
    path = "#/request"
    if not _is_plain_record(value):
        _add_issue(issues, path, "TYPE", "expected a plain request object")
        return _RequestSnapshot((), None, False)
    _unknown_fields(value, _REQUEST_FIELDS, path, issues)

    requested_routes: tuple[str, ...] = ()
    if "requestedRoutes" not in value:
        _add_issue(
            issues,
            f"{path}/requestedRoutes",
            "REQUIRED",
            "requestedRoutes is required",
        )
    else:
        requested_routes = _validate_route_array(
            value["requestedRoutes"],
            f"{path}/requestedRoutes",
            duplicate_code="DUPLICATE_SELECTION",
            require_non_empty=False,
            issues=issues,
        )

    confidence_present = "confidenceBasisPoints" in value
    confidence_basis_points: int | None = None
    if confidence_present:
        confidence_basis_points = portable_integer(
            value["confidenceBasisPoints"],
            minimum=0,
            maximum=10_000,
        )
        if confidence_basis_points is None:
            _add_issue(
                issues,
                f"{path}/confidenceBasisPoints",
                "INVALID_CONFIDENCE",
                "confidenceBasisPoints must be a safe integer in [0, 10000]",
            )

    return _RequestSnapshot(
        requested_routes,
        confidence_basis_points,
        confidence_present,
    )


def _validate_confidence_policy(
    value: object,
    allowed_routes: frozenset[str],
    allowed_routes_valid: bool,
    issues: list[PrimitiveValidationIssue],
) -> _ConfidenceSnapshot | None:
    path = "#/policy/confidence"
    if not _is_plain_record(value):
        _add_issue(
            issues,
            path,
            "INVALID_POLICY",
            "expected a plain confidence policy object",
        )
        return None
    _unknown_fields(value, _CONFIDENCE_FIELDS, path, issues)

    minimum_basis_points: int | None = None
    if "minimumBasisPoints" not in value:
        _add_issue(
            issues,
            f"{path}/minimumBasisPoints",
            "REQUIRED",
            "minimumBasisPoints is required",
        )
    else:
        minimum_basis_points = portable_integer(
            value["minimumBasisPoints"],
            minimum=1,
            maximum=10_000,
        )
        if minimum_basis_points is None:
            _add_issue(
                issues,
                f"{path}/minimumBasisPoints",
                "INVALID_CONFIDENCE",
                "minimumBasisPoints must be a safe integer in [1, 10000]",
            )

    escalation_route: str | None = None
    if "escalationRoute" not in value:
        _add_issue(
            issues,
            f"{path}/escalationRoute",
            "REQUIRED",
            "escalationRoute is required",
        )
    else:
        raw_escalation = value["escalationRoute"]
        if not _valid_route_id(raw_escalation):
            _add_issue(
                issues,
                f"{path}/escalationRoute",
                "UNSAFE_ID",
                "expected a safe route ID",
            )
        else:
            escalation_route = raw_escalation
            if allowed_routes_valid and escalation_route not in allowed_routes:
                _add_issue(
                    issues,
                    f"{path}/escalationRoute",
                    "INVALID_POLICY",
                    "escalationRoute must be declared in allowedRoutes",
                )

    if minimum_basis_points is None or escalation_route is None:
        return None
    return _ConfidenceSnapshot(minimum_basis_points, escalation_route)


def _validate_policy(
    value: object,
    issues: list[PrimitiveValidationIssue],
) -> _PolicySnapshot:
    path = "#/policy"
    if not _is_plain_record(value):
        _add_issue(issues, path, "TYPE", "expected a plain policy object")
        return _PolicySnapshot("single", (), None, None, False, None)
    _unknown_fields(value, _POLICY_FIELDS, path, issues)

    kind: _PolicyKind = "single"
    kind_valid = False
    if "kind" not in value:
        _add_issue(issues, f"{path}/kind", "REQUIRED", "policy kind is required")
    else:
        raw_kind = value["kind"]
        if (
            not isinstance(raw_kind, str)
            or type(raw_kind) is not str
            or raw_kind not in {"single", "multi"}
        ):
            _add_issue(
                issues,
                f"{path}/kind",
                "INVALID_POLICY",
                "kind must be 'single' or 'multi'",
            )
        else:
            kind = cast(_PolicyKind, raw_kind)
            kind_valid = True

    allowed_routes: tuple[str, ...] = ()
    allowed_issues_start = len(issues)
    allowed_present = "allowedRoutes" in value
    if not allowed_present:
        _add_issue(
            issues,
            f"{path}/allowedRoutes",
            "REQUIRED",
            "allowedRoutes is required",
        )
    else:
        allowed_routes = _validate_route_array(
            value["allowedRoutes"],
            f"{path}/allowedRoutes",
            duplicate_code="DUPLICATE_ID",
            require_non_empty=True,
            issues=issues,
        )
    allowed_routes_valid = len(issues) == allowed_issues_start and allowed_present
    allowed_set = frozenset(allowed_routes)

    default_route: str | None = None
    if "defaultRoute" in value:
        raw_default = value["defaultRoute"]
        if not _valid_route_id(raw_default):
            _add_issue(
                issues,
                f"{path}/defaultRoute",
                "UNSAFE_ID",
                "expected a safe route ID",
            )
        else:
            default_route = raw_default
            if allowed_routes_valid and default_route not in allowed_set:
                _add_issue(
                    issues,
                    f"{path}/defaultRoute",
                    "INVALID_POLICY",
                    "defaultRoute must be declared in allowedRoutes",
                )

    confidence_present = "confidence" in value
    confidence: _ConfidenceSnapshot | None = None
    confidence_config_valid = False
    if confidence_present:
        confidence_issues_start = len(issues)
        confidence = _validate_confidence_policy(
            value["confidence"],
            allowed_set,
            allowed_routes_valid,
            issues,
        )
        confidence_config_valid = (
            confidence is not None and len(issues) == confidence_issues_start
        )

    max_multicast: int | None = None
    max_present = "maxMulticast" in value
    if kind_valid and kind == "single":
        if max_present:
            _add_issue(
                issues,
                f"{path}/maxMulticast",
                "INVALID_POLICY",
                "single policies must not contain maxMulticast",
            )
    elif kind_valid and kind == "multi":
        if not max_present:
            _add_issue(
                issues,
                f"{path}/maxMulticast",
                "REQUIRED",
                "multi policies require maxMulticast",
            )
        else:
            max_multicast = portable_integer(value["maxMulticast"], minimum=1)
            if max_multicast is None or (
                allowed_routes_valid and max_multicast > len(allowed_routes)
            ):
                _add_issue(
                    issues,
                    f"{path}/maxMulticast",
                    "INVALID_POLICY",
                    "maxMulticast must be a safe integer in [1, allowedRoutes.length]",
                )

    return _PolicySnapshot(
        kind,
        allowed_routes,
        default_route,
        confidence if confidence_config_valid else None,
        confidence_present,
        max_multicast,
    )


def _result(
    reason_code: RouteSelectionReasonCode,
    request: _RequestSnapshot,
    selected_routes: tuple[str, ...],
    unknown_routes: tuple[str, ...],
    *,
    used_default: bool,
    escalated: bool,
) -> RouteSelectionResult:
    return RouteSelectionResult(
        routed=bool(selected_routes),
        reason_code=reason_code,
        requested_routes=tuple(request.requested_routes),
        selected_routes=tuple(selected_routes),
        unknown_routes=tuple(unknown_routes),
        confidence_basis_points=request.confidence_basis_points,
        used_default=used_default,
        escalated=escalated,
    )


def _evaluate(request_value: object, policy_value: object) -> RouteSelectionResult:
    issues: list[PrimitiveValidationIssue] = []
    request = _validate_request(request_value, issues)
    policy = _validate_policy(policy_value, issues)

    if policy.confidence_present and not request.confidence_present:
        _add_issue(
            issues,
            "#/request/confidenceBasisPoints",
            "CONFIDENCE_CONFIGURATION",
            "confidenceBasisPoints is required when policy confidence is configured",
        )
    elif not policy.confidence_present and request.confidence_present:
        _add_issue(
            issues,
            "#/request/confidenceBasisPoints",
            "CONFIDENCE_CONFIGURATION",
            "confidenceBasisPoints requires policy confidence configuration",
        )
    if issues:
        raise PrimitiveValidationError(
            tuple(issues),
            message="Route selection input is invalid",
        )

    allowed_set = frozenset(policy.allowed_routes)
    unknown_routes = tuple(
        route for route in request.requested_routes if route not in allowed_set
    )

    if (
        policy.confidence is not None
        and request.confidence_basis_points is not None
        and request.confidence_basis_points
        < policy.confidence.minimum_basis_points
    ):
        return _result(
            "ESCALATION_SELECTED_LOW_CONFIDENCE",
            request,
            (policy.confidence.escalation_route,),
            unknown_routes,
            used_default=False,
            escalated=True,
        )

    if not request.requested_routes:
        if policy.default_route is None:
            return _result(
                "NO_REQUESTED_ROUTE",
                request,
                (),
                (),
                used_default=False,
                escalated=False,
            )
        return _result(
            "DEFAULT_SELECTED_NO_REQUEST",
            request,
            (policy.default_route,),
            (),
            used_default=True,
            escalated=False,
        )

    if policy.kind == "single" and len(request.requested_routes) > 1:
        return _result(
            "MULTIPLE_ROUTES_FOR_SINGLE",
            request,
            (),
            unknown_routes,
            used_default=False,
            escalated=False,
        )
    if (
        policy.kind == "multi"
        and policy.max_multicast is not None
        and len(request.requested_routes) > policy.max_multicast
    ):
        return _result(
            "MULTICAST_LIMIT_EXCEEDED",
            request,
            (),
            unknown_routes,
            used_default=False,
            escalated=False,
        )

    if unknown_routes:
        if policy.default_route is None:
            return _result(
                "UNKNOWN_ROUTE",
                request,
                (),
                unknown_routes,
                used_default=False,
                escalated=False,
            )
        return _result(
            "DEFAULT_SELECTED_UNKNOWN_ROUTE",
            request,
            (policy.default_route,),
            unknown_routes,
            used_default=True,
            escalated=False,
        )

    requested_set = frozenset(request.requested_routes)
    selected_routes = tuple(
        route for route in policy.allowed_routes if route in requested_set
    )
    return _result(
        "REQUESTED_ROUTES_SELECTED",
        request,
        selected_routes,
        (),
        used_default=False,
        escalated=False,
    )


def evaluate_route_selection(
    request: object,
    policy: object,
) -> RouteSelectionResult:
    """Convert an untrusted route request into an auditable policy decision."""

    try:
        return _evaluate(request, policy)
    except PrimitiveValidationError:
        raise
    except Exception:
        raise PrimitiveValidationError(
            (
                PrimitiveValidationIssue(
                    "#",
                    "TYPE",
                    "route selection input could not be inspected safely",
                ),
            ),
            message="Route selection input is invalid",
        ) from None
