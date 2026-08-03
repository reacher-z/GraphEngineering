"""Emit real-SQLite P9 transaction-owner portable parity evidence."""

from __future__ import annotations

import json
import sqlite3
import sys
import tempfile
from collections.abc import Callable
from pathlib import Path
from typing import Any, cast

PYTHON_ROOT = Path(__file__).resolve().parents[1]
if str(PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(PYTHON_ROOT))

import graph_engineering.sqlite_cursor_publication_transaction_owner as transaction  # noqa: E402
from graph_engineering.sqlite_operation_baseline_source import (  # noqa: E402
    SQLiteV1BaselineConnectionOwner,
)
from tests.test_sqlite_operation_baseline_source import (  # noqa: E402
    database as source_v1_database,
)

CONTRACT_ID = "sqlite-cursor-publication-transaction-owner-v1"
CONTRACT_SHA256 = "e900c0d822a31690c6cd4ef8d160d1cc4474bf4c605471d1aac899d4b293b303"
ABSENT_PREPARED_PATHS = frozenset(
    {
        "prepared-statement-containing-transaction-control",
        "already-prepared-permanent-DML-after-pre-retirement",
        "already-prepared-permanent-DDL-after-pre-retirement",
    }
)


def _source_v1(path: Path) -> SQLiteV1BaselineConnectionOwner:
    memory = source_v1_database()
    target = SQLiteV1BaselineConnectionOwner(str(path))
    memory_raw = cast(
        sqlite3.Connection,
        object.__getattribute__(memory, "_SQLiteV1BaselineConnectionOwner__connection"),
    )
    target_raw = cast(
        sqlite3.Connection,
        object.__getattribute__(target, "_SQLiteV1BaselineConnectionOwner__connection"),
    )
    memory_raw.backup(target_raw)
    memory.close()
    return target


def _active(
    path: Path,
) -> tuple[
    SQLiteV1BaselineConnectionOwner,
    transaction._SQLiteCursorPublicationTransactionOwner,
    transaction._SQLiteCursorPublicationBeginReceipt,
]:
    connection = _source_v1(path)
    owner = transaction._register_sqlite_cursor_publication_transaction_owner_intrinsic(
        connection
    )
    receipt = transaction._begin_sqlite_cursor_publication_transaction_intrinsic(owner)
    return connection, owner, receipt


def _finalize(
    owner: transaction._SQLiteCursorPublicationTransactionOwner,
) -> tuple[
    transaction._SQLiteCursorPublicationAuthenticatedFailure,
    BaseException,
]:
    primary = transaction._select_sqlite_cursor_publication_authenticated_failure_intrinsic(
        owner
    )
    raised: BaseException | None = None
    try:
        transaction._finalize_sqlite_cursor_publication_transaction_failure_intrinsic(
            owner, primary
        )
    except BaseException as error:
        raised = error
    if raised is not primary:
        raise AssertionError("Python transaction owner did not preserve its exact primary")
    return primary, raised


def _begin_case(root: Path) -> dict[str, object]:
    connection = _source_v1(root / "begin.sqlite")
    owner = transaction._register_sqlite_cursor_publication_transaction_owner_intrinsic(
        connection
    )
    registered = transaction._read_sqlite_cursor_publication_transaction_owner_snapshot_intrinsic(
        owner
    )
    receipt = transaction._begin_sqlite_cursor_publication_transaction_intrinsic(owner)
    active = transaction._read_sqlite_cursor_publication_transaction_owner_snapshot_intrinsic(owner)
    receipt_snapshot = (
        transaction._read_sqlite_cursor_publication_begin_receipt_snapshot_intrinsic(
            owner, receipt
        )
    )
    report = {
        "caseId": "begin-returned-active",
        "registrationCount": active.registration_count,
        "provisionalGenerationMintCount": active.provisional_generation_mint_count,
        "provisionalGenerationPromotionCount": active.provisional_generation_promotion_count,
        "provisionalGenerationTombstoneCount": active.provisional_generation_tombstone_count,
        "beginAttemptCount": active.begin_attempt_count,
        "beginNativeReturnCount": active.begin_native_return_count,
        "beginReceiptMintCount": active.begin_receipt_mint_count,
        "runtimeTransactionControlCount": active.runtime_transaction_control_count,
        "ioCounts": [1, 0, 0, 0, 0],
        "receiptFacts": {
            "exactOwner": receipt_snapshot.exact_owner,
            "exactConnection": receipt_snapshot.exact_connection,
            "exactTransactionLineage": receipt_snapshot.exact_lineage,
            "exactProvisionalGeneration": receipt_snapshot.exact_generation,
            "exclusiveMode": receipt_snapshot.exclusive_mode,
            "beginAttempt": receipt_snapshot.begin_attempt_count,
        },
        "transactionEpochDelta": active.transaction_epoch - registered.transaction_epoch,
        "totalChangesDelta": active.total_changes - registered.total_changes,
        "tempMutationEpochDelta": (
            active.temp_mutation_epoch - registered.temp_mutation_epoch
        ),
        "registeredBeforeBeginIo": registered.begin_attempt_count == 0,
        "commitAttemptCount": active.commit_attempt_count,
        "terminalClassification": "active",
    }
    _finalize(owner)
    return report


def _cleanup_case(root: Path) -> dict[str, object]:
    _connection, owner, receipt = _active(root / "cleanup.sqlite")
    receipt_snapshot = (
        transaction._read_sqlite_cursor_publication_begin_receipt_snapshot_intrinsic(
            owner, receipt
        )
    )
    primary, raised = _finalize(owner)
    terminal = transaction._read_sqlite_cursor_publication_transaction_owner_snapshot_intrinsic(
        owner
    )
    receipt_fields = (
        "_SQLiteCursorPublicationBeginReceipt__owner",
        "_SQLiteCursorPublicationBeginReceipt__connection",
        "_SQLiteCursorPublicationBeginReceipt__lineage",
        "_SQLiteCursorPublicationBeginReceipt__generation",
        "_SQLiteCursorPublicationBeginReceipt__mode",
    )
    owner_fields = (
        "_SQLiteCursorPublicationTransactionOwner__connection",
        "_SQLiteCursorPublicationTransactionOwner__lineage",
        "_SQLiteCursorPublicationTransactionOwner__generation",
        "_SQLiteCursorPublicationTransactionOwner__receipt",
        "_SQLiteCursorPublicationTransactionOwner__primary",
        "_SQLiteCursorPublicationTransactionOwner__source_fingerprint",
    )
    terminal_graph_cleared = (
        not terminal.exact_generation_active
        and not terminal.exact_lineage_selected
        and all(object.__getattribute__(receipt, field) is None for field in receipt_fields)
        and all(object.__getattribute__(owner, field) is None for field in owner_fields)
        and object.__getattribute__(
            primary, "_SQLiteCursorPublicationAuthenticatedFailure__owner"
        )
        is None
    )
    return {
        "caseId": "active-authenticated-failure-cleanup",
        "ioCounts": [1, 0, terminal.rollback_attempt_count, terminal.close_attempt_count,
                     terminal.reopen_attempt_count],
        "nativeReturnCounts": [terminal.begin_native_return_count, 0,
                               terminal.rollback_native_return_count,
                               terminal.close_native_return_count,
                               terminal.reopen_source_v1_count],
        "ownershipCounts": [1, 0],
        "exactPrimaryRethrown": raised is primary,
        "receiptWasExactBeforeCleanup": all(receipt_snapshot[:5]),
        "terminalGraphCleared": terminal_graph_cleared,
        "runtimeTransactionControlCount": terminal.runtime_transaction_control_count,
        "commitAttemptCount": terminal.commit_attempt_count,
        "terminalClassification": (
            "source-v1" if terminal.reopen_source_v1_count == 1 else "unavailable-unresolved"
        ),
    }


def _commit_disabled_case(root: Path) -> dict[str, object]:
    connection, owner, _receipt = _active(root / "commit-disabled.sqlite")
    before = (
        connection.transaction_epoch,
        connection.total_changes,
        connection.temp_mutation_epoch,
    )
    error: BaseException | None = None
    try:
        transaction._commit_sqlite_cursor_publication_transaction_intrinsic(owner, object())
    except BaseException as caught:
        error = caught
    after = transaction._read_sqlite_cursor_publication_transaction_owner_snapshot_intrinsic(owner)
    report = {
        "caseId": "commit-hard-disabled",
        "semanticOutcome": "commit-hard-disabled",
        "rejectedBeforeNativeIo": isinstance(error, ValueError),
        "commitAttemptCount": after.commit_attempt_count,
        "runtimeTransactionControlCount": after.runtime_transaction_control_count,
        "transactionEpochDelta": connection.transaction_epoch - before[0],
        "totalChangesDelta": connection.total_changes - before[1],
        "tempMutationEpochDelta": connection.temp_mutation_epoch - before[2],
    }
    _finalize(owner)
    return report


def _guard_evidence(root: Path) -> list[dict[str, object]]:
    connection = _source_v1(root / "guards.sqlite")
    owner = transaction._register_sqlite_cursor_publication_transaction_owner_intrinsic(
        connection
    )

    def reject(call: Callable[..., Any], *arguments: object) -> None:
        before = (
            connection.transaction_epoch,
            connection.total_changes,
            connection.temp_mutation_epoch,
        )
        try:
            call(*arguments)
        except ValueError:
            pass
        else:
            raise AssertionError("Python guard route reached native SQLite")
        after = (
            connection.transaction_epoch,
            connection.total_changes,
            connection.temp_mutation_epoch,
        )
        if after != before:
            raise AssertionError("Python guard rejection changed an observable counter")

    reject(connection.execute, "BEGIN EXCLUSIVE")
    transaction._begin_sqlite_cursor_publication_transaction_intrinsic(owner)
    actions: dict[int, tuple[Callable[..., Any], tuple[object, ...]]] = {
        0: (connection.commit, ()),
        1: (connection.rollback, ()),
        2: (connection.execute, ("END",)),
        3: (connection.execute, ("ROLLBACK",)),
        5: (connection.execute, ("RELEASE hostile",)),
        6: (connection.execute, ("SELECT 1; COMMIT",)),
        8: (connection.executescript, ("SELECT 1; COMMIT;",)),
        9: (connection.execute, ("BEGIN EXCLUSIVE",)),
        10: (connection.close, ()),
        11: (connection.execute, ("UPDATE ge_cycle_schema SET current_version=2",)),
        13: (connection.execute, ("CREATE TABLE hostile(value INTEGER)",)),
        15: (connection.execute, ("PRAGMA user_version=2",)),
        16: (connection.execute, ("REINDEX",)),
        17: (connection.execute, ("DETACH hostile",)),
        18: (connection.execute, ("WITH value AS (SELECT 1) SELECT * FROM value",)),
    }
    for index in sorted(actions):
        call, arguments = actions[index]
        reject(call, *arguments)

    cursor = connection.execute("SELECT 1")
    absent = {
        7: not hasattr(connection, "prepare"),
        12: not hasattr(cursor, "execute"),
        14: not hasattr(cursor, "executemany"),
    }
    cursor.close()
    if not all(absent.values()):
        raise AssertionError("Python unexpectedly exposed a prepared-handle bypass")
    snapshot = transaction._read_sqlite_cursor_publication_transaction_owner_snapshot_intrinsic(
        owner
    )
    evidence: list[dict[str, object]] = []
    for index, path in enumerate(transaction.GUARDED_TRANSACTION_CONTROL_PATHS):
        expected_absent = path in ABSENT_PREPARED_PATHS
        count = snapshot.guard_rejection_counts[index]
        if (count == 0) != expected_absent:
            raise AssertionError(f"Python guard capability evidence drifted at {path}")
        evidence.append(
            {
                "path": path,
                "evidence": "structurally-absent" if expected_absent else "runtime-rejected",
                "guardRejectCount": count,
            }
        )
    _finalize(owner)
    return evidence


def _portable_guard_inventory() -> list[dict[str, object]]:
    return [
        {
            "path": path,
            "portableGuarantee": "no-native-io-bypass",
            "nativeIoBypassPossible": False,
        }
        for path in transaction.GUARDED_TRANSACTION_CONTROL_PATHS
    ]


def build_report() -> dict[str, object]:
    with tempfile.TemporaryDirectory(prefix="graph-engineering-p9-python-") as temporary:
        root = Path(temporary)
        cases = [_begin_case(root), _cleanup_case(root), _commit_disabled_case(root)]
        local_evidence = _guard_evidence(root)
    return {
        "schemaVersion": 1,
        "contractId": CONTRACT_ID,
        "contractFixtureCanonicalSha256": CONTRACT_SHA256,
        "cases": cases,
        "guardInventory": _portable_guard_inventory(),
        "claims": {
            "ownerRegistration": True,
            "preIoProvisionalGeneration": True,
            "guardedBeginReturnedExactActive": True,
            "commonGuardNoNativeIo": True,
            "authenticatedReturnedFailureCleanup": True,
            "commitHardDisabled": True,
            "driverNativeBeginThrow": False,
            "driverNativeRollbackThrow": False,
            "driverNativeCloseThrow": False,
            "commitRuntime": False,
            "successPath": False,
            "completeV2Classifier": False,
            "publicApi": False,
            "releaseGate": False,
        },
        "nonclaims": [
            "driver-native-begin-throw",
            "driver-native-rollback-throw",
            "driver-native-close-throw",
            "runtime-commit-execution",
            "success-path",
            "complete-v2-reopen-classifier",
            "package-root-public-api",
            "release-gate",
        ],
        "runtimeLocalCapabilityEvidence": {
            "runtime": "python",
            "guardCapabilities": local_evidence,
        },
    }


if __name__ == "__main__":
    print(json.dumps(build_report(), ensure_ascii=False, separators=(",", ":")))
