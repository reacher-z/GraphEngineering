from __future__ import annotations

import asyncio
import json
from collections.abc import Mapping
from pathlib import Path
from typing import Any

import pytest

from graph_engineering import NodeContext, NodeResult, run_graph, try_compile_graph

ROOT = Path(__file__).resolve().parents[2]
CORPUS_PATH = ROOT / "spec/conformance/integrated-router.case.json"
CORPUS: dict[str, Any] = json.loads(CORPUS_PATH.read_text())

EXPECTED_RUNTIME_GRAPH_REFS = (
    "confidence",
    "default",
    "descendant",
    "diamond",
    "inactive-output",
    "multi",
    "no-match",
)
EXPECTED_RUNTIME_CASE_NAMES = (
    "selected-route-prunes-the-other-branch-and-merges-only-active-input",
    "omitted-default-produces-successful-no-match-and-pruned-branch",
    "empty-request-selects-the-enumerated-default",
    "low-confidence-selection-activates-only-the-escalation-route",
    "custom-router-output-is-recomputed-from-authoritative-input",
    "multicast-activates-requested-routes-in-policy-order",
    "multicast-limit-yields-successful-non-routed-decision",
    "inactive-descendant-inherits-route-not-selected",
    "active-failure-controls-mixed-join-despite-inactive-sibling",
    "inactive-named-output-fails-binding-without-invented-node-failure",
    "unknown-request-selects-enumerated-default",
)


def test_integrated_router_runtime_corpus_inventory_is_frozen() -> None:
    cases = CORPUS["runtimeCases"]
    graphs = CORPUS["runtimeGraphs"]

    assert len(cases) == 11
    assert tuple(item["name"] for item in cases) == EXPECTED_RUNTIME_CASE_NAMES
    assert tuple(sorted(graphs)) == EXPECTED_RUNTIME_GRAPH_REFS
    assert tuple(sorted({item["graphRef"] for item in cases})) == EXPECTED_RUNTIME_GRAPH_REFS


def _node_terminal(result: NodeResult) -> dict[str, Any]:
    terminal: dict[str, Any] = {
        "nodeId": result.node_id,
        "status": result.status.value,
        "attempts": result.attempts,
    }
    if result.succeeded:
        terminal["output"] = result.value
    if result.failure is not None:
        terminal["failure"] = {
            "code": result.failure.code.value,
            "retryable": result.failure.retryable,
        }
    return terminal


@pytest.mark.parametrize(
    "case",
    CORPUS["runtimeCases"],
    ids=[item["name"] for item in CORPUS["runtimeCases"]],
)
def test_integrated_router_public_runtime_consumes_normative_case(case: dict[str, Any]) -> None:
    assert set(case) == {"name", "graphRef", "graphInput", "executors", "expect"}
    assert case["graphRef"] in EXPECTED_RUNTIME_GRAPH_REFS
    graph_document = CORPUS["runtimeGraphs"][case["graphRef"]]
    compilation = try_compile_graph(graph_document)
    assert compilation.graph is not None
    assert compilation.diagnostics == ()

    calls = {node_id: 0 for node_id in case["executors"]}
    handlers = {}
    for node_id, behavior in case["executors"].items():
        assert set(behavior) in ({"return"}, {"throw"})

        def handler(
            _: NodeContext,
            *,
            _node_id: str = node_id,
            _behavior: Mapping[str, Any] = behavior,
        ) -> Any:
            calls[_node_id] += 1
            if "throw" in _behavior:
                raise RuntimeError(_behavior["throw"])
            return _behavior["return"]

        handlers[node_id] = handler

    expected = case["expect"]
    assert set(expected) in (
        {
            "status",
            "totalAttempts",
            "output",
            "graphFailureCodes",
            "executorCalls",
            "nodes",
        },
        {
            "status",
            "totalAttempts",
            "outputAbsent",
            "graphFailureCodes",
            "executorCalls",
            "nodes",
        },
    )
    assert set(calls) == set(expected["executorCalls"])

    result = asyncio.run(run_graph(compilation.graph, case["graphInput"], handlers))

    assert result.status.value == expected["status"]
    assert result.total_attempts == expected["totalAttempts"]
    if "output" in expected:
        assert result.outputs == expected["output"]
    else:
        assert expected["outputAbsent"] is True
        assert result.outputs is None
    assert [failure.code.value for failure in result.failures] == expected["graphFailureCodes"]
    assert calls == expected["executorCalls"]
    assert [_node_terminal(result.nodes[node_id]) for node_id in result.nodes] == expected["nodes"]
