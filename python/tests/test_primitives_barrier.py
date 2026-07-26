from __future__ import annotations

import json
from dataclasses import FrozenInstanceError
from pathlib import Path
from typing import Any, cast

import pytest

from graph_engineering import (
    PrimitiveValidationError,
    PrimitiveValidationIssue,
    SettledBarrierResult,
    evaluate_settled_barrier,
)

ROOT = Path(__file__).resolve().parents[2]
CONFORMANCE_CASES = ROOT / "spec/conformance/settled-barrier.case.json"
ORDERED_CASES = (
    ROOT / "packages/primitives/test/fixtures/settled-barrier.cases.json"
)
MAX_SAFE_INTEGER = 2**53 - 1
DEFAULT_POLICY = object()


def succeeded(item_id: str, value: Any = None) -> dict[str, Any]:
    return {"id": item_id, "status": "succeeded", "value": value}


def failed(item_id: str) -> dict[str, Any]:
    return {"id": item_id, "status": "failed"}


def missing(item_id: str) -> dict[str, Any]:
    return {"id": item_id, "status": "missing"}


def timed_out(item_id: str) -> dict[str, Any]:
    return {"id": item_id, "status": "timed_out"}


def invalid(
    items: object,
    policy: object = DEFAULT_POLICY,
) -> PrimitiveValidationError:
    try:
        evaluate_settled_barrier(
            items,
            {"kind": "all"} if policy is DEFAULT_POLICY else policy,
        )
    except PrimitiveValidationError as error:
        return error
    raise AssertionError("expected PrimitiveValidationError")


def issue_dicts(error: PrimitiveValidationError) -> list[dict[str, Any]]:
    return [dict(issue.to_dict()) for issue in error.issues]


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


@pytest.mark.parametrize(
    "policy",
    [
        {"kind": "all"},
        {"kind": "minimum", "minimum": 1},
        {"kind": "percentage", "basisPoints": 1},
    ],
)
def test_empty_set_is_never_vacuously_satisfied(policy: dict[str, Any]) -> None:
    result = evaluate_settled_barrier([], policy)

    assert result.satisfied is False
    assert result.reason_code == "NO_ITEMS"
    assert result.total == 0


def test_all_policy_distinguishes_complete_and_incomplete_success() -> None:
    complete = evaluate_settled_barrier(
        [succeeded("a", 1), succeeded("b", 2)],
        {"kind": "all"},
    )
    incomplete = evaluate_settled_barrier(
        [succeeded("a", 1), failed("b")],
        {"kind": "all"},
    )

    assert (complete.satisfied, complete.reason_code) == (True, "ALL_SUCCEEDED")
    assert (incomplete.satisfied, incomplete.reason_code) == (
        False,
        "ALL_NOT_SUCCEEDED",
    )


@pytest.mark.parametrize(
    ("minimum", "reason_code", "satisfied"),
    [
        (1, "MINIMUM_MET", True),
        (2, "MINIMUM_NOT_MET", False),
        (3, "MINIMUM_EXCEEDS_TOTAL", False),
    ],
)
def test_minimum_policy_reasons(
    minimum: int,
    reason_code: str,
    satisfied: bool,
) -> None:
    result = evaluate_settled_barrier(
        [succeeded("a"), failed("b")],
        {"kind": "minimum", "minimum": minimum},
    )

    assert result.satisfied is satisfied
    assert result.reason_code == reason_code


@pytest.mark.parametrize(
    ("basis_points", "satisfied", "reason_code"),
    [
        (5000, True, "PERCENTAGE_MET"),
        (5001, False, "PERCENTAGE_NOT_MET"),
        (1, True, "PERCENTAGE_MET"),
        (10_000, False, "PERCENTAGE_NOT_MET"),
    ],
)
def test_percentage_uses_exact_integer_cross_multiplication(
    basis_points: int,
    satisfied: bool,
    reason_code: str,
) -> None:
    result = evaluate_settled_barrier(
        [succeeded("a"), failed("b")],
        {"kind": "percentage", "basisPoints": basis_points},
    )

    assert result.satisfied is satisfied
    assert result.reason_code == reason_code


def test_percentage_ten_thousand_is_met_only_when_all_succeeded() -> None:
    result = evaluate_settled_barrier(
        [succeeded("a"), succeeded("b")],
        {"kind": "percentage", "basisPoints": 10_000},
    )

    assert result.satisfied
    assert result.reason_code == "PERCENTAGE_MET"


def test_categories_preserve_declaration_order() -> None:
    result = evaluate_settled_barrier(
        [
            failed("f-2"),
            succeeded("s-2"),
            missing("m-1"),
            timed_out("t-2"),
            failed("f-1"),
            succeeded("s-1"),
            timed_out("t-1"),
        ],
        {"kind": "minimum", "minimum": 2},
    )

    assert result.accepted_ids == ("s-2", "s-1")
    assert result.failed_ids == ("f-2", "f-1")
    assert result.missing_ids == ("m-1",)
    assert result.timed_out_ids == ("t-2", "t-1")


@pytest.mark.parametrize(
    "test_case",
    load_json(CONFORMANCE_CASES)["cases"],
    ids=lambda case: cast(dict[str, Any], case)["name"],
)
def test_shared_conformance_cases(test_case: dict[str, Any]) -> None:
    result = evaluate_settled_barrier(test_case["items"], test_case["policy"])

    assert result.to_dict() == test_case["expect"]


@pytest.mark.parametrize("items", [None, {}, (), "items"])
def test_non_list_item_collection_has_structured_type_issue(items: object) -> None:
    assert invalid(items).issues == (
        PrimitiveValidationIssue("#/items", "TYPE", "expected an item array"),
    )


@pytest.mark.parametrize("item", [None, [], (), object()])
def test_item_must_be_an_exact_builtin_object(item: object) -> None:
    issue = invalid([item]).issues[0]

    assert (issue.path, issue.code, issue.message) == (
        "#/items/0",
        "TYPE",
        "expected a plain item object",
    )


def test_item_unknown_fields_sort_by_unicode_code_point_before_known_fields() -> None:
    error = invalid(
        [{"id": "a", "status": "pending", "z": 1, "é": 2, "extra": 3}]
    )

    assert [(issue.path, issue.code) for issue in error.issues] == [
        ("#/items/0/extra", "UNKNOWN_FIELD"),
        ("#/items/0/z", "UNKNOWN_FIELD"),
        ("#/items/0/é", "UNKNOWN_FIELD"),
        ("#/items/0/status", "INVALID_STATUS"),
    ]


@pytest.mark.parametrize(
    "item_id",
    ["", "../escape", ".", "..", " space", "a/b", "a\\b", "a" * 129],
)
def test_unsafe_ids_are_rejected(item_id: str) -> None:
    issue = invalid([failed(item_id)]).issues[0]

    assert (issue.path, issue.code, issue.message) == (
        "#/items/0/id",
        "UNSAFE_ID",
        "expected a safe identifier",
    )


def test_non_string_and_exact_duplicate_ids_are_rejected() -> None:
    non_string = invalid([{"id": 1, "status": "failed"}])
    duplicate = invalid([failed("A"), failed("A")])

    assert non_string.issues[0].code == "UNSAFE_ID"
    assert duplicate.issues[0] == PrimitiveValidationIssue(
        "#/items/1/id",
        "DUPLICATE_ID",
        "duplicate id 'A'",
    )
    assert evaluate_settled_barrier(
        [failed("A"), failed("a")],
        {"kind": "all"},
    ).total == 2


def test_required_id_and_status_have_fixed_order() -> None:
    assert [(issue.path, issue.code) for issue in invalid([{}]).issues] == [
        ("#/items/0/id", "REQUIRED"),
        ("#/items/0/status", "REQUIRED"),
    ]


@pytest.mark.parametrize("status", ["pending", "SUCCEEDED", 1, None])
def test_unknown_status_is_rejected(status: object) -> None:
    issue = invalid([{"id": "a", "status": status}]).issues[0]

    assert (issue.path, issue.code, issue.message) == (
        "#/items/0/status",
        "INVALID_STATUS",
        "unknown settled status",
    )


def test_succeeded_requires_an_owned_value_but_explicit_null_is_valid() -> None:
    issue = invalid([{"id": "a", "status": "succeeded"}]).issues[0]

    assert issue.code == "STATUS_VALUE_MISMATCH"
    assert evaluate_settled_barrier(
        [succeeded("a", None)],
        {"kind": "all"},
    ).satisfied


@pytest.mark.parametrize("status", ["failed", "missing", "timed_out"])
def test_unsuccessful_status_forbids_value(status: str) -> None:
    issue = invalid([{"id": "a", "status": status, "value": None}]).issues[0]

    assert (issue.path, issue.code, issue.message) == (
        "#/items/0/value",
        "STATUS_VALUE_MISMATCH",
        f"{status} items must not contain a value",
    )


@pytest.mark.parametrize(
    "value",
    [
        float("nan"),
        float("inf"),
        MAX_SAFE_INTEGER + 1,
        float(MAX_SAFE_INTEGER + 1),
        ("tuple",),
        {"set"},
        object(),
        {1: "non-string-key"},
    ],
)
def test_succeeded_value_must_be_portable_json(value: object) -> None:
    issue = invalid([succeeded("a", value)]).issues[0]

    assert issue.code == "INVALID_JSON"
    assert issue.path.startswith("#/items/0/value")


def test_cyclic_json_value_is_rejected_at_exact_path_without_recursion_error() -> None:
    value: dict[str, Any] = {}
    value["self"] = value
    issue = invalid([succeeded("a", value)]).issues[0]

    assert issue == PrimitiveValidationIssue(
        "#/items/0/value/self",
        "INVALID_JSON",
        "cyclic values are not JSON",
    )


def test_repeated_alias_and_finite_non_integer_float_are_valid() -> None:
    shared = {"score": 1.25}

    result = evaluate_settled_barrier(
        [succeeded("a", {"left": shared, "right": shared})],
        {"kind": "all"},
    )

    assert result.satisfied


def test_validation_never_invokes_caller_defined_properties() -> None:
    calls = 0

    class Hostile:
        @property
        def id(self) -> str:
            nonlocal calls
            calls += 1
            raise RuntimeError("must not execute")

    item_error = invalid([Hostile()])
    value_error = invalid([succeeded("a", Hostile())])
    policy_error = invalid([failed("a")], Hostile())

    assert calls == 0
    assert item_error.issues[0].code == "TYPE"
    assert value_error.issues[0].code == "INVALID_JSON"
    assert policy_error.issues[0].code == "TYPE"


def test_nested_json_issues_use_sorted_escaped_pointer_paths() -> None:
    error = invalid(
        [
            succeeded(
                "a",
                {
                    "z": float("nan"),
                    "a/b": float("inf"),
                    "a~b": MAX_SAFE_INTEGER + 1,
                },
            )
        ]
    )

    assert [issue.path for issue in error.issues] == [
        "#/items/0/value/a~1b",
        "#/items/0/value/a~0b",
        "#/items/0/value/z",
    ]


@pytest.mark.parametrize(
    "policy",
    [
        {"kind": "all", "minimum": 1},
        {"kind": "minimum", "minimum": 1, "basisPoints": 1},
        {"kind": "percentage", "basisPoints": 1, "minimum": 1},
    ],
)
def test_policy_shapes_reject_additional_fields(policy: dict[str, Any]) -> None:
    assert invalid([failed("a")], policy).issues[0].code == "UNKNOWN_FIELD"


@pytest.mark.parametrize(
    "minimum",
    [0, -1, 1.5, True, float("nan"), float("inf"), MAX_SAFE_INTEGER + 1],
)
def test_minimum_must_be_a_positive_safe_python_integer(minimum: object) -> None:
    issue = invalid(
        [failed("a")],
        {"kind": "minimum", "minimum": minimum},
    ).issues[0]

    assert (issue.path, issue.code, issue.message) == (
        "#/policy/minimum",
        "INVALID_POLICY",
        "minimum must be a safe integer >= 1",
    )


def test_minimum_parameter_is_required() -> None:
    issue = invalid([failed("a")], {"kind": "minimum"}).issues[0]

    assert issue == PrimitiveValidationIssue(
        "#/policy/minimum",
        "REQUIRED",
        "minimum is required",
    )


def test_barrier_policy_integer_valued_floats_use_integer_semantics() -> None:
    minimum = evaluate_settled_barrier(
        [succeeded("a"), failed("b")],
        {"kind": "minimum", "minimum": 1.0},
    )
    percentage = evaluate_settled_barrier(
        [succeeded("a"), failed("b")],
        {"kind": "percentage", "basisPoints": 5000.0},
    )

    assert minimum.reason_code == "MINIMUM_MET"
    assert percentage.reason_code == "PERCENTAGE_MET"


@pytest.mark.parametrize(
    "basis_points",
    [
        0,
        -1,
        10_001,
        1.5,
        True,
        float("nan"),
        float("inf"),
        MAX_SAFE_INTEGER + 1,
    ],
)
def test_percentage_basis_points_are_strictly_bounded(basis_points: object) -> None:
    issue = invalid(
        [failed("a")],
        {"kind": "percentage", "basisPoints": basis_points},
    ).issues[0]

    assert (issue.path, issue.code, issue.message) == (
        "#/policy/basisPoints",
        "INVALID_POLICY",
        "basisPoints must be a safe integer in [1, 10000]",
    )


def test_percentage_parameter_is_required() -> None:
    issue = invalid([failed("a")], {"kind": "percentage"}).issues[0]

    assert issue == PrimitiveValidationIssue(
        "#/policy/basisPoints",
        "REQUIRED",
        "basisPoints is required",
    )


@pytest.mark.parametrize("policy", [None, [], (), object()])
def test_policy_must_be_an_exact_builtin_object(policy: object) -> None:
    issue = invalid([failed("a")], policy).issues[0]

    assert issue == PrimitiveValidationIssue(
        "#/policy",
        "TYPE",
        "expected a plain policy object",
    )


@pytest.mark.parametrize("kind", [None, "some", 1])
def test_policy_kind_is_required_or_known(kind: object) -> None:
    policy = {} if kind is None else {"kind": kind}
    issue = invalid([failed("a")], policy).issues[0]

    assert issue.path == "#/policy/kind"
    assert issue.code == ("REQUIRED" if kind is None else "INVALID_POLICY")


def test_policy_unknown_fields_precede_kind_and_parameter_issues() -> None:
    error = invalid(
        [failed("a")],
        {"kind": "percentage", "basisPoints": 10_001, "z": 1, "a": 2},
    )

    assert [(issue.path, issue.code) for issue in error.issues] == [
        ("#/policy/a", "UNKNOWN_FIELD"),
        ("#/policy/z", "UNKNOWN_FIELD"),
        ("#/policy/basisPoints", "INVALID_POLICY"),
    ]


def test_package_fixture_matches_exact_ordered_multi_issue_contract() -> None:
    case = load_json(ORDERED_CASES)["invalidCases"][0]
    error = invalid(case["items"], case["policy"])

    assert issue_dicts(error) == case["issues"]


def test_result_is_frozen_detached_and_uses_tuple_id_collections() -> None:
    items = [succeeded("accepted", {"score": 1}), failed("rejected")]
    policy = {"kind": "minimum", "minimum": 1}
    result = evaluate_settled_barrier(items, policy)
    items[0]["id"] = "changed"
    policy["minimum"] = 2

    assert result.accepted_ids == ("accepted",)
    assert result.failed_ids == ("rejected",)
    assert isinstance(result.accepted_ids, tuple)
    with pytest.raises(FrozenInstanceError):
        result.total = 99  # type: ignore[misc]


def test_result_json_exports_have_exact_shape_order_and_fresh_containers() -> None:
    case = load_json(CONFORMANCE_CASES)["cases"][2]
    result = evaluate_settled_barrier(case["items"], case["policy"])
    first = result.to_dict()
    second = result.to_dict()

    assert list(first) == [
        "satisfied",
        "reasonCode",
        "total",
        "succeeded",
        "failed",
        "missing",
        "timedOut",
        "acceptedIds",
        "failedIds",
        "missingIds",
        "timedOutIds",
    ]
    cast(list[str], first["acceptedIds"]).append("mutated-export")
    assert second == case["expect"]
    expected_json = json.dumps(
        case["expect"],
        ensure_ascii=False,
        separators=(",", ":"),
    )
    assert result.to_json() == expected_json
    assert result.to_json_bytes() == expected_json.encode("utf-8")


def test_validation_error_is_stable_frozen_and_detached_from_input() -> None:
    item = {"id": "../unsafe", "status": "failed"}
    error = invalid([item])
    item["id"] = "now-safe"

    assert error.name == "PrimitiveValidationError"
    assert error.code == "PRIMITIVE_VALIDATION"
    assert error.message == "Settled barrier input is invalid"
    assert str(error) == error.message
    assert isinstance(error.issues, tuple)
    assert error.issues == (
        PrimitiveValidationIssue(
            "#/items/0/id",
            "UNSAFE_ID",
            "expected a safe identifier",
        ),
    )
    with pytest.raises(FrozenInstanceError):
        error.issues[0].path = "changed"  # type: ignore[misc]
    with pytest.raises(AttributeError):
        error.issues = ()  # type: ignore[misc]


def test_validation_error_json_exports_are_exact_and_fresh() -> None:
    error = invalid([{"id": "a", "status": "failed", "extra": True}])
    expected = {
        "name": "PrimitiveValidationError",
        "code": "PRIMITIVE_VALIDATION",
        "message": "Settled barrier input is invalid",
        "issues": [
            {
                "path": "#/items/0/extra",
                "code": "UNKNOWN_FIELD",
                "message": "unknown field",
            }
        ],
    }
    exported = error.to_dict()

    assert list(exported) == ["name", "code", "message", "issues"]
    assert exported == expected
    cast(list[Any], exported["issues"]).clear()
    assert error.to_dict() == expected
    expected_json = json.dumps(expected, ensure_ascii=False, separators=(",", ":"))
    assert error.to_json() == expected_json
    assert error.to_json_bytes() == expected_json.encode("utf-8")


def test_validation_error_json_escapes_lone_surrogate_paths() -> None:
    lone_surrogate = json.loads(r'"\ud800"')
    error = invalid(
        [{"id": "item", "status": "failed", lone_surrogate: True}],
    )

    encoded = error.to_json()

    assert "\\ud800" in encoded
    assert error.to_json_bytes() == encoded.encode("utf-8")
    assert json.loads(encoded)["issues"][0]["path"] == f"#/items/0/{lone_surrogate}"


def test_public_result_type_is_the_evaluator_return_type() -> None:
    result = evaluate_settled_barrier([], {"kind": "all"})

    assert isinstance(result, SettledBarrierResult)
