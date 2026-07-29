from __future__ import annotations

import copy
import hashlib
import json
from collections.abc import Iterator, Mapping
from pathlib import Path

import pytest

from graph_engineering.compiler import Diagnostic, DiagnosticCode, try_compile_graph
from graph_engineering.integrated_router import (
    InvalidRouterValue,
    ValidRegisteredCondition,
    ValidRouterPolicy,
    validate_registered_edge_condition,
    validate_route_selection_policy,
)

ROOT = Path(__file__).resolve().parents[2]
CORPUS_PATH = ROOT / "spec/conformance/integrated-router.case.json"


@pytest.fixture(scope="module")
def corpus() -> dict[str, object]:
    return json.loads(CORPUS_PATH.read_text())


def _cases(corpus: dict[str, object], key: str) -> list[dict[str, object]]:
    value = corpus[key]
    assert type(value) is list
    assert all(type(item) is dict for item in value)
    return value  # type: ignore[return-value]


def _diagnostic_projection(diagnostic: Diagnostic) -> dict[str, object]:
    projected: dict[str, object] = {"code": diagnostic.code.value}
    if diagnostic.path is not None:
        projected["path"] = diagnostic.path
    if diagnostic.node_ids is not None:
        projected["nodeIds"] = list(diagnostic.node_ids)
    if diagnostic.edge_id is not None:
        projected["edgeId"] = diagnostic.edge_id
    return projected


def test_all_policy_validation_cases_match_literal_corpus(
    corpus: dict[str, object],
) -> None:
    cases = _cases(corpus, "policyValidationCases")
    assert len(cases) == 29
    for case in cases:
        expected = case["expect"]
        assert type(expected) is dict
        result = validate_route_selection_policy(case["value"])
        assert result.valid is expected["valid"], case["name"]
        if expected["valid"]:
            assert type(result) is ValidRouterPolicy
            assert result.policy.allowed_routes
        else:
            assert type(result) is InvalidRouterValue
            assert DiagnosticCode(expected["code"]) is DiagnosticCode.INVALID_ROUTER_POLICY
            assert result.relative_path == expected["relativePath"], case["name"]


def test_all_condition_registry_cases_match_literal_corpus(
    corpus: dict[str, object],
) -> None:
    cases = _cases(corpus, "conditionValidationCases")
    assert len(cases) == 14
    for case in cases:
        expected = case["expect"]
        assert type(expected) is dict
        result = validate_registered_edge_condition(case["value"])
        assert result.valid is expected["valid"], case["name"]
        if expected["valid"]:
            assert type(result) is ValidRegisteredCondition
            assert result.owner == expected["owner"], case["name"]
        else:
            assert type(result) is InvalidRouterValue
            assert DiagnosticCode(expected["code"]) is DiagnosticCode.UNSUPPORTED_EDGE_CONDITION
            assert result.relative_path == expected["relativePath"], case["name"]


def test_all_compiler_cases_match_diagnostics_order_and_literal_hashes(
    corpus: dict[str, object],
) -> None:
    cases = _cases(corpus, "compilerCases")
    assert len(cases) == 18
    for case in cases:
        expected = case["expect"]
        assert type(expected) is dict
        expected_diagnostics = expected["diagnostics"]
        assert type(expected_diagnostics) is list
        result = try_compile_graph(case["graph"])  # type: ignore[arg-type]
        assert result.valid is expected["valid"], case["name"]
        assert result.graph_hash == case["expectedGraphHash"], case["name"]
        assert result.canonical_graph is not None
        assert [
            _diagnostic_projection(diagnostic) for diagnostic in result.diagnostics
        ] == expected_diagnostics, case["name"]
        if "missingRoutes" in expected:
            missing = expected["missingRoutes"]
            assert type(missing) is list
            assert result.diagnostics
            assert result.diagnostics[0].message.endswith(", ".join(missing))


def test_runtime_graph_hashes_and_canonical_hash_contract_are_compiler_verified(
    corpus: dict[str, object],
) -> None:
    assert corpus["hashContract"] == {
        "canonicalGraph": "existing-canonical-json-serialization-of-captured-graph",
        "graphHash": "lowercase-hex-sha256-of-utf8-canonicalGraph",
        "crossRuntimeRequirement": ("canonicalGraph-bytes-and-graphHash-must-both-match-literals"),
    }
    runtime_graphs = corpus["runtimeGraphs"]
    runtime_hashes = corpus["runtimeGraphHashes"]
    assert type(runtime_graphs) is dict
    assert type(runtime_hashes) is dict
    assert tuple(runtime_graphs) == tuple(runtime_hashes)
    for name, graph in runtime_graphs.items():
        assert type(name) is str
        assert type(graph) is dict
        result = try_compile_graph(graph)
        assert result.valid, name
        assert result.canonical_graph is not None
        assert result.graph_hash == runtime_hashes[name], name
        assert (
            result.graph_hash == hashlib.sha256(result.canonical_graph.encode("utf-8")).hexdigest()
        )


def test_invalid_execution_gate_binds_all_compiler_verifiable_fields(
    corpus: dict[str, object],
) -> None:
    gate_container = corpus["invalidExecutionGate"]
    assert type(gate_container) is dict
    gate = gate_container["python"]
    assert type(gate) is dict
    assert gate == {
        "surface": "try_compile_graph(document)",
        "expectValid": False,
        "compiledGraphAvailable": False,
        "expectPreparedHandlerCalls": 0,
    }

    def invalid(case: dict[str, object]) -> bool:
        expected = case.get("expect")
        return type(expected) is dict and expected.get("valid") is False

    invalid_case = next(case for case in _cases(corpus, "compilerCases") if invalid(case))
    prepared_handler_calls: list[str] = []
    result = try_compile_graph(invalid_case["graph"])  # type: ignore[arg-type]
    assert result.valid is gate["expectValid"]
    assert (result.graph is not None) is gate["compiledGraphAvailable"]
    assert len(prepared_handler_calls) == gate["expectPreparedHandlerCalls"]


def _route_condition(route_key: str) -> dict[str, object]:
    return {
        "apiVersion": ("graphengineering.reacher-z.github.io/pattern-conditions/v1alpha1"),
        "kind": "RouteEquals",
        "routeKey": route_key,
    }


def _diagnostic_order_graph(
    name: str,
    allowed_routes: list[str],
    edges: list[dict[str, object]],
) -> dict[str, object]:
    return {
        "apiVersion": "graphengineering.reacher-z.github.io/v1alpha1",
        "kind": "Graph",
        "metadata": {"name": name, "version": "1"},
        "inputSchema": {},
        "outputSchema": {},
        "entrypoints": ["route-a", "route-z"],
        "outputs": {"decision": {"node": "route-a"}},
        "nodes": [
            {
                "id": router_id,
                "kind": "router",
                "inputSchema": {},
                "outputSchema": {},
                "config": {"kind": "single", "allowedRoutes": allowed_routes},
            }
            for router_id in ("route-a", "route-z")
        ]
        + [
            {
                "id": target_id,
                "kind": "transform",
                "inputSchema": {},
                "outputSchema": {},
                "config": {},
            }
            for target_id in (
                "target-a",
                "target-a-alt",
                "target-z",
                "target-z-alt",
            )
        ],
        "edges": edges,
    }


@pytest.mark.parametrize(
    ("code", "graph", "expected_edge_ids"),
    [
        (
            DiagnosticCode.ROUTE_NOT_ALLOWED,
            _diagnostic_order_graph(
                "global-ge1404-order",
                ["allowed"],
                [
                    {
                        "id": "z-not-allowed",
                        "from": {"node": "route-z"},
                        "to": {"node": "target-z"},
                        "condition": _route_condition("other"),
                    },
                    {
                        "id": "a-not-allowed",
                        "from": {"node": "route-a"},
                        "to": {"node": "target-a"},
                        "condition": _route_condition("other"),
                    },
                    {
                        "id": "z-reach-alt",
                        "from": {"node": "route-z"},
                        "to": {"node": "target-z-alt"},
                    },
                    {
                        "id": "a-reach-alt",
                        "from": {"node": "route-a"},
                        "to": {"node": "target-a-alt"},
                    },
                ],
            ),
            ["z-not-allowed", "a-not-allowed"],
        ),
        (
            DiagnosticCode.DUPLICATE_ROUTE_CASE,
            _diagnostic_order_graph(
                "global-ge1405-order",
                ["same"],
                [
                    {
                        "id": "a-case-seed",
                        "from": {"node": "route-a"},
                        "to": {"node": "target-a"},
                        "condition": _route_condition("same"),
                    },
                    {
                        "id": "z-case-seed",
                        "from": {"node": "route-z"},
                        "to": {"node": "target-z"},
                        "condition": _route_condition("same"),
                    },
                    {
                        "id": "z-case-duplicate",
                        "from": {"node": "route-z"},
                        "to": {"node": "target-z-alt"},
                        "condition": _route_condition("same"),
                    },
                    {
                        "id": "a-case-duplicate",
                        "from": {"node": "route-a"},
                        "to": {"node": "target-a-alt"},
                        "condition": _route_condition("same"),
                    },
                ],
            ),
            ["z-case-duplicate", "a-case-duplicate"],
        ),
        (
            DiagnosticCode.DUPLICATE_ROUTE_TARGET,
            _diagnostic_order_graph(
                "global-ge1406-order",
                ["first", "second"],
                [
                    {
                        "id": "a-target-seed",
                        "from": {"node": "route-a"},
                        "to": {"node": "target-a"},
                        "condition": _route_condition("first"),
                    },
                    {
                        "id": "z-target-seed",
                        "from": {"node": "route-z"},
                        "to": {"node": "target-z"},
                        "condition": _route_condition("first"),
                    },
                    {
                        "id": "z-target-duplicate",
                        "from": {"node": "route-z"},
                        "to": {"node": "target-z"},
                        "condition": _route_condition("second"),
                    },
                    {
                        "id": "a-target-duplicate",
                        "from": {"node": "route-a"},
                        "to": {"node": "target-a"},
                        "condition": _route_condition("second"),
                    },
                    {
                        "id": "z-reach-alt",
                        "from": {"node": "route-z"},
                        "to": {"node": "target-z-alt"},
                    },
                    {
                        "id": "a-reach-alt",
                        "from": {"node": "route-a"},
                        "to": {"node": "target-a-alt"},
                    },
                ],
            ),
            ["z-target-duplicate", "a-target-duplicate"],
        ),
    ],
)
def test_cross_router_diagnostics_retain_global_edge_declaration_order(
    code: DiagnosticCode,
    graph: dict[str, object],
    expected_edge_ids: list[str],
) -> None:
    result = try_compile_graph(graph)
    diagnostics = [item for item in result.diagnostics if item.code is code]
    assert [item.edge_id for item in diagnostics] == expected_edge_ids
    edges = graph["edges"]
    assert type(edges) is list
    expected_suffix = (
        "/to/node" if code is DiagnosticCode.DUPLICATE_ROUTE_TARGET else "/condition/routeKey"
    )
    edge_indices = {
        edge.get("id"): index for index, edge in enumerate(edges) if isinstance(edge, dict)
    }
    assert [item.path for item in diagnostics] == [
        f"#/edges/{edge_indices[edge_id]}{expected_suffix}" for edge_id in expected_edge_ids
    ]


def test_diagnostic_projection_omits_absent_fields_in_normative_order() -> None:
    diagnostic = Diagnostic(
        code=DiagnosticCode.INVALID_ROUTER_POLICY,
        message="invalid",
        path="#/nodes/0/config",
        node_ids=("route",),
    )
    projection = _diagnostic_projection(diagnostic)
    assert tuple(projection) == ("code", "path", "nodeIds")
    assert "edgeId" not in projection


def _valid_router_graph(corpus: dict[str, object]) -> dict[str, object]:
    cases = _cases(corpus, "compilerCases")
    graph = cases[0]["graph"]
    assert type(graph) is dict
    return copy.deepcopy(graph)


def test_edge_condition_null_and_scalar_remain_graph_envelope_errors(
    corpus: dict[str, object],
) -> None:
    cases = _cases(corpus, "envelopeGateCases")
    assert len(cases) == 2
    for case in cases:
        document = _valid_router_graph(corpus)
        edges = document["edges"]
        assert type(edges) is list and type(edges[0]) is dict
        edges[0]["condition"] = case["value"]
        result = try_compile_graph(document)
        assert result.graph is None
        assert result.canonical_graph is None
        assert [item.code.value for item in result.diagnostics] == [case["expectCode"]]


class _HostileValue:
    def __getattribute__(self, name: str) -> object:
        if name.startswith("__"):
            raise RuntimeError("hostile value was inspected")
        return object.__getattribute__(self, name)


class _ProxyCondition(Mapping[str, object]):
    def __getitem__(self, key: str) -> object:
        raise RuntimeError(f"hostile condition access: {key}")

    def __iter__(self) -> Iterator[str]:
        raise RuntimeError("hostile condition iteration")

    def __len__(self) -> int:
        raise RuntimeError("hostile condition length")


class _SparseRoutes(list[object]):
    pass


@pytest.mark.parametrize(
    "case_name",
    [
        "accessor-config",
        "proxy-condition",
        "sparse-allowed-routes",
        "non-portable-policy-number",
    ],
)
def test_host_constructed_values_stop_at_graph_capture_without_prepared_calls(
    corpus: dict[str, object],
    case_name: str,
) -> None:
    declared = {case["name"]: case for case in _cases(corpus, "hostConstructedEnvelopeCases")}
    assert len(declared) == 4
    case = declared[case_name]
    document = _valid_router_graph(corpus)
    nodes = document["nodes"]
    edges = document["edges"]
    assert type(nodes) is list and type(nodes[0]) is dict
    assert type(edges) is list and type(edges[0]) is dict
    if case_name == "accessor-config":
        nodes[0]["config"] = _HostileValue()
    elif case_name == "proxy-condition":
        edges[0]["condition"] = _ProxyCondition()
    elif case_name == "sparse-allowed-routes":
        nodes[0]["config"] = {
            "kind": "single",
            "allowedRoutes": _SparseRoutes(["quick", "audit"]),
        }
    else:
        nodes[0]["config"] = {
            "kind": "single",
            "allowedRoutes": ["quick", "audit"],
            "confidence": {
                "minimumBasisPoints": float("nan"),
                "escalationRoute": "quick",
            },
        }

    prepared_handler_calls: list[str] = []
    result = try_compile_graph(document)
    assert result.graph is None
    assert result.canonical_graph is None
    assert [item.code.value for item in result.diagnostics] == [case["expectCode"]]
    assert prepared_handler_calls == []
