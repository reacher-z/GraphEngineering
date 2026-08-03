"""Emit deterministic zero-I/O P11-A cross-runtime parity evidence."""

from __future__ import annotations

import json
import sqlite3
import sys
import tempfile
from pathlib import Path
from typing import Any, cast

PYTHON_ROOT = Path(__file__).resolve().parents[1]
if str(PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(PYTHON_ROOT))

import graph_engineering.sqlite_cursor_publication_owner_composition as composition  # noqa: E402
import graph_engineering.sqlite_cursor_publication_transaction_owner as transaction  # noqa: E402
from graph_engineering.sqlite_operation_baseline_source import (  # noqa: E402
    SQLiteV1BaselineConnectionOwner,
)
from tests.test_sqlite_operation_baseline_source import (  # noqa: E402
    database as source_v1_database,
)

REPORT_VERSION = "sqlite-cursor-publication-owner-composition-p11-parity/v1"
ABSTRACT_RESOURCE_KIND = "abstract-python-cursor-release"


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
    transaction._SQLiteCursorPublicationTransactionOwner,
    transaction._SQLiteCursorPublicationBeginReceipt,
]:
    connection = _source_v1(path)
    owner = transaction._register_sqlite_cursor_publication_transaction_owner_intrinsic(
        connection
    )
    receipt = transaction._begin_sqlite_cursor_publication_transaction_intrinsic(owner)
    return owner, receipt


def _finalize_success(
    owner: transaction._SQLiteCursorPublicationTransactionOwner,
) -> None:
    primary = RuntimeError("P11 parity success-case bounded cleanup")
    capture = transaction._capture_sqlite_cursor_publication_transaction_failure_intrinsic(
        owner, primary
    )
    raised: BaseException | None = None
    try:
        transaction._finalize_sqlite_cursor_publication_transaction_failure_capture_intrinsic(
            owner, capture
        )
    except BaseException as error:
        raised = error
    if raised is not primary:
        raise AssertionError("Python P11 parity cleanup replaced its exact primary")


def _mutation_case(
    root: Path,
    case_id: str,
    descriptor: composition._SQLiteCursorPublicationMutationRouteDescriptor,
    expected_count: int,
) -> dict[str, object]:
    owner, receipt = _active(root / f"{case_id}.sqlite")
    graph = composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(
        owner, receipt
    )
    parent = composition._issue_sqlite_cursor_publication_mutation_parent_scope_intrinsic(
        graph, descriptor, expected_count
    )
    if descriptor.model == "parent-owned-reusable":
        composition._prepare_sqlite_cursor_publication_reusable_parent_intrinsic(parent)
    child_lifecycles: list[str] = []
    if expected_count == 0:
        composition._accept_sqlite_cursor_publication_mutation_zero_item_postflight_intrinsic(
            parent
        )
    else:
        for ordinal in range(expected_count):
            child = composition._issue_sqlite_cursor_publication_mutation_child_permit_intrinsic(
                parent, ordinal
            )
            composition._enter_sqlite_cursor_publication_mutation_child_permit_intrinsic(child)
            composition._record_sqlite_cursor_publication_mutation_child_return_intrinsic(child)
            composition._retire_sqlite_cursor_publication_mutation_child_resource_intrinsic(child)
            composition._accept_sqlite_cursor_publication_mutation_child_postflight_intrinsic(
                child
            )
            composition._consume_sqlite_cursor_publication_mutation_child_permit_intrinsic(child)
            child_snapshot = (
                composition._read_sqlite_cursor_publication_mutation_child_permit_snapshot_intrinsic(
                    child
                )
            )
            if child_snapshot.actual_native_io_count != 0 or child_snapshot.sql_authority:
                raise AssertionError("Python P11 mutation child widened zero-I/O authority")
            child_lifecycles.append(child_snapshot.lifecycle)
    if descriptor.model == "parent-owned-reusable":
        composition._retire_sqlite_cursor_publication_reusable_parent_resource_intrinsic(parent)
    composition._consume_sqlite_cursor_publication_mutation_parent_scope_intrinsic(parent)
    snapshot = (
        composition._read_sqlite_cursor_publication_mutation_parent_scope_snapshot_intrinsic(
            parent
        )
    )
    if (
        snapshot.lifecycle != "parent-consumed"
        or snapshot.actual_native_io_count != 0
        or snapshot.sql_authority
        or child_lifecycles != ["child-consumed"] * expected_count
    ):
        raise AssertionError("Python P11 mutation graph cannot be normalized")
    report = {
        "caseId": case_id,
        "status": "success",
        "kind": "mutation",
        "route": {
            "routeId": snapshot.route_id,
            "model": snapshot.model,
            "bindingKind": snapshot.binding_kind,
            "bindingSha256": snapshot.binding_sha256,
        },
        "lifecycle": snapshot.lifecycle,
        "expectedCount": snapshot.expected_count,
        "nextOrdinal": snapshot.next_ordinal,
        "childCounts": [
            snapshot.child_issued_count,
            snapshot.child_entered_count,
            snapshot.child_native_return_count,
            snapshot.child_resource_retired_count,
            snapshot.child_postflight_accepted_count,
            snapshot.child_consumed_count,
        ],
        "childLifecycles": child_lifecycles,
        "reusableCounts": [
            snapshot.reusable_parent_prepare_count,
            snapshot.reusable_execution_lease_released_count,
            snapshot.parent_resource_retired_count,
        ],
        "actualNativeIoCount": 0,
        "sqlAuthority": False,
        "routeClosure": False,
        "stage18Accepted": False,
        "commitAttemptCount": 0,
        "dynamicCountProvenance": False,
    }
    _finalize_success(owner)
    return report


def _fixed_read_case(
    root: Path,
    case_id: str,
    route_index: int,
    maximum_rows: int,
) -> tuple[dict[str, object], dict[str, object]]:
    owner, receipt = _active(root / f"{case_id}.sqlite")
    graph = composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(
        owner, receipt
    )
    permit = composition._issue_sqlite_cursor_publication_fixed_read_permit_intrinsic(
        graph,
        composition._SQLITE_CURSOR_PUBLICATION_P11_FIXED_READ_ROUTES[route_index],
        maximum_rows,
    )
    composition._prepare_sqlite_cursor_publication_fixed_read_permit_intrinsic(permit)
    composition._begin_sqlite_cursor_publication_fixed_read_intrinsic(permit)
    for _row in range(maximum_rows):
        composition._observe_sqlite_cursor_publication_fixed_read_row_intrinsic(permit)
    composition._observe_sqlite_cursor_publication_fixed_read_terminal_intrinsic(permit)
    composition._retire_sqlite_cursor_publication_fixed_read_resource_intrinsic(
        permit, ABSTRACT_RESOURCE_KIND
    )
    composition._consume_sqlite_cursor_publication_fixed_read_permit_intrinsic(permit)
    snapshot = composition._read_sqlite_cursor_publication_fixed_read_permit_snapshot_intrinsic(
        permit
    )
    if (
        snapshot.lifecycle != "consumed"
        or snapshot.actual_native_io_count != 0
        or snapshot.sql_authority
        or snapshot.native_cursor_close_attempt_count != 0
        or snapshot.native_cursor_close_return_count != 0
    ):
        raise AssertionError("Python P11 fixed-read graph cannot be normalized")
    report = {
        "caseId": case_id,
        "status": "success",
        "kind": "fixed-read",
        "route": {
            "routeId": snapshot.route_id,
            "family": snapshot.family,
            "sqlSha256": snapshot.sql_sha256,
        },
        "lifecycle": snapshot.lifecycle,
        "maximumRows": snapshot.maximum_rows,
        "observedRows": snapshot.observed_rows,
        "maximumCursors": snapshot.maximum_cursors,
        "prepareCount": snapshot.prepare_count,
        "terminalRowObserved": snapshot.terminal_row_observed,
        "resourceRetired": snapshot.resource_retired,
        "consumeCount": snapshot.consume_count,
        "nativeCursorCloseCounts": [
            snapshot.native_cursor_close_attempt_count,
            snapshot.native_cursor_close_return_count,
        ],
        "mutationDelta": snapshot.mutation_delta,
        "actualNativeIoCount": snapshot.actual_native_io_count,
        "sqlAuthority": snapshot.sql_authority,
        "routeClosure": False,
        "stage18Accepted": False,
        "commitAttemptCount": 0,
        "dynamicCountProvenance": False,
    }
    runtime_local: dict[str, object] = {
        "caseId": case_id,
        "resourceKind": snapshot.resource_kind,
    }
    _finalize_success(owner)
    return report, runtime_local


def _order_failure_case(root: Path) -> dict[str, object]:
    owner, receipt = _active(root / "order-failure.sqlite")
    graph = composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(
        owner, receipt
    )
    parent = composition._issue_sqlite_cursor_publication_mutation_parent_scope_intrinsic(
        graph, composition._SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[1], 20
    )
    code: str | None = None
    try:
        composition._issue_sqlite_cursor_publication_mutation_child_permit_intrinsic(parent, 1)
    except ValueError as error:
        code = str(error)
    terminal = transaction._read_sqlite_cursor_publication_transaction_owner_snapshot_intrinsic(
        owner
    )
    if (
        code != "GE_SQLITE_P11_SCOPE_ORDER"
        or terminal.lifecycle != "finalized"
        or terminal.rollback_attempt_count != 1
        or terminal.rollback_native_return_count != 1
        or terminal.close_attempt_count != 1
        or terminal.close_native_return_count != 1
        or terminal.reopen_attempt_count != 1
        or terminal.reopen_source_v1_count != 1
        or terminal.commit_attempt_count != 0
    ):
        raise AssertionError("Python P11 order failure cleanup cannot be normalized")
    return {
        "caseId": "mutation-order-failure",
        "status": "failure",
        "kind": "mutation",
        "code": code,
        "rejectedOrdinal": 1,
        "expectedOrdinal": 0,
        "cleanup": {
            "lifecycle": terminal.lifecycle,
            "rollbackAttemptCount": terminal.rollback_attempt_count,
            "rollbackNativeReturnCount": terminal.rollback_native_return_count,
            "closeAttemptCount": terminal.close_attempt_count,
            "closeNativeReturnCount": terminal.close_native_return_count,
            "reopenAttemptCount": terminal.reopen_attempt_count,
            "reopenSourceV1Count": terminal.reopen_source_v1_count,
            "commitAttemptCount": terminal.commit_attempt_count,
        },
        "actualNativeIoCount": 0,
        "sqlAuthority": False,
        "routeClosure": False,
        "stage18Accepted": False,
        "commitAttemptCount": 0,
        "dynamicCountProvenance": False,
    }


def build_report() -> dict[str, Any]:
    with tempfile.TemporaryDirectory(prefix="graph-engineering-p11-python-") as temporary:
        root = Path(temporary)
        child_owned = _mutation_case(
            root,
            "child-owned-20",
            composition._SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[1],
            20,
        )
        reusable_zero = _mutation_case(
            root,
            "reusable-shape-0",
            composition._SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[2],
            0,
        )
        reusable_three = _mutation_case(
            root,
            "reusable-shape-3",
            composition._SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[2],
            3,
        )
        fixed_zero, fixed_zero_local = _fixed_read_case(root, "fixed-read-0", 1, 0)
        fixed_two, fixed_two_local = _fixed_read_case(root, "fixed-read-2", 16, 2)
        order_failure = _order_failure_case(root)
    return {
        "version": REPORT_VERSION,
        "implementation": "python",
        "portable": {
            "cases": [
                child_owned,
                reusable_zero,
                reusable_three,
                fixed_zero,
                fixed_two,
                order_failure,
            ],
            "invariants": {
                "actualNativeIoCount": 0,
                "sqlAuthority": False,
                "routeClosure": False,
                "stage18Accepted": False,
                "commitAttemptCount": 0,
                "dynamicCountProvenance": False,
            },
            "claims": {
                "ownerComposition": True,
                "migration20DescriptorCountShape": True,
                "reusableShapeN0N3": True,
                "fixedReadN0N2": True,
                "orderFailureCleanup": True,
                "nativeSqlExecution": False,
                "nativeResourceRetirement": False,
                "routeClosure": False,
                "stage18Acceptance": False,
                "commitRuntime": False,
                "dynamicCountProvenance": False,
            },
            "nonclaims": [
                "native-sql-execution",
                "native-resource-retirement",
                "route-closure",
                "stage-18-acceptance",
                "runtime-commit-execution",
                "dynamic-count-provenance",
            ],
        },
        "runtimeLocal": {
            "runtime": "python",
            "fixedReadResourceKinds": [fixed_zero_local, fixed_two_local],
        },
    }


if __name__ == "__main__":
    print(json.dumps(build_report(), ensure_ascii=False, separators=(",", ":")))
