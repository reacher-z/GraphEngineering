from __future__ import annotations

import copy
import gc
from dataclasses import replace
from weakref import ref

import pytest

import graph_engineering.sqlite_operation_baseline_cursor_source_fence as source_fence
import graph_engineering.sqlite_operation_baseline_source as source_module
from graph_engineering.sqlite_operation_baseline import BaselineProjectionIdentity
from graph_engineering.sqlite_operation_baseline_cursor_invariants import (
    seal_sqlite_v1_cursor_rows,
)
from graph_engineering.sqlite_operation_baseline_cursor_ownership import (
    SQLiteCursorPreRebindReceipt,
    SQLiteCursorPreRebindReceiptCandidate,
    SQLiteCursorPreRebindReceiptIssuer,
    create_sqlite_cursor_capture_session,
    create_sqlite_cursor_exact_projection_reference,
    create_sqlite_cursor_ownership_capability,
)
from graph_engineering.sqlite_operation_baseline_cursor_source_fence import (
    _assert_sqlite_cursor_captured_source_connection_provenance,
    _SQLiteCursorCapturedSourceConnectionWitness,
)
from graph_engineering.sqlite_operation_baseline_legacy_invariants import (
    run_sqlite_v1_legacy_invariant_campaign,
)
from graph_engineering.sqlite_operation_baseline_source import (
    SQLiteV1BaselineConnectionOwner,
    SQLiteV1BaselineSourceSummary,
    capture_sqlite_v1_baseline_source_summary,
)
from graph_engineering.sqlite_operation_baseline_stage import SQLiteV1BaselineTempStage
from tests.test_sqlite_operation_baseline_checkpoint_invariants import _cleanup
from tests.test_sqlite_operation_baseline_legacy_invariants import _prepare_legacy
from tests.test_sqlite_operation_baseline_source import database


def _mint_receipt(
    summary: SQLiteV1BaselineSourceSummary,
    identity: BaselineProjectionIdentity,
) -> SQLiteCursorPreRebindReceipt:
    envelope = summary.source_envelope
    seal = seal_sqlite_v1_cursor_rows(
        (),
        expected_count=0,
        source_descriptor_hash=str(envelope["sourceDescriptorHash"]),
        source_schema_identity_sha256=str(envelope["sourceSchemaIdentitySha256"]),
    )
    tenant = create_sqlite_cursor_ownership_capability("tenant", bytes(32))
    source_stage = create_sqlite_cursor_ownership_capability("source-stage", bytes([17]) * 32)
    campaign = create_sqlite_cursor_ownership_capability("campaign", bytes([34]) * 32)
    connection = create_sqlite_cursor_ownership_capability("connection", bytes([51]) * 32)
    session = create_sqlite_cursor_capture_session(
        tenant_ownership=tenant,
        source_stage_ownership=source_stage,
        campaign_ownership=campaign,
        connection_ownership=connection,
        nonce=bytes([68]) * 32,
    )
    candidate = SQLiteCursorPreRebindReceiptCandidate(
        summary,
        summary.clock_evidence,
        seal,
        identity,
        create_sqlite_cursor_exact_projection_reference(identity),
        session,
        tenant,
        source_stage,
        campaign,
        connection,
    )
    return SQLiteCursorPreRebindReceiptIssuer(candidate).issue(candidate)


def _prepared_fence() -> tuple[
    SQLiteV1BaselineConnectionOwner,
    SQLiteV1BaselineSourceSummary,
    SQLiteV1BaselineTempStage,
    BaselineProjectionIdentity,
    SQLiteCursorPreRebindReceipt,
]:
    connection, summary, stage, identity = _prepare_legacy()
    report = run_sqlite_v1_legacy_invariant_campaign(summary, identity, stage)
    assert report.diagnostics == ()
    assert stage._legacy_campaign_completed
    return connection, summary, stage, identity, _mint_receipt(summary, identity)


def test_real_exact_capture_is_accepted_and_repeatably_revalidated() -> None:
    connection, summary, stage, _identity, receipt = _prepared_fence()
    try:
        witness = _assert_sqlite_cursor_captured_source_connection_provenance(
            connection,
            receipt,
        )
        assert type(witness) is _SQLiteCursorCapturedSourceConnectionWitness
        assert witness._source_summary is summary
        assert witness._clock_evidence is summary.clock_evidence
        assert witness._connection is connection
        assert witness._transaction_epoch == summary._captured_transaction_epoch
        witness._assert_current()
        witness._assert_current()
        with pytest.raises(TypeError, match="module-minted"):
            _SQLiteCursorCapturedSourceConnectionWitness(
                connection,
                receipt,
                witness._provenance,
                summary,
                summary.clock_evidence,
                connection.transaction_epoch,
                object(),
            )
    finally:
        _cleanup(connection, stage)


def test_replaced_and_copied_witnesses_are_not_module_minted() -> None:
    connection, _summary, stage, _identity, receipt = _prepared_fence()
    try:
        witness = _assert_sqlite_cursor_captured_source_connection_provenance(
            connection,
            receipt,
        )
        replaced = replace(witness)
        copied = copy.copy(witness)
        assert replaced is not witness
        assert copied is not witness
        assert replaced != witness
        assert copied != witness
        for clone in (replaced, copied):
            with pytest.raises(ValueError, match="witness provenance"):
                clone._assert_current()
        witness._assert_current()
    finally:
        _cleanup(connection, stage)


def test_direct_clone_with_copied_real_token_is_not_registered() -> None:
    connection, summary, stage, _identity, receipt = _prepared_fence()
    try:
        witness = _assert_sqlite_cursor_captured_source_connection_provenance(
            connection,
            receipt,
        )
        clone = _SQLiteCursorCapturedSourceConnectionWitness(
            connection,
            receipt,
            witness._provenance,
            summary,
            summary.clock_evidence,
            witness._transaction_epoch,
            witness._construction_token,
        )
        assert clone is not witness
        assert clone != witness
        with pytest.raises(ValueError, match="witness provenance"):
            clone._assert_current()
        witness._assert_current()
    finally:
        _cleanup(connection, stage)


def test_witness_registry_does_not_retain_the_exact_witness() -> None:
    connection, _summary, stage, _identity, receipt = _prepared_fence()
    try:
        # Clear unrelated unreachable weak keys before taking the registry baseline.
        # Otherwise the collection below can remove both this witness and a stale
        # witness left by an earlier test, making an exact length delta flaky.
        gc.collect()
        before = len(source_fence._WITNESSES)
        witness = _assert_sqlite_cursor_captured_source_connection_provenance(
            connection,
            receipt,
        )
        witness_reference = ref(witness)
        assert len(source_fence._WITNESSES) == before + 1
        del witness
        gc.collect()
        assert witness_reference() is None
        assert len(source_fence._WITNESSES) == before
    finally:
        _cleanup(connection, stage)


@pytest.mark.parametrize("source_kind", ["direct-constructor", "dataclass-clone"])
def test_structurally_exact_noncaptured_summary_is_rejected(source_kind: str) -> None:
    connection, summary, stage, identity, _receipt = _prepared_fence()
    try:
        if source_kind == "direct-constructor":
            substituted = SQLiteV1BaselineSourceSummary(
                summary._source_envelope_bytes,
                summary.counts_by_kind,
                summary.expected_entry_count,
                summary.clock_evidence,
                connection,
                summary._latest_migration_applied_at_ms,
                summary._source_total_changes,
                summary._captured_transaction_epoch,
            )
        else:
            substituted = replace(summary)
        assert substituted is not summary
        assert substituted._connection is connection
        assert substituted.clock_evidence is summary.clock_evidence
        assert substituted._captured_transaction_epoch == connection.transaction_epoch
        synthetic_receipt = _mint_receipt(substituted, identity)
        with pytest.raises(ValueError, match="summary provenance"):
            _assert_sqlite_cursor_captured_source_connection_provenance(
                connection,
                synthetic_receipt,
            )
    finally:
        _cleanup(connection, stage)


def test_captured_summary_registry_is_weak_and_cleans_exact_identity() -> None:
    connection = database()
    connection.execute("BEGIN EXCLUSIVE").close()
    try:
        summary = capture_sqlite_v1_baseline_source_summary(connection, captured_at_ms=1_000)
        identity = id(summary)
        summary_reference = ref(summary)
        assert source_module._CAPTURED_SOURCE_SUMMARIES[identity]() is summary
        del summary
        gc.collect()
        assert summary_reference() is None
        assert identity not in source_module._CAPTURED_SOURCE_SUMMARIES
    finally:
        connection.rollback()
        connection.close()


def test_wrong_live_connection_is_rejected() -> None:
    connection, _summary, stage, _identity, receipt = _prepared_fence()
    other = SQLiteV1BaselineConnectionOwner(":memory:")
    other.execute("BEGIN EXCLUSIVE").close()
    try:
        with pytest.raises(ValueError, match="connection ownership"):
            _assert_sqlite_cursor_captured_source_connection_provenance(other, receipt)
    finally:
        other.rollback()
        other.close()
        _cleanup(connection, stage)


def test_closed_connection_keeps_receipt_first_and_owned_error_vocabulary() -> None:
    connection, _summary, _stage, _identity, receipt = _prepared_fence()
    witness = _assert_sqlite_cursor_captured_source_connection_provenance(
        connection,
        receipt,
    )
    connection.close()
    with pytest.raises(TypeError, match="pre-rebind receipt"):
        _assert_sqlite_cursor_captured_source_connection_provenance(
            connection,
            object(),  # type: ignore[arg-type]
        )
    with pytest.raises(ValueError, match="closed or unavailable") as raised:
        _assert_sqlite_cursor_captured_source_connection_provenance(
            connection,
            receipt,
        )
    assert type(raised.value) is ValueError
    with pytest.raises(ValueError, match="closed or unavailable") as retained:
        witness._assert_current()
    assert type(retained.value) is ValueError


def test_transaction_epoch_drift_is_rejected_before_publication() -> None:
    connection, _summary, stage, _identity, receipt = _prepared_fence()
    try:
        connection.execute("PRAGMA schema_version").close()
        with pytest.raises(ValueError, match="transaction epoch"):
            _assert_sqlite_cursor_captured_source_connection_provenance(
                connection,
                receipt,
            )
    finally:
        _cleanup(connection, stage)


def test_source_fence_does_not_claim_the_later_stage_change_counter() -> None:
    connection, summary, stage, _identity, receipt = _prepared_fence()
    try:
        witness = _assert_sqlite_cursor_captured_source_connection_provenance(
            connection,
            receipt,
        )
        assert summary._source_total_changes < stage._allowed_total_changes
        connection.execute(
            "UPDATE temp.ge_blr_stage SET state_blob = state_blob WHERE kind_rank = 0"
        ).close()
        # This source fence owns identity/clock/epoch only. The adjacent stage
        # fence, not this witness, rejects unexplained total_changes drift.
        witness._assert_current()
    finally:
        _cleanup(connection, stage)


def test_receipt_fence_runs_before_source_registry_fence(monkeypatch: pytest.MonkeyPatch) -> None:
    connection, _summary, stage, _identity, receipt = _prepared_fence()
    calls: list[str] = []
    receipt_assertion = source_fence.assert_sqlite_cursor_pre_rebind_receipt_provenance
    source_assertion = source_fence._assert_sqlite_v1_baseline_source_summary_provenance
    witness_assertion = source_fence._assert_registered_witness

    def assert_receipt(value: SQLiteCursorPreRebindReceipt):
        calls.append("receipt")
        return receipt_assertion(value)

    def assert_source(value: SQLiteV1BaselineSourceSummary):
        calls.append("source")
        return source_assertion(value)

    def assert_witness(value: _SQLiteCursorCapturedSourceConnectionWitness):
        calls.append("witness")
        return witness_assertion(value)

    monkeypatch.setattr(
        source_fence,
        "assert_sqlite_cursor_pre_rebind_receipt_provenance",
        assert_receipt,
    )
    monkeypatch.setattr(
        source_fence,
        "_assert_sqlite_v1_baseline_source_summary_provenance",
        assert_source,
    )
    monkeypatch.setattr(source_fence, "_assert_registered_witness", assert_witness)
    try:
        _assert_sqlite_cursor_captured_source_connection_provenance(connection, receipt)
        assert calls == ["receipt", "source", "receipt", "witness", "source"]
    finally:
        _cleanup(connection, stage)


def test_second_synchronous_epoch_read_closes_toctou_window(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, summary, stage, _identity, receipt = _prepared_fence()
    real_epoch = connection.transaction_epoch
    reads = 0

    def racing_epoch(_owner: SQLiteV1BaselineConnectionOwner) -> int:
        nonlocal reads
        reads += 1
        return real_epoch if reads == 1 else real_epoch + 1

    try:
        with monkeypatch.context() as patch:
            patch.setattr(
                SQLiteV1BaselineConnectionOwner,
                "transaction_epoch",
                property(racing_epoch),
            )
            with pytest.raises(ValueError, match="transaction epoch"):
                _assert_sqlite_cursor_captured_source_connection_provenance(
                    connection,
                    receipt,
                )
        assert reads >= 2
        assert summary._captured_transaction_epoch == connection.transaction_epoch
    finally:
        _cleanup(connection, stage)
