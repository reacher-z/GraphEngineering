"""Emit one deterministic real-SQLite P11-A-NP1 conformance report line."""

from __future__ import annotations

import hashlib
import json
import sys
import tempfile
from dataclasses import replace
from pathlib import Path
from typing import Any, cast

PYTHON_ROOT = Path(__file__).resolve().parents[1]
if str(PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(PYTHON_ROOT))

import graph_engineering.sqlite_cursor_publication_owner_composition as composition  # noqa: E402
import graph_engineering.sqlite_cursor_publication_transaction_owner as transaction  # noqa: E402
import graph_engineering.sqlite_operation_baseline_source as source  # noqa: E402
from graph_engineering.canonical import canonical_bytes, canonical_sha256  # noqa: E402
from graph_engineering.cycle_store_provider import cycle_store_adapter_codec  # noqa: E402
from graph_engineering.sqlite_cycle_store import (  # noqa: E402
    _REQUIRED_MIGRATION_POSTCONDITIONS,
    SQLITE_CYCLE_STORE_DESCRIPTOR_HASH,
    SQLITE_CYCLE_STORE_SCHEMA_IDENTITY_SHA256,
    _load_migration_assets,
)
from graph_engineering.sqlite_operation_baseline_source import (  # noqa: E402
    SQLiteV1BaselineConnectionOwner,
)

APPLIED_AT_MS = 1_785_110_405_000
CONTRACT_ID = "sqlite-cursor-publication-native-projection-np1/v1"
SOURCE_FAMILIES = (
    "schema-envelope",
    "migration-lineage",
    "stream-head",
    "record-identity",
    "checkpoint-current",
    "checkpoint-revision",
    "lease-current",
    "used-lease-identity",
    "legal-hold",
    "migration-lock-current",
    "used-migration-lock-identity",
    "legacy-operation",
)
NORMALIZED_SQL_ORACLE = (
    "d463cf27633ca463ff1cc0ff57ccc632addf74d5c4f641aeb6425508fd9a840d",
    "c43f6ea643b6e2c03200609416e7c7d6bfdb735ca96f7fc83e2c7a474d6d3d4e",
    "30a30fe14c69e7d9f1795b29800fae147df3b44cf938d08b6734c44d5dfb8044",
    "4c92628b34578bcfeeca4d1003b3bdb2ce6c723405185db6bf12fe16b3581b4d",
    "fc3ac0e541a22d5afbdd25c19d3883addd0e9bef09ad63c6343389716c98102b",
    "bb15b913e9f3881f515c4a8712ad3e05b6133558e8b5170a21f833444c54eecd",
    "bed724e3679e1c12eb81f017f748bd7a45c119673fbd4cd914d4b075485f5b04",
    "315c46c5ad6064c39ed153b6e86f4fc1ac93093bbeb1520281e059097605d8a8",
    "85819d020543c637a1eea9eaeb8d84a6e5e11c6d292e59dfddfccbdbcba5c63f",
    "090564e9a36643dfaa705dac5eefd0a86acff04bfc000cd397202ddc8242fe0d",
    "8f4c8983ce55744fe36f398cb990f0bbf06c9787189180669d6d26ae58baf2a2",
    "e186ae71f91a771a95e41f05497f6e2c0ec3e38a7c7d6d16c17713cece498a02",
)


def _active_with_optional_streams(
    path: Path,
    optional_count: int,
) -> tuple[
    SQLiteV1BaselineConnectionOwner,
    transaction._SQLiteCursorPublicationTransactionOwner,
    transaction._SQLiteCursorPublicationBeginReceipt,
]:
    connection = SQLiteV1BaselineConnectionOwner(str(path))
    schema_path = (
        PYTHON_ROOT / "src/graph_engineering/_sqlite_migrations/schema-v1.sql"
    )
    connection.executescript(schema_path.read_text())
    assets = _load_migration_assets()
    connection.execute(
        """INSERT INTO ge_cycle_schema VALUES
           (1, 1, 1, 1, 1, 1, ?, ?, ?, ?, ?, ?)""",
        (
            SQLITE_CYCLE_STORE_SCHEMA_IDENTITY_SHA256,
            assets.schema_sql_hash,
            APPLIED_AT_MS,
            SQLITE_CYCLE_STORE_DESCRIPTOR_HASH,
            APPLIED_AT_MS,
            APPLIED_AT_MS,
        ),
    ).close()
    connection.execute(
        """INSERT INTO ge_cycle_migrations VALUES
           (1, 0, 'fresh-v1-baseline', ?, ?, ?,
            'rebuild-from-verified-backup-only', ?)""",
        (
            assets.schema_sql_hash,
            SQLITE_CYCLE_STORE_SCHEMA_IDENTITY_SHA256,
            APPLIED_AT_MS,
            canonical_bytes(
                {"requiredPostconditions": list(_REQUIRED_MIGRATION_POSTCONDITIONS)}
            ),
        ),
    ).close()
    connection.execute(
        """INSERT INTO ge_cycle_migration_lock VALUES
           (1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, 0, ?)""",
        (APPLIED_AT_MS,),
    ).close()
    encoded_result = cycle_store_adapter_codec.encode_ledger_result(
        "delete-checkpoint", {"deleted": False}
    )
    for ordinal in range(optional_count):
        connection.execute(
            """INSERT INTO ge_cycle_operations
               (tenant_id, operation_id, operation_name, request_hash,
                result_blob, result_hash, committed_at_ms)
               VALUES (?, ?, 'delete-checkpoint', ?, ?, ?, ?)""",
            (
                "tenant-a",
                f"operation-{ordinal}",
                hashlib.sha256(f"request-{ordinal}".encode()).hexdigest(),
                encoded_result,
                canonical_sha256({"deleted": False}),
                APPLIED_AT_MS,
            ),
        ).close()
    connection.commit()
    owner = transaction._register_sqlite_cursor_publication_transaction_owner_intrinsic(
        connection
    )
    begin_receipt = (
        transaction._begin_sqlite_cursor_publication_transaction_intrinsic(owner)
    )
    return connection, owner, begin_receipt


def _finalize(owner: transaction._SQLiteCursorPublicationTransactionOwner) -> None:
    primary = RuntimeError("NP1_REPORT_BOUNDED_STOP")
    capture = transaction._capture_sqlite_cursor_publication_transaction_failure_intrinsic(
        owner, primary
    )
    observed: BaseException | None = None
    try:
        transaction._finalize_sqlite_cursor_publication_transaction_failure_capture_intrinsic(
            owner, capture
        )
    except BaseException as error:
        observed = error
    if observed is not primary:
        raise AssertionError("Python NP1 report cleanup replaced its exact primary")


def _success_case(root: Path, optional_count: int) -> tuple[dict[str, object], dict[str, object]]:
    connection, owner, begin_receipt = _active_with_optional_streams(
        root / f"success-{optional_count}.sqlite", optional_count
    )
    adopted = composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(
        owner, begin_receipt
    )
    summary = source.capture_sqlite_v1_baseline_source_summary(
        connection, captured_at_ms=APPLIED_AT_MS
    )
    result = composition._capture_and_adopt_sqlite_cursor_publication_native_projection_intrinsic(
        adopted, summary
    )
    snapshot = cast(Any, result.receipt_snapshot)
    expected_total = 3 + optional_count
    if (
        snapshot.lifecycle != "consumed"
        or snapshot.retained_count != expected_total
        or snapshot.expected_projection_count != expected_total
        or snapshot.expected_family_counts != snapshot.observed_family_counts
        or snapshot.ordered_normalized_sql_sha256 != NORMALIZED_SQL_ORACLE
        or not snapshot.exact_resource_pairing
    ):
        raise AssertionError("Python NP1 success evidence cannot be normalized")
    case_id = f"baseline-dynamic-{optional_count}-total-{expected_total}"
    expected_counts = [
        {"entryKind": kind, "count": count}
        for kind, count in snapshot.expected_family_counts
    ]
    observed_counts = [
        {"entryKind": kind, "count": count}
        for kind, count in snapshot.observed_family_counts
    ]
    portable: dict[str, object] = {
        "caseId": case_id,
        "outcome": "success",
        "routeId": snapshot.route_id,
        "sourceFamilyCount": snapshot.source_family_count,
        "optionalDynamicCount": optional_count,
        "orderedNormalizedSqlSha256": list(snapshot.ordered_normalized_sql_sha256),
        "expectedFamilyCounts": expected_counts,
        "observedFamilyCounts": observed_counts,
        "expectedProjectionCount": snapshot.expected_projection_count,
        "retainedProjectionCount": snapshot.retained_count,
        "sourceEnvelopeSha256": snapshot.source_envelope_sha256,
        "projectionCanonicalSha256": snapshot.projection_sha256,
        "logicalNativeReadCount": snapshot.logical_native_read_count,
        "prepareCount": snapshot.prepare_count,
        "terminalObservationCount": snapshot.terminal_observed_count,
        "decodeCount": snapshot.retained_count,
        "resourceRetirement": {
            "normalized": "complete",
            "resourceCount": 12,
            "attemptCount": snapshot.cursor_close_attempt_count,
            "returnCount": snapshot.cursor_close_return_count,
            "exactPairing": snapshot.exact_resource_pairing,
        },
        "receiptLifecycle": {
            "state": snapshot.lifecycle,
            "mintCount": 1,
            "consumeCount": 1,
            "replayRejected": True,
        },
        "bindings": {
            "exactOwner": snapshot.exact_owner,
            "exactBeginReceipt": snapshot.exact_begin_receipt,
            "exactComposition": snapshot.exact_composition,
            "exactConnection": snapshot.exact_connection,
            "exactLineage": snapshot.exact_lineage,
            "exactGeneration": snapshot.exact_generation,
            "exactSourceSummary": snapshot.exact_source_summary,
            "exactSourceEnvelope": True,
            "exactReadSession": snapshot.exact_read_session,
        },
        "authority": {
            "countProvenance": "lower-native",
            "nativeSourceProvenance": snapshot.native_source_provenance,
            "nativeProjectionAuthority": snapshot.native_projection_authority,
            "genuineZeroClaim": snapshot.genuine_zero_claim,
            "oneShot": snapshot.one_shot,
            "sqlAuthority": snapshot.sql_authority,
            "callerSuppliedCount": False,
            "callerSuppliedProjection": False,
            "physicalNativeIoCountClaimed": False,
        },
        "cleanup": {
            "receiptMintCount": 1,
            "receiptConsumeCount": 1,
            "rollbackAttemptCount": 0,
            "closeAttemptCount": 0,
            "reopenAttemptCount": 0,
            "commitAttemptCount": 0,
            "primaryPreserved": True,
        },
    }
    runtime_local: dict[str, object] = {
        "caseId": case_id,
        "resourceCount": 12,
        "attemptCount": snapshot.cursor_close_attempt_count,
        "returnCount": snapshot.cursor_close_return_count,
        "orderedRawSqlSha256": list(snapshot.ordered_sql_sha256),
    }
    _finalize(owner)
    return portable, runtime_local


def _rejection_case(root: Path, impossible_count: int) -> dict[str, object]:
    connection, owner, begin_receipt = _active_with_optional_streams(
        root / f"rejection-{impossible_count}.sqlite", 0
    )
    adopted = composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(
        owner, begin_receipt
    )
    summary = source.capture_sqlite_v1_baseline_source_summary(
        connection, captured_at_ms=APPLIED_AT_MS
    )
    forged = replace(summary, expected_entry_count=impossible_count)
    rejection: BaseException | None = None
    try:
        composition._capture_and_adopt_sqlite_cursor_publication_native_projection_intrinsic(
            adopted, forged
        )
    except BaseException as error:
        rejection = error
    terminal = transaction._read_sqlite_cursor_publication_transaction_owner_snapshot_intrinsic(
        owner
    )
    if (
        type(rejection) is not source.SQLiteV1BaselineNativeProjectionProvenanceError
        or rejection.code != "GE_SQLITE_P11_NATIVE_PROJECTION_SOURCE_PROVENANCE"
        or str(rejection) != "SQLite v1 baseline lower-owned source is invalid"
        or terminal.lifecycle != "finalized"
        or terminal.rollback_attempt_count != 1
        or terminal.close_attempt_count != 1
        or terminal.reopen_attempt_count != 1
        or terminal.commit_attempt_count != 0
    ):
        raise AssertionError("Python NP1 rejection evidence cannot be normalized")
    return {
        "caseId": f"baseline-total-{impossible_count}-impossible",
        "outcome": "failure",
        "routeId": "main.baseline-entries",
        "requestedProjectionCount": impossible_count,
        "failedStage": "pre-native-source-conservation",
        "retainedProjectionCount": None,
        "projectionCanonicalSha256": None,
        "logicalNativeReadCount": 0,
        "receiptMintCount": 0,
        "receiptConsumeCount": 0,
        "nativeProjectionAuthority": False,
        "cleanup": {
            "rollbackAttemptCount": terminal.rollback_attempt_count,
            "closeAttemptCount": terminal.close_attempt_count,
            "reopenAttemptCount": terminal.reopen_attempt_count,
            "commitAttemptCount": terminal.commit_attempt_count,
            "primaryPreserved": True,
        },
    }


def build_report() -> dict[str, object]:
    with tempfile.TemporaryDirectory(prefix="graph-engineering-np1-python-") as temporary:
        root = Path(temporary)
        success_pairs = [_success_case(root, count) for count in (0, 1, 3)]
        rejection_cases = [_rejection_case(root, count) for count in (0, 1)]
    return {
        "schemaVersion": 1,
        "contractId": CONTRACT_ID,
        "implementation": "python",
        "portable": {
            "successCases": [pair[0] for pair in success_pairs],
            "rejectionCases": rejection_cases,
            "invariants": {
                "mandatorySingletonCount": 3,
                "optionalDynamicCounts": [0, 1, 3],
                "completeProjectionCounts": [3, 4, 6],
                "sourceFamilyCount": len(SOURCE_FAMILIES),
                "genuineZeroClaim": False,
                "physicalNativeIoCountClaimed": False,
                "sqlAuthority": False,
                "routeClosure": False,
                "stage18Accepted": False,
                "commitAttemptCount": 0,
            },
            "nonclaims": [
                "global-native-route-closure",
                "arbitrary-sql-authority",
                "p11-a-completion",
                "p11-b-c-or-d",
                "stage-18-acceptance",
                "runtime-commit-execution",
                "release-evidence",
                "release-or-popularity",
            ],
        },
        "runtimeLocal": {
            "runtime": "python",
            "retirementMechanism": "cursor-close",
            "successCases": [pair[1] for pair in success_pairs],
        },
    }


if __name__ == "__main__":
    print(
        json.dumps(
            build_report(),
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        )
    )
