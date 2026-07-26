"""Emit Python results for the shared graph-authoring conformance corpus."""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path
from typing import Any, cast

from graph_engineering import (
    GraphBuilderError,
    GraphSourceError,
    SourceLimits,
    canonical_json,
    create_compiled_graph_identity,
    graph_builder,
    parse_graph_source,
    try_compile_graph,
    verify_compiled_graph_identity,
)
from graph_engineering.compiler import Diagnostic
from graph_engineering.models import JsonObject, JsonValue

ROOT = Path(__file__).resolve().parents[2]
FIXTURE_ROOT = ROOT / "spec" / "conformance" / "authoring"


def load_json(name: str) -> JsonObject:
    return cast(JsonObject, json.loads((FIXTURE_ROOT / name).read_text(encoding="utf-8")))


def normalize_diagnostic(item: Diagnostic) -> JsonObject:
    node_ids = item.node_ids
    if node_ids is None and item.node_id is not None:
        node_ids = (item.node_id,)
    result: JsonObject = {
        "code": item.code.value,
        "path": item.path,
        "nodeIds": list(node_ids or ()),
    }
    if item.edge_id is not None:
        result["edgeId"] = item.edge_id
    if item.output_name is not None:
        result["outputName"] = item.output_name
    return result


def compile_report(document: JsonValue) -> JsonObject:
    if not isinstance(document, dict):
        result = try_compile_graph(cast(dict[str, Any], document))
    else:
        result = try_compile_graph(document)
    report: JsonObject = {
        "valid": result.valid,
        "diagnostics": [normalize_diagnostic(item) for item in result.diagnostics],
    }
    if result.graph is None:
        return report
    identity = create_compiled_graph_identity(result.graph)
    graph_document = result.graph.spec.model_dump(mode="json", by_alias=True, exclude_unset=True)
    report.update(
        {
            "graph": cast(JsonValue, graph_document),
            "canonicalGraph": canonical_json(result.graph.spec),
            "graphHash": result.graph.graph_hash,
            "identity": identity.to_dict(),
            "topologicalLayers": [list(layer) for layer in result.graph.topological_layers],
        }
    )
    return report


def build_report(document: JsonObject) -> JsonObject:
    options: dict[str, Any] = {
        "metadata": document["metadata"],
        "input_schema": document["inputSchema"],
        "output_schema": document["outputSchema"],
    }
    if "stateSchema" in document:
        options["state_schema"] = document["stateSchema"]
    if "policies" in document:
        options["policies"] = document["policies"]
    builder = graph_builder(**options)
    for node in cast(list[JsonObject], document["nodes"]):
        builder.add_node(node)
    for edge in cast(list[JsonObject], document["edges"]):
        builder.add_edge(edge)
    for entrypoint in cast(list[str], document["entrypoints"]):
        builder.add_entrypoint(entrypoint)
    for name, endpoint in cast(dict[str, JsonObject], document["outputs"]).items():
        builder.add_output(name, endpoint)
    built = builder.build()
    return {
        "valid": True,
        "diagnostics": [],
        "graph": cast(
            JsonValue,
            built.graph.model_dump(mode="json", by_alias=True, exclude_unset=True),
        ),
        "canonicalGraph": built.canonical_graph,
        "graphHash": built.graph_hash,
        "identity": built.identity.to_dict(),
    }


def capture_builder_failure(operation: Callable[[], object]) -> JsonObject:
    try:
        operation()
    except GraphBuilderError as error:
        return {
            "code": error.code.value,
            "path": error.path,
            "diagnosticCodes": [item.code.value for item in error.diagnostics],
        }
    raise AssertionError("builder diagnostic operation unexpectedly succeeded")


def builder_diagnostic_report() -> dict[str, JsonObject]:
    node: JsonObject = {
        "id": "a",
        "kind": "transform",
        "inputSchema": {},
        "outputSchema": {},
        "config": None,
    }
    edge: JsonObject = {
        "id": "edge",
        "from": {"node": "a"},
        "to": {"node": "b"},
    }

    def make_builder() -> Any:
        return graph_builder(
            metadata={"name": "builder-diagnostics", "version": "1"},
            input_schema={},
            output_schema={},
        )

    def sealed_builder() -> Any:
        builder = (
            make_builder()
            .add_node(node)
            .add_entrypoint("a")
            .add_output("result", {"node": "a"})
        )
        builder.build()
        return builder

    def duplicate_node() -> object:
        return make_builder().add_node(node).add_node(node)

    def duplicate_edge() -> object:
        return make_builder().add_edge(edge).add_edge(edge)

    def duplicate_entrypoint() -> object:
        return make_builder().add_entrypoint("a").add_entrypoint("a")

    def duplicate_output() -> object:
        return make_builder().add_output("result", {"node": "a"}).add_output(
            "result", {"node": "a"}
        )

    def missing_entrypoint() -> object:
        return make_builder().add_node(node).add_output("result", {"node": "a"}).build()

    def missing_output() -> object:
        return make_builder().add_node(node).add_entrypoint("a").build()

    def core_rejected() -> object:
        return (
            make_builder()
            .add_node(node)
            .add_entrypoint("missing")
            .add_output("result", {"node": "also-missing"})
            .build()
        )

    operations: dict[str, Callable[[], object]] = {
        "constructor-missing-metadata": lambda: graph_builder(
            input_schema={}, output_schema={}
        ),
        "constructor-missing-input-schema": lambda: graph_builder(
            metadata={"name": "builder-diagnostics", "version": "1"}, output_schema={}
        ),
        "constructor-missing-output-schema": lambda: graph_builder(
            metadata={"name": "builder-diagnostics", "version": "1"}, input_schema={}
        ),
        "duplicate-node": duplicate_node,
        "duplicate-edge": duplicate_edge,
        "duplicate-entrypoint": duplicate_entrypoint,
        "duplicate-output": duplicate_output,
        "malformed-node": lambda: make_builder().add_node({"id": "a"}),
        "malformed-edge": lambda: make_builder().add_edge(
            {"id": "bad edge", "from": {"node": "a"}, "to": {"node": "b"}}
        ),
        "malformed-output": lambda: make_builder().add_output(
            "result", {"node": "a", "port": None}
        ),
        "malformed-policies": lambda: make_builder().set_policies({"maxDepth": 0}),
        "missing-entrypoint": missing_entrypoint,
        "missing-output": missing_output,
        "core-rejected": core_rejected,
    }

    sealed = sealed_builder()
    operations.update(
        {
            "sealed-add-node": lambda: sealed.add_node(node),
            "sealed-add-edge": lambda: sealed.add_edge(edge),
            "sealed-add-entrypoint": lambda: sealed.add_entrypoint("next"),
            "sealed-add-output": lambda: sealed.add_output("next/value~", {"node": "a"}),
            "sealed-set-policies": lambda: sealed.set_policies({}),
            "sealed-enable-typed-ports": sealed.enable_strict_typed_ports,
            "sealed-build": sealed.build,
        }
    )
    return {name: capture_builder_failure(operation) for name, operation in operations.items()}


def source_limits(document: JsonObject) -> SourceLimits:
    return SourceLimits(
        max_bytes=cast(int, document.get("maxBytes", 1024 * 1024)),
        max_depth=cast(int, document.get("maxDepth", 100)),
        max_nodes=cast(int, document.get("maxNodes", 100_000)),
    )


def source_failure_report(test_case: JsonObject) -> JsonObject:
    if "sourceHex" in test_case:
        source: str | bytes = bytes.fromhex(cast(str, test_case["sourceHex"]))
    elif "sourceRepeat" in test_case:
        repeat = cast(JsonObject, test_case["sourceRepeat"])
        source = (
            cast(str, repeat.get("prefix", ""))
            + cast(str, repeat["value"]) * cast(int, repeat["count"])
            + cast(str, repeat.get("suffix", ""))
        )
    elif "sourceSegments" in test_case:
        source = "".join(
            cast(str, segment["value"]) * cast(int, segment["count"])
            for segment in cast(list[JsonObject], test_case["sourceSegments"])
        )
    else:
        source = cast(str, test_case["source"])
    try:
        parse_graph_source(
            source,
            format=cast(Any, test_case["format"]),
            limits=source_limits(cast(JsonObject, test_case.get("limits", {}))),
        )
    except GraphSourceError as error:
        return cast(JsonObject, error.to_dict())
    raise AssertionError(f"{test_case['name']}: invalid source was accepted")


def pointer_parts(path: str) -> list[str]:
    if path == "#":
        return []
    if not path.startswith("#/"):
        raise ValueError(f"unsupported fixture pointer: {path}")
    return [part.replace("~1", "/").replace("~0", "~") for part in path[2:].split("/")]


def mutate_identity(identity: JsonObject, mutation: JsonObject) -> JsonObject:
    candidate = cast(JsonObject, json.loads(json.dumps(identity)))
    parts = pointer_parts(cast(str, mutation["path"]))
    parent: JsonObject | list[JsonValue] = candidate
    for part in parts[:-1]:
        parent = cast(
            JsonObject | list[JsonValue],
            parent[int(part)] if isinstance(parent, list) else parent[part],
        )
    operation = mutation["operation"]
    final = parts[-1]
    target = parent[int(final)] if isinstance(parent, list) else parent[final]
    if operation == "replace":
        if isinstance(parent, list):
            parent[int(final)] = cast(JsonValue, mutation["value"])
        else:
            parent[final] = cast(JsonValue, mutation["value"])
    elif operation == "swap":
        sequence = cast(list[JsonValue], target)
        indices = cast(list[int], mutation["indices"])
        left, right = indices
        sequence[left], sequence[right] = sequence[right], sequence[left]
    else:
        raise ValueError(f"unsupported fixture mutation: {operation}")
    return candidate


def main() -> None:
    cases = load_json("authoring.case.json")
    golden = cast(dict[str, JsonObject], load_json("component-identity.expected.json")["identities"])
    report: dict[str, Any] = {
        "equivalence": {},
        "validSource": {},
        "sourceBoundary": {},
        "compilerInvalid": {},
        "builderDiagnostics": builder_diagnostic_report(),
        "typedDiagnostics": {},
        "sourceFailures": {},
        "identityMutations": {},
    }

    for test_case in cast(list[JsonObject], cases["equivalenceCases"]):
        json_document = parse_graph_source(
            (FIXTURE_ROOT / cast(str, test_case["json"])).read_bytes(),
            format="json",
        )
        yaml_document = parse_graph_source(
            (FIXTURE_ROOT / cast(str, test_case["yaml"])).read_bytes(),
            format="yaml",
        )
        expected_document = load_json(cast(str, test_case["builderGraph"]))
        report["equivalence"][test_case["name"]] = {
            "json": compile_report(json_document),
            "yaml": compile_report(yaml_document),
            "builder": build_report(expected_document),
        }

    for test_case in cast(list[JsonObject], cases["validSourceCases"]):
        source_name = cast(str, test_case.get("yaml") or test_case.get("json"))
        format_name = "yaml" if "yaml" in test_case else "json"
        document = parse_graph_source(
            (FIXTURE_ROOT / source_name).read_bytes(),
            format=cast(Any, format_name),
        )
        if not isinstance(document, dict):
            raise TypeError(f"{test_case['name']}: valid graph source is not an object")
        report["validSource"][test_case["name"]] = {
            "source": compile_report(document),
            "builder": build_report(document),
        }

    for test_case in cast(list[JsonObject], cases["sourceBoundaryCases"]):
        value = parse_graph_source(
            cast(str, test_case["source"]),
            format=cast(Any, test_case["format"]),
            limits=source_limits(cast(JsonObject, test_case["limits"])),
        )
        report["sourceBoundary"][test_case["name"]] = {"value": value}

    for test_case in cast(list[JsonObject], cases["compilerInvalidYamlCases"]):
        document = parse_graph_source(
            (FIXTURE_ROOT / cast(str, test_case["yaml"])).read_bytes(),
            format="yaml",
        )
        report["compilerInvalid"][test_case["name"]] = compile_report(document)

    for test_case in cast(list[JsonObject], cases["typedDiagnosticCases"]):
        document = load_json(cast(str, test_case["graph"]))
        report["typedDiagnostics"][test_case["name"]] = compile_report(document)

    source_cases = load_json("yaml-invalid.case.json")
    for test_case in cast(list[JsonObject], source_cases["cases"]):
        report["sourceFailures"][test_case["name"]] = source_failure_report(test_case)

    graph_by_identity = {
        "equivalent": load_json("equivalent.graph.json"),
        "typed-ports": load_json("typed-ports.graph.json"),
        "unicode-and-keys": load_json("unicode-and-keys.graph.json"),
    }
    for test_case in cast(list[JsonObject], cases["identityMutationCases"]):
        identity_key = cast(str, test_case["identityKey"])
        candidate = mutate_identity(
            golden[identity_key],
            cast(JsonObject, test_case["mutation"]),
        )
        result = verify_compiled_graph_identity(graph_by_identity[identity_key], candidate)
        report["identityMutations"][test_case["name"]] = {
            "valid": result.valid,
            "diagnostics": [normalize_diagnostic(item) for item in result.diagnostics],
        }

    print(json.dumps(report, ensure_ascii=True, sort_keys=True, separators=(",", ":")))


if __name__ == "__main__":
    main()
