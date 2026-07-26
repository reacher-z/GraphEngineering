from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from graph_engineering import GraphSpec, canonical_json

ROOT = Path(__file__).resolve().parents[2]


def diamond() -> dict[str, object]:
    return json.loads((ROOT / "spec/conformance/diamond.graph.json").read_text())


def test_alias_round_trip_preserves_the_graph_ir_document() -> None:
    document = diamond()
    graph = GraphSpec.model_validate(document)

    assert graph.api_version == "graphengineering.reacher-z.github.io/v1alpha1"
    assert graph.nodes[0].input_schema == {"type": "object"}
    assert graph.edges[0].source.node == "split"
    assert graph.model_dump(mode="json", by_alias=True, exclude_unset=True) == document


def test_unknown_envelope_and_node_fields_are_rejected() -> None:
    envelope = diamond()
    envelope["unknown"] = True
    with pytest.raises(ValidationError):
        GraphSpec.model_validate(envelope)

    node_field = diamond()
    node_field["nodes"][0]["unknown"] = True  # type: ignore[index]
    with pytest.raises(ValidationError):
        GraphSpec.model_validate(node_field)


def test_entrypoints_are_non_empty_and_unique() -> None:
    empty = diamond()
    empty["entrypoints"] = []
    with pytest.raises(ValidationError):
        GraphSpec.model_validate(empty)

    duplicate = diamond()
    duplicate["entrypoints"] = ["split", "split"]
    with pytest.raises(ValidationError):
        GraphSpec.model_validate(duplicate)


def test_strict_policy_types_and_retry_bounds_are_enforced() -> None:
    wrong_type = diamond()
    wrong_type["policies"] = {"maxConcurrency": "2"}
    with pytest.raises(ValidationError):
        GraphSpec.model_validate(wrong_type)

    retry = diamond()
    retry["nodes"][0]["retry"] = {"maxAttempts": 0}  # type: ignore[index]
    with pytest.raises(ValidationError):
        GraphSpec.model_validate(retry)


def test_required_null_config_is_not_dropped_from_canonical_json() -> None:
    document = copy.deepcopy(diamond())
    document["nodes"][0]["config"] = None  # type: ignore[index]
    graph = GraphSpec.model_validate(document)

    encoded = canonical_json(graph)

    assert '"config":null' in encoded
