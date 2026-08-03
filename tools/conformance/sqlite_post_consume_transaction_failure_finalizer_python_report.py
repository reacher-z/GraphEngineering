"""Emit deterministic real-SQLite post-consume finalizer parity evidence."""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import sqlite3
import tempfile
from contextlib import suppress
from pathlib import Path
from typing import Any, cast

import graph_engineering.sqlite_cursor_publication_outer_authority as outer
import graph_engineering.sqlite_cursor_publication_subprotocol as protocol
import graph_engineering.sqlite_cursor_publication_transaction_finalizer as finalizer
import sqlite_cursor_publication_rule11_python_graph as graph_helper
from graph_engineering.canonical import canonical_bytes, canonical_sha256
from graph_engineering.sqlite_operation_baseline_source import (
    SQLiteV1BaselineConnectionOwner,
)

SCHEMA_VERSION = "sqlite-post-consume-transaction-failure-finalizer-parity/v1"
BASELINE_DATA_DOMAIN = (
    b"graph-engineering/sqlite-post-consume-transaction-failure-finalizer-"
    b"baseline-data/v1\0"
)
V1_CATALOG_SHA256 = "8fab5049e2c9de5d114abc0c682934f1bc6fb5abd2e4c2e3ae55ef329c3e7264"
V2_ARTIFACTS = (
    "ge_cycle_operation_baseline_entries",
    "ge_cycle_operation_baseline_entries_hash_uq",
    "ge_cycle_operation_baseline_entries_key_uq",
    "ge_cycle_operation_baselines",
    "ge_cycle_operation_sequence",
    "ge_cycle_operations_replay_idx",
    "ge_cycle_operations_sequence_uq",
    "ge_cycle_operations_v1",
    "ge_cycle_schema_v1",
)
CURSOR_COLUMNS = (
    "tenant_id",
    "token_hash",
    "kind",
    "principal_hash",
    "authorization_hash",
    "stream_id",
    "checkpoint_scope",
    "request_scope_blob",
    "page_size",
    "next_position",
    "snapshot_tail_sequence",
    "snapshot_tail_record_hash",
    "descriptor_hash",
    "schema_identity_sha256",
    "snapshot_blob",
    "created_at_ms",
    "expires_at_ms",
    "consumed_at_ms",
)
OPERATION_COLUMNS = (
    "tenant_id",
    "operation_id",
    "operation_name",
    "request_hash",
    "result_blob",
    "result_hash",
    "committed_at_ms",
)
CASES = (
    ("both", True, True),
    ("rollback-only", True, False),
    ("close-only", False, True),
)
CLAIMS = {
    "cleanupNeverReplacesPrimary": True,
    "driverNativeRollbackThrow": False,
    "driverNativeCloseThrow": False,
    "ownsBegin": False,
    "ownsCommit": False,
    "ownsRule12": False,
    "ownsSuccessPath": False,
}


class RollbackFault(BaseException):
    """Weak-referenceable deterministic rollback fault sentinel."""


class CloseFault(BaseException):
    """Weak-referenceable deterministic close fault sentinel."""


def _invariant(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def _publication_session(graph: graph_helper.Rule11PythonGraph) -> object:
    reader = outer._mint_sqlite_cursor_post_ddl_publication_reader_lease_intrinsic(
        graph.authority, graph.migration, graph.fence
    )
    outer._execute_sqlite_cursor_post_ddl_publication_reader_intrinsic(
        graph.authority, graph.migration, graph.fence, reader
    )
    entries = outer._execute_sqlite_cursor_baseline_entries_publication_intrinsic(
        graph.authority, graph.migration, graph.fence, reader
    )
    header = outer._execute_sqlite_cursor_baseline_header_publication_intrinsic(
        graph.authority, graph.migration, graph.fence, reader, entries
    )
    sequence = (
        outer._execute_sqlite_cursor_operation_sequence_zero_publication_intrinsic(
            graph.authority,
            graph.migration,
            graph.fence,
            reader,
            entries,
            header,
        )
    )
    adoption = outer._adopt_sqlite_cursor_initial_publication_stage_intrinsic(
        graph.authority,
        (graph.migration, entries, header, sequence),
        graph.fence,
        reader,
    )
    prepared = outer._prepare_sqlite_cursor_publication_session_intrinsic(
        graph.authority, adoption
    )
    evidence = outer._observe_sqlite_cursor_publication_session_clock_intrinsic(
        prepared
    )
    return outer._publish_sqlite_cursor_publication_session_intrinsic(
        prepared, evidence
    )


def _failure_graph(location: Path) -> graph_helper.Rule11PythonGraph:
    original_owner = graph_helper.SQLiteV1BaselineConnectionOwner
    original_execute = SQLiteV1BaselineConnectionOwner.execute

    def located_owner(_ignored: str) -> SQLiteV1BaselineConnectionOwner:
        return original_owner(str(location))

    def hooked_execute(
        owner: SQLiteV1BaselineConnectionOwner,
        sql: str,
        parameters: tuple[object, ...] = (),
    ) -> Any:
        result = original_execute(owner, sql, parameters)
        if sql == "BEGIN EXCLUSIVE":
            raw = cast(
                sqlite3.Connection,
                object.__getattribute__(
                    owner, "_SQLiteV1BaselineConnectionOwner__connection"
                ),
            )
            raw.execute(
                "CREATE TEMP TRIGGER ge_finalizer_parity_abort "
                "BEFORE UPDATE ON main.ge_cycle_cursors BEGIN "
                "SELECT RAISE(ABORT, 'finalizer parity abort'); END"
            ).close()
        return result

    graph_helper.SQLiteV1BaselineConnectionOwner = cast(Any, located_owner)
    SQLiteV1BaselineConnectionOwner.execute = hooked_execute
    try:
        return graph_helper.create_rule11_python_graph(1)
    finally:
        SQLiteV1BaselineConnectionOwner.execute = original_execute
        graph_helper.SQLiteV1BaselineConnectionOwner = original_owner


def _diagnostic_projection(diagnostic: Any) -> dict[str, object]:
    return {
        "code": diagnostic.code,
        "operation": diagnostic.operation,
        "rank": diagnostic.rank,
        "origin": diagnostic.origin,
    }


def _portable_cell(value: object, label: str) -> dict[str, object]:
    if value is None:
        return {"type": "null"}
    if type(value) is int:
        _invariant(
            -(2**53) + 1 <= value <= 2**53 - 1,
            f"Python {label} is not a portable safe integer",
        )
        return {"type": "integer", "value": value}
    if type(value) is str:
        return {"type": "text", "value": value}
    _invariant(type(value) is bytes, f"Python {label} has a non-portable SQLite type")
    return {"type": "blob", "lowerHex": cast(bytes, value).hex()}


def _table_projection(
    connection: sqlite3.Connection,
    table_name: str,
    columns: tuple[str, ...],
    order_by: str,
) -> dict[str, object]:
    rows = connection.execute(
        f"SELECT {', '.join(columns)} FROM {table_name} ORDER BY {order_by}"
    ).fetchall()
    portable_rows: list[list[dict[str, object]]] = []
    for row_index, row in enumerate(rows):
        _invariant(
            type(row) is tuple and len(row) == len(columns),
            f"Python {table_name}[{row_index}] row shape drifted",
        )
        portable_rows.append(
            [
                _portable_cell(value, f"{table_name}[{row_index}].{columns[index]}")
                for index, value in enumerate(row)
            ]
        )
    return {"columns": list(columns), "name": table_name, "rows": portable_rows}


def _baseline_data_sha256(connection: sqlite3.Connection) -> str:
    projection = {
        "formatVersion": 1,
        "tables": [
            _table_projection(
                connection,
                "ge_cycle_cursors",
                CURSOR_COLUMNS,
                "tenant_id COLLATE BINARY, token_hash COLLATE BINARY",
            ),
            _table_projection(
                connection,
                "ge_cycle_operations",
                OPERATION_COLUMNS,
                "tenant_id COLLATE BINARY, operation_id COLLATE BINARY",
            ),
        ],
    }
    digest = hashlib.sha256()
    digest.update(BASELINE_DATA_DOMAIN)
    digest.update(canonical_bytes(projection))
    return digest.hexdigest()


def _catalog_sha256(connection: sqlite3.Connection) -> str:
    catalog: list[dict[str, str]] = []
    rows = connection.execute(
        "SELECT type, name, tbl_name, sql FROM sqlite_schema "
        "WHERE name GLOB 'ge_cycle_*' AND type IN ('table', 'index') "
        "AND sql IS NOT NULL ORDER BY type, name"
    ).fetchall()
    for index, row in enumerate(rows):
        _invariant(
            type(row) is tuple
            and len(row) == 4
            and all(type(value) is str for value in row),
            f"Python catalog[{index}] contains an invalid value",
        )
        row_type, name, table_name, sql = cast(tuple[str, str, str, str], row)
        catalog.append(
            {
                "type": row_type,
                "name": name,
                "tableName": table_name,
                "sql": re.sub(r"\s+", " ", sql).strip(),
            }
        )
    return canonical_sha256(catalog)


def _exact_scalar(connection: sqlite3.Connection, sql: str, label: str) -> object:
    row = connection.execute(sql).fetchone()
    _invariant(
        type(row) is tuple and len(row) == 1,
        f"Python {label} scalar shape drifted",
    )
    return row[0]


def _reopen_recovery(location: Path) -> dict[str, object]:
    reopened = sqlite3.connect(location)
    try:
        application_id = _exact_scalar(
            reopened, "PRAGMA application_id", "application id"
        )
        user_version = _exact_scalar(reopened, "PRAGMA user_version", "user version")
        schema = reopened.execute(
            "SELECT current_version, schema_identity_sha256 "
            "FROM ge_cycle_schema WHERE singleton = 1"
        ).fetchone()
        _invariant(
            type(schema) is tuple
            and len(schema) == 2
            and type(schema[0]) is int
            and type(schema[1]) is str,
            "Python schema singleton shape drifted",
        )
        cursor_count = _exact_scalar(
            reopened, "SELECT count(*) FROM ge_cycle_cursors", "cursor count"
        )
        operation_count = _exact_scalar(
            reopened, "SELECT count(*) FROM ge_cycle_operations", "operation count"
        )
        placeholders = ",".join("?" for _ in V2_ARTIFACTS)
        v2_artifact_row = reopened.execute(
            f"SELECT count(*) FROM sqlite_schema WHERE name IN ({placeholders})",
            V2_ARTIFACTS,
        ).fetchone()
        _invariant(
            type(v2_artifact_row) is tuple
            and len(v2_artifact_row) == 1
            and type(v2_artifact_row[0]) is int,
            "Python v2 artifact count shape drifted",
        )
        foreign_key_violations = reopened.execute("PRAGMA foreign_key_check").fetchall()
        integrity = _exact_scalar(reopened, "PRAGMA integrity_check", "integrity check")
        catalog_sha256 = _catalog_sha256(reopened)
        evidence: dict[str, object] = {
            "applicationId": application_id,
            "userVersion": user_version,
            "currentVersion": schema[0],
            "schemaIdentitySha256": schema[1],
            "catalogSha256": catalog_sha256,
            "cursorCount": cursor_count,
            "operationCount": operation_count,
            "v2ArtifactCount": v2_artifact_row[0],
            "foreignKeyViolationCount": len(foreign_key_violations),
            "integrityCheck": integrity,
            "baselineDataDomain": BASELINE_DATA_DOMAIN.decode("utf-8"),
            "baselineDataSha256": _baseline_data_sha256(reopened),
        }
        _invariant(application_id == 1_195_724_359, "Python application id drifted")
        _invariant(
            user_version == 1 and schema[0] == 1,
            "Python reopen did not return to v1",
        )
        _invariant(
            schema[1]
            == "f3d961d4d96e93a7fab13a91b374c27ff877a93332ff7ed7426f1fff982baff4",
            "Python reopen schema identity drifted",
        )
        _invariant(
            catalog_sha256 == V1_CATALOG_SHA256,
            "Python reopen catalog does not match the trusted v1 digest",
        )
        _invariant(
            cursor_count == 1 and operation_count == 1,
            "Python reopen baseline row counts drifted",
        )
        _invariant(v2_artifact_row[0] == 0, "Python reopen retained a v2 artifact")
        _invariant(
            not foreign_key_violations,
            "Python reopen retained a foreign-key violation",
        )
        _invariant(integrity == "ok", "Python reopen integrity check failed")
        return evidence
    finally:
        reopened.close()


def _failure_case(
    case_id: str, rollback_fault: bool, close_fault: bool
) -> dict[str, object]:
    root = Path(tempfile.mkdtemp(prefix="graph-engineering-finalizer-python-parity-"))
    location = root / "cycle-store.db"
    graph: graph_helper.Rule11PythonGraph | None = None
    try:
        graph = _failure_graph(location)
        session = _publication_session(graph)
        owner = finalizer._capture_sqlite_cursor_postconsume_transaction_failure_finalizer_intrinsic(
            graph.connection, graph.authority, session
        )
        primary = finalizer._owner_presentation(owner)[-1]
        rollback_error = RollbackFault("rollback-after-return")
        close_error = CloseFault("close-after-return")
        if rollback_fault:
            finalizer._arm_sqlite_cursor_postconsume_after_native_return_fault_for_test_intrinsic(
                owner, "rollback", rollback_error
            )
        if close_fault:
            finalizer._arm_sqlite_cursor_postconsume_after_native_return_fault_for_test_intrinsic(
                owner, "close", close_error
            )
        caught: BaseException | None = None
        try:
            finalizer._finalize_sqlite_cursor_postconsume_transaction_failure_intrinsic(
                owner
            )
        except BaseException as error:  # noqa: BLE001 - exact primary may be non-Exception
            caught = error
        _invariant(
            caught is primary,
            f"Python {case_id} cleanup replaced the exact leaf primary",
        )
        snapshot = finalizer._read_sqlite_cursor_postconsume_transaction_failure_finalizer_snapshot_intrinsic(
            owner
        )
        authority = (
            outer._read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(
                graph.authority
            )
        )
        diagnostics = [_diagnostic_projection(value) for value in snapshot.diagnostics]
        return {
            "caseId": case_id,
            "stateTrace": list(snapshot.state_trace),
            "counts": {
                "ownerConsumeCount": snapshot.owner_consume_count,
                "terminalizeCount": snapshot.terminalize_count,
                "rollbackAttemptCount": snapshot.rollback_attempt_count,
                "rollbackNativeReturnCount": snapshot.rollback_native_return_count,
                "rollbackAfterNativeReturnFaultCount": snapshot.rollback_after_native_return_ambiguous_fault_count,
                "rollbackSecondaryFailureCount": snapshot.rollback_secondary_failure_count,
                "closeAttemptCount": snapshot.close_attempt_count,
                "closeNativeReturnCount": snapshot.close_native_return_count,
                "closeAfterNativeReturnFaultCount": snapshot.close_after_native_return_ambiguous_fault_count,
                "closeTertiaryFailureCount": snapshot.close_tertiary_failure_count,
            },
            "selectedThrow": diagnostics[0]["code"],
            "diagnosticCodes": [value["code"] for value in diagnostics],
            "diagnostics": diagnostics,
            "claims": CLAIMS,
            "reopenRecovery": _reopen_recovery(location),
            "oldGraphPoisoned": authority.lifecycle == "poisoned"
            and authority.write_phase == "poisoned",
            "freshGraphSuccess": True,
        }
    finally:
        if graph is not None:
            with suppress(BaseException):
                cast(Any, graph.stage).dispose()
            with suppress(BaseException):
                if graph.connection.in_transaction:
                    graph.connection.rollback()
            with suppress(BaseException):
                graph.connection.close()
        shutil.rmtree(root, ignore_errors=False)


def _prove_fresh_graph_success() -> bool:
    graph = graph_helper.create_rule11_python_graph(1)
    try:
        session = _publication_session(graph)
        receipt = protocol._execute_sqlite_cursor_publication_rebind_rule11_intrinsic(
            session
        )
        snapshot = (
            protocol._read_sqlite_cursor_publication_rule11_receipt_snapshot_intrinsic(
                receipt
            )
        )
        authority = (
            outer._read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(
                graph.authority
            )
        )
        _invariant(snapshot.violation_count == 0, "Python fresh graph had a violation")
        _invariant(
            authority.lifecycle == "active"
            and authority.write_phase == "cursor-rebind-adopted",
            "Python fresh graph did not reach cursor-rebind-adopted",
        )
        return True
    finally:
        graph.close()


def build_report() -> dict[str, object]:
    cases = [_failure_case(*entry) for entry in CASES]
    _invariant(_prove_fresh_graph_success(), "Python fresh graph proof failed")
    return {
        "schemaVersion": SCHEMA_VERSION,
        "runtime": "python",
        "cases": cases,
    }


def main() -> None:
    print(json.dumps(build_report(), ensure_ascii=False, separators=(",", ":")))


if __name__ == "__main__":
    main()
