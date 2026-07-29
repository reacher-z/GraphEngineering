"""Native, bounded command-line interface for Graph Engineering Graph IR.

The CLI is an adapter over the Python source decoder and canonical compiler. It
does not execute graph nodes, invoke providers, or delegate to the Node CLI.
"""

from __future__ import annotations

import errno
import importlib.metadata
import importlib.resources
import io as io_module
import os
import sys
from collections.abc import Callable, Mapping, Sequence
from contextlib import suppress
from dataclasses import dataclass
from types import ModuleType
from typing import BinaryIO, Final, Literal, TextIO, cast

from ._json import compact_json
from .compiler import CompilationResult, Diagnostic, try_compile_graph
from .models import Endpoint, GraphSpec
from .source import (
    MAX_SOURCE_BYTES,
    GraphSourceError,
    SourceErrorCode,
    SourceFormat,
    parse_graph_source,
)

CLI_VERSION: Final = "0.1.0-alpha.1"
MACHINE_SCHEMA_VERSION: Final = "graph-engineering.cli/v1alpha1"
QUICKSTART_TEMPLATE: Final = "quickstart/research-diamond.graph.json"
QUICKSTART_RESOURCE: Final = "data/research-diamond.graph.json"
QUICKSTART_HASH: Final = "f9aaeffc991e6cec223c959dbf7737a8fff96e1eb1ea433343f45fe663697b50"

CommandName = Literal["validate", "plan", "compile", "visualize", "doctor", "init"]
GraphInputFormat = Literal["json", "yaml", "auto"]
VisualizationFormat = Literal["mermaid", "dot"]


class ExitCode:
    """Stable process status values shared with the TypeScript CLI."""

    SUCCESS: Final = 0
    INVALID_GRAPH: Final = 1
    INPUT: Final = 2
    UNHEALTHY: Final = 3
    INTERNAL: Final = 70


@dataclass(frozen=True, slots=True)
class _ParsedCommand:
    command: CommandName
    file: str | None
    json: bool
    dry_run: bool
    format: VisualizationFormat | None
    input_format: GraphInputFormat | None


@dataclass(frozen=True, slots=True)
class _CliIo:
    stdin: BinaryIO
    stdout: TextIO
    stderr: TextIO


class _CliError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        exit_code: int = ExitCode.INPUT,
        *,
        details: Mapping[str, object] | None = None,
        human_message: str | None = None,
    ) -> None:
        self.code = code
        self.exit_code = exit_code
        self.details = dict(details or {})
        self.human_message = message if human_message is None else human_message
        super().__init__(message)

    def machine_error(self) -> dict[str, object]:
        return {"code": self.code, "message": str(self), **self.details}


@dataclass(frozen=True, slots=True)
class _ValidationResult:
    valid: bool
    graph: GraphSpec | None
    graph_name: str | None
    graph_hash: str | None
    canonical_graph: str | None
    topological_layers: tuple[tuple[str, ...], ...]
    diagnostics: tuple[Diagnostic, ...]


@dataclass(frozen=True, slots=True)
class _VisualizationResult:
    format: VisualizationFormat
    content: str
    node_count: int
    edge_count: int


@dataclass(frozen=True, slots=True)
class _DoctorCheck:
    id: str
    status: Literal["pass", "fail"]
    summary: str
    detail: str

    def to_dict(self) -> dict[str, object]:
        return {
            "id": self.id,
            "status": self.status,
            "summary": self.summary,
            "detail": self.detail,
        }


@dataclass(frozen=True, slots=True)
class _DoctorReport:
    healthy: bool
    checks: tuple[_DoctorCheck, ...]
    remediations: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class _DoctorProbes:
    python_version: tuple[int, int, int] | None = None
    read_template: Callable[[], bytes] | None = None
    distribution_version: Callable[[], str] | None = None
    compiler_module: ModuleType | None = None
    source_module: ModuleType | None = None


@dataclass(frozen=True, slots=True)
class _InitReport:
    target_directory: str
    dry_run: bool
    created: bool
    directory_created: bool
    would_create_directory: bool
    files: tuple[str, ...]
    template: str
    graph_hash: str


@dataclass(frozen=True, slots=True)
class _OwnedDirectory:
    path: str
    device: int
    inode: int


def _usage() -> str:
    return f"""Graph Engineering CLI {CLI_VERSION}

Usage:
  graph validate <graph.json|graph.yaml|-> [--input-format json|yaml|auto] [--json]
  graph plan <graph.json|graph.yaml|-> [--input-format json|yaml|auto] [--json]
  graph compile <graph.json|graph.yaml|-> [--input-format json|yaml|auto] [--json]
  graph visualize <graph.json|graph.yaml|-> [--input-format json|yaml|auto]
                  [--format mermaid|dot] [--json]
  graph doctor [--json]
  graph init [directory] [--dry-run] [--json]
  graph --version
  graph --help

Commands:
  validate  Compile Graph IR and report stable diagnostics
  plan      Show deterministic topological layers without executing nodes
  compile   Return Python-core canonical Graph IR and SHA-256 without writing files
  visualize Render a read-only Mermaid (default) or DOT topology after compilation
  doctor    Run bounded, read-only local Python installation checks
  init      Safely create graph.json from the bundled research-diamond template

Exit codes:
  0 success/healthy
  1 invalid Graph IR
  2 usage/input error or refused safe initialization
  3 doctor found an unhealthy local installation
  70 unexpected internal error"""


def _requested_json(argv: Sequence[str]) -> bool:
    return "--json" in argv


def _infer_command(argv: Sequence[str]) -> CommandName | None:
    for argument in argv:
        if argument in {"validate", "plan", "compile", "visualize", "doctor", "init"}:
            return cast(CommandName, argument)
    return None


def _parse_arguments(argv: Sequence[str]) -> _ParsedCommand | Literal["help", "version"]:
    if "--help" in argv or "-h" in argv:
        return "help"
    if "--version" in argv or "-v" in argv:
        return "version"

    json_count = argv.count("--json")
    if json_count > 1:
        raise _CliError("GECLI_USAGE", "--json may be specified at most once")
    json_mode = json_count == 1

    dry_run_count = argv.count("--dry-run")
    if dry_run_count > 1:
        raise _CliError("GECLI_USAGE", "--dry-run may be specified at most once")
    dry_run = dry_run_count == 1

    format_value: str | None = None
    format_count = 0
    input_format_value: str | None = None
    input_format_count = 0
    positionals: list[str] = []
    index = 0
    while index < len(argv):
        argument = argv[index]
        if argument in {"--json", "--dry-run"}:
            index += 1
            continue
        if argument == "--format":
            format_count += 1
            value = argv[index + 1] if index + 1 < len(argv) else None
            if value is None or value.startswith("-"):
                raise _CliError("GECLI_USAGE", "--format requires mermaid or dot")
            format_value = value
            index += 2
            continue
        if argument.startswith("--format="):
            format_count += 1
            format_value = argument[len("--format=") :]
            index += 1
            continue
        if argument == "--input-format":
            input_format_count += 1
            value = argv[index + 1] if index + 1 < len(argv) else None
            if value is None or value.startswith("-"):
                raise _CliError("GECLI_USAGE", "--input-format requires json, yaml, or auto")
            input_format_value = value
            index += 2
            continue
        if argument.startswith("--input-format="):
            input_format_count += 1
            input_format_value = argument[len("--input-format=") :]
            index += 1
            continue
        positionals.append(argument)
        index += 1

    if format_count > 1:
        raise _CliError("GECLI_USAGE", "--format may be specified at most once")
    if input_format_count > 1:
        raise _CliError("GECLI_USAGE", "--input-format may be specified at most once")

    raw_command = positionals[0] if positionals else None
    operands = positionals[1:]
    if raw_command not in {"validate", "plan", "compile", "visualize", "doctor", "init"}:
        raise _CliError(
            "GECLI_USAGE",
            "expected command validate, plan, compile, visualize, doctor, or init",
        )
    command = cast(CommandName, raw_command)

    if dry_run and command != "init":
        raise _CliError("GECLI_USAGE", "--dry-run is supported only by init")
    if format_count > 0 and command != "visualize":
        raise _CliError("GECLI_USAGE", "--format is supported only by visualize")
    if input_format_count > 0 and command in {"doctor", "init"}:
        raise _CliError("GECLI_USAGE", f"--input-format is not supported by {command}")

    if input_format_value is None or input_format_value == "auto":
        input_format: GraphInputFormat = "auto"
    elif input_format_value in {"json", "yaml"}:
        input_format = cast(GraphInputFormat, input_format_value)
    else:
        raise _CliError(
            "GECLI_USAGE",
            f"unsupported input format {input_format_value}; expected json, yaml, or auto",
        )

    visualization_format: VisualizationFormat | None = None
    if command == "visualize":
        if format_value is None or format_value == "mermaid":
            visualization_format = "mermaid"
        elif format_value == "dot":
            visualization_format = "dot"
        else:
            raise _CliError(
                "GECLI_USAGE",
                f"unsupported visualization format {format_value}; expected mermaid or dot",
            )

    if command == "doctor":
        if operands:
            raise _CliError("GECLI_USAGE", "doctor does not accept a file or other operand")
        return _ParsedCommand(command, None, json_mode, False, None, None)

    if command == "init":
        if len(operands) > 1:
            raise _CliError("GECLI_USAGE", "init accepts at most one target directory")
        directory = operands[0] if operands else "."
        if directory.startswith("-") and directory != "-":
            raise _CliError(
                "GECLI_USAGE",
                f"unknown option {directory}; prefix a directory name with ./ "
                "if it begins with '-'",
            )
        return _ParsedCommand(command, directory, json_mode, dry_run, None, None)

    if len(operands) != 1 or not operands[0]:
        raise _CliError("GECLI_USAGE", f"{command} requires exactly one Graph IR source")
    return _ParsedCommand(
        command,
        operands[0],
        json_mode,
        False,
        visualization_format,
        input_format,
    )


def _resolve_source_format(path: str, requested: GraphInputFormat) -> SourceFormat:
    if requested != "auto":
        return requested
    if path == "-":
        return "json"
    extension = os.path.splitext(path)[1].lower()
    if extension == ".json":
        return "json"
    if extension in {".yaml", ".yml"}:
        return "yaml"
    if not extension:
        message = (
            "cannot infer an input format without a file extension; "
            "use --input-format json or yaml"
        )
    else:
        message = (
            f"cannot infer an input format from extension '{extension}'; "
            "use --input-format json or yaml"
        )
    raise _CliError("GECLI_INPUT_FORMAT", message)


def _source_error(error: GraphSourceError, path: str) -> _CliError:
    source_name = "standard input" if path == "-" else os.path.basename(path)
    human = f"invalid {error.format.upper()} in {source_name}: {error.message}"
    return _CliError(
        error.code.value,
        error.message,
        details={
            "format": error.format,
            "path": error.path,
            "line": error.line,
            "column": error.column,
        },
        human_message=human,
    )


def _too_large_error(format: SourceFormat, path: str) -> _CliError:
    error = GraphSourceError(
        SourceErrorCode.TOO_LARGE,
        format,
        "source exceeds the configured byte limit",
    )
    return _source_error(error, path)


def _read_bounded(stream: BinaryIO, *, format: SourceFormat, path: str) -> bytes:
    chunks: list[bytes] = []
    total = 0
    while True:
        remaining_with_sentinel = MAX_SOURCE_BYTES + 1 - total
        if remaining_with_sentinel <= 0:
            raise _too_large_error(format, path)
        chunk = stream.read(min(64 * 1024, remaining_with_sentinel))
        if not chunk:
            break
        if type(chunk) is not bytes:
            raise TypeError("binary input stream returned a non-bytes value")
        chunks.append(chunk)
        total += len(chunk)
        if total > MAX_SOURCE_BYTES:
            raise _too_large_error(format, path)
    return b"".join(chunks)


def _read_graph(path: str, requested: GraphInputFormat, stdin: BinaryIO) -> object:
    # Resolve transport format before touching a path. This makes an ambiguous
    # extension a deterministic input error and avoids opening an unintended file.
    source_format = _resolve_source_format(path, requested)
    if path == "-":
        source = _read_bounded(stdin, format=source_format, path=path)
    else:
        try:
            metadata = os.stat(path)
            if metadata.st_size > MAX_SOURCE_BYTES:
                raise _too_large_error(source_format, path)
            with open(path, "rb", buffering=0) as stream:
                source = _read_bounded(stream, format=source_format, path=path)
        except _CliError:
            raise
        except OSError as error:
            raise _CliError(
                "GECLI_INPUT_READ",
                f"cannot read {path}: {error}",
            ) from None
    try:
        return parse_graph_source(source, format=source_format)
    except GraphSourceError as error:
        raise _source_error(error, path) from None


def _project_compilation(document: object) -> _ValidationResult:
    result: CompilationResult = try_compile_graph(cast(dict[str, object], document))
    graph = result.graph.spec if result.graph is not None else None

    return _ValidationResult(
        valid=result.valid,
        graph=graph,
        graph_name=graph.metadata.name if graph is not None else None,
        graph_hash=result.graph_hash,
        canonical_graph=result.canonical_graph,
        topological_layers=result.topological_layers,
        diagnostics=result.diagnostics,
    )


def _diagnostic_data(item: Diagnostic) -> dict[str, object]:
    result: dict[str, object] = {
        "code": item.code.value,
        "severity": "error",
        "message": item.message,
    }
    if item.path is not None:
        result["path"] = item.path
    if item.node_ids is not None:
        result["nodeIds"] = list(item.node_ids)
    elif item.node_id is not None:
        result["nodeIds"] = [item.node_id]
    if item.edge_id is not None:
        result["edgeId"] = item.edge_id
    if item.output_name is not None:
        result["outputName"] = item.output_name
    return result


def _diagnostic_codes(diagnostics: Sequence[Diagnostic]) -> list[str]:
    codes: list[str] = []
    seen: set[str] = set()
    for item in diagnostics:
        code = item.code.value
        if code not in seen:
            seen.add(code)
            codes.append(code)
    return codes


def _validation_data(file: str, result: _ValidationResult) -> dict[str, object]:
    return {
        "file": file,
        "valid": result.valid,
        "graphName": result.graph_name,
        "graphHash": result.graph_hash,
        "diagnosticCodes": _diagnostic_codes(result.diagnostics),
        "diagnostics": [_diagnostic_data(item) for item in result.diagnostics],
    }


def _compile_data(file: str, result: _ValidationResult) -> dict[str, object]:
    canonical_bytes = (
        len(result.canonical_graph.encode("utf-8"))
        if result.canonical_graph is not None
        else None
    )
    return {
        "file": file,
        "valid": result.valid,
        "graphName": result.graph_name,
        "graphHash": result.graph_hash,
        "canonicalGraph": result.canonical_graph,
        "canonicalBytes": canonical_bytes,
        "diagnosticCodes": _diagnostic_codes(result.diagnostics),
        "diagnostics": [_diagnostic_data(item) for item in result.diagnostics],
    }


def _plan_data(file: str, graph: GraphSpec, result: _ValidationResult) -> dict[str, object]:
    layers = result.topological_layers
    configured = graph.policies.max_concurrency if graph.policies is not None else None
    return {
        "file": file,
        "valid": True,
        "graphName": graph.metadata.name,
        "graphHash": result.graph_hash,
        "nodeCount": len(graph.nodes),
        "edgeCount": len(graph.edges),
        "layerCount": len(layers),
        "maxParallelWidth": max((len(layer) for layer in layers), default=0),
        "configuredMaxConcurrency": configured,
        "topologicalLayers": [list(layer) for layer in layers],
    }


def _escape_diagram_text(value: str, entity_prefix: Literal["#", "&#"]) -> str:
    result: list[str] = []
    for character in value:
        code_point = ord(character)
        safe = (
            0x30 <= code_point <= 0x39
            or 0x41 <= code_point <= 0x5A
            or 0x61 <= code_point <= 0x7A
            or character in {" ", ".", "_", "-"}
        )
        result.append(character if safe else f"{entity_prefix}{code_point};")
    return "".join(result)


def _outputs_by_node(graph: GraphSpec) -> dict[str, list[tuple[str, Endpoint]]]:
    result: dict[str, list[tuple[str, Endpoint]]] = {}
    for name, endpoint in graph.outputs.items():
        result.setdefault(endpoint.node, []).append((name, endpoint))
    return result


def _node_label(
    node_id: str,
    kind: str,
    entrypoint: bool,
    outputs: Sequence[tuple[str, Endpoint]],
    escape: Callable[[str], str],
) -> str:
    parts = [f"id={escape(node_id)}", f"kind={escape(kind)}"]
    if entrypoint:
        parts.append("entrypoint")
    if outputs:
        names = []
        for name, endpoint in outputs:
            names.append(
                escape(name)
                if endpoint.port is None
                else f"{escape(name)} at {escape(endpoint.port)}"
            )
        parts.append(f"outputs={', '.join(names)}")
    return "; ".join(parts)


def _edge_label(
    edge_id: str,
    from_port: str | None,
    to_port: str | None,
    mode: str | None,
    escape: Callable[[str], str],
) -> str:
    return "; ".join(
        (
            f"id={escape(edge_id)}",
            f"fromPort={'default' if from_port is None else escape(from_port)}",
            f"toPort={'default' if to_port is None else escape(to_port)}",
            f"mode={'default' if mode is None else escape(mode)}",
        )
    )


def _visualize_graph(graph: GraphSpec, format: VisualizationFormat) -> _VisualizationResult:
    aliases = {node.id: f"n{index}" for index, node in enumerate(graph.nodes)}
    entrypoints = set(graph.entrypoints)
    graph_outputs = _outputs_by_node(graph)
    prefix: Literal["#", "&#"] = "#" if format == "mermaid" else "&#"

    def escape(value: str) -> str:
        return _escape_diagram_text(value, prefix)

    if format == "mermaid":
        lines = ["flowchart TD"]
        for index, node in enumerate(graph.nodes):
            label = _node_label(
                node.id,
                node.kind,
                node.id in entrypoints,
                graph_outputs.get(node.id, ()),
                escape,
            )
            lines.append(f'  n{index}["{label}"]')
        for index, edge in enumerate(graph.edges):
            source = aliases.get(edge.source.node)
            target = aliases.get(edge.target.node)
            if source is None or target is None:
                raise ValueError("visualization requires a canonically compiled, valid Graph IR")
            label = _edge_label(
                edge.id,
                edge.source.port,
                edge.target.port,
                edge.mode,
                escape,
            )
            lines.append(f'  {source} e{index}@-->|"{label}"| {target}')
        content = "\n".join(lines) + "\n"
    else:
        lines = ["digraph GraphEngineering {", "  rankdir=TB;", "  node [shape=box];"]
        for index, node in enumerate(graph.nodes):
            label = _node_label(
                node.id,
                node.kind,
                node.id in entrypoints,
                graph_outputs.get(node.id, ()),
                escape,
            )
            lines.append(f'  n{index} [label="{label}"];')
        for index, edge in enumerate(graph.edges):
            source = aliases.get(edge.source.node)
            target = aliases.get(edge.target.node)
            if source is None or target is None:
                raise ValueError("visualization requires a canonically compiled, valid Graph IR")
            label = _edge_label(
                edge.id,
                edge.source.port,
                edge.target.port,
                edge.mode,
                escape,
            )
            lines.append(f'  {source} -> {target} [id="e{index}", label="{label}"];')
        lines.append("}")
        content = "\n".join(lines) + "\n"
    return _VisualizationResult(format, content, len(graph.nodes), len(graph.edges))


def _visualization_data(
    graph_hash: str,
    result: _VisualizationResult,
) -> dict[str, object]:
    return {
        "graphHash": graph_hash,
        "format": result.format,
        "content": result.content,
        "nodeCount": result.node_count,
        "edgeCount": result.edge_count,
    }


def _read_quickstart_resource() -> bytes:
    resource = importlib.resources.files("graph_engineering")
    for part in QUICKSTART_RESOURCE.split("/"):
        resource = resource.joinpath(part)
    return resource.read_bytes()


def _attempt(operation: Callable[[], str]) -> tuple[bool, str]:
    try:
        return True, operation()
    except Exception as error:
        message = " ".join(str(error).split()).strip() or "unknown error"
        return False, message


def _doctor_check(
    id: str,
    summary: str,
    attempt: tuple[bool, str],
) -> _DoctorCheck:
    ok, detail = attempt
    return _DoctorCheck(id, "pass" if ok else "fail", summary, detail)


def _run_doctor(probes: _DoctorProbes | None = None) -> _DoctorReport:
    effective = probes or _DoctorProbes()
    version = effective.python_version or (
        sys.version_info.major,
        sys.version_info.minor,
        sys.version_info.micro,
    )
    read_template = effective.read_template or _read_quickstart_resource
    distribution_version = effective.distribution_version or (
        lambda: importlib.metadata.version("graph-engineering")
    )

    def check_python() -> str:
        if version < (3, 11, 0):
            raise RuntimeError(
                f"Detected Python {version[0]}.{version[1]}.{version[2]}; "
                "version 3.11 or newer is required."
            )
        return f"Python {version[0]}.{version[1]}.{version[2]}"

    def check_distribution() -> str:
        installed = distribution_version()
        if not installed:
            raise RuntimeError("installed distribution has no version")
        return f"graph-engineering {installed}"

    def check_fixture() -> str:
        source = read_template()
        if len(source) > MAX_SOURCE_BYTES:
            raise RuntimeError("bundled fixture exceeds the source limit")
        document = parse_graph_source(source, format="json")
        result = _project_compilation(document)
        if not result.valid or result.graph_hash != QUICKSTART_HASH:
            raise RuntimeError("bundled fixture did not compile to its canonical hash")
        return f"Canonical fixture hash {QUICKSTART_HASH}."

    def check_compiler_api() -> str:
        module = effective.compiler_module
        if module is None:
            from . import compiler as module
        if not callable(getattr(module, "try_compile_graph", None)):
            raise RuntimeError("graph_engineering does not expose try_compile_graph")
        return "Python package exposes the canonical compiler."

    def check_source_api() -> str:
        module = effective.source_module
        if module is None:
            from . import source as module
        decoder: object = getattr(module, "parse_graph_source", None)
        if not callable(decoder):
            raise RuntimeError("graph_engineering does not expose parse_graph_source")
        return "Python package exposes strict JSON and safe-YAML decoding."

    checks = (
        _doctor_check("python.version", "Python 3.11 or newer", _attempt(check_python)),
        _doctor_check(
            "distribution.graph-engineering",
            "Installed Python distribution",
            _attempt(check_distribution),
        ),
        _doctor_check(
            "asset.quickstart-fixture",
            "Bundled quickstart conformance fixture",
            _attempt(check_fixture),
        ),
        _doctor_check(
            "api.compiler",
            "Canonical Python compiler API",
            _attempt(check_compiler_api),
        ),
        _doctor_check(
            "api.source",
            "Strict source decoder API",
            _attempt(check_source_api),
        ),
    )
    failed = {item.id for item in checks if item.status == "fail"}
    remediations: list[str] = []
    if "python.version" in failed:
        remediations.append("Install Python 3.11 or newer and rerun graph doctor.")
    if "distribution.graph-engineering" in failed:
        remediations.append("Reinstall the graph-engineering Python distribution.")
    if "asset.quickstart-fixture" in failed:
        remediations.append(
            "Reinstall graph-engineering so its bundled quickstart fixture is restored."
        )
    if {"api.compiler", "api.source"} & failed:
        remediations.append("Reinstall graph-engineering and its locked Python dependencies.")
    return _DoctorReport(
        healthy=all(item.status == "pass" for item in checks),
        checks=checks,
        remediations=tuple(remediations[:3]),
    )


def _doctor_data(report: _DoctorReport) -> dict[str, object]:
    return {
        "healthy": report.healthy,
        "checks": [item.to_dict() for item in report.checks],
        "remediations": list(report.remediations),
    }


def _same_identity(left: os.stat_result, right: os.stat_result) -> bool:
    return left.st_dev == right.st_dev and left.st_ino == right.st_ino


def _inspect_init_target(target: str) -> bool:
    try:
        before = os.lstat(target)
    except FileNotFoundError:
        parent = os.path.dirname(target)
        while True:
            try:
                state = os.stat(parent)
                if not os.path.isdir(parent):
                    raise _CliError(
                        "GECLI_INIT_PARENT_NOT_DIRECTORY",
                        f"cannot create {target}: parent path is not a directory",
                    )
                if state.st_ino >= 0:
                    return False
            except FileNotFoundError:
                next_parent = os.path.dirname(parent)
                if next_parent == parent:
                    raise _CliError(
                        "GECLI_INIT_TARGET_ACCESS",
                        f"cannot find a directory ancestor for {target}",
                    ) from None
                parent = next_parent
                continue
            except _CliError:
                raise
            except OSError as error:
                raise _CliError(
                    "GECLI_INIT_TARGET_ACCESS",
                    f"cannot inspect parent of {target}: {error}",
                ) from None
    except OSError as error:
        raise _CliError(
            "GECLI_INIT_TARGET_ACCESS",
            f"cannot inspect init target {target}: {error}",
        ) from None

    if os.path.islink(target):
        raise _CliError("GECLI_INIT_TARGET_SYMLINK", f"refusing symlink init target {target}")
    if not os.path.isdir(target):
        raise _CliError(
            "GECLI_INIT_TARGET_NOT_DIRECTORY",
            f"refusing existing non-directory init target {target}",
        )
    try:
        entries = os.listdir(target)
        after = os.lstat(target)
    except OSError as error:
        raise _CliError(
            "GECLI_INIT_TARGET_ACCESS",
            f"cannot inspect init target {target}: {error}",
        ) from None
    if os.path.islink(target) or not os.path.isdir(target) or not _same_identity(before, after):
        raise _CliError(
            "GECLI_INIT_TARGET_CHANGED",
            f"init target changed while it was being inspected: {target}",
        )
    if entries:
        raise _CliError(
            "GECLI_INIT_TARGET_NOT_EMPTY",
            f"refusing non-empty init target {target}",
        )
    return True


def _cleanup_directories(created: Sequence[_OwnedDirectory]) -> None:
    for owned in reversed(created):
        try:
            current = os.lstat(owned.path)
            if (
                os.path.islink(owned.path)
                or not os.path.isdir(owned.path)
                or current.st_dev != owned.device
                or current.st_ino != owned.inode
            ):
                continue
            os.rmdir(owned.path)
        except OSError:
            pass


def _create_target_directories(target: str) -> list[_OwnedDirectory]:
    missing: list[str] = []
    candidate = target
    while True:
        try:
            state = os.stat(candidate)
            if not os.path.isdir(candidate):
                raise _CliError(
                    "GECLI_INIT_PARENT_NOT_DIRECTORY",
                    f"cannot create {target}: parent path is not a directory",
                )
            if state.st_ino >= 0:
                break
        except FileNotFoundError:
            missing.insert(0, candidate)
            parent = os.path.dirname(candidate)
            if parent == candidate:
                raise _CliError(
                    "GECLI_INIT_CREATE_DIRECTORY",
                    f"cannot find a directory ancestor for {target}",
                ) from None
            candidate = parent
        except _CliError:
            raise
        except OSError as error:
            raise _CliError(
                "GECLI_INIT_CREATE_DIRECTORY",
                f"cannot inspect directory path {candidate}: {error}",
            ) from None

    created: list[_OwnedDirectory] = []
    for path in missing:
        try:
            os.mkdir(path, mode=0o755)
            identity = os.lstat(path)
            if os.path.islink(path) or not os.path.isdir(path):
                raise _CliError(
                    "GECLI_INIT_TARGET_CHANGED",
                    f"created directory changed before it could be verified: {path}",
                )
            created.append(_OwnedDirectory(path, identity.st_dev, identity.st_ino))
        except FileExistsError:
            if not os.path.islink(path) and os.path.isdir(path):
                continue
            _cleanup_directories(created)
            raise _CliError(
                "GECLI_INIT_CREATE_DIRECTORY",
                f"cannot exclusively create directory {path}",
            ) from None
        except _CliError:
            _cleanup_directories(created)
            raise
        except OSError as error:
            _cleanup_directories(created)
            raise _CliError(
                "GECLI_INIT_CREATE_DIRECTORY",
                f"cannot exclusively create directory {path}: {error}",
            ) from None
    return created


def _require_empty_stable_directory(target: str) -> os.stat_result:
    try:
        before = os.lstat(target)
        entries = os.listdir(target)
        after = os.lstat(target)
    except OSError as error:
        raise _CliError(
            "GECLI_INIT_TARGET_CHANGED",
            f"init target disappeared or became unreadable before creation: {target}: {error}",
        ) from None
    if os.path.islink(target):
        raise _CliError("GECLI_INIT_TARGET_SYMLINK", f"refusing symlink init target {target}")
    if not os.path.isdir(target):
        raise _CliError(
            "GECLI_INIT_TARGET_NOT_DIRECTORY",
            f"refusing existing non-directory init target {target}",
        )
    if not _same_identity(before, after):
        raise _CliError(
            "GECLI_INIT_TARGET_CHANGED",
            f"init target changed before file creation: {target}",
        )
    if entries:
        raise _CliError(
            "GECLI_INIT_TARGET_NOT_EMPTY",
            f"refusing non-empty init target {target}",
        )
    return after


def _load_init_template() -> tuple[bytes, str]:
    source = _read_quickstart_resource()
    if len(source) > MAX_SOURCE_BYTES:
        raise RuntimeError("bundled init template exceeds the source limit")
    document = parse_graph_source(source, format="json")
    result = _project_compilation(document)
    if not result.valid or result.graph_hash != QUICKSTART_HASH:
        codes = ", ".join(_diagnostic_codes(result.diagnostics)) or "unknown"
        raise RuntimeError(f"bundled init template violates the Graph IR contract: {codes}")
    return source, result.graph_hash


def _create_graph_file(
    target: str,
    template: bytes,
    directory_identity: os.stat_result,
    created_directories: Sequence[_OwnedDirectory],
) -> None:
    output_path = os.path.join(target, "graph.json")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0)
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        descriptor = os.open(output_path, flags, 0o644)
    except OSError as error:
        _cleanup_directories(created_directories)
        code = (
            "GECLI_INIT_EXCLUSIVE_CREATE"
            if error.errno in {errno.EEXIST, errno.ELOOP}
            else "GECLI_INIT_CREATE_FILE"
        )
        message = (
            f"refusing to overwrite an existing init file at {output_path}"
            if code == "GECLI_INIT_EXCLUSIVE_CREATE"
            else f"cannot exclusively create {output_path}: {error}"
        )
        raise _CliError(code, message) from None

    file_identity: os.stat_result | None = None
    try:
        file_identity = os.fstat(descriptor)
        with os.fdopen(descriptor, "wb", closefd=True) as stream:
            descriptor = -1
            stream.write(template)
            stream.flush()
            os.fsync(stream.fileno())
        before = os.lstat(target)
        entries = os.listdir(target)
        after = os.lstat(target)
        current_file = os.lstat(output_path)
        stable_directory = (
            not os.path.islink(target)
            and os.path.isdir(target)
            and _same_identity(before, directory_identity)
            and _same_identity(after, directory_identity)
        )
        stable_file = (
            not os.path.islink(output_path)
            and os.path.isfile(output_path)
            and _same_identity(current_file, file_identity)
        )
        if not stable_directory or not stable_file or entries != ["graph.json"]:
            raise _CliError(
                "GECLI_INIT_TARGET_CHANGED",
                f"init target changed while graph.json was being created: {target}",
            )
    except Exception as error:
        if descriptor >= 0:
            with suppress(OSError):
                os.close(descriptor)
        if file_identity is not None:
            try:
                current_directory = os.lstat(target)
                current_file = os.lstat(output_path)
                if (
                    not os.path.islink(target)
                    and os.path.isdir(target)
                    and _same_identity(current_directory, directory_identity)
                    and not os.path.islink(output_path)
                    and os.path.isfile(output_path)
                    and _same_identity(current_file, file_identity)
                ):
                    os.unlink(output_path)
            except OSError:
                pass
        _cleanup_directories(created_directories)
        if isinstance(error, _CliError):
            raise
        raise _CliError(
            "GECLI_INIT_WRITE_FILE",
            f"failed while writing {output_path}: {error}",
        ) from None


def _initialize_graph_project(directory: str, *, dry_run: bool) -> _InitReport:
    target = os.path.abspath(directory)
    template, graph_hash = _load_init_template()
    target_exists = _inspect_init_target(target)
    would_create_directory = not target_exists
    if dry_run:
        return _InitReport(
            target,
            True,
            False,
            False,
            would_create_directory,
            ("graph.json",),
            QUICKSTART_TEMPLATE,
            graph_hash,
        )

    created = [] if target_exists else _create_target_directories(target)
    try:
        directory_identity = _require_empty_stable_directory(target)
    except Exception:
        _cleanup_directories(created)
        raise
    _create_graph_file(target, template, directory_identity, created)
    return _InitReport(
        target,
        False,
        True,
        any(item.path == target for item in created),
        would_create_directory,
        ("graph.json",),
        QUICKSTART_TEMPLATE,
        graph_hash,
    )


def _init_data(report: _InitReport) -> dict[str, object]:
    return {
        "targetDirectory": report.target_directory,
        "dryRun": report.dry_run,
        "created": report.created,
        "directoryCreated": report.directory_created,
        "wouldCreateDirectory": report.would_create_directory,
        "files": list(report.files),
        "template": report.template,
        "graphHash": report.graph_hash,
    }


def _is_terminal_control(code_point: int) -> bool:
    return (
        code_point <= 0x1F
        or 0x7F <= code_point <= 0x9F
        or code_point in {0x061C, 0x200E, 0x200F, 0x2028, 0x2029}
        or 0x202A <= code_point <= 0x202E
        or 0x2066 <= code_point <= 0x2069
        or 0xD800 <= code_point <= 0xDFFF
    )


def _terminal_safe_text(value: str) -> str:
    return "".join(
        f"\\u{{{ord(character):04X}}}" if _is_terminal_control(ord(character)) else character
        for character in value
    )


def _write(stream: TextIO, message: str) -> None:
    stream.write(message if message.endswith("\n") else f"{message}\n")
    stream.flush()


def _write_envelope(
    io: _CliIo,
    command: CommandName | None,
    exit_code: int,
    data: Mapping[str, object] | None,
    error: Mapping[str, object] | None = None,
) -> None:
    envelope: dict[str, object] = {
        "schemaVersion": MACHINE_SCHEMA_VERSION,
        "command": command,
        "ok": exit_code == ExitCode.SUCCESS,
        "exitCode": exit_code,
        "data": dict(data) if data is not None else None,
        "error": dict(error) if error is not None else None,
    }
    _write(io.stdout, compact_json(envelope))


def _print_validation_human(io: _CliIo, file: str, result: _ValidationResult) -> None:
    name = _terminal_safe_text(os.path.basename(file))
    if result.valid:
        _write(
            io.stdout,
            f"✓ {name} is a valid Graph Engineering graph\n"
            f"  sha256 {result.graph_hash or 'unavailable'}",
        )
        return
    lines = [f"✗ {name} is invalid ({len(result.diagnostics)} diagnostic(s))"]
    for item in result.diagnostics:
        location = item.path
        if location is None and item.node_ids is not None:
            location = ",".join(item.node_ids)
        if location is None:
            location = item.node_id or item.edge_id
        suffix = f" [{_terminal_safe_text(location)}]" if location else ""
        lines.append(
            f"  {item.code.value}{suffix}: {_terminal_safe_text(item.message)}"
        )
    _write(io.stderr, "\n".join(lines))


def _print_plan_human(io: _CliIo, file: str, graph: GraphSpec, result: _ValidationResult) -> None:
    layers = result.topological_layers
    configured = graph.policies.max_concurrency if graph.policies is not None else None
    lines = [
        f"Graph plan: {_terminal_safe_text(graph.metadata.name or os.path.basename(file))}",
        f"  {len(graph.nodes)} nodes · {len(graph.edges)} edges · {len(layers)} layers",
        "  max parallel width "
        f"{max((len(layer) for layer in layers), default=0)} · concurrency "
        f"{configured if configured is not None else 'unbounded by graph policy'}",
    ]
    lines.extend(
        f"  {index}. {' | '.join(_terminal_safe_text(item) for item in layer)}"
        for index, layer in enumerate(layers, start=1)
    )
    _write(io.stdout, "\n".join(lines))


def _print_compile_human(io: _CliIo, file: str, result: _ValidationResult) -> None:
    if not result.valid:
        _print_validation_human(io, file, result)
        return
    canonical_bytes = (
        str(len(result.canonical_graph.encode("utf-8")))
        if result.canonical_graph is not None
        else "unavailable"
    )
    _write(
        io.stdout,
        f"✓ Compiled {_terminal_safe_text(os.path.basename(file))}\n"
        f"  sha256 {result.graph_hash or 'unavailable'}\n"
        f"  canonical bytes {canonical_bytes}",
    )


def _print_doctor_human(io: _CliIo, report: _DoctorReport) -> None:
    lines = [f"Graph Engineering doctor: {'healthy' if report.healthy else 'unhealthy'}"]
    lines.extend(
        f"  {'✓' if item.status == 'pass' else '✗'} "
        f"{_terminal_safe_text(item.summary)}: {_terminal_safe_text(item.detail)}"
        for item in report.checks
    )
    if report.remediations:
        lines.append("Remediation:")
        lines.extend(
            f"  {index}. {_terminal_safe_text(item)}"
            for index, item in enumerate(report.remediations, start=1)
        )
    _write(io.stdout, "\n".join(lines))


def _print_init_human(io: _CliIo, report: _InitReport) -> None:
    if report.dry_run:
        lines = [f"Dry run: {_terminal_safe_text(report.target_directory)}"]
        if report.would_create_directory:
            lines.append("  create target directory")
        lines.extend(
            (
                f"  create {', '.join(_terminal_safe_text(item) for item in report.files)}",
                f"  template {_terminal_safe_text(report.template)}",
            )
        )
        _write(io.stdout, "\n".join(lines))
        return
    _write(
        io.stdout,
        "✓ Initialized Graph Engineering project in "
        f"{_terminal_safe_text(report.target_directory)}\n"
        f"  created {', '.join(_terminal_safe_text(item) for item in report.files)}\n"
        f"  sha256 {report.graph_hash}",
    )


def _emit_cli_error(
    io: _CliIo,
    error: _CliError,
    command: CommandName | None,
    json_mode: bool,
) -> int:
    if json_mode:
        _write_envelope(io, command, error.exit_code, None, error.machine_error())
    else:
        suffix = "\nRun graph --help for usage." if error.code == "GECLI_USAGE" else ""
        _write(io.stderr, f"graph: {_terminal_safe_text(error.human_message)}{suffix}")
    return error.exit_code


def _emit_internal_error(
    io: _CliIo,
    error: Exception,
    command: CommandName | None,
    json_mode: bool,
) -> int:
    message = f"unexpected internal error: {error}"
    if json_mode:
        _write_envelope(
            io,
            command,
            ExitCode.INTERNAL,
            None,
            {"code": "GECLI_INTERNAL", "message": message},
        )
    else:
        _write(io.stderr, f"graph: {_terminal_safe_text(message)}")
    return ExitCode.INTERNAL


def run(argv: Sequence[str], *, io: _CliIo | None = None) -> int:
    """Run one CLI invocation and return its stable process exit code."""

    streams = io or _CliIo(sys.stdin.buffer, sys.stdout, sys.stderr)
    json_mode = _requested_json(argv)
    inferred_command = _infer_command(argv)
    try:
        parsed = _parse_arguments(argv)
    except _CliError as error:
        return _emit_cli_error(streams, error, inferred_command, json_mode)
    except Exception as error:
        return _emit_internal_error(streams, error, inferred_command, json_mode)

    if parsed == "help":
        _write(streams.stdout, _usage())
        return ExitCode.SUCCESS
    if parsed == "version":
        _write(streams.stdout, CLI_VERSION)
        return ExitCode.SUCCESS

    try:
        if parsed.command == "init":
            if parsed.file is None:
                raise RuntimeError("init unexpectedly has no target directory")
            init_report = _initialize_graph_project(parsed.file, dry_run=parsed.dry_run)
            if parsed.json:
                _write_envelope(
                    streams,
                    parsed.command,
                    ExitCode.SUCCESS,
                    _init_data(init_report),
                )
            else:
                _print_init_human(streams, init_report)
            return ExitCode.SUCCESS

        if parsed.command == "doctor":
            doctor_report = _run_doctor()
            exit_code = (
                ExitCode.SUCCESS if doctor_report.healthy else ExitCode.UNHEALTHY
            )
            if parsed.json:
                _write_envelope(
                    streams,
                    parsed.command,
                    exit_code,
                    _doctor_data(doctor_report),
                )
            else:
                _print_doctor_human(streams, doctor_report)
            return exit_code

        if parsed.file is None or parsed.input_format is None:
            raise RuntimeError(f"{parsed.command} unexpectedly has no graph source")
        document = _read_graph(parsed.file, parsed.input_format, streams.stdin)
        validation = _project_compilation(document)
        exit_code = ExitCode.SUCCESS if validation.valid else ExitCode.INVALID_GRAPH

        if parsed.command == "validate":
            if parsed.json:
                _write_envelope(
                    streams,
                    parsed.command,
                    exit_code,
                    _validation_data(parsed.file, validation),
                )
            else:
                _print_validation_human(streams, parsed.file, validation)
            return exit_code

        if parsed.command == "compile":
            if parsed.json:
                _write_envelope(
                    streams,
                    parsed.command,
                    exit_code,
                    _compile_data(parsed.file, validation),
                )
            else:
                _print_compile_human(streams, parsed.file, validation)
            return exit_code

        if parsed.command == "visualize":
            if not validation.valid or validation.graph is None:
                if parsed.json:
                    _write_envelope(
                        streams,
                        parsed.command,
                        exit_code,
                        _validation_data(parsed.file, validation),
                    )
                else:
                    _print_validation_human(streams, parsed.file, validation)
                return exit_code
            if validation.graph_hash is None or parsed.format is None:
                raise RuntimeError("valid visualization lacks a graph hash or format")
            visualization = _visualize_graph(validation.graph, parsed.format)
            if parsed.json:
                _write_envelope(
                    streams,
                    parsed.command,
                    ExitCode.SUCCESS,
                    _visualization_data(validation.graph_hash, visualization),
                )
            else:
                _write(streams.stdout, visualization.content)
            return ExitCode.SUCCESS

        if not validation.valid or validation.graph is None:
            if parsed.json:
                _write_envelope(
                    streams,
                    parsed.command,
                    exit_code,
                    _validation_data(parsed.file, validation),
                )
            else:
                _print_validation_human(streams, parsed.file, validation)
            return exit_code
        if parsed.json:
            _write_envelope(
                streams,
                parsed.command,
                ExitCode.SUCCESS,
                _plan_data(parsed.file, validation.graph, validation),
            )
        else:
            _print_plan_human(streams, parsed.file, validation.graph, validation)
        return ExitCode.SUCCESS
    except _CliError as error:
        return _emit_cli_error(streams, error, parsed.command, parsed.json)
    except Exception as error:
        return _emit_internal_error(streams, error, parsed.command, parsed.json)


def main(argv: Sequence[str] | None = None) -> int:
    """Installed ``graph`` and ``grapheng`` console-script entry point."""

    # Make machine output byte-stable on Windows and in non-UTF-8 locales.
    # Injected streams passed directly to ``run`` retain caller ownership.
    for stream in (sys.stdout, sys.stderr):
        if isinstance(stream, io_module.TextIOWrapper):
            stream.reconfigure(encoding="utf-8", errors="strict", newline="\n")
    return run(sys.argv[1:] if argv is None else argv)


if __name__ == "__main__":
    raise SystemExit(main())


__all__ = [
    "CLI_VERSION",
    "MACHINE_SCHEMA_VERSION",
    "ExitCode",
    "main",
    "run",
]
