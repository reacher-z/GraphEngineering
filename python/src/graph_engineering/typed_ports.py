"""Opt-in strict-exact typed-port validation for Graph IR v1alpha1."""

from __future__ import annotations

from typing import TypeAlias

from jsonschema import Draft202012Validator  # type: ignore[import-untyped]
from jsonschema.exceptions import SchemaError  # type: ignore[import-untyped]

from .canonical import canonical_json
from .compiler import Diagnostic, DiagnosticCode
from .models import GraphSpec, JsonObject, JsonValue, NodeSpec

TYPED_PORT_POLICY_KEY = "graphengineering.reacher-z.github.io/typed-ports"
TYPED_PORT_POLICY_API_VERSION = "graphengineering.reacher-z.github.io/typed-ports/v1alpha1"
TYPED_PORT_POLICY_MODE = "strict-exact"
TYPED_PORT_POLICY_PATH = "#/policies/graphengineering.reacher-z.github.io~1typed-ports"
TYPED_PORT_SCHEMA_DIALECT = "https://json-schema.org/draft/2020-12/schema"

SchemaValue: TypeAlias = JsonObject | bool


def _pointer(path: str, part: str | int) -> str:
    escaped = str(part).replace("~", "~0").replace("/", "~1")
    return f"{path}/{escaped}" if path != "#" else f"#/{escaped}"


def _uses_unsupported_schema_feature(schema: JsonObject) -> bool:
    remaining: list[JsonObject] = [schema]
    while remaining:
        current = remaining.pop()
        if "$ref" in current or "$dynamicRef" in current:
            return True
        if "pattern" in current or "patternProperties" in current:
            return True
        if "enum" in current and type(current["enum"]) is list and not current["enum"]:
            return True
        if "$schema" in current and current["$schema"] != TYPED_PORT_SCHEMA_DIALECT:
            return True

        # Walk only locations whose JSON Schema vocabulary declares another
        # schema. Arbitrary data below const/default/examples/enum, and names
        # inside schema maps, are not themselves schemas and must not be
        # mistaken for unsupported keywords.
        for keyword in ("$defs", "definitions", "properties", "dependentSchemas"):
            schema_map = current.get(keyword)
            if isinstance(schema_map, dict):
                remaining.extend(value for value in schema_map.values() if isinstance(value, dict))

        dependencies = current.get("dependencies")
        if isinstance(dependencies, dict):
            remaining.extend(value for value in dependencies.values() if isinstance(value, dict))

        for keyword in (
            "additionalProperties",
            "unevaluatedProperties",
            "propertyNames",
            "contains",
            "not",
            "if",
            "then",
            "else",
            "items",
            "unevaluatedItems",
            "contentSchema",
        ):
            nested = current.get(keyword)
            if isinstance(nested, dict):
                remaining.append(nested)

        for keyword in ("prefixItems", "allOf", "anyOf", "oneOf"):
            nested_array = current.get(keyword)
            if isinstance(nested_array, list):
                remaining.extend(value for value in nested_array if isinstance(value, dict))
    return False


def _schema_is_valid(schema: JsonObject) -> bool:
    if _uses_unsupported_schema_feature(schema):
        return False
    try:
        Draft202012Validator.check_schema(schema)
    except (SchemaError, RecursionError):
        return False
    return True


def _schema_diagnostic(
    path: str,
    *,
    node_id: str | None = None,
    node_ids: tuple[str, ...] | None = None,
    edge_id: str | None = None,
) -> Diagnostic:
    return Diagnostic(
        code=DiagnosticCode.INVALID_PORT_SCHEMA,
        message="strict typed-port schema is not supported by the v1alpha1 profile",
        node_id=node_id,
        node_ids=node_ids,
        edge_id=edge_id,
        path=path,
    )


def _node_ids(*values: str) -> tuple[str, ...]:
    """Keep declaration-role order while projecting identifier set semantics."""

    return tuple(dict.fromkeys(values))


def _policy_value(graph: GraphSpec) -> JsonValue | None:
    if graph.policies is None:
        return None
    return (graph.policies.model_extra or {}).get(TYPED_PORT_POLICY_KEY)


def _policy_enabled(graph: GraphSpec) -> tuple[bool, tuple[Diagnostic, ...]]:
    value = _policy_value(graph)
    if graph.policies is None or TYPED_PORT_POLICY_KEY not in (graph.policies.model_extra or {}):
        return False, ()
    expected: JsonObject = {
        "apiVersion": TYPED_PORT_POLICY_API_VERSION,
        "mode": TYPED_PORT_POLICY_MODE,
    }
    if type(value) is not dict or value != expected:
        return (
            True,
            (
                Diagnostic(
                    code=DiagnosticCode.INVALID_PORT_SCHEMA,
                    message="strict typed-port policy must match the v1alpha1 profile exactly",
                    path=TYPED_PORT_POLICY_PATH,
                ),
            ),
        )
    return True, ()


def _schema_profile_diagnostics(graph: GraphSpec) -> tuple[Diagnostic, ...]:
    checks: list[tuple[JsonObject, str, str | None, tuple[str, ...] | None, str | None]] = [
        (graph.input_schema, "#/inputSchema", None, None, None),
        (graph.output_schema, "#/outputSchema", None, None, None),
    ]
    if graph.state_schema is not None:
        checks.append((graph.state_schema, "#/stateSchema", None, None, None))
    for index, node in enumerate(graph.nodes):
        checks.extend(
            (
                (
                    node.input_schema,
                    f"#/nodes/{index}/inputSchema",
                    node.id,
                    (node.id,),
                    None,
                ),
                (
                    node.output_schema,
                    f"#/nodes/{index}/outputSchema",
                    node.id,
                    (node.id,),
                    None,
                ),
            )
        )
    for index, edge in enumerate(graph.edges):
        if edge.schema_ is not None:
            checks.append(
                (
                    edge.schema_,
                    f"#/edges/{index}/schema",
                    None,
                    None,
                    edge.id,
                )
            )

    diagnostics: list[Diagnostic] = []
    for schema, path, node_id, node_ids, edge_id in checks:
        if not _schema_is_valid(schema):
            diagnostics.append(
                _schema_diagnostic(
                    path,
                    node_id=node_id,
                    node_ids=node_ids,
                    edge_id=edge_id,
                )
            )
    return tuple(diagnostics)


def _object_property(schema: JsonObject, name: str) -> SchemaValue | None:
    if schema.get("type") != "object":
        return None
    properties = schema.get("properties")
    required = schema.get("required")
    if not isinstance(properties, dict) or not isinstance(required, list):
        return None
    if name not in required:
        return None
    value = properties.get(name)
    if type(value) is dict:
        return value
    if type(value) is bool:
        return value
    return None


def _schemas_equal(left: SchemaValue, right: SchemaValue) -> bool:
    return canonical_json(left) == canonical_json(right)


def _edge_binding_diagnostics(
    graph: GraphSpec,
    node_by_id: dict[str, NodeSpec],
) -> list[Diagnostic]:
    diagnostics: list[Diagnostic] = []
    seen_bindings: set[tuple[str, str]] = set()

    for index, edge in enumerate(graph.edges):
        edge_path = f"#/edges/{index}"
        producer = node_by_id[edge.source.node]
        consumer = node_by_id[edge.target.node]
        if edge.mode not in (None, "value"):
            diagnostics.append(
                Diagnostic(
                    code=DiagnosticCode.UNSUPPORTED_TYPED_EDGE_MODE,
                    message="strict typed ports support only value edges",
                    node_id=producer.id,
                    node_ids=_node_ids(producer.id, consumer.id),
                    edge_id=edge.id,
                    path=f"{edge_path}/mode",
                )
            )

        source_schema: SchemaValue | None
        if edge.source.port is None:
            source_schema = producer.output_schema
        else:
            source_schema = _object_property(producer.output_schema, edge.source.port)
            if source_schema is None:
                diagnostics.append(
                    Diagnostic(
                        code=DiagnosticCode.MISSING_SOURCE_PORT,
                        message="source port is not a required output-schema property",
                        node_id=producer.id,
                        node_ids=(producer.id,),
                        edge_id=edge.id,
                        path=f"{edge_path}/from/port",
                    )
                )

        binding_key = edge.target.port or edge.source.node
        target_schema = _object_property(consumer.input_schema, binding_key)
        if target_schema is None:
            diagnostics.append(
                Diagnostic(
                    code=DiagnosticCode.MISSING_TARGET_PORT,
                    message="target binding is not a required input-schema property",
                    node_id=consumer.id,
                    node_ids=(consumer.id,),
                    edge_id=edge.id,
                    path=f"{edge_path}/to" + ("/port" if edge.target.port is not None else ""),
                )
            )

        binding = (consumer.id, binding_key)
        if binding in seen_bindings:
            diagnostics.append(
                Diagnostic(
                    code=DiagnosticCode.DUPLICATE_TARGET_BINDING,
                    message="multiple edges bind the same target input property",
                    node_id=consumer.id,
                    node_ids=(consumer.id,),
                    edge_id=edge.id,
                    path=f"{edge_path}/to" + ("/port" if edge.target.port is not None else ""),
                )
            )
        else:
            seen_bindings.add(binding)

        if source_schema is None or target_schema is None:
            continue
        schemas = [source_schema, target_schema]
        if edge.schema_ is not None:
            schemas.append(edge.schema_)
        if any(not _schemas_equal(schemas[0], item) for item in schemas[1:]):
            diagnostics.append(
                Diagnostic(
                    code=DiagnosticCode.PORT_SCHEMA_MISMATCH,
                    message="source, edge, and target schemas must be canonical-identical",
                    node_id=producer.id,
                    node_ids=_node_ids(producer.id, consumer.id),
                    edge_id=edge.id,
                    path=edge_path,
                )
            )
    return diagnostics


def _output_diagnostics(
    graph: GraphSpec,
    node_by_id: dict[str, NodeSpec],
) -> list[Diagnostic]:
    diagnostics: list[Diagnostic] = []
    for output_name in sorted(graph.outputs):
        endpoint = graph.outputs[output_name]
        node = node_by_id[endpoint.node]
        output_path = _pointer("#/outputs", output_name)
        selected_schema: SchemaValue | None
        if endpoint.port is None:
            selected_schema = node.output_schema
        else:
            selected_schema = _object_property(node.output_schema, endpoint.port)
            if selected_schema is None:
                diagnostics.append(
                    Diagnostic(
                        code=DiagnosticCode.MISSING_SOURCE_PORT,
                        message="public output port is not a required output-schema property",
                        node_id=node.id,
                        node_ids=(node.id,),
                        output_name=output_name,
                        path=f"{output_path}/port",
                    )
                )

        public_schema = _object_property(graph.output_schema, output_name)
        if public_schema is None:
            diagnostics.append(
                Diagnostic(
                    code=DiagnosticCode.OUTPUT_SCHEMA_MISMATCH,
                    message="public output is not a required graph output-schema property",
                    node_id=node.id,
                    node_ids=(node.id,),
                    output_name=output_name,
                    path=output_path,
                )
            )
        elif selected_schema is not None and not _schemas_equal(selected_schema, public_schema):
            diagnostics.append(
                Diagnostic(
                    code=DiagnosticCode.OUTPUT_SCHEMA_MISMATCH,
                    message="public output binding schema does not match graph outputSchema",
                    node_id=node.id,
                    node_ids=(node.id,),
                    output_name=output_name,
                    path=output_path,
                )
            )
    return diagnostics


def validate_strict_typed_ports(graph: GraphSpec) -> tuple[Diagnostic, ...]:
    """Return deterministic strict-exact diagnostics for an opted-in graph."""

    enabled, policy_diagnostics = _policy_enabled(graph)
    if not enabled:
        return ()
    if policy_diagnostics:
        return policy_diagnostics

    schema_diagnostics = _schema_profile_diagnostics(graph)
    if schema_diagnostics:
        return schema_diagnostics

    node_by_id = {node.id: node for node in graph.nodes}
    diagnostics: list[Diagnostic] = []
    for index, entrypoint in enumerate(graph.entrypoints):
        node = node_by_id[entrypoint]
        if not _schemas_equal(graph.input_schema, node.input_schema):
            diagnostics.append(
                Diagnostic(
                    code=DiagnosticCode.ENTRYPOINT_SCHEMA_MISMATCH,
                    message="entrypoint input schema must match graph inputSchema exactly",
                    node_id=node.id,
                    node_ids=(node.id,),
                    path=f"#/entrypoints/{index}",
                )
            )

    diagnostics.extend(_edge_binding_diagnostics(graph, node_by_id))
    diagnostics.extend(_output_diagnostics(graph, node_by_id))
    return tuple(diagnostics)


def strict_typed_ports_policy() -> JsonObject:
    """Return a fresh portable policy extension value for builder helpers."""

    return {
        "apiVersion": TYPED_PORT_POLICY_API_VERSION,
        "mode": TYPED_PORT_POLICY_MODE,
    }


__all__ = [
    "TYPED_PORT_POLICY_API_VERSION",
    "TYPED_PORT_POLICY_KEY",
    "TYPED_PORT_POLICY_MODE",
    "TYPED_PORT_SCHEMA_DIALECT",
    "strict_typed_ports_policy",
    "validate_strict_typed_ports",
]
