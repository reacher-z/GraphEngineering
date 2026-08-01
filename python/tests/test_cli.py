from __future__ import annotations

import io
import json
import subprocess
import sys
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

from graph_engineering import CompilationResult, GraphSpec, canonical_json, compile_graph
from graph_engineering import cli as cli_module
from graph_engineering.source import MAX_SOURCE_BYTES

ROOT = Path(__file__).resolve().parents[2]
PYTHON_ROOT = ROOT / "python"
FIXTURES = ROOT / "spec/conformance"
DIAMOND = FIXTURES / "diamond.graph.json"
INVALID_CYCLE = FIXTURES / "invalid-cycle.graph.json"
QUICKSTART = ROOT / "examples/quickstart/research-diamond.graph.json"

DIAMOND_HASH = "24819fe69f3b9449c79bcdd85b2049000c7cc8f313aab5957657a6078a80d288"
INVALID_CYCLE_HASH = "85a9fbadd0e5c72088699d76d3748d4627fea40573d21ddb0e009f61a12f5406"

EXPECTED_MERMAID = """flowchart TD
  n0["id=split; kind=transform; entrypoint"]
  n1["id=left; kind=transform"]
  n2["id=right; kind=transform"]
  n3["id=merge; kind=barrier; outputs=result"]
  n0 e0@-->|"id=split-left; fromPort=default; toPort=default; mode=value"| n1
  n0 e1@-->|"id=split-right; fromPort=default; toPort=default; mode=value"| n2
  n1 e2@-->|"id=left-merge; fromPort=default; toPort=left; mode=value"| n3
  n2 e3@-->|"id=right-merge; fromPort=default; toPort=right; mode=value"| n3
"""

EXPECTED_DOT = """digraph GraphEngineering {
  rankdir=TB;
  node [shape=box];
  n0 [label="id=split; kind=transform; entrypoint"];
  n1 [label="id=left; kind=transform"];
  n2 [label="id=right; kind=transform"];
  n3 [label="id=merge; kind=barrier; outputs=result"];
  n0 -> n1 [id="e0", label="id=split-left; fromPort=default; toPort=default; mode=value"];
  n0 -> n2 [id="e1", label="id=split-right; fromPort=default; toPort=default; mode=value"];
  n1 -> n3 [id="e2", label="id=left-merge; fromPort=default; toPort=left; mode=value"];
  n2 -> n3 [id="e3", label="id=right-merge; fromPort=default; toPort=right; mode=value"];
}
"""


@dataclass(frozen=True, slots=True)
class Invocation:
    status: int
    stdout: bytes
    stderr: bytes


def invoke(
    args: list[str],
    *,
    input_bytes: bytes | None = None,
    cwd: Path = ROOT,
) -> Invocation:
    result = subprocess.run(
        [sys.executable, "-m", "graph_engineering.cli", *args],
        cwd=cwd,
        input=input_bytes,
        capture_output=True,
        check=False,
    )
    return Invocation(result.returncode, result.stdout, result.stderr)


def machine(result: Invocation) -> dict[str, object]:
    assert result.stderr == b""
    assert result.stdout.endswith(b"\n")
    assert len(result.stdout.rstrip(b"\n").splitlines()) == 1
    envelope = json.loads(result.stdout)
    assert isinstance(envelope, dict)
    assert envelope["schemaVersion"] == "graph-engineering.cli/v1alpha1"
    assert envelope["exitCode"] == result.status
    assert list(envelope) == [
        "schemaVersion",
        "command",
        "ok",
        "exitCode",
        "data",
        "error",
    ]
    return envelope


def test_validate_emits_the_stable_machine_envelope() -> None:
    result = invoke(["--json", "validate", str(DIAMOND)])

    assert result.status == 0
    envelope = machine(result)
    assert envelope["command"] == "validate"
    assert envelope["ok"] is True
    assert envelope["error"] is None
    data = envelope["data"]
    assert isinstance(data, dict)
    assert list(data) == [
        "file",
        "valid",
        "graphName",
        "graphHash",
        "diagnosticCodes",
        "diagnostics",
    ]
    assert data["valid"] is True
    assert data["graphName"] == "diamond"
    assert data["graphHash"] == DIAMOND_HASH
    assert data["diagnosticCodes"] == []


def test_plan_reports_the_deterministic_parallel_layer() -> None:
    envelope = machine(invoke(["plan", str(DIAMOND), "--json"]))

    assert envelope["command"] == "plan"
    data = envelope["data"]
    assert isinstance(data, dict)
    assert data["topologicalLayers"] == [["split"], ["left", "right"], ["merge"]]
    assert data["nodeCount"] == 4
    assert data["edgeCount"] == 4
    assert data["layerCount"] == 3
    assert data["maxParallelWidth"] == 2
    assert data["configuredMaxConcurrency"] == 2


def test_compile_returns_python_core_canonical_text_and_hash() -> None:
    document = json.loads(DIAMOND.read_text())
    compiled = compile_graph(document)
    envelope = machine(invoke(["compile", str(DIAMOND), "--json"]))

    data = envelope["data"]
    assert isinstance(data, dict)
    assert data["canonicalGraph"] == canonical_json(compiled.spec)
    assert data["graphHash"] == compiled.graph_hash == DIAMOND_HASH
    assert data["canonicalBytes"] == len(canonical_json(compiled.spec).encode())


def test_cli_projection_invokes_the_canonical_compiler_exactly_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    document = json.loads(DIAMOND.read_text())
    calls = 0
    canonical_compiler = cli_module.try_compile_graph

    def counted(value: GraphSpec | Mapping[str, Any]) -> CompilationResult:
        nonlocal calls
        calls += 1
        return canonical_compiler(value)

    monkeypatch.setattr(cli_module, "try_compile_graph", counted)

    result = cli_module._project_compilation(document)

    assert result.valid
    assert result.graph_hash == DIAMOND_HASH
    assert calls == 1


def test_compile_human_output_is_a_concise_summary() -> None:
    result = invoke(["compile", str(DIAMOND)])

    assert result.status == 0
    assert result.stderr == b""
    text = result.stdout.decode()
    assert text.startswith("✓ Compiled diamond.graph.json\n")
    assert DIAMOND_HASH in text
    assert "canonical bytes" in text
    assert '"apiVersion"' not in text


@pytest.mark.parametrize("command", ["validate", "plan", "compile", "visualize"])
def test_invalid_graph_uses_exit_one_and_structured_diagnostics(command: str) -> None:
    envelope = machine(invoke([command, str(INVALID_CYCLE), "--json"]))

    assert envelope["exitCode"] == 1
    assert envelope["ok"] is False
    assert envelope["error"] is None
    data = envelope["data"]
    assert isinstance(data, dict)
    assert data["valid"] is False
    assert data["graphHash"] == INVALID_CYCLE_HASH
    assert data["diagnosticCodes"] == ["GE1005_CYCLE"]
    diagnostics = data["diagnostics"]
    assert isinstance(diagnostics, list)
    assert diagnostics[0]["code"] == "GE1005_CYCLE"
    assert diagnostics[0]["severity"] == "error"


def test_invalid_semantic_compile_retains_compiler_canonical_bytes() -> None:
    envelope = machine(invoke(["compile", str(INVALID_CYCLE), "--json"]))

    data = envelope["data"]
    assert isinstance(data, dict)
    canonical_graph = data["canonicalGraph"]
    assert isinstance(canonical_graph, str)
    assert data["graphHash"] == INVALID_CYCLE_HASH
    assert data["canonicalBytes"] == len(canonical_graph.encode()) == 550
    assert json.loads(canonical_graph) == json.loads(INVALID_CYCLE.read_text())


def test_invalid_graph_human_diagnostics_use_only_stderr() -> None:
    result = invoke(["validate", str(INVALID_CYCLE)])

    assert result.status == 1
    assert result.stdout == b""
    assert b"GE1005_CYCLE" in result.stderr


def test_missing_file_uses_exit_two_and_one_error_envelope() -> None:
    path = FIXTURES / "does-not-exist.json"
    envelope = machine(invoke(["validate", str(path), "--json"]))

    assert envelope["exitCode"] == 2
    assert envelope["data"] is None
    error = envelope["error"]
    assert isinstance(error, dict)
    assert error["code"] == "GECLI_INPUT_READ"


def test_unknown_extension_fails_before_touching_the_path(tmp_path: Path) -> None:
    missing = tmp_path / "does-not-exist.source"
    envelope = machine(invoke(["validate", str(missing), "--json"]))

    error = envelope["error"]
    assert isinstance(error, dict)
    assert envelope["exitCode"] == 2
    assert error["code"] == "GECLI_INPUT_FORMAT"
    assert "cannot infer" in str(error["message"])


def test_explicit_format_overrides_an_unknown_extension(tmp_path: Path) -> None:
    source = tmp_path / "graph.source"
    source.write_bytes(DIAMOND.read_bytes())

    envelope = machine(
        invoke(["validate", str(source), "--input-format", "json", "--json"])
    )
    assert envelope["exitCode"] == 0


def test_yaml_auto_and_explicit_yaml_stdin_match_json_identity(tmp_path: Path) -> None:
    yaml_source = (FIXTURES / "authoring/equivalent.graph.yaml").read_bytes()
    yaml_path = tmp_path / "equivalent.YAML"
    yaml_path.write_bytes(yaml_source)

    automatic = machine(invoke(["compile", str(yaml_path), "--json"]))
    explicit = machine(
        invoke(
            ["compile", "-", "--input-format", "yaml", "--json"],
            input_bytes=yaml_source,
        )
    )
    auto_data = automatic["data"]
    explicit_data = explicit["data"]
    assert isinstance(auto_data, dict)
    assert isinstance(explicit_data, dict)
    assert auto_data["graphHash"] == explicit_data["graphHash"]
    assert auto_data["canonicalGraph"] == explicit_data["canonicalGraph"]


def test_stdin_auto_is_json_and_never_sniffs_yaml() -> None:
    yaml_source = (FIXTURES / "authoring/equivalent.graph.yaml").read_bytes()
    envelope = machine(invoke(["validate", "-", "--json"], input_bytes=yaml_source))

    assert envelope["exitCode"] == 2
    error = envelope["error"]
    assert isinstance(error, dict)
    assert error["code"] == "GE_SOURCE_SYNTAX"
    assert error["format"] == "json"


def test_source_failures_include_the_stable_redacted_projection() -> None:
    envelope = machine(
        invoke(
            ["validate", "-", "--input-format", "yaml", "--json"],
            input_bytes=b"kind: Graph\nkind: Other\n",
        )
    )

    assert envelope["exitCode"] == 2
    assert envelope["data"] is None
    error = envelope["error"]
    assert isinstance(error, dict)
    assert list(error) == ["code", "message", "format", "path", "line", "column"]
    assert error["code"] == "GE_SOURCE_DUPLICATE_KEY"
    assert error["format"] == "yaml"
    assert isinstance(error["path"], str)
    assert isinstance(error["line"], int)
    assert isinstance(error["column"], int)
    assert "kind: Graph" not in str(error["message"])


def test_yaml_multiline_mapping_continuation_fails_closed() -> None:
    envelope = machine(
        invoke(
            ["validate", "-", "--input-format", "yaml", "--json"],
            input_bytes=b'a: "x\ny"\n',
        )
    )

    error = envelope["error"]
    assert isinstance(error, dict)
    assert envelope["exitCode"] == 2
    assert error["code"] == "GE_SOURCE_SYNTAX"
    assert error["format"] == "yaml"


def test_invalid_utf8_is_rejected_before_parsing() -> None:
    envelope = machine(
        invoke(
            ["validate", "-", "--input-format", "json", "--json"],
            input_bytes=b"\xc3(",
        )
    )

    error = envelope["error"]
    assert isinstance(error, dict)
    assert envelope["exitCode"] == 2
    assert error == {
        "code": "GE_SOURCE_INVALID_UTF8",
        "message": "source is not valid UTF-8",
        "format": "json",
        "path": None,
        "line": None,
        "column": None,
    }


def test_file_size_is_rejected_before_unbounded_read(tmp_path: Path) -> None:
    oversized = tmp_path / "oversized.json"
    oversized.write_bytes(b" " * (MAX_SOURCE_BYTES + 1))

    envelope = machine(invoke(["validate", str(oversized), "--json"]))
    error = envelope["error"]
    assert isinstance(error, dict)
    assert envelope["exitCode"] == 2
    assert error["code"] == "GE_SOURCE_TOO_LARGE"
    assert error["format"] == "json"


def test_stdin_stops_at_the_one_byte_size_sentinel() -> None:
    envelope = machine(
        invoke(
            ["validate", "-", "--json"],
            input_bytes=b" " * (MAX_SOURCE_BYTES + 1),
        )
    )
    error = envelope["error"]
    assert isinstance(error, dict)
    assert envelope["exitCode"] == 2
    assert error["code"] == "GE_SOURCE_TOO_LARGE"


def test_empty_yaml_reaches_the_compiler_as_implicit_null() -> None:
    envelope = machine(
        invoke(
            ["compile", "-", "--input-format", "yaml", "--json"],
            input_bytes=b"# only a comment\n",
        )
    )

    assert envelope["exitCode"] == 1
    assert envelope["error"] is None
    data = envelope["data"]
    assert isinstance(data, dict)
    assert data["diagnosticCodes"] == ["GE1007_INVALID_GRAPH"]


def test_visualize_is_byte_deterministic_in_both_formats() -> None:
    mermaid = invoke(["visualize", str(DIAMOND)])
    dot = invoke(["visualize", str(DIAMOND), "--format", "dot"])

    assert mermaid.status == dot.status == 0
    assert mermaid.stderr == dot.stderr == b""
    assert mermaid.stdout.decode() == EXPECTED_MERMAID
    assert dot.stdout.decode() == EXPECTED_DOT
    assert invoke(["visualize", str(DIAMOND)]).stdout == mermaid.stdout


def test_visualize_machine_data_has_only_the_documented_fields() -> None:
    envelope = machine(invoke(["visualize", str(DIAMOND), "--json"]))
    data = envelope["data"]
    assert isinstance(data, dict)
    assert list(data) == ["graphHash", "format", "content", "nodeCount", "edgeCount"]
    assert data == {
        "graphHash": DIAMOND_HASH,
        "format": "mermaid",
        "content": EXPECTED_MERMAID,
        "nodeCount": 4,
        "edgeCount": 4,
    }


@pytest.mark.parametrize("command", ["validate", "plan", "compile", "visualize"])
def test_read_only_commands_never_execute_a_tool_node(
    command: str,
    tmp_path: Path,
) -> None:
    sentinel = tmp_path / f"must-not-exist-{command}"
    document = json.loads(DIAMOND.read_text())
    document["nodes"][0]["kind"] = "tool"
    document["nodes"][0]["config"] = {
        "command": sys.executable,
        "args": ["-c", f"from pathlib import Path; Path({str(sentinel)!r}).touch()"],
    }

    result = invoke([command, "-", "--json"], input_bytes=json.dumps(document).encode())

    assert result.status == 0
    assert not sentinel.exists()


def test_visualize_rejects_format_injection_before_reading() -> None:
    envelope = machine(
        invoke(["visualize", "/not/read.json", "--format", "svg", "--json"])
    )
    error = envelope["error"]
    assert isinstance(error, dict)
    assert envelope["exitCode"] == 2
    assert error["code"] == "GECLI_USAGE"


def test_human_output_neutralizes_terminal_controls_in_paths(tmp_path: Path) -> None:
    hostile = "missing-ESC\x1b-LF\n-RLO\u202e.json"
    result = invoke(["validate", str(tmp_path / hostile)])

    assert result.status == 2
    assert result.stdout == b""
    text = result.stderr.decode()
    assert "\\u{001B}" in text
    assert "\\u{000A}" in text
    assert "\\u{202E}" in text
    assert "\x1b" not in text
    assert "\u202e" not in text
    assert len(text.rstrip("\n").splitlines()) == 1


def test_machine_output_retains_one_valid_json_document_for_hostile_path(
    tmp_path: Path,
) -> None:
    hostile = "missing-ESC\x1b-LF\n-RLO\u202e.json"
    result = invoke(["validate", str(tmp_path / hostile), "--json"])

    envelope = machine(result)
    error = envelope["error"]
    assert isinstance(error, dict)
    assert "\x1b" in str(error["message"])
    assert "\n" in str(error["message"])
    assert "\u202e" in str(error["message"])


def test_doctor_reports_a_bounded_healthy_python_installation() -> None:
    envelope = machine(invoke(["doctor", "--json"], cwd=PYTHON_ROOT))

    assert envelope["exitCode"] == 0
    data = envelope["data"]
    assert isinstance(data, dict)
    assert data["healthy"] is True
    checks = data["checks"]
    assert isinstance(checks, list)
    assert [item["id"] for item in checks] == [
        "python.version",
        "distribution.graph-engineering",
        "asset.quickstart-fixture",
        "api.compiler",
        "api.source",
    ]
    assert all(item["status"] == "pass" for item in checks)
    assert data["remediations"] == []


def test_unhealthy_doctor_uses_exit_three_and_at_most_three_remediations(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    report = cli_module._run_doctor(
        cli_module._DoctorProbes(
            python_version=(3, 10, 9),
            read_template=lambda: b"not-json",
            distribution_version=lambda: "",
            compiler_module=ModuleType("broken_compiler"),
            source_module=ModuleType("broken_source"),
        )
    )
    monkeypatch.setattr(cli_module, "_run_doctor", lambda: report)
    stdout = io.StringIO()
    stderr = io.StringIO()
    streams = cli_module._CliIo(io.BytesIO(), stdout, stderr)

    exit_code = cli_module.run(["doctor", "--json"], io=streams)

    assert exit_code == 3
    assert stderr.getvalue() == ""
    envelope = json.loads(stdout.getvalue())
    assert envelope["ok"] is False
    assert envelope["data"]["healthy"] is False
    assert len(envelope["data"]["remediations"]) <= 3


def test_init_creates_the_exact_bundled_quickstart(tmp_path: Path) -> None:
    target = tmp_path / "nested/project"
    envelope = machine(invoke(["init", str(target), "--json"]))

    assert envelope["exitCode"] == 0
    data = envelope["data"]
    assert isinstance(data, dict)
    assert data["created"] is True
    assert data["directoryCreated"] is True
    assert data["wouldCreateDirectory"] is True
    assert data["files"] == ["graph.json"]
    assert data["graphHash"] == cli_module.QUICKSTART_HASH
    assert (target / "graph.json").read_bytes() == QUICKSTART.read_bytes()


def test_init_accepts_an_existing_empty_directory(tmp_path: Path) -> None:
    target = tmp_path / "empty"
    target.mkdir()
    result = invoke(["init", str(target)])

    assert result.status == 0
    assert result.stderr == b""
    assert (target / "graph.json").read_bytes() == QUICKSTART.read_bytes()


def test_init_defaults_to_the_current_empty_directory(tmp_path: Path) -> None:
    envelope = machine(invoke(["init", "--json"], cwd=tmp_path))

    data = envelope["data"]
    assert isinstance(data, dict)
    assert data["targetDirectory"] == str(tmp_path)
    assert data["directoryCreated"] is False
    assert (tmp_path / "graph.json").read_bytes() == QUICKSTART.read_bytes()


def test_init_dry_run_performs_zero_writes(tmp_path: Path) -> None:
    target = tmp_path / "dry/nested/project"
    envelope = machine(invoke(["init", str(target), "--dry-run", "--json"]))

    data = envelope["data"]
    assert isinstance(data, dict)
    assert data["dryRun"] is True
    assert data["created"] is False
    assert data["wouldCreateDirectory"] is True
    assert not (tmp_path / "dry").exists()


def test_init_refuses_a_nonempty_directory_without_modification(tmp_path: Path) -> None:
    target = tmp_path / "occupied"
    target.mkdir()
    sentinel = target / "keep.txt"
    sentinel.write_text("user-owned\n")

    envelope = machine(invoke(["init", str(target), "--json"]))

    error = envelope["error"]
    assert isinstance(error, dict)
    assert envelope["exitCode"] == 2
    assert error["code"] == "GECLI_INIT_TARGET_NOT_EMPTY"
    assert sentinel.read_text() == "user-owned\n"
    assert list(target.iterdir()) == [sentinel]


def test_init_refuses_an_existing_file_without_modification(tmp_path: Path) -> None:
    target = tmp_path / "existing-file"
    target.write_text("user-owned\n")

    envelope = machine(invoke(["init", str(target), "--json"]))

    error = envelope["error"]
    assert isinstance(error, dict)
    assert envelope["exitCode"] == 2
    assert error["code"] == "GECLI_INIT_TARGET_NOT_DIRECTORY"
    assert target.read_text() == "user-owned\n"


def test_init_refuses_a_symlink_target(tmp_path: Path) -> None:
    real_target = tmp_path / "real"
    linked_target = tmp_path / "linked"
    real_target.mkdir()
    try:
        linked_target.symlink_to(real_target, target_is_directory=True)
    except OSError as error:
        pytest.skip(f"symlink creation unavailable: {error}")

    envelope = machine(invoke(["init", str(linked_target), "--json"]))

    failure = envelope["error"]
    assert isinstance(failure, dict)
    assert envelope["exitCode"] == 2
    assert failure["code"] == "GECLI_INIT_TARGET_SYMLINK"
    assert list(real_target.iterdir()) == []
    assert linked_target.is_symlink()


def test_two_concurrent_init_processes_have_exactly_one_winner(tmp_path: Path) -> None:
    target = tmp_path / "race"
    command = [
        sys.executable,
        "-m",
        "graph_engineering.cli",
        "init",
        str(target),
        "--json",
    ]
    first = subprocess.Popen(command, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    second = subprocess.Popen(command, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    first_stdout, first_stderr = first.communicate(timeout=30)
    second_stdout, second_stderr = second.communicate(timeout=30)

    invocations = [
        Invocation(first.returncode, first_stdout, first_stderr),
        Invocation(second.returncode, second_stdout, second_stderr),
    ]
    assert sorted(item.status for item in invocations) == [0, 2]
    envelopes = [machine(item) for item in invocations]
    assert sum(item["ok"] is True for item in envelopes) == 1
    assert (target / "graph.json").read_bytes() == QUICKSTART.read_bytes()


@pytest.mark.parametrize(
    "args",
    [
        ["validate", "-", "--input-format", "toml", "--json"],
        ["validate", "-", "--input-format=", "--json"],
        ["validate", "-", "--input-format", "json", "--input-format=yaml", "--json"],
        ["doctor", "--input-format", "json", "--json"],
        ["validate", str(DIAMOND), "--format", "dot", "--json"],
        ["visualize", str(DIAMOND), "--format=svg", "--json"],
        ["init", "--force", "--json"],
    ],
)
def test_invalid_arguments_fail_before_command_work(args: list[str]) -> None:
    envelope = machine(invoke(args))

    error = envelope["error"]
    assert isinstance(error, dict)
    assert envelope["exitCode"] == 2
    assert error["code"] == "GECLI_USAGE"


def test_help_and_version_are_plain_successful_commands() -> None:
    help_result = invoke(["--help"])
    version_result = invoke(["--version"])

    assert help_result.status == version_result.status == 0
    assert help_result.stderr == version_result.stderr == b""
    assert b"graph validate" in help_result.stdout
    assert b"grapheng" not in help_result.stdout
    assert version_result.stdout == b"0.2.0-alpha.2\n"


def test_unexpected_internal_failure_uses_exit_seventy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fail(_: object) -> cli_module._ValidationResult:
        raise RuntimeError("controlled failure")

    monkeypatch.setattr(cli_module, "_project_compilation", fail)
    stdout = io.StringIO()
    stderr = io.StringIO()
    streams = cli_module._CliIo(io.BytesIO(DIAMOND.read_bytes()), stdout, stderr)

    exit_code = cli_module.run(["validate", "-", "--json"], io=streams)

    assert exit_code == 70
    assert stderr.getvalue() == ""
    envelope = json.loads(stdout.getvalue())
    assert envelope["error"] == {
        "code": "GECLI_INTERNAL",
        "message": "unexpected internal error: controlled failure",
    }


def test_packaged_template_is_byte_identical_to_the_repository_quickstart() -> None:
    packaged = (
        PYTHON_ROOT
        / "src/graph_engineering/data/research-diamond.graph.json"
    )
    assert packaged.read_bytes() == QUICKSTART.read_bytes()


def test_console_script_metadata_declares_both_compatibility_names() -> None:
    pyproject = (PYTHON_ROOT / "pyproject.toml").read_text()
    assert 'graph = "graph_engineering.cli:main"' in pyproject
    assert 'grapheng = "graph_engineering.cli:main"' in pyproject
