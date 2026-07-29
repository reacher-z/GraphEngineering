"""Integrated router policy and RouteEquals compiler validation."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal, TypeAlias, TypeGuard

from .compiler import Diagnostic, DiagnosticCode
from .models import MAX_SAFE_INTEGER, EdgeSpec, GraphSpec, JsonValue

ROUTER_CONDITION_API_VERSION = "graphengineering.reacher-z.github.io/pattern-conditions/v1alpha1"

_ROUTE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
_LOOP_CONDITIONS = frozenset({"LoopContinue", "LoopDryVerdict", "LoopVerdictAtBound"})
_POLICY_KEYS = frozenset({"kind", "allowedRoutes", "defaultRoute", "confidence", "maxMulticast"})
_CONFIDENCE_KEYS = frozenset({"minimumBasisPoints", "escalationRoute"})
_ROUTE_CONDITION_KEYS = frozenset({"apiVersion", "kind", "routeKey"})


@dataclass(frozen=True, slots=True)
class RouteSelectionConfidenceSnapshot:
    minimum_basis_points: int
    escalation_route: str


@dataclass(frozen=True, slots=True)
class RouteSelectionPolicySnapshot:
    kind: Literal["single", "multi"]
    allowed_routes: tuple[str, ...]
    default_route: str | None = None
    confidence: RouteSelectionConfidenceSnapshot | None = None
    max_multicast: int | None = None


@dataclass(frozen=True, slots=True)
class InvalidRouterValue:
    valid: Literal[False]
    relative_path: str


@dataclass(frozen=True, slots=True)
class ValidRouterPolicy:
    valid: Literal[True]
    policy: RouteSelectionPolicySnapshot


@dataclass(frozen=True, slots=True)
class ValidRegisteredCondition:
    valid: Literal[True]
    owner: Literal["integrated-router", "loop-pattern"]
    route_key: str | None = None


PolicyValidation: TypeAlias = InvalidRouterValue | ValidRouterPolicy
ConditionValidation: TypeAlias = InvalidRouterValue | ValidRegisteredCondition


def _record(value: object) -> TypeGuard[dict[str, JsonValue]]:
    return type(value) is dict


def _route_id(value: object) -> TypeGuard[str]:
    if type(value) is not str:
        return False
    return _ROUTE_ID.fullmatch(value) is not None and value not in {".", ".."}


def _safe_integer(value: object) -> TypeGuard[int | float]:
    if type(value) is int:
        return abs(value) <= MAX_SAFE_INTEGER
    return type(value) is float and value.is_integer() and abs(value) <= MAX_SAFE_INTEGER


def _first_unknown(value: dict[str, JsonValue], allowed: frozenset[str]) -> str | None:
    return next(iter(sorted(key for key in value if key not in allowed)), None)


def validate_route_selection_policy(value: object) -> PolicyValidation:
    """Validate one direct exact router config without inferring from edges."""

    if not _record(value):
        return InvalidRouterValue(False, "")
    record = value
    unknown = _first_unknown(record, _POLICY_KEYS)
    if unknown is not None:
        return InvalidRouterValue(False, f"/{unknown}")

    kind = record.get("kind")
    if kind not in {"single", "multi"}:
        return InvalidRouterValue(False, "/kind")
    policy_kind: Literal["single", "multi"] = "single" if kind == "single" else "multi"
    routes_value = record.get("allowedRoutes")
    if type(routes_value) is not list or not routes_value:
        return InvalidRouterValue(False, "/allowedRoutes")
    allowed_routes: list[str] = []
    seen: set[str] = set()
    for index, candidate in enumerate(routes_value):
        if not _route_id(candidate) or candidate in seen:
            return InvalidRouterValue(False, f"/allowedRoutes/{index}")
        seen.add(candidate)
        allowed_routes.append(candidate)

    default_route: str | None = None
    if "defaultRoute" in record:
        candidate = record["defaultRoute"]
        if not _route_id(candidate) or candidate not in seen:
            return InvalidRouterValue(False, "/defaultRoute")
        default_route = candidate

    confidence: RouteSelectionConfidenceSnapshot | None = None
    if "confidence" in record:
        confidence_value = record["confidence"]
        if not _record(confidence_value):
            return InvalidRouterValue(False, "/confidence")
        confidence_record = confidence_value
        confidence_unknown = _first_unknown(confidence_record, _CONFIDENCE_KEYS)
        if confidence_unknown is not None:
            return InvalidRouterValue(False, f"/confidence/{confidence_unknown}")
        minimum = confidence_record.get("minimumBasisPoints")
        if not _safe_integer(minimum) or not 1 <= minimum <= 10_000:
            return InvalidRouterValue(False, "/confidence/minimumBasisPoints")
        escalation = confidence_record.get("escalationRoute")
        if not _route_id(escalation) or escalation not in seen:
            return InvalidRouterValue(False, "/confidence/escalationRoute")
        confidence = RouteSelectionConfidenceSnapshot(int(minimum), escalation)

    max_multicast: int | None = None
    if policy_kind == "single":
        if "maxMulticast" in record:
            return InvalidRouterValue(False, "/maxMulticast")
    else:
        maximum = record.get("maxMulticast")
        if not _safe_integer(maximum) or not 1 <= maximum <= len(allowed_routes):
            return InvalidRouterValue(False, "/maxMulticast")
        max_multicast = int(maximum)

    return ValidRouterPolicy(
        True,
        RouteSelectionPolicySnapshot(
            policy_kind,
            tuple(allowed_routes),
            default_route,
            confidence,
            max_multicast,
        ),
    )


def validate_registered_edge_condition(value: object) -> ConditionValidation:
    """Classify the exact shared condition registry and validate RouteEquals."""

    if not _record(value):
        return InvalidRouterValue(False, "")
    record = value
    if "apiVersion" not in record or type(record["apiVersion"]) is not str:
        return InvalidRouterValue(False, "/apiVersion")
    if "kind" not in record or type(record["kind"]) is not str:
        return InvalidRouterValue(False, "/kind")
    if record["apiVersion"] != ROUTER_CONDITION_API_VERSION:
        return InvalidRouterValue(False, "/apiVersion")
    if record["kind"] in _LOOP_CONDITIONS:
        return ValidRegisteredCondition(True, "loop-pattern")
    if record["kind"] != "RouteEquals":
        return InvalidRouterValue(False, "/kind")
    unknown = _first_unknown(record, _ROUTE_CONDITION_KEYS)
    if unknown is not None:
        return InvalidRouterValue(False, f"/{unknown}")
    route_key = record.get("routeKey")
    if not _route_id(route_key):
        return InvalidRouterValue(False, "/routeKey")
    return ValidRegisteredCondition(True, "integrated-router", route_key)


@dataclass(frozen=True, slots=True)
class _RouteCandidate:
    edge: EdgeSpec
    edge_index: int
    router_id: str
    route_key: str


def _diagnostic(
    code: DiagnosticCode,
    message: str,
    path: str,
    node_ids: tuple[str, ...],
    edge_id: str | None = None,
) -> Diagnostic:
    return Diagnostic(
        code=code,
        message=message,
        node_id=node_ids[0] if node_ids else None,
        edge_id=edge_id,
        path=path,
        node_ids=node_ids,
    )


def validate_integrated_router_snapshot(graph: GraphSpec) -> tuple[Diagnostic, ...]:
    """Validate router policies and route-table topology in frozen pass order."""

    policies: dict[str, RouteSelectionPolicySnapshot] = {}
    invalid_routers: set[str] = set()
    nodes_by_id = {node.id: node for node in graph.nodes}
    node_index = {node.id: index for index, node in enumerate(graph.nodes)}
    policy_diagnostics: list[Diagnostic] = []
    for index, node in enumerate(graph.nodes):
        if node.kind != "router":
            continue
        policy_validation = validate_route_selection_policy(node.config)
        if not policy_validation.valid:
            invalid_routers.add(node.id)
            policy_diagnostics.append(
                _diagnostic(
                    DiagnosticCode.INVALID_ROUTER_POLICY,
                    f"router {node.id!r} has an invalid route-selection policy",
                    f"#/nodes/{index}/config{policy_validation.relative_path}",
                    (node.id,),
                )
            )
        else:
            policies[node.id] = policy_validation.policy

    unsupported_diagnostics: list[Diagnostic] = []
    source_diagnostics: list[Diagnostic] = []
    candidates: list[_RouteCandidate] = []
    suppress_coverage: set[str] = set()
    for index, edge in enumerate(graph.edges):
        if edge.condition is None:
            continue
        condition_validation = validate_registered_edge_condition(edge.condition)
        if not condition_validation.valid:
            unsupported_diagnostics.append(
                _diagnostic(
                    DiagnosticCode.UNSUPPORTED_EDGE_CONDITION,
                    f"edge {edge.id!r} has an unsupported or malformed condition",
                    f"#/edges/{index}/condition{condition_validation.relative_path}",
                    (edge.source.node,),
                    edge.id,
                )
            )
            if edge.source.node in policies:
                suppress_coverage.add(edge.source.node)
            continue
        if condition_validation.owner == "loop-pattern":
            continue
        source = nodes_by_id.get(edge.source.node)
        if source is None or source.kind != "router":
            source_diagnostics.append(
                _diagnostic(
                    DiagnosticCode.CONDITION_SOURCE_NOT_ROUTER,
                    f"edge {edge.id!r} uses RouteEquals from non-router {edge.source.node!r}",
                    f"#/edges/{index}/condition",
                    (edge.source.node,),
                    edge.id,
                )
            )
            continue
        if source.id in invalid_routers:
            continue
        if condition_validation.route_key is None:
            raise AssertionError("integrated-router condition omitted its route key")
        candidates.append(_RouteCandidate(edge, index, source.id, condition_validation.route_key))

    not_allowed_diagnostics: list[Diagnostic] = []
    duplicate_case_diagnostics: list[Diagnostic] = []
    duplicate_target_diagnostics: list[Diagnostic] = []
    seen_routes: dict[str, set[str]] = {router_id: set() for router_id in policies}
    seen_targets: dict[str, set[str]] = {router_id: set() for router_id in policies}
    accepted_routes: dict[str, set[str]] = {router_id: set() for router_id in policies}
    for candidate in candidates:
        candidate_policy = policies[candidate.router_id]
        edge = candidate.edge
        if candidate.route_key not in candidate_policy.allowed_routes:
            suppress_coverage.add(candidate.router_id)
            not_allowed_diagnostics.append(
                _diagnostic(
                    DiagnosticCode.ROUTE_NOT_ALLOWED,
                    f"edge {edge.id!r} route {candidate.route_key!r} is not allowed",
                    f"#/edges/{candidate.edge_index}/condition/routeKey",
                    (candidate.router_id,),
                    edge.id,
                )
            )
            continue
        if candidate.route_key in seen_routes[candidate.router_id]:
            suppress_coverage.add(candidate.router_id)
            duplicate_case_diagnostics.append(
                _diagnostic(
                    DiagnosticCode.DUPLICATE_ROUTE_CASE,
                    f"edge {edge.id!r} repeats route {candidate.route_key!r}",
                    f"#/edges/{candidate.edge_index}/condition/routeKey",
                    (candidate.router_id,),
                    edge.id,
                )
            )
            continue
        seen_routes[candidate.router_id].add(candidate.route_key)
        accepted_routes[candidate.router_id].add(candidate.route_key)
        target = edge.target.node
        if target in seen_targets[candidate.router_id]:
            suppress_coverage.add(candidate.router_id)
            duplicate_target_diagnostics.append(
                _diagnostic(
                    DiagnosticCode.DUPLICATE_ROUTE_TARGET,
                    f"edge {edge.id!r} repeats target {target!r}",
                    f"#/edges/{candidate.edge_index}/to/node",
                    (candidate.router_id, target),
                    edge.id,
                )
            )
        else:
            seen_targets[candidate.router_id].add(target)

    coverage_diagnostics: list[Diagnostic] = []
    for node in graph.nodes:
        coverage_policy = policies.get(node.id)
        if coverage_policy is None or node.id in suppress_coverage:
            continue
        accepted = accepted_routes[node.id]
        missing = tuple(route for route in coverage_policy.allowed_routes if route not in accepted)
        if not missing:
            continue
        coverage_diagnostics.append(
            _diagnostic(
                DiagnosticCode.INCOMPLETE_ROUTE_COVERAGE,
                f"router {node.id!r} is missing route cases: {', '.join(missing)}",
                f"#/nodes/{node_index[node.id]}/config/allowedRoutes",
                (node.id,),
            )
        )

    return (
        *policy_diagnostics,
        *unsupported_diagnostics,
        *source_diagnostics,
        *not_allowed_diagnostics,
        *duplicate_case_diagnostics,
        *duplicate_target_diagnostics,
        *coverage_diagnostics,
    )
