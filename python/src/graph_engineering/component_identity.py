"""Domain-separated component and initial-revision graph identities."""

from __future__ import annotations

import hashlib
import json
import math
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, TypeAlias, cast

from .canonical import canonical_bytes, canonical_json
from .compiler import (
    CompiledGraph,
    Diagnostic,
    DiagnosticCode,
    GraphCompileError,
    compile_graph,
)
from .models import MAX_SAFE_INTEGER, GraphSpec, JsonObject, JsonValue
from .portable_json import PortableJsonError, portable_json_snapshot

IDENTITY_API_VERSION = "graphengineering.reacher-z.github.io/compiled-identity/v1alpha1"
COMPONENT_DOMAIN = b"graph-engineering/component/v1alpha1\0"
REVISION_DOMAIN = b"graph-engineering/revision/v1alpha1\0"

GraphInput: TypeAlias = GraphSpec | CompiledGraph | Mapping[str, Any]


def _component_hash(kind: str, value: JsonValue) -> str:
    if kind not in {"node", "edge", "schema"}:
        raise ValueError("component kind must be node, edge, or schema")
    preimage = COMPONENT_DOMAIN + kind.encode("ascii") + b"\0" + canonical_bytes(value)
    return hashlib.sha256(preimage).hexdigest()


@dataclass(frozen=True, slots=True)
class NodeComponentIdentity:
    id: str
    index: int
    content_hash: str
    input_schema_hash: str
    output_schema_hash: str

    def to_dict(self) -> JsonObject:
        return {
            "id": self.id,
            "index": self.index,
            "contentHash": self.content_hash,
            "inputSchemaHash": self.input_schema_hash,
            "outputSchemaHash": self.output_schema_hash,
        }


@dataclass(frozen=True, slots=True)
class EdgeComponentIdentity:
    id: str
    index: int
    content_hash: str
    schema_hash: str | None

    def to_dict(self) -> JsonObject:
        return {
            "id": self.id,
            "index": self.index,
            "contentHash": self.content_hash,
            "schemaHash": self.schema_hash,
        }


@dataclass(frozen=True, slots=True)
class GraphSchemaIdentity:
    input: str
    output: str
    state: str | None

    def to_dict(self) -> JsonObject:
        return {"input": self.input, "output": self.output, "state": self.state}


@dataclass(frozen=True, slots=True)
class CompiledGraphIdentity:
    api_version: str
    kind: str
    graph_revision: int
    graph_hash: str
    nodes: tuple[NodeComponentIdentity, ...]
    edges: tuple[EdgeComponentIdentity, ...]
    graph_schemas: GraphSchemaIdentity
    revision_hash: str

    def to_dict(self) -> JsonObject:
        """Export a fresh mutable JSON document without exposing identity state."""

        return {
            "apiVersion": self.api_version,
            "kind": self.kind,
            "graphRevision": self.graph_revision,
            "graphHash": self.graph_hash,
            "nodes": [node.to_dict() for node in self.nodes],
            "edges": [edge.to_dict() for edge in self.edges],
            "graphSchemas": self.graph_schemas.to_dict(),
            "revisionHash": self.revision_hash,
        }

    def canonical_json(self) -> str:
        return canonical_json(self.to_dict())


@dataclass(frozen=True, slots=True)
class IdentityVerificationResult:
    identity: CompiledGraphIdentity | None
    diagnostics: tuple[Diagnostic, ...]

    @property
    def valid(self) -> bool:
        return self.identity is not None and not self.diagnostics

    def raise_for_errors(self) -> CompiledGraphIdentity:
        if self.identity is None:
            raise GraphIdentityError(self.diagnostics)
        return self.identity


class GraphIdentityError(ValueError):
    def __init__(self, diagnostics: tuple[Diagnostic, ...]) -> None:
        self.diagnostics = diagnostics
        summary = "; ".join(f"{item.code}: {item.message}" for item in diagnostics)
        super().__init__(summary or "compiled graph identity verification failed")


def _compiled_graph(graph: GraphInput) -> CompiledGraph:
    if type(graph) is CompiledGraph:
        # Public callers may have mutated a nested Pydantic JSON container.
        # Recompile that untrusted projection before creating a new identity.
        return compile_graph(graph.spec)
    return compile_graph(cast(GraphSpec | Mapping[str, Any], graph))


def _identity_without_revision_hash(
    compiled: CompiledGraph,
    graph_snapshot: JsonObject,
) -> tuple[
    JsonObject,
    tuple[NodeComponentIdentity, ...],
    tuple[EdgeComponentIdentity, ...],
    GraphSchemaIdentity,
]:
    node_identities: list[NodeComponentIdentity] = []
    raw_nodes = cast(list[JsonValue], graph_snapshot["nodes"])
    for index, raw_node in enumerate(raw_nodes):
        raw_node_object = cast(JsonObject, raw_node)
        node_identities.append(
            NodeComponentIdentity(
                id=cast(str, raw_node_object["id"]),
                index=index,
                content_hash=_component_hash("node", raw_node_object),
                input_schema_hash=_component_hash("schema", raw_node_object["inputSchema"]),
                output_schema_hash=_component_hash("schema", raw_node_object["outputSchema"]),
            )
        )

    edge_identities: list[EdgeComponentIdentity] = []
    raw_edges = cast(list[JsonValue], graph_snapshot["edges"])
    for index, raw_edge in enumerate(raw_edges):
        raw_edge_object = cast(JsonObject, raw_edge)
        edge_identities.append(
            EdgeComponentIdentity(
                id=cast(str, raw_edge_object["id"]),
                index=index,
                content_hash=_component_hash("edge", raw_edge_object),
                schema_hash=(
                    _component_hash("schema", raw_edge_object["schema"])
                    if "schema" in raw_edge_object
                    else None
                ),
            )
        )

    schema_identity = GraphSchemaIdentity(
        input=_component_hash("schema", graph_snapshot["inputSchema"]),
        output=_component_hash("schema", graph_snapshot["outputSchema"]),
        state=(
            _component_hash("schema", graph_snapshot["stateSchema"])
            if "stateSchema" in graph_snapshot
            else None
        ),
    )

    base: JsonObject = {
        "apiVersion": IDENTITY_API_VERSION,
        "kind": "CompiledGraphIdentity",
        "graphRevision": 1,
        "graphHash": compiled.graph_hash,
        "nodes": [item.to_dict() for item in node_identities],
        "edges": [item.to_dict() for item in edge_identities],
        "graphSchemas": schema_identity.to_dict(),
    }
    return base, tuple(node_identities), tuple(edge_identities), schema_identity


def _create_compiled_graph_identity_from_compiled(
    compiled: CompiledGraph,
) -> CompiledGraphIdentity:
    """Derive identity from one integration-owned compiler snapshot."""

    try:
        current_graph_hash = hashlib.sha256(
            compiled.canonical_graph.encode("utf-8")
        ).hexdigest()
        graph_document = json.loads(compiled.canonical_graph)
        graph_snapshot = cast(JsonObject, portable_json_snapshot(graph_document))
    except (
        UnicodeEncodeError,
        json.JSONDecodeError,
        PortableJsonError,
        RecursionError,
        TypeError,
        ValueError,
    ):
        raise GraphCompileError(
            (
                Diagnostic(
                    code=DiagnosticCode.INVALID_GRAPH,
                    message="compiled graph snapshot is not portable JSON",
                    path="#",
                ),
            )
        ) from None
    if current_graph_hash != compiled.graph_hash:
        raise GraphCompileError(
            (
                Diagnostic(
                    code=DiagnosticCode.INVALID_GRAPH,
                    message="compiled graph was mutated after compilation",
                    path="#",
                ),
            )
        )

    base, nodes, edges, graph_schemas = _identity_without_revision_hash(compiled, graph_snapshot)
    revision_hash = hashlib.sha256(REVISION_DOMAIN + canonical_bytes(base)).hexdigest()
    return CompiledGraphIdentity(
        api_version=IDENTITY_API_VERSION,
        kind="CompiledGraphIdentity",
        graph_revision=1,
        graph_hash=compiled.graph_hash,
        nodes=nodes,
        edges=edges,
        graph_schemas=graph_schemas,
        revision_hash=revision_hash,
    )


def create_compiled_graph_identity(graph: GraphInput) -> CompiledGraphIdentity:
    """Compile untrusted input and create the immutable revision-1 identity."""

    return _create_compiled_graph_identity_from_compiled(_compiled_graph(graph))


def _diagnostic(code: DiagnosticCode, message: str, path: str) -> IdentityVerificationResult:
    return IdentityVerificationResult(
        identity=None,
        diagnostics=(Diagnostic(code=code, message=message, path=path),),
    )


def _raw_identity(identity: CompiledGraphIdentity | Mapping[str, Any]) -> object:
    if type(identity) is not CompiledGraphIdentity:
        return identity

    # Candidate manifests are untrusted.  Do not dispatch through ``to_dict``:
    # an exact outer identity can still contain hostile subclasses in a nested
    # component tuple.  Validate the complete object topology by exact type,
    # then project fields directly from sealed dataclass implementations.
    nodes = identity.nodes
    edges = identity.edges
    graph_schemas = identity.graph_schemas
    if (
        type(nodes) is not tuple
        or type(edges) is not tuple
        or type(graph_schemas) is not GraphSchemaIdentity
        or any(type(node) is not NodeComponentIdentity for node in nodes)
        or any(type(edge) is not EdgeComponentIdentity for edge in edges)
    ):
        return identity

    return {
        "apiVersion": identity.api_version,
        "kind": identity.kind,
        "graphRevision": identity.graph_revision,
        "graphHash": identity.graph_hash,
        "nodes": [
            {
                "id": node.id,
                "index": node.index,
                "contentHash": node.content_hash,
                "inputSchemaHash": node.input_schema_hash,
                "outputSchemaHash": node.output_schema_hash,
            }
            for node in nodes
        ],
        "edges": [
            {
                "id": edge.id,
                "index": edge.index,
                "contentHash": edge.content_hash,
                "schemaHash": edge.schema_hash,
            }
            for edge in edges
        ],
        "graphSchemas": {
            "input": graph_schemas.input,
            "output": graph_schemas.output,
            "state": graph_schemas.state,
        },
        "revisionHash": identity.revision_hash,
    }


def verify_compiled_graph_identity(
    graph: GraphInput,
    identity: CompiledGraphIdentity | Mapping[str, Any],
) -> IdentityVerificationResult:
    """Verify an untrusted revision-1 manifest against a compiled graph.

    Revision failures are projected independently from graph-hash and component
    failures so callers can route the three stable diagnostic classes.
    """

    raw = _raw_identity(identity)
    if type(raw) is not dict:
        return _diagnostic(
            DiagnosticCode.COMPONENT_IDENTITY_MISMATCH,
            "identity manifest must be a portable JSON object",
            "#",
        )
    if any(type(key) is not str for key in raw):
        return _diagnostic(
            DiagnosticCode.COMPONENT_IDENTITY_MISMATCH,
            "identity manifest keys must be exact strings",
            "#",
        )

    try:
        snapshot = portable_json_snapshot(raw)
    except PortableJsonError:
        raw_revision = raw.get("graphRevision")
        revision_is_one = (type(raw_revision) is int and raw_revision == 1) or (
            type(raw_revision) is float and math.isfinite(raw_revision) and raw_revision == 1.0
        )
        if not revision_is_one:
            return _diagnostic(
                DiagnosticCode.UNSUPPORTED_GRAPH_REVISION,
                "only initial graph revision 1 is supported",
                "#/graphRevision",
            )
        return _diagnostic(
            DiagnosticCode.COMPONENT_IDENTITY_MISMATCH,
            "identity manifest is not portable JSON",
            "#",
        )

    if type(snapshot) is not dict:
        return _diagnostic(
            DiagnosticCode.COMPONENT_IDENTITY_MISMATCH,
            "identity manifest must be an object",
            "#",
        )

    revision = snapshot.get("graphRevision")
    if type(revision) is not int or revision != 1 or abs(revision) > MAX_SAFE_INTEGER:
        return _diagnostic(
            DiagnosticCode.UNSUPPORTED_GRAPH_REVISION,
            "only initial graph revision 1 is supported",
            "#/graphRevision",
        )

    try:
        expected = create_compiled_graph_identity(graph)
    except GraphCompileError as exc:
        return IdentityVerificationResult(identity=None, diagnostics=exc.diagnostics)

    graph_hash = snapshot.get("graphHash")
    if graph_hash != expected.graph_hash:
        return _diagnostic(
            DiagnosticCode.GRAPH_IDENTITY_MISMATCH,
            "identity graphHash does not match the canonical graph",
            "#/graphHash",
        )

    # Python considers ``False == 0`` and ``True == 1``. Identity manifests
    # are JSON documents, so compare canonical encodings to retain the JSON
    # type distinction while enforcing the complete closed shape.
    if canonical_bytes(snapshot) != canonical_bytes(expected.to_dict()):
        return _diagnostic(
            DiagnosticCode.COMPONENT_IDENTITY_MISMATCH,
            "identity component hashes, order, schema hashes, or revisionHash do not match",
            "#",
        )

    return IdentityVerificationResult(identity=expected, diagnostics=())


__all__ = [
    "COMPONENT_DOMAIN",
    "IDENTITY_API_VERSION",
    "REVISION_DOMAIN",
    "CompiledGraphIdentity",
    "EdgeComponentIdentity",
    "GraphIdentityError",
    "GraphSchemaIdentity",
    "IdentityVerificationResult",
    "NodeComponentIdentity",
    "create_compiled_graph_identity",
    "verify_compiled_graph_identity",
]
