from __future__ import annotations

import json
import struct
from pathlib import Path
from typing import ClassVar

import pytest
from pydantic import BaseModel

from graph_engineering import (
    GraphSpec,
    canonical_bytes,
    canonical_json,
    canonical_sha256,
    create_compiled_graph_identity,
    parse_graph_source,
)
from graph_engineering._json import _render_finite_float, compact_json

ROOT = Path(__file__).resolve().parents[2]
CANONICAL_NUMBER_CASE = json.loads(
    (ROOT / "spec/conformance/canonical-number.case.json").read_text()
)


def binary64_from_hex(bits: str) -> float:
    return struct.unpack(">d", bytes.fromhex(bits))[0]


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
        (TypeError, ValueError),
        match="object keys collide after surrogate-pair normalization",
    ):
        canonical_json({explicit_pair: 1, scalar: 2})


@pytest.mark.parametrize(
    "sample",
    CANONICAL_NUMBER_CASE["formatterVectors"],
    ids=lambda sample: sample["bits"],
)
def test_finite_binary64_matches_ecmascript_shortest_number_corpus(
    sample: dict[str, str],
) -> None:
    value = binary64_from_hex(sample["bits"])

    assert _render_finite_float(value) == sample["canonical"]


@pytest.mark.parametrize(
    "bits",
    CANONICAL_NUMBER_CASE["portableAccepted"],
)
def test_public_canonical_json_accepts_only_portable_binary64(bits: str) -> None:
    expected = next(
        sample["canonical"]
        for sample in CANONICAL_NUMBER_CASE["formatterVectors"]
        if sample["bits"] == bits
    )
    value = binary64_from_hex(bits)

    assert canonical_json(value) == expected
    assert compact_json(value) == expected


@pytest.mark.parametrize(
    "sample",
    CANONICAL_NUMBER_CASE["portableRejected"],
    ids=lambda sample: sample["bits"],
)
def test_public_canonical_json_rejects_nonportable_binary64(
    sample: dict[str, str],
) -> None:
    value = binary64_from_hex(sample["bits"])

    with pytest.raises((TypeError, ValueError)):
        canonical_json(value)
    with pytest.raises((TypeError, ValueError)):
        compact_json(value)


class _ListSubclass(list[object]):
    pass


class _DictSubclass(dict[str, object]):
    pass


class _StringSubclass(str):
    pass


class _IntegerSubclass(int):
    pass


class _FloatSubclass(float):
    pass


class _HostileBaseModel(BaseModel):
    value: int
    calls: ClassVar[int] = 0

    def model_dump(self, *args: object, **kwargs: object) -> dict[str, object]:
        type(self).calls += 1
        raise AssertionError("secret-from-hostile-model")


class _HostileDict(dict[str, object]):
    calls: ClassVar[int] = 0

    def items(self):  # type: ignore[no-untyped-def]
        type(self).calls += 1
        raise AssertionError("secret-from-hostile-dict")


def _cycle() -> list[object]:
    value: list[object] = []
    value.append(value)
    return value


@pytest.mark.parametrize(
    "value",
    [
        2**53,
        float(2**53),
        (1,),
        _ListSubclass([1]),
        _DictSubclass({"value": 1}),
        _StringSubclass("value"),
        _IntegerSubclass(1),
        _FloatSubclass(1.5),
        {1: "non-string key"},
        _cycle(),
    ],
    ids=[
        "unsafe-int",
        "unsafe-integral-float",
        "tuple",
        "list-subclass",
        "dict-subclass",
        "string-subclass",
        "int-subclass",
        "float-subclass",
        "non-string-key",
        "cycle",
    ],
)
def test_public_canonical_boundary_rejects_nonportable_host_values(
    value: object,
) -> None:
    with pytest.raises((TypeError, ValueError)):
        canonical_json(value)
    with pytest.raises((TypeError, ValueError)):
        compact_json(value)


def test_canonical_boundary_never_dispatches_hostile_basemodel_methods() -> None:
    value = _HostileBaseModel(value=1)
    _HostileBaseModel.calls = 0

    for operation in (canonical_json, canonical_sha256):
        with pytest.raises((TypeError, ValueError)) as failure:
            operation(value)
        assert "secret-from-hostile-model" not in str(failure.value)
    assert _HostileBaseModel.calls == 0


def test_canonical_boundary_safely_rejects_tampered_exact_graph_model() -> None:
    document = CANONICAL_NUMBER_CASE["wholeGraph"]["document"]
    graph = GraphSpec.model_validate(document)
    hostile = _HostileDict({"secret": "must-not-be-read"})
    node_storage = object.__getattribute__(graph.nodes[0], "__dict__")
    node_storage["config"] = hostile
    _HostileDict.calls = 0

    for operation in (canonical_json, canonical_sha256):
        with pytest.raises((TypeError, ValueError)) as failure:
            operation(graph)
        assert "must-not-be-read" not in str(failure.value)
        assert "secret-from-hostile-dict" not in str(failure.value)
    assert _HostileDict.calls == 0


def test_fractional_whole_graph_has_frozen_cross_language_bytes_and_hash() -> None:
    case = CANONICAL_NUMBER_CASE["wholeGraph"]
    document = case["document"]
    yaml_document = parse_graph_source(
        (ROOT / "spec/conformance" / case["yamlSource"]).read_bytes(),
        format="yaml",
    )
    graph = GraphSpec.model_validate(document)

    assert yaml_document == document
    assert canonical_json(document) == case["canonicalGraph"]
    assert canonical_json(yaml_document) == case["canonicalGraph"]
    assert canonical_json(graph) == case["canonicalGraph"]
    assert canonical_sha256(document) == case["sha256"]
    assert canonical_sha256(yaml_document) == case["sha256"]
    assert graph.canonical_hash() == case["sha256"]
    assert create_compiled_graph_identity(yaml_document).to_dict() == case["identity"]
