"""Deterministic compiler and structural validation for Graph IR."""

from __future__ import annotations

from collections import Counter, deque
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from enum import StrEnum
from types import MappingProxyType
from typing import Any

from pydantic import ValidationError

from ._json import normalize_json_strings
from .models import EdgeSpec, GraphSpec, NodeSpec


class DiagnosticCode(StrEnum):
    DUPLICATE_NODE = "GE1001_DUPLICATE_NODE"
    DUPLICATE_EDGE = "GE1002_DUPLICATE_EDGE"
    MISSING_SOURCE = "GE1003_MISSING_SOURCE"
    MISSING_TARGET = "GE1004_MISSING_TARGET"
    CYCLE = "GE1005_CYCLE"
    UNREACHABLE_NODE = "GE1006_UNREACHABLE_NODE"
    INVALID_GRAPH = "GE1007_INVALID_GRAPH"
    MISSING_ENTRYPOINT = "GE1008_MISSING_ENTRYPOINT"
    MISSING_OUTPUT = "GE1009_MISSING_OUTPUT"
    ENTRYPOINT_HAS_INCOMING = "GE1010_ENTRYPOINT_HAS_INCOMING"
    MAX_FAN_OUT = "GE1101_MAX_FAN_OUT"
    MAX_DEPTH = "GE1102_MAX_DEPTH"


@dataclass(frozen=True, slots=True)
class Diagnostic:
    code: DiagnosticCode
    message: str
    node_id: str | None = None
    edge_id: str | None = None
    output_name: str | None = None


@dataclass(frozen=True, slots=True)
class CompiledGraph:
    spec: GraphSpec
    graph_hash: str
    topological_layers: tuple[tuple[str, ...], ...]
    topological_order: tuple[str, ...]
    nodes: Mapping[str, NodeSpec]
    incoming: Mapping[str, tuple[EdgeSpec, ...]]
    outgoing: Mapping[str, tuple[EdgeSpec, ...]]


@dataclass(frozen=True, slots=True)
class CompilationResult:
    graph: CompiledGraph | None
    diagnostics: tuple[Diagnostic, ...]

    @property
    def valid(self) -> bool:
        return self.graph is not None and not self.diagnostics

    def raise_for_errors(self) -> CompiledGraph:
        if self.graph is None:
            raise GraphCompileError(self.diagnostics)
        return self.graph


class GraphCompileError(ValueError):
    def __init__(self, diagnostics: Iterable[Diagnostic]) -> None:
        self.diagnostics = tuple(diagnostics)
        summary = "; ".join(f"{item.code}: {item.message}" for item in self.diagnostics)
        super().__init__(summary or "graph compilation failed")


def _duplicate_values(values: Iterable[str]) -> list[str]:
    counts = Counter(values)
    return [value for value, count in counts.items() if count > 1]


def _invalid_result(exc: ValidationError) -> CompilationResult:
    details = "; ".join(
        f"{'.'.join(str(part) for part in error['loc'])}: {error['msg']}" for error in exc.errors()
    )
    return CompilationResult(
        graph=None,
        diagnostics=(Diagnostic(DiagnosticCode.INVALID_GRAPH, details),),
    )


def _unsafe_input_result() -> CompilationResult:
    return CompilationResult(
        graph=None,
        diagnostics=(
            Diagnostic(
                DiagnosticCode.INVALID_GRAPH,
                "graph input could not be inspected safely",
            ),
        ),
    )


def try_compile_graph(graph: GraphSpec | Mapping[str, Any]) -> CompilationResult:
    """Validate and compile a graph without raising for expected diagnostics."""

    if not isinstance(graph, GraphSpec):
        try:
            graph = GraphSpec.model_validate(normalize_json_strings(graph))
        except ValidationError as exc:
            return _invalid_result(exc)
        except Exception:
            return _unsafe_input_result()

    diagnostics: list[Diagnostic] = []
    duplicate_nodes = _duplicate_values(node.id for node in graph.nodes)
    duplicate_edges = _duplicate_values(edge.id for edge in graph.edges)

    for node_id in duplicate_nodes:
        diagnostics.append(
            Diagnostic(
                DiagnosticCode.DUPLICATE_NODE,
                f"node id {node_id!r} is declared more than once",
                node_id=node_id,
            )
        )
    for edge_id in duplicate_edges:
        diagnostics.append(
            Diagnostic(
                DiagnosticCode.DUPLICATE_EDGE,
                f"edge id {edge_id!r} is declared more than once",
                edge_id=edge_id,
            )
        )

    node_ids = {node.id for node in graph.nodes}
    for edge in graph.edges:
        if edge.source.node not in node_ids:
            diagnostics.append(
                Diagnostic(
                    DiagnosticCode.MISSING_SOURCE,
                    f"edge {edge.id!r} references missing source {edge.source.node!r}",
                    node_id=edge.source.node,
                    edge_id=edge.id,
                )
            )
        if edge.target.node not in node_ids:
            diagnostics.append(
                Diagnostic(
                    DiagnosticCode.MISSING_TARGET,
                    f"edge {edge.id!r} references missing target {edge.target.node!r}",
                    node_id=edge.target.node,
                    edge_id=edge.id,
                )
            )

    for entrypoint in graph.entrypoints:
        if entrypoint not in node_ids:
            diagnostics.append(
                Diagnostic(
                    DiagnosticCode.MISSING_ENTRYPOINT,
                    f"entrypoint {entrypoint!r} does not reference a node",
                    node_id=entrypoint,
                )
            )
    for output_name, endpoint in graph.outputs.items():
        if endpoint.node not in node_ids:
            diagnostics.append(
                Diagnostic(
                    DiagnosticCode.MISSING_OUTPUT,
                    f"output {output_name!r} references missing node {endpoint.node!r}",
                    node_id=endpoint.node,
                    output_name=output_name,
                )
            )

    # Duplicate identities or missing references make adjacency ambiguous. Avoid
    # cascading diagnostics whose meaning depends on a valid structural index.
    if diagnostics:
        return CompilationResult(graph=None, diagnostics=tuple(diagnostics))

    node_order = {node.id: index for index, node in enumerate(graph.nodes)}
    node_by_id = {node.id: node for node in graph.nodes}
    incoming_lists: dict[str, list[EdgeSpec]] = {node.id: [] for node in graph.nodes}
    outgoing_lists: dict[str, list[EdgeSpec]] = {node.id: [] for node in graph.nodes}
    for edge in graph.edges:
        incoming_lists[edge.target.node].append(edge)
        outgoing_lists[edge.source.node].append(edge)

    indegree = {node_id: len(edges) for node_id, edges in incoming_lists.items()}
    current = [node.id for node in graph.nodes if indegree[node.id] == 0]
    layers: list[tuple[str, ...]] = []
    visited: list[str] = []
    while current:
        current.sort(key=node_order.__getitem__)
        layer = tuple(current)
        layers.append(layer)
        visited.extend(layer)
        next_nodes: set[str] = set()
        for node_id in layer:
            for edge in outgoing_lists[node_id]:
                target = edge.target.node
                indegree[target] -= 1
                if indegree[target] == 0:
                    next_nodes.add(target)
        current = list(next_nodes)

    if len(visited) != len(graph.nodes):
        cycle_nodes = tuple(node.id for node in graph.nodes if indegree[node.id] > 0)
        return CompilationResult(
            graph=None,
            diagnostics=(
                Diagnostic(
                    DiagnosticCode.CYCLE,
                    f"graph contains a cycle involving: {', '.join(cycle_nodes)}",
                ),
            ),
        )

    for entrypoint in graph.entrypoints:
        if incoming_lists[entrypoint]:
            diagnostics.append(
                Diagnostic(
                    DiagnosticCode.ENTRYPOINT_HAS_INCOMING,
                    f"entrypoint {entrypoint!r} must not have incoming edges",
                    node_id=entrypoint,
                )
            )

    reachable: set[str] = set(graph.entrypoints)
    queue = deque(graph.entrypoints)
    while queue:
        node_id = queue.popleft()
        for edge in outgoing_lists[node_id]:
            target = edge.target.node
            if target not in reachable:
                reachable.add(target)
                queue.append(target)

    for node in graph.nodes:
        if node.id not in reachable:
            diagnostics.append(
                Diagnostic(
                    DiagnosticCode.UNREACHABLE_NODE,
                    f"node {node.id!r} is not reachable from any entrypoint",
                    node_id=node.id,
                )
            )

    if graph.policies and graph.policies.max_fan_out is not None:
        for node in graph.nodes:
            fan_out = len(outgoing_lists[node.id])
            if fan_out > graph.policies.max_fan_out:
                diagnostics.append(
                    Diagnostic(
                        DiagnosticCode.MAX_FAN_OUT,
                        (
                            f"node {node.id!r} has fan-out {fan_out}, exceeding policy limit "
                            f"{graph.policies.max_fan_out}"
                        ),
                        node_id=node.id,
                    )
                )

    if graph.policies and graph.policies.max_depth is not None:
        depth = len(layers)
        if depth > graph.policies.max_depth:
            diagnostics.append(
                Diagnostic(
                    DiagnosticCode.MAX_DEPTH,
                    f"graph depth {depth} exceeds policy limit {graph.policies.max_depth}",
                )
            )
    if diagnostics:
        return CompilationResult(graph=None, diagnostics=tuple(diagnostics))

    incoming = MappingProxyType(
        {node_id: tuple(edges) for node_id, edges in incoming_lists.items()}
    )
    outgoing = MappingProxyType(
        {node_id: tuple(edges) for node_id, edges in outgoing_lists.items()}
    )
    try:
        graph_hash = graph.canonical_hash()
    except Exception:
        return _unsafe_input_result()

    compiled = CompiledGraph(
        spec=graph,
        graph_hash=graph_hash,
        topological_layers=tuple(layers),
        topological_order=tuple(visited),
        nodes=MappingProxyType(node_by_id),
        incoming=incoming,
        outgoing=outgoing,
    )
    return CompilationResult(graph=compiled, diagnostics=())


def compile_graph(graph: GraphSpec | Mapping[str, Any]) -> CompiledGraph:
    """Compile a Graph IR document or raise :class:`GraphCompileError`."""

    return try_compile_graph(graph).raise_for_errors()
