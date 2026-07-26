from __future__ import annotations

import copy
import json
import time
from collections.abc import Iterator, Mapping
from pathlib import Path
from unittest.mock import patch

import pytest

from graph_engineering import (
    TYPED_PORT_POLICY_KEY,
    BuilderErrorCode,
    DiagnosticCode,
    EdgeSpec,
    Endpoint,
    GraphBuilderError,
    GraphPolicies,
    Metadata,
    NodeSpec,
    canonical_json,
    compile_graph,
    create_compiled_graph_identity,
    graph_builder,
    parse_graph_source,
    try_compile_graph,
)

ROOT = Path(__file__).resolve().parents[2]
CANONICAL_NUMBER_CASE = json.loads(
    (ROOT / "spec/conformance/canonical-number.case.json").read_text()
)


def diamond() -> dict[str, object]:
    return json.loads((ROOT / "spec/conformance/diamond.graph.json").read_text())


def builder_from_document(document: dict[str, object]):
    builder = graph_builder(
        metadata=document["metadata"],  # type: ignore[arg-type]
        input_schema=document["inputSchema"],  # type: ignore[arg-type]
        output_schema=document["outputSchema"],  # type: ignore[arg-type]
        **({"state_schema": document["stateSchema"]} if "stateSchema" in document else {}),
        **({"policies": document["policies"]} if "policies" in document else {}),
    )
    for node in document["nodes"]:  # type: ignore[union-attr]
        builder.add_node(node)
    for edge in document["edges"]:  # type: ignore[union-attr]
        builder.add_edge(edge)
    for entrypoint in document["entrypoints"]:  # type: ignore[union-attr]
        builder.add_entrypoint(entrypoint)
    for name, endpoint in document["outputs"].items():  # type: ignore[union-attr]
        builder.add_output(name, endpoint)
    return builder


def test_general_builder_matches_graph_document_canonical_hash_and_order() -> None:
    document = diamond()
    built = builder_from_document(document).build()

    assert built.graph.model_dump(mode="json", by_alias=True, exclude_unset=True) == document
    assert built.canonical_graph == canonical_json(document)
    assert built.graph_hash == built.graph.canonical_hash()
    assert [node.id for node in built.graph.nodes] == [
        node["id"]
        for node in document["nodes"]  # type: ignore[index]
    ]
    assert [edge.id for edge in built.graph.edges] == [
        edge["id"]
        for edge in document["edges"]  # type: ignore[index]
    ]
    assert built.identity.graph_hash == built.graph_hash


def test_builder_preserves_fractional_canonical_bytes_and_hash() -> None:
    case = CANONICAL_NUMBER_CASE["wholeGraph"]
    document = case["document"]

    built = builder_from_document(document).build()

    assert built.canonical_graph == case["canonicalGraph"]
    assert built.graph_hash == case["sha256"]
    assert canonical_json(built.graph) == case["canonicalGraph"]
    assert compile_graph(document).graph_hash == case["sha256"]
    assert built.identity.to_dict() == case["identity"]


def test_thousand_node_fractional_builder_identity_stays_within_e2e_ceiling() -> None:
    node_count = 1_000
    author = graph_builder(
        metadata={"name": "fractional-ceiling", "version": "1.0.0"},
        input_schema={"type": "object"},
        output_schema={"type": "object"},
    )
    started = time.monotonic()
    for index in range(node_count):
        node_id = f"n{index}"
        author.add_node(
            {
                "id": node_id,
                "kind": "transform",
                "inputSchema": {"type": "object"},
                "outputSchema": {"type": "object"},
                "config": {"epsilon": 0.000001},
            }
        )
        if index > 0:
            author.add_edge(
                {
                    "id": f"e{index - 1}-{index}",
                    "from": {"node": f"n{index - 1}"},
                    "to": {"node": node_id},
                }
            )
    author.add_entrypoint("n0")
    author.add_output("result", {"node": f"n{node_count - 1}"})

    built = author.build()
    elapsed = time.monotonic() - started

    assert len(built.identity.nodes) == node_count
    assert built.graph_hash == built.identity.graph_hash
    assert elapsed < 5.0, f"1k fractional builder+identity took {elapsed:.3f}s"


def test_successful_build_invokes_the_canonical_compiler_exactly_once() -> None:
    with patch(
        "graph_engineering.builder.try_compile_graph",
        wraps=try_compile_graph,
    ) as compiler:
        built = builder_from_document(diamond()).build()

    assert built.identity.graph_hash == built.graph_hash
    assert compiler.call_count == 1


def test_inputs_are_snapshotted_when_added_and_returned_graphs_are_detached() -> None:
    document = diamond()
    first_node = document["nodes"][0]  # type: ignore[index]
    builder = builder_from_document(document)

    first_node["config"]["mutatedAfterAdd"] = True  # type: ignore[index]
    document["inputSchema"]["mutatedAfterConstructor"] = True  # type: ignore[index]
    built = builder.build()
    baseline_hash = built.graph_hash
    baseline_identity = built.identity.to_dict()

    first_projection = built.graph
    first_projection.input_schema["callerMutation"] = True
    config = first_projection.nodes[0].config
    assert isinstance(config, dict)
    config["callerMutation"] = True
    identity_projection = built.identity.to_dict()
    identity_projection["nodes"][0]["contentHash"] = "0" * 64  # type: ignore[index]

    second_projection = built.graph
    assert "mutatedAfterAdd" not in second_projection.nodes[0].config  # type: ignore[operator]
    assert "mutatedAfterConstructor" not in second_projection.input_schema
    assert "callerMutation" not in second_projection.input_schema
    assert "callerMutation" not in second_projection.nodes[0].config  # type: ignore[operator]
    assert built.graph_hash == baseline_hash
    assert built.identity.to_dict() == baseline_identity


@pytest.mark.parametrize(
    ("mutation", "code", "path"),
    [
        ("node", BuilderErrorCode.DUPLICATE_NODE, "#/nodes/4/id"),
        ("edge", BuilderErrorCode.DUPLICATE_EDGE, "#/edges/4/id"),
        (
            "entrypoint",
            BuilderErrorCode.DUPLICATE_ENTRYPOINT,
            "#/entrypoints/1",
        ),
        ("output", BuilderErrorCode.DUPLICATE_OUTPUT, "#/outputs/result"),
    ],
)
def test_duplicate_authoring_values_fail_before_core_compile(
    mutation: str, code: BuilderErrorCode, path: str
) -> None:
    document = diamond()
    builder = builder_from_document(document)

    with pytest.raises(GraphBuilderError) as raised:
        if mutation == "node":
            builder.add_node(document["nodes"][0])  # type: ignore[index]
        elif mutation == "edge":
            builder.add_edge(document["edges"][0])  # type: ignore[index]
        elif mutation == "entrypoint":
            builder.add_entrypoint(document["entrypoints"][0])  # type: ignore[index]
        else:
            builder.add_output("result", document["outputs"]["result"])  # type: ignore[index]

    assert raised.value.code is code
    assert raised.value.path == path
    assert raised.value.diagnostics == ()


def test_build_requires_explicit_entrypoint_and_output_without_inference() -> None:
    document = diamond()
    builder = graph_builder(
        metadata=document["metadata"],  # type: ignore[arg-type]
        input_schema=document["inputSchema"],  # type: ignore[arg-type]
        output_schema=document["outputSchema"],  # type: ignore[arg-type]
    ).add_node(document["nodes"][0])  # type: ignore[index]

    with pytest.raises(GraphBuilderError) as missing_entrypoint:
        builder.build()
    assert missing_entrypoint.value.code is BuilderErrorCode.MISSING_REQUIRED
    assert missing_entrypoint.value.path == "#/entrypoints"

    builder.add_entrypoint("split")
    with pytest.raises(GraphBuilderError) as missing_output:
        builder.build()
    assert missing_output.value.code is BuilderErrorCode.MISSING_REQUIRED
    assert missing_output.value.path == "#/outputs"


@pytest.mark.parametrize(
    ("kwargs", "path"),
    [
        ({"input_schema": {}, "output_schema": {}}, "#/metadata"),
        (
            {"metadata": {"name": "missing-input", "version": "1"}, "output_schema": {}},
            "#/inputSchema",
        ),
        (
            {"metadata": {"name": "missing-output", "version": "1"}, "input_schema": {}},
            "#/outputSchema",
        ),
    ],
)
def test_missing_constructor_values_are_structured(kwargs: dict[str, object], path: str) -> None:
    with pytest.raises(GraphBuilderError) as raised:
        graph_builder(**kwargs)

    assert raised.value.code is BuilderErrorCode.MISSING_REQUIRED
    assert raised.value.path == path


def test_core_rejection_preserves_full_structured_diagnostics() -> None:
    document = diamond()
    document["outputs"] = {"result": {"node": "missing"}}
    builder = builder_from_document(document)

    with pytest.raises(GraphBuilderError) as raised:
        builder.build()

    assert raised.value.code is BuilderErrorCode.CORE_REJECTED
    assert [item.code for item in raised.value.diagnostics] == [DiagnosticCode.MISSING_OUTPUT]
    assert raised.value.to_dict()["diagnostics"][0]["code"] == (  # type: ignore[index]
        DiagnosticCode.MISSING_OUTPUT.value
    )


def test_successful_build_seals_every_mutation_and_second_build() -> None:
    document = diamond()
    builder = builder_from_document(document)
    builder.build()

    operations = (
        (lambda: builder.add_node(_HostileMapping()), "#/nodes/4"),
        (lambda: builder.add_edge(_HostileMapping()), "#/edges/4"),
        (lambda: builder.add_entrypoint("another"), "#/entrypoints/1"),
        (lambda: builder.add_output("another", {"node": "merge"}), "#/outputs/another"),
        (lambda: builder.set_policies(_HostileMapping()), "#/policies"),
        (builder.enable_strict_typed_ports, "#/policies"),
        (builder.build, "#"),
    )
    for operation, path in operations:
        with pytest.raises(GraphBuilderError) as raised:
            operation()
        assert raised.value.code is BuilderErrorCode.SEALED
        assert raised.value.path == path


class _HostileMapping(Mapping[str, object]):
    def __getitem__(self, key: str) -> object:
        raise AssertionError("hostile mapping getter executed")

    def __iter__(self) -> Iterator[str]:
        raise AssertionError("hostile mapping iterator executed")

    def __len__(self) -> int:
        raise AssertionError("hostile mapping length executed")


@pytest.mark.parametrize("target", ["metadata", "schema", "node", "edge", "endpoint"])
def test_hostile_mappings_are_rejected_without_execution(target: str) -> None:
    document = diamond()
    hostile = _HostileMapping()

    with pytest.raises(GraphBuilderError) as raised:
        if target == "metadata":
            graph_builder(
                metadata=hostile,  # type: ignore[arg-type]
                input_schema={},
                output_schema={},
            )
        elif target == "schema":
            graph_builder(
                metadata=document["metadata"],  # type: ignore[arg-type]
                input_schema=hostile,  # type: ignore[arg-type]
                output_schema={},
            )
        elif target == "node":
            graph_builder(
                metadata=document["metadata"],  # type: ignore[arg-type]
                input_schema={},
                output_schema={},
            ).add_node(hostile)  # type: ignore[arg-type]
        elif target == "edge":
            graph_builder(
                metadata=document["metadata"],  # type: ignore[arg-type]
                input_schema={},
                output_schema={},
            ).add_edge(hostile)  # type: ignore[arg-type]
        else:
            graph_builder(
                metadata=document["metadata"],  # type: ignore[arg-type]
                input_schema={},
                output_schema={},
            ).add_output("result", hostile)  # type: ignore[arg-type]

    assert raised.value.code is BuilderErrorCode.INVALID_INPUT


@pytest.mark.parametrize("target", ["metadata", "node", "edge", "endpoint", "policies"])
def test_tampered_exact_models_are_rejected_without_nested_accessor_execution(
    target: str,
) -> None:
    calls: list[str] = []

    class Evil:
        def __getattribute__(self, name: str) -> object:
            if name.startswith("__"):
                calls.append(name)
                raise RuntimeError("SECRET_ATTR")
            return object.__getattribute__(self, name)

    document = diamond()
    evil = Evil()

    with pytest.raises(GraphBuilderError) as raised:
        if target == "metadata":
            metadata = Metadata.model_validate(document["metadata"])
            object.__setattr__(metadata, "labels", evil)
            graph_builder(metadata=metadata, input_schema={}, output_schema={})
        elif target == "node":
            node = NodeSpec.model_validate(document["nodes"][0])  # type: ignore[index]
            object.__setattr__(node, "config", evil)
            graph_builder(
                metadata=document["metadata"],  # type: ignore[arg-type]
                input_schema={},
                output_schema={},
            ).add_node(node)
        elif target == "edge":
            edge = EdgeSpec.model_validate(document["edges"][0])  # type: ignore[index]
            object.__setattr__(edge, "source", evil)
            graph_builder(
                metadata=document["metadata"],  # type: ignore[arg-type]
                input_schema={},
                output_schema={},
            ).add_edge(edge)
        elif target == "endpoint":
            endpoint = Endpoint.model_validate({"node": "merge"})
            object.__setattr__(endpoint, "port", evil)
            graph_builder(
                metadata=document["metadata"],  # type: ignore[arg-type]
                input_schema={},
                output_schema={},
            ).add_output("result", endpoint)
        else:
            policies = GraphPolicies.model_validate({"future": {"enabled": True}})
            extras = object.__getattribute__(policies, "__pydantic_extra__")
            assert isinstance(extras, dict)
            extras["future"] = evil
            graph_builder(
                metadata=document["metadata"],  # type: ignore[arg-type]
                input_schema={},
                output_schema={},
                policies=policies,
            )

    assert calls == []
    assert raised.value.code is BuilderErrorCode.INVALID_INPUT
    assert "SECRET_ATTR" not in raised.value.message


def test_hostile_metaclass_name_is_not_inspected_on_portable_rejection() -> None:
    calls: list[str] = []

    class HostileMeta(type):
        def __getattribute__(cls, name: str) -> object:
            if name == "__name__":
                calls.append(name)
                raise RuntimeError("SECRET_META")
            return type.__getattribute__(cls, name)

    class Evil(metaclass=HostileMeta):
        pass

    document = diamond()
    node = copy.deepcopy(document["nodes"][0])  # type: ignore[index]
    node["config"] = Evil()
    builder = graph_builder(
        metadata=document["metadata"],  # type: ignore[arg-type]
        input_schema={},
        output_schema={},
    )

    with pytest.raises(GraphBuilderError) as raised:
        builder.add_node(node)

    assert calls == []
    assert raised.value.code is BuilderErrorCode.INVALID_INPUT
    assert "SECRET_META" not in raised.value.message


def test_cycles_unsafe_numbers_and_optional_null_fail_locally() -> None:
    cyclic: dict[str, object] = {}
    cyclic["self"] = cyclic
    document = diamond()
    bad_node = copy.deepcopy(document["nodes"][0])  # type: ignore[index]
    bad_node["config"] = cyclic

    builder = graph_builder(
        metadata=document["metadata"],  # type: ignore[arg-type]
        input_schema={},
        output_schema={},
    )
    with pytest.raises(GraphBuilderError) as cycle:
        builder.add_node(bad_node)
    assert cycle.value.code is BuilderErrorCode.INVALID_INPUT

    bad_node["config"] = {"unsafe": 2**53}
    with pytest.raises(GraphBuilderError) as unsafe:
        builder.add_node(bad_node)
    assert unsafe.value.code is BuilderErrorCode.INVALID_INPUT

    bad_node["config"] = None
    bad_node["retry"] = None
    with pytest.raises(GraphBuilderError) as optional_null:
        builder.add_node(bad_node)
    assert optional_null.value.code is BuilderErrorCode.INVALID_INPUT


def test_required_config_null_and_unknown_policy_null_are_preserved() -> None:
    document = diamond()
    document["nodes"][0]["config"] = None  # type: ignore[index]
    document["policies"] = {"futurePolicy": None}

    built = builder_from_document(document).build()

    assert built.graph.nodes[0].config is None
    assert built.graph.policies is not None
    assert built.graph.policies.model_extra == {"futurePolicy": None}
    assert '"config":null' in built.canonical_graph


def test_reserved_output_names_are_data_and_cannot_pollute_builder_state() -> None:
    document = diamond()
    document["outputs"] = {
        "__proto__": {"node": "merge"},
        "constructor": {"node": "merge"},
    }

    built = builder_from_document(document).build()

    assert list(built.graph.outputs) == ["__proto__", "constructor"]


def test_strict_typed_port_helper_is_explicit_and_never_overwrites_policy() -> None:
    document = diamond()
    builder = graph_builder(
        metadata=document["metadata"],  # type: ignore[arg-type]
        input_schema=document["inputSchema"],  # type: ignore[arg-type]
        output_schema=document["outputSchema"],  # type: ignore[arg-type]
        policies={"futurePolicy": None},
    )
    builder.enable_strict_typed_ports()

    with pytest.raises(GraphBuilderError) as duplicate:
        builder.enable_strict_typed_ports()
    assert duplicate.value.code is BuilderErrorCode.INVALID_INPUT


def test_set_policies_replaces_the_complete_prior_snapshot_without_aliasing() -> None:
    document = diamond()
    replacement: dict[str, object] = {"replacementPolicy": {"enabled": True}}
    builder = builder_from_document(document)
    builder.enable_strict_typed_ports().set_policies(replacement)
    replacement["replacementPolicy"] = {"enabled": False}

    built = builder.build()

    assert built.graph.policies is not None
    assert built.graph.policies.model_extra == {"replacementPolicy": {"enabled": True}}
    assert TYPED_PORT_POLICY_KEY not in built.graph.policies.model_extra


def test_failed_build_does_not_falsely_seal_builder() -> None:
    document = diamond()
    builder = graph_builder(
        metadata=document["metadata"],  # type: ignore[arg-type]
        input_schema={},
        output_schema={},
    )
    with pytest.raises(GraphBuilderError):
        builder.build()

    builder.add_entrypoint("later")


@pytest.mark.parametrize(
    "filename",
    [
        "equivalent.graph.yaml",
        "declaration-order.graph.yaml",
        "explicit-null-config.graph.yaml",
        "safe-integer-edges.graph.yaml",
        "typed-ports.graph.yaml",
        "yaml-scalars.graph.yaml",
    ],
)
def test_shared_yaml_and_python_builder_paths_are_exactly_equivalent(
    filename: str,
) -> None:
    source = (ROOT / "spec/conformance/authoring" / filename).read_bytes()
    document = parse_graph_source(source, format="yaml")
    assert isinstance(document, dict)

    built = builder_from_document(document).build()

    assert built.graph.model_dump(mode="json", by_alias=True, exclude_unset=True) == document
    assert built.canonical_graph == canonical_json(document)
    assert built.graph_hash == compile_graph(document).graph_hash


@pytest.mark.parametrize("stem", ["equivalent", "typed-ports"])
def test_shared_json_yaml_and_builder_paths_match_exactly(stem: str) -> None:
    fixture_dir = ROOT / "spec/conformance/authoring"
    json_document = parse_graph_source(
        (fixture_dir / f"{stem}.graph.json").read_bytes(), format="json"
    )
    yaml_document = parse_graph_source(
        (fixture_dir / f"{stem}.graph.yaml").read_bytes(), format="yaml"
    )
    assert isinstance(json_document, dict)
    assert isinstance(yaml_document, dict)
    built = builder_from_document(json_document).build()
    source_identity = create_compiled_graph_identity(yaml_document)

    assert yaml_document == json_document
    assert built.graph.model_dump(mode="json", by_alias=True, exclude_unset=True) == json_document
    assert built.canonical_graph == canonical_json(yaml_document)
    assert built.graph_hash == compile_graph(yaml_document).graph_hash
    assert built.identity.to_dict() == source_identity.to_dict()
