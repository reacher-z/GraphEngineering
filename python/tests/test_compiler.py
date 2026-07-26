from __future__ import annotations

import json
from collections.abc import Iterator, Mapping
from pathlib import Path

import pytest

from graph_engineering import (
    DiagnosticCode,
    GraphCompileError,
    GraphSpec,
    canonical_json,
    canonical_sha256,
    compile_graph,
    try_compile_graph,
)

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "spec/conformance"


def load_fixture(name: str) -> dict[str, object]:
    return json.loads((FIXTURES / name).read_text())


def test_diamond_topological_layers_match_conformance() -> None:
    document = load_fixture("diamond.graph.json")
    result = try_compile_graph(document)
    compiled = result.raise_for_errors()

    assert compiled.topological_layers == (("split",), ("left", "right"), ("merge",))
    assert compiled.topological_order == ("split", "left", "right", "merge")
    assert result.canonical_graph == canonical_json(document)
    assert result.graph_hash == compiled.graph_hash == canonical_sha256(document)
    assert result.entrypoints == ("split",)
    assert result.topological_layers == compiled.topological_layers


@pytest.mark.parametrize(
    ("fixture", "code"),
    [
        ("invalid-duplicate-node.graph.json", DiagnosticCode.DUPLICATE_NODE),
        ("invalid-missing-endpoint.graph.json", DiagnosticCode.MISSING_TARGET),
        ("invalid-cycle.graph.json", DiagnosticCode.CYCLE),
        ("invalid-unreachable.graph.json", DiagnosticCode.UNREACHABLE_NODE),
        ("invalid-oversized-timers.graph.json", DiagnosticCode.INVALID_GRAPH),
    ],
)
def test_invalid_conformance_fixtures(fixture: str, code: DiagnosticCode) -> None:
    result = try_compile_graph(load_fixture(fixture))

    assert not result.valid
    assert [diagnostic.code for diagnostic in result.diagnostics] == [code]
    with pytest.raises(GraphCompileError):
        result.raise_for_errors()


@pytest.mark.parametrize(
    "fixture",
    [
        "invalid-null-metadata-description.graph.json",
        "invalid-null-state-schema.graph.json",
        "invalid-null-output-port.graph.json",
        "invalid-null-node-retry.graph.json",
    ],
)
def test_explicit_null_optional_field_fixtures_report_only_invalid_graph(
    fixture: str,
) -> None:
    result = try_compile_graph(load_fixture(fixture))

    assert not result.valid
    assert result.graph is None
    assert [item.code for item in result.diagnostics] == [DiagnosticCode.INVALID_GRAPH]


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
    assert result.canonical_graph is None
    assert result.graph_hash is None
    assert result.entrypoints == ()
    assert result.topological_layers == ()


@pytest.mark.parametrize(
    ("fixture", "layers"),
    [
        ("invalid-duplicate-node.graph.json", ()),
        ("invalid-missing-endpoint.graph.json", ()),
        ("invalid-cycle.graph.json", ()),
        ("invalid-unreachable.graph.json", (("start", "orphan"),)),
        ("invalid-entrypoint-incoming.graph.json", (("root",), ("child",))),
    ],
)
def test_semantic_invalid_result_retains_typescript_projection(
    fixture: str,
    layers: tuple[tuple[str, ...], ...],
) -> None:
    document = load_fixture(fixture)
    result = try_compile_graph(document)

    assert not result.valid
    assert result.graph is None
    assert result.canonical_graph == canonical_json(document)
    assert result.graph_hash == canonical_sha256(document)
    assert result.entrypoints == tuple(document["entrypoints"])  # type: ignore[arg-type]
    assert result.topological_layers == layers


def test_cycle_result_retains_completed_acyclic_layers() -> None:
    document = load_fixture("invalid-cycle.graph.json")
    independent = json.loads(json.dumps(document["nodes"][0]))  # type: ignore[index]
    independent["id"] = "independent"
    document["nodes"].append(independent)  # type: ignore[union-attr]
    document["entrypoints"].append("independent")  # type: ignore[union-attr]

    result = try_compile_graph(document)

    assert [item.code for item in result.diagnostics] == [DiagnosticCode.CYCLE]
    assert result.topological_layers == (("independent",),)


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


@pytest.mark.parametrize(
    "policy_name",
    [
        "maxConcurrency",
        "maxDynamicNodes",
        "maxDepth",
        "maxFanOut",
        "maxTotalAttempts",
        "maxDurationMs",
    ],
)
def test_graph_policy_integers_reject_values_above_javascript_safe_range(
    policy_name: str,
) -> None:
    document = load_fixture("diamond.graph.json")
    document["policies"] = {policy_name: 2**53}

    result = try_compile_graph(document)

    assert result.graph is None
    assert [item.code for item in result.diagnostics] == [DiagnosticCode.INVALID_GRAPH]


@pytest.mark.parametrize(
    ("field_name", "value"),
    [
        ("timeoutMs", 2**53),
        ("initialDelayMs", 2**53),
        ("maxDelayMs", 2**53),
        ("backoffMultiplier", float(2**53)),
    ],
)
def test_node_timing_numbers_must_be_portable(field_name: str, value: object) -> None:
    document = load_fixture("diamond.graph.json")
    node = document["nodes"][0]  # type: ignore[index]
    if field_name == "timeoutMs":
        node[field_name] = value
    else:
        node["retry"] = {field_name: value}

    result = try_compile_graph(document)

    assert result.graph is None
    assert [item.code for item in result.diagnostics] == [DiagnosticCode.INVALID_GRAPH]


def test_timer_fields_accept_the_shared_32_bit_maximum() -> None:
    document = load_fixture("diamond.graph.json")
    node = document["nodes"][0]  # type: ignore[index]
    node["timeoutMs"] = 2**31 - 1
    node["retry"] = {
        "initialDelayMs": 2**31 - 1,
        "maxDelayMs": 2**31 - 1,
    }
    document["policies"] = {"maxDurationMs": 2**31 - 1}

    assert try_compile_graph(document).valid


@pytest.mark.parametrize("value", [float("nan"), float("inf"), float(2**53)])
def test_max_cost_must_be_finite_portable_json(value: float) -> None:
    document = load_fixture("diamond.graph.json")
    document["policies"] = {"maxCostUsd": value}

    result = try_compile_graph(document)

    assert result.graph is None
    assert [item.code for item in result.diagnostics] == [DiagnosticCode.INVALID_GRAPH]


def test_compiling_a_model_instance_detaches_and_revalidates_nested_json() -> None:
    compiled = compile_graph(load_fixture("diamond.graph.json"))
    config = compiled.spec.nodes[0].config
    assert isinstance(config, dict)
    config["unsafe"] = 2**53

    result = try_compile_graph(compiled.spec)

    assert result.graph is None
    assert [item.code for item in result.diagnostics] == [DiagnosticCode.INVALID_GRAPH]


def test_tampered_exact_graph_model_is_rejected_without_hostile_access() -> None:
    calls: list[str] = []

    class Evil:
        def __getattribute__(self, name: str) -> object:
            if name.startswith("__"):
                calls.append(name)
                raise RuntimeError("SECRET_GRAPH_ATTR")
            return object.__getattribute__(self, name)

    graph = GraphSpec.model_validate(load_fixture("diamond.graph.json"))
    object.__setattr__(graph.nodes[0], "config", Evil())

    result = try_compile_graph(graph)

    assert calls == []
    assert result.graph is None
    assert [item.code for item in result.diagnostics] == [DiagnosticCode.INVALID_GRAPH]
    assert "SECRET_GRAPH_ATTR" not in result.diagnostics[0].message
