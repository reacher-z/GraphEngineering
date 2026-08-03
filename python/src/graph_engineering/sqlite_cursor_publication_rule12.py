"""Package-private Rule 12 owner for the SQLite cursor publication leaf.

This module authenticates the exact Rule 11 graph, drives the connection-owned
constant-space seal reader, and mints one opaque Rule 12 receipt only after all
available count, root, identity, lifecycle, resource, and transaction evidence
agrees.  It deliberately does not observe the third clock or expose a public
API.
"""

from __future__ import annotations

from contextlib import suppress
from dataclasses import dataclass
from typing import Any, Literal, NamedTuple, Never, cast
from weakref import ReferenceType, WeakKeyDictionary, ref

from .sqlite_cursor_publication_outer_authority import (
    _adopt_sqlite_cursor_pre_verification_clock_evidence_intrinsic,
    _adopt_sqlite_cursor_rule12_seal_acceptance_intrinsic,
    _assert_sqlite_cursor_outer_publication_authority_intrinsic,
    _assert_sqlite_cursor_post_ddl_catalog_fence_intrinsic,
    _is_sqlite_cursor_publication_session_cancellation_requested_intrinsic,
    _publication_session_state,
    _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic,
    _read_sqlite_cursor_publication_rebind_context_snapshot_intrinsic,
    _SQLiteCursorPublicationSessionCancellationSignal,
)
from .sqlite_cursor_publication_subprotocol import (
    _assert_sqlite_cursor_publication_rule11_rule12_successor_intrinsic,
    _complete_sqlite_cursor_publication_rule11_for_rule12_intrinsic,
    _poison_sqlite_cursor_publication_rule11_for_rule12_intrinsic,
    _prepare_sqlite_cursor_publication_rule11_for_rule12_intrinsic,
    _read_sqlite_cursor_publication_rebind_write_receipt_snapshot_intrinsic,
    _read_sqlite_cursor_publication_rule11_receipt_snapshot_intrinsic,
    _SQLiteCursorPublicationRebindWriteReceipt,
    _SQLiteCursorPublicationRule11SuccessReceipt,
)
from .sqlite_operation_baseline_cursor_invariants import (
    SQLITE_CURSOR_SEAL_ALGORITHM_VERSION,
    SQLITE_CURSOR_SEAL_DOMAIN,
    SQLITE_CURSOR_SEAL_EMPTY_ROOT,
    SQLITE_CURSOR_SEAL_ROW_DOMAIN,
)
from .sqlite_operation_baseline_cursor_ownership import (
    assert_sqlite_cursor_pre_rebind_receipt_provenance,
)
from .sqlite_operation_baseline_source import (
    SQLITE_CURSOR_PUBLICATION_SEAL_KEY_DRIVER_SQL_INTRINSIC,
    SQLITE_CURSOR_PUBLICATION_SEAL_KEY_DRIVER_SQL_SHA256_INTRINSIC,
    SQLITE_CURSOR_PUBLICATION_SEAL_MAIN_KEY_SCAN_SQL_INTRINSIC,
    SQLITE_CURSOR_PUBLICATION_SEAL_MAIN_KEY_SCAN_SQL_SHA256_INTRINSIC,
    SQLITE_CURSOR_PUBLICATION_SEAL_POINT_LOOKUP_SQL_INTRINSIC,
    SQLITE_CURSOR_PUBLICATION_SEAL_POINT_LOOKUP_SQL_SHA256_INTRINSIC,
    _begin_sqlite_connection_cursor_publication_seal_read_intrinsic,
    _execute_sqlite_connection_cursor_publication_seal_read_intrinsic,
    _read_sqlite_connection_cursor_publication_seal_read_snapshot_intrinsic,
    _release_sqlite_connection_cursor_publication_seal_read_intrinsic,
    _SQLiteConnectionCursorPublicationSealReadExecution,
)

_CONSTRUCTION_TOKEN = object()
_RULE_ID: Literal["BLR_CURSOR_SEAL_MISMATCH"] = "BLR_CURSOR_SEAL_MISMATCH"
_POSITION: Literal[12] = 12
_MAIN_BYTE_ORDER = ("tenant_id:utf8-bytes", "token_hash:utf8-bytes")
_SEAL_BYTE_ORDER = ("token_hash:utf8-bytes", "tenant_id:utf8-bytes")
_READ_SQL_SHA256 = (
    SQLITE_CURSOR_PUBLICATION_SEAL_MAIN_KEY_SCAN_SQL_SHA256_INTRINSIC,
    SQLITE_CURSOR_PUBLICATION_SEAL_KEY_DRIVER_SQL_SHA256_INTRINSIC,
    SQLITE_CURSOR_PUBLICATION_SEAL_POINT_LOOKUP_SQL_SHA256_INTRINSIC,
)

_ID = id
_TYPE = type
_DICT_GET = dict.get
_DICT_SET = dict.__setitem__
_DICT_POP = dict.pop


def _fail(code: str) -> Never:
    raise ValueError(code)


class _SQLiteCursorPublicationRule12SuccessReceipt:
    """Opaque, module-minted proof of one exact bounded Rule 12 read."""

    __slots__ = ("__state", "__weakref__")

    def __init__(self, token: object) -> None:
        if token is not _CONSTRUCTION_TOKEN:
            raise TypeError("GE_CURSOR_B3_RULE12_RECEIPT")
        object.__setattr__(self, "_SQLiteCursorPublicationRule12SuccessReceipt__state", None)

    def __setattr__(self, _name: str, _value: object) -> None:
        raise TypeError("GE_CURSOR_B3_RULE12_RECEIPT")


class _SQLiteCursorRule12ThirdObservationAuthorization:
    """Opaque one-shot authorization bound to one exact active R12 graph."""

    __slots__ = ("__weakref__",)

    def __init__(self, token: object) -> None:
        if token is not _CONSTRUCTION_TOKEN:
            raise TypeError("GE_CURSOR_B3_RULE12_THIRD_AUTHORITY")


class _SQLiteCursorPublicationRule12SuccessReceiptSnapshot(NamedTuple):
    lifecycle: Literal[
        "active",
        "third-observation-pending",
        "pre-verification-clock-read-unconsumed",
    ]
    rule_id: Literal["BLR_CURSOR_SEAL_MISMATCH"]
    position: Literal[12]
    rule11_receipt: _SQLiteCursorPublicationRule11SuccessReceipt
    write_receipt: _SQLiteCursorPublicationRebindWriteReceipt
    publication_session: object
    context: object
    watermark_adoption: object
    seal_read_execution: _SQLiteConnectionCursorPublicationSealReadExecution
    seal_algorithm_version: str
    seal_row_domain: bytes
    seal_domain: bytes
    main_key_byte_order: tuple[str, str]
    seal_byte_order: tuple[str, str]
    main_key_scan_sql: str
    key_driver_sql: str
    point_lookup_sql: str
    main_key_count: int
    driver_count: int
    lookup_count: int
    receipt_count: int
    accumulator_count: int
    receipt_immutable_root_sha256: str
    computed_immutable_root_sha256: str
    target_descriptor_hash: str
    target_schema_identity_sha256: str
    main_key_prepare_count: Literal[1]
    main_key_terminal_fetch_count: Literal[1]
    main_key_close_attempt_count: Literal[1]
    main_key_close_count: Literal[1]
    driver_prepare_count: Literal[1]
    driver_terminal_fetch_count: Literal[1]
    driver_close_attempt_count: Literal[1]
    driver_close_count: Literal[1]
    point_statement_prepare_count: Literal[1]
    point_statement_execute_count: int
    point_statement_release_count: Literal[1]
    point_cursor_created_count: int
    point_cursor_close_attempt_count: int
    point_cursor_closed_count: int
    active_cursor_count: Literal[0]
    maximum_active_cursor_count: int
    live_physical_row_count: Literal[0]
    maximum_live_physical_row_count: int
    live_carrier_count: Literal[0]
    maximum_live_carrier_count: int
    violation_count: Literal[0]
    diagnostics_truncated: Literal[False]
    connection: object
    transaction_generation: object
    historical_transaction_epoch: int
    transaction_epoch: int
    historical_total_changes: int
    total_changes: int
    total_changes_delta: Literal[0]
    migration_lock_capability: object
    provider_clock_capability: object
    outer_clock_evidence: object
    outer_clock_consumed_tombstone: object
    pre_rebind_clock_evidence: object
    pre_rebind_clock_consumed_tombstone: object
    pre_rebind_receipt: object
    pre_rebind_receipt_sha256: str
    query_plans: object
    pre_verification_clock_evidence: object | None


@dataclass(slots=True)
class _Rule12Record:
    snapshot: _SQLiteCursorPublicationRule12SuccessReceiptSnapshot
    poisoned: bool = False
    third_authorization: _SQLiteCursorRule12ThirdObservationAuthorization | None = None


@dataclass(frozen=True, slots=True)
class _IdentityEntry:
    key_ref: ReferenceType[Any]
    value: object


_RECEIPTS: WeakKeyDictionary[
    _SQLiteCursorPublicationRule12SuccessReceipt, bool
] = WeakKeyDictionary()
_THIRD_AUTHORIZATIONS: dict[int, _IdentityEntry] = {}


def _clear_third_authorization(record: _Rule12Record) -> None:
    token = record.third_authorization
    if token is None:
        return
    current = _DICT_GET(_THIRD_AUTHORIZATIONS, _ID(token))
    if current is not None and current.key_ref() is token:
        _DICT_POP(_THIRD_AUTHORIZATIONS, _ID(token), None)
    record.third_authorization = None


def _register_receipt(
    receipt: _SQLiteCursorPublicationRule12SuccessReceipt,
    record: _Rule12Record,
) -> None:
    object.__setattr__(
        receipt,
        "_SQLiteCursorPublicationRule12SuccessReceipt__state",
        record,
    )
    _RECEIPTS[receipt] = True


def _record_for(
    receipt: _SQLiteCursorPublicationRule12SuccessReceipt,
) -> _Rule12Record:
    if _TYPE(receipt) is not _SQLiteCursorPublicationRule12SuccessReceipt:
        _fail("GE_CURSOR_B3_RULE12_RECEIPT")
    try:
        registered = _RECEIPTS.get(receipt)
    except TypeError:
        registered = None
    if registered is not True:
        _fail("GE_CURSOR_B3_RULE12_RECEIPT")
    record = object.__getattribute__(
        receipt,
        "_SQLiteCursorPublicationRule12SuccessReceipt__state",
    )
    if _TYPE(record) is not _Rule12Record or record.poisoned:
        _fail("GE_CURSOR_B3_RULE12_RECEIPT")
    return record


def _authenticate_graph(
    rule11: _SQLiteCursorPublicationRule11SuccessReceipt,
) -> tuple[Any, Any, Any, Any]:
    rule11_snapshot = (
        _read_sqlite_cursor_publication_rule11_receipt_snapshot_intrinsic(rule11)
    )
    write = _read_sqlite_cursor_publication_rebind_write_receipt_snapshot_intrinsic(
        rule11_snapshot.write_receipt
    )
    context = _read_sqlite_cursor_publication_rebind_context_snapshot_intrinsic(
        write.context
    )
    authority = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(
        write.outer_authority
    )
    if not (
        rule11_snapshot.rule_id == "BLR_CURSOR_REBIND_COUNT"
        and rule11_snapshot.position == 11
        and write.lifecycle == "rule11-complete"
        and context.lifecycle == "write-adopted"
        and authority.lifecycle == "active"
        and authority.write_phase
        in {
            "cursor-rebind-adopted",
            "rule12-seal-accepted",
            "pre-verification-clock-read-unconsumed",
        }
        and context.session is write.session
        and context.authority is write.outer_authority
        and context.prepared_owner is write.prepared_owner
        and context.execution is write.rebind_execution
        and context.connection is write.connection
        and authority.publication_rebind_context is write.context
        and authority.publication_session_consumed_tombstone
        is write.consumed_tombstone
        and authority.post_rebind_watermark_adoption is write.post_rebind_adoption
        and authority.connection is write.connection
        and authority.receipt is context.receipt
        and rule11_snapshot.transaction_generation is write.transaction_generation
        and context.transaction_generation is write.transaction_generation
        and authority.transaction_generation is write.transaction_generation
        and rule11_snapshot.transaction_epoch == write.transaction_epoch_after
        and rule11_snapshot.total_changes == write.total_changes_after
        and rule11_snapshot.counts == write.counts
        and tuple(rule11_snapshot.counts) == (context.b2_cursor_count,) * 5
    ):
        _fail("GE_CURSOR_B3_RULE12_GRAPH")
    return rule11_snapshot, write, context, authority


def _validate_seal_snapshot(
    seal: Any,
    rule11_snapshot: Any,
    write: Any,
    context: Any,
) -> None:
    expected_count = context.b2_cursor_count
    query_plans = context.rule12_query_plans
    counts = (
        seal.main_key_row_count,
        seal.driver_row_count,
        seal.lookup_row_count,
        expected_count,
        seal.accumulator_row_count,
    )
    if not (
        seal.lifecycle == "completed"
        and seal.execute_count == 1
        and seal.release_count == 0
        and counts == (expected_count,) * 5
        and rule11_snapshot.counts == (expected_count,) * 5
        and seal.computed_immutable_root_sha256 == context.b2_immutable_root_sha256
        and (
            (
                expected_count == 0
                and seal.observed_descriptor_hash is None
                and seal.observed_schema_identity_sha256 is None
                and seal.computed_immutable_root_sha256
                == SQLITE_CURSOR_SEAL_EMPTY_ROOT
            )
            or (
                expected_count > 0
                and
                seal.observed_descriptor_hash == context.target_descriptor_hash
                and seal.observed_schema_identity_sha256
                == context.target_schema_identity
            )
        )
        and seal.main_key_scan_sql
        == SQLITE_CURSOR_PUBLICATION_SEAL_MAIN_KEY_SCAN_SQL_INTRINSIC
        and seal.main_key_scan_sql_sha256 == _READ_SQL_SHA256[0]
        and seal.key_driver_sql
        == SQLITE_CURSOR_PUBLICATION_SEAL_KEY_DRIVER_SQL_INTRINSIC
        and seal.key_driver_sql_sha256 == _READ_SQL_SHA256[1]
        and seal.point_lookup_sql
        == SQLITE_CURSOR_PUBLICATION_SEAL_POINT_LOOKUP_SQL_INTRINSIC
        and seal.point_lookup_sql_sha256 == _READ_SQL_SHA256[2]
        and seal.main_key_prepare_count == 1
        and seal.main_key_terminal_fetch_count == 1
        and seal.main_key_close_attempt_count == 1
        and seal.main_key_close_count == 1
        and seal.driver_prepare_count == 1
        and seal.driver_terminal_fetch_count == 1
        and seal.driver_close_attempt_count == 1
        and seal.driver_close_count == 1
        and seal.point_statement_prepare_count == 1
        and seal.point_statement_execute_count == expected_count
        and seal.point_statement_release_count == 1
        and seal.point_cursor_created_count == expected_count
        and seal.point_cursor_close_attempt_count == expected_count
        and seal.point_cursor_closed_count == expected_count
        and seal.active_cursor_count == 0
        and seal.maximum_active_cursor_count <= 2
        and seal.live_physical_row_count == 0
        and seal.maximum_live_physical_row_count <= 1
        and seal.live_carrier_count == 0
        and seal.maximum_live_carrier_count <= 1
        and seal.transaction_generation is write.transaction_generation
        and seal.transaction_epoch == write.transaction_epoch_after
        and seal.total_changes_before == write.total_changes_after
        and seal.total_changes == write.total_changes_after
        and seal.total_changes_delta == 0
        and query_plans.probe_count == 3
        and query_plans.sorter_free
        and query_plans.primary_key_point_lookup
        and query_plans.sql_sha256 == _READ_SQL_SHA256
        and query_plans.transaction_generation is write.transaction_generation
        and query_plans.transaction_epoch == write.transaction_epoch_before
        and query_plans.total_changes == write.total_changes_before
    ):
        _fail("GE_CURSOR_B3_RULE12_SEAL_MISMATCH")


def _assert_rule12_entry_proofs_before_cancellation(
    write: Any,
    context: Any,
    authority: Any,
) -> None:
    """Reprove current authority, lineage, lock, catalog, and retained EQP."""

    migration = authority.migration_0002_receipt
    fence = authority.post_ddl_catalog_fence
    query_plans = context.rule12_query_plans
    if migration is None or fence is None:
        _fail("GE_CURSOR_B3_RULE12_GRAPH")
    _assert_sqlite_cursor_outer_publication_authority_intrinsic(
        write.outer_authority
    )
    _assert_sqlite_cursor_post_ddl_catalog_fence_intrinsic(
        write.outer_authority, migration, fence
    )
    if not (
        write.connection.in_exclusive_transaction
        and write.connection._transaction_generation is write.transaction_generation
        and write.connection.transaction_epoch == write.transaction_epoch_after
        and write.connection.total_changes == write.total_changes_after
        and query_plans.probe_count == 3
        and query_plans.identities
        == (
            "main-cursor-primary-key-count-order-without-sort",
            "temp-driver-primary-key-order-without-sort",
            "main-cursor-primary-key-point-lookup",
        )
        and query_plans.sql_sha256 == _READ_SQL_SHA256
        and query_plans.normalized_details
        == (
            ("SCAN main.ge_cycle_cursors",),
            ("SCAN temp.ge_blr_cursor_seal",),
            (
                "SEARCH main.ge_cycle_cursors USING PRIMARY KEY "
                "(tenant_id=? AND token_hash=?)",
            ),
        )
        and query_plans.sorter_free
        and query_plans.primary_key_point_lookup
        and query_plans.transaction_generation is write.transaction_generation
        and query_plans.transaction_epoch == write.transaction_epoch_before
        and query_plans.total_changes == write.total_changes_before
    ):
        _fail("GE_CURSOR_B3_RULE12_ENTRY_PROOF")


def _execute_sqlite_cursor_publication_rule12_intrinsic(
    rule11: _SQLiteCursorPublicationRule11SuccessReceipt,
    cancellation: _SQLiteCursorPublicationSessionCancellationSignal | None = None,
) -> _SQLiteCursorPublicationRule12SuccessReceipt:
    """Run bounded Rule 12 exactly once after one authentic Rule 11 receipt."""

    execution: _SQLiteConnectionCursorPublicationSealReadExecution | None = None
    write: Any | None = None

    def observe_cancellation() -> None:
        if _is_sqlite_cursor_publication_session_cancellation_requested_intrinsic(
            cancellation
        ):
            _fail("GE_CURSOR_B3_RULE12_CANCELLED")

    try:
        _prepare_sqlite_cursor_publication_rule11_for_rule12_intrinsic(rule11)
        rule11_snapshot, write, context, authority = _authenticate_graph(rule11)
        _assert_rule12_entry_proofs_before_cancellation(write, context, authority)
        provenance = assert_sqlite_cursor_pre_rebind_receipt_provenance(context.receipt)
        b2 = provenance.immutable_seal_receipt
        if not (
            provenance.receipt_sha256 == context.pre_rebind_receipt_sha256
            and b2.cursor_count == context.b2_cursor_count
            and b2.immutable_root_sha256 == context.b2_immutable_root_sha256
            and b2.source_descriptor_hash == context.source_descriptor_hash
            and b2.source_schema_identity_sha256 == context.source_schema_identity
        ):
            _fail("GE_CURSOR_B3_RULE12_B2_PROVENANCE")
        execution = _begin_sqlite_connection_cursor_publication_seal_read_intrinsic(
            write.connection, write.rebind_execution
        )
        observe_cancellation()
        seal = _execute_sqlite_connection_cursor_publication_seal_read_intrinsic(
            write.connection,
            execution,
            context.b2_cursor_count,
            observe_cancellation,
        )
        _validate_seal_snapshot(seal, rule11_snapshot, write, context)
        observe_cancellation()
        publication = _publication_session_state(write.session)
        if (
            publication.consumed_tombstone is None
            or authority.outer_clock_consumed_tombstone is None
        ):
            _fail("GE_CURSOR_B3_RULE12_CLOCK_GRAPH")
        receipt = _SQLiteCursorPublicationRule12SuccessReceipt(_CONSTRUCTION_TOKEN)
        snapshot = _SQLiteCursorPublicationRule12SuccessReceiptSnapshot(
            "active",
            _RULE_ID,
            _POSITION,
            rule11,
            rule11_snapshot.write_receipt,
            write.session,
            write.context,
            write.post_rebind_adoption,
            execution,
            SQLITE_CURSOR_SEAL_ALGORITHM_VERSION,
            bytes(SQLITE_CURSOR_SEAL_ROW_DOMAIN),
            bytes(SQLITE_CURSOR_SEAL_DOMAIN),
            _MAIN_BYTE_ORDER,
            _SEAL_BYTE_ORDER,
            seal.main_key_scan_sql,
            seal.key_driver_sql,
            seal.point_lookup_sql,
            seal.main_key_row_count,
            seal.driver_row_count,
            seal.lookup_row_count,
            b2.cursor_count,
            seal.accumulator_row_count,
            b2.immutable_root_sha256,
            cast(str, seal.computed_immutable_root_sha256),
            context.target_descriptor_hash,
            context.target_schema_identity,
            1,
            1,
            1,
            1,
            1,
            1,
            1,
            1,
            1,
            seal.point_statement_execute_count,
            1,
            seal.point_cursor_created_count,
            seal.point_cursor_close_attempt_count,
            seal.point_cursor_closed_count,
            0,
            seal.maximum_active_cursor_count,
            0,
            seal.maximum_live_physical_row_count,
            0,
            seal.maximum_live_carrier_count,
            0,
            False,
            write.connection,
            write.transaction_generation,
            write.transaction_epoch_before,
            write.transaction_epoch_after,
            write.total_changes_before,
            write.total_changes_after,
            0,
            authority.migration_lock_capability,
            authority.provider_clock_capability,
            authority.outer_clock_evidence,
            authority.outer_clock_consumed_tombstone,
            publication.pre_rebind_clock_evidence,
            publication.consumed_tombstone,
            context.receipt,
            context.pre_rebind_receipt_sha256,
            context.rule12_query_plans,
            None,
        )
        _register_receipt(receipt, _Rule12Record(snapshot))
        _complete_sqlite_cursor_publication_rule11_for_rule12_intrinsic(
            rule11, receipt
        )
        _adopt_sqlite_cursor_rule12_seal_acceptance_intrinsic(
            write.context,
            write.post_rebind_adoption,
            rule11,
            receipt,
        )
        return receipt
    except BaseException as primary:
        if execution is not None and write is not None:
            with suppress(BaseException):
                current = (
                    _read_sqlite_connection_cursor_publication_seal_read_snapshot_intrinsic(
                        write.connection, execution
                    )
                )
                if current.lifecycle == "prepared":
                    _release_sqlite_connection_cursor_publication_seal_read_intrinsic(
                        write.connection, execution
                    )
        with suppress(BaseException):
            _poison_sqlite_cursor_publication_rule11_for_rule12_intrinsic(
                rule11, "SQLite Rule 12 failed"
            )
        raise primary


def _read_sqlite_cursor_publication_rule12_receipt_snapshot_intrinsic(
    receipt: _SQLiteCursorPublicationRule12SuccessReceipt,
) -> _SQLiteCursorPublicationRule12SuccessReceiptSnapshot:
    """Re-authenticate the full retained graph without running SQLite I/O."""

    snapshot = _record_for(receipt).snapshot
    _assert_sqlite_cursor_publication_rule11_rule12_successor_intrinsic(
        snapshot.rule11_receipt, receipt
    )
    rule11, write, context, authority = _authenticate_graph(snapshot.rule11_receipt)
    seal = _read_sqlite_connection_cursor_publication_seal_read_snapshot_intrinsic(
        write.connection, snapshot.seal_read_execution
    )
    _validate_seal_snapshot(seal, rule11, write, context)
    if not (
        snapshot.write_receipt is rule11.write_receipt
        and snapshot.publication_session is write.session
        and snapshot.context is write.context
        and snapshot.watermark_adoption is write.post_rebind_adoption
        and snapshot.connection is write.connection
        and snapshot.transaction_generation is write.transaction_generation
        and snapshot.migration_lock_capability is authority.migration_lock_capability
        and snapshot.provider_clock_capability is authority.provider_clock_capability
        and snapshot.pre_rebind_receipt is context.receipt
        and snapshot.pre_rebind_receipt_sha256 == context.pre_rebind_receipt_sha256
        and snapshot.receipt_count == context.b2_cursor_count
        and snapshot.receipt_immutable_root_sha256
        == context.b2_immutable_root_sha256
        and snapshot.computed_immutable_root_sha256
        == context.b2_immutable_root_sha256
        and snapshot.query_plans is context.rule12_query_plans
        and authority.rule11_receipt is snapshot.rule11_receipt
        and authority.rule12_receipt is receipt
        and authority.pre_verification_clock_evidence
        is snapshot.pre_verification_clock_evidence
    ):
        _fail("GE_CURSOR_B3_RULE12_RECEIPT")
    return snapshot


def _prepare_sqlite_cursor_rule12_third_observation_authorization_intrinsic(
    receipt: _SQLiteCursorPublicationRule12SuccessReceipt,
) -> _SQLiteCursorRule12ThirdObservationAuthorization:
    """Mint one exact package-private token before opening the clock window."""

    record = _record_for(receipt)
    if record.snapshot.lifecycle != "active" or record.third_authorization is not None:
        _poison_sqlite_cursor_publication_rule12_after_success_intrinsic(
            receipt, "SQLite Rule 12 third observation authorization replayed"
        )
        _fail("GE_CURSOR_B3_RULE12_THIRD_AUTHORITY")
    token = _SQLiteCursorRule12ThirdObservationAuthorization(_CONSTRUCTION_TOKEN)
    token_id = _ID(token)

    def discard(reference: ReferenceType[Any]) -> None:
        current = _DICT_GET(_THIRD_AUTHORIZATIONS, token_id)
        if current is not None and current.key_ref is reference:
            _DICT_POP(_THIRD_AUTHORIZATIONS, token_id, None)

    token_ref = ref(token, discard)
    _DICT_SET(
        _THIRD_AUTHORIZATIONS,
        token_id,
        _IdentityEntry(token_ref, ref(receipt)),
    )
    record.third_authorization = token
    record.snapshot = record.snapshot._replace(lifecycle="third-observation-pending")
    return token


def _verify_sqlite_cursor_rule12_third_observation_authorization_intrinsic(
    receipt: object,
    authorization: object,
    provider_clock_capability: object,
    predecessor: object,
) -> bool:
    """Definition-time clock callback for one exact R12-bound authorization."""

    if (
        _TYPE(receipt) is not _SQLiteCursorPublicationRule12SuccessReceipt
        or _TYPE(authorization) is not _SQLiteCursorRule12ThirdObservationAuthorization
    ):
        return False
    current = _DICT_GET(_THIRD_AUTHORIZATIONS, _ID(authorization))
    if current is None or current.key_ref() is not authorization:
        return False
    receipt_ref = current.value
    if not isinstance(receipt_ref, ReferenceType) or receipt_ref() is not receipt:
        return False
    record = _record_for(cast(_SQLiteCursorPublicationRule12SuccessReceipt, receipt))
    snapshot = record.snapshot
    return (
        record.third_authorization is authorization
        and snapshot.lifecycle == "third-observation-pending"
        and snapshot.provider_clock_capability is provider_clock_capability
        and snapshot.pre_rebind_clock_evidence is predecessor
    )


def _adopt_sqlite_cursor_publication_rule12_pre_verification_clock_evidence_intrinsic(
    receipt: _SQLiteCursorPublicationRule12SuccessReceipt,
    evidence: object,
) -> None:
    """Advance the exact R12 and outer owners after a third evidence mint."""

    record = _record_for(receipt)
    snapshot = record.snapshot
    if (
        snapshot.lifecycle != "third-observation-pending"
        or snapshot.pre_verification_clock_evidence is not None
        or evidence is None
    ):
        _poison_sqlite_cursor_publication_rule12_after_success_intrinsic(
            receipt, "SQLite Rule 12 third-clock adoption was replayed"
        )
        _fail("GE_CURSOR_B3_RULE12_THIRD_CLOCK_ADOPTION")
    _adopt_sqlite_cursor_pre_verification_clock_evidence_intrinsic(
        cast(Any, snapshot.context),
        cast(Any, snapshot.watermark_adoption),
        snapshot.rule11_receipt,
        receipt,
        evidence,
    )
    _clear_third_authorization(record)
    record.snapshot = snapshot._replace(
        lifecycle="pre-verification-clock-read-unconsumed",
        pre_verification_clock_evidence=evidence,
    )


def _poison_sqlite_cursor_publication_rule12_after_success_intrinsic(
    receipt: _SQLiteCursorPublicationRule12SuccessReceipt,
    reason: str,
) -> None:
    """Poison the retained R12/R11/W/outer graph after a downstream primary."""

    record = _record_for(receipt)
    _clear_third_authorization(record)
    record.poisoned = True
    _poison_sqlite_cursor_publication_rule11_for_rule12_intrinsic(
        record.snapshot.rule11_receipt, reason
    )
