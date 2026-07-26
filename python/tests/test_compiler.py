from __future__ import annotations

import json
from collections.abc import Iterator, Mapping
from pathlib import Path

import pytest

from graph_engineering import DiagnosticCode, GraphCompileError, compile_graph, try_compile_graph

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "spec/conformance"


def load_fixture(name: str) -> dict[str, object]:
    return json.loads((FIXTURES / name).read_text())


def test_diamond_topological_layers_match_conformance() -> None:
    compiled = compile_graph(load_fixture("diamond.graph.json"))

    assert compiled.topological_layers == (("split",), ("left", "right"), ("merge",))
    assert compiled.topological_order == ("split", "left", "right", "merge")


@pytest.mark.parametrize(
    ("fixture", "code"),
    [
        ("invalid-duplicate-node.graph.json", DiagnosticCode.DUPLICATE_NODE),
        ("invalid-missing-endpoint.graph.json", DiagnosticCode.MISSING_TARGET),
        ("invalid-cycle.graph.json", DiagnosticCode.CYCLE),
        ("invalid-unreachable.graph.json", DiagnosticCode.UNREACHABLE_NODE),
    ],
)
def test_invalid_conformance_fixtures(fixture: str, code: DiagnosticCode) -> None:
    result = try_compile_graph(load_fixture(fixture))

    assert not result.valid
    assert [diagnostic.code for diagnostic in result.diagnostics] == [code]
    with pytest.raises(GraphCompileError):
        result.raise_for_errors()


def test_missing_entrypoint_and_output_are_structured() -> None:
    document = load_fixture("diamond.graph.json")
    document["entrypoints"] = ["missing-entry"]
    document["outputs"] = {"result": {"node": "missing-output"}}

    result = try_compile_graph(document)

    assert [item.code for item in result.diagnostics] == [
        DiagnosticCode.MISSING_ENTRYPOINT,
        DiagnosticCode.MISSING_OUTPUT,
    ]


def test_entrypoint_with_incoming_edge_matches_conformance_order() -> None:
    result = try_compile_graph(load_fixture("invalid-entrypoint-incoming.graph.json"))

    assert [item.code for item in result.diagnostics] == [
        DiagnosticCode.ENTRYPOINT_HAS_INCOMING,
        DiagnosticCode.UNREACHABLE_NODE,
    ]


def test_schema_validation_becomes_invalid_graph_diagnostic() -> None:
    document = load_fixture("diamond.graph.json")
    document["unexpected"] = True

    result = try_compile_graph(document)

    assert [item.code for item in result.diagnostics] == [DiagnosticCode.INVALID_GRAPH]


def test_policy_limits_produce_stable_diagnostics() -> None:
    document = load_fixture("diamond.graph.json")
    document["policies"] = {"maxFanOut": 1, "maxDepth": 2}

    result = try_compile_graph(document)

    assert [item.code for item in result.diagnostics] == [
        DiagnosticCode.MAX_FAN_OUT,
        DiagnosticCode.MAX_DEPTH,
    ]


def test_lone_surrogate_graph_string_matches_typescript_canonical_hash() -> None:
    document = load_fixture("diamond.graph.json")
    document["nodes"][0]["config"] = json.loads(  # type: ignore[index]
        r'{"text":"\ud800"}'
    )

    result = try_compile_graph(document)

    assert result.valid
    assert result.graph is not None
    assert result.graph.graph_hash == (
        "d91e54cf6bda86fc7c93b4d433ab58756346e14c0fb421bb25a0d23f43371023"
    )


class _HostileMapping(Mapping[str, object]):
    def __getitem__(self, key: str) -> object:
        raise RuntimeError("hostile mapping access")

    def __iter__(self) -> Iterator[str]:
        raise RuntimeError("hostile mapping iteration")

    def __len__(self) -> int:
        raise RuntimeError("hostile mapping length")


def test_hostile_graph_mapping_returns_stable_invalid_graph_diagnostic() -> None:
    result = try_compile_graph(_HostileMapping())

    assert result.graph is None
    assert len(result.diagnostics) == 1
    assert result.diagnostics[0].code is DiagnosticCode.INVALID_GRAPH


def test_noncanonical_graph_number_returns_invalid_graph_instead_of_leaking() -> None:
    document = load_fixture("diamond.graph.json")
    document["nodes"][0]["config"] = {"bad": float("nan")}  # type: ignore[index]

    result = try_compile_graph(document)

    assert result.graph is None
    assert [item.code for item in result.diagnostics] == [DiagnosticCode.INVALID_GRAPH]
    assert result.diagnostics[0].message == "graph input could not be inspected safely"


def test_surrogate_pair_key_collision_returns_invalid_graph() -> None:
    scalar = json.loads(r'"\ud83d\ude00"')
    explicit_pair = "\ud83d\ude00"
    document = load_fixture("diamond.graph.json")
    document["nodes"][0]["config"] = {  # type: ignore[index]
        explicit_pair: 1,
        scalar: 2,
    }

    result = try_compile_graph(document)

    assert result.graph is None
    assert [item.code for item in result.diagnostics] == [DiagnosticCode.INVALID_GRAPH]
    assert result.diagnostics[0].message == "graph input could not be inspected safely"
