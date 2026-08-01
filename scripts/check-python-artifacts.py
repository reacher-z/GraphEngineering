#!/usr/bin/env python3
"""Audit built Python artifacts without extracting untrusted archive paths."""

from __future__ import annotations

import configparser
import email
import json
import os
import re
import stat
import subprocess
import sys
import tarfile
import tempfile
import zipfile
from pathlib import Path, PurePosixPath, PureWindowsPath
from shutil import which

import tomllib

ROOT = Path(__file__).resolve().parents[1]
PYTHON_ROOT = ROOT / "python"
DIST = PYTHON_ROOT / "dist"
AUTHORING_ROOT = ROOT / "spec" / "conformance" / "authoring"
AUTHORING_CASES = json.loads(
    (AUTHORING_ROOT / "authoring.case.json").read_text(encoding="utf-8")
)
TYPED_CASE = next(
    item
    for item in AUTHORING_CASES["equivalenceCases"]
    if item["name"] == "typed-port-diamond"
)
IDENTITY_GOLDEN = json.loads(
    (AUTHORING_ROOT / AUTHORING_CASES["identityGolden"]).read_text(encoding="utf-8")
)["identities"][TYPED_CASE["identityKey"]]
SHARED_AUTHORING_YAML = (AUTHORING_ROOT / TYPED_CASE["yaml"]).read_bytes()
MACHINE_SCHEMA_VERSION = "graph-engineering.cli/v1alpha1"
CONSOLE_SCRIPT_TARGET = "graph_engineering.cli:main"
QUICKSTART_ARCHIVE_PATH = "graph_engineering/data/research-diamond.graph.json"
IMPORTED_VERSION_PROBE = (
    "import graph_engineering, sys; print(graph_engineering.__version__)"
)
QUICKSTART_SOURCE = (
    ROOT / "examples" / "quickstart" / "research-diamond.graph.json"
).read_bytes()
FORBIDDEN = re.compile(
    r"(?:^|/)(?:__pycache__|\.pytest_cache|\.mypy_cache|\.ruff_cache|codex_logs|codex_plans)(?:/|$)|\.pyc$|(?:^|/)\.env(?:\.|$)"
)
WINDOWS_RESERVED_NAME = re.compile(
    r"^(?:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)",
    re.IGNORECASE,
)


def windows_archive_key(name: str) -> tuple[str, ...]:
    """Return the Windows case-insensitive identity of one prevalidated path."""

    candidate = name.removesuffix("/")
    return tuple(part.casefold() for part in PurePosixPath(candidate).parts)


def safe_archive_path(name: str) -> bool:
    if not name or "\0" in name or "\\" in name:
        return False
    candidate = name.removesuffix("/")
    if not candidate:
        return False
    path = PurePosixPath(candidate)
    windows_path = PureWindowsPath(candidate)
    windows_reserved = any(
        part.endswith((".", " ")) or ":" in part or WINDOWS_RESERVED_NAME.match(part)
        for part in path.parts
    )
    return (
        not path.is_absolute()
        and not windows_path.is_absolute()
        and not windows_path.drive
        and not windows_reserved
        and ".." not in path.parts
        and "." not in path.parts
        and str(path) == candidate
        and not FORBIDDEN.search(name)
    )


for hostile_archive_path in (
    "../escape",
    "safe/../../escape",
    "..\\escape",
    "C:\\escape",
    "C:escape",
    "\\\\server\\share\\escape",
    "/absolute",
    "safe//alias",
    "safe/./alias",
    "safe\0suffix",
    "package/file.py:stream",
    "package/CON",
    "package/aux.txt",
    "package/name.",
    "package/name ",
):
    if safe_archive_path(hostile_archive_path):
        raise SystemExit(
            f"archive path guard accepted hostile path: {hostile_archive_path!r}"
        )
for ordinary_archive_path in ("package/module.py", "package/data/", "LICENSE"):
    if not safe_archive_path(ordinary_archive_path):
        raise SystemExit(
            f"archive path guard rejected ordinary path: {ordinary_archive_path!r}"
        )
if windows_archive_key("Package/module.py") != windows_archive_key("package/MODULE.py"):
    raise SystemExit("archive Windows collision guard self-test failed")


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


def display_version(project_version: str) -> str:
    """Map the PEP 440 project version onto the CLI's SemVer display spelling.

    The wheel is labelled with the PEP 440 form and the CLI prints the SemVer
    form of the same release. Only the pre-release spellings this project uses
    are recognised, so an unfamiliar version fails here instead of silently
    disabling the agreement check below.
    """
    match = re.fullmatch(r"(\d+\.\d+\.\d+)(?:(a|b|rc)(\d+))?", project_version)
    if match is None:
        raise SystemExit(f"unsupported project version spelling: {project_version!r}")
    release, kind, ordinal = match.groups()
    if kind is None:
        return release
    return f"{release}-{ {'a': 'alpha', 'b': 'beta', 'rc': 'rc'}[kind]}.{ordinal}"


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
    if (
        not result.stdout.endswith(b"\n")
        or len(result.stdout.rstrip(b"\n").splitlines()) != 1
    ):
        raise SystemExit(
            f"{label} did not emit exactly one newline-terminated JSON document"
        )
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
            raise SystemExit(
                f"{label} envelope {key} is {envelope[key]!r}, expected {expected!r}"
            )
    if envelope["error"] is not None:
        raise SystemExit(
            f"{label} unexpectedly returned an error: {envelope['error']!r}"
        )
    if not isinstance(envelope["data"], dict):
        raise SystemExit(f"{label} machine data is not an object")
    return envelope


project = tomllib.loads((PYTHON_ROOT / "pyproject.toml").read_text(encoding="utf-8"))[
    "project"
]
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
    wheel_entries = archive.infolist()
    wheel_names = [entry.filename for entry in wheel_entries]
    if len(wheel_names) != len(set(wheel_names)):
        raise SystemExit("wheel contains duplicate paths")
    wheel_windows_keys = [windows_archive_key(name) for name in wheel_names]
    if len(wheel_windows_keys) != len(set(wheel_windows_keys)):
        raise SystemExit("wheel contains Windows-equivalent duplicate paths")
    if not all(safe_archive_path(name) for name in wheel_names):
        raise SystemExit("wheel contains an unsafe or forbidden path")
    if any(
        (kind := stat.S_IFMT(entry.external_attr >> 16))
        and kind not in {stat.S_IFREG, stat.S_IFDIR}
        for entry in wheel_entries
    ):
        raise SystemExit("wheel contains a non-regular, non-directory member")
    required_wheel = {
        "graph_engineering/__init__.py",
        "graph_engineering/builder.py",
        "graph_engineering/cli.py",
        "graph_engineering/component_identity.py",
        "graph_engineering/cycle_lineage.py",
        "graph_engineering/cycle_store_provider.py",
        QUICKSTART_ARCHIVE_PATH,
        "graph_engineering/pipeline.py",
        "graph_engineering/py.typed",
        "graph_engineering/scheduler.py",
        "graph_engineering/source.py",
        "graph_engineering/sqlite_cursor_publication_initial_write_digest.py",
        "graph_engineering/sqlite_cursor_publication_migration_0002_asset.py",
        "graph_engineering/sqlite_cursor_publication_target_catalog.py",
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
        raise SystemExit(
            "wheel quickstart asset differs from the repository quickstart"
        )
    metadata_names = [
        name for name in wheel_names if name.endswith(".dist-info/METADATA")
    ]
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
            raise SystemExit(
                f"wheel metadata {key} is {metadata[key]!r}, expected {expected!r}"
            )
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
    sdist_windows_keys = [windows_archive_key(name) for name in names]
    if len(sdist_windows_keys) != len(set(sdist_windows_keys)):
        raise SystemExit("sdist contains Windows-equivalent duplicate paths")
    if not all(safe_archive_path(name) for name in names):
        raise SystemExit("sdist contains an unsafe or forbidden path")
    if any(not (member.isfile() or member.isdir()) for member in members):
        raise SystemExit("sdist contains a non-regular, non-directory member")
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
        f"{prefix}src/graph_engineering/cycle_store_provider.py",
        f"{prefix}src/{QUICKSTART_ARCHIVE_PATH}",
        f"{prefix}src/graph_engineering/pipeline.py",
        f"{prefix}src/graph_engineering/py.typed",
        f"{prefix}src/graph_engineering/scheduler.py",
        f"{prefix}src/graph_engineering/source.py",
        f"{prefix}src/graph_engineering/sqlite_cursor_publication_initial_write_digest.py",
        f"{prefix}src/graph_engineering/sqlite_cursor_publication_migration_0002_asset.py",
        f"{prefix}src/graph_engineering/sqlite_cursor_publication_target_catalog.py",
        f"{prefix}src/graph_engineering/typed_ports.py",
        f"{prefix}src/graph_engineering/persistence/event_store.py",
        f"{prefix}src/graph_engineering/primitives/barrier.py",
    }
    missing = required_sdist.difference(names)
    if missing:
        raise SystemExit(f"sdist omits source/package files: {sorted(missing)!r}")
    if any(name.startswith(f"{prefix}tests/") for name in names):
        raise SystemExit(
            "sdist unexpectedly contains repository tests that require external fixtures"
        )
    quickstart_member = archive.extractfile(f"{prefix}src/{QUICKSTART_ARCHIVE_PATH}")
    if quickstart_member is None or quickstart_member.read() != QUICKSTART_SOURCE:
        raise SystemExit(
            "sdist quickstart asset differs from the repository quickstart"
        )

smoke = r"""
import sys
from importlib.resources import files
from pathlib import Path

import graph_engineering

from graph_engineering import (
    create_cycle_store_record,
    create_compiled_graph_identity,
    create_reference_cycle_store_provider_descriptor,
    graph_builder,
    parse_graph_source,
    try_compile_graph,
    validate_strict_typed_ports,
    verify_compiled_graph_identity,
)

for private_module_name in (
    "sqlite_cursor_publication_initial_write_digest",
    "sqlite_cursor_publication_migration_0002_asset",
    "sqlite_cursor_publication_target_catalog",
):
    assert not hasattr(graph_engineering, private_module_name)

from graph_engineering.sqlite_cursor_publication_initial_write_digest import (
    _digest_sqlite_initial_write_parameters_intrinsic,
    _digest_sqlite_initial_write_result_intrinsic,
    _encode_sqlite_initial_write_parameter_payload_intrinsic,
    _encode_sqlite_initial_write_result_payload_intrinsic,
)
from graph_engineering.sqlite_cursor_publication_migration_0002_asset import (
    SQLITE_CURSOR_MIGRATION_0002_ASSET_NAME,
    SQLITE_CURSOR_MIGRATION_0002_ASSET_SHA256,
    SQLITE_CURSOR_MIGRATION_0002_ASSET_UTF8_BYTES,
    SQLITE_CURSOR_MIGRATION_0002_FIXED_STATEMENT_COUNT,
    SQLITE_CURSOR_MIGRATION_0002_PREVIEW_MANIFEST_SHA256,
    SQLITE_CURSOR_MIGRATION_0002_SCHEMA_SQL_SHA256,
    _load_sqlite_cursor_migration_0002_asset_intrinsic,
    _read_sqlite_cursor_migration_0002_asset_snapshot_intrinsic,
)
from graph_engineering.sqlite_cursor_publication_target_catalog import (
    SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_CANONICAL_UTF8_BYTES,
    SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_INVENTORY,
    SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_ROW_COUNT,
    SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_SHA256,
    SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_QUERY,
    SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_QUERY_SHA256,
    SQLITE_CURSOR_PUBLICATION_TARGET_DESCRIPTOR,
    _read_validated_target_catalog_intrinsic,
)
from graph_engineering.sqlite_operation_baseline_source import (
    SQLiteV1BaselineConnectionOwner,
)

parameter_vectors = (
    (
        [[]],
        "[[]]",
        "8acdf04fe02395192d1c7d704cf8ecf52e29513ccd77024ff4f9cc9e230da80a",
    ),
    (
        [[
            {"type": "text", "value": "Aé😀"},
            {"type": "integer", "value": "-42"},
            {"type": "blob", "value": "AP8"},
            {"type": "null"},
        ]],
        '[[{"type":"text","value":"Aé😀"},{"type":"integer","value":"-42"},'
        '{"type":"blob","value":"AP8"},{"type":"null"}]]',
        "8fcf64e97e9fda027b287997e43efc5226b596207dfc56ed161e46859027c271",
    ),
    (
        [
            [{"type": "text", "value": "x"}, {"type": "integer", "value": "0"}],
            [
                {"type": "text", "value": "y"},
                {"type": "integer", "value": "9007199254740991"},
            ],
        ],
        '[[{"type":"text","value":"x"},{"type":"integer","value":"0"}],'
        '[{"type":"text","value":"y"},{"type":"integer",'
        '"value":"9007199254740991"}]]',
        "379049937f6797daade28d4b963dcc865f51afa5fa3422b90f4e505deaad838e",
    ),
    (
        [[{"type": "integer", "value": "-9223372036854775808"}]],
        '[[{"type":"integer","value":"-9223372036854775808"}]]',
        "d3d9b55872b8b14e2ec8a3c2b5ca27db179993b97ce9e47845efd2923eef4460",
    ),
    (
        [[{"type": "integer", "value": "9223372036854775807"}]],
        '[[{"type":"integer","value":"9223372036854775807"}]]',
        "be263941652b27aa8254e518d3de8853c3071e7b7310449a7af13fb8bd2765ce",
    ),
)
for value, canonical, expected_digest in parameter_vectors:
    assert _encode_sqlite_initial_write_parameter_payload_intrinsic(value) == canonical
    assert _digest_sqlite_initial_write_parameters_intrinsic(value) == expected_digest

result_vectors = (
    (
        {"affectedRows": "0"},
        '{"affectedRows":"0"}',
        "7d4e42c580be36f078371942187c0bdf048da4ffa35556c3f219f5930c5abd62",
    ),
    (
        {"affectedRows": "3"},
        '{"affectedRows":"3"}',
        "9c4a39646a7cb26c3ba53e91941b6fe0f4435355a06d2138156d1fd9551ba417",
    ),
)
for value, canonical, expected_digest in result_vectors:
    assert _encode_sqlite_initial_write_result_payload_intrinsic(value) == canonical
    assert _digest_sqlite_initial_write_result_intrinsic(value) == expected_digest

migration_asset = _load_sqlite_cursor_migration_0002_asset_intrinsic()
migration_snapshot = _read_sqlite_cursor_migration_0002_asset_snapshot_intrinsic(migration_asset)
assert (
    migration_snapshot.asset_name,
    migration_snapshot.asset_sha256,
    migration_snapshot.asset_utf8_bytes,
    migration_snapshot.fixed_statement_count,
    migration_snapshot.preview_manifest_sha256,
    migration_snapshot.schema_sql_sha256,
    len(migration_snapshot.statements),
) == (
    "0002-v1-to-v2-operation-replay.sql",
    "1bf03d68eed45366bc7b34ccc329faa51ea389362db59f6a4307b3033d37a96d",
    9_523,
    20,
    "f1d447b5b4e925151d04a952376a1386da9196538f18f0be17c56da01d31deaf",
    "5a0923462f7fa5eb1627955292aa3657253258fc5832e365257dc913740866a5",
    20,
)
assert migration_snapshot.statements[0].endswith("PRAGMA defer_foreign_keys = ON;")
assert migration_snapshot.statements[-1] == "PRAGMA user_version = 2;"

target_owner = SQLiteV1BaselineConnectionOwner(":memory:")
try:
    schema_v1 = files("graph_engineering._sqlite_migrations").joinpath("schema-v1.sql")
    target_owner.executescript(schema_v1.read_text(encoding="utf-8"))
    target_owner.execute("BEGIN EXCLUSIVE").close()
    for statement in migration_snapshot.statements:
        target_owner.execute(statement).close()
    target_catalog = _read_validated_target_catalog_intrinsic(target_owner)
    assert (
        target_catalog.row_count,
        target_catalog.canonical_utf8_bytes,
        target_catalog.catalog_sha256,
        target_catalog.application_id,
        target_catalog.user_version,
        target_catalog.query_sha256,
    ) == (
        34,
        5_785,
        "ca85cf266267fa3eb5443bdf6d957b4b03c795cd6e0232a28c52773f1041fadf",
        1_195_724_359,
        2,
        "bd9a24c0e8307f473f6160b940effdfb77007144fbeea83628f0b7664df1410c",
    )
    assert target_catalog.inventory == SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_INVENTORY
    assert target_catalog.target_descriptor is SQLITE_CURSOR_PUBLICATION_TARGET_DESCRIPTOR
    assert target_catalog.target_descriptor.descriptor_hash == (
        "f632104c823e7559dbbb889b08ac3adb0cf0b6dc528cdb9179c9521ce72cff92"
    )
finally:
    if target_owner.in_transaction:
        target_owner.rollback()
    target_owner.close()

forbidden_foundation_root_exports = {
    "SQLITE_INITIAL_WRITE_PARAMETER_DOMAIN_UTF8",
    "SQLITE_INITIAL_WRITE_RESULT_DOMAIN_UTF8",
    "SQLITE_INITIAL_WRITE_SIGNED_INT64_MINIMUM",
    "SQLITE_INITIAL_WRITE_SIGNED_INT64_MAXIMUM",
    "digest_sqlite_initial_write_parameters",
    "digest_sqlite_initial_write_result",
    "encode_sqlite_initial_write_parameter_payload",
    "encode_sqlite_initial_write_result_payload",
    "_digest_sqlite_initial_write_parameters_intrinsic",
    "_digest_sqlite_initial_write_result_intrinsic",
    "_encode_sqlite_initial_write_parameter_payload_intrinsic",
    "_encode_sqlite_initial_write_result_payload_intrinsic",
    "SQLITE_CURSOR_MIGRATION_0002_ASSET_NAME",
    "SQLITE_CURSOR_MIGRATION_0002_ASSET_SHA256",
    "SQLITE_CURSOR_MIGRATION_0002_ASSET_UTF8_BYTES",
    "SQLITE_CURSOR_MIGRATION_0002_FIXED_STATEMENT_COUNT",
    "SQLITE_CURSOR_MIGRATION_0002_PREVIEW_MANIFEST_NAME",
    "SQLITE_CURSOR_MIGRATION_0002_PREVIEW_MANIFEST_SHA256",
    "SQLITE_CURSOR_MIGRATION_0002_PREVIEW_MANIFEST_UTF8_BYTES",
    "SQLITE_CURSOR_MIGRATION_0002_SCHEMA_SQL_SHA256",
    "SQLiteCursorMigration0002Asset",
    "SQLiteCursorMigration0002AssetSnapshot",
    "load_sqlite_cursor_migration_0002_asset",
    "read_sqlite_cursor_migration_0002_asset_snapshot",
    "_load_sqlite_cursor_migration_0002_asset_intrinsic",
    "_read_sqlite_cursor_migration_0002_asset_snapshot_intrinsic",
    "SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_QUERY",
    "SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_QUERY_SHA256",
    "SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_DOMAIN_UTF8",
    "SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_CANONICAL_UTF8_BYTES",
    "SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_ROW_COUNT",
    "SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_INVENTORY",
    "SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_SHA256",
    "SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_APPLICATION_ID",
    "SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_USER_VERSION",
    "SQLITE_CURSOR_PUBLICATION_TARGET_DESCRIPTOR",
    "TargetCatalogCanonicalRow",
    "TargetCatalogSnapshot",
    "SQLiteCursorPublicationTargetCatalogSnapshot",
    "read_validated_target_catalog",
    "snapshot_target_catalog_observation",
    "_read_catalog_rows_from_cursor_intrinsic",
    "_read_metadata_from_cursor_intrinsic",
    "_read_validated_target_catalog_intrinsic",
    "_snapshot_target_catalog_observation_intrinsic",
}
assert forbidden_foundation_root_exports.isdisjoint(vars(graph_engineering))
assert forbidden_foundation_root_exports.isdisjoint(graph_engineering.__all__)

provider_descriptor = create_reference_cycle_store_provider_descriptor()
assert provider_descriptor["descriptorHash"] == (
    "8a0caf1fd5c58a94ae15a627098396a033e7026ead96756ea8e7ad6998b6de4c"
)
provider_record = create_cycle_store_record(
    record_id="artifact-probe",
    sequence=0,
    previous_record_hash=None,
    value={"artifact": "installed"},
)
assert provider_record["recordHash"] == (
    "11b1de69a0a7f5dc96c5e6653ca027733b06c29e0eb1c94ae488adce97e2e060"
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
        reported = subprocess.run(
            [str(graph), "--version"],
            cwd=directory,
            check=True,
            capture_output=True,
            timeout=60,
        ).stdout.decode("utf-8")
        expected_display = display_version(version)
        if reported != f"{expected_display}\n":
            raise SystemExit(
                f"installed {artifact_kind} is labelled {version!r} but its CLI "
                f"reports {reported!r}, expected {expected_display + chr(10)!r}"
            )
        imported = subprocess.run(
            [str(executable), "-I", "-c", IMPORTED_VERSION_PROBE],
            cwd=directory,
            check=True,
            capture_output=True,
            timeout=60,
        ).stdout.decode("utf-8")
        if imported != f"{version}\n":
            raise SystemExit(
                f"installed {artifact_kind} is labelled {version!r} but "
                f"graph_engineering.__version__ is {imported.strip()!r}"
            )
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
            raise SystemExit(
                f"installed graph validate rejected the shared fixture: {validation_data!r}"
            )
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
            or any(
                not isinstance(item, dict) or item.get("status") != "pass"
                for item in checks
            )
        ):
            raise SystemExit(
                f"installed grapheng doctor reported an unhealthy artifact: {doctor_data!r}"
            )

print(
    f"Validated and installed Python wheel and sdist for graph-engineering {version}: "
    f"{len(wheel_names)} wheel entries, {len(names)} sdist entries; entry points, "
    "reported version agreement, shared YAML authoring, validate, and doctor passed."
)
