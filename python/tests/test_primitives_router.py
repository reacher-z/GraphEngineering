from __future__ import annotations

import json
from dataclasses import FrozenInstanceError
from pathlib import Path
from typing import Any, cast

import pytest

from graph_engineering import (
    PrimitiveValidationError,
    PrimitiveValidationIssue,
    RouteSelectionResult,
    evaluate_route_selection,
)

ROOT = Path(__file__).resolve().parents[2]
CONFORMANCE_CASES = ROOT / "spec/conformance/route-selection.case.json"
ORDERED_CASES = ROOT / "packages/primitives/test/fixtures/route-selection.cases.json"
MAX_SAFE_INTEGER = 2**53 - 1


class CustomList(list[Any]):
    pass


class CustomDict(dict[str, Any]):
    pass


class CustomString(str):
    pass


class CustomInt(int):
    pass


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def single_policy(**overrides: Any) -> dict[str, Any]:
    policy: dict[str, Any] = {
        "kind": "single",
        "allowedRoutes": ["quick", "audit", "human"],
    }
    policy.update(overrides)
    return policy


def multi_policy(**overrides: Any) -> dict[str, Any]:
    policy: dict[str, Any] = {
        "kind": "multi",
        "allowedRoutes": ["quick", "audit", "human"],
        "maxMulticast": 3,
    }
    policy.update(overrides)
    return policy


def invalid(request: object, policy: object) -> PrimitiveValidationError:
    try:
        evaluate_route_selection(request, policy)
    except PrimitiveValidationError as error:
        return error
    raise AssertionError("expected PrimitiveValidationError")


def issue_dicts(error: PrimitiveValidationError) -> list[dict[str, Any]]:
    return [dict(issue.to_dict()) for issue in error.issues]


@pytest.mark.parametrize(
    "test_case",
    load_json(CONFORMANCE_CASES)["cases"],
    ids=lambda case: cast(dict[str, Any], case)["name"],
)
def test_shared_route_selection_conformance(test_case: dict[str, Any]) -> None:
    result = evaluate_route_selection(test_case["request"], test_case["policy"])

    assert result.to_dict() == test_case["expect"]
    assert result.routed is bool(result.selected_routes)


def test_multi_selection_uses_allowed_declaration_order_not_request_order() -> None:
    result = evaluate_route_selection(
        {"requestedRoutes": ["human", "quick", "audit"]},
        multi_policy(),
    )

    assert result.requested_routes == ("human", "quick", "audit")
    assert result.selected_routes == ("quick", "audit", "human")
    assert result.reason_code == "REQUESTED_ROUTES_SELECTED"


@pytest.mark.parametrize(
    "requested_routes",
    [
        [],
        ["quick", "invented"],
        ["quick", "audit", "invented"],
    ],
)
def test_low_confidence_escalation_precedes_empty_count_and_unknown(
    requested_routes: list[str],
) -> None:
    result = evaluate_route_selection(
        {
            "requestedRoutes": requested_routes,
            "confidenceBasisPoints": 6999,
        },
        {
            **multi_policy(maxMulticast=1, defaultRoute="quick"),
            "confidence": {
                "minimumBasisPoints": 7000,
                "escalationRoute": "human",
            },
        },
    )

    assert result.reason_code == "ESCALATION_SELECTED_LOW_CONFIDENCE"
    assert result.selected_routes == ("human",)
    assert result.escalated
    assert not result.used_default


def test_confidence_equal_to_threshold_uses_normal_decision_path() -> None:
    result = evaluate_route_selection(
        {"requestedRoutes": ["audit"], "confidenceBasisPoints": 7000},
        {
            **single_policy(),
            "confidence": {
                "minimumBasisPoints": 7000,
                "escalationRoute": "human",
            },
        },
    )

    assert result.reason_code == "REQUESTED_ROUTES_SELECTED"
    assert result.selected_routes == ("audit",)
    assert not result.escalated


def test_single_count_violation_is_not_masked_by_unknown_default() -> None:
    result = evaluate_route_selection(
        {"requestedRoutes": ["quick", "invented"]},
        single_policy(defaultRoute="human"),
    )

    assert result.reason_code == "MULTIPLE_ROUTES_FOR_SINGLE"
    assert result.unknown_routes == ("invented",)
    assert not result.routed
    assert not result.used_default


def test_multicast_limit_is_not_masked_by_unknown_default() -> None:
    result = evaluate_route_selection(
        {"requestedRoutes": ["quick", "invented", "audit"]},
        multi_policy(maxMulticast=2, defaultRoute="human"),
    )

    assert result.reason_code == "MULTICAST_LIMIT_EXCEEDED"
    assert result.unknown_routes == ("invented",)
    assert not result.routed
    assert not result.used_default


def test_unknown_routes_keep_request_order_and_force_whole_request_default() -> None:
    result = evaluate_route_selection(
        {"requestedRoutes": ["unknown-z", "audit", "unknown-a"]},
        multi_policy(defaultRoute="human"),
    )

    assert result.reason_code == "DEFAULT_SELECTED_UNKNOWN_ROUTE"
    assert result.requested_routes == ("unknown-z", "audit", "unknown-a")
    assert result.unknown_routes == ("unknown-z", "unknown-a")
    assert result.selected_routes == ("human",)


@pytest.mark.parametrize(
    "request_value",
    [None, [], (), "request", object(), CustomDict()],
)
def test_request_must_be_an_exact_builtin_object(request_value: object) -> None:
    issue = invalid(request_value, single_policy()).issues[0]

    assert issue == PrimitiveValidationIssue(
        "#/request",
        "TYPE",
        "expected a plain request object",
    )


def test_request_unknown_fields_sort_before_known_field_validation() -> None:
    error = invalid(
        {"requestedRoutes": "bad", "z": 1, "é": 2, "extra": 3},
        single_policy(),
    )

    assert [(issue.path, issue.code) for issue in error.issues] == [
        ("#/request/extra", "UNKNOWN_FIELD"),
        ("#/request/z", "UNKNOWN_FIELD"),
        ("#/request/é", "UNKNOWN_FIELD"),
        ("#/request/requestedRoutes", "TYPE"),
    ]


def test_requested_routes_is_required() -> None:
    assert invalid({}, single_policy()).issues[0] == PrimitiveValidationIssue(
        "#/request/requestedRoutes",
        "REQUIRED",
        "requestedRoutes is required",
    )


@pytest.mark.parametrize(
    "routes",
    [None, {}, (), "quick", {"quick"}, CustomList(["quick"])],
)
def test_requested_routes_must_be_an_exact_builtin_list(routes: object) -> None:
    issue = invalid({"requestedRoutes": routes}, single_policy()).issues[0]

    assert issue == PrimitiveValidationIssue(
        "#/request/requestedRoutes",
        "TYPE",
        "expected a route ID array",
    )


def test_empty_requested_route_list_is_valid() -> None:
    result = evaluate_route_selection({"requestedRoutes": []}, single_policy())

    assert result.reason_code == "NO_REQUESTED_ROUTE"


@pytest.mark.parametrize(
    "route",
    ["", "../escape", ".", "..", "a/b", "a\\b", " route", "a" * 129, 1, None],
)
def test_requested_route_ids_must_be_safe(route: object) -> None:
    issue = invalid({"requestedRoutes": [route]}, single_policy()).issues[0]

    assert issue == PrimitiveValidationIssue(
        "#/request/requestedRoutes/0",
        "UNSAFE_ID",
        "expected a safe route ID",
    )


def test_requested_routes_reject_exact_duplicates_but_not_case_variants() -> None:
    duplicate = invalid(
        {"requestedRoutes": ["Audit", "Audit"]},
        single_policy(allowedRoutes=["Audit", "audit"]),
    )

    assert duplicate.issues[0] == PrimitiveValidationIssue(
        "#/request/requestedRoutes/1",
        "DUPLICATE_SELECTION",
        "duplicate requested route 'Audit'",
    )
    assert evaluate_route_selection(
        {"requestedRoutes": ["Audit", "audit"]},
        multi_policy(allowedRoutes=["Audit", "audit"], maxMulticast=2),
    ).selected_routes == ("Audit", "audit")


@pytest.mark.parametrize(
    "confidence",
    [
        -1,
        10_001,
        1.5,
        True,
        None,
        float("nan"),
        float("inf"),
        MAX_SAFE_INTEGER,
        CustomInt(1),
    ],
)
def test_request_confidence_is_an_integer_in_zero_to_ten_thousand(
    confidence: object,
) -> None:
    error = invalid(
        {"requestedRoutes": ["quick"], "confidenceBasisPoints": confidence},
        {
            **single_policy(),
            "confidence": {
                "minimumBasisPoints": 5000,
                "escalationRoute": "human",
            },
        },
    )

    assert error.issues[0] == PrimitiveValidationIssue(
        "#/request/confidenceBasisPoints",
        "INVALID_CONFIDENCE",
        "confidenceBasisPoints must be a safe integer in [0, 10000]",
    )


@pytest.mark.parametrize("confidence", [0, 10_000])
def test_request_confidence_accepts_closed_range_boundaries(confidence: int) -> None:
    result = evaluate_route_selection(
        {"requestedRoutes": ["quick"], "confidenceBasisPoints": confidence},
        {
            **single_policy(),
            "confidence": {
                "minimumBasisPoints": 1,
                "escalationRoute": "human",
            },
        },
    )

    assert result.confidence_basis_points == confidence


@pytest.mark.parametrize(
    ("wire_value", "expected"),
    [(-0.0, 0), (1.0, 1), (1e0, 1), (10_000.0, 10_000)],
)
def test_request_confidence_normalizes_integer_valued_floats(
    wire_value: float,
    expected: int,
) -> None:
    result = evaluate_route_selection(
        {"requestedRoutes": ["quick"], "confidenceBasisPoints": wire_value},
        {
            **single_policy(),
            "confidence": {
                "minimumBasisPoints": 1.0,
                "escalationRoute": "human",
            },
        },
    )

    assert result.confidence_basis_points == expected
    assert type(result.confidence_basis_points) is int


@pytest.mark.parametrize("policy", [None, [], (), "policy", object(), CustomDict()])
def test_policy_must_be_an_exact_builtin_object(policy: object) -> None:
    issue = invalid({"requestedRoutes": []}, policy).issues[0]

    assert issue == PrimitiveValidationIssue(
        "#/policy",
        "TYPE",
        "expected a plain policy object",
    )


def test_policy_unknown_fields_sort_before_required_fields() -> None:
    error = invalid(
        {"requestedRoutes": []},
        {"z": 1, "é": 2, "extra": 3},
    )

    assert [(issue.path, issue.code) for issue in error.issues] == [
        ("#/policy/extra", "UNKNOWN_FIELD"),
        ("#/policy/z", "UNKNOWN_FIELD"),
        ("#/policy/é", "UNKNOWN_FIELD"),
        ("#/policy/kind", "REQUIRED"),
        ("#/policy/allowedRoutes", "REQUIRED"),
    ]


@pytest.mark.parametrize("kind", ["", "all", "SINGLE", 1, None, CustomString("single")])
def test_policy_kind_is_single_or_multi(kind: object) -> None:
    issue = invalid(
        {"requestedRoutes": []},
        {"kind": kind, "allowedRoutes": ["quick"]},
    ).issues[0]

    assert issue == PrimitiveValidationIssue(
        "#/policy/kind",
        "INVALID_POLICY",
        "kind must be 'single' or 'multi'",
    )


def test_policy_kind_and_allowed_routes_are_required_in_order() -> None:
    error = invalid({"requestedRoutes": []}, {})

    assert [(issue.path, issue.code) for issue in error.issues] == [
        ("#/policy/kind", "REQUIRED"),
        ("#/policy/allowedRoutes", "REQUIRED"),
    ]


@pytest.mark.parametrize(
    "routes",
    [None, {}, (), "quick", {"quick"}, CustomList(["quick"])],
)
def test_allowed_routes_must_be_an_exact_builtin_list(routes: object) -> None:
    issue = invalid(
        {"requestedRoutes": []},
        {"kind": "single", "allowedRoutes": routes},
    ).issues[0]

    assert issue == PrimitiveValidationIssue(
        "#/policy/allowedRoutes",
        "TYPE",
        "expected a route ID array",
    )


def test_allowed_routes_must_not_be_empty() -> None:
    issue = invalid(
        {"requestedRoutes": []},
        {"kind": "single", "allowedRoutes": []},
    ).issues[0]

    assert issue == PrimitiveValidationIssue(
        "#/policy/allowedRoutes",
        "INVALID_POLICY",
        "allowedRoutes must not be empty",
    )


@pytest.mark.parametrize(
    "route",
    ["", "../escape", ".", "..", "a/b", " route", "a" * 129, 1, None],
)
def test_allowed_route_ids_must_be_safe(route: object) -> None:
    issue = invalid(
        {"requestedRoutes": []},
        {"kind": "single", "allowedRoutes": [route]},
    ).issues[0]

    assert issue == PrimitiveValidationIssue(
        "#/policy/allowedRoutes/0",
        "UNSAFE_ID",
        "expected a safe route ID",
    )


def test_allowed_routes_reject_exact_duplicates() -> None:
    issue = invalid(
        {"requestedRoutes": []},
        {"kind": "single", "allowedRoutes": ["quick", "quick"]},
    ).issues[0]

    assert issue == PrimitiveValidationIssue(
        "#/policy/allowedRoutes/1",
        "DUPLICATE_ID",
        "duplicate allowed route 'quick'",
    )


@pytest.mark.parametrize(
    "default_route",
    ["", "../escape", ".", "..", "a/b", 1, None, CustomString("quick")],
)
def test_default_route_must_be_a_safe_id(default_route: object) -> None:
    issue = invalid(
        {"requestedRoutes": []},
        single_policy(defaultRoute=default_route),
    ).issues[0]

    assert issue == PrimitiveValidationIssue(
        "#/policy/defaultRoute",
        "UNSAFE_ID",
        "expected a safe route ID",
    )


def test_default_route_must_be_declared_in_allowed_routes() -> None:
    issue = invalid(
        {"requestedRoutes": []},
        single_policy(defaultRoute="other"),
    ).issues[0]

    assert issue == PrimitiveValidationIssue(
        "#/policy/defaultRoute",
        "INVALID_POLICY",
        "defaultRoute must be declared in allowedRoutes",
    )


@pytest.mark.parametrize("confidence", [None, [], (), "confidence", object(), CustomDict()])
def test_confidence_policy_must_be_an_exact_builtin_object(confidence: object) -> None:
    error = invalid(
        {"requestedRoutes": [], "confidenceBasisPoints": 5000},
        single_policy(confidence=confidence),
    )

    assert error.issues[0] == PrimitiveValidationIssue(
        "#/policy/confidence",
        "INVALID_POLICY",
        "expected a plain confidence policy object",
    )


def test_confidence_unknown_fields_precede_required_fields() -> None:
    error = invalid(
        {"requestedRoutes": [], "confidenceBasisPoints": 5000},
        single_policy(confidence={"z": 1, "extra": 2}),
    )

    assert [(issue.path, issue.code) for issue in error.issues] == [
        ("#/policy/confidence/extra", "UNKNOWN_FIELD"),
        ("#/policy/confidence/z", "UNKNOWN_FIELD"),
        ("#/policy/confidence/minimumBasisPoints", "REQUIRED"),
        ("#/policy/confidence/escalationRoute", "REQUIRED"),
    ]


@pytest.mark.parametrize(
    "minimum",
    [
        0,
        -1,
        10_001,
        1.5,
        True,
        None,
        float("nan"),
        float("inf"),
        MAX_SAFE_INTEGER,
        CustomInt(1),
    ],
)
def test_confidence_minimum_is_strictly_bounded(minimum: object) -> None:
    issue = invalid(
        {"requestedRoutes": [], "confidenceBasisPoints": 5000},
        single_policy(
            confidence={
                "minimumBasisPoints": minimum,
                "escalationRoute": "human",
            }
        ),
    ).issues[0]

    assert issue == PrimitiveValidationIssue(
        "#/policy/confidence/minimumBasisPoints",
        "INVALID_CONFIDENCE",
        "minimumBasisPoints must be a safe integer in [1, 10000]",
    )


def test_confidence_minimum_and_escalation_are_required_in_order() -> None:
    error = invalid(
        {"requestedRoutes": [], "confidenceBasisPoints": 5000},
        single_policy(confidence={}),
    )

    assert [(issue.path, issue.code) for issue in error.issues] == [
        ("#/policy/confidence/minimumBasisPoints", "REQUIRED"),
        ("#/policy/confidence/escalationRoute", "REQUIRED"),
    ]


@pytest.mark.parametrize(
    "route",
    ["", "../escape", ".", "..", "a/b", 1, None, CustomString("human")],
)
def test_escalation_route_must_be_safe(route: object) -> None:
    issue = invalid(
        {"requestedRoutes": [], "confidenceBasisPoints": 5000},
        single_policy(
            confidence={"minimumBasisPoints": 6000, "escalationRoute": route}
        ),
    ).issues[0]

    assert issue == PrimitiveValidationIssue(
        "#/policy/confidence/escalationRoute",
        "UNSAFE_ID",
        "expected a safe route ID",
    )


def test_escalation_route_must_be_declared_in_allowed_routes() -> None:
    issue = invalid(
        {"requestedRoutes": [], "confidenceBasisPoints": 5000},
        single_policy(
            confidence={"minimumBasisPoints": 6000, "escalationRoute": "other"}
        ),
    ).issues[0]

    assert issue == PrimitiveValidationIssue(
        "#/policy/confidence/escalationRoute",
        "INVALID_POLICY",
        "escalationRoute must be declared in allowedRoutes",
    )


@pytest.mark.parametrize("max_multicast", [None, 1, "value"])
def test_single_policy_forbids_max_multicast_field(max_multicast: object) -> None:
    issue = invalid(
        {"requestedRoutes": []},
        single_policy(maxMulticast=max_multicast),
    ).issues[0]

    assert issue == PrimitiveValidationIssue(
        "#/policy/maxMulticast",
        "INVALID_POLICY",
        "single policies must not contain maxMulticast",
    )


def test_multi_policy_requires_max_multicast() -> None:
    policy = multi_policy()
    del policy["maxMulticast"]
    issue = invalid({"requestedRoutes": []}, policy).issues[0]

    assert issue == PrimitiveValidationIssue(
        "#/policy/maxMulticast",
        "REQUIRED",
        "multi policies require maxMulticast",
    )


@pytest.mark.parametrize(
    "maximum",
    [
        0,
        -1,
        4,
        1.5,
        True,
        None,
        float("nan"),
        float("inf"),
        MAX_SAFE_INTEGER,
        CustomInt(1),
    ],
)
def test_multi_maximum_is_bounded_by_allowed_route_count(maximum: object) -> None:
    issue = invalid(
        {"requestedRoutes": []},
        multi_policy(maxMulticast=maximum),
    ).issues[0]

    assert issue == PrimitiveValidationIssue(
        "#/policy/maxMulticast",
        "INVALID_POLICY",
        "maxMulticast must be a safe integer in [1, allowedRoutes.length]",
    )


def test_multi_maximum_accepts_allowed_route_count_boundary() -> None:
    result = evaluate_route_selection(
        {"requestedRoutes": ["quick", "audit", "human"]},
        multi_policy(maxMulticast=3),
    )

    assert result.selected_routes == ("quick", "audit", "human")


def test_policy_integer_valued_float_fields_are_normalized() -> None:
    result = evaluate_route_selection(
        {"requestedRoutes": ["quick", "audit"], "confidenceBasisPoints": 1.0},
        {
            **multi_policy(maxMulticast=2.0),
            "confidence": {
                "minimumBasisPoints": 1.0,
                "escalationRoute": "human",
            },
        },
    )

    assert result.reason_code == "REQUESTED_ROUTES_SELECTED"
    assert result.confidence_basis_points == 1


def test_policy_confidence_requires_request_confidence() -> None:
    issue = invalid(
        {"requestedRoutes": ["quick"]},
        single_policy(
            confidence={"minimumBasisPoints": 5000, "escalationRoute": "human"}
        ),
    ).issues[-1]

    assert issue == PrimitiveValidationIssue(
        "#/request/confidenceBasisPoints",
        "CONFIDENCE_CONFIGURATION",
        "confidenceBasisPoints is required when policy confidence is configured",
    )


def test_request_confidence_requires_policy_confidence() -> None:
    issue = invalid(
        {"requestedRoutes": ["quick"], "confidenceBasisPoints": 5000},
        single_policy(),
    ).issues[-1]

    assert issue == PrimitiveValidationIssue(
        "#/request/confidenceBasisPoints",
        "CONFIDENCE_CONFIGURATION",
        "confidenceBasisPoints requires policy confidence configuration",
    )


def test_invalid_confidence_value_precedes_configuration_mismatch() -> None:
    error = invalid(
        {"requestedRoutes": ["quick"], "confidenceBasisPoints": 10_001},
        single_policy(),
    )

    assert [issue.code for issue in error.issues] == [
        "INVALID_CONFIDENCE",
        "CONFIDENCE_CONFIGURATION",
    ]


def test_invalid_allowed_routes_suppresses_membership_cascade() -> None:
    error = invalid(
        {"requestedRoutes": [], "confidenceBasisPoints": 5000},
        {
            "kind": "single",
            "allowedRoutes": ["quick", "quick"],
            "defaultRoute": "other",
            "confidence": {
                "minimumBasisPoints": 6000,
                "escalationRoute": "other",
            },
        },
    )

    assert [issue.code for issue in error.issues] == ["DUPLICATE_ID"]


def test_validation_never_invokes_caller_defined_properties() -> None:
    calls = 0

    class Hostile:
        @property
        def requestedRoutes(self) -> list[str]:
            nonlocal calls
            calls += 1
            raise RuntimeError("must not execute")

    request_error = invalid(Hostile(), single_policy())
    policy_error = invalid({"requestedRoutes": []}, Hostile())

    assert calls == 0
    assert request_error.issues[0].code == "TYPE"
    assert policy_error.issues[0].code == "TYPE"


def test_package_fixture_matches_ordered_multi_issue_contract() -> None:
    case = load_json(ORDERED_CASES)["invalidCases"][0]
    error = invalid(case["request"], case["policy"])

    assert issue_dicts(error) == case["issues"]


def test_result_is_frozen_detached_and_uses_tuple_routes() -> None:
    request = {"requestedRoutes": ["audit"]}
    policy = single_policy()
    result = evaluate_route_selection(request, policy)
    request["requestedRoutes"][0] = "quick"
    policy["allowedRoutes"].reverse()

    assert result.requested_routes == ("audit",)
    assert result.selected_routes == ("audit",)
    assert isinstance(result.selected_routes, tuple)
    with pytest.raises(FrozenInstanceError):
        result.routed = False  # type: ignore[misc]


def test_result_exports_exact_camel_case_order_and_fresh_containers() -> None:
    case = load_json(CONFORMANCE_CASES)["cases"][1]
    result = evaluate_route_selection(case["request"], case["policy"])
    first = result.to_dict()
    second = result.to_dict()

    assert list(first) == [
        "routed",
        "reasonCode",
        "requestedRoutes",
        "selectedRoutes",
        "unknownRoutes",
        "confidenceBasisPoints",
        "usedDefault",
        "escalated",
    ]
    cast(list[str], first["selectedRoutes"]).append("mutated-export")
    assert second == case["expect"]
    expected_json = json.dumps(
        case["expect"],
        ensure_ascii=False,
        separators=(",", ":"),
    )
    assert result.to_json() == expected_json
    assert result.to_json_bytes() == expected_json.encode("utf-8")


def test_route_validation_error_has_route_specific_message_and_exact_export() -> None:
    error = invalid({"requestedRoutes": ["quick", "quick"]}, single_policy())
    exported = error.to_dict()

    assert error.name == "PrimitiveValidationError"
    assert error.code == "PRIMITIVE_VALIDATION"
    assert error.message == "Route selection input is invalid"
    assert exported["message"] == "Route selection input is invalid"
    assert error.to_json_bytes() == error.to_json().encode("utf-8")


def test_validation_error_json_escapes_lone_surrogate_paths() -> None:
    lone_surrogate = json.loads(r'"\udfff"')
    error = invalid(
        {"requestedRoutes": [], lone_surrogate: True},
        single_policy(),
    )

    encoded = error.to_json()

    assert "\\udfff" in encoded
    assert error.to_json_bytes() == encoded.encode("utf-8")
    assert json.loads(encoded)["issues"][0]["path"] == f"#/request/{lone_surrogate}"


def test_route_validation_error_export_is_fresh_and_detached() -> None:
    request = {"requestedRoutes": ["duplicate", "duplicate"]}
    error = invalid(request, single_policy(allowedRoutes=["duplicate"]))
    request["requestedRoutes"][1] = "changed"
    exported = error.to_dict()
    cast(list[Any], exported["issues"]).clear()

    assert error.issues[0].message == "duplicate requested route 'duplicate'"
    assert len(cast(list[Any], error.to_dict()["issues"])) == 1


def test_public_result_type_is_evaluator_return_type() -> None:
    result = evaluate_route_selection({"requestedRoutes": []}, single_policy())

    assert isinstance(result, RouteSelectionResult)
