"""Emit truthful real-SQLite and zero-I/O counter-combination evidence."""

from __future__ import annotations

import json
import shutil
import sqlite3
import tempfile
from contextlib import suppress
from pathlib import Path
from typing import Any, cast

import graph_engineering.sqlite_cursor_publication_outer_authority as outer
import graph_engineering.sqlite_cursor_publication_subprotocol as protocol
import graph_engineering.sqlite_cursor_publication_transaction_finalizer as finalizer
import graph_engineering.sqlite_operation_baseline_source as source
import sqlite_cursor_publication_rule11_python_graph as graph_helper
from graph_engineering.sqlite_operation_baseline_source import (
    SQLiteV1BaselineConnectionOwner,
)

SCHEMA_VERSION = "sqlite-cursor-publication-counter-combinations-parity/v1"
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
COUNT_FIELDS = (
    "nativeAffectedCount",
    "changesAffectedCount",
    "totalChangesDelta",
    "cursorLedgerAffectedDelta",
)
FIELD_SLUGS = {
    "nativeAffectedCount": "native",
    "changesAffectedCount": "changes",
    "totalChangesDelta": "total",
    "cursorLedgerAffectedDelta": "cursor-ledger",
}
NONCLAIMS = (
    {
        "caseFamily": "outer-ledger-pair-and-multi-corruption",
        "reason": "outer-ledger-is-private-authority-state-without-a-common-post-t-native-seam",
    },
    {
        "caseFamily": "independent-native-changes-observation-corruption",
        "reason": "runtime-local-native-result-or-changes-proof-injection-is-required",
    },
    {
        "caseFamily": "independent-native-cursor-ledger-corruption",
        "reason": "cursor-ledger-affected-is-captured-from-the-same-native-result",
    },
    {
        "caseFamily": "independent-changes-cursor-ledger-corruption",
        "reason": "runtime-local-state-or-driver-injection-is-required",
    },
    {
        "caseFamily": "driver-native-result-shape-and-throw-combinations",
        "reason": "no-common-driver-native-fault-adapter-is-available",
    },
)


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
    return outer._publish_sqlite_cursor_publication_session_intrinsic(
        prepared,
        outer._observe_sqlite_cursor_publication_session_clock_intrinsic(prepared),
    )


def _safe_integer(value: object, label: str) -> int:
    _invariant(
        type(value) is int and 0 <= value <= 2**53 - 1,
        f"Python {label} is not a non-negative safe integer",
    )
    return value


def _outer_ledger(value: Any, label: str) -> dict[str, int]:
    return {
        "logicalWriteSequence": _safe_integer(
            value.logical_write_sequence, f"{label}.logicalWriteSequence"
        ),
        "fixedStatementCount": _safe_integer(
            value.fixed_statement_count, f"{label}.fixedStatementCount"
        ),
        "affectedRowsWatermark": _safe_integer(
            value.affected_rows_watermark, f"{label}.affectedRowsWatermark"
        ),
    }


def _cursor_ledger(value: Any, label: str) -> dict[str, int]:
    return {
        "logicalWriteSequence": _safe_integer(
            value.logical_write_sequence, f"{label}.logicalWriteSequence"
        ),
        "fixedStatementCount": _safe_integer(
            value.fixed_statement_count, f"{label}.fixedStatementCount"
        ),
        "affectedRowsWatermark": _safe_integer(
            value.affected_rows_watermark, f"{label}.affectedRowsWatermark"
        ),
    }


def _ledger_delta(before: dict[str, int], after: dict[str, int]) -> dict[str, int]:
    return {
        "logicalWriteSequence": after["logicalWriteSequence"]
        - before["logicalWriteSequence"],
        "fixedStatementCount": after["fixedStatementCount"]
        - before["fixedStatementCount"],
        "affectedRowsWatermark": after["affectedRowsWatermark"]
        - before["affectedRowsWatermark"],
    }


def _count_projection(
    b2: object,
    native: object,
    changes: object,
    total: object,
    cursor_ledger: object,
) -> dict[str, int]:
    return {
        "b2CursorCount": _safe_integer(b2, "counts.b2CursorCount"),
        "nativeAffectedCount": _safe_integer(native, "counts.nativeAffectedCount"),
        "changesAffectedCount": _safe_integer(changes, "counts.changesAffectedCount"),
        "totalChangesDelta": _safe_integer(total, "counts.totalChangesDelta"),
        "cursorLedgerAffectedDelta": _safe_integer(
            cursor_ledger, "counts.cursorLedgerAffectedDelta"
        ),
    }


def _evaluate(counts: dict[str, int]) -> tuple[Any, dict[str, object]]:
    result = protocol._check_sqlite_cursor_publication_rule11_counts_intrinsic(
        protocol._Rule11CountProjection(
            counts["b2CursorCount"],
            counts["nativeAffectedCount"],
            counts["changesAffectedCount"],
            counts["totalChangesDelta"],
            counts["cursorLedgerAffectedDelta"],
        )
    )
    return result, {
        "accepted": result.accepted,
        "violationCount": result.violation_count,
        "diagnosticsTruncated": False,
    }


def _authentic_baseline() -> dict[str, object]:
    graph = graph_helper.create_rule11_python_graph(1)
    try:
        session = _publication_session(graph)
        rule11 = protocol._execute_sqlite_cursor_publication_rebind_rule11_intrinsic(
            session
        )
        rule = (
            protocol._read_sqlite_cursor_publication_rule11_receipt_snapshot_intrinsic(
                rule11
            )
        )
        write = protocol._read_sqlite_cursor_publication_rebind_write_receipt_snapshot_intrinsic(
            rule.write_receipt
        )
        execution = (
            source._read_sqlite_connection_cursor_publication_rebind_snapshot_intrinsic(
                graph.connection, write.rebind_execution
            )
        )
        counts = _count_projection(
            write.counts.b2_cursor_count,
            write.counts.native_affected_count,
            write.counts.changes_affected_count,
            write.counts.total_changes_delta,
            write.counts.cursor_ledger_affected_delta,
        )
        outer_before = _outer_ledger(
            write.outer_ledger_before, "baseline.outerLedger.before"
        )
        outer_after = _outer_ledger(
            write.outer_ledger_after, "baseline.outerLedger.after"
        )
        cursor_before = _cursor_ledger(
            execution.cursor_ledger_before, "baseline.cursorLedger.before"
        )
        cursor_after = _cursor_ledger(
            execution.cursor_ledger_after, "baseline.cursorLedger.after"
        )
        checker, checker_projection = _evaluate(counts)
        _invariant(checker.accepted, "Python authentic checker rejected")
        return {
            "caseId": "authentic-success-n1",
            "population": 1,
            "counts": counts,
            "outerLedger": {
                "before": outer_before,
                "after": outer_after,
                "delta": _ledger_delta(outer_before, outer_after),
            },
            "cursorLedger": {
                "before": cursor_before,
                "after": cursor_after,
                "delta": _ledger_delta(cursor_before, cursor_after),
            },
            "checker": checker_projection,
            "lifecycle": {
                "execution": execution.lifecycle,
                "write": write.lifecycle,
                "rule11": "active",
            },
        }
    finally:
        graph.close()


def _create_trigger_graph() -> tuple[graph_helper.Rule11PythonGraph, Path, Path]:
    root = Path(tempfile.mkdtemp(prefix="graph-engineering-counter-combinations-"))
    location = root / "cycle-store.db"
    original_owner = graph_helper.SQLiteV1BaselineConnectionOwner
    original_execute = SQLiteV1BaselineConnectionOwner.execute
    installed = False

    def located_owner(_ignored: str) -> SQLiteV1BaselineConnectionOwner:
        return original_owner(str(location))

    def hooked_execute(
        owner: SQLiteV1BaselineConnectionOwner,
        sql: str,
        parameters: tuple[object, ...] = (),
    ) -> Any:
        nonlocal installed
        result = original_execute(owner, sql, parameters)
        if sql == "BEGIN EXCLUSIVE" and not installed:
            installed = True
            raw = object.__getattribute__(
                owner, "_SQLiteV1BaselineConnectionOwner__connection"
            )
            _invariant(
                type(raw) is sqlite3.Connection,
                "Python trigger graph raw connection is invalid",
            )
            raw.execute(
                "CREATE TEMP TABLE ge_counter_combination_audit "
                "(tenant_id TEXT NOT NULL)"
            ).close()
            raw.execute(
                "CREATE TEMP TRIGGER ge_counter_combination_amplify "
                "AFTER UPDATE ON main.ge_cycle_cursors BEGIN "
                "INSERT INTO ge_counter_combination_audit (tenant_id) "
                "VALUES (NEW.tenant_id); END"
            ).close()
        return result

    graph_helper.SQLiteV1BaselineConnectionOwner = cast(Any, located_owner)
    SQLiteV1BaselineConnectionOwner.execute = hooked_execute
    try:
        return graph_helper.create_rule11_python_graph(1), root, location
    except BaseException:
        shutil.rmtree(root, ignore_errors=False)
        raise
    finally:
        SQLiteV1BaselineConnectionOwner.execute = original_execute
        graph_helper.SQLiteV1BaselineConnectionOwner = original_owner


def _cleanup_terminal_graph(graph: graph_helper.Rule11PythonGraph) -> None:
    with suppress(BaseException):
        graph.stage.dispose()
    with suppress(BaseException):
        if graph.connection.in_transaction:
            graph.connection.rollback()
    with suppress(BaseException):
        graph.connection.close()


def _reopen_recovery(location: Path) -> dict[str, object]:
    reopened = sqlite3.connect(location)
    try:
        cursor_row = reopened.execute(
            "SELECT count(*) FROM main.ge_cycle_cursors"
        ).fetchone()
        operation_row = reopened.execute(
            "SELECT count(*) FROM main.ge_cycle_operations"
        ).fetchone()
        placeholders = ",".join("?" for _ in V2_ARTIFACTS)
        v2_row = reopened.execute(
            f"SELECT count(*) FROM main.sqlite_schema WHERE name IN ({placeholders})",
            V2_ARTIFACTS,
        ).fetchone()
        foreign_key_rows = reopened.execute("PRAGMA foreign_key_check").fetchall()
        integrity_row = reopened.execute("PRAGMA integrity_check").fetchone()
        _invariant(
            type(cursor_row) is tuple
            and len(cursor_row) == 1
            and type(operation_row) is tuple
            and len(operation_row) == 1
            and type(v2_row) is tuple
            and len(v2_row) == 1
            and type(integrity_row) is tuple
            and len(integrity_row) == 1,
            "Python reopen scalar row shape drifted",
        )
        projection = {
            "cursorCount": _safe_integer(cursor_row[0], "reopen.cursorCount"),
            "operationCount": _safe_integer(operation_row[0], "reopen.operationCount"),
            "v2ArtifactCount": _safe_integer(v2_row[0], "reopen.v2ArtifactCount"),
            "foreignKeyViolationCount": _safe_integer(
                len(foreign_key_rows), "reopen.foreignKeyViolationCount"
            ),
            "integrityCheck": integrity_row[0],
        }
        _invariant(
            projection["cursorCount"] == 1 and projection["operationCount"] == 1,
            "Python reopen baseline row counts drifted",
        )
        _invariant(
            projection["v2ArtifactCount"] == 0,
            "Python reopen retained a v2-only artifact",
        )
        _invariant(
            projection["foreignKeyViolationCount"] == 0,
            "Python reopen retained a foreign-key violation",
        )
        _invariant(
            projection["integrityCheck"] == "ok",
            "Python reopen integrity check failed",
        )
        return projection
    finally:
        reopened.close()


def _real_trigger_amplification() -> dict[str, object]:
    graph, root, location = _create_trigger_graph()
    try:
        session = _publication_session(graph)
        owner = finalizer._capture_sqlite_cursor_postconsume_transaction_failure_finalizer_intrinsic(
            graph.connection, graph.authority, session
        )
        primary = finalizer._owner_presentation(owner)[-1]
        prepared = finalizer._read_sqlite_cursor_postconsume_transaction_failure_finalizer_snapshot_intrinsic(
            owner
        )
        authority = (
            outer._read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(
                graph.authority
            )
        )
        _invariant(
            authority.publication_rebind_context is not None,
            "Python trigger graph omitted its context",
        )
        context = (
            outer._read_sqlite_cursor_publication_rebind_context_snapshot_intrinsic(
                authority.publication_rebind_context
            )
        )
        execution = (
            source._read_sqlite_connection_cursor_publication_rebind_snapshot_intrinsic(
                graph.connection, context.execution
            )
        )
        counts = _count_projection(
            context.b2_cursor_count,
            execution.affected_rows,
            execution.changes_affected_rows,
            execution.total_changes_delta,
            execution.cursor_ledger_after.affected_rows_watermark,
        )
        outer_before = _outer_ledger(
            context.historical_outer_ledger, "trigger.outerLedger.before"
        )
        outer_after = _outer_ledger(authority.outer_ledger, "trigger.outerLedger.after")
        cursor_before = _cursor_ledger(
            execution.cursor_ledger_before, "trigger.cursorLedger.before"
        )
        cursor_after = _cursor_ledger(
            execution.cursor_ledger_after, "trigger.cursorLedger.after"
        )
        caught: BaseException | None = None
        try:
            finalizer._finalize_sqlite_cursor_postconsume_transaction_failure_intrinsic(
                owner
            )
        except BaseException as error:  # noqa: BLE001 - exact primary is authoritative
            caught = error
        _invariant(caught is primary, "Python trigger finalizer replaced the primary")
        finalized = finalizer._read_sqlite_cursor_postconsume_transaction_failure_finalizer_snapshot_intrinsic(
            owner
        )
        boundary = prepared.primary_boundary
        _invariant(
            boundary == "serialized-changes-post-query",
            "Python trigger primary boundary drifted",
        )
        return {
            "caseId": "real-trigger-amplification-n1-k1",
            "population": 1,
            "counts": counts,
            "outerLedger": {
                "before": outer_before,
                "after": outer_after,
                "delta": _ledger_delta(outer_before, outer_after),
            },
            "cursorLedger": {
                "before": cursor_before,
                "after": cursor_after,
                "delta": _ledger_delta(cursor_before, cursor_after),
            },
            "disagreementEdges": [
                "nativeAffectedCount!=totalChangesDelta",
                "changesAffectedCount!=totalChangesDelta",
                "totalChangesDelta!=cursorLedgerAffectedDelta",
            ],
            "primaryBoundary": "changes-postflight",
            "lifecycle": {
                "authority": authority.lifecycle,
                "context": context.lifecycle,
                "execution": execution.lifecycle,
                "adoptionMinted": authority.post_rebind_watermark_adoption is not None,
            },
            "finalizer": {
                "primaryPreserved": caught is primary,
                "stateTrace": list(finalized.state_trace),
                "selectedThrow": finalized.diagnostics[0].code,
                "diagnosticCodes": [value.code for value in finalized.diagnostics],
                "rollbackAttemptCount": finalized.rollback_attempt_count,
                "closeAttemptCount": finalized.close_attempt_count,
            },
            "reopenRecovery": _reopen_recovery(location),
        }
    finally:
        _cleanup_terminal_graph(graph)
        shutil.rmtree(root, ignore_errors=False)


def _combinations(
    values: tuple[str, ...], size: int, start: int = 0, prefix: tuple[str, ...] = ()
) -> list[tuple[str, ...]]:
    if len(prefix) == size:
        return [prefix]
    result: list[tuple[str, ...]] = []
    remaining = size - len(prefix)
    for index in range(start, len(values) - remaining + 1):
        result.extend(_combinations(values, size, index + 1, (*prefix, values[index])))
    return result


def _checker_combination_cases(
    authentic: dict[str, int],
) -> list[dict[str, object]]:
    subsets = [
        subset for size in (2, 3, 4) for subset in _combinations(COUNT_FIELDS, size)
    ]
    cases: list[dict[str, object]] = []
    for subset in subsets:
        values = dict(authentic)
        for field in subset:
            values[field] += 1
        result, projection = _evaluate(values)
        _invariant(
            not result.accepted
            and result.violation_count == 1
            and result.diagnostic == "cursor rebind count mismatch",
            f"Python checker accepted {'+'.join(subset)}",
        )
        cases.append(
            {
                "caseId": f"checker-{len(subset)}-way-"
                + "+".join(FIELD_SLUGS[field] for field in subset),
                "corruptedDimensions": list(subset),
                "input": _count_projection(
                    values["b2CursorCount"],
                    values["nativeAffectedCount"],
                    values["changesAffectedCount"],
                    values["totalChangesDelta"],
                    values["cursorLedgerAffectedDelta"],
                ),
                "result": projection,
                "seam": "post-real-sqlite-rule11-pure-checker",
            }
        )
    return cases


def build_report() -> dict[str, object]:
    baseline = _authentic_baseline()
    counts = baseline["counts"]
    _invariant(type(counts) is dict, "Python baseline counts are invalid")
    return {
        "schemaVersion": SCHEMA_VERSION,
        "runtime": "python",
        "authenticBaseline": baseline,
        "realTriggerAmplification": _real_trigger_amplification(),
        "checkerCombinationCases": _checker_combination_cases(counts),
        "nonclaims": list(NONCLAIMS),
        "claims": {
            "realTriggerAmplificationIsNativeObservation": True,
            "checkerInputsDerivedFromAuthenticRealSQLiteEvidence": True,
            "checkerCombinationCasesAreNativeObservations": False,
            "outerLedgerCombinationCoverage": False,
            "runtimeLocalObservationSeamsCovered": False,
        },
    }


def main() -> None:
    print(json.dumps(build_report(), ensure_ascii=False, separators=(",", ":")))


if __name__ == "__main__":
    main()
