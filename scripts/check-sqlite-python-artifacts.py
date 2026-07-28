#!/usr/bin/env python3
"""Build and audit SQLite migration assets in isolated Python artifacts.

All generated archives, virtual environments, and installation state live below
one TemporaryDirectory. The source tree is read-only from this checker's point
of view.
"""

from __future__ import annotations

import hashlib
import json
import os
import stat
import subprocess
import sys
import tarfile
import tempfile
import zipfile
from pathlib import Path, PurePosixPath
from shutil import which
from typing import Never

ROOT = Path(__file__).resolve().parents[1]
PYTHON_ROOT = ROOT / "python"
CANONICAL_ROOT = ROOT / "spec" / "migrations" / "sqlite"
PACKAGE_ROOT = PurePosixPath("graph_engineering/_sqlite_migrations")

RELEASE_ASSETS = (
    "schema-v1.sql",
    "0001-alpha-v0-to-v1.sql",
    "manifest.json",
    "schema-v1.identity.json",
)
SUPPORT_ASSETS = (
    "manifest.schema.json",
    "fixtures/alpha-v0.sql",
    "fixtures/alpha-v0.expected.json",
)
EXPECTED_DIGESTS = {
    "manifest": "5f052a21215a39de101d56447fa4b25d20b6053bc558e3960562932e958d7af6",
    "schema_sql": "ddf524d8d0fcdde2a862c168c90698538b9197fa24216f0f249b6ea789c48e1c",
    "identity_document": "4fcbe9872605011356e0655e2b9f9c3210e2bddbb131ddc87f08a93f0a1b9682",
    "schema_identity": "f3d961d4d96e93a7fab13a91b374c27ff877a93332ff7ed7426f1fff982baff4",
    "migration_sql": "a8e9de4d1bae81f8405ef611fca1298bef024ad1df5e905d1d5a9357d1e8cb9c",
}
EXPECTED_ASSET_DIGESTS = {
    "manifest.json": EXPECTED_DIGESTS["manifest"],
    "schema-v1.sql": EXPECTED_DIGESTS["schema_sql"],
    "schema-v1.identity.json": EXPECTED_DIGESTS["identity_document"],
    "0001-alpha-v0-to-v1.sql": EXPECTED_DIGESTS["migration_sql"],
}


def sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def fail(message: str) -> Never:
    raise SystemExit(message)


def safe_archive_path(name: str) -> bool:
    path = PurePosixPath(name)
    return not path.is_absolute() and ".." not in path.parts and "\\" not in name


def canonical_bytes(path: str) -> bytes:
    absolute = CANONICAL_ROOT.joinpath(*PurePosixPath(path).parts)
    if absolute.is_symlink() or not absolute.is_file():
        fail(f"canonical migration asset is not a regular file: {path}")
    value = absolute.read_bytes()
    if not value or len(value) > 262_144:
        fail(f"canonical migration asset is outside size bounds: {path}")
    return value


def run(
    arguments: list[str], *, cwd: Path, timeout: int = 300
) -> subprocess.CompletedProcess[bytes]:
    environment = os.environ.copy()
    environment.pop("PYTHONHOME", None)
    environment.pop("PYTHONPATH", None)
    environment["PYTHONUTF8"] = "1"
    result = subprocess.run(
        arguments,
        cwd=cwd,
        env=environment,
        capture_output=True,
        check=False,
        timeout=timeout,
    )
    if result.returncode != 0:
        fail(
            f"{' '.join(arguments)} exited {result.returncode}; "
            f"stdout={result.stdout!r}, stderr={result.stderr!r}"
        )
    return result


def wheel_asset_bytes(archive: zipfile.ZipFile, path: str) -> bytes:
    archive_path = str(PACKAGE_ROOT / path)
    try:
        return archive.read(archive_path)
    except KeyError:
        fail(f"wheel omits SQLite migration asset {archive_path}")


def sdist_asset_bytes(
    archive: tarfile.TarFile,
    prefix: PurePosixPath,
    path: str,
) -> bytes:
    archive_path = str(prefix / "src" / PACKAGE_ROOT / path)
    try:
        member = archive.getmember(archive_path)
    except KeyError:
        fail(f"sdist omits SQLite migration asset {archive_path}")
    if not member.isfile() or member.issym() or member.islnk():
        fail(f"sdist SQLite migration asset is not a regular file: {archive_path}")
    stream = archive.extractfile(member)
    if stream is None:
        fail(f"sdist SQLite migration asset is unreadable: {archive_path}")
    return stream.read()


def audit_wheel(path: Path) -> int:
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        names = [entry.filename for entry in entries]
        if len(names) != len(set(names)):
            fail("wheel contains duplicate archive paths")
        if not all(safe_archive_path(name) for name in names):
            fail("wheel contains an unsafe archive path")
        if any(stat.S_ISLNK(entry.external_attr >> 16) for entry in entries):
            fail("wheel contains a symbolic link")
        for asset in (*RELEASE_ASSETS, *SUPPORT_ASSETS):
            if wheel_asset_bytes(archive, asset) != canonical_bytes(asset):
                fail(
                    f"wheel SQLite migration asset differs byte-for-byte from spec: {asset}"
                )
        loader_path = "graph_engineering/sqlite_cycle_store.py"
        if loader_path not in names:
            fail(f"wheel omits installed migration loader {loader_path}")
        return len(names)


def audit_sdist(path: Path, version: str) -> int:
    with tarfile.open(path, mode="r:gz") as archive:
        members = archive.getmembers()
        names = [member.name for member in members]
        if len(names) != len(set(names)):
            fail("sdist contains duplicate archive paths")
        if not all(safe_archive_path(name) for name in names):
            fail("sdist contains an unsafe archive path")
        if any(member.issym() or member.islnk() for member in members):
            fail("sdist contains a symbolic or hard link")
        prefix = PurePosixPath(f"graph_engineering-{version}")
        for asset in (*RELEASE_ASSETS, *SUPPORT_ASSETS):
            if sdist_asset_bytes(archive, prefix, asset) != canonical_bytes(asset):
                fail(
                    f"sdist SQLite migration asset differs byte-for-byte from spec: {asset}"
                )
        loader_path = str(prefix / "src/graph_engineering/sqlite_cycle_store.py")
        try:
            loader = archive.getmember(loader_path)
        except KeyError:
            fail(f"sdist omits installed migration loader {loader_path}")
        if not loader.isfile():
            fail(f"sdist migration loader is not a regular file: {loader_path}")
        return len(names)


INSTALLED_PROVIDER_SMOKE = r"""
import asyncio
import hashlib
import json
import sys
from importlib.resources import files
from pathlib import Path
from tempfile import TemporaryDirectory

import graph_engineering
from graph_engineering import (
    SQLITE_CYCLE_STORE_DESCRIPTOR_HASH,
    SQLITE_CYCLE_STORE_PROVIDER_ID,
    SQLITE_MIGRATION_MANIFEST_SHA256,
    SQLiteCycleStoreProvider,
    create_cycle_store_record,
)
from graph_engineering.sqlite_cycle_store import _load_migration_assets

expected = json.loads(sys.argv[1])
assets = _load_migration_assets()
actual = {
    "schema_sql": assets.schema_sql_hash,
    "identity_document": assets.schema_identity_document_hash,
    "schema_identity": assets.schema_identity_hash,
    "migration_sql": assets.migration_sql_hash,
}
if actual != {key: expected[key] for key in actual}:
    raise SystemExit(f"installed migration loader digest mismatch: {actual!r}")

root = files("graph_engineering._sqlite_migrations")
manifest = root.joinpath("manifest.json").read_bytes()
if hashlib.sha256(manifest).hexdigest() != expected["manifest"]:
    raise SystemExit("installed migration loader read a non-canonical manifest")

for path in (
    "schema-v1.sql",
    "0001-alpha-v0-to-v1.sql",
    "manifest.json",
    "schema-v1.identity.json",
    "manifest.schema.json",
    "fixtures/alpha-v0.sql",
    "fixtures/alpha-v0.expected.json",
):
    value = root.joinpath(*path.split("/")).read_bytes()
    if not value:
        raise SystemExit(f"installed migration resource is empty: {path}")

if len(graph_engineering.__all__) != len(set(graph_engineering.__all__)):
    raise SystemExit("installed public __all__ contains duplicates")
expected_public_order = sorted(
    graph_engineering.__all__,
    key=lambda name: (
        0 if name.upper() == name else (1 if name[0].isupper() else 2),
        name,
    ),
)
if graph_engineering.__all__ != expected_public_order:
    raise SystemExit("installed public __all__ is not in exact canonical order")
for name in (
    "SQLITE_CYCLE_STORE_DESCRIPTOR_HASH",
    "SQLITE_CYCLE_STORE_PROVIDER_ID",
    "SQLITE_MIGRATION_MANIFEST_SHA256",
    "SQLiteCycleStoreProvider",
):
    if name not in graph_engineering.__all__ or not hasattr(graph_engineering, name):
        raise SystemExit(f"installed public SQLite export is missing: {name}")
if SQLITE_CYCLE_STORE_PROVIDER_ID != "sqlite-local":
    raise SystemExit("installed SQLite provider id drifted")
if SQLITE_MIGRATION_MANIFEST_SHA256 != expected["manifest"]:
    raise SystemExit("installed SQLite manifest trust anchor drifted")

AUTH = {
    "tenantId": "artifact-tenant",
    "principalHash": "a" * 64,
    "authorizationHash": "b" * 64,
}
MISSING = {"exists": False, "sequence": -1, "recordHash": None}


async def provider_smoke(database_path):
    first = SQLiteCycleStoreProvider(database_path)
    descriptor = await first.describe()
    if descriptor["descriptorHash"] != SQLITE_CYCLE_STORE_DESCRIPTOR_HASH:
        raise SystemExit("installed SQLite descriptor hash drifted")
    record = create_cycle_store_record(
        record_id="artifact-record",
        sequence=0,
        previous_record_hash=None,
        value={"installedArtifact": True},
    )
    appended = await first.append({
        "context": {**AUTH, "operationId": "artifact-append"},
        "streamId": "artifact-stream",
        "expectedTail": MISSING,
        "lease": None,
        "records": [record],
    })
    if appended["tail"]["recordHash"] != record["recordHash"]:
        raise SystemExit("installed SQLite append result drifted")
    await first.close()

    second = SQLiteCycleStoreProvider(database_path)
    tail = await second.read_tail({"context": AUTH, "streamId": "artifact-stream"})
    page = await second.read_event_page({
        "context": AUTH,
        "streamId": "artifact-stream",
        "fromSequence": 0,
        "pageSize": 1,
        "cursor": None,
    })
    await second.close()
    if tail["recordHash"] != record["recordHash"] or page["records"] != [record]:
        raise SystemExit("installed SQLite close/reopen/read result drifted")


cwd_before = sorted(path.name for path in Path.cwd().iterdir())
with TemporaryDirectory(prefix="graph-engineering-installed-sqlite-") as raw:
    workspace = Path(raw)
    database_path = workspace / "cycle-store.db"
    asyncio.run(provider_smoke(database_path))
    if sorted(path.name for path in workspace.iterdir()) != ["cycle-store.db"]:
        raise SystemExit("installed provider leaked WAL, SHM, journal, or backup artifacts")
    if any(
        path.name.endswith(("-wal", "-shm", "-journal", ".backup", ".manifest.json"))
        for path in workspace.rglob("*")
    ):
        raise SystemExit("installed provider leaked a SQLite or backup sidecar")
if workspace.exists():
    raise SystemExit("installed provider smoke database escaped its temporary directory")
if sorted(path.name for path in Path.cwd().iterdir()) != cwd_before:
    raise SystemExit("installed provider smoke leaked files into its working directory")
"""


def isolated_install_smoke(
    uv: str, artifact_kind: str, artifact: Path, root: Path
) -> None:
    virtualenv = root / f"{artifact_kind}-venv"
    run(
        [uv, "venv", "--python", sys.executable, str(virtualenv)], cwd=root, timeout=120
    )
    executable = virtualenv / (
        "Scripts/python.exe" if sys.platform == "win32" else "bin/python"
    )
    run(
        [uv, "pip", "install", "--python", str(executable), str(artifact)],
        cwd=root,
        timeout=300,
    )
    run(
        [
            str(executable),
            "-I",
            "-c",
            INSTALLED_PROVIDER_SMOKE,
            json.dumps(EXPECTED_DIGESTS),
        ],
        cwd=root,
        timeout=60,
    )


def main() -> None:
    uv = which("uv")
    if uv is None:
        fail("uv is required to build and isolate-install Python release artifacts")
    for asset, expected in EXPECTED_ASSET_DIGESTS.items():
        actual = sha256(canonical_bytes(asset))
        if actual != expected:
            fail(
                f"canonical SQLite migration trust anchor drifted for {asset}: "
                f"{actual}, expected {expected}"
            )

    with tempfile.TemporaryDirectory(
        prefix="graph-engineering-sqlite-python-release-"
    ) as raw:
        temporary_root = Path(raw)
        distribution_root = temporary_root / "dist"
        distribution_root.mkdir()
        run(
            [
                uv,
                "build",
                str(PYTHON_ROOT),
                "--out-dir",
                str(distribution_root),
                "--no-create-gitignore",
            ],
            cwd=temporary_root,
            timeout=300,
        )

        wheels = sorted(distribution_root.glob("graph_engineering-*-py3-none-any.whl"))
        sdists = sorted(distribution_root.glob("graph_engineering-*.tar.gz"))
        if len(wheels) != 1 or len(sdists) != 1:
            fail(
                f"expected one wheel and one sdist; found wheels={wheels!r}, sdists={sdists!r}"
            )
        wheel = wheels[0]
        sdist = sdists[0]
        if not 0 < wheel.stat().st_size <= 2_000_000:
            fail("SQLite Python wheel is outside the 2 MB release bound")
        if not 0 < sdist.stat().st_size <= 2_000_000:
            fail("SQLite Python sdist is outside the 2 MB release bound")
        version = sdist.name.removeprefix("graph_engineering-").removesuffix(".tar.gz")

        wheel_entries = audit_wheel(wheel)
        sdist_entries = audit_sdist(sdist, version)
        isolated_install_smoke(uv, "wheel", wheel, temporary_root)
        isolated_install_smoke(uv, "sdist", sdist, temporary_root)

        print(
            json.dumps(
                {
                    "ok": True,
                    "version": version,
                    "releaseAssetCount": len(RELEASE_ASSETS),
                    "supportAssetCount": len(SUPPORT_ASSETS),
                    "wheelEntries": wheel_entries,
                    "sdistEntries": sdist_entries,
                    "installedProviderChecks": 2,
                },
                sort_keys=True,
            )
        )


if __name__ == "__main__":
    main()
