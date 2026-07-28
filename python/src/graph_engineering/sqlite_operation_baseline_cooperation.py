"""Private single-item source-to-TEMP-stage reconciliation handshake."""

from __future__ import annotations

from collections.abc import Generator
from contextlib import suppress

from .sqlite_operation_baseline_source import (
    SQLiteV1BaselineSourceSummary,
    _CooperativeSourceItem,
    _CooperativeWriteReceipt,
)
from .sqlite_operation_baseline_stage import SQLiteV1BaselineTempStage


def _stream_sqlite_v1_baseline_source_into_temp_stage(
    summary: SQLiteV1BaselineSourceSummary,
    stage: SQLiteV1BaselineTempStage,
) -> int:
    """Stream the captured source through exact paired TEMP writes.

    This deliberately remains outside the package root. The coordinator owns
    the synchronous item -> pair -> receipt -> consume sequence, so neither a
    raw connection nor an unconsumed receipt escapes to application code.
    """

    walker: Generator[_CooperativeSourceItem, _CooperativeWriteReceipt, None] | None = None
    try:
        _require_initial_handshake(summary, stage)
        walker = summary._cooperative_identity_entries(
            stage._cooperative_stage_session,
            stage._poison_cooperative_state,
        )
        try:
            item = next(walker)
        except StopIteration as error:
            raise ValueError(
                "BLR_COOP_SEQUENCE: cooperative source was unexpectedly empty"
            ) from error
        source_session = item._source_session
        written = 0
        while True:
            receipt = stage._insert_cooperative_entry(item)
            if (
                stage._cooperative_pending_receipt is not receipt
                or summary._connection.total_changes != receipt._after_total_changes
            ):
                raise ValueError(
                    "BLR_COOP_RECEIPT: cooperative receipt was not immediately observable"
                )
            written += 1
            try:
                item = walker.send(receipt)
            except StopIteration:
                break
        if written != summary.expected_entry_count:
            raise ValueError("BLR_COOP_SEQUENCE: cooperative source count drifted")
        stage._finish_cooperative_stream(source_session, written)
        stage.assert_common_counts(summary.counts_by_kind)
        stage.assert_relation_key_coverage()
        return written
    except BaseException:
        if walker is not None:
            with suppress(BaseException):
                walker.close()
        with suppress(BaseException):
            summary._poison_cooperative_state()
        with suppress(BaseException):
            stage._poison_cooperative_state()
        raise


def _require_initial_handshake(
    summary: SQLiteV1BaselineSourceSummary,
    stage: SQLiteV1BaselineTempStage,
) -> None:
    if type(summary) is not SQLiteV1BaselineSourceSummary:
        raise TypeError("BLR_COOP_HANDSHAKE: source summary has the wrong type")
    if type(stage) is not SQLiteV1BaselineTempStage:
        raise TypeError("BLR_COOP_HANDSHAKE: TEMP stage has the wrong type")
    state = summary._identity_iteration_state
    connection = summary._connection
    if (
        state.started
        or state.poisoned
        or state.completed
        or stage.state != "open"
        or stage._connection is not connection
        or not connection.in_exclusive_transaction
        or summary._captured_transaction_epoch != connection.transaction_epoch
        or stage._transaction_epoch != connection.transaction_epoch
        or summary._source_total_changes != connection.total_changes
        or stage._allowed_total_changes != connection.total_changes
        or stage._cooperative_source_session is not None
        or stage._cooperative_pending_receipt is not None
        or stage._cooperative_next_sequence != 0
        or stage.common_entry_count != 0
        or stage._read_safe_count(
            "SELECT count(*) FROM temp.ge_blr_relation_keys",
            label="cooperative handshake relation count",
        )
        != 0
    ):
        raise ValueError("BLR_COOP_HANDSHAKE: source and TEMP stage are not freshly bound")
