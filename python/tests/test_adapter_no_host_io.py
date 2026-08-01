"""Mechanical proof that this runtime performs no network and no subprocess I/O.

The check has two halves.  The static half parses every shipped source file
under ``python/src/graph_engineering`` and every adapter test, and fails if any
of them imports a module that could reach the network or a child process, or
names ``asyncio.open_connection``.  The runtime half traps those same entry
points — by blocking their import and by replacing the functions of the modules
already loaded — while all three adapters run a full call.

It is a hard failure, not a warning.
"""

from __future__ import annotations

import ast
import asyncio
import importlib.abc
import importlib.machinery
import os
import socket
import subprocess
import sys
import urllib.request
from collections.abc import Iterator, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest

from graph_engineering.adapters import (
    HttpResponse,
    MockOutcome,
    create_http_adapter,
    create_mock_adapter,
    create_shell_adapter,
)
from tests.adapter_corpus import budget_policy_metrics, descriptor_for, request_from

SOURCE_ROOT = Path(__file__).resolve().parents[1] / "src" / "graph_engineering"
TEST_ROOT = Path(__file__).resolve().parent

#: Every module a Python process could reach the network or a process through.
FORBIDDEN_MODULES = (
    "subprocess",
    "socket",
    "socketserver",
    "ssl",
    "http",
    "urllib",
    "ftplib",
    "smtplib",
    "telnetlib",
    "xmlrpc",
    "requests",
    "httpx",
    "aiohttp",
    "urllib3",
    "websockets",
    "multiprocessing",
    "pty",
    "asyncio.subprocess",
)

#: Attribute paths that reach the host without an import of their own.
FORBIDDEN_ATTRIBUTES = (
    "asyncio.open_connection",
    "asyncio.start_server",
    "asyncio.create_subprocess_exec",
    "asyncio.create_subprocess_shell",
    "os.system",
    "os.popen",
    "os.execv",
    "os.spawnv",
    "os.posix_spawn",
    "os.fork",
)

#: There is no wall clock in this contract: the corpus injects ``nowMs`` and the
#: retry schedule is integer arithmetic.  A clock or a randomness source inside
#: the adapter package would make two runtimes disagree.
FORBIDDEN_NONDETERMINISM = (
    "time",
    "datetime",
    "random",
    "secrets",
    "uuid",
    "os",
)

GATEWAY = {
    "op": "replace",
    "path": "/target",
    "value": {
        "scheme": "https",
        "host": "gateway.invalid",
        "port": 443,
        "redirected": False,
        "reauthorized": False,
    },
}


@dataclass(frozen=True, slots=True)
class ScannedFile:
    path: Path
    source: str
    tree: ast.Module

    @property
    def label(self) -> str:
        return str(self.path)


def _scan(root: Path, names: Sequence[str] | None = None) -> list[ScannedFile]:
    files: list[ScannedFile] = []
    for path in sorted(root.rglob("*.py")):
        if "__pycache__" in path.parts:
            continue
        if names is not None and path.name not in names:
            continue
        source = path.read_text(encoding="utf-8")
        files.append(ScannedFile(path=path, source=source, tree=ast.parse(source)))
    return files


SHIPPED = _scan(SOURCE_ROOT)
#: This module is the trap itself: it must import the very facilities it
#: forbids in order to replace them.  It is test scaffolding, never shipped.
TRAP_FILE = Path(__file__).name
ADAPTER_TESTS = _scan(
    TEST_ROOT,
    [p.name for p in TEST_ROOT.glob("*adapter*.py") if p.name != TRAP_FILE],
)
EVERYTHING = [*SHIPPED, *ADAPTER_TESTS]


def _imported_roots(scanned: ScannedFile) -> set[str]:
    roots: set[str] = set()
    for node in ast.walk(scanned.tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                roots.add(alias.name)
                roots.add(alias.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom):
            if node.level != 0 or node.module is None:
                continue
            roots.add(node.module)
            roots.add(node.module.split(".")[0])
            for alias in node.names:
                roots.add(f"{node.module}.{alias.name}")
    return roots


def _attribute_paths(scanned: ScannedFile) -> set[str]:
    paths: set[str] = set()
    for node in ast.walk(scanned.tree):
        if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name):
            paths.add(f"{node.value.id}.{node.attr}")
    return paths


#: Parsed once: every scan below is a lookup, not a re-walk.
IMPORT_ROOTS = {file.label: _imported_roots(file) for file in EVERYTHING}
ATTRIBUTE_PATHS = {file.label: _attribute_paths(file) for file in SHIPPED}


# ---------------------------------------------------------------------------
# Static proof
# ---------------------------------------------------------------------------


def test_the_scan_covers_a_non_empty_set_of_files() -> None:
    assert len(SHIPPED) > 70
    assert len(ADAPTER_TESTS) >= 5
    assert any(file.path.parent.name == "adapters" for file in SHIPPED)
    assert TRAP_FILE not in {file.path.name for file in ADAPTER_TESTS}


@pytest.mark.parametrize("module", FORBIDDEN_MODULES)
def test_no_shipped_source_or_adapter_test_imports(module: str) -> None:
    offenders = [label for label, roots in IMPORT_ROOTS.items() if module in roots]
    assert offenders == []


@pytest.mark.parametrize("attribute", FORBIDDEN_ATTRIBUTES)
def test_no_shipped_source_names_a_host_reaching_attribute(attribute: str) -> None:
    offenders = [label for label, paths in ATTRIBUTE_PATHS.items() if attribute in paths]
    assert offenders == []


@pytest.mark.parametrize("module", FORBIDDEN_NONDETERMINISM)
def test_the_adapter_package_reads_no_clock_and_no_randomness(module: str) -> None:
    offenders = [
        file.label
        for file in SHIPPED
        if file.path.parent.name == "adapters" and module in IMPORT_ROOTS[file.label]
    ]
    assert offenders == []


def test_the_adapter_package_imports_only_asyncio_and_re_from_the_standard_library() -> None:
    package = [file for file in SHIPPED if file.path.parent.name == "adapters"]
    assert package
    standard: set[str] = set()
    for file in package:
        for node in ast.walk(file.tree):
            if isinstance(node, ast.Import):
                standard.update(alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module is not None:
                standard.add(node.module)
    assert standard - {"__future__", "collections.abc", "dataclasses", "itertools", "typing"} == {
        "asyncio",
        "re",
    }


def test_the_only_asyncio_surface_the_package_uses_is_a_yield_and_a_cancellation() -> None:
    package = [file for file in SHIPPED if file.path.parent.name == "adapters"]
    used = {
        path.split(".", 1)[1]
        for file in package
        for path in ATTRIBUTE_PATHS[file.label]
        if path.startswith("asyncio.")
    }
    assert used == {"sleep", "CancelledError"}


def test_the_adapter_package_names_no_absolute_url_and_no_routable_host() -> None:
    package = [file for file in SHIPPED if file.path.parent.name == "adapters"]
    assert package
    for file in package:
        for scheme in ("http://", "https://"):
            index = file.source.find(scheme)
            while index != -1:
                rest = file.source[index + len(scheme) :]
                host = rest.split("/")[0].split(":")[0].split('"')[0].split("'")[0]
                assert (
                    host == "localhost"
                    or host.endswith((".invalid", ".test"))
                    or host.endswith("json-schema.org")
                    or host.endswith("github.io")
                ), f"{file.label} names {host!r}"
                index = file.source.find(scheme, index + 1)


# ---------------------------------------------------------------------------
# Runtime proof
# ---------------------------------------------------------------------------


class _Breach(RuntimeError):
    """Raised the instant anything reaches for the host."""


class _BlockingFinder(importlib.abc.MetaPathFinder):
    """Refuse to import a forbidden module while the trap is armed."""

    def __init__(self, blocked: frozenset[str], breaches: list[str]) -> None:
        self._blocked = blocked
        self._breaches = breaches

    def find_spec(
        self,
        fullname: str,
        path: object = None,
        target: object = None,
    ) -> importlib.machinery.ModuleSpec | None:
        root = fullname.split(".")[0]
        if fullname in self._blocked or root in self._blocked:
            self._breaches.append(f"import {fullname}")
            raise _Breach(f"the package imported {fullname}")
        return None


def _trap(monkeypatch: pytest.MonkeyPatch, breaches: list[str]) -> None:
    """Arm every host entry point.

    ``socket.socket`` itself is deliberately left constructible: the asyncio
    event loop builds a local self-pipe out of a socket pair, and breaking that
    would prove nothing about egress.  What is trapped is every way a socket can
    reach an address, plus every process launcher.
    """

    def refuse(name: str) -> Any:
        def guard(*args: object, **kwargs: object) -> Any:
            breaches.append(name)
            raise _Breach(f"the package reached {name}")

        return guard

    monkeypatch.setattr(socket.socket, "connect", refuse("socket.connect"), raising=False)
    monkeypatch.setattr(socket.socket, "connect_ex", refuse("socket.connect_ex"), raising=False)
    monkeypatch.setattr(socket.socket, "sendto", refuse("socket.sendto"), raising=False)
    monkeypatch.setattr(socket, "create_connection", refuse("socket.create_connection"))
    monkeypatch.setattr(socket, "getaddrinfo", refuse("socket.getaddrinfo"))
    monkeypatch.setattr(socket, "gethostbyname", refuse("socket.gethostbyname"))
    monkeypatch.setattr(subprocess, "Popen", refuse("subprocess.Popen"))
    monkeypatch.setattr(subprocess, "run", refuse("subprocess.run"))
    monkeypatch.setattr(urllib.request, "urlopen", refuse("urllib.request.urlopen"))
    monkeypatch.setattr(asyncio, "open_connection", refuse("asyncio.open_connection"))
    monkeypatch.setattr(
        asyncio, "create_subprocess_exec", refuse("asyncio.create_subprocess_exec")
    )
    monkeypatch.setattr(os, "system", refuse("os.system"))
    monkeypatch.setattr(os, "posix_spawn", refuse("os.posix_spawn"), raising=False)
    blocked = frozenset({"requests", "httpx", "aiohttp", "urllib3", "pty", "telnetlib"})
    finder = _BlockingFinder(blocked, breaches)
    monkeypatch.setattr(sys, "meta_path", [finder, *sys.meta_path])


@pytest.fixture
def trapped(monkeypatch: pytest.MonkeyPatch) -> Iterator[list[str]]:
    breaches: list[str] = []
    _trap(monkeypatch, breaches)
    yield breaches


def test_no_host_io_while_all_three_adapters_run_a_full_call(trapped: list[str]) -> None:
    metrics = budget_policy_metrics()

    mock = create_mock_adapter(
        descriptor_for("mock-full"),
        budget_policy_allowed_provider_metrics=metrics,
        script=(MockOutcome(text="deterministic"),),
    )
    mock_outcome = asyncio.run(mock.call(request_from()))
    assert mock_outcome.ok
    assert mock_outcome.value.text == "deterministic"

    transport_calls = 0

    async def fake(url: str, init: object) -> HttpResponse:
        nonlocal transport_calls
        transport_calls += 1
        return HttpResponse(status=200, headers={}, body="ok")

    http = create_http_adapter(descriptor_for("http-mock"), transport=fake)
    http_outcome = asyncio.run(http.call(request_from([GATEWAY])))
    assert http_outcome.ok
    assert transport_calls == 1

    shell = create_shell_adapter(descriptor_for("shell-mock"))
    shell_outcome = asyncio.run(shell.call(request_from()))
    assert not shell_outcome.ok
    assert shell_outcome.error.code == "GE_ADAPTER_POLICY_DENIED"

    assert trapped == []


def test_the_trap_itself_is_armed(trapped: list[str]) -> None:
    """A negative control: the guard must actually fire when something reaches."""
    with pytest.raises(_Breach):
        socket.getaddrinfo("gateway.invalid", 443)
    with pytest.raises(_Breach):
        socket.create_connection(("gateway.invalid", 443))
    with pytest.raises(_Breach):
        socket.socket().connect(("gateway.invalid", 443))
    with pytest.raises(_Breach):
        subprocess.run(["/usr/bin/ge-mock-tool"])
    with pytest.raises(_Breach):
        urllib.request.urlopen("https://gateway.invalid/")
    with pytest.raises(_Breach):
        __import__("httpx")
    assert trapped == [
        "socket.getaddrinfo",
        "socket.create_connection",
        "socket.connect",
        "subprocess.run",
        "urllib.request.urlopen",
        "import httpx",
    ]


def test_a_failing_and_a_streaming_path_reach_no_host_either(trapped: list[str]) -> None:
    mock = create_mock_adapter(
        descriptor_for("mock-full"),
        budget_policy_allowed_provider_metrics=budget_policy_metrics(),
        script=(MockOutcome(fail="GE_ADAPTER_TIMEOUT"),),
    )
    failure = asyncio.run(mock.call(request_from()))
    assert not failure.ok

    streaming = create_mock_adapter(
        descriptor_for("mock-full"),
        budget_policy_allowed_provider_metrics=budget_policy_metrics(),
    )
    stream = asyncio.run(
        streaming.stream(request_from([{"op": "replace", "path": "/streaming", "value": True}]))
    )
    assert stream.outcome.ok
    assert stream.frames

    async def failing(url: str, init: object) -> HttpResponse:
        raise RuntimeError("the injected transport refused")

    http = create_http_adapter(descriptor_for("http-mock"), transport=failing)
    outcome = asyncio.run(http.call(request_from([GATEWAY])))
    assert not outcome.ok
    assert outcome.error.code == "GE_ADAPTER_TRANSPORT_FAILURE"

    assert trapped == []
