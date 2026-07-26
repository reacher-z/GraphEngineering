from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from graph_engineering import (
    CompiledGraphIdentity,
    DiagnosticCode,
    EdgeComponentIdentity,
    GraphCompileError,
    GraphIdentityError,
    GraphSchemaIdentity,
    GraphSpec,
    NodeComponentIdentity,
    compile_graph,
    create_compiled_graph_identity,
    verify_compiled_graph_identity,
)

ROOT = Path(__file__).resolve().parents[2]
AUTHORING_ROOT = ROOT / "spec/conformance/authoring"

DIAMOND_GRAPH_HASH = "24819fe69f3b9449c79bcdd85b2049000c7cc8f313aab5957657a6078a80d288"
SCHEMA_HASH = "c628a99a2c2801d7f6aa5a6ef5bc93c4e0d811147254b6667f44deb443319e2e"
NODE_HASHES = (
    "06fc498eea9d9573c45352d5e95d684a011a4da66e875ab0762d95e8c0911eb6",
    "855998da64d8271ac29696cf2516fc8b4d12c43953971d429a7b1e5d8e358005",
    "2b0307a852ba00c472dd75d033798ba661660a12cbf83a7bc912a9e532a51d56",
    "5d19f56b6b7ff76a3e25eb5949e6a74a5c3ea11ace27b53e3a8bc9b9c108546d",
)
EDGE_HASHES = (
    "e006f5134344cf612fd75aa748c4ec89fb2650c69a13c7a83b9f517830ae6e66",
    "5c9cd781bedd76f509926df2ab7f3c8a4e9219509f6022cb8be00c224f7a8ee7",
    "b278a48b8a64da45030bba9a2453c18eb4ee9675c324c62d5c83851fb04d3a00",
    "b0059175dfef3204a9901e129304cad038830fa185d84c48f5562053c26b8fb8",
)
REVISION_HASH = "c377417718f15ab0440ded9899f46d51a0189e6bb208df270b236344419528a6"


def diamond() -> dict[str, object]:
    return json.loads((ROOT / "spec/conformance/diamond.graph.json").read_text())


def test_diamond_component_and_revision_hashes_match_frozen_golden_values() -> None:
    identity = create_compiled_graph_identity(diamond())

    assert identity.graph_revision == 1
    assert identity.graph_hash == DIAMOND_GRAPH_HASH
    assert tuple(item.content_hash for item in identity.nodes) == NODE_HASHES
    assert tuple(item.content_hash for item in identity.edges) == EDGE_HASHES
    assert identity.graph_schemas.input == SCHEMA_HASH
    assert identity.graph_schemas.output == SCHEMA_HASH
    assert identity.graph_schemas.state is None
    assert {item.input_schema_hash for item in identity.nodes} == {SCHEMA_HASH}
    assert {item.output_schema_hash for item in identity.nodes} == {SCHEMA_HASH}
    assert identity.revision_hash == REVISION_HASH
    assert [item.index for item in identity.nodes] == [0, 1, 2, 3]
    assert [item.index for item in identity.edges] == [0, 1, 2, 3]


@pytest.mark.parametrize(
    ("identity_key", "graph_filename"),
    [
        ("equivalent", "equivalent.graph.json"),
        ("typed-ports", "typed-ports.graph.json"),
        ("unicode-and-keys", "unicode-and-keys.graph.json"),
    ],
)
def test_shared_component_identity_golden_set_is_exact(
    identity_key: str,
    graph_filename: str,
) -> None:
    expected_set = json.loads((AUTHORING_ROOT / "component-identity.expected.json").read_text())
    graph = json.loads((AUTHORING_ROOT / graph_filename).read_text())
    expected = expected_set["identities"][identity_key]

    identity = create_compiled_graph_identity(graph)

    assert identity.to_dict() == expected
    assert identity.canonical_json() == json.dumps(
        expected,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    assert verify_compiled_graph_identity(graph, expected).valid


def _apply_shared_identity_mutation(
    manifest: dict[str, object],
    mutation: dict[str, object],
) -> dict[str, object]:
    candidate = copy.deepcopy(manifest)
    path = mutation["path"]
    assert isinstance(path, str) and path.startswith("#/")
    parts = [part.replace("~1", "/").replace("~0", "~") for part in path[2:].split("/")]
    parent: object = candidate
    for part in parts[:-1]:
        parent = parent[int(part)] if isinstance(parent, list) else parent[part]  # type: ignore[index]
    final = parts[-1]
    if mutation["operation"] == "replace":
        if isinstance(parent, list):
            parent[int(final)] = mutation["value"]  # type: ignore[assignment]
        else:
            parent[final] = mutation["value"]  # type: ignore[index]
    else:
        target = parent[int(final)] if isinstance(parent, list) else parent[final]  # type: ignore[index]
        assert isinstance(target, list)
        left, right = mutation["indices"]  # type: ignore[misc]
        target[left], target[right] = target[right], target[left]
    return candidate


def test_shared_identity_mutation_cases_match_frozen_results() -> None:
    cases = json.loads((AUTHORING_ROOT / "authoring.case.json").read_text())
    golden = json.loads((AUTHORING_ROOT / "component-identity.expected.json").read_text())[
        "identities"
    ]
    graphs = {
        "equivalent": json.loads((AUTHORING_ROOT / "equivalent.graph.json").read_text()),
        "typed-ports": json.loads((AUTHORING_ROOT / "typed-ports.graph.json").read_text()),
        "unicode-and-keys": json.loads(
            (AUTHORING_ROOT / "unicode-and-keys.graph.json").read_text()
        ),
    }

    for case in cases["identityMutationCases"]:
        identity_key = case["identityKey"]
        candidate = _apply_shared_identity_mutation(
            golden[identity_key],
            case["mutation"],
        )
        result = verify_compiled_graph_identity(graphs[identity_key], candidate)
        expected = case["expect"]

        if expected.get("valid") is True:
            assert result.valid, case["name"]
            assert result.diagnostics == ()
        else:
            assert not result.valid, case["name"]
            assert [item.code.value for item in result.diagnostics] == [expected["code"]]
            assert result.diagnostics[0].path == expected["path"]


def test_component_domains_separate_equal_schema_node_and_edge_json() -> None:
    document = diamond()
    shared = {"type": "object"}
    document["nodes"][0]["config"] = copy.deepcopy(shared)  # type: ignore[index]
    document["edges"][0]["schema"] = copy.deepcopy(shared)  # type: ignore[index]
    identity = create_compiled_graph_identity(document)

    assert identity.nodes[0].content_hash != SCHEMA_HASH
    assert identity.edges[0].content_hash != SCHEMA_HASH
    assert identity.edges[0].schema_hash == SCHEMA_HASH


def test_metadata_change_does_not_change_unrelated_component_hashes() -> None:
    original = create_compiled_graph_identity(diamond())
    changed_document = diamond()
    changed_document["metadata"]["description"] = "identity-only change"  # type: ignore[index]
    changed = create_compiled_graph_identity(changed_document)

    assert changed.graph_hash != original.graph_hash
    assert changed.revision_hash != original.revision_hash
    assert changed.nodes == original.nodes
    assert changed.edges == original.edges
    assert changed.graph_schemas == original.graph_schemas


def test_node_change_updates_only_that_component_plus_graph_and_revision() -> None:
    original = create_compiled_graph_identity(diamond())
    changed_document = diamond()
    changed_document["nodes"][1]["config"] = {"changed": True}  # type: ignore[index]
    changed = create_compiled_graph_identity(changed_document)

    assert changed.graph_hash != original.graph_hash
    assert changed.revision_hash != original.revision_hash
    assert changed.nodes[0] == original.nodes[0]
    assert changed.nodes[1].content_hash != original.nodes[1].content_hash
    assert changed.nodes[1].input_schema_hash == original.nodes[1].input_schema_hash
    assert changed.nodes[1].output_schema_hash == original.nodes[1].output_schema_hash
    assert changed.nodes[2:] == original.nodes[2:]
    assert changed.edges == original.edges


def test_identity_export_is_detached_and_verifies_exactly() -> None:
    identity = create_compiled_graph_identity(diamond())
    exported = identity.to_dict()
    verified = verify_compiled_graph_identity(diamond(), exported)

    assert verified.valid
    assert verified.identity == identity
    assert verified.raise_for_errors() == identity

    exported["nodes"][0]["contentHash"] = "0" * 64  # type: ignore[index]
    assert identity.nodes[0].content_hash == NODE_HASHES[0]


@pytest.mark.parametrize("revision", [0, 2, -1, True, 2**53])
def test_revision_other_than_exact_safe_integer_one_fails_ge1301(revision: object) -> None:
    manifest = create_compiled_graph_identity(diamond()).to_dict()
    manifest["graphRevision"] = revision  # type: ignore[assignment]

    result = verify_compiled_graph_identity(diamond(), manifest)

    assert not result.valid
    assert [item.code for item in result.diagnostics] == [DiagnosticCode.UNSUPPORTED_GRAPH_REVISION]
    assert result.diagnostics[0].path == "#/graphRevision"
    with pytest.raises(GraphIdentityError):
        result.raise_for_errors()


def test_integral_float_revision_normalizes_to_json_number_one() -> None:
    manifest = create_compiled_graph_identity(diamond()).to_dict()
    manifest["graphRevision"] = 1.0  # type: ignore[assignment]

    result = verify_compiled_graph_identity(diamond(), manifest)

    assert result.valid
    assert result.diagnostics == ()


def test_graph_hash_mutation_fails_ge1302_before_components() -> None:
    manifest = create_compiled_graph_identity(diamond()).to_dict()
    manifest["graphHash"] = "0" * 64
    manifest["nodes"][0]["contentHash"] = "1" * 64  # type: ignore[index]

    result = verify_compiled_graph_identity(diamond(), manifest)

    assert [item.code for item in result.diagnostics] == [DiagnosticCode.GRAPH_IDENTITY_MISMATCH]
    assert result.diagnostics[0].path == "#/graphHash"


@pytest.mark.parametrize("mutation", ["node", "edge-order", "schema", "revision-hash", "extra"])
def test_component_order_schema_and_manifest_mutations_fail_ge1303(mutation: str) -> None:
    manifest = create_compiled_graph_identity(diamond()).to_dict()
    if mutation == "node":
        manifest["nodes"][0]["contentHash"] = "0" * 64  # type: ignore[index]
    elif mutation == "edge-order":
        manifest["edges"].reverse()  # type: ignore[union-attr]
    elif mutation == "schema":
        manifest["graphSchemas"]["input"] = "0" * 64  # type: ignore[index]
    elif mutation == "revision-hash":
        manifest["revisionHash"] = "0" * 64
    else:
        manifest["unexpected"] = True

    result = verify_compiled_graph_identity(diamond(), manifest)

    assert [item.code for item in result.diagnostics] == [
        DiagnosticCode.COMPONENT_IDENTITY_MISMATCH
    ]


@pytest.mark.parametrize(
    ("component", "position", "boolean_index"),
    [
        ("nodes", 0, False),
        ("nodes", 1, True),
        ("edges", 0, False),
        ("edges", 1, True),
    ],
)
def test_boolean_component_indices_fail_type_sensitive_identity_comparison(
    component: str,
    position: int,
    boolean_index: bool,
) -> None:
    manifest = create_compiled_graph_identity(diamond()).to_dict()
    manifest[component][position]["index"] = boolean_index  # type: ignore[index]

    result = verify_compiled_graph_identity(diamond(), manifest)

    assert [item.code for item in result.diagnostics] == [
        DiagnosticCode.COMPONENT_IDENTITY_MISMATCH
    ]


def test_identity_subclass_is_rejected_without_calling_overridden_export() -> None:
    class HostileIdentity(CompiledGraphIdentity):
        def to_dict(self) -> dict[str, object]:
            raise AssertionError("hostile identity accessor must not run")

    trusted = create_compiled_graph_identity(diamond())
    hostile = HostileIdentity(
        api_version=trusted.api_version,
        kind=trusted.kind,
        graph_revision=trusted.graph_revision,
        graph_hash=trusted.graph_hash,
        nodes=trusted.nodes,
        edges=trusted.edges,
        graph_schemas=trusted.graph_schemas,
        revision_hash=trusted.revision_hash,
    )

    result = verify_compiled_graph_identity(diamond(), hostile)

    assert [item.code for item in result.diagnostics] == [
        DiagnosticCode.COMPONENT_IDENTITY_MISMATCH
    ]


def test_hostile_manifest_key_is_rejected_without_equality_dispatch() -> None:
    calls: list[str] = []
    armed = False

    class HostileKey(str):
        __hash__ = str.__hash__

        def __eq__(self, other: object) -> bool:
            if armed:
                calls.append("eq")
                raise RuntimeError("SECRET_IDENTITY_KEY")
            return str.__eq__(self, other)

    key = HostileKey("graphRevision")
    candidate: dict[object, object] = {key: object()}
    armed = True

    result = verify_compiled_graph_identity(diamond(), candidate)  # type: ignore[arg-type]

    assert calls == []
    assert [item.code for item in result.diagnostics] == [
        DiagnosticCode.COMPONENT_IDENTITY_MISMATCH
    ]
    assert "SECRET_IDENTITY_KEY" not in result.diagnostics[0].message


@pytest.mark.parametrize("field", ["graphHash", "nodes", "unexpected"])
@pytest.mark.parametrize("revision", [1, 1.0])
def test_valid_revision_with_another_nonportable_field_is_ge1303(
    field: str,
    revision: int | float,
) -> None:
    manifest = create_compiled_graph_identity(diamond()).to_dict()
    manifest["graphRevision"] = revision  # type: ignore[assignment]
    if field == "graphHash":
        manifest["graphHash"] = object()  # type: ignore[assignment]
    elif field == "nodes":
        manifest["nodes"] = [object()]  # type: ignore[list-item]
    else:
        manifest["unexpected"] = object()  # type: ignore[assignment]

    result = verify_compiled_graph_identity(diamond(), manifest)

    assert [item.code for item in result.diagnostics] == [
        DiagnosticCode.COMPONENT_IDENTITY_MISMATCH
    ]
    assert result.diagnostics[0].path == "#"


@pytest.mark.parametrize("nested_kind", ["node", "edge", "graph-schemas"])
def test_nested_identity_subclass_is_rejected_without_calling_export(
    nested_kind: str,
) -> None:
    class HostileNode(NodeComponentIdentity):
        def to_dict(self) -> dict[str, object]:
            raise AssertionError("hostile node accessor must not run")

    class HostileEdge(EdgeComponentIdentity):
        def to_dict(self) -> dict[str, object]:
            raise AssertionError("hostile edge accessor must not run")

    class HostileSchemas(GraphSchemaIdentity):
        def to_dict(self) -> dict[str, object]:
            raise AssertionError("hostile schema accessor must not run")

    trusted = create_compiled_graph_identity(diamond())
    nodes: tuple[NodeComponentIdentity, ...] = trusted.nodes
    edges: tuple[EdgeComponentIdentity, ...] = trusted.edges
    schemas: GraphSchemaIdentity = trusted.graph_schemas
    if nested_kind == "node":
        first = trusted.nodes[0]
        nodes = (
            HostileNode(
                id=first.id,
                index=first.index,
                content_hash=first.content_hash,
                input_schema_hash=first.input_schema_hash,
                output_schema_hash=first.output_schema_hash,
            ),
            *trusted.nodes[1:],
        )
    elif nested_kind == "edge":
        first_edge = trusted.edges[0]
        edges = (
            HostileEdge(
                id=first_edge.id,
                index=first_edge.index,
                content_hash=first_edge.content_hash,
                schema_hash=first_edge.schema_hash,
            ),
            *trusted.edges[1:],
        )
    else:
        schemas = HostileSchemas(
            input=trusted.graph_schemas.input,
            output=trusted.graph_schemas.output,
            state=trusted.graph_schemas.state,
        )

    hostile = CompiledGraphIdentity(
        api_version=trusted.api_version,
        kind=trusted.kind,
        graph_revision=trusted.graph_revision,
        graph_hash=trusted.graph_hash,
        nodes=nodes,
        edges=edges,
        graph_schemas=schemas,
        revision_hash=trusted.revision_hash,
    )

    result = verify_compiled_graph_identity(diamond(), hostile)

    assert [item.code for item in result.diagnostics] == [
        DiagnosticCode.COMPONENT_IDENTITY_MISMATCH
    ]


def test_invalid_graph_verification_returns_compiler_diagnostics() -> None:
    manifest = create_compiled_graph_identity(diamond()).to_dict()
    invalid = diamond()
    invalid["edges"][0]["to"] = {"node": "missing"}  # type: ignore[index]

    result = verify_compiled_graph_identity(invalid, manifest)

    assert not result.valid
    assert result.identity is None
    assert [item.code for item in result.diagnostics] == [DiagnosticCode.MISSING_TARGET]


def test_identity_apis_reject_tampered_graph_model_without_hostile_access() -> None:
    calls: list[str] = []

    class Evil:
        def __getattribute__(self, name: str) -> object:
            if name.startswith("__"):
                calls.append(name)
                raise RuntimeError("SECRET_IDENTITY_ATTR")
            return object.__getattribute__(self, name)

    graph = GraphSpec.model_validate(diamond())
    object.__setattr__(graph.nodes[0], "config", Evil())
    trusted = create_compiled_graph_identity(diamond())

    with pytest.raises(GraphCompileError) as creation_error:
        create_compiled_graph_identity(graph)
    verification = verify_compiled_graph_identity(graph, trusted)

    assert calls == []
    assert [item.code for item in creation_error.value.diagnostics] == [
        DiagnosticCode.INVALID_GRAPH
    ]
    assert verification.identity is None
    assert [item.code for item in verification.diagnostics] == [DiagnosticCode.INVALID_GRAPH]
    assert "SECRET_IDENTITY_ATTR" not in verification.diagnostics[0].message


def test_identity_creation_revalidates_mutated_compiled_graph() -> None:
    compiled = compile_graph(diamond())
    config = compiled.spec.nodes[0].config
    assert isinstance(config, dict)
    config["unsafe"] = 2**53

    with pytest.raises(GraphCompileError):
        create_compiled_graph_identity(compiled)


def test_invalid_graph_cannot_receive_an_identity() -> None:
    document = diamond()
    document["edges"][0]["to"] = {"node": "missing"}  # type: ignore[index]

    with pytest.raises(GraphCompileError):
        create_compiled_graph_identity(document)


def test_graph_revision_field_remains_invalid_graph_ir_not_revision_two() -> None:
    document = diamond()
    document["graphRevision"] = 1

    with pytest.raises(GraphCompileError) as raised:
        create_compiled_graph_identity(document)
    assert [item.code for item in raised.value.diagnostics] == [DiagnosticCode.INVALID_GRAPH]
