from __future__ import annotations

import ast
import hashlib
import json
from pathlib import Path

import pytest

from graph_engineering.sqlite_native_callsite_classification import (
    classify_sqlite_native_python_callsites,
)
from tests.sqlite_native_callsite_classification_report import build_report

HOSTILE_SOURCE = '''
import sqlite3

class GuardedConnection:
    def __init__(self, connection: sqlite3.Connection) -> None:
        self.connection = connection

    def execute(self, sql: str) -> sqlite3.Cursor:
        return self.connection.execute(sql)

class TaskRunner:
    def execute(self, value: str) -> str:
        return value

class MixedRunner:
    def helper(self, connection: sqlite3.Connection) -> sqlite3.Connection:
        return connection

    def execute(self, value: str) -> str:
        return value

GUARD_EXECUTE = GuardedConnection.execute
CURSOR_EXECUTE = sqlite3.Cursor.execute

def make_connection() -> sqlite3.Connection:
    return sqlite3.connect(":memory:")

def classify(
    connection: sqlite3.Connection,
    guard: GuardedConnection,
    task: TaskRunner,
    mixed: MixedRunner,
    mystery_cursor: object,
) -> None:
    connection.execute("SELECT 1")
    alias = connection
    alias.execute("SELECT 2")
    cursor = connection.cursor()
    cursor.execute("SELECT 3")
    guard.execute("SELECT 4")
    GUARD_EXECUTE(guard, "SELECT 5")
    task.execute("not SQL")
    mixed.execute("also not SQL")
    factory_connection = make_connection()
    factory_connection.execute("SELECT 6")
    db = mystery_cursor
    db.execute("SELECT 7")
    CURSOR_EXECUTE(mystery_cursor, "SELECT 8")
'''.lstrip()


def _calls(source: str) -> dict[str, ast.Call]:
    result: dict[str, ast.Call] = {}
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Call):
            rendered = ast.unparse(node)
            if rendered in result:
                raise AssertionError(f"hostile call is not unique: {rendered}")
            result[rendered] = node
    return result


def _candidate(call: ast.Call, method: str, *, path: str = "sample.py") -> dict[str, object]:
    return {
        "language": "python",
        "path": path,
        "line": call.lineno,
        "column": call.col_offset + 1,
        "method": method,
        "methodAlias": isinstance(call.func, ast.Name),
        "receiverKind": "database",
        "receiverConfidence": "heuristic",
        "sqlOrigin": "none" if method == "cursor" else "direct-argument",
        "sqlEvidence": {
            "status": "absent" if method == "cursor" else "exact",
            "shape": "absent" if method == "cursor" else "literal",
            "sha256": None,
            "token": None if method == "cursor" else "SELECT",
        },
    }


def _hostile_candidates() -> list[dict[str, object]]:
    calls = _calls(HOSTILE_SOURCE)
    selected = (
        ("connection.execute('SELECT 1')", "execute"),
        ("alias.execute('SELECT 2')", "execute"),
        ("connection.cursor()", "cursor"),
        ("cursor.execute('SELECT 3')", "execute"),
        ("guard.execute('SELECT 4')", "execute"),
        ("GUARD_EXECUTE(guard, 'SELECT 5')", "execute"),
        ("task.execute('not SQL')", "execute"),
        ("mixed.execute('also not SQL')", "execute"),
        ("factory_connection.execute('SELECT 6')", "execute"),
        ("db.execute('SELECT 7')", "execute"),
        ("CURSOR_EXECUTE(mystery_cursor, 'SELECT 8')", "execute"),
    )
    return [_candidate(calls[rendered], method) for rendered, method in selected]


def test_structural_provenance_partitions_native_wrapper_false_positive_and_unknown(
    tmp_path: Path,
) -> None:
    (tmp_path / "sample.py").write_text(HOSTILE_SOURCE, encoding="utf-8")
    candidates = _hostile_candidates()
    candidates.append(
        {
            "language": "typescript",
            "path": "sample.ts",
            "line": 1,
            "column": 1,
            "method": "execute",
            "receiverKind": "database",
            "receiverConfidence": "proven",
            "sqlOrigin": "direct-argument",
            "sqlEvidence": {"status": "exact", "shape": "literal"},
        }
    )
    report = classify_sqlite_native_python_callsites({"callsites": candidates}, tmp_path)
    portable = report.to_json_object()

    assert portable["summary"] == {
        "inputPythonCandidateCount": 11,
        "classifiedCandidateCount": 11,
        "categoryCounts": {
            "confirmed-native-receiver": 4,
            "wrapper-guard-or-test-like-production-probe": 2,
            "false-positive": 0,
            "unknown": 5,
        },
        "unknownCount": 5,
    }
    assert portable["classificationPolicy"] == {
        "routeAuthorization": False,
        "routeClosureClaimed": False,
        "nameHeuristicsCanConfirmNativeReceiver": False,
        "crossFunctionReturnInference": False,
        "unknownCandidatesDropped": False,
    }


def test_order_duplicates_and_unmapped_candidates_are_preserved_deterministically(
    tmp_path: Path,
) -> None:
    (tmp_path / "sample.py").write_text(HOSTILE_SOURCE, encoding="utf-8")
    candidates = _hostile_candidates()
    duplicate = dict(candidates[-2])
    unmapped = dict(candidates[-2])
    unmapped["line"] = 1
    unmapped["column"] = 1
    first = classify_sqlite_native_python_callsites(
        {"callsites": [*reversed(candidates), duplicate, unmapped]}, tmp_path
    ).to_json_object()
    second = classify_sqlite_native_python_callsites(
        {"callsites": [unmapped, duplicate, *candidates]}, tmp_path
    ).to_json_object()

    assert first == second
    assert first["summary"] == {
        "inputPythonCandidateCount": 13,
        "classifiedCandidateCount": 13,
        "categoryCounts": {
            "confirmed-native-receiver": 4,
            "wrapper-guard-or-test-like-production-probe": 2,
            "false-positive": 0,
            "unknown": 7,
        },
        "unknownCount": 7,
    }
    output_candidates = first["candidates"]
    assert isinstance(output_candidates, list)
    assert len({candidate["candidateId"] for candidate in output_candidates}) == 13
    duplicate_rows = [
        candidate
        for candidate in output_candidates
        if candidate["identity"]["line"] == duplicate["line"]
        and candidate["identity"]["column"] == duplicate["column"]
    ]
    assert [candidate["identity"]["occurrence"] for candidate in duplicate_rows] == [0, 1]


def test_scanner_confidence_and_cross_function_return_annotation_never_upgrade_names(
    tmp_path: Path,
) -> None:
    (tmp_path / "sample.py").write_text(HOSTILE_SOURCE, encoding="utf-8")
    calls = _calls(HOSTILE_SOURCE)
    targets = {
        "factory_connection.execute('SELECT 6')",
        "db.execute('SELECT 7')",
        "CURSOR_EXECUTE(mystery_cursor, 'SELECT 8')",
    }
    selected = []
    for rendered in targets:
        method = "execute"
        candidate = _candidate(calls[rendered], method)
        candidate["receiverConfidence"] = "proven"
        candidate["receiverKind"] = "database"
        selected.append(candidate)
    report = classify_sqlite_native_python_callsites({"callsites": selected}, tmp_path)

    assert {candidate.category for candidate in report.candidates} == {"unknown"}
    assert len(report.candidates) == 3


@pytest.mark.parametrize(
    "candidate",
    [
        {"language": "python"},
        {
            "language": "python",
            "path": "../escape.py",
            "line": 1,
            "column": 1,
            "method": "execute",
            "receiverKind": "unknown",
            "receiverConfidence": "unknown",
            "sqlOrigin": "direct-argument",
            "sqlEvidence": {"status": "unknown", "shape": "expression"},
        },
    ],
)
def test_malformed_or_escaping_candidates_fail_closed(
    tmp_path: Path, candidate: dict[str, object]
) -> None:
    with pytest.raises(ValueError):
        classify_sqlite_native_python_callsites({"callsites": [candidate]}, tmp_path)


@pytest.mark.parametrize("path", ["./sample.py", "sub/../sample.py", "sub\\sample.py"])
def test_noncanonical_source_aliases_fail_closed(tmp_path: Path, path: str) -> None:
    (tmp_path / "sample.py").write_text(HOSTILE_SOURCE, encoding="utf-8")
    candidate = _hostile_candidates()[0]
    candidate["path"] = path
    with pytest.raises(ValueError, match=r"repository-relative|canonical"):
        classify_sqlite_native_python_callsites({"callsites": [candidate]}, tmp_path)


def test_unicode_candidate_id_hashes_canonical_utf8_json(tmp_path: Path) -> None:
    unicode_path = "ä.py"
    (tmp_path / unicode_path).write_text(HOSTILE_SOURCE, encoding="utf-8")
    candidate = _hostile_candidates()[0]
    candidate["path"] = unicode_path
    report = classify_sqlite_native_python_callsites(
        {"callsites": [candidate]},
        tmp_path,
    )
    identity = report.candidates[0].identity
    canonical = json.dumps(
        {
            "path": identity.path,
            "line": identity.line,
            "column": identity.column,
            "method": identity.method,
            "sqlOrigin": identity.sql_origin,
            "occurrence": identity.occurrence,
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode()
    assert report.candidates[0].candidate_id == hashlib.sha256(canonical).hexdigest()


def test_repository_report_classifies_all_251_candidates_and_is_deterministic() -> None:
    first = build_report()
    second = build_report()

    assert json.dumps(first, separators=(",", ":")) == json.dumps(
        second, separators=(",", ":")
    )
    assert first["summary"] == {
        "inputPythonCandidateCount": 251,
        "classifiedCandidateCount": 251,
        "categoryCounts": {
            "confirmed-native-receiver": 187,
            "wrapper-guard-or-test-like-production-probe": 31,
            "false-positive": 0,
            "unknown": 33,
        },
        "unknownCount": 33,
    }
    assert first["sourceScannerPolicy"] == {
        "routeClosureClaimed": False,
        "classificationConsumesReadOnlyJson": True,
    }
