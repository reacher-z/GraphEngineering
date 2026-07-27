#!/usr/bin/env python3
"""Audit built Python artifacts without extracting untrusted archive paths."""

from __future__ import annotations

import configparser
import email
import json
import os
import re
import subprocess
import sys
import tarfile
import tempfile
import zipfile
from pathlib import Path, PurePosixPath
from shutil import which

import tomllib

ROOT = Path(__file__).resolve().parents[1]
PYTHON_ROOT = ROOT / "python"
DIST = PYTHON_ROOT / "dist"
AUTHORING_ROOT = ROOT / "spec" / "conformance" / "authoring"
AUTHORING_CASES = json.loads((AUTHORING_ROOT / "authoring.case.json").read_text(encoding="utf-8"))
TYPED_CASE = next(
    item for item in AUTHORING_CASES["equivalenceCases"] if item["name"] == "typed-port-diamond"
)
IDENTITY_GOLDEN = json.loads(
    (AUTHORING_ROOT / AUTHORING_CASES["identityGolden"]).read_text(encoding="utf-8")
)["identities"][TYPED_CASE["identityKey"]]
SHARED_AUTHORING_YAML = (AUTHORING_ROOT / TYPED_CASE["yaml"]).read_bytes()
MACHINE_SCHEMA_VERSION = "graph-engineering.cli/v1alpha1"
CONSOLE_SCRIPT_TARGET = "graph_engineering.cli:main"
QUICKSTART_ARCHIVE_PATH = "graph_engineering/data/research-diamond.graph.json"
QUICKSTART_SOURCE = (
    ROOT / "examples" / "quickstart" / "research-diamond.graph.json"
).read_bytes()
FORBIDDEN = re.compile(
    r"(?:^|/)(?:__pycache__|\.pytest_cache|\.mypy_cache|\.ruff_cache|codex_logs|codex_plans)(?:/|$)|\.pyc$|(?:^|/)\.env(?:\.|$)"
)


def safe_archive_path(name: str) -> bool:
    path = PurePosixPath(name)
    return not path.is_absolute() and ".." not in path.parts and not FORBIDDEN.search(name)


def canonical_distribution_name(name: str) -> str:
    """Apply the PEP 503 equality rule for '-', '_' and '.' in project names."""

    return re.sub(r"[-_.]+", "-", name).lower()


def parse_console_scripts(source: bytes) -> dict[str, str]:
    parser = configparser.ConfigParser(interpolation=None)
    parser.optionxform = str
    try:
        parser.read_string(source.decode("utf-8"))
    except (UnicodeDecodeError, configparser.Error) as error:
        raise SystemExit(f"wheel has invalid entry_points.txt: {error}") from error
    if not parser.has_section("console_scripts"):
        raise SystemExit("wheel entry_points.txt omits [console_scripts]")
    return dict(parser.items("console_scripts", raw=True))


def installed_console_script(virtualenv: Path, name: str) -> Path:
    scripts = virtualenv / ("Scripts" if sys.platform == "win32" else "bin")
    executable = scripts / (f"{name}.exe" if sys.platform == "win32" else name)
    if not executable.is_file():
        raise SystemExit(f"isolated installation omits {name!r} console script")
    return executable


def invoke_machine_cli(
    executable: Path,
    arguments: list[str],
    *,
    cwd: Path,
    expected_command: str,
    expected_exit: int,
) -> dict[str, object]:
    environment = os.environ.copy()
    environment.pop("PYTHONHOME", None)
    environment.pop("PYTHONPATH", None)
    environment["PYTHONUTF8"] = "1"
    result = subprocess.run(
        [str(executable), *arguments],
        cwd=cwd,
        env=environment,
        capture_output=True,
        check=False,
        timeout=60,
    )
    label = f"{executable.name} {expected_command}"
    if result.returncode != expected_exit:
        raise SystemExit(
            f"{label} exited {result.returncode}, expected {expected_exit}; "
            f"stderr={result.stderr!r}, stdout={result.stdout!r}"
        )
    if result.stderr:
        raise SystemExit(f"{label} emitted unexpected stderr: {result.stderr!r}")
    if not result.stdout.endswith(b"\n") or len(result.stdout.rstrip(b"\n").splitlines()) != 1:
        raise SystemExit(f"{label} did not emit exactly one newline-terminated JSON document")
    try:
        envelope = json.loads(result.stdout)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise SystemExit(f"{label} emitted invalid UTF-8 JSON: {error}") from error
    if not isinstance(envelope, dict):
        raise SystemExit(f"{label} machine response is not an object")
    expected_keys = ["schemaVersion", "command", "ok", "exitCode", "data", "error"]
    if list(envelope) != expected_keys:
        raise SystemExit(f"{label} machine envelope fields changed: {list(envelope)!r}")
    expected_header = {
        "schemaVersion": MACHINE_SCHEMA_VERSION,
        "command": expected_command,
        "ok": expected_exit == 0,
        "exitCode": expected_exit,
    }
    for key, expected in expected_header.items():
        if envelope[key] != expected:
            raise SystemExit(f"{label} envelope {key} is {envelope[key]!r}, expected {expected!r}")
    if envelope["error"] is not None:
        raise SystemExit(f"{label} unexpectedly returned an error: {envelope['error']!r}")
    if not isinstance(envelope["data"], dict):
        raise SystemExit(f"{label} machine data is not an object")
    return envelope


project = tomllib.loads((PYTHON_ROOT / "pyproject.toml").read_text(encoding="utf-8"))["project"]
version = project["version"]
wheel_candidates = sorted(DIST.glob(f"graph_engineering-{version}-*.whl"))
sdist_candidates = sorted(DIST.glob(f"graph_engineering-{version}.tar.gz"))
if len(wheel_candidates) != 1 or len(sdist_candidates) != 1:
    raise SystemExit(
        f"expected one wheel and one sdist for {version}; found {wheel_candidates!r}, {sdist_candidates!r}"
    )

wheel = wheel_candidates[0]
sdist = sdist_candidates[0]
if wheel.stat().st_size > 2_000_000 or sdist.stat().st_size > 2_000_000:
    raise SystemExit("Python artifact unexpectedly exceeds 2 MB")

with zipfile.ZipFile(wheel) as archive:
    wheel_names = archive.namelist()
    if len(wheel_names) != len(set(wheel_names)):
        raise SystemExit("wheel contains duplicate paths")
    if not all(safe_archive_path(name) for name in wheel_names):
        raise SystemExit("wheel contains an unsafe or forbidden path")
    required_wheel = {
        "graph_engineering/__init__.py",
        "graph_engineering/builder.py",
        "graph_engineering/cli.py",
        "graph_engineering/component_identity.py",
        "graph_engineering/cycle_lineage.py",
        QUICKSTART_ARCHIVE_PATH,
        "graph_engineering/pipeline.py",
        "graph_engineering/py.typed",
        "graph_engineering/scheduler.py",
        "graph_engineering/source.py",
        "graph_engineering/typed_ports.py",
        "graph_engineering/persistence/__init__.py",
        "graph_engineering/primitives/__init__.py",
    }
    missing = required_wheel.difference(wheel_names)
    if missing:
        raise SystemExit(f"wheel omits public runtime files: {sorted(missing)!r}")
    if any("/tests/" in f"/{name}" for name in wheel_names):
        raise SystemExit("wheel unexpectedly contains tests")
    if archive.read(QUICKSTART_ARCHIVE_PATH) != QUICKSTART_SOURCE:
        raise SystemExit("wheel quickstart asset differs from the repository quickstart")
    metadata_names = [name for name in wheel_names if name.endswith(".dist-info/METADATA")]
    if len(metadata_names) != 1:
        raise SystemExit("wheel must contain exactly one METADATA file")
    metadata = email.message_from_bytes(archive.read(metadata_names[0]))
    expected_metadata = {
        "Name": "graph-engineering",
        "Version": version,
        "Requires-Python": ">=3.11",
        "License-Expression": "MIT",
    }
    for key, expected in expected_metadata.items():
        if metadata[key] != expected:
            raise SystemExit(f"wheel metadata {key} is {metadata[key]!r}, expected {expected!r}")
    requirements = {
        canonical_distribution_name(match.group())
        for value in metadata.get_all("Requires-Dist", [])
        if (match := re.match(r"[A-Za-z0-9_.-]+", value)) is not None
    }
    for dependency in ("jsonschema", "pydantic", "ruamel-yaml"):
        if canonical_distribution_name(dependency) not in requirements:
            raise SystemExit(f"wheel metadata omits runtime dependency {dependency!r}")
    urls = set(metadata.get_all("Project-URL", []))
    required_urls = {
        "Homepage, https://github.com/reacher-z/GraphEngineering",
        "Repository, https://github.com/reacher-z/GraphEngineering",
        "Issues, https://github.com/reacher-z/GraphEngineering/issues",
    }
    if not required_urls.issubset(urls):
        raise SystemExit(f"wheel project URLs are incomplete: {sorted(urls)!r}")
    if not any(name.endswith(".dist-info/licenses/LICENSE") for name in wheel_names):
        raise SystemExit("wheel omits bundled MIT license text")
    entry_point_names = [
        name for name in wheel_names if name.endswith(".dist-info/entry_points.txt")
    ]
    if len(entry_point_names) != 1:
        raise SystemExit("wheel must contain exactly one entry_points.txt file")
    console_scripts = parse_console_scripts(archive.read(entry_point_names[0]))
    for name in ("graph", "grapheng"):
        if console_scripts.get(name) != CONSOLE_SCRIPT_TARGET:
            raise SystemExit(
                f"wheel console script {name!r} points to {console_scripts.get(name)!r}, "
                f"expected {CONSOLE_SCRIPT_TARGET!r}"
            )

with tarfile.open(sdist, mode="r:gz") as archive:
    members = archive.getmembers()
    names = [member.name for member in members]
    if len(names) != len(set(names)):
        raise SystemExit("sdist contains duplicate paths")
    if not all(safe_archive_path(name) for name in names):
        raise SystemExit("sdist contains an unsafe or forbidden path")
    if any(member.issym() or member.islnk() for member in members):
        raise SystemExit("sdist contains a symbolic or hard link")
    prefix = f"graph_engineering-{version}/"
    required_sdist = {
        f"{prefix}README.md",
        f"{prefix}pyproject.toml",
        f"{prefix}LICENSE",
        f"{prefix}src/graph_engineering/__init__.py",
        f"{prefix}src/graph_engineering/_json.py",
        f"{prefix}src/graph_engineering/builder.py",
        f"{prefix}src/graph_engineering/canonical.py",
        f"{prefix}src/graph_engineering/cli.py",
        f"{prefix}src/graph_engineering/component_identity.py",
        f"{prefix}src/graph_engineering/cycle_lineage.py",
        f"{prefix}src/{QUICKSTART_ARCHIVE_PATH}",
        f"{prefix}src/graph_engineering/pipeline.py",
        f"{prefix}src/graph_engineering/py.typed",
        f"{prefix}src/graph_engineering/scheduler.py",
        f"{prefix}src/graph_engineering/source.py",
        f"{prefix}src/graph_engineering/typed_ports.py",
        f"{prefix}src/graph_engineering/persistence/event_store.py",
        f"{prefix}src/graph_engineering/primitives/barrier.py",
    }
    missing = required_sdist.difference(names)
    if missing:
        raise SystemExit(f"sdist omits source/package files: {sorted(missing)!r}")
    if any(name.startswith(f"{prefix}tests/") for name in names):
        raise SystemExit("sdist unexpectedly contains repository tests that require external fixtures")
    quickstart_member = archive.extractfile(f"{prefix}src/{QUICKSTART_ARCHIVE_PATH}")
    if quickstart_member is None or quickstart_member.read() != QUICKSTART_SOURCE:
        raise SystemExit("sdist quickstart asset differs from the repository quickstart")

smoke = r"""
import sys
from pathlib import Path

from graph_engineering import (
    create_compiled_graph_identity,
    graph_builder,
    parse_graph_source,
    try_compile_graph,
    validate_strict_typed_ports,
    verify_compiled_graph_identity,
)

document = parse_graph_source(Path(sys.argv[1]).read_bytes(), format="yaml")
builder = graph_builder(
    metadata=document["metadata"],
    input_schema=document["inputSchema"],
    output_schema=document["outputSchema"],
    **({"state_schema": document["stateSchema"]} if "stateSchema" in document else {}),
    **({"policies": document["policies"]} if "policies" in document else {}),
)
for node in document["nodes"]:
    builder.add_node(node)
for edge in document["edges"]:
    builder.add_edge(edge)
for entrypoint in document["entrypoints"]:
    builder.add_entrypoint(entrypoint)
for name, endpoint in document["outputs"].items():
    builder.add_output(name, endpoint)
built = builder.build()
compiled = try_compile_graph(document)
assert compiled.valid and compiled.graph is not None
assert compiled.graph.graph_hash == sys.argv[2]
assert compiled.graph.graph_hash == built.graph_hash
assert validate_strict_typed_ports(compiled.graph.spec) == ()
identity = create_compiled_graph_identity(compiled.graph)
assert identity.revision_hash == sys.argv[3]
assert identity.revision_hash == built.identity.revision_hash
assert verify_compiled_graph_identity(compiled.graph, identity).valid
"""

uv = which("uv")
if uv is None:
    raise SystemExit("uv is required for isolated Python artifact installation")

for artifact_kind, artifact in (("wheel", wheel), ("sdist", sdist)):
    with tempfile.TemporaryDirectory(
        prefix=f"graph-engineering-{artifact_kind}-smoke-"
    ) as directory:
        virtualenv = Path(directory) / "venv"
        subprocess.run(
            [uv, "venv", "--python", sys.executable, str(virtualenv)],
            check=True,
            timeout=120,
        )
        executable = virtualenv / (
            "Scripts/python.exe" if sys.platform == "win32" else "bin/python"
        )
        subprocess.run(
            [uv, "pip", "install", "--python", str(executable), str(artifact)],
            check=True,
            timeout=300,
        )
        fixture = Path(directory) / TYPED_CASE["yaml"]
        fixture.write_bytes(SHARED_AUTHORING_YAML)
        subprocess.run(
            [
                str(executable),
                "-I",
                "-c",
                smoke,
                str(fixture),
                TYPED_CASE["expect"]["graphHash"],
                IDENTITY_GOLDEN["revisionHash"],
            ],
            cwd=directory,
            check=True,
            timeout=60,
        )
        graph = installed_console_script(virtualenv, "graph")
        grapheng = installed_console_script(virtualenv, "grapheng")
        validation = invoke_machine_cli(
            graph,
            ["validate", str(fixture), "--input-format", "yaml", "--json"],
            cwd=Path(directory),
            expected_command="validate",
            expected_exit=0,
        )
        validation_data = validation["data"]
        assert isinstance(validation_data, dict)
        if validation_data.get("valid") is not True:
            raise SystemExit(f"installed graph validate rejected the shared fixture: {validation_data!r}")
        expected_hash = TYPED_CASE["expect"]["graphHash"]
        if validation_data.get("graphHash") != expected_hash:
            raise SystemExit(
                "installed graph validate returned graph hash "
                f"{validation_data.get('graphHash')!r}, expected {expected_hash!r}"
            )
        doctor = invoke_machine_cli(
            grapheng,
            ["doctor", "--json"],
            cwd=Path(directory),
            expected_command="doctor",
            expected_exit=0,
        )
        doctor_data = doctor["data"]
        assert isinstance(doctor_data, dict)
        checks = doctor_data.get("checks")
        if (
            doctor_data.get("healthy") is not True
            or doctor_data.get("remediations") != []
            or not isinstance(checks, list)
            or not checks
            or any(not isinstance(item, dict) or item.get("status") != "pass" for item in checks)
        ):
            raise SystemExit(f"installed grapheng doctor reported an unhealthy artifact: {doctor_data!r}")

print(
    f"Validated and installed Python wheel and sdist for graph-engineering {version}: "
    f"{len(wheel_names)} wheel entries, {len(names)} sdist entries; entry points, "
    "shared YAML authoring, validate, and doctor passed."
)
