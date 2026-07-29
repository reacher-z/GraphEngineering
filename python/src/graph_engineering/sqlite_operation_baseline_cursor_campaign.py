"""Package-private SQLite v1 cursor pre-rebind campaign executor."""

# ruff: noqa: E501 -- protocol SQL is intentionally literal and hash-pinned.

from __future__ import annotations

import hashlib
import re
from contextlib import suppress
from dataclasses import dataclass
from typing import Literal, TypeAlias, cast

from .sqlite_operation_baseline import BaselineProjectionIdentity
from .sqlite_operation_baseline_cursor_inspection import _inspect_sqlite_v1_cursor_row
from .sqlite_operation_baseline_cursor_invariants import (
    SQLiteCursorImmutableSealCarrier,
    SQLiteCursorSealAccumulator,
    SQLiteCursorSealRow,
)
from .sqlite_operation_baseline_cursor_ownership import (
    SQLITE_CURSOR_MAIN_PROJECTION_SQL,
    SQLiteCursorPreRebindReceipt,
    assert_sqlite_cursor_pre_rebind_receipt_provenance,
)
from .sqlite_operation_baseline_cursor_stage_ownership import (
    _abort_sqlite_cursor_pre_rebind_campaign,
    _adopt_sqlite_cursor_campaign_insert,
    _assert_sqlite_cursor_pre_rebind_campaign,
    _begin_sqlite_cursor_pre_rebind_campaign,
    _complete_sqlite_cursor_pre_rebind_campaign,
    _finalize_sqlite_cursor_campaign_cursor,
    _register_sqlite_cursor_campaign_cursor,
    _SQLiteCursorPreRebindCampaignAuthority,
    _SQLiteCursorStageOwnershipTransfer,
)
from .sqlite_operation_baseline_source import (
    SQLiteV1BaselineConnectionOwner,
    _SQLiteCursorCapability,
)
from .sqlite_operation_baseline_stage import SQLiteV1BaselineTempStage

DEFAULT_SQLITE_CURSOR_DIAGNOSTIC_LIMIT = 16
MAX_SQLITE_CURSOR_DIAGNOSTIC_LIMIT = 64
_CANCELLATION_CONSTRUCTION_TOKEN = object()
_CANCELLATION_PHASES = (
    "before-prepare",
    "after-prepare",
    "before-fetch",
    "after-fetch",
    "before-close",
    "after-close",
)
_EQP_CANCELLATION_ROLES = (
    "eqp-source",
    "eqp-stage-insert",
    "eqp-stage-seal",
    "eqp-count-marker",
    "eqp-event-lookup",
    "eqp-checkpoint-lookup",
    "eqp-BLR_CURSOR_AUTHORIZATION",
    "eqp-BLR_CURSOR_SCOPE",
    "eqp-BLR_CURSOR_BLOB_CANONICAL",
    "eqp-BLR_CURSOR_POSITION",
    "eqp-BLR_CURSOR_EXPIRY_CONSUMPTION",
    "eqp-BLR_CURSOR_CATALOG_BINDING",
    "eqp-BLR_CURSOR_SHAPE",
    "eqp-BLR_CURSOR_EVENT_BINDING",
    "eqp-BLR_CURSOR_CHECKPOINT_BINDING",
)
_RULE_CANCELLATION_ROLES = (
    "BLR_CURSOR_AUTHORIZATION",
    "BLR_CURSOR_SCOPE",
    "BLR_CURSOR_BLOB_CANONICAL",
    "BLR_CURSOR_POSITION",
    "BLR_CURSOR_EXPIRY_CONSUMPTION",
    "BLR_CURSOR_CATALOG_BINDING",
    "BLR_CURSOR_SEAL_COUNT",
    "BLR_CURSOR_SHAPE",
    "BLR_CURSOR_EVENT_BINDING",
    "BLR_CURSOR_CHECKPOINT_BINDING",
)
_CANCELLATION_BOUNDARY_ROLES = (
    "campaign",
    *_EQP_CANCELLATION_ROLES,
    *_RULE_CANCELLATION_ROLES,
    "catalog-snapshot",
    "identity",
    "temp-count",
    "source",
    "inspect",
    "insert",
    "event-lookup",
    "checkpoint-lookup",
    "seal",
    "diagnosed-publication",
    "clean-publication",
)
_EXACT_CANCELLATION_BOUNDARY_LABELS = tuple(
    f"{role}:{phase}" for role in _CANCELLATION_BOUNDARY_ROLES for phase in _CANCELLATION_PHASES
)
_CANCELLATION_BOUNDARY_LABELS = _EXACT_CANCELLATION_BOUNDARY_LABELS


class SQLiteCursorCampaignCancelledError(RuntimeError):
    """Terminal cooperative cancellation at a B2 owner boundary."""


class _SQLiteCursorCampaignCancellation:
    """Exact package-private cooperative cancellation capability."""

    __slots__ = (
        "_cancel_at_label",
        "_cancel_at_occurrence",
        "_cancelled",
        "_label_occurrences",
    )

    def __init__(
        self,
        construction_token: object,
        cancel_at_label: str | None,
        cancel_at_occurrence: int,
    ) -> None:
        if construction_token is not _CANCELLATION_CONSTRUCTION_TOKEN:
            raise TypeError("cursor campaign cancellation is module-minted")
        self._cancelled = False
        self._cancel_at_label = cancel_at_label
        self._cancel_at_occurrence = cancel_at_occurrence
        self._label_occurrences = 0

    def request_cancel(self) -> None:
        self._cancelled = True

    def _poll(self, label: str) -> None:
        if label not in _CANCELLATION_BOUNDARY_LABELS:
            raise AssertionError("cursor campaign cancellation label is not closed")
        if label == self._cancel_at_label:
            self._label_occurrences += 1
            if self._label_occurrences == self._cancel_at_occurrence:
                self._cancelled = True


def _create_sqlite_cursor_campaign_cancellation(
    *,
    cancel_at_label: str | None = None,
    cancel_at_occurrence: int = 1,
) -> _SQLiteCursorCampaignCancellation:
    if cancel_at_label is not None and cancel_at_label not in _CANCELLATION_BOUNDARY_LABELS:
        raise ValueError("cursor campaign cancellation label is invalid")
    if type(cancel_at_occurrence) is not int or cancel_at_occurrence < 1:
        raise ValueError("cursor campaign cancellation occurrence is invalid")
    return _SQLiteCursorCampaignCancellation(
        _CANCELLATION_CONSTRUCTION_TOKEN,
        cancel_at_label,
        cancel_at_occurrence,
    )


SQLiteCursorRuleId: TypeAlias = Literal[
    "BLR_CURSOR_AUTHORIZATION",
    "BLR_CURSOR_SCOPE",
    "BLR_CURSOR_BLOB_CANONICAL",
    "BLR_CURSOR_POSITION",
    "BLR_CURSOR_EXPIRY_CONSUMPTION",
    "BLR_CURSOR_CATALOG_BINDING",
    "BLR_CURSOR_SEAL_COUNT",
    "BLR_CURSOR_SHAPE",
    "BLR_CURSOR_EVENT_BINDING",
    "BLR_CURSOR_CHECKPOINT_BINDING",
]
SQLiteCursorQueryPlanKind: TypeAlias = Literal[
    "source",
    "event-lookup",
    "checkpoint-lookup",
    "stage-insert",
    "count-marker",
    "row-marker",
    "stage-seal",
]

SQLITE_CURSOR_SEAL_INSERT_SQL = "INSERT INTO temp.ge_blr_cursor_seal (token_hash, tenant_id, kind, principal_hash, authorization_hash, stream_id, checkpoint_scope, request_scope_byte_length, request_scope_blob_sha256, page_size, next_position, snapshot_tail_sequence, snapshot_tail_record_hash, snapshot_byte_length, snapshot_blob_sha256, created_at_ms, expires_at_ms, consumed_at_ms, descriptor_hash, schema_identity_sha256, authorization_ok, scope_ok, blobs_canonical_ok, position_ok, clock_ok, catalog_ok, shape_ok, event_binding_ok, checkpoint_binding_ok, seal_eligible) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
SQLITE_CURSOR_SEAL_PROJECTION_SQL = "SELECT tenant_id, token_hash, kind, principal_hash, authorization_hash, stream_id, checkpoint_scope, request_scope_byte_length, request_scope_blob_sha256, page_size, next_position, snapshot_tail_sequence, snapshot_tail_record_hash, snapshot_byte_length, snapshot_blob_sha256, created_at_ms, expires_at_ms, consumed_at_ms, descriptor_hash, schema_identity_sha256 FROM temp.ge_blr_cursor_seal WHERE seal_eligible = 1 ORDER BY token_hash COLLATE BINARY, tenant_id COLLATE BINARY"
SQLITE_CURSOR_COUNT_MARKER_SQL = "SELECT 1 AS violation_marker WHERE ? <> ? OR ? <> ? LIMIT ?"
SQLITE_CURSOR_EVENT_LOOKUP_SQL = "SELECT 1 AS binding_marker FROM main.ge_cycle_records INDEXED BY ge_cycle_records_stream_sequence_hash_uq WHERE tenant_id = ? AND stream_id = ? AND sequence = ? AND record_hash = ? LIMIT 1"
SQLITE_CURSOR_CHECKPOINT_LOOKUP_SQL = "SELECT 1 AS binding_marker FROM main.ge_cycle_checkpoint_revisions INDEXED BY ge_cycle_checkpoint_revisions_lookup_idx WHERE tenant_id = ? AND checkpoint_scope = ? AND checkpoint_id = ? AND action = 'put' AND summary_blob = ? LIMIT 1"
SQLITE_CURSOR_TEMP_OBJECT_COUNT_SQL = (
    "SELECT count(*) FROM temp.sqlite_schema WHERE type = 'table' AND name = 'ge_blr_cursor_seal'"
)

_RULES: tuple[tuple[SQLiteCursorRuleId, str | None], ...] = (
    ("BLR_CURSOR_AUTHORIZATION", "authorization_ok"),
    ("BLR_CURSOR_SCOPE", "scope_ok"),
    ("BLR_CURSOR_BLOB_CANONICAL", "blobs_canonical_ok"),
    ("BLR_CURSOR_POSITION", "position_ok"),
    ("BLR_CURSOR_EXPIRY_CONSUMPTION", "clock_ok"),
    ("BLR_CURSOR_CATALOG_BINDING", "catalog_ok"),
    ("BLR_CURSOR_SEAL_COUNT", None),
    ("BLR_CURSOR_SHAPE", "shape_ok"),
    ("BLR_CURSOR_EVENT_BINDING", "event_binding_ok"),
    ("BLR_CURSOR_CHECKPOINT_BINDING", "checkpoint_binding_ok"),
)
_ROW_MARKER_SQL = tuple(
    None
    if flag is None
    else "SELECT 1 AS violation_marker FROM temp.ge_blr_cursor_seal WHERE "
    f"{flag} = 0 ORDER BY token_hash COLLATE BINARY, tenant_id COLLATE BINARY LIMIT ?"
    for _rule, flag in _RULES
)


def _normalized_sql_sha256(sql: str) -> str:
    normalized = re.sub(r"[\t\n\v\f\r ]+", " ", sql.strip())
    return hashlib.sha256(normalized.encode("ascii")).hexdigest()


_SQL_HASHES = (
    (
        SQLITE_CURSOR_MAIN_PROJECTION_SQL,
        "dda30c873dcae965e1cac3f6478549b98e2414e982c1287997b93a2c09d760a4",
    ),
    (
        SQLITE_CURSOR_SEAL_INSERT_SQL,
        "fbcf5255335c392f4f18818d8f12e79abbcfc677f768579fbe05f317a7a4774b",
    ),
    (
        SQLITE_CURSOR_SEAL_PROJECTION_SQL,
        "c169d8478a327605640a031bc1129d699341165bc6f59bdf7151c3e33677458e",
    ),
    (
        SQLITE_CURSOR_COUNT_MARKER_SQL,
        "d4fa6279ee8d237b0ec82d9aed1b70e804d45890dd6d02313ac9ffea6260c830",
    ),
    (
        SQLITE_CURSOR_EVENT_LOOKUP_SQL,
        "86a336dc93fc818fc41b0e2fdf204256dc197515919f5431084e71adf45585d4",
    ),
    (
        SQLITE_CURSOR_CHECKPOINT_LOOKUP_SQL,
        "8b6322cee22b003a9d8ac33caafcde5272473e9da86dc7f8d21db3209523aba0",
    ),
)
_ROW_MARKER_HASHES = (
    "4b05dede61e9303c06a459416e8d6da4eac6007dedbab602ae4f4b942e9fbebf",
    "9bf6d38c051294f87798839738e5f913c69a54e8ac81dd571e36eda33ea8b628",
    "64b77f510a88d3091603b5d9c93d58a5eb69d65c20f67c081847654434e514b8",
    "aa3a0bbb0a07137a0e497c9140d359608358b5fd3bf1ac7e1ed15a34893678b3",
    "494b6ae97f33349cfb787afedc3bbf2ee69021a669abb4dd14273028d2117771",
    "6dec1fa0dc5aa8b48c9fa45c50ed2dba32cb2a01c83f934407484c1200460562",
    "",
    "2600c8112c8e55f814a0f57ea50b822eb14c91e13871bec99965e7aa6a91c8cd",
    "515c1832cfc0238339a838245b7afabc83ca319e7f74fdeabbad6904152e3909",
    "92315896aa7d1f1acab782dad89641687da88350f5843f9c34d32026f6a9c8ce",
)
_SOURCE_CATALOG_NAMES = (
    "ge_cycle_checkpoint_revisions",
    "ge_cycle_checkpoint_revisions_lookup_idx",
    "ge_cycle_cursors",
    "ge_cycle_migration_lock",
    "ge_cycle_records",
    "ge_cycle_records_stream_sequence_hash_uq",
    "ge_cycle_schema",
)
_SOURCE_CATALOG_SQL = (
    "SELECT type, name, tbl_name, rootpage, sql FROM main.sqlite_schema "
    "WHERE name IN (?, ?, ?, ?, ?, ?, ?) ORDER BY type, name"
)
_SOURCE_CATALOG_SNAPSHOT_SQL = (
    "SELECT group_concat(frame, '|') FROM (SELECT hex(type) || ':' || hex(name) || ':' || "
    "hex(tbl_name) || ':' || CAST(rootpage AS TEXT) || ':' || hex(sql) AS frame FROM "
    "main.sqlite_schema WHERE name IN (?, ?, ?, ?, ?, ?, ?) ORDER BY type, name)"
)
_SOURCE_CATALOG_IDENTITIES: dict[str, tuple[str, str, str]] = {
    "ge_cycle_checkpoint_revisions": (
        "table",
        "ge_cycle_checkpoint_revisions",
        "6cd5ca1cb83b687ad5d545d03f0c15a3edb02c9d88c0afdd9984ae4376d44c5c",
    ),
    "ge_cycle_checkpoint_revisions_lookup_idx": (
        "index",
        "ge_cycle_checkpoint_revisions",
        "9e51c4c421ba6a66fd3bdced00ef64173635c35cff91bf4609d4e424c75c10d4",
    ),
    "ge_cycle_cursors": (
        "table",
        "ge_cycle_cursors",
        "519abf879eee49cee95d6c99c5026ca629fba7bdb5037a8791a5ec03f295dcb9",
    ),
    "ge_cycle_migration_lock": (
        "table",
        "ge_cycle_migration_lock",
        "ef0718cd3244fd1957cfd66356735c2c2e599c27194a9af9a102fc95ab6e7aca",
    ),
    "ge_cycle_records": (
        "table",
        "ge_cycle_records",
        "18864cc98a9b33c2e192473be94189f161fa21c3f0ece7489aa6f1a26fbd2cdc",
    ),
    "ge_cycle_records_stream_sequence_hash_uq": (
        "index",
        "ge_cycle_records",
        "69a32763f756ad96d8dbaee38e8d942ec6fd0e52ab568b024121fd3890acfc58",
    ),
    "ge_cycle_schema": (
        "table",
        "ge_cycle_schema",
        "24c4bca33d6d94e2c7ac2aa6b0655d0f34297497c9eb312f2bbbfe699a10f492",
    ),
}
_FORBIDDEN_EQP_FRAGMENTS = (
    "AUTOMATIC",
    "MATERIALIZE",
    "USE TEMP B-TREE",
    "CO-ROUTINE",
)


def _normalized_plan_detail(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip()).upper()


def accepts_sqlite_cursor_query_plan(
    kind: SQLiteCursorQueryPlanKind,
    sql: str,
    details: tuple[str, ...],
) -> bool:
    """Accept only the closed portable EQP shapes shared with TypeScript."""

    normalized = tuple(_normalized_plan_detail(detail) for detail in details)
    if any(fragment in detail for detail in normalized for fragment in _FORBIDDEN_EQP_FRAGMENTS):
        return False
    if kind == "source":
        return (
            sql == SQLITE_CURSOR_MAIN_PROJECTION_SQL
            and len(normalized) == 1
            and re.fullmatch(
                r"SCAN (?:MAIN\.)?GE_CYCLE_CURSORS(?: USING (?:COVERING )?(?:INDEX )?PRIMARY KEY)?",
                normalized[0],
            )
            is not None
        )
    if kind == "event-lookup":
        return (
            sql == SQLITE_CURSOR_EVENT_LOOKUP_SQL
            and len(normalized) == 1
            and re.fullmatch(
                r"SEARCH (?:MAIN\.)?GE_CYCLE_RECORDS USING COVERING INDEX "
                r"GE_CYCLE_RECORDS_STREAM_SEQUENCE_HASH_UQ "
                r"\(TENANT_ID=\? AND STREAM_ID=\? AND SEQUENCE=\? AND RECORD_HASH=\?\)",
                normalized[0],
            )
            is not None
        )
    if kind == "checkpoint-lookup":
        return (
            sql == SQLITE_CURSOR_CHECKPOINT_LOOKUP_SQL
            and len(normalized) == 1
            and re.fullmatch(
                r"SEARCH (?:MAIN\.)?GE_CYCLE_CHECKPOINT_REVISIONS USING INDEX "
                r"GE_CYCLE_CHECKPOINT_REVISIONS_LOOKUP_IDX "
                r"\(TENANT_ID=\? AND CHECKPOINT_SCOPE=\? AND CHECKPOINT_ID=\?\)",
                normalized[0],
            )
            is not None
        )
    if kind == "stage-insert":
        return sql == SQLITE_CURSOR_SEAL_INSERT_SQL and not normalized
    if kind == "count-marker":
        return sql == SQLITE_CURSOR_COUNT_MARKER_SQL and normalized == ("SCAN CONSTANT ROW",)
    if kind == "row-marker":
        return (
            sql in _ROW_MARKER_SQL
            and len(normalized) == 1
            and re.fullmatch(r"SCAN (?:TEMP\.)?GE_BLR_CURSOR_SEAL", normalized[0]) is not None
        )
    if kind == "stage-seal":
        return (
            sql == SQLITE_CURSOR_SEAL_PROJECTION_SQL
            and len(normalized) == 1
            and re.fullmatch(r"SCAN (?:TEMP\.)?GE_BLR_CURSOR_SEAL", normalized[0]) is not None
        )
    return False


if any(_normalized_sql_sha256(sql) != expected for sql, expected in _SQL_HASHES):
    raise AssertionError("SQLite cursor B2 SQL identity drifted")
if any(
    sql is not None and _normalized_sql_sha256(sql) != _ROW_MARKER_HASHES[index]
    for index, sql in enumerate(_ROW_MARKER_SQL)
):
    raise AssertionError("SQLite cursor B2 marker SQL identity drifted")


@dataclass(frozen=True, slots=True)
class SQLiteCursorDiagnostic:
    rule_id: SQLiteCursorRuleId
    violation_count: int
    diagnostics_truncated: bool


@dataclass(frozen=True, slots=True)
class SQLiteCursorPreRebindComplete:
    status: Literal["pre-rebind-complete"]
    projection_identity: BaselineProjectionIdentity
    diagnostics: tuple[()]
    receipt: SQLiteCursorPreRebindReceipt
    vector: tuple[
        Literal[0],
        Literal[0],
        Literal[0],
        Literal[0],
        Literal[0],
        Literal[0],
        Literal[0],
        Literal[0],
        Literal[0],
        Literal[0],
    ]


@dataclass(frozen=True, slots=True)
class SQLiteCursorDiagnosed:
    status: Literal["diagnosed"]
    projection_identity: BaselineProjectionIdentity
    diagnostics: tuple[SQLiteCursorDiagnostic, ...]
    vector: tuple[int, int, int, int, int, int, int, int, int, int]


SQLiteCursorCampaignOutcome: TypeAlias = SQLiteCursorPreRebindComplete | SQLiteCursorDiagnosed


@dataclass(slots=True)
class _SQLiteCursorCampaignResourceProbe:
    """Fixed-size test evidence; never published in a campaign outcome."""

    maximum_live_raw_rows: int = 0
    maximum_live_decoded_snapshots: int = 0
    maximum_live_carriers: int = 0
    maximum_fetch_size: int = 0
    maximum_active_registered_cursors: int = 0
    maximum_nested_point_lookups: int = 0
    maximum_temp_objects: int = 0
    maximum_temp_rows: int = 0
    current_live_raw_rows: int = 0
    current_live_decoded_snapshots: int = 0
    current_live_carriers: int = 0
    current_active_registered_cursors: int = 0
    current_nested_point_lookups: int = 0
    final_physical_temp_objects: int = 0
    final_physical_temp_rows: int = 0
    temp_object_measurements: int = 0
    eqp_evidence: tuple[tuple[SQLiteCursorQueryPlanKind, str, tuple[str, ...]], ...] = ()


_OWNER_EXECUTE = SQLiteV1BaselineConnectionOwner.execute
_OWNER_TOTAL_CHANGES_GETTER = cast(
    "object", SQLiteV1BaselineConnectionOwner.__dict__["total_changes"]
)
_CURSOR_FETCHONE = _SQLiteCursorCapability.fetchone
_CURSOR_CLOSE = _SQLiteCursorCapability.close
_CURSOR_ROWCOUNT_GETTER = cast("object", _SQLiteCursorCapability.__dict__["rowcount"])


def _total_changes(connection: SQLiteV1BaselineConnectionOwner) -> int:
    getter = cast(property, _OWNER_TOTAL_CHANGES_GETTER).fget
    assert getter is not None
    return cast(int, getter(connection))


def _rowcount(cursor: _SQLiteCursorCapability) -> int:
    getter = cast(property, _CURSOR_ROWCOUNT_GETTER).fget
    assert getter is not None
    return cast(int, getter(cursor))


def _is_exact_sqlite_one(row: object) -> bool:
    return type(row) is tuple and len(row) == 1 and type(row[0]) is int and row[0] == 1


def _source_catalog_snapshot(rows: tuple[tuple[object, ...], ...]) -> str:
    frames: list[str] = []
    for object_type, name, table_name, rootpage, sql in rows:
        frames.append(
            ":".join(
                (
                    cast(str, object_type).encode("utf-8").hex().upper(),
                    cast(str, name).encode("utf-8").hex().upper(),
                    cast(str, table_name).encode("utf-8").hex().upper(),
                    str(cast(int, rootpage)),
                    cast(str, sql).encode("utf-8").hex().upper(),
                )
            )
        )
    return "|".join(frames)


def _run_sqlite_cursor_pre_rebind_campaign(
    connection: SQLiteV1BaselineConnectionOwner,
    stage: SQLiteV1BaselineTempStage,
    receipt: SQLiteCursorPreRebindReceipt,
    transfer: _SQLiteCursorStageOwnershipTransfer,
    *,
    diagnostic_limit: int = DEFAULT_SQLITE_CURSOR_DIAGNOSTIC_LIMIT,
    cancellation: _SQLiteCursorCampaignCancellation | None = None,
    _resource_probe: _SQLiteCursorCampaignResourceProbe | None = None,
) -> SQLiteCursorCampaignOutcome:
    """Run one bounded B2 campaign from the exact retained B1 authority."""

    provenance = assert_sqlite_cursor_pre_rebind_receipt_provenance(receipt)
    authority: _SQLiteCursorPreRebindCampaignAuthority | None = None
    try:
        authority = _begin_sqlite_cursor_pre_rebind_campaign(connection, stage, receipt, transfer)
        if cancellation is not None and type(cancellation) is not _SQLiteCursorCampaignCancellation:
            raise TypeError("cursor campaign cancellation has the wrong type")
        if (
            _resource_probe is not None
            and type(_resource_probe) is not _SQLiteCursorCampaignResourceProbe
        ):
            raise TypeError("cursor campaign resource probe has the wrong type")
        if (
            type(diagnostic_limit) is not int
            or diagnostic_limit < 1
            or diagnostic_limit > MAX_SQLITE_CURSOR_DIAGNOSTIC_LIMIT
        ):
            raise ValueError("cursor diagnostic limit is outside bounds")
        pre_counts = [0] * 10
        source_count = 0
        staged_count = 0
        source_registered = False

        def reset_probe_currents() -> None:
            if _resource_probe is not None:
                _resource_probe.current_live_raw_rows = 0
                _resource_probe.current_live_decoded_snapshots = 0
                _resource_probe.current_live_carriers = 0
                _resource_probe.current_active_registered_cursors = 0
                _resource_probe.current_nested_point_lookups = 0

        def probe_registered_cursor() -> None:
            if _resource_probe is not None:
                _resource_probe.current_active_registered_cursors += 1
                _resource_probe.maximum_active_registered_cursors = max(
                    _resource_probe.maximum_active_registered_cursors,
                    _resource_probe.current_active_registered_cursors,
                )

        def probe_finalized_cursor() -> None:
            if _resource_probe is not None:
                _resource_probe.current_active_registered_cursors -= 1

        def probe_point_lookup_opened() -> None:
            if _resource_probe is not None and source_registered:
                _resource_probe.current_nested_point_lookups += 1
                _resource_probe.maximum_nested_point_lookups = max(
                    _resource_probe.maximum_nested_point_lookups,
                    _resource_probe.current_nested_point_lookups,
                )

        def probe_point_lookup_closed() -> None:
            if _resource_probe is not None and source_registered:
                _resource_probe.current_nested_point_lookups -= 1

        def poll_cancellation(label: str) -> None:
            if cancellation is not None:
                cancellation._poll(label)
            if cancellation is not None and cancellation._cancelled:
                raise SQLiteCursorCampaignCancelledError(
                    "BLR_CURSOR_CANCELLED: cursor campaign was cancelled"
                )

        def poll_exact(role: str, phase: str) -> None:
            label = f"{role}:{phase}"
            if label not in _EXACT_CANCELLATION_BOUNDARY_LABELS:
                raise AssertionError("cursor campaign exact cancellation label is not closed")
            poll_cancellation(label)

        def authority_fence() -> None:
            _assert_sqlite_cursor_pre_rebind_campaign(
                connection,
                stage,
                receipt,
                authority,
            )

        def read_source_catalog() -> tuple[tuple[object, ...], ...]:
            authority_fence()
            catalog_cursor = _OWNER_EXECUTE(
                connection,
                _SOURCE_CATALOG_SQL,
                _SOURCE_CATALOG_NAMES,
            )
            rows: list[tuple[object, ...]] = []
            primary: BaseException | None = None
            try:
                while len(rows) <= len(_SOURCE_CATALOG_NAMES):
                    authority_fence()
                    row = _CURSOR_FETCHONE(catalog_cursor)
                    authority_fence()
                    if row is None:
                        break
                    if (
                        len(row) != 5
                        or row[0] not in {"table", "index"}
                        or type(row[1]) is not str
                        or type(row[2]) is not str
                        or type(row[3]) is not int
                        or row[3] < 1
                        or type(row[4]) is not str
                    ):
                        raise ValueError("BLR_CURSOR_CATALOG: source catalog row is malformed")
                    expected = _SOURCE_CATALOG_IDENTITIES.get(row[1])
                    if (
                        expected is None
                        or (row[0], row[2]) != expected[:2]
                        or hashlib.sha256(row[4].encode("utf-8")).hexdigest() != expected[2]
                    ):
                        raise ValueError(
                            "BLR_CURSOR_CATALOG: source catalog canonical identity drifted"
                        )
                    rows.append(row)
                if len(rows) != len(_SOURCE_CATALOG_NAMES):
                    raise ValueError("BLR_CURSOR_CATALOG: source catalog inventory is incomplete")
                return tuple(rows)
            except BaseException as error:
                primary = error
                raise
            finally:
                try:
                    _CURSOR_CLOSE(catalog_cursor)
                except BaseException:
                    if primary is None:
                        raise
                if primary is None:
                    authority_fence()

        source_catalog = read_source_catalog()
        source_catalog_snapshot = _source_catalog_snapshot(source_catalog)

        def read_source_catalog_snapshot() -> str:
            authority_fence()
            catalog_cursor = _OWNER_EXECUTE(
                connection,
                _SOURCE_CATALOG_SNAPSHOT_SQL,
                _SOURCE_CATALOG_NAMES,
            )
            probe_point_lookup_opened()
            primary: BaseException | None = None
            try:
                row = _CURSOR_FETCHONE(catalog_cursor)
                authority_fence()
                if type(row) is not tuple or len(row) != 1 or type(row[0]) is not str:
                    raise ValueError("BLR_CURSOR_CATALOG: source catalog snapshot is malformed")
                terminal = _CURSOR_FETCHONE(catalog_cursor)
                authority_fence()
                if terminal is not None:
                    raise ValueError("BLR_CURSOR_CATALOG: source catalog snapshot is not scalar")
                return row[0]
            except BaseException as error:
                primary = error
                raise
            finally:
                try:
                    _CURSOR_CLOSE(catalog_cursor)
                except BaseException:
                    if primary is None:
                        raise
                probe_point_lookup_closed()
                if primary is None:
                    authority_fence()

        for phase in _CANCELLATION_PHASES:
            poll_exact("campaign", phase)

        def fence(*, cancellable: bool = True) -> None:
            authority_fence()
            if read_source_catalog_snapshot() != source_catalog_snapshot:
                raise ValueError("BLR_CURSOR_CATALOG: source catalog identity drifted")
            authority_fence()
            # Catalog/authority corruption has higher precedence than a
            # simultaneously requested cancellation.  Retain every closed
            # cancellation label, but poll it only after the complete scalar
            # snapshot, terminal-row proof, close and final authority fence.
            if cancellable:
                for phase in _CANCELLATION_PHASES:
                    poll_exact("catalog-snapshot", phase)

        def measure_temp_object_inventory() -> None:
            fence()
            poll_exact("temp-count", "before-prepare")
            cursor = _OWNER_EXECUTE(connection, SQLITE_CURSOR_TEMP_OBJECT_COUNT_SQL)
            primary: BaseException | None = None
            observed = -1
            try:
                poll_exact("temp-count", "after-prepare")
                poll_exact("temp-count", "before-fetch")
                row = _CURSOR_FETCHONE(cursor)
                fence(cancellable=False)
                if (
                    type(row) is not tuple
                    or len(row) != 1
                    or type(row[0]) is not int
                    or row[0] < 0
                    or row[0] > 1
                ):
                    raise ValueError("BLR_CURSOR_CATALOG: TEMP object count is malformed")
                observed = row[0]
                poll_exact("temp-count", "after-fetch")
                poll_exact("temp-count", "before-fetch")
                terminal = _CURSOR_FETCHONE(cursor)
                fence(cancellable=False)
                if terminal is not None:
                    raise ValueError("BLR_CURSOR_CATALOG: TEMP object count is not scalar")
                poll_exact("temp-count", "after-fetch")
                poll_exact("temp-count", "before-close")
            except BaseException as error:
                primary = error
                raise
            finally:
                try:
                    _CURSOR_CLOSE(cursor)
                except BaseException:
                    if primary is None:
                        raise
                if primary is None:
                    poll_exact("temp-count", "after-close")
            if _resource_probe is not None:
                _resource_probe.temp_object_measurements += 1
                _resource_probe.final_physical_temp_objects = observed
                _resource_probe.maximum_temp_objects = max(
                    _resource_probe.maximum_temp_objects, observed
                )
            if observed != 1:
                raise ValueError("BLR_CURSOR_CATALOG: TEMP object inventory drifted")
            fence()

        measure_temp_object_inventory()

        def assert_eqp(
            kind: SQLiteCursorQueryPlanKind,
            sql: str,
            parameters: tuple[object, ...],
            role: str,
        ) -> None:
            fence()
            poll_exact(role, "before-prepare")
            eqp_cursor = _OWNER_EXECUTE(
                connection,
                f"EXPLAIN QUERY PLAN {sql}",
                parameters,
            )
            try:
                _register_sqlite_cursor_campaign_cursor(
                    connection, stage, receipt, authority, eqp_cursor, "eqp", None
                )
            except BaseException:
                with suppress(BaseException):
                    _CURSOR_CLOSE(eqp_cursor)
                raise
            probe_registered_cursor()
            details: list[str] = []
            primary: BaseException | None = None
            try:
                fence(cancellable=False)
                poll_exact(role, "after-prepare")
                while len(details) <= 16:
                    fence()
                    poll_exact(role, "before-fetch")
                    row = _CURSOR_FETCHONE(eqp_cursor)
                    fence(cancellable=False)
                    if row is None:
                        poll_exact(role, "after-fetch")
                        break
                    if len(row) != 4 or type(row[3]) is not str:
                        raise ValueError("BLR_CURSOR_EQP: query plan row is malformed")
                    details.append(row[3])
                    poll_exact(role, "after-fetch")
                if len(details) > 16:
                    raise ValueError("BLR_CURSOR_EQP: query plan is outside bounds")
                if not accepts_sqlite_cursor_query_plan(kind, sql, tuple(details)):
                    raise ValueError("BLR_CURSOR_EQP: query plan is not accepted")
                if _resource_probe is not None:
                    _resource_probe.eqp_evidence += ((kind, sql, tuple(details)),)
                poll_exact(role, "before-close")
            except BaseException as error:
                primary = error
                raise
            finally:
                _finalize_sqlite_cursor_campaign_cursor(
                    connection,
                    stage,
                    receipt,
                    authority,
                    eqp_cursor,
                    primary=primary,
                )
                probe_finalized_cursor()
            poll_exact(role, "after-close")
            fence()

        assert_eqp(
            "source",
            SQLITE_CURSOR_MAIN_PROJECTION_SQL,
            (),
            "eqp-source",
        )
        assert_eqp(
            "stage-insert",
            SQLITE_CURSOR_SEAL_INSERT_SQL,
            (None,) * 30,
            "eqp-stage-insert",
        )
        assert_eqp(
            "stage-seal",
            SQLITE_CURSOR_SEAL_PROJECTION_SQL,
            (),
            "eqp-stage-seal",
        )
        assert_eqp(
            "count-marker",
            SQLITE_CURSOR_COUNT_MARKER_SQL,
            (0, 0, 0, 0, diagnostic_limit + 1),
            "eqp-count-marker",
        )
        assert_eqp(
            "event-lookup",
            SQLITE_CURSOR_EVENT_LOOKUP_SQL,
            ("eqp", "eqp", 0, "0" * 64),
            "eqp-event-lookup",
        )
        assert_eqp(
            "checkpoint-lookup",
            SQLITE_CURSOR_CHECKPOINT_LOOKUP_SQL,
            ("eqp", "eqp", "eqp", b"{}"),
            "eqp-checkpoint-lookup",
        )
        for marker_index, marker_sql in enumerate(_ROW_MARKER_SQL):
            if marker_sql is not None:
                assert_eqp(
                    "row-marker",
                    marker_sql,
                    (diagnostic_limit + 1,),
                    f"eqp-{_RULES[marker_index][0]}",
                )

        def lookup(sql: str, parameters: tuple[object, ...]) -> bool:
            lookup_prefix = "event" if sql == SQLITE_CURSOR_EVENT_LOOKUP_SQL else "checkpoint"
            fence()
            role = f"{lookup_prefix}-lookup"
            poll_exact(role, "before-prepare")
            cursor = _OWNER_EXECUTE(connection, sql, parameters)
            probe_point_lookup_opened()
            primary: BaseException | None = None
            try:
                poll_exact(role, "after-prepare")
                authority_fence()
                poll_exact(role, "before-fetch")
                row = _CURSOR_FETCHONE(cursor)
                authority_fence()
                if row is not None and not _is_exact_sqlite_one(row):
                    raise ValueError("BLR_CURSOR_STATEMENT: lookup marker is malformed")
                poll_exact(role, "after-fetch")
                poll_exact(role, "before-close")
                return row is not None
            except BaseException as error:
                primary = error
                raise
            finally:
                try:
                    _CURSOR_CLOSE(cursor)
                except BaseException:
                    if primary is None:
                        raise
                probe_point_lookup_closed()
                if primary is None:
                    poll_exact(role, "after-close")
                    fence()

        def read_identity_and_count() -> tuple[int, int, str, str]:
            fence()
            poll_exact("identity", "before-prepare")
            cursor = _OWNER_EXECUTE(
                connection,
                "SELECT (SELECT count(*) FROM main.ge_cycle_cursors), "
                "(SELECT updated_at_ms FROM main.ge_cycle_migration_lock WHERE singleton = 1), "
                "schema_identity_sha256, provider_descriptor_hash "
                "FROM main.ge_cycle_schema WHERE singleton = 1",
            )
            primary: BaseException | None = None
            try:
                poll_exact("identity", "after-prepare")
                fence()
                poll_exact("identity", "before-fetch")
                row = _CURSOR_FETCHONE(cursor)
                fence(cancellable=False)
                if (
                    row is None
                    or len(row) != 4
                    or type(row[0]) is not int
                    or type(row[1]) is not int
                    or type(row[2]) is not str
                    or type(row[3]) is not str
                ):
                    raise ValueError("BLR_CURSOR_CATALOG: source identity row is malformed")
                poll_exact("identity", "after-fetch")
                poll_exact("identity", "before-close")
                return cast("tuple[int, int, str, str]", row)
            except BaseException as error:
                primary = error
                raise
            finally:
                try:
                    _CURSOR_CLOSE(cursor)
                except BaseException:
                    if primary is None:
                        raise
                if primary is None:
                    poll_exact("identity", "after-close")
                    fence()

        def read_temp_count() -> int:
            fence()
            poll_exact("temp-count", "before-prepare")
            cursor = _OWNER_EXECUTE(
                connection,
                "SELECT count(*) FROM temp.ge_blr_cursor_seal",
            )
            primary: BaseException | None = None
            try:
                poll_exact("temp-count", "after-prepare")
                fence()
                poll_exact("temp-count", "before-fetch")
                row = _CURSOR_FETCHONE(cursor)
                fence(cancellable=False)
                if row is None or len(row) != 1 or type(row[0]) is not int or row[0] < 0:
                    raise ValueError("BLR_CURSOR_CATALOG: TEMP count row is malformed")
                poll_exact("temp-count", "after-fetch")
                poll_exact("temp-count", "before-close")
                return row[0]
            except BaseException as error:
                primary = error
                raise
            finally:
                try:
                    _CURSOR_CLOSE(cursor)
                except BaseException:
                    if primary is None:
                        raise
                if primary is None:
                    poll_exact("temp-count", "after-close")
                    fence()

        captured_main_count, high_water, schema_identity, descriptor_hash = (
            read_identity_and_count()
        )
        if (
            high_water != provenance.clock_evidence.provider_high_water_at_ms
            or schema_identity != provenance.immutable_seal_receipt.source_schema_identity_sha256
            or descriptor_hash != provenance.immutable_seal_receipt.source_descriptor_hash
        ):
            raise ValueError("BLR_CURSOR_STALE_AUTHORITY: source identity drifted")

        fence()
        poll_exact("source", "before-prepare")
        cursor = _OWNER_EXECUTE(connection, SQLITE_CURSOR_MAIN_PROJECTION_SQL)
        try:
            _register_sqlite_cursor_campaign_cursor(
                connection, stage, receipt, authority, cursor, "source", None
            )
        except BaseException:
            with suppress(BaseException):
                _CURSOR_CLOSE(cursor)
            raise
        probe_registered_cursor()
        source_registered = True
        primary: BaseException | None = None
        try:
            poll_exact("source", "after-prepare")
            fence()
            while True:
                fence()
                poll_exact("source", "before-fetch")
                row = _CURSOR_FETCHONE(cursor)
                fence(cancellable=False)
                if row is None:
                    poll_exact("source", "after-fetch")
                    break
                poll_exact("source", "after-fetch")
                if _resource_probe is not None:
                    _resource_probe.maximum_fetch_size = max(_resource_probe.maximum_fetch_size, 1)
                    _resource_probe.current_live_raw_rows += 1
                    _resource_probe.maximum_live_raw_rows = max(
                        _resource_probe.maximum_live_raw_rows,
                        _resource_probe.current_live_raw_rows,
                    )
                    _resource_probe.current_live_decoded_snapshots += 1
                    _resource_probe.maximum_live_decoded_snapshots = max(
                        _resource_probe.maximum_live_decoded_snapshots,
                        _resource_probe.current_live_decoded_snapshots,
                    )
                try:
                    poll_exact("inspect", "before-prepare")
                    poll_exact("inspect", "after-prepare")
                    poll_exact("inspect", "before-fetch")
                    inspected = _inspect_sqlite_v1_cursor_row(
                        row,
                        source_ordinal=source_count + 1,
                        source_descriptor_hash=provenance.immutable_seal_receipt.source_descriptor_hash,
                        source_schema_identity_sha256=provenance.immutable_seal_receipt.source_schema_identity_sha256,
                        provider_high_water_at_ms=provenance.clock_evidence.provider_high_water_at_ms,
                        event_tail_exists=lambda tenant, stream, sequence, record_hash: lookup(
                            SQLITE_CURSOR_EVENT_LOOKUP_SQL,
                            (tenant, stream, sequence, record_hash),
                        ),
                        checkpoint_revision_exists=lambda tenant, scope, checkpoint_id, summary: (
                            lookup(
                                SQLITE_CURSOR_CHECKPOINT_LOOKUP_SQL,
                                (tenant, scope, checkpoint_id, summary),
                            )
                        ),
                    )
                    poll_exact("inspect", "after-fetch")
                    poll_exact("inspect", "before-close")
                    poll_exact("inspect", "after-close")
                finally:
                    if _resource_probe is not None:
                        _resource_probe.current_live_decoded_snapshots -= 1
                fence(cancellable=False)
                source_count += 1
                if not inspected.stageable:
                    # A non-TEXT/missing source key cannot be staged, but the
                    # authorization unit must not disappear behind Rule 8.
                    if not inspected.source_key_storage_ok:
                        pre_counts[0] += 1
                    pre_counts[7] += 1
                    if _resource_probe is not None:
                        _resource_probe.current_live_raw_rows -= 1
                    del inspected, row
                    continue
                before_changes = _total_changes(connection)
                fence()
                poll_exact("insert", "before-prepare")
                insert_cursor = _OWNER_EXECUTE(
                    connection, SQLITE_CURSOR_SEAL_INSERT_SQL, inspected.insert_values
                )
                insert_primary: BaseException | None = None
                try:
                    poll_exact("insert", "after-prepare")
                    poll_exact("insert", "before-fetch")
                    insert_rowcount = _rowcount(insert_cursor)
                    poll_exact("insert", "after-fetch")
                    poll_exact("insert", "before-close")
                except BaseException as error:
                    insert_primary = error
                    raise
                finally:
                    try:
                        _CURSOR_CLOSE(insert_cursor)
                    except BaseException:
                        if insert_primary is None:
                            raise
                    if insert_primary is None:
                        poll_exact("insert", "after-close")
                _adopt_sqlite_cursor_campaign_insert(
                    connection,
                    stage,
                    receipt,
                    authority,
                    before_changes,
                    insert_rowcount,
                )
                fence()
                staged_count += 1
                if _resource_probe is not None:
                    _resource_probe.final_physical_temp_rows = staged_count
                    _resource_probe.maximum_temp_rows = max(
                        _resource_probe.maximum_temp_rows,
                        _resource_probe.final_physical_temp_rows,
                    )
                if _resource_probe is not None:
                    _resource_probe.current_live_raw_rows -= 1
                del inspected, row
            poll_exact("source", "before-close")
        except BaseException as error:
            primary = error
            raise
        finally:
            _finalize_sqlite_cursor_campaign_cursor(
                connection, stage, receipt, authority, cursor, primary=primary
            )
            probe_finalized_cursor()
            source_registered = False
        poll_exact("source", "after-close")
        fence()
        measure_temp_object_inventory()

        physical_temp_count = read_temp_count()
        if physical_temp_count != staged_count:
            raise ValueError("BLR_CURSOR_CATALOG: TEMP insert inventory drifted")
        vector: list[int] = []
        diagnostics: list[SQLiteCursorDiagnostic] = []
        for rule_index, (rule_id, _flag) in enumerate(_RULES):
            sql = _ROW_MARKER_SQL[rule_index]
            parameters: tuple[object, ...]
            if sql is None:
                sql = SQLITE_CURSOR_COUNT_MARKER_SQL
                parameters = (
                    provenance.immutable_seal_receipt.cursor_count,
                    source_count,
                    source_count,
                    physical_temp_count,
                    diagnostic_limit + 1,
                )
            else:
                parameters = (diagnostic_limit + 1,)
            fence()
            poll_exact(rule_id, "before-prepare")
            marker = _OWNER_EXECUTE(connection, sql, parameters)
            try:
                _register_sqlite_cursor_campaign_cursor(
                    connection, stage, receipt, authority, marker, "marker", rule_index
                )
            except BaseException:
                with suppress(BaseException):
                    _CURSOR_CLOSE(marker)
                raise
            probe_registered_cursor()
            observed = pre_counts[rule_index]
            marker_primary: BaseException | None = None
            try:
                poll_exact(rule_id, "after-prepare")
                fence()
                while observed <= diagnostic_limit:
                    fence()
                    poll_exact(rule_id, "before-fetch")
                    result = _CURSOR_FETCHONE(marker)
                    fence(cancellable=False)
                    if result is None:
                        poll_exact(rule_id, "after-fetch")
                        break
                    if not _is_exact_sqlite_one(result):
                        raise ValueError("BLR_CURSOR_STATEMENT: rule marker is malformed")
                    observed += 1
                    poll_exact(rule_id, "after-fetch")
                poll_exact(rule_id, "before-close")
            except BaseException as error:
                marker_primary = error
                raise
            finally:
                _finalize_sqlite_cursor_campaign_cursor(
                    connection, stage, receipt, authority, marker, primary=marker_primary
                )
                probe_finalized_cursor()
            poll_exact(rule_id, "after-close")
            fence()
            capped = min(observed, diagnostic_limit)
            vector.append(capped)
            if observed:
                diagnostics.append(
                    SQLiteCursorDiagnostic(rule_id, capped, observed > diagnostic_limit)
                )

        projection = provenance.projection_identity
        final_main_count, final_high_water, final_schema, final_descriptor = (
            read_identity_and_count()
        )
        if (
            final_main_count != captured_main_count
            or final_high_water != high_water
            or final_schema != schema_identity
            or final_descriptor != descriptor_hash
        ):
            raise ValueError("BLR_CURSOR_STALE_AUTHORITY: source identity drifted")
        if diagnostics:
            outcome = SQLiteCursorDiagnosed(
                "diagnosed",
                projection,
                tuple(diagnostics),
                cast("tuple[int, int, int, int, int, int, int, int, int, int]", tuple(vector)),
            )
            fence()
            measure_temp_object_inventory()
            for phase in _CANCELLATION_PHASES:
                poll_exact("diagnosed-publication", phase)
            _complete_sqlite_cursor_pre_rebind_campaign(
                connection, stage, receipt, authority, "diagnosed"
            )
            reset_probe_currents()
            return outcome

        fence()
        poll_exact("seal", "before-prepare")
        seal_cursor = _OWNER_EXECUTE(connection, SQLITE_CURSOR_SEAL_PROJECTION_SQL)
        try:
            _register_sqlite_cursor_campaign_cursor(
                connection, stage, receipt, authority, seal_cursor, "seal", None
            )
        except BaseException:
            with suppress(BaseException):
                _CURSOR_CLOSE(seal_cursor)
            raise
        probe_registered_cursor()
        retained_cursor_count = provenance.immutable_seal_receipt.cursor_count
        if source_count != retained_cursor_count:
            raise AssertionError("SQLite cursor Rule 7 zero-count invariant drifted")
        accumulator = SQLiteCursorSealAccumulator(
            retained_cursor_count,
            provenance.immutable_seal_receipt.source_descriptor_hash,
            provenance.immutable_seal_receipt.source_schema_identity_sha256,
        )
        seal_primary: BaseException | None = None
        try:
            poll_exact("seal", "after-prepare")
            fence()
            while True:
                fence()
                poll_exact("seal", "before-fetch")
                row = _CURSOR_FETCHONE(seal_cursor)
                fence(cancellable=False)
                if row is None:
                    poll_exact("seal", "after-fetch")
                    break
                poll_exact("seal", "after-fetch")
                if _resource_probe is not None:
                    _resource_probe.maximum_fetch_size = max(_resource_probe.maximum_fetch_size, 1)
                    _resource_probe.current_live_raw_rows += 1
                    _resource_probe.maximum_live_raw_rows = max(
                        _resource_probe.maximum_live_raw_rows,
                        _resource_probe.current_live_raw_rows,
                    )
                    _resource_probe.current_live_carriers += 1
                    _resource_probe.maximum_live_carriers = max(
                        _resource_probe.maximum_live_carriers,
                        _resource_probe.current_live_carriers,
                    )
                carrier = SQLiteCursorImmutableSealCarrier(
                    tenant_id=cast(str, row[0]),
                    token_hash=cast(str, row[1]),
                    kind=cast(str, row[2]),
                    principal_hash=cast(str, row[3]),
                    authorization_hash=cast(str, row[4]),
                    stream_id=cast(str | None, row[5]),
                    checkpoint_scope=cast(str | None, row[6]),
                    request_scope_byte_length=cast(int, row[7]),
                    request_scope_blob_sha256=cast(str, row[8]),
                    page_size=cast(int, row[9]),
                    next_position=cast(int, row[10]),
                    snapshot_tail_sequence=cast(int | None, row[11]),
                    snapshot_tail_record_hash=cast(str | None, row[12]),
                    snapshot_byte_length=cast(int, row[13]),
                    snapshot_blob_sha256=cast(str, row[14]),
                    created_at_ms=cast(int, row[15]),
                    expires_at_ms=cast(int, row[16]),
                    consumed_at_ms=cast(int | None, row[17]),
                )
                accumulator.append(
                    SQLiteCursorSealRow(carrier, cast(str, row[18]), cast(str, row[19]))
                )
                if _resource_probe is not None:
                    _resource_probe.current_live_carriers -= 1
                    _resource_probe.current_live_raw_rows -= 1
                del carrier, row
            poll_exact("seal", "before-close")
        except BaseException as error:
            seal_primary = error
            raise
        finally:
            _finalize_sqlite_cursor_campaign_cursor(
                connection, stage, receipt, authority, seal_cursor, primary=seal_primary
            )
            probe_finalized_cursor()
        poll_exact("seal", "after-close")
        fence()
        fresh = accumulator.finish()
        if fresh != provenance.immutable_seal_receipt:
            raise ValueError("BLR_CURSOR_STALE_AUTHORITY: cursor immutable root drifted")
        publish_main_count, publish_high_water, publish_schema, publish_descriptor = (
            read_identity_and_count()
        )
        if (
            publish_main_count != captured_main_count
            or publish_high_water != high_water
            or publish_schema != schema_identity
            or publish_descriptor != descriptor_hash
        ):
            raise ValueError("BLR_CURSOR_STALE_AUTHORITY: source identity drifted")
        assert_sqlite_cursor_pre_rebind_receipt_provenance(receipt)
        complete_outcome = SQLiteCursorPreRebindComplete(
            "pre-rebind-complete",
            projection,
            (),
            receipt,
            (0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
        )
        fence()
        measure_temp_object_inventory()
        for phase in _CANCELLATION_PHASES:
            poll_exact("clean-publication", phase)
        _complete_sqlite_cursor_pre_rebind_campaign(
            connection, stage, receipt, authority, "pre-rebind-complete"
        )
        reset_probe_currents()
        return complete_outcome
    except BaseException as primary:
        if _resource_probe is not None:
            _resource_probe.current_live_raw_rows = 0
            _resource_probe.current_live_decoded_snapshots = 0
            _resource_probe.current_live_carriers = 0
            _resource_probe.current_active_registered_cursors = 0
            _resource_probe.current_nested_point_lookups = 0
        if authority is not None:
            _abort_sqlite_cursor_pre_rebind_campaign(connection, stage, receipt, authority, primary)
        raise
