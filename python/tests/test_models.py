from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

import pytest
from pydantic import BaseModel, ValidationError

from graph_engineering import (
    EdgeSpec,
    Endpoint,
    GraphPolicies,
    GraphSpec,
    Metadata,
    NodeSpec,
    RetryPolicy,
    canonical_json,
)

ROOT = Path(__file__).resolve().parents[2]

GRAPH_IR_MODELS: tuple[type[BaseModel], ...] = (
    Metadata,
    Endpoint,
    RetryPolicy,
    NodeSpec,
    EdgeSpec,
    GraphPolicies,
    GraphSpec,
)

OPTIONAL_NULL_CASES: tuple[tuple[type[BaseModel], str, tuple[str | int, ...]], ...] = (
    (Metadata, "description", ("metadata",)),
    (Metadata, "labels", ("metadata",)),
    (Endpoint, "port", ("outputs", "result")),
    (RetryPolicy, "maxAttempts", ("nodes", 0, "retry")),
    (RetryPolicy, "initialDelayMs", ("nodes", 0, "retry")),
    (RetryPolicy, "maxDelayMs", ("nodes", 0, "retry")),
    (RetryPolicy, "backoffMultiplier", ("nodes", 0, "retry")),
    (RetryPolicy, "jitter", ("nodes", 0, "retry")),
    (NodeSpec, "retry", ("nodes", 0)),
    (NodeSpec, "timeoutMs", ("nodes", 0)),
    (NodeSpec, "cache", ("nodes", 0)),
    (NodeSpec, "resources", ("nodes", 0)),
    (NodeSpec, "isolation", ("nodes", 0)),
    (NodeSpec, "sideEffects", ("nodes", 0)),
    (EdgeSpec, "map", ("edges", 0)),
    (EdgeSpec, "condition", ("edges", 0)),
    (EdgeSpec, "mode", ("edges", 0)),
    (EdgeSpec, "schema", ("edges", 0)),
    (GraphPolicies, "maxConcurrency", ("policies",)),
    (GraphPolicies, "maxDynamicNodes", ("policies",)),
    (GraphPolicies, "maxDepth", ("policies",)),
    (GraphPolicies, "maxFanOut", ("policies",)),
    (GraphPolicies, "maxTotalAttempts", ("policies",)),
    (GraphPolicies, "maxDurationMs", ("policies",)),
    (GraphPolicies, "maxCostUsd", ("policies",)),
    (GraphSpec, "stateSchema", ()),
    (GraphSpec, "policies", ()),
)


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


def test_optional_null_case_matrix_covers_every_known_graph_ir_optional_field() -> None:
    expected = {
        (model, field.alias or field_name)
        for model in GRAPH_IR_MODELS
        for field_name, field in model.model_fields.items()
        if not field.is_required()
    }
    expected.update((GraphPolicies, key) for key in GraphPolicies.known_keys())
    covered = {(model, alias) for model, alias, _ in OPTIONAL_NULL_CASES}

    assert covered == expected


@pytest.mark.parametrize(
    ("model", "alias", "path"),
    OPTIONAL_NULL_CASES,
    ids=lambda value: value.__name__ if isinstance(value, type) else str(value),
)
def test_every_known_optional_graph_ir_field_rejects_explicit_null(
    model: type[BaseModel],
    alias: str,
    path: tuple[str | int, ...],
) -> None:
    document: Any = diamond()
    target: Any = document
    for part in path:
        if isinstance(part, int):
            target = target[part]
            continue
        if part not in target:
            target[part] = {}
        target = target[part]
    target[alias] = None

    with pytest.raises(ValidationError):
        GraphSpec.model_validate(document)


def test_unknown_policy_extension_may_retain_json_null() -> None:
    document = diamond()
    document["policies"] = {"futurePolicy": None}

    graph = GraphSpec.model_validate(document)

    assert graph.policies is not None
    assert graph.policies.model_extra == {"futurePolicy": None}


@pytest.mark.parametrize("value", [None, 5])
def test_policy_extension_colliding_with_python_field_name_is_lossless(
    value: object,
) -> None:
    document = diamond()
    document["policies"] = {"max_concurrency": value}

    graph = GraphSpec.model_validate(document)

    assert graph.policies is not None
    assert graph.policies.max_concurrency is None
    assert graph.policies.model_extra == {"max_concurrency": value}
    assert graph.model_dump(mode="json", by_alias=True, exclude_unset=True) == document


def test_required_null_config_is_not_dropped_from_canonical_json() -> None:
    document = copy.deepcopy(diamond())
    document["nodes"][0]["config"] = None  # type: ignore[index]
    graph = GraphSpec.model_validate(document)

    encoded = canonical_json(graph)

    assert '"config":null' in encoded
