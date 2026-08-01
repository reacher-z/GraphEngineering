"""The exact RFC 6901 transform of redaction-semantics.md Section 3.3.1.

Every positive and negative expectation is read from the frozen corpus rather
than restated here, so a corpus change is a test change.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

import pytest

from graph_engineering.redaction.limits import (
    DEFAULT_LIMITS,
    SnapshotKeyCollisionError,
    SnapshotLimitError,
    portable_snapshot,
)
from graph_engineering.redaction.pointer import (
    REDACTION_TOKEN,
    PointerSyntaxError,
    PointerTransformDenied,
    PointerTransformResult,
    apply_pointer_transform,
    contains_transformed_material,
    decode_pointer,
)

CORPUS_PATH = Path(__file__).resolve().parents[2] / "spec" / "conformance" / "redaction.case.json"
CORPUS: dict[str, Any] = json.loads(CORPUS_PATH.read_text(encoding="utf-8"))
POINTER_CASES: list[dict[str, Any]] = CORPUS["pointerCases"]


def test_corpus_supplies_the_expected_pointer_case_count() -> None:
    assert len(POINTER_CASES) == 21
    assert len({case["id"] for case in POINTER_CASES}) == 21


@pytest.mark.parametrize("case", POINTER_CASES, ids=lambda case: str(case["id"]))
def test_pointer_case(case: dict[str, Any]) -> None:
    expected = case["expected"]
    original = copy.deepcopy(case["input"])
    outcome = apply_pointer_transform(
        case["input"], case["paths"], case["replacementMode"]
    )
    if expected["valid"]:
        assert isinstance(outcome, PointerTransformResult)
        assert outcome.output == expected["output"]
        assert list(outcome.canonical_paths) == expected["canonicalPaths"]
        assert outcome.count == len(expected["canonicalPaths"])
    else:
        assert isinstance(outcome, PointerTransformDenied)
        assert outcome.failure.code == expected["code"]
    # The pre-transform snapshot is immutable: no case may mutate its input.
    assert case["input"] == original


def test_transform_is_deterministic_and_replayable() -> None:
    candidate = {"a": {"x": "secret"}, "b": "secret"}
    first = apply_pointer_transform(candidate, ["/a/x", "/b"], "constant-token")
    second = apply_pointer_transform(candidate, ["/a/x", "/b"], "constant-token")
    assert isinstance(first, PointerTransformResult)
    assert isinstance(second, PointerTransformResult)
    assert first.output == second.output


def test_deepest_first_application_over_equal_prefixes() -> None:
    candidate = {"a": {"b": {"c": 1}}, "z": {"y": 2}}
    outcome = apply_pointer_transform(candidate, ["/a/b/c", "/z/y"], "constant-token")
    assert isinstance(outcome, PointerTransformResult)
    assert outcome.output == {"a": {"b": {"c": REDACTION_TOKEN}}, "z": {"y": REDACTION_TOKEN}}


def test_array_element_is_replaced_but_never_removed() -> None:
    candidate = {"items": ["one", "two"]}
    replaced = apply_pointer_transform(candidate, ["/items/1"], "constant-token")
    assert isinstance(replaced, PointerTransformResult)
    assert replaced.output == {"items": ["one", REDACTION_TOKEN]}
    removed = apply_pointer_transform(candidate, ["/items/1"], "remove")
    assert isinstance(removed, PointerTransformDenied)


def test_prototype_member_names_are_rejected_at_any_depth() -> None:
    for path in ("/__proto__", "/a/__proto__", "/a/b/constructor", "/prototype/x"):
        with pytest.raises(PointerSyntaxError):
            decode_pointer(path)


def test_escape_round_trip_rejects_a_noncanonical_spelling() -> None:
    assert decode_pointer("/a~1b") == ("a/b",)
    assert decode_pointer("/~0k") == ("~k",)
    for path in ("/a~", "/a~2b", "/~"):
        with pytest.raises(PointerSyntaxError):
            decode_pointer(path)


def test_section_eleven_limits_win_before_target_and_overlap_checks() -> None:
    # A pointer over the per-pointer token bound is rejected even though its
    # target does not exist and its siblings overlap.
    deep = "/" + "/".join(str(index) for index in range(DEFAULT_LIMITS.max_pointer_tokens + 1))
    outcome = apply_pointer_transform({"present": True}, [deep], "constant-token")
    assert isinstance(outcome, PointerTransformDenied)
    assert outcome.failure.code == "REDACTION_RECEIPT_INVALID"

    long_token = "/" + "a" * (DEFAULT_LIMITS.max_pointer_token_utf8_bytes + 1)
    assert isinstance(
        apply_pointer_transform({"present": True}, [long_token], "constant-token"),
        PointerTransformDenied,
    )

    too_many = [f"/p{index:05d}" for index in range(DEFAULT_LIMITS.max_pointers_per_rule + 1)]
    assert isinstance(
        apply_pointer_transform({"present": True}, too_many, "constant-token"),
        PointerTransformDenied,
    )


def test_value_depth_bound_is_enforced_without_recursive_traversal() -> None:
    value: Any = "leaf"
    for _ in range(DEFAULT_LIMITS.max_value_depth + 2):
        value = {"next": value}
    with pytest.raises(SnapshotLimitError):
        portable_snapshot(value)


def test_deeply_nested_value_does_not_raise_recursion_error() -> None:
    value: Any = 0
    for _ in range(5_000):
        value = [value]
    # The bound rejects it, but as a structured limit failure rather than a
    # host stack overflow.
    with pytest.raises(SnapshotLimitError):
        portable_snapshot(value)


def test_surrogate_pair_key_collision_is_rejected_by_the_python_runtime() -> None:
    """The obligation JavaScript structurally cannot enforce.

    ``semanticCases`` pair ``pair-key-normalization`` constructs an object whose
    key is spelled once as the scalar U+1F600 and once as the UTF-16 code units
    [55357, 56832].  In JavaScript those are the same string, so the object never
    holds two keys and the check is a structural no-op.  A Python ``str`` is a
    code-point sequence, so the two spellings are distinct ``dict`` keys until
    the portable-string rule folds them together.
    """

    surrogate_pair = chr(55357) + chr(56832)
    scalar = "\U0001f600"
    assert surrogate_pair != scalar
    colliding = {surrogate_pair: "one", scalar: "two"}
    assert len(colliding) == 2

    with pytest.raises(SnapshotKeyCollisionError):
        portable_snapshot(colliding)

    outcome = apply_pointer_transform(colliding, ["/a"], "constant-token")
    assert isinstance(outcome, PointerTransformDenied)
    assert outcome.failure.code == "REDACTION_RECEIPT_INVALID"
    assert outcome.failure.phase == "snapshot"


def test_surrogate_pair_collision_case_is_declared_by_the_corpus() -> None:
    cases = [
        case
        for case in CORPUS["semanticCases"]
        if case["mutation"]["operator"] == "construct-surrogate-pair-key-collision"
    ]
    assert len(cases) == 1
    case = cases[0]
    assert case["expected"]["valid"] is False
    assert case["expected"]["code"] == "REDACTION_RECEIPT_INVALID"
    parameters = {entry["name"]: entry["value"] for entry in case["mutation"]["parameters"]}
    assert parameters["scalarKey"] == "U+1F600"
    units = parameters["utf16CodeUnits"]
    # The corpus code units must in fact combine to the named scalar.
    combined = chr(0x10000 + ((units[0] - 0xD800) << 10) + units[1] - 0xDC00)
    assert combined == "\U0001f600"


def test_already_transformed_material_is_detected() -> None:
    assert contains_transformed_material({"field": REDACTION_TOKEN}) is True
    assert (
        contains_transformed_material(
            {
                "ref": {
                    "apiVersion": (
                        "graphengineering.reacher-z.github.io/protected-value/v1alpha1"
                    )
                }
            }
        )
        is True
    )
    assert contains_transformed_material({"field": "ordinary"}) is False
