"""Private verified TEMP-stage to baseline-identity handoff."""

from __future__ import annotations

from contextlib import suppress

from .sqlite_operation_baseline import (
    BaselineAccumulator,
    BaselineProjectionIdentity,
    create_baseline_id,
)
from .sqlite_operation_baseline_source import SQLiteV1BaselineSourceSummary
from .sqlite_operation_baseline_stage import SQLiteV1BaselineTempStage


def _project_ordered_sqlite_v1_baseline_temp_stage(
    summary: SQLiteV1BaselineSourceSummary,
    stage: SQLiteV1BaselineTempStage,
) -> BaselineProjectionIdentity:
    """Hash the verified ordered stage in O(1) retained row memory exactly once."""

    if type(summary) is not SQLiteV1BaselineSourceSummary:
        raise TypeError("BLR_HANDOFF_BINDING: source summary has the wrong type")
    if type(stage) is not SQLiteV1BaselineTempStage:
        with suppress(BaseException):
            summary._poison_cooperative_state()
        raise TypeError("BLR_HANDOFF_BINDING: TEMP stage has the wrong type")

    reader = None
    try:
        accumulator = BaselineAccumulator(
            create_baseline_id(summary.source_envelope),
            summary.expected_entry_count,
        )
        reader = stage._open_ordered_projection_reader(summary)
        for item in reader:
            accumulator.append(item)
            stage._assert_ordered_handoff_fence(stage._allowed_total_changes)
        stage._finish_ordered_projection_reader(summary, reader)
        identity = accumulator.finish()
        if identity.entry_count != summary.expected_entry_count:
            raise ValueError("BLR_HANDOFF_COUNT: projection identity count drifted")
        stage._assert_ordered_handoff_fence(stage._allowed_total_changes)
        stage._complete_ordered_projection_reader(reader, identity)
        return identity
    except BaseException:
        if reader is not None:
            with suppress(BaseException):
                reader.close()
        with suppress(BaseException):
            summary._poison_cooperative_state()
        with suppress(BaseException):
            stage._poison_cooperative_state()
        raise
