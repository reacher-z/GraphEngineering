#!/usr/bin/env python3
"""Audit built Python artifacts without extracting untrusted archive paths."""

from __future__ import annotations

import email
import re
import tarfile
import tomllib
import zipfile
from pathlib import Path, PurePosixPath


ROOT = Path(__file__).resolve().parents[1]
PYTHON_ROOT = ROOT / "python"
DIST = PYTHON_ROOT / "dist"
FORBIDDEN = re.compile(
    r"(?:^|/)(?:__pycache__|\.pytest_cache|\.mypy_cache|\.ruff_cache|codex_logs|codex_plans)(?:/|$)|\.pyc$|(?:^|/)\.env(?:\.|$)"
)


def safe_archive_path(name: str) -> bool:
    path = PurePosixPath(name)
    return not path.is_absolute() and ".." not in path.parts and not FORBIDDEN.search(name)


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
        "graph_engineering/py.typed",
        "graph_engineering/scheduler.py",
        "graph_engineering/persistence/__init__.py",
        "graph_engineering/primitives/__init__.py",
    }
    missing = required_wheel.difference(wheel_names)
    if missing:
        raise SystemExit(f"wheel omits public runtime files: {sorted(missing)!r}")
    if any("/tests/" in f"/{name}" for name in wheel_names):
        raise SystemExit("wheel unexpectedly contains tests")
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
        f"{prefix}src/graph_engineering/canonical.py",
        f"{prefix}src/graph_engineering/py.typed",
        f"{prefix}src/graph_engineering/scheduler.py",
        f"{prefix}src/graph_engineering/persistence/event_store.py",
        f"{prefix}src/graph_engineering/primitives/barrier.py",
    }
    missing = required_sdist.difference(names)
    if missing:
        raise SystemExit(f"sdist omits source/package files: {sorted(missing)!r}")
    if any(name.startswith(f"{prefix}tests/") for name in names):
        raise SystemExit("sdist unexpectedly contains repository tests that require external fixtures")

print(
    f"Validated Python wheel and sdist for graph-engineering {version}: "
    f"{len(wheel_names)} wheel entries, {len(names)} sdist entries."
)
