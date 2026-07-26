from __future__ import annotations

import json
from pathlib import Path

import pytest

from graph_engineering import GraphSpec, canonical_bytes, canonical_json, canonical_sha256

ROOT = Path(__file__).resolve().parents[2]


def test_diamond_matches_cross_language_hash_fixture() -> None:
    document = json.loads((ROOT / "spec/conformance/diamond.graph.json").read_text())
    expected = json.loads((ROOT / "spec/conformance/expected.json").read_text())
    graph = GraphSpec.model_validate(document)

    assert canonical_sha256(graph) == expected["canonicalization"]["diamond.graph.json"]["sha256"]
    assert graph.canonical_hash() == (
        "24819fe69f3b9449c79bcdd85b2049000c7cc8f313aab5957657a6078a80d288"
    )


def test_canonical_json_sorts_nested_unicode_keys_and_is_compact() -> None:
    value = {"z": {"é": True, "a": None}, "arr": [{"β": 2, "a": 1}]}

    assert canonical_json(value) == '{"arr":[{"a":1,"β":2}],"z":{"a":null,"é":true}}'


def test_canonical_json_escapes_lone_surrogates_and_combines_valid_pairs() -> None:
    value = json.loads(r'{"low":"\udfff","high":"\ud800"}')
    value["pair"] = "\ud83d\ude00"
    value["研究"] = "保留"

    encoded = canonical_json(value)

    assert encoded == (
        '{"high":"\\ud800","low":"\\udfff","pair":"😀","研究":"保留"}'
    )
    assert canonical_bytes(value) == encoded.encode("utf-8")


def test_surrogate_pair_keys_sort_as_unicode_code_points_before_serialization() -> None:
    decoded_scalar = json.loads(r'"\ud83d\ude00"')
    explicit_pair = "\ud83d\ude00"
    private_use_bmp = "\ue000"
    expected = '{"\ue000":2,"😀":1}'
    expected_hash = "cddbdeacace14eb6923e88dfafb2a3e7df21ec908682f50a886b7b9567692d02"

    for key in (decoded_scalar, explicit_pair):
        value = {key: 1, private_use_bmp: 2}
        assert canonical_json(value) == expected
        assert canonical_sha256(value) == expected_hash


def test_surrogate_pair_key_normalization_rejects_collisions() -> None:
    scalar = json.loads(r'"\ud83d\ude00"')
    explicit_pair = "\ud83d\ude00"

    with pytest.raises(
        ValueError,
        match="JSON object keys collide after surrogate-pair normalization",
    ):
        canonical_json({explicit_pair: 1, scalar: 2})
