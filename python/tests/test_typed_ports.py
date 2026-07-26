from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from graph_engineering import (
    TYPED_PORT_POLICY_API_VERSION,
    TYPED_PORT_POLICY_KEY,
    TYPED_PORT_POLICY_MODE,
    DiagnosticCode,
    GraphSpec,
    try_compile_graph,
    validate_strict_typed_ports,
)

ROOT = Path(__file__).resolve().parents[2]


def object_schema(properties: dict[str, object]) -> dict[str, object]:
    return {
        "type": "object",
        "properties": copy.deepcopy(properties),
        "required": list(properties),
        "additionalProperties": False,
    }


def typed_graph() -> dict[str, object]:
    string = {"type": "string"}
    query_schema = object_schema({"query": string})
    split_output = object_schema({"left": string})
    merge_input = object_schema({"left": string})
    merge_output = object_schema({"answer": string})
    graph_output = object_schema({"result": string})
    return {
        "apiVersion": "graphengineering.reacher-z.github.io/v1alpha1",
        "kind": "Graph",
        "metadata": {"name": "typed", "version": "1.0.0"},
        "inputSchema": query_schema,
        "outputSchema": graph_output,
        "entrypoints": ["split"],
        "outputs": {"result": {"node": "merge", "port": "answer"}},
        "nodes": [
            {
                "id": "split",
                "kind": "transform",
                "inputSchema": copy.deepcopy(query_schema),
                "outputSchema": split_output,
                "config": None,
            },
            {
                "id": "merge",
                "kind": "transform",
                "inputSchema": merge_input,
                "outputSchema": merge_output,
                "config": None,
            },
        ],
        "edges": [
            {
                "id": "split-merge",
                "from": {"node": "split", "port": "left"},
                "to": {"node": "merge", "port": "left"},
                "schema": copy.deepcopy(string),
            }
        ],
        "policies": {
            TYPED_PORT_POLICY_KEY: {
                "apiVersion": TYPED_PORT_POLICY_API_VERSION,
                "mode": TYPED_PORT_POLICY_MODE,
            }
        },
    }


def codes(document: dict[str, object]) -> list[DiagnosticCode]:
    return [item.code for item in try_compile_graph(document).diagnostics]


def test_strict_exact_typed_graph_compiles_without_diagnostics() -> None:
    document = typed_graph()
    result = try_compile_graph(document)

    assert result.valid
    assert result.graph is not None
    assert validate_strict_typed_ports(GraphSpec.model_validate(document)) == ()


def test_legacy_graph_does_not_claim_or_enforce_typed_ports() -> None:
    document = typed_graph()
    del document["policies"]
    document["edges"][0]["from"]["port"] = "undeclared"  # type: ignore[index]
    document["edges"][0]["to"]["port"] = "undeclared"  # type: ignore[index]

    result = try_compile_graph(document)

    assert result.valid


@pytest.mark.parametrize(
    "policy",
    [
        None,
        [],
        {},
        {"apiVersion": TYPED_PORT_POLICY_API_VERSION},
        {"apiVersion": "wrong", "mode": TYPED_PORT_POLICY_MODE},
        {"apiVersion": TYPED_PORT_POLICY_API_VERSION, "mode": "loose"},
        {
            "apiVersion": TYPED_PORT_POLICY_API_VERSION,
            "mode": TYPED_PORT_POLICY_MODE,
            "extra": True,
        },
    ],
)
def test_malformed_typed_policy_fails_once_at_stable_path(policy: object) -> None:
    document = typed_graph()
    document["policies"] = {TYPED_PORT_POLICY_KEY: policy}

    result = try_compile_graph(document)

    assert [item.code for item in result.diagnostics] == [DiagnosticCode.INVALID_PORT_SCHEMA]
    assert result.diagnostics[0].path == (
        "#/policies/graphengineering.reacher-z.github.io~1typed-ports"
    )
    assert result.diagnostics[0].node_ids is None


def test_schema_profile_collects_all_ge1205_in_frozen_preflight_order() -> None:
    document = typed_graph()
    document["inputSchema"] = {"type": "invalid-input"}
    document["outputSchema"] = {"type": "invalid-output"}
    document["stateSchema"] = {"type": "invalid-state"}
    document["nodes"][0]["inputSchema"] = {"type": "invalid-node-input"}  # type: ignore[index]
    document["nodes"][1]["outputSchema"] = {"type": "invalid-node-output"}  # type: ignore[index]
    document["edges"][0]["schema"] = {"type": "invalid-edge"}  # type: ignore[index]

    result = try_compile_graph(document)

    assert [item.code for item in result.diagnostics] == [DiagnosticCode.INVALID_PORT_SCHEMA] * 6
    assert [item.path for item in result.diagnostics] == [
        "#/inputSchema",
        "#/outputSchema",
        "#/stateSchema",
        "#/nodes/0/inputSchema",
        "#/nodes/1/outputSchema",
        "#/edges/0/schema",
    ]
    assert [item.node_ids for item in result.diagnostics] == [
        None,
        None,
        None,
        ("split",),
        ("merge",),
        None,
    ]


@pytest.mark.parametrize(
    "schema",
    [
        {"$ref": "https://example.invalid/schema.json"},
        {"$ref": "other.json#/$defs/value"},
        {"$dynamicRef": "https://example.invalid/schema.json#meta"},
    ],
)
def test_external_schema_references_fail_closed(schema: dict[str, object]) -> None:
    document = typed_graph()
    document["stateSchema"] = schema

    assert codes(document) == [DiagnosticCode.INVALID_PORT_SCHEMA]


@pytest.mark.parametrize(
    "schema",
    [
        {"$defs": {"value": {"type": "string"}}, "$ref": "#/$defs/value"},
        {"$dynamicAnchor": "meta", "$dynamicRef": "#meta"},
    ],
)
def test_fragment_only_schema_references_fail_closed(schema: dict[str, object]) -> None:
    document = typed_graph()
    document["stateSchema"] = schema

    result = try_compile_graph(document)

    assert [item.code for item in result.diagnostics] == [DiagnosticCode.INVALID_PORT_SCHEMA]
    assert result.diagnostics[0].path == "#/stateSchema"


def test_same_local_ref_token_with_different_targets_fails_before_binding() -> None:
    document = typed_graph()
    document["nodes"][0]["outputSchema"] = {  # type: ignore[index]
        "$defs": {"Payload": {"type": "string"}},
        "type": "object",
        "properties": {"left": {"$ref": "#/$defs/Payload"}},
        "required": ["left"],
        "additionalProperties": False,
    }
    document["nodes"][1]["inputSchema"] = {  # type: ignore[index]
        "$defs": {"Payload": {"type": "number"}},
        "type": "object",
        "properties": {"left": {"$ref": "#/$defs/Payload"}},
        "required": ["left"],
        "additionalProperties": False,
    }

    result = try_compile_graph(document)

    assert [item.code for item in result.diagnostics] == [
        DiagnosticCode.INVALID_PORT_SCHEMA,
        DiagnosticCode.INVALID_PORT_SCHEMA,
    ]
    assert [item.path for item in result.diagnostics] == [
        "#/nodes/0/outputSchema",
        "#/nodes/1/inputSchema",
    ]
    assert [item.node_ids for item in result.diagnostics] == [("split",), ("merge",)]


@pytest.mark.parametrize(
    "dialect",
    [
        "http://json-schema.org/draft-07/schema#",
        "https://json-schema.org/draft/2020-12/schema#",
        "https://example.invalid/custom-schema",
    ],
)
def test_foreign_unknown_or_nonexact_schema_dialect_fails_closed(dialect: str) -> None:
    document = typed_graph()
    schema = {"$schema": dialect, "type": "object"}
    document["inputSchema"] = copy.deepcopy(schema)
    document["nodes"][0]["inputSchema"] = copy.deepcopy(schema)  # type: ignore[index]

    result = try_compile_graph(document)

    assert [item.code for item in result.diagnostics] == [
        DiagnosticCode.INVALID_PORT_SCHEMA,
        DiagnosticCode.INVALID_PORT_SCHEMA,
    ]
    assert [item.path for item in result.diagnostics] == [
        "#/inputSchema",
        "#/nodes/0/inputSchema",
    ]


def test_exact_draft_2020_12_schema_dialect_is_supported() -> None:
    document = typed_graph()
    schema = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
    }
    document["inputSchema"] = copy.deepcopy(schema)
    document["nodes"][0]["inputSchema"] = copy.deepcopy(schema)  # type: ignore[index]

    assert try_compile_graph(document).valid


def test_malformed_regular_expression_fails_schema_preflight() -> None:
    document = typed_graph()
    schema = {"type": "string", "pattern": "["}
    document["inputSchema"] = copy.deepcopy(schema)
    document["nodes"][0]["inputSchema"] = copy.deepcopy(schema)  # type: ignore[index]

    result = try_compile_graph(document)

    assert [item.code for item in result.diagnostics] == [
        DiagnosticCode.INVALID_PORT_SCHEMA,
        DiagnosticCode.INVALID_PORT_SCHEMA,
    ]
    assert [item.path for item in result.diagnostics] == [
        "#/inputSchema",
        "#/nodes/0/inputSchema",
    ]


@pytest.mark.parametrize(
    "schema",
    [
        {"type": "string", "pattern": "ordinary"},
        {
            "type": "object",
            "patternProperties": {"ordinary": {"type": "string"}},
        },
        {"$defs": {"unused": {"type": "string", "pattern": "ordinary"}}},
    ],
)
def test_all_regex_keywords_fail_the_v1alpha1_profile(schema: dict[str, object]) -> None:
    document = typed_graph()
    document["stateSchema"] = schema

    result = try_compile_graph(document)

    assert [item.code for item in result.diagnostics] == [DiagnosticCode.INVALID_PORT_SCHEMA]
    assert result.diagnostics[0].path == "#/stateSchema"


@pytest.mark.parametrize(
    "schema",
    [
        {"enum": []},
        {"$defs": {"unused": {"enum": []}}},
    ],
)
def test_empty_enum_fails_even_in_an_unreferenced_definition(
    schema: dict[str, object],
) -> None:
    document = typed_graph()
    document["stateSchema"] = schema

    result = try_compile_graph(document)

    assert [item.code for item in result.diagnostics] == [DiagnosticCode.INVALID_PORT_SCHEMA]
    assert result.diagnostics[0].path == "#/stateSchema"


@pytest.mark.parametrize(
    "schema",
    [
        {
            "type": "object",
            "properties": {
                "pattern": {"type": "string"},
                "$ref": {"type": "string"},
            },
        },
        {"const": {"pattern": "[", "$ref": "not-a-schema-reference", "enum": []}},
        {"default": {"patternProperties": {}, "$dynamicRef": "data"}},
        {"examples": [{"pattern": "data"}, {"enum": []}]},
        {"enum": [{"$schema": "data", "pattern": "data"}]},
    ],
)
def test_profile_walker_ignores_keywords_in_data_and_schema_map_names(
    schema: dict[str, object],
) -> None:
    document = typed_graph()
    document["stateSchema"] = schema

    assert try_compile_graph(document).valid


@pytest.mark.parametrize(
    "schema",
    [
        {"properties": {"field": {"pattern": "ordinary"}}},
        {"dependentSchemas": {"field": {"patternProperties": {}}}},
        {"additionalProperties": {"enum": []}},
        {"allOf": [{"$ref": "#"}]},
        {"dependencies": {"field": {"pattern": "ordinary"}}},
    ],
)
def test_profile_walker_checks_only_real_nested_schema_positions(
    schema: dict[str, object],
) -> None:
    document = typed_graph()
    document["stateSchema"] = schema

    result = try_compile_graph(document)

    assert [item.code for item in result.diagnostics] == [DiagnosticCode.INVALID_PORT_SCHEMA]
    assert result.diagnostics[0].path == "#/stateSchema"


def test_entrypoint_schema_mismatch_is_ge1207() -> None:
    document = typed_graph()
    document["nodes"][0]["inputSchema"] = object_schema(  # type: ignore[index]
        {"query": {"type": "number"}}
    )

    result = try_compile_graph(document)

    assert [item.code for item in result.diagnostics] == [DiagnosticCode.ENTRYPOINT_SCHEMA_MISMATCH]
    assert result.diagnostics[0].node_id == "split"
    assert result.diagnostics[0].node_ids == ("split",)
    assert result.diagnostics[0].path == "#/entrypoints/0"


def test_missing_source_port_is_ge1201_without_cascade_mismatch() -> None:
    document = typed_graph()
    document["edges"][0]["from"]["port"] = "missing"  # type: ignore[index]

    result = try_compile_graph(document)

    assert [item.code for item in result.diagnostics] == [DiagnosticCode.MISSING_SOURCE_PORT]
    assert result.diagnostics[0].edge_id == "split-merge"
    assert result.diagnostics[0].node_ids == ("split",)
    assert result.diagnostics[0].path == "#/edges/0/from/port"


def test_missing_target_port_is_ge1202_without_cascade_mismatch() -> None:
    document = typed_graph()
    document["edges"][0]["to"]["port"] = "missing"  # type: ignore[index]

    result = try_compile_graph(document)

    assert [item.code for item in result.diagnostics] == [DiagnosticCode.MISSING_TARGET_PORT]
    assert result.diagnostics[0].node_id == "merge"
    assert result.diagnostics[0].node_ids == ("merge",)
    assert result.diagnostics[0].path == "#/edges/0/to/port"


def test_source_target_schema_mismatch_is_ge1203() -> None:
    document = typed_graph()
    document["nodes"][1]["inputSchema"] = object_schema(  # type: ignore[index]
        {"left": {"type": "integer"}}
    )

    result = try_compile_graph(document)

    assert [item.code for item in result.diagnostics] == [DiagnosticCode.PORT_SCHEMA_MISMATCH]
    assert result.diagnostics[0].node_ids == ("split", "merge")


def test_edge_schema_participates_in_three_way_exact_comparison() -> None:
    document = typed_graph()
    document["edges"][0]["schema"] = {"type": "integer"}  # type: ignore[index]

    result = try_compile_graph(document)

    assert [item.code for item in result.diagnostics] == [DiagnosticCode.PORT_SCHEMA_MISMATCH]
    assert result.diagnostics[0].node_ids == ("split", "merge")
    assert result.diagnostics[0].path == "#/edges/0"


@pytest.mark.parametrize("boolean_schema", [True, False])
def test_boolean_property_subschemas_are_valid_strict_exact_ports(
    boolean_schema: bool,
) -> None:
    document = typed_graph()
    document["nodes"][0]["outputSchema"] = object_schema(  # type: ignore[index]
        {"left": boolean_schema}
    )
    document["nodes"][1]["inputSchema"] = object_schema(  # type: ignore[index]
        {"left": boolean_schema}
    )
    del document["edges"][0]["schema"]  # type: ignore[index]

    assert try_compile_graph(document).valid


def test_boolean_property_subschemas_compare_by_boolean_value() -> None:
    document = typed_graph()
    document["nodes"][0]["outputSchema"] = object_schema({"left": True})  # type: ignore[index]
    document["nodes"][1]["inputSchema"] = object_schema({"left": False})  # type: ignore[index]
    del document["edges"][0]["schema"]  # type: ignore[index]

    result = try_compile_graph(document)

    assert [item.code for item in result.diagnostics] == [DiagnosticCode.PORT_SCHEMA_MISMATCH]
    assert result.diagnostics[0].path == "#/edges/0"


def test_duplicate_target_binding_is_ge1204_on_second_declared_edge() -> None:
    document = typed_graph()
    duplicate = copy.deepcopy(document["edges"][0])  # type: ignore[index]
    duplicate["id"] = "split-merge-again"
    document["edges"].append(duplicate)  # type: ignore[union-attr]

    result = try_compile_graph(document)

    assert [item.code for item in result.diagnostics] == [DiagnosticCode.DUPLICATE_TARGET_BINDING]
    assert result.diagnostics[0].edge_id == "split-merge-again"
    assert result.diagnostics[0].node_ids == ("merge",)
    assert result.diagnostics[0].path == "#/edges/1/to/port"


def test_public_output_schema_mismatch_is_ge1206() -> None:
    document = typed_graph()
    document["outputSchema"] = object_schema({"result": {"type": "integer"}})

    result = try_compile_graph(document)

    assert [item.code for item in result.diagnostics] == [DiagnosticCode.OUTPUT_SCHEMA_MISMATCH]
    assert result.diagnostics[0].output_name == "result"
    assert result.diagnostics[0].node_ids == ("merge",)


def test_missing_public_output_port_is_ge1201() -> None:
    document = typed_graph()
    document["outputs"] = {"result": {"node": "merge", "port": "missing"}}

    result = try_compile_graph(document)

    assert [item.code for item in result.diagnostics] == [DiagnosticCode.MISSING_SOURCE_PORT]
    assert result.diagnostics[0].node_ids == ("merge",)


@pytest.mark.parametrize("mode", ["stream", "artifact-ref"])
def test_non_value_typed_edges_fail_ge1208(mode: str) -> None:
    document = typed_graph()
    document["edges"][0]["mode"] = mode  # type: ignore[index]

    result = try_compile_graph(document)

    assert [item.code for item in result.diagnostics] == [
        DiagnosticCode.UNSUPPORTED_TYPED_EDGE_MODE
    ]
    assert result.diagnostics[0].node_ids == ("split", "merge")
    assert result.diagnostics[0].path == "#/edges/0/mode"


def test_schema_object_key_insertion_order_does_not_change_exact_match() -> None:
    document = typed_graph()
    document["edges"][0]["schema"] = {"maxLength": 10, "type": "string"}  # type: ignore[index]
    document["nodes"][0]["outputSchema"] = object_schema(  # type: ignore[index]
        {"left": {"type": "string", "maxLength": 10}}
    )
    document["nodes"][1]["inputSchema"] = object_schema(  # type: ignore[index]
        {"left": {"maxLength": 10, "type": "string"}}
    )

    assert try_compile_graph(document).valid


def test_implicit_target_binding_uses_source_node_id() -> None:
    document = typed_graph()
    del document["edges"][0]["to"]["port"]  # type: ignore[index]
    document["nodes"][1]["inputSchema"] = object_schema(  # type: ignore[index]
        {"split": {"type": "string"}}
    )

    assert try_compile_graph(document).valid


def test_whole_source_schema_can_bind_without_from_port() -> None:
    document = typed_graph()
    del document["edges"][0]["from"]["port"]  # type: ignore[index]
    del document["edges"][0]["to"]["port"]  # type: ignore[index]
    del document["edges"][0]["schema"]  # type: ignore[index]
    whole = copy.deepcopy(document["nodes"][0]["outputSchema"])  # type: ignore[index]
    document["nodes"][1]["inputSchema"] = object_schema({"split": whole})  # type: ignore[index]

    assert try_compile_graph(document).valid


def test_output_diagnostics_are_sorted_by_unicode_code_point() -> None:
    document = typed_graph()
    document["outputs"] = {
        "z": {"node": "merge", "port": "answer"},
        "a": {"node": "merge", "port": "answer"},
    }
    document["outputSchema"] = object_schema({"z": {"type": "integer"}, "a": {"type": "integer"}})

    result = try_compile_graph(document)

    assert [item.output_name for item in result.diagnostics] == ["a", "z"]
    assert [item.code for item in result.diagnostics] == [
        DiagnosticCode.OUTPUT_SCHEMA_MISMATCH,
        DiagnosticCode.OUTPUT_SCHEMA_MISMATCH,
    ]


@pytest.mark.parametrize(
    ("filename", "code", "node_ids"),
    [
        (
            "invalid-typed-missing-source-port.graph.json",
            DiagnosticCode.MISSING_SOURCE_PORT,
            ("source",),
        ),
        (
            "invalid-typed-missing-target-port.graph.json",
            DiagnosticCode.MISSING_TARGET_PORT,
            ("target",),
        ),
        (
            "invalid-typed-schema-mismatch.graph.json",
            DiagnosticCode.PORT_SCHEMA_MISMATCH,
            ("source", "target"),
        ),
        (
            "invalid-typed-duplicate-binding.graph.json",
            DiagnosticCode.DUPLICATE_TARGET_BINDING,
            ("target",),
        ),
        (
            "invalid-typed-schema-profile.graph.json",
            DiagnosticCode.INVALID_PORT_SCHEMA,
            None,
        ),
        (
            "invalid-typed-output-schema.graph.json",
            DiagnosticCode.OUTPUT_SCHEMA_MISMATCH,
            ("target",),
        ),
        (
            "invalid-typed-entrypoint-schema.graph.json",
            DiagnosticCode.ENTRYPOINT_SCHEMA_MISMATCH,
            ("source",),
        ),
        (
            "invalid-typed-stream-mode.graph.json",
            DiagnosticCode.UNSUPPORTED_TYPED_EDGE_MODE,
            ("source", "target"),
        ),
    ],
)
def test_shared_typed_port_fixture_has_one_frozen_diagnostic(
    filename: str,
    code: DiagnosticCode,
    node_ids: tuple[str, ...] | None,
) -> None:
    document = json.loads((ROOT / "spec/conformance/authoring" / filename).read_text())

    result = try_compile_graph(document)

    assert [item.code for item in result.diagnostics] == [code]
    assert result.diagnostics[0].node_ids == node_ids


def test_shared_local_ref_fixture_fails_both_schema_roots_before_binding() -> None:
    document = json.loads(
        (ROOT / "spec/conformance/authoring/invalid-typed-local-ref.graph.json").read_text()
    )

    result = try_compile_graph(document)

    assert [item.code for item in result.diagnostics] == [
        DiagnosticCode.INVALID_PORT_SCHEMA,
        DiagnosticCode.INVALID_PORT_SCHEMA,
    ]
    assert [item.path for item in result.diagnostics] == [
        "#/nodes/0/outputSchema",
        "#/nodes/1/inputSchema",
    ]
    assert [item.node_ids for item in result.diagnostics] == [("source",), ("target",)]


def test_shared_boolean_subschema_fixture_is_valid() -> None:
    document = json.loads(
        (ROOT / "spec/conformance/authoring/typed-boolean-subschema.graph.json").read_text()
    )

    assert try_compile_graph(document).valid
