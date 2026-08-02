"""Emit deterministic real-SQLite Python Rule 11 parity evidence."""

from __future__ import annotations

import json

import graph_engineering.sqlite_cursor_publication_outer_authority as outer
import graph_engineering.sqlite_cursor_publication_subprotocol as protocol
from sqlite_cursor_publication_rule11_python_graph import (
    Rule11PythonGraph,
    create_rule11_python_graph,
)

SCHEMA_VERSION = "sqlite-cursor-publication-rule11-parity/v1"


def _invariant(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def _publication_session(graph: Rule11PythonGraph) -> object:
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
    sequence = outer._execute_sqlite_cursor_operation_sequence_zero_publication_intrinsic(
        graph.authority,
        graph.migration,
        graph.fence,
        reader,
        entries,
        header,
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


def _project_success(
    cursor_count: int, graph: Rule11PythonGraph, session: object, rule11: object
) -> dict[str, object]:
    rule = protocol._read_sqlite_cursor_publication_rule11_receipt_snapshot_intrinsic(
        rule11
    )
    write_receipt = rule.write_receipt
    write = (
        protocol._read_sqlite_cursor_publication_rebind_write_receipt_snapshot_intrinsic(
            write_receipt
        )
    )
    context = outer._read_sqlite_cursor_publication_rebind_context_snapshot_intrinsic(
        write.context
    )
    tombstone = (
        outer._read_sqlite_cursor_publication_session_consumed_tombstone_snapshot_intrinsic(
            write.consumed_tombstone
        )
    )
    adoption = outer._read_sqlite_cursor_post_rebind_watermark_adoption_snapshot_intrinsic(
        write.post_rebind_adoption
    )
    _invariant(
        write.counts.b2_cursor_count == cursor_count,
        "Python Rule11 parity B2 count drifted",
    )
    authority_state = outer._authority_state(graph.authority)
    session_state = outer._publication_session_state(session)
    _invariant(
        authority_state.lifecycle == "active"
        and authority_state.write_phase == "cursor-rebind-adopted"
        and authority_state.publication_rebind_context is write.context
        and authority_state.publication_session_consumed_tombstone
        is write.consumed_tombstone
        and authority_state.post_rebind_watermark_adoption
        is write.post_rebind_adoption
        and session_state.lifecycle == "consumed-for-rebind"
        and context.session is session
        and tombstone.session is session
        and adoption.session is session,
        "Python Rule11 parity retained lifecycle graph drifted",
    )
    return {
        "caseId": f"success-n{cursor_count}",
        "cursorCount": cursor_count,
        "sql": write.rebind_sql,
        "sqlSha256": write.rebind_sql_sha256,
        "changesSql": write.changes_sql,
        "changesSqlSha256": write.changes_sql_sha256,
        "parameterSha256": write.parameter_sha256,
        "epochDelta": write.transaction_epoch_after
        - write.transaction_epoch_before,
        "totalDelta": write.total_changes_after - write.total_changes_before,
        "counts": {
            "b2CursorCount": write.counts.b2_cursor_count,
            "nativeAffectedCount": write.counts.native_affected_count,
            "changesAffectedCount": write.counts.changes_affected_count,
            "totalChangesDelta": write.counts.total_changes_delta,
            "cursorLedgerAffectedDelta": write.counts.cursor_ledger_affected_delta,
        },
        "cursorLedgerLogicalWriteDelta": rule.cursor_ledger_logical_write_delta,
        "cursorLedgerFixedStatementDelta": rule.cursor_ledger_fixed_statement_delta,
        "outerLedgerUnchanged": write.outer_ledger_before
        == write.outer_ledger_after,
        "sameIdentity": {
            "session": context.session is session and tombstone.session is session,
            "preparedOwner": write.prepared_owner is context.prepared_owner
            and tombstone.prepared_owner is context.prepared_owner,
            "context": write.context is tombstone.context
            and adoption.context is write.context,
            "tombstone": write.consumed_tombstone is adoption.tombstone,
            "adoption": write.post_rebind_adoption is not None,
        },
        "lifecycle": {
            "session": session_state.lifecycle,
            "context": context.lifecycle,
            "tombstone": tombstone.lifecycle,
            "adoption": adoption.lifecycle,
            "write": write.lifecycle,
            "rule11": "active",
        },
        "consumeMint": {
            "writePrepareCount": write.prepare_count,
            "writeExecuteCount": write.execute_count,
            "writeReleaseCount": write.release_count,
            "changesPrepareCount": write.changes_prepare_count,
            "changesFetchCount": write.changes_fetch_count,
            "changesReleaseCount": write.changes_release_count,
            "rule11ViolationCount": rule.violation_count,
            "diagnosticsTruncated": rule.diagnostics_truncated,
        },
    }


def _success_case(cursor_count: int) -> dict[str, object]:
    graph = create_rule11_python_graph(cursor_count)
    try:
        session = _publication_session(graph)
        rule11 = protocol._execute_sqlite_cursor_publication_rebind_rule11_intrinsic(
            session
        )
        return _project_success(cursor_count, graph, session, rule11)
    finally:
        graph.close()


def _pre_cancel_case() -> dict[str, object]:
    graph = create_rule11_python_graph(1)
    try:
        session = _publication_session(graph)
        controller = (
            outer._create_sqlite_cursor_publication_session_cancellation_controller_intrinsic()
        )
        controller.cancel()
        rejected = False
        try:
            protocol._execute_sqlite_cursor_publication_rebind_rule11_intrinsic(
                session, controller.signal
            )
        except ValueError as error:
            rejected = str(error) == "GE_CURSOR_B3_REBIND_CANCELLED"
        _invariant(rejected, "Python Rule11 pre-cancel did not reject canonically")
        authority_before_retry = outer._authority_state(graph.authority)
        session_before_retry = outer._publication_session_state(session)
        _invariant(
            authority_before_retry.lifecycle == "active"
            and authority_before_retry.write_phase == "publication-active"
            and session_before_retry.lifecycle == "publication-active",
            "Python Rule11 pre-cancel mutated or poisoned S",
        )
        retry = protocol._execute_sqlite_cursor_publication_rebind_rule11_intrinsic(
            session
        )
        retry_projection = _project_success(1, graph, session, retry)
        same_session_retry_succeeded = retry_projection["cursorCount"] == 1
        _invariant(
            same_session_retry_succeeded,
            "Python Rule11 pre-cancel same-S retry failed",
        )
        return {
            "caseId": "pre-cancel",
            "outcome": "cancelled-before-prepare",
            "selectedGraphPoisoned": authority_before_retry.lifecycle == "poisoned",
            "sameSessionRetrySucceeded": same_session_retry_succeeded,
        }
    finally:
        graph.close()


def _forged_cancel_case() -> dict[str, object]:
    controller = (
        outer._create_sqlite_cursor_publication_session_cancellation_controller_intrinsic()
    )
    controller.cancel()
    invalid_presentation_won = False
    try:
        protocol._execute_sqlite_cursor_publication_rebind_rule11_intrinsic(
            object(), controller.signal
        )
    except (TypeError, ValueError) as error:
        invalid_presentation_won = str(error) != "GE_CURSOR_B3_REBIND_CANCELLED"
    _invariant(
        invalid_presentation_won,
        "Python Rule11 forged S was masked by cancellation",
    )
    return {
        "caseId": "forged-cancel",
        "outcome": "invalid-session-presentation",
        "invalidPresentationPrecedesCancellation": True,
        "graphSelected": False,
    }


def _replay_poison_case() -> dict[str, object]:
    graph = create_rule11_python_graph(3)
    try:
        session = _publication_session(graph)
        rule11 = protocol._execute_sqlite_cursor_publication_rebind_rule11_intrinsic(
            session
        )
        rule = protocol._read_sqlite_cursor_publication_rule11_receipt_snapshot_intrinsic(
            rule11
        )
        replay_rejected = False
        try:
            protocol._execute_sqlite_cursor_publication_rule11_intrinsic(
                rule.write_receipt
            )
        except ValueError as error:
            replay_rejected = str(error) == "GE_CURSOR_B3_RULE11_REUSE"
        _invariant(replay_rejected, "Python Rule11 replay did not reject")
        receipt_readable_after_poison = True
        try:
            protocol._read_sqlite_cursor_publication_rule11_receipt_snapshot_intrinsic(
                rule11
            )
        except (TypeError, ValueError):
            receipt_readable_after_poison = False
        return {
            "caseId": "replay-poison",
            "outcome": "exact-replay-poisoned",
            "selectedGraphPoisoned": outer._authority_state(
                graph.authority
            ).lifecycle
            == "poisoned",
            "replayRejected": replay_rejected,
            "receiptReadableAfterPoison": receipt_readable_after_poison,
        }
    finally:
        graph.close()


def build_report() -> dict[str, object]:
    return {
        "schemaVersion": SCHEMA_VERSION,
        "runtime": "python",
        "successes": [_success_case(value) for value in (0, 1, 3)],
        "failures": [
            _pre_cancel_case(),
            _forged_cancel_case(),
            _replay_poison_case(),
        ],
    }


def main() -> None:
    print(json.dumps(build_report(), ensure_ascii=False, separators=(",", ":")))


if __name__ == "__main__":
    main()
