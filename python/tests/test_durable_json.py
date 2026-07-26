from __future__ import annotations

import json
import math
import struct
from pathlib import Path

import pytest

from graph_engineering import canonical_json
from graph_engineering.durable_json import (
    DurableJsonError,
    decode_durable_json,
    durable_json_hash,
    encode_durable_json,
)

ROOT = Path(__file__).parents[2]


def test_tagged_durable_json_round_trips_every_runtime_value_kind() -> None:
    value = {
        "array": [None, True, "text", 42, 1.5],
        "object": {"z": 0.1, "é": -2},
    }

    encoded = encode_durable_json(value)

    assert encoded == [
        "o",
        [
            [
                "array",
                [
                    "a",
                    [["n"], ["b", True], ["s", "text"], ["i", 42], ["f", "3ff8000000000000"]],
                ],
            ],
            [
                "object",
                ["o", [["z", ["f", "3fb999999999999a"]], ["é", ["i", -2]]]],
            ],
        ],
    ]
    assert decode_durable_json(encoded) == value
    assert durable_json_hash(value) == durable_json_hash(decode_durable_json(encoded))


def test_integer_valued_floats_and_negative_zero_normalize_to_integer_tags() -> None:
    assert encode_durable_json([1.0, -0.0]) == ["a", [["i", 1], ["i", 0]]]


@pytest.mark.parametrize("value", [math.nan, math.inf, -math.inf, 2**53])
def test_encoder_rejects_values_outside_the_portable_runtime_boundary(value: object) -> None:
    with pytest.raises(DurableJsonError):
        encode_durable_json(value)


@pytest.mark.parametrize(
    "encoded",
    [
        [],
        ["unknown"],
        ["n", None],
        ["i", True],
        ["i", 2**53],
        ["f", "3ff0000000000000"],
        ["f", "7ff0000000000000"],
        ["f", "3FF8000000000000"],
        ["o", [["b", ["n"]], ["a", ["n"]]]],
        ["o", [["a", ["n"]], ["a", ["n"]]]],
    ],
)
def test_decoder_rejects_noncanonical_or_malformed_tagged_values(encoded: object) -> None:
    with pytest.raises(DurableJsonError):
        decode_durable_json(encoded)


def test_shared_durable_json_conformance_corpus() -> None:
    corpus = json.loads(
        (ROOT / "spec/conformance/durable-json.case.json").read_text(encoding="utf-8")
    )
    for case in corpus["validCases"]:
        source = case["source"]
        value = (
            source["value"]
            if source["kind"] == "json"
            else struct.unpack(">d", bytes.fromhex(source["bits"]))[0]
        )
        encoded = encode_durable_json(value)
        assert encoded == case["expect"]["encoding"], case["name"]
        assert canonical_json(encoded) == case["expect"]["canonicalJson"], case["name"]
        assert durable_json_hash(value) == case["expect"]["sha256"], case["name"]
        decoded = decode_durable_json(encoded)
        if isinstance(value, float) and value == 0:
            assert decoded == 0
        else:
            assert decoded == value

    for case in corpus["invalidEncodedCases"]:
        with pytest.raises(DurableJsonError):
            decode_durable_json(case["encoding"])
