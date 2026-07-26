"""Detached, deterministic general Graph IR builder."""

from __future__ import annotations

import json
from dataclasses import dataclass
from enum import StrEnum
from typing import Final, TypeVar, cast

from pydantic import BaseModel, ValidationError

from .compiler import Diagnostic, try_compile_graph
from .component_identity import (
    CompiledGraphIdentity,
    _create_compiled_graph_identity_from_compiled,
)
from .models import (
    EdgeSpec,
    Endpoint,
    GraphModelSnapshotError,
    GraphPolicies,
    GraphSpec,
    JsonObject,
    Metadata,
    NodeSpec,
    capture_graph_model_document,
)
from .portable_json import PortableJsonError, portable_json_snapshot
from .typed_ports import TYPED_PORT_POLICY_KEY, strict_typed_ports_policy

_MISSING: Final = object()
ModelT = TypeVar("ModelT", bound=BaseModel)


class BuilderErrorCode(StrEnum):
    INVALID_INPUT = "GE_BUILDER_INVALID_INPUT"
    DUPLICATE_NODE = "GE_BUILDER_DUPLICATE_NODE"
    DUPLICATE_EDGE = "GE_BUILDER_DUPLICATE_EDGE"
    DUPLICATE_ENTRYPOINT = "GE_BUILDER_DUPLICATE_ENTRYPOINT"
    DUPLICATE_OUTPUT = "GE_BUILDER_DUPLICATE_OUTPUT"
    MISSING_REQUIRED = "GE_BUILDER_MISSING_REQUIRED"
    CORE_REJECTED = "GE_BUILDER_CORE_REJECTED"
    SEALED = "GE_BUILDER_SEALED"


def _diagnostic_dict(diagnostic: Diagnostic) -> JsonObject:
    return {
        "code": diagnostic.code.value,
        "message": diagnostic.message,
        "nodeId": diagnostic.node_id,
        "nodeIds": list(diagnostic.node_ids) if diagnostic.node_ids is not None else None,
        "edgeId": diagnostic.edge_id,
        "outputName": diagnostic.output_name,
        "path": diagnostic.path,
    }


class GraphBuilderError(ValueError):
    """A stable builder failure with optional canonical compiler diagnostics."""

    def __init__(
        self,
        code: BuilderErrorCode,
        message: str,
        path: str,
        diagnostics: tuple[Diagnostic, ...] = (),
    ) -> None:
        self.code = code
        self.path = path
        self.diagnostics = diagnostics
        super().__init__(message)

    @property
    def message(self) -> str:
        return str(self)

    def to_dict(self) -> JsonObject:
        return {
            "code": self.code.value,
            "message": self.message,
            "path": self.path,
            "diagnostics": [_diagnostic_dict(item) for item in self.diagnostics],
        }


def _fail(
    code: BuilderErrorCode,
    message: str,
    path: str,
    diagnostics: tuple[Diagnostic, ...] = (),
) -> GraphBuilderError:
    return GraphBuilderError(code, message, path, diagnostics)


def _model_snapshot(
    value: object,
    model_type: type[ModelT],
    path: str,
) -> JsonObject:
    try:
        document: object
        if type(value) is model_type:
            document = capture_graph_model_document(value, model_type)
        elif type(value) is dict:
            document = portable_json_snapshot(value)
        else:
            raise PortableJsonError("model input must be a plain object")
        validated = model_type.model_validate(document)
        snapshot = portable_json_snapshot(capture_graph_model_document(validated, model_type))
    except (
        GraphModelSnapshotError,
        PortableJsonError,
        ValidationError,
        RecursionError,
        TypeError,
        ValueError,
    ):
        raise _fail(
            BuilderErrorCode.INVALID_INPUT,
            "builder input is not a valid detached Graph IR object",
            path,
        ) from None
    if not isinstance(snapshot, dict):
        raise _fail(
            BuilderErrorCode.INVALID_INPUT,
            "builder input must be a Graph IR object",
            path,
        )
    return snapshot


def _json_object_snapshot(value: object, path: str) -> JsonObject:
    try:
        if type(value) is not dict:
            raise PortableJsonError("value must be a plain object")
        snapshot = portable_json_snapshot(value)
    except (PortableJsonError, RecursionError):
        raise _fail(
            BuilderErrorCode.INVALID_INPUT,
            "builder value must be a detached portable JSON object",
            path,
        ) from None
    if not isinstance(snapshot, dict):
        raise _fail(
            BuilderErrorCode.INVALID_INPUT,
            "builder value must be a JSON object",
            path,
        )
    return snapshot


def _string_snapshot(value: object, path: str, *, non_empty: bool) -> str:
    try:
        snapshot = portable_json_snapshot(value)
    except PortableJsonError:
        raise _fail(
            BuilderErrorCode.INVALID_INPUT,
            "builder value must be a portable string",
            path,
        ) from None
    if not isinstance(snapshot, str) or (non_empty and not snapshot):
        message = (
            "builder value must be a non-empty string"
            if non_empty
            else "builder value must be a string"
        )
        raise _fail(
            BuilderErrorCode.INVALID_INPUT,
            message,
            path,
        )
    return snapshot


@dataclass(frozen=True, slots=True)
class BuiltGraph:
    """Immutable identity fields plus a detached-on-access GraphSpec snapshot."""

    _canonical_graph: str
    graph_hash: str
    identity: CompiledGraphIdentity

    @property
    def canonical_graph(self) -> str:
        return self._canonical_graph

    @property
    def graph(self) -> GraphSpec:
        document = json.loads(self._canonical_graph)
        return GraphSpec.model_validate(document)


class GraphBuilder:
    """Build one v1alpha1 GraphSpec without inferring IDs, roots, or outputs."""

    def __init__(
        self,
        *,
        metadata: Metadata | JsonObject | object = _MISSING,
        input_schema: JsonObject | object = _MISSING,
        output_schema: JsonObject | object = _MISSING,
        state_schema: JsonObject | object = _MISSING,
        policies: GraphPolicies | JsonObject | object = _MISSING,
    ) -> None:
        self._sealed = False
        for value, path, label in (
            (metadata, "#/metadata", "metadata"),
            (input_schema, "#/inputSchema", "input_schema"),
            (output_schema, "#/outputSchema", "output_schema"),
        ):
            if value is _MISSING:
                raise _fail(
                    BuilderErrorCode.MISSING_REQUIRED,
                    f"required constructor value {label} is missing",
                    path,
                )
        self._metadata = _model_snapshot(metadata, Metadata, "#/metadata")
        self._input_schema = _json_object_snapshot(input_schema, "#/inputSchema")
        self._output_schema = _json_object_snapshot(output_schema, "#/outputSchema")
        self._state_schema = (
            None
            if state_schema is _MISSING
            else _json_object_snapshot(state_schema, "#/stateSchema")
        )
        self._policies = (
            None if policies is _MISSING else _model_snapshot(policies, GraphPolicies, "#/policies")
        )
        self._nodes: list[JsonObject] = []
        self._edges: list[JsonObject] = []
        self._entrypoints: list[str] = []
        self._outputs: dict[str, JsonObject] = {}
        self._node_ids: set[str] = set()
        self._edge_ids: set[str] = set()
        self._entrypoint_ids: set[str] = set()

    def _ensure_open(self, path: str = "#") -> None:
        if self._sealed:
            raise _fail(
                BuilderErrorCode.SEALED,
                "graph builder is sealed after a successful build",
                path,
            )

    def add_node(self, node: NodeSpec | JsonObject) -> GraphBuilder:
        index = len(self._nodes)
        self._ensure_open(f"#/nodes/{index}")
        snapshot = _model_snapshot(node, NodeSpec, f"#/nodes/{index}")
        node_id = cast(str, snapshot["id"])
        if node_id in self._node_ids:
            raise _fail(
                BuilderErrorCode.DUPLICATE_NODE,
                "node ID is already present in this builder",
                f"#/nodes/{index}/id",
            )
        self._node_ids.add(node_id)
        self._nodes.append(snapshot)
        return self

    def add_edge(self, edge: EdgeSpec | JsonObject) -> GraphBuilder:
        index = len(self._edges)
        self._ensure_open(f"#/edges/{index}")
        snapshot = _model_snapshot(edge, EdgeSpec, f"#/edges/{index}")
        edge_id = cast(str, snapshot["id"])
        if edge_id in self._edge_ids:
            raise _fail(
                BuilderErrorCode.DUPLICATE_EDGE,
                "edge ID is already present in this builder",
                f"#/edges/{index}/id",
            )
        self._edge_ids.add(edge_id)
        self._edges.append(snapshot)
        return self

    def add_entrypoint(self, node_id: str) -> GraphBuilder:
        index = len(self._entrypoints)
        self._ensure_open(f"#/entrypoints/{index}")
        snapshot = _string_snapshot(node_id, f"#/entrypoints/{index}", non_empty=True)
        if snapshot in self._entrypoint_ids:
            raise _fail(
                BuilderErrorCode.DUPLICATE_ENTRYPOINT,
                "entrypoint is already present in this builder",
                f"#/entrypoints/{index}",
            )
        self._entrypoint_ids.add(snapshot)
        self._entrypoints.append(snapshot)
        return self

    def add_output(self, name: str, endpoint: Endpoint | JsonObject) -> GraphBuilder:
        attempted_path = "#/outputs"
        if type(name) is str:
            attempted_name = name.replace("~", "~0").replace("/", "~1")
            attempted_path = f"#/outputs/{attempted_name}"
        self._ensure_open(attempted_path)
        output_name = _string_snapshot(name, "#/outputs", non_empty=False)
        path_name = output_name.replace("~", "~0").replace("/", "~1")
        path = f"#/outputs/{path_name}"
        if output_name in self._outputs:
            raise _fail(
                BuilderErrorCode.DUPLICATE_OUTPUT,
                "public output name is already present in this builder",
                path,
            )
        self._outputs[output_name] = _model_snapshot(endpoint, Endpoint, path)
        return self

    def set_policies(self, policies: GraphPolicies | JsonObject) -> GraphBuilder:
        """Replace the complete policy object with an immediate detached snapshot."""

        self._ensure_open("#/policies")
        self._policies = _model_snapshot(policies, GraphPolicies, "#/policies")
        return self

    def enable_strict_typed_ports(self) -> GraphBuilder:
        self._ensure_open("#/policies")
        policies = (
            {}
            if self._policies is None
            else cast(JsonObject, portable_json_snapshot(self._policies))
        )
        if TYPED_PORT_POLICY_KEY in policies:
            raise _fail(
                BuilderErrorCode.INVALID_INPUT,
                "strict typed-port policy is already configured",
                "#/policies/graphengineering.reacher-z.github.io~1typed-ports",
            )
        policies[TYPED_PORT_POLICY_KEY] = strict_typed_ports_policy()
        self._policies = policies
        return self

    def build(self) -> BuiltGraph:
        self._ensure_open()
        if not self._entrypoints:
            raise _fail(
                BuilderErrorCode.MISSING_REQUIRED,
                "at least one explicit entrypoint is required",
                "#/entrypoints",
            )
        if not self._outputs:
            raise _fail(
                BuilderErrorCode.MISSING_REQUIRED,
                "at least one explicit public output is required",
                "#/outputs",
            )

        document: JsonObject = {
            "apiVersion": "graphengineering.reacher-z.github.io/v1alpha1",
            "kind": "Graph",
            "metadata": portable_json_snapshot(self._metadata),
            "inputSchema": portable_json_snapshot(self._input_schema),
            "outputSchema": portable_json_snapshot(self._output_schema),
            "entrypoints": portable_json_snapshot(self._entrypoints),
            "outputs": portable_json_snapshot(self._outputs),
            "nodes": portable_json_snapshot(self._nodes),
            "edges": portable_json_snapshot(self._edges),
        }
        if self._state_schema is not None:
            document["stateSchema"] = portable_json_snapshot(self._state_schema)
        if self._policies is not None:
            document["policies"] = portable_json_snapshot(self._policies)

        compilation = try_compile_graph(document)
        if (
            compilation.graph is None
            or compilation.canonical_graph is None
            or compilation.graph_hash is None
        ):
            raise _fail(
                BuilderErrorCode.CORE_REJECTED,
                "canonical graph compiler rejected the built document",
                "#",
                compilation.diagnostics,
            )
        compiled = compilation.graph

        identity = _create_compiled_graph_identity_from_compiled(compiled)
        built = BuiltGraph(
            _canonical_graph=compilation.canonical_graph,
            graph_hash=compilation.graph_hash,
            identity=identity,
        )
        self._sealed = True
        return built


def graph_builder(
    *,
    metadata: Metadata | JsonObject | object = _MISSING,
    input_schema: JsonObject | object = _MISSING,
    output_schema: JsonObject | object = _MISSING,
    state_schema: JsonObject | object = _MISSING,
    policies: GraphPolicies | JsonObject | object = _MISSING,
) -> GraphBuilder:
    """Create a general builder with an explicit Graph IR envelope."""

    return GraphBuilder(
        metadata=metadata,
        input_schema=input_schema,
        output_schema=output_schema,
        state_schema=state_schema,
        policies=policies,
    )


__all__ = [
    "BuilderErrorCode",
    "BuiltGraph",
    "GraphBuilder",
    "GraphBuilderError",
    "graph_builder",
]
