"""Package-private P11 owner/BEGIN composition substrate.

This bounded slice adopts the exact active P9 transaction owner and its current
BEGIN receipt, then mints route-bound mutation and fixed-read *state tokens*.
Those tokens are a zero-I/O authority lattice: this module executes no SQL,
owns no native cursor, claims no route closure, and mints no Rule 12 edge,
third-clock consumer, success claim, or COMMIT authority.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal, NamedTuple, Never
from weakref import ReferenceType, ref

from .sqlite_cursor_publication_native_projection_bridge import (
    _install_sqlite_cursor_publication_native_projection_adopter_intrinsic,
    _invoke_sqlite_cursor_publication_native_projection_pipeline_intrinsic,
    _invoke_sqlite_cursor_publication_native_projection_receipt_consume_intrinsic,
    _invoke_sqlite_cursor_publication_native_projection_receipt_snapshot_intrinsic,
    _seal_sqlite_cursor_publication_native_projection_bridge_intrinsic,
)
from .sqlite_cursor_publication_transaction_owner import (
    _abort_sqlite_cursor_publication_owner_composition_adoption_intrinsic,
    _assert_sqlite_cursor_publication_owner_composition_intrinsic,
    _capture_sqlite_cursor_publication_transaction_failure_intrinsic,
    _complete_sqlite_cursor_publication_owner_composition_adoption_intrinsic,
    _finalize_sqlite_cursor_publication_transaction_failure_capture_intrinsic,
    _prepare_sqlite_cursor_publication_owner_composition_adoption_intrinsic,
    _read_sqlite_cursor_publication_begin_receipt_snapshot_intrinsic,
    _SQLiteCursorPublicationBeginReceipt,
    _SQLiteCursorPublicationTransactionOwner,
)

_CONSTRUCTION_TOKEN = object()
_TYPE = type
_ID = id
_LEN = len
_INT: type[int] = int
_TUPLE: type[tuple[object, ...]] = tuple
_OBJECT_GETATTRIBUTE = object.__getattribute__
_OBJECT_SETATTR = object.__setattr__
_DICT_GET = dict.get
_DICT_SET = dict.__setitem__
_DICT_POP = dict.pop


def _fail(code: str) -> Never:
    raise ValueError(code)


def _inject_sqlite_cursor_publication_owner_composition_adoption_fault_intrinsic(
    _point: str,
    _composition: _SQLiteCursorPublicationOwnerComposition,
) -> None:
    """Definition-owned no-op seam used only by package tests."""


def _inject_sqlite_cursor_publication_native_projection_adoption_fault_intrinsic(
    _point: str,
    _composition: _SQLiteCursorPublicationOwnerComposition,
) -> None:
    """Fail-closed test seam; it cannot mint or weaken native authority."""


class _SQLiteCursorPublicationOwnerComposition:
    __slots__ = ("__owner", "__receipt", "__weakref__")

    def __init__(
        self,
        owner: _SQLiteCursorPublicationTransactionOwner,
        receipt: object,
        token: object,
    ) -> None:
        if token is not _CONSTRUCTION_TOKEN:
            raise TypeError("GE_SQLITE_P11_COMPOSITION_CONSTRUCTION")
        _OBJECT_SETATTR(self, "_SQLiteCursorPublicationOwnerComposition__owner", owner)
        _OBJECT_SETATTR(self, "_SQLiteCursorPublicationOwnerComposition__receipt", receipt)

    def __setattr__(self, _name: str, _value: object) -> Never:
        _reject_composition_token_mutation(self)

    def __delattr__(self, _name: str) -> Never:
        _reject_composition_token_mutation(self)


class _SQLiteCursorPublicationMutationScope:
    """Compatibility base for private P11 mutation authorities."""

    __slots__ = ("__weakref__",)

    def __init__(self, token: object) -> None:
        if token is not _CONSTRUCTION_TOKEN:
            raise TypeError("GE_SQLITE_P11_MUTATION_SCOPE_CONSTRUCTION")


class _SQLiteCursorPublicationMutationParentScope:
    """Opaque zero-I/O parent scope retaining its exact composition."""

    __slots__ = ("__composition", "__weakref__")

    def __init__(
        self,
        composition: _SQLiteCursorPublicationOwnerComposition,
        token: object,
    ) -> None:
        if token is not _CONSTRUCTION_TOKEN:
            raise TypeError("GE_SQLITE_P11_MUTATION_PARENT_CONSTRUCTION")
        _OBJECT_SETATTR(
            self,
            "_SQLiteCursorPublicationMutationParentScope__composition",
            composition,
        )

    def __setattr__(self, _name: str, _value: object) -> Never:
        _reject_parent_token_mutation(self)

    def __delattr__(self, _name: str) -> Never:
        _reject_parent_token_mutation(self)


class _SQLiteCursorPublicationRetainedCountReceipt:
    """Opaque one-shot identity for one immutable retained projection."""

    __slots__ = ("__composition", "__projection", "__weakref__")

    def __init__(
        self,
        composition: _SQLiteCursorPublicationOwnerComposition,
        projection: tuple[object, ...],
        token: object,
    ) -> None:
        if token is not _CONSTRUCTION_TOKEN:
            raise TypeError("GE_SQLITE_P11_RETAINED_COUNT_CONSTRUCTION")
        _OBJECT_SETATTR(
            self,
            "_SQLiteCursorPublicationRetainedCountReceipt__composition",
            composition,
        )
        _OBJECT_SETATTR(
            self,
            "_SQLiteCursorPublicationRetainedCountReceipt__projection",
            projection,
        )

    def __setattr__(self, _name: str, _value: object) -> Never:
        _reject_retained_count_receipt_mutation(self)

    def __delattr__(self, _name: str) -> Never:
        _reject_retained_count_receipt_mutation(self)


class _RetainedCountNonce:
    __slots__ = ()


class _SQLiteCursorPublicationMutationChildPermit:
    """Opaque ordinal child retaining its exact parent scope."""

    __slots__ = ("__parent", "__weakref__")

    def __init__(
        self,
        parent: _SQLiteCursorPublicationMutationParentScope,
        token: object,
    ) -> None:
        if token is not _CONSTRUCTION_TOKEN:
            raise TypeError("GE_SQLITE_P11_MUTATION_CHILD_CONSTRUCTION")
        _OBJECT_SETATTR(self, "_SQLiteCursorPublicationMutationChildPermit__parent", parent)

    def __setattr__(self, _name: str, _value: object) -> Never:
        _reject_child_token_mutation(self)

    def __delattr__(self, _name: str) -> Never:
        _reject_child_token_mutation(self)


class _SQLiteCursorPublicationFixedReadPermit:
    """Opaque zero-I/O fixed-read permit retaining its exact composition."""

    __slots__ = ("__composition", "__weakref__")

    def __init__(
        self,
        composition: _SQLiteCursorPublicationOwnerComposition,
        token: object,
    ) -> None:
        if token is not _CONSTRUCTION_TOKEN:
            raise TypeError("GE_SQLITE_P11_FIXED_READ_CONSTRUCTION")
        _OBJECT_SETATTR(self, "_SQLiteCursorPublicationFixedReadPermit__composition", composition)

    def __setattr__(self, _name: str, _value: object) -> Never:
        _reject_fixed_read_token_mutation(self)

    def __delattr__(self, _name: str) -> Never:
        _reject_fixed_read_token_mutation(self)


class _SQLiteCursorPublicationMutationRouteDescriptor(NamedTuple):
    route_id: str
    model: Literal["child-owned-one-shot", "parent-owned-reusable"]
    binding_kind: Literal["sql-sha256", "asset-sha256"]
    binding_sha256: str


_SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES = (
    _SQLiteCursorPublicationMutationRouteDescriptor(
        "b2.cursor-seal-table-ddl",
        "child-owned-one-shot",
        "sql-sha256",
        "032db65e1e8c11d90ed27fc6a6e2cab130d1bf33c7d688381f5666379c52b84a",
    ),
    _SQLiteCursorPublicationMutationRouteDescriptor(
        "main.migration-0002",
        "child-owned-one-shot",
        "asset-sha256",
        "1bf03d68eed45366bc7b34ccc329faa51ea389362db59f6a4307b3033d37a96d",
    ),
    _SQLiteCursorPublicationMutationRouteDescriptor(
        "main.baseline-entries",
        "parent-owned-reusable",
        "sql-sha256",
        "b522e3ee2bb4599d74b32c8602242b1b74c3f804dd9129a8eb5a0f529cdca88b",
    ),
    _SQLiteCursorPublicationMutationRouteDescriptor(
        "main.baseline-header",
        "child-owned-one-shot",
        "sql-sha256",
        "b1a32ec385dd78f9727a63b9c303a9cb95c9525910010984d09b7f0fd868e79a",
    ),
    _SQLiteCursorPublicationMutationRouteDescriptor(
        "main.operation-sequence-zero",
        "child-owned-one-shot",
        "sql-sha256",
        "a9afde17c90fcc7381eefa3fa81823752d6f1bc29c9eced2de8b31176cc1dd85",
    ),
    _SQLiteCursorPublicationMutationRouteDescriptor(
        "main.cursor-rebind",
        "child-owned-one-shot",
        "sql-sha256",
        "6fc61b515e758a1e84745af28783f4e9dcee5e76f80f314aa25a08980d2fef91",
    ),
)


class _SQLiteCursorPublicationFixedReadRouteDescriptor(NamedTuple):
    route_id: str
    family: Literal["owner-active-read", "b2-eqp", "rule12-eqp"]
    sql_sha256: str


_SQLITE_CURSOR_PUBLICATION_P11_FIXED_READ_ROUTES = (
    _SQLiteCursorPublicationFixedReadRouteDescriptor(
        "read.temp-table-list",
        "owner-active-read",
        "1a5673ba64ea33f0bf3f0d5bd9327b1aaf16314c9a04d231e99e250e6fd56a23",
    ),
    _SQLiteCursorPublicationFixedReadRouteDescriptor(
        "b2.eqp.source",
        "b2-eqp",
        "dda30c873dcae965e1cac3f6478549b98e2414e982c1287997b93a2c09d760a4",
    ),
    _SQLiteCursorPublicationFixedReadRouteDescriptor(
        "b2.eqp.stage-insert",
        "b2-eqp",
        "fbcf5255335c392f4f18818d8f12e79abbcfc677f768579fbe05f317a7a4774b",
    ),
    _SQLiteCursorPublicationFixedReadRouteDescriptor(
        "b2.eqp.stage-seal",
        "b2-eqp",
        "c169d8478a327605640a031bc1129d699341165bc6f59bdf7151c3e33677458e",
    ),
    _SQLiteCursorPublicationFixedReadRouteDescriptor(
        "b2.eqp.count-marker",
        "b2-eqp",
        "d4fa6279ee8d237b0ec82d9aed1b70e804d45890dd6d02313ac9ffea6260c830",
    ),
    _SQLiteCursorPublicationFixedReadRouteDescriptor(
        "b2.eqp.event-lookup",
        "b2-eqp",
        "86a336dc93fc818fc41b0e2fdf204256dc197515919f5431084e71adf45585d4",
    ),
    _SQLiteCursorPublicationFixedReadRouteDescriptor(
        "b2.eqp.checkpoint-lookup",
        "b2-eqp",
        "8b6322cee22b003a9d8ac33caafcde5272473e9da86dc7f8d21db3209523aba0",
    ),
    _SQLiteCursorPublicationFixedReadRouteDescriptor(
        "b2.eqp.row-marker.authorization",
        "b2-eqp",
        "4b05dede61e9303c06a459416e8d6da4eac6007dedbab602ae4f4b942e9fbebf",
    ),
    _SQLiteCursorPublicationFixedReadRouteDescriptor(
        "b2.eqp.row-marker.scope",
        "b2-eqp",
        "9bf6d38c051294f87798839738e5f913c69a54e8ac81dd571e36eda33ea8b628",
    ),
    _SQLiteCursorPublicationFixedReadRouteDescriptor(
        "b2.eqp.row-marker.blob-canonical",
        "b2-eqp",
        "64b77f510a88d3091603b5d9c93d58a5eb69d65c20f67c081847654434e514b8",
    ),
    _SQLiteCursorPublicationFixedReadRouteDescriptor(
        "b2.eqp.row-marker.position",
        "b2-eqp",
        "aa3a0bbb0a07137a0e497c9140d359608358b5fd3bf1ac7e1ed15a34893678b3",
    ),
    _SQLiteCursorPublicationFixedReadRouteDescriptor(
        "b2.eqp.row-marker.expiry-consumption",
        "b2-eqp",
        "494b6ae97f33349cfb787afedc3bbf2ee69021a669abb4dd14273028d2117771",
    ),
    _SQLiteCursorPublicationFixedReadRouteDescriptor(
        "b2.eqp.row-marker.catalog-binding",
        "b2-eqp",
        "6dec1fa0dc5aa8b48c9fa45c50ed2dba32cb2a01c83f934407484c1200460562",
    ),
    _SQLiteCursorPublicationFixedReadRouteDescriptor(
        "b2.eqp.row-marker.shape",
        "b2-eqp",
        "2600c8112c8e55f814a0f57ea50b822eb14c91e13871bec99965e7aa6a91c8cd",
    ),
    _SQLiteCursorPublicationFixedReadRouteDescriptor(
        "b2.eqp.row-marker.event-binding",
        "b2-eqp",
        "515c1832cfc0238339a838245b7afabc83ca319e7f74fdeabbad6904152e3909",
    ),
    _SQLiteCursorPublicationFixedReadRouteDescriptor(
        "b2.eqp.row-marker.checkpoint-binding",
        "b2-eqp",
        "92315896aa7d1f1acab782dad89641687da88350f5843f9c34d32026f6a9c8ce",
    ),
    _SQLiteCursorPublicationFixedReadRouteDescriptor(
        "rule12.eqp.main-key-scan",
        "rule12-eqp",
        "09d1ce669070093fbbf0dfd8ce7e2a7bbfde96d051b3ce9341be85495479ec32",
    ),
    _SQLiteCursorPublicationFixedReadRouteDescriptor(
        "rule12.eqp.temp-key-driver",
        "rule12-eqp",
        "1694ab6fe938203b0d8f6cb72cf82238e89234c21086ff5d224c7de4db7b1266",
    ),
    _SQLiteCursorPublicationFixedReadRouteDescriptor(
        "rule12.eqp.main-point-lookup",
        "rule12-eqp",
        "bd056ee55f2bd27eee3277ed7bfee8ae7b7db935edc3cf0937fc8167e2eac342",
    ),
)


class _SQLiteCursorPublicationOwnerCompositionSnapshot(NamedTuple):
    lifecycle: str
    exact_owner: bool
    exact_begin_receipt: bool
    exact_connection: bool
    exact_lineage: bool
    exact_generation: bool
    begin_transaction_epoch: int
    begin_total_changes: int
    begin_temp_mutation_epoch: int
    current_transaction_epoch: int
    current_total_changes: int
    current_temp_mutation_epoch: int
    highest_accepted_30_stage: None
    accepted_stage_receipt_count: int
    accepted_stage_ids: tuple[str, ...]
    attempted_stage: None
    third_evidence_consumed: bool
    commit_presented: bool
    commit_attempt_count: int


class _SQLiteCursorPublicationMutationParentScopeSnapshot(NamedTuple):
    route_id: str
    binding_kind: str
    binding_sha256: str
    model: str
    lifecycle: str
    expected_count: int
    next_ordinal: int
    child_issued_count: int
    child_entered_count: int
    child_native_return_count: int
    child_resource_retired_count: int
    child_postflight_accepted_count: int
    child_consumed_count: int
    reusable_parent_prepare_count: int
    reusable_execution_lease_released_count: int
    parent_resource_retired_count: int
    count_provenance: Literal["shape-only", "lower-native"]
    actual_native_io_count: Literal[0]
    sql_authority: Literal[False]


class _SQLiteCursorPublicationRetainedCountReceiptSnapshot(NamedTuple):
    route_id: Literal["main.baseline-entries"]
    lifecycle: Literal["issued", "consumed", "poisoned"]
    retained_count: int
    exact_owner: Literal[True]
    exact_generation: Literal[True]
    exact_scope: bool
    exact_retained_projection_identity: Literal[True]
    exact_retained_projection_count: Literal[True]
    native_source_provenance: Literal[False]
    genuine_zero_claim: Literal[False]
    one_shot: Literal[True]
    actual_native_io_count: Literal[0]
    sql_authority: Literal[False]


class _SQLiteCursorPublicationNativeProjectionAdoption(NamedTuple):
    parent: _SQLiteCursorPublicationMutationParentScope
    receipt_snapshot: object


class _SQLiteCursorPublicationMutationChildPermitSnapshot(NamedTuple):
    ordinal: int
    model: str
    lifecycle: str
    actual_native_io_count: Literal[0]
    sql_authority: Literal[False]


class _SQLiteCursorPublicationFixedReadPermitSnapshot(NamedTuple):
    route_id: str
    sql_sha256: str
    family: str
    lifecycle: str
    maximum_rows: int
    observed_rows: int
    maximum_cursors: Literal[1]
    prepare_count: int
    terminal_row_observed: bool
    resource_retired: bool
    resource_kind: str | None
    consume_count: int
    native_cursor_close_attempt_count: Literal[0]
    native_cursor_close_return_count: Literal[0]
    actual_native_io_count: Literal[0]
    mutation_delta: Literal[0]
    sql_authority: Literal[False]


@dataclass(slots=True)
class _Record:
    owner_ref: ReferenceType[_SQLiteCursorPublicationTransactionOwner]
    receipt_ref: ReferenceType[_SQLiteCursorPublicationBeginReceipt]
    connection_ref: ReferenceType[object] | None
    lineage_ref: ReferenceType[object] | None
    generation_ref: ReferenceType[object] | None
    begin_transaction_epoch: int
    begin_total_changes: int
    begin_temp_mutation_epoch: int
    lifecycle: str = "unadopted"


class _Entry(NamedTuple):
    composition_ref: ReferenceType[_SQLiteCursorPublicationOwnerComposition]
    record: _Record


_COMPOSITIONS: dict[int, _Entry] = {}


@dataclass(slots=True)
class _ParentRecord:
    composition_ref: ReferenceType[_SQLiteCursorPublicationOwnerComposition]
    descriptor: _SQLiteCursorPublicationMutationRouteDescriptor
    expected_count: int
    lifecycle: str
    count_provenance: Literal["shape-only", "lower-native"] = "shape-only"
    retained_count_receipt: object | None = None
    next_ordinal: int = 0
    active_child_ref: ReferenceType[_SQLiteCursorPublicationMutationChildPermit] | None = None
    child_issued_count: int = 0
    child_entered_count: int = 0
    child_native_return_count: int = 0
    child_resource_retired_count: int = 0
    child_postflight_accepted_count: int = 0
    child_consumed_count: int = 0
    reusable_parent_prepare_count: int = 0
    reusable_execution_lease_released_count: int = 0
    parent_resource_retired_count: int = 0


class _ParentEntry(NamedTuple):
    token_ref: ReferenceType[_SQLiteCursorPublicationMutationParentScope]
    record: _ParentRecord


@dataclass(slots=True)
class _RetainedCountReceiptRecord:
    composition_ref: ReferenceType[_SQLiteCursorPublicationOwnerComposition]
    owner_ref: ReferenceType[_SQLiteCursorPublicationTransactionOwner]
    begin_receipt_ref: ReferenceType[_SQLiteCursorPublicationBeginReceipt]
    connection_ref: ReferenceType[object]
    lineage_ref: ReferenceType[object]
    generation_ref: ReferenceType[object]
    descriptor: _SQLiteCursorPublicationMutationRouteDescriptor
    retained_projection: tuple[object, ...]
    retained_count: int
    nonce: object
    parent_ref: ReferenceType[_SQLiteCursorPublicationMutationParentScope] | None = None
    lifecycle: Literal["issued", "consumed", "poisoned"] = "issued"


class _RetainedCountReceiptEntry(NamedTuple):
    token_ref: ReferenceType[_SQLiteCursorPublicationRetainedCountReceipt]
    record: _RetainedCountReceiptRecord


@dataclass(slots=True)
class _ChildRecord:
    parent_ref: ReferenceType[_SQLiteCursorPublicationMutationParentScope]
    ordinal: int
    model: str
    lifecycle: str = "child-issued"


class _ChildEntry(NamedTuple):
    token_ref: ReferenceType[_SQLiteCursorPublicationMutationChildPermit]
    record: _ChildRecord


@dataclass(slots=True)
class _FixedReadRecord:
    composition_ref: ReferenceType[_SQLiteCursorPublicationOwnerComposition]
    descriptor: _SQLiteCursorPublicationFixedReadRouteDescriptor
    maximum_rows: int
    lifecycle: str = "issued"
    observed_rows: int = 0
    prepare_count: int = 0
    terminal_row_observed: bool = False
    resource_retired: bool = False
    resource_kind: str | None = None
    consume_count: int = 0


class _FixedReadEntry(NamedTuple):
    token_ref: ReferenceType[_SQLiteCursorPublicationFixedReadPermit]
    record: _FixedReadRecord


_PARENT_SCOPES: dict[int, _ParentEntry] = {}
_RETAINED_COUNT_RECEIPTS: dict[int, _RetainedCountReceiptEntry] = {}
_CHILD_PERMITS: dict[int, _ChildEntry] = {}
_FIXED_READ_PERMITS: dict[int, _FixedReadEntry] = {}


def _native_projection_parent_receipt_cell() -> tuple[
    Callable[
        [
            _SQLiteCursorPublicationMutationParentScope,
            _SQLiteCursorPublicationOwnerComposition,
            object,
            object,
            _ParentRecord,
        ],
        None,
    ],
    Callable[
        [
            _SQLiteCursorPublicationMutationParentScope,
            _SQLiteCursorPublicationOwnerComposition,
            _ParentRecord,
        ],
        tuple[object, bool] | None,
    ],
    Callable[[_SQLiteCursorPublicationMutationParentScope, _ParentRecord], None],
    Callable[[_SQLiteCursorPublicationMutationParentScope], None],
    Callable[[_SQLiteCursorPublicationOwnerComposition], None],
]:
    retained: dict[
        int,
        tuple[
            ReferenceType[_SQLiteCursorPublicationMutationParentScope],
            ReferenceType[_SQLiteCursorPublicationOwnerComposition],
            object | None,
            object,
            int,
            tuple[object, ...],
        ],
    ] = {}

    validate = _invoke_sqlite_cursor_publication_native_projection_receipt_snapshot_intrinsic
    native_descriptor = _SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[2]
    object_getattribute = _OBJECT_GETATTRIBUTE

    def state_signature(record: _ParentRecord) -> tuple[object, ...]:
        return (
            record.descriptor,
            record.expected_count,
            record.lifecycle,
            record.count_provenance,
            record.retained_count_receipt,
            record.next_ordinal,
            record.active_child_ref,
            record.child_issued_count,
            record.child_entered_count,
            record.child_native_return_count,
            record.child_resource_retired_count,
            record.child_postflight_accepted_count,
            record.child_consumed_count,
            record.reusable_parent_prepare_count,
            record.reusable_execution_lease_released_count,
            record.parent_resource_retired_count,
        )

    def retain(
        parent: _SQLiteCursorPublicationMutationParentScope,
        composition: _SQLiteCursorPublicationOwnerComposition,
        receipt: object,
        snapshot: object,
        record: _ParentRecord,
    ) -> None:
        parent_id = _ID(parent)

        def discard_exact(
            dead_ref: ReferenceType[_SQLiteCursorPublicationMutationParentScope],
        ) -> None:
            entry = retained.get(parent_id)
            if entry is not None and entry[0] is dead_ref:
                retained.pop(parent_id, None)

        validated_snapshot = validate(composition, receipt)
        expected_count = object_getattribute(
            validated_snapshot, "expected_projection_count"
        )
        if (
            parent_id in retained
            or validated_snapshot != snapshot
            or object_getattribute(validated_snapshot, "route_id")
            != "main.baseline-entries"
            or object_getattribute(validated_snapshot, "retained_count")
            != expected_count
            or record.descriptor is not native_descriptor
            or record.expected_count != expected_count
            or record.lifecycle != "parent-issued"
            or record.count_provenance != "lower-native"
            or record.retained_count_receipt is not None
            or record.next_ordinal != 0
            or record.active_child_ref is not None
            or any(
                count != 0
                for count in (
                    record.child_issued_count,
                    record.child_entered_count,
                    record.child_native_return_count,
                    record.child_resource_retired_count,
                    record.child_postflight_accepted_count,
                    record.child_consumed_count,
                    record.reusable_parent_prepare_count,
                    record.reusable_execution_lease_released_count,
                    record.parent_resource_retired_count,
                )
            )
        ):
            raise ValueError("GE_SQLITE_P11_NATIVE_PROJECTION_RECEIPT_INVALID")
        retained[parent_id] = (
            ref(parent, discard_exact),
            ref(composition),
            receipt,
            validated_snapshot,
            expected_count,
            state_signature(record),
        )

    def assert_exact(
        parent: _SQLiteCursorPublicationMutationParentScope,
        composition: _SQLiteCursorPublicationOwnerComposition,
        record: _ParentRecord,
    ) -> tuple[object, bool] | None:
        entry = retained.get(_ID(parent))
        if entry is None:
            return None
        if (
            entry[0]() is not parent
            or entry[1]() is not composition
            or (entry[2] is not None and validate(composition, entry[2]) != entry[3])
            or record.descriptor is not native_descriptor
            or record.expected_count != entry[4]
            or record.count_provenance != "lower-native"
            or state_signature(record) != entry[5]
            or (entry[2] is None) != (record.lifecycle == "parent-consumed")
        ):
            raise ValueError("GE_SQLITE_P11_NATIVE_PROJECTION_RECEIPT_INVALID")
        return entry[3], entry[2] is not None

    def advance(
        parent: _SQLiteCursorPublicationMutationParentScope,
        record: _ParentRecord,
    ) -> None:
        parent_id = _ID(parent)
        entry = retained.get(parent_id)
        if entry is None:
            return
        if (
            entry[0]() is not parent
            or record.descriptor is not native_descriptor
            or record.expected_count != entry[4]
            or record.count_provenance != "lower-native"
        ):
            raise ValueError("GE_SQLITE_P11_NATIVE_PROJECTION_RECEIPT_INVALID")
        retained[parent_id] = (*entry[:5], state_signature(record))

    def release_parent(parent: _SQLiteCursorPublicationMutationParentScope) -> None:
        entry = retained.get(_ID(parent))
        if entry is None or entry[0]() is not parent:
            raise ValueError("GE_SQLITE_P11_NATIVE_PROJECTION_RECEIPT_INVALID")
        retained[_ID(parent)] = (entry[0], entry[1], None, *entry[3:])

    def release_composition(
        composition: _SQLiteCursorPublicationOwnerComposition,
    ) -> None:
        for parent_id, entry in tuple(retained.items()):
            if entry[1]() is composition:
                retained[parent_id] = (entry[0], entry[1], None, *entry[3:])

    return retain, assert_exact, advance, release_parent, release_composition


(
    _retain_native_projection_parent_receipt,
    _assert_native_projection_parent_receipt,
    _advance_native_projection_parent_state,
    _release_native_projection_parent_receipt,
    _release_native_projection_composition_receipts,
) = _native_projection_parent_receipt_cell()


def _reject_composition_token_mutation(
    composition: _SQLiteCursorPublicationOwnerComposition,
) -> Never:
    primary = ValueError("GE_SQLITE_P11_COMPOSITION_PRESENTATION")
    entry = _DICT_GET(_COMPOSITIONS, _ID(composition))
    if entry is None or entry.composition_ref() is not composition:
        raise primary
    if entry.record.lifecycle == "begin-adopted":
        _terminal_composition_failure(composition, entry.record, primary)
    raise primary


def _reject_parent_token_mutation(
    parent: _SQLiteCursorPublicationMutationParentScope,
) -> Never:
    primary = ValueError("GE_SQLITE_P11_SCOPE_INVALID")
    entry = _DICT_GET(_PARENT_SCOPES, _ID(parent))
    if entry is None or entry.token_ref() is not parent:
        raise primary
    composition = entry.record.composition_ref()
    if composition is None:
        raise primary
    composition_record = _record_for(composition)
    entry.record.lifecycle = "poisoned"
    if composition_record.lifecycle == "begin-adopted":
        _terminal_composition_failure(composition, composition_record, primary)
    raise primary


def _reject_retained_count_receipt_mutation(
    receipt: _SQLiteCursorPublicationRetainedCountReceipt,
) -> Never:
    primary = ValueError("GE_SQLITE_P11_SCOPE_INVALID")
    entry = _DICT_GET(_RETAINED_COUNT_RECEIPTS, _ID(receipt))
    if entry is None or entry.token_ref() is not receipt:
        raise primary
    composition = entry.record.composition_ref()
    if composition is None:
        raise primary
    composition_record = _record_for(composition)
    entry.record.lifecycle = "poisoned"
    if composition_record.lifecycle == "begin-adopted":
        _terminal_composition_failure(composition, composition_record, primary)
    raise primary


def _reject_child_token_mutation(
    child: _SQLiteCursorPublicationMutationChildPermit,
) -> Never:
    primary = ValueError("GE_SQLITE_P11_SCOPE_INVALID")
    entry = _DICT_GET(_CHILD_PERMITS, _ID(child))
    if entry is None or entry.token_ref() is not child:
        raise primary
    parent = entry.record.parent_ref()
    if parent is None:
        raise primary
    parent_entry = _DICT_GET(_PARENT_SCOPES, _ID(parent))
    if parent_entry is None or parent_entry.token_ref() is not parent:
        raise primary
    composition = parent_entry.record.composition_ref()
    if composition is None:
        raise primary
    composition_record = _record_for(composition)
    entry.record.lifecycle = "poisoned"
    parent_entry.record.lifecycle = "poisoned"
    if composition_record.lifecycle == "begin-adopted":
        _terminal_composition_failure(composition, composition_record, primary)
    raise primary


def _reject_fixed_read_token_mutation(
    permit: _SQLiteCursorPublicationFixedReadPermit,
) -> Never:
    primary = ValueError("GE_SQLITE_P11_FIXED_READ_INVALID")
    entry = _DICT_GET(_FIXED_READ_PERMITS, _ID(permit))
    if entry is None or entry.token_ref() is not permit:
        raise primary
    composition = entry.record.composition_ref()
    if composition is None:
        raise primary
    composition_record = _record_for(composition)
    entry.record.lifecycle = "poisoned"
    if composition_record.lifecycle == "begin-adopted":
        _terminal_composition_failure(composition, composition_record, primary)
    raise primary


def _record_for(
    composition: _SQLiteCursorPublicationOwnerComposition,
) -> _Record:
    if _TYPE(composition) is not _SQLiteCursorPublicationOwnerComposition:
        _fail("GE_SQLITE_P11_COMPOSITION_PRESENTATION")
    entry = _DICT_GET(_COMPOSITIONS, _ID(composition))
    if entry is None or entry.composition_ref() is not composition:
        _fail("GE_SQLITE_P11_COMPOSITION_PRESENTATION")
    return entry.record


def _composition_owner_receipt(
    composition: _SQLiteCursorPublicationOwnerComposition,
    record: _Record,
) -> tuple[
    _SQLiteCursorPublicationTransactionOwner,
    _SQLiteCursorPublicationBeginReceipt,
]:
    expected_owner = record.owner_ref()
    expected_receipt = record.receipt_ref()
    owner = _OBJECT_GETATTRIBUTE(composition, "_SQLiteCursorPublicationOwnerComposition__owner")
    receipt = _OBJECT_GETATTRIBUTE(composition, "_SQLiteCursorPublicationOwnerComposition__receipt")
    if (
        _TYPE(owner) is not _SQLiteCursorPublicationTransactionOwner
        or _TYPE(receipt) is not _SQLiteCursorPublicationBeginReceipt
        or expected_owner is not owner
        or expected_receipt is not receipt
    ):
        primary = ValueError("GE_SQLITE_P11_COMPOSITION_PRESENTATION")
        if record.lifecycle == "begin-adopted":
            _terminal_composition_failure(composition, record, primary)
        raise primary
    return owner, receipt


def _adopt_sqlite_cursor_publication_owner_composition_intrinsic(
    owner: _SQLiteCursorPublicationTransactionOwner,
    receipt: _SQLiteCursorPublicationBeginReceipt,
) -> _SQLiteCursorPublicationOwnerComposition:
    """One-shot adopt the exact active P9 owner and its exact BEGIN receipt."""

    if _TYPE(owner) is not _SQLiteCursorPublicationTransactionOwner:
        _fail("GE_SQLITE_P11_COMPOSITION_ADOPTION")
    composition = _SQLiteCursorPublicationOwnerComposition(owner, receipt, _CONSTRUCTION_TOKEN)
    composition_id = _ID(composition)

    def discard_exact(
        dead_ref: ReferenceType[_SQLiteCursorPublicationOwnerComposition],
    ) -> None:
        entry = _DICT_GET(_COMPOSITIONS, composition_id)
        if entry is not None and entry.composition_ref is dead_ref:
            _DICT_POP(_COMPOSITIONS, composition_id, None)

    composition_ref = ref(composition, discard_exact)
    reserved = False
    try:
        _inject_sqlite_cursor_publication_owner_composition_adoption_fault_intrinsic(
            "after-construction", composition
        )
        if _TYPE(receipt) is not _SQLiteCursorPublicationBeginReceipt:
            _fail("GE_SQLITE_P11_COMPOSITION_ADOPTION")
        preflight = _read_sqlite_cursor_publication_begin_receipt_snapshot_intrinsic(owner, receipt)
        record = _Record(
            ref(owner),
            ref(receipt),
            None,
            None,
            None,
            preflight.transaction_epoch,
            preflight.total_changes,
            preflight.temp_mutation_epoch,
        )
        _DICT_SET(_COMPOSITIONS, composition_id, _Entry(composition_ref, record))
        _inject_sqlite_cursor_publication_owner_composition_adoption_fault_intrinsic(
            "after-registration", composition
        )
        adoption = _prepare_sqlite_cursor_publication_owner_composition_adoption_intrinsic(
            owner, receipt, composition
        )
        reserved = True
        record.connection_ref = ref(adoption.connection)
        record.lineage_ref = ref(adoption.lineage)
        record.generation_ref = ref(adoption.generation)
        _inject_sqlite_cursor_publication_owner_composition_adoption_fault_intrinsic(
            "after-owner-pending", composition
        )
        _complete_sqlite_cursor_publication_owner_composition_adoption_intrinsic(
            owner, receipt, composition
        )
        _inject_sqlite_cursor_publication_owner_composition_adoption_fault_intrinsic(
            "after-owner-adopt", composition
        )
        record.lifecycle = "begin-adopted"
    except BaseException as primary:
        _DICT_POP(_COMPOSITIONS, composition_id, None)
        if reserved:
            _abort_sqlite_cursor_publication_owner_composition_adoption_intrinsic(
                owner, composition
            )
        try:
            capture = _capture_sqlite_cursor_publication_transaction_failure_intrinsic(
                owner, primary
            )
            _finalize_sqlite_cursor_publication_transaction_failure_capture_intrinsic(
                owner, capture
            )
        except BaseException as finalized:
            if finalized is primary or finalized.__cause__ is primary:
                raise
        raise primary.with_traceback(None) from None
    return composition


def _read_sqlite_cursor_publication_owner_composition_snapshot_intrinsic(
    composition: _SQLiteCursorPublicationOwnerComposition,
) -> _SQLiteCursorPublicationOwnerCompositionSnapshot:
    """Return immutable P11-A scalar evidence after exact graph reproof."""

    record = _record_for(composition)
    try:
        owner, receipt = _composition_owner_receipt(composition, record)
        adoption = _assert_sqlite_cursor_publication_owner_composition_intrinsic(
            owner, receipt, composition
        )
        if (
            record.lifecycle != "begin-adopted"
            or adoption.owner is not owner
            or adoption.begin_receipt is not receipt
            or record.connection_ref is None
            or record.connection_ref() is not adoption.connection
            or record.lineage_ref is None
            or record.lineage_ref() is not adoption.lineage
            or record.generation_ref is None
            or record.generation_ref() is not adoption.generation
            or adoption.begin_transaction_epoch != record.begin_transaction_epoch
            or adoption.begin_total_changes != record.begin_total_changes
            or adoption.begin_temp_mutation_epoch != record.begin_temp_mutation_epoch
        ):
            _fail("GE_SQLITE_P11_COMPOSITION_PRESENTATION")
    except BaseException as primary:
        if record.lifecycle == "begin-adopted":
            _terminal_composition_failure(composition, record, primary)
        raise
    return _SQLiteCursorPublicationOwnerCompositionSnapshot(
        record.lifecycle,
        True,
        True,
        True,
        True,
        True,
        record.begin_transaction_epoch,
        record.begin_total_changes,
        record.begin_temp_mutation_epoch,
        adoption.current_transaction_epoch,
        adoption.current_total_changes,
        adoption.current_temp_mutation_epoch,
        None,
        0,
        (),
        None,
        False,
        False,
        0,
    )


def _reauthenticate_composition(
    composition: _SQLiteCursorPublicationOwnerComposition,
    record: _Record,
) -> None:
    """Reprove the exact live P9 graph, including current native observations."""

    owner, receipt = _composition_owner_receipt(composition, record)
    adoption = _assert_sqlite_cursor_publication_owner_composition_intrinsic(
        owner, receipt, composition
    )
    if (
        record.lifecycle != "begin-adopted"
        or adoption.owner is not owner
        or adoption.begin_receipt is not receipt
        or record.connection_ref is None
        or record.connection_ref() is not adoption.connection
        or record.lineage_ref is None
        or record.lineage_ref() is not adoption.lineage
        or record.generation_ref is None
        or record.generation_ref() is not adoption.generation
        or adoption.begin_transaction_epoch != record.begin_transaction_epoch
        or adoption.begin_total_changes != record.begin_total_changes
        or adoption.begin_temp_mutation_epoch != record.begin_temp_mutation_epoch
    ):
        _fail("GE_SQLITE_P11_COMPOSITION_PRESENTATION")


def _terminal_composition_failure(
    _composition: _SQLiteCursorPublicationOwnerComposition,
    record: _Record,
    primary: BaseException,
    _release_native: Callable[
        [_SQLiteCursorPublicationOwnerComposition], None
    ] = _release_native_projection_composition_receipts,
) -> Never:
    """Poison the selected composition and finalize through exact P9 authority."""

    record.lifecycle = "poisoned"
    _release_native(_composition)
    owner = record.owner_ref()
    if _TYPE(owner) is not _SQLiteCursorPublicationTransactionOwner:
        raise primary
    try:
        capture = _capture_sqlite_cursor_publication_transaction_failure_intrinsic(owner, primary)
        _finalize_sqlite_cursor_publication_transaction_failure_capture_intrinsic(owner, capture)
    except BaseException as finalized:
        if finalized is primary:
            raise
        raise primary.with_traceback(None) from finalized
    raise primary.with_traceback(None)


def _is_exact_mutation_descriptor(
    descriptor: _SQLiteCursorPublicationMutationRouteDescriptor,
) -> bool:
    if _TYPE(descriptor) is not _SQLiteCursorPublicationMutationRouteDescriptor:
        return False
    for candidate in _SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES:
        if candidate is descriptor:
            return True
    return False


def _is_exact_fixed_read_descriptor(
    descriptor: _SQLiteCursorPublicationFixedReadRouteDescriptor,
) -> bool:
    if _TYPE(descriptor) is not _SQLiteCursorPublicationFixedReadRouteDescriptor:
        return False
    for candidate in _SQLITE_CURSOR_PUBLICATION_P11_FIXED_READ_ROUTES:
        if candidate is descriptor:
            return True
    return False


def _mutation_expected_count_is_exact(
    descriptor: _SQLiteCursorPublicationMutationRouteDescriptor,
    expected_count: int,
) -> bool:
    """Apply the count policy carried by each exact frozen route identity."""

    if _TYPE(expected_count) is not _INT:
        return False
    if descriptor is _SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[1]:
        return expected_count == 20
    if descriptor is _SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[2]:
        return False
    return expected_count == 1


def _retained_count_receipt_record_for(
    composition: _SQLiteCursorPublicationOwnerComposition,
    receipt: _SQLiteCursorPublicationRetainedCountReceipt,
) -> tuple[_RetainedCountReceiptRecord, _Record]:
    composition_record = _record_for(composition)
    if _TYPE(receipt) is not _SQLiteCursorPublicationRetainedCountReceipt:
        _terminal_composition_failure(
            composition,
            composition_record,
            ValueError("GE_SQLITE_P11_SCOPE_INVALID"),
        )
    entry = _DICT_GET(_RETAINED_COUNT_RECEIPTS, _ID(receipt))
    if entry is None or entry.token_ref() is not receipt:
        _terminal_composition_failure(
            composition,
            composition_record,
            ValueError("GE_SQLITE_P11_SCOPE_INVALID"),
        )
    record = entry.record
    registered_composition = record.composition_ref()
    if registered_composition is not composition:
        _terminal_composition_failure(
            composition,
            composition_record,
            ValueError("GE_SQLITE_P11_SCOPE_INVALID"),
        )
    try:
        presented_composition = _OBJECT_GETATTRIBUTE(
            receipt,
            "_SQLiteCursorPublicationRetainedCountReceipt__composition",
        )
        presented_projection = _OBJECT_GETATTRIBUTE(
            receipt,
            "_SQLiteCursorPublicationRetainedCountReceipt__projection",
        )
    except BaseException as primary:
        record.lifecycle = "poisoned"
        _terminal_composition_failure(composition, composition_record, primary)
    if (
        presented_composition is not composition
        or presented_projection is not record.retained_projection
        or record.owner_ref() is not composition_record.owner_ref()
        or record.begin_receipt_ref() is not composition_record.receipt_ref()
        or composition_record.connection_ref is None
        or record.connection_ref() is not composition_record.connection_ref()
        or composition_record.lineage_ref is None
        or record.lineage_ref() is not composition_record.lineage_ref()
        or composition_record.generation_ref is None
        or record.generation_ref() is not composition_record.generation_ref()
        or record.descriptor is not _SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[2]
        or _TYPE(record.retained_projection) is not _TUPLE
        or _LEN(record.retained_projection) != record.retained_count
        or record.nonce is None
    ):
        record.lifecycle = "poisoned"
        _terminal_composition_failure(
            composition,
            composition_record,
            ValueError("GE_SQLITE_P11_SCOPE_INVALID"),
        )
    bound_parent = None if record.parent_ref is None else record.parent_ref()
    bound_parent_entry = (
        None if bound_parent is None else _DICT_GET(_PARENT_SCOPES, _ID(bound_parent))
    )
    if (
        (record.lifecycle == "issued" and record.parent_ref is not None)
        or (
            record.lifecycle == "consumed"
            and (
                bound_parent_entry is None
                or bound_parent_entry.token_ref() is not bound_parent
                or bound_parent_entry.record.composition_ref() is not composition
                or bound_parent_entry.record.retained_count_receipt is not receipt
            )
        )
    ):
        record.lifecycle = "poisoned"
        _terminal_composition_failure(
            composition,
            composition_record,
            ValueError("GE_SQLITE_P11_SCOPE_INVALID"),
        )
    try:
        _reauthenticate_composition(composition, composition_record)
    except BaseException as primary:
        record.lifecycle = "poisoned"
        _terminal_composition_failure(composition, composition_record, primary)
    return record, composition_record


def _register_retained_count_receipt(
    receipt: _SQLiteCursorPublicationRetainedCountReceipt,
    record: _RetainedCountReceiptRecord,
) -> None:
    token_id = _ID(receipt)

    def discard_exact(
        dead_ref: ReferenceType[_SQLiteCursorPublicationRetainedCountReceipt],
    ) -> None:
        entry = _DICT_GET(_RETAINED_COUNT_RECEIPTS, token_id)
        if entry is not None and entry.token_ref is dead_ref:
            _DICT_POP(_RETAINED_COUNT_RECEIPTS, token_id, None)

    token_ref = ref(receipt, discard_exact)
    _DICT_SET(
        _RETAINED_COUNT_RECEIPTS,
        token_id,
        _RetainedCountReceiptEntry(token_ref, record),
    )


def _register_parent(
    parent: _SQLiteCursorPublicationMutationParentScope,
    record: _ParentRecord,
) -> None:
    token_id = _ID(parent)

    def discard_exact(
        dead_ref: ReferenceType[_SQLiteCursorPublicationMutationParentScope],
    ) -> None:
        entry = _DICT_GET(_PARENT_SCOPES, token_id)
        if entry is not None and entry.token_ref is dead_ref:
            _DICT_POP(_PARENT_SCOPES, token_id, None)

    token_ref = ref(parent, discard_exact)
    _DICT_SET(_PARENT_SCOPES, token_id, _ParentEntry(token_ref, record))


def _register_child(
    child: _SQLiteCursorPublicationMutationChildPermit,
    record: _ChildRecord,
) -> None:
    token_id = _ID(child)

    def discard_exact(
        dead_ref: ReferenceType[_SQLiteCursorPublicationMutationChildPermit],
    ) -> None:
        entry = _DICT_GET(_CHILD_PERMITS, token_id)
        if entry is not None and entry.token_ref is dead_ref:
            _DICT_POP(_CHILD_PERMITS, token_id, None)

    token_ref = ref(child, discard_exact)
    _DICT_SET(_CHILD_PERMITS, token_id, _ChildEntry(token_ref, record))


def _register_fixed_read(
    permit: _SQLiteCursorPublicationFixedReadPermit,
    record: _FixedReadRecord,
) -> None:
    token_id = _ID(permit)

    def discard_exact(
        dead_ref: ReferenceType[_SQLiteCursorPublicationFixedReadPermit],
    ) -> None:
        entry = _DICT_GET(_FIXED_READ_PERMITS, token_id)
        if entry is not None and entry.token_ref is dead_ref:
            _DICT_POP(_FIXED_READ_PERMITS, token_id, None)

    token_ref = ref(permit, discard_exact)
    _DICT_SET(_FIXED_READ_PERMITS, token_id, _FixedReadEntry(token_ref, record))


def _parent_record_for(
    parent: _SQLiteCursorPublicationMutationParentScope,
    _assert_native: Callable[
        [
            _SQLiteCursorPublicationMutationParentScope,
            _SQLiteCursorPublicationOwnerComposition,
            _ParentRecord,
        ],
        tuple[object, bool] | None,
    ] = _assert_native_projection_parent_receipt,
) -> tuple[_ParentRecord, _SQLiteCursorPublicationOwnerComposition, _Record]:
    if _TYPE(parent) is not _SQLiteCursorPublicationMutationParentScope:
        _fail("GE_SQLITE_P11_SCOPE_INVALID")
    entry = _DICT_GET(_PARENT_SCOPES, _ID(parent))
    if entry is None or entry.token_ref() is not parent:
        _fail("GE_SQLITE_P11_SCOPE_INVALID")
    composition = entry.record.composition_ref()
    if composition is None:
        _fail("GE_SQLITE_P11_SCOPE_INVALID")
    composition_record = _record_for(composition)
    try:
        presented = _OBJECT_GETATTRIBUTE(
            parent, "_SQLiteCursorPublicationMutationParentScope__composition"
        )
    except BaseException as primary:
        entry.record.lifecycle = "poisoned"
        if composition_record.lifecycle == "begin-adopted":
            _terminal_composition_failure(composition, composition_record, primary)
        raise
    if presented is not composition:
        entry.record.lifecycle = "poisoned"
        mismatch_primary = ValueError("GE_SQLITE_P11_SCOPE_INVALID")
        if composition_record.lifecycle == "begin-adopted":
            _terminal_composition_failure(composition, composition_record, mismatch_primary)
        raise mismatch_primary
    if composition_record.lifecycle != "begin-adopted":
        entry.record.lifecycle = "poisoned"
        _fail("GE_SQLITE_P11_COMPOSITION_PRESENTATION")
    try:
        _reauthenticate_composition(composition, composition_record)
        private_native_snapshot = _assert_native(parent, composition, entry.record)
        if (private_native_snapshot is not None) != (
            entry.record.count_provenance == "lower-native"
        ):
            raise ValueError("GE_SQLITE_P11_NATIVE_PROJECTION_RECEIPT_INVALID")
        if (
            private_native_snapshot is not None
            and not private_native_snapshot[1]
            and entry.record.lifecycle != "parent-consumed"
        ):
            raise ValueError("GE_SQLITE_P11_NATIVE_PROJECTION_RECEIPT_INVALID")
    except BaseException as primary:
        entry.record.lifecycle = "poisoned"
        if composition_record.lifecycle == "begin-adopted":
            _terminal_composition_failure(composition, composition_record, primary)
        raise
    return entry.record, composition, composition_record


def _mint_sqlite_cursor_publication_retained_count_receipt_intrinsic(
    composition: _SQLiteCursorPublicationOwnerComposition,
    descriptor: _SQLiteCursorPublicationMutationRouteDescriptor,
    retained_projection: tuple[object, ...],
) -> _SQLiteCursorPublicationRetainedCountReceipt:
    """Bind the actual immutable retained projection without accepting a count."""

    composition_record = _record_for(composition)
    if (
        composition_record.lifecycle != "begin-adopted"
        or descriptor is not _SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[2]
        or _TYPE(retained_projection) is not _TUPLE
        or _LEN(retained_projection) > 1_024
    ):
        _terminal_composition_failure(
            composition,
            composition_record,
            ValueError("GE_SQLITE_P11_SCOPE_INVALID"),
        )
    try:
        _reauthenticate_composition(composition, composition_record)
    except BaseException as primary:
        _terminal_composition_failure(composition, composition_record, primary)
    owner = composition_record.owner_ref()
    begin_receipt = composition_record.receipt_ref()
    connection = (
        None
        if composition_record.connection_ref is None
        else composition_record.connection_ref()
    )
    lineage = None if composition_record.lineage_ref is None else composition_record.lineage_ref()
    generation = (
        None
        if composition_record.generation_ref is None
        else composition_record.generation_ref()
    )
    if (
        _TYPE(owner) is not _SQLiteCursorPublicationTransactionOwner
        or _TYPE(begin_receipt) is not _SQLiteCursorPublicationBeginReceipt
        or connection is None
        or lineage is None
        or generation is None
    ):
        _terminal_composition_failure(
            composition,
            composition_record,
            ValueError("GE_SQLITE_P11_SCOPE_INVALID"),
        )
    retained_count = _LEN(retained_projection)
    receipt = _SQLiteCursorPublicationRetainedCountReceipt(
        composition,
        retained_projection,
        _CONSTRUCTION_TOKEN,
    )
    _register_retained_count_receipt(
        receipt,
        _RetainedCountReceiptRecord(
            composition_ref=ref(composition),
            owner_ref=ref(owner),
            begin_receipt_ref=ref(begin_receipt),
            connection_ref=ref(connection),
            lineage_ref=ref(lineage),
            generation_ref=ref(generation),
            descriptor=descriptor,
            retained_projection=retained_projection,
            retained_count=retained_count,
            nonce=_RetainedCountNonce(),
        ),
    )
    return receipt


def _read_sqlite_cursor_publication_retained_count_receipt_snapshot_intrinsic(
    composition: _SQLiteCursorPublicationOwnerComposition,
    receipt: _SQLiteCursorPublicationRetainedCountReceipt,
) -> _SQLiteCursorPublicationRetainedCountReceiptSnapshot:
    record, _composition_record = _retained_count_receipt_record_for(composition, receipt)
    return _SQLiteCursorPublicationRetainedCountReceiptSnapshot(
        route_id="main.baseline-entries",
        lifecycle=record.lifecycle,
        retained_count=record.retained_count,
        exact_owner=True,
        exact_generation=True,
        exact_scope=record.lifecycle == "consumed",
        exact_retained_projection_identity=True,
        exact_retained_projection_count=True,
        native_source_provenance=False,
        genuine_zero_claim=False,
        one_shot=True,
        actual_native_io_count=0,
        sql_authority=False,
    )


def _child_record_for(
    child: _SQLiteCursorPublicationMutationChildPermit,
) -> tuple[_ChildRecord, _ParentRecord, _SQLiteCursorPublicationMutationParentScope]:
    if _TYPE(child) is not _SQLiteCursorPublicationMutationChildPermit:
        _fail("GE_SQLITE_P11_SCOPE_INVALID")
    entry = _DICT_GET(_CHILD_PERMITS, _ID(child))
    if entry is None or entry.token_ref() is not child:
        _fail("GE_SQLITE_P11_SCOPE_INVALID")
    parent = entry.record.parent_ref()
    if parent is None:
        _fail("GE_SQLITE_P11_SCOPE_INVALID")
    try:
        presented = _OBJECT_GETATTRIBUTE(
            child, "_SQLiteCursorPublicationMutationChildPermit__parent"
        )
    except BaseException as primary:
        parent_record, composition, composition_record = _parent_record_for(parent)
        parent_record.lifecycle = "poisoned"
        entry.record.lifecycle = "poisoned"
        _terminal_composition_failure(composition, composition_record, primary)
    if presented is not parent:
        parent_record, composition, composition_record = _parent_record_for(parent)
        parent_record.lifecycle = "poisoned"
        entry.record.lifecycle = "poisoned"
        _terminal_composition_failure(
            composition,
            composition_record,
            ValueError("GE_SQLITE_P11_SCOPE_INVALID"),
        )
    parent_record, _composition, _composition_record = _parent_record_for(parent)
    return entry.record, parent_record, parent


def _fixed_read_record_for(
    permit: _SQLiteCursorPublicationFixedReadPermit,
) -> tuple[_FixedReadRecord, _SQLiteCursorPublicationOwnerComposition, _Record]:
    if _TYPE(permit) is not _SQLiteCursorPublicationFixedReadPermit:
        _fail("GE_SQLITE_P11_FIXED_READ_INVALID")
    entry = _DICT_GET(_FIXED_READ_PERMITS, _ID(permit))
    if entry is None or entry.token_ref() is not permit:
        _fail("GE_SQLITE_P11_FIXED_READ_INVALID")
    composition = entry.record.composition_ref()
    if composition is None:
        _fail("GE_SQLITE_P11_FIXED_READ_INVALID")
    composition_record = _record_for(composition)
    try:
        presented = _OBJECT_GETATTRIBUTE(
            permit, "_SQLiteCursorPublicationFixedReadPermit__composition"
        )
    except BaseException as primary:
        entry.record.lifecycle = "poisoned"
        if composition_record.lifecycle == "begin-adopted":
            _terminal_composition_failure(composition, composition_record, primary)
        raise
    if presented is not composition:
        entry.record.lifecycle = "poisoned"
        mismatch_primary = ValueError("GE_SQLITE_P11_FIXED_READ_INVALID")
        if composition_record.lifecycle == "begin-adopted":
            _terminal_composition_failure(composition, composition_record, mismatch_primary)
        raise mismatch_primary
    if composition_record.lifecycle != "begin-adopted":
        entry.record.lifecycle = "poisoned"
        _fail("GE_SQLITE_P11_COMPOSITION_PRESENTATION")
    try:
        _reauthenticate_composition(composition, composition_record)
    except BaseException as primary:
        entry.record.lifecycle = "poisoned"
        if composition_record.lifecycle == "begin-adopted":
            _terminal_composition_failure(composition, composition_record, primary)
        raise
    return entry.record, composition, composition_record


def _poison_parent(
    parent_record: _ParentRecord,
    composition: _SQLiteCursorPublicationOwnerComposition,
    composition_record: _Record,
    child_record: _ChildRecord | None = None,
) -> Never:
    parent_record.lifecycle = "poisoned"
    if child_record is not None:
        child_record.lifecycle = "poisoned"
    primary = ValueError("GE_SQLITE_P11_SCOPE_ORDER")
    _terminal_composition_failure(composition, composition_record, primary)


def _issue_sqlite_cursor_publication_mutation_parent_scope_intrinsic(
    composition: _SQLiteCursorPublicationOwnerComposition,
    descriptor: _SQLiteCursorPublicationMutationRouteDescriptor,
    count_proof: int | _SQLiteCursorPublicationRetainedCountReceipt,
) -> _SQLiteCursorPublicationMutationParentScope:
    """Mint one route-bound zero-I/O parent; this function never executes SQL."""

    composition_record = _record_for(composition)
    if composition_record.lifecycle != "begin-adopted":
        _fail("GE_SQLITE_P11_SCOPE_INVALID")
    if not _is_exact_mutation_descriptor(descriptor):
        _terminal_composition_failure(
            composition,
            composition_record,
            ValueError("GE_SQLITE_P11_SCOPE_INVALID"),
        )
    retained_count_record: _RetainedCountReceiptRecord | None = None
    retained_count_receipt: _SQLiteCursorPublicationRetainedCountReceipt | None = None
    if descriptor is _SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[2]:
        if _TYPE(count_proof) is not _SQLiteCursorPublicationRetainedCountReceipt:
            _terminal_composition_failure(
                composition,
                composition_record,
                ValueError("GE_SQLITE_P11_SCOPE_INVALID"),
            )
        retained_count_receipt = count_proof
        retained_count_record, _ = _retained_count_receipt_record_for(
            composition, retained_count_receipt
        )
        if retained_count_record.lifecycle != "issued":
            retained_count_record.lifecycle = "poisoned"
            _terminal_composition_failure(
                composition,
                composition_record,
                ValueError("GE_SQLITE_P11_SCOPE_INVALID"),
            )
        expected_count = retained_count_record.retained_count
    else:
        if _TYPE(count_proof) is not _INT or not _mutation_expected_count_is_exact(
            descriptor,
            count_proof,
        ):
            _terminal_composition_failure(
                composition,
                composition_record,
                ValueError("GE_SQLITE_P11_SCOPE_INVALID"),
            )
        expected_count = count_proof
    try:
        _reauthenticate_composition(composition, composition_record)
    except BaseException as primary:
        _terminal_composition_failure(composition, composition_record, primary)
    reusable = descriptor.model == "parent-owned-reusable"
    lifecycle = (
        "parent-issued"
        if reusable
        else "awaiting-zero-postflight"
        if expected_count == 0
        else "parent-ready"
    )
    parent = _SQLiteCursorPublicationMutationParentScope(composition, _CONSTRUCTION_TOKEN)
    _register_parent(
        parent,
        _ParentRecord(
            ref(composition),
            descriptor,
            expected_count,
            lifecycle,
            retained_count_receipt=(
                None if retained_count_record is None else retained_count_receipt
            ),
        ),
    )
    if retained_count_record is not None:
        retained_count_record.parent_ref = ref(parent)
        retained_count_record.lifecycle = "consumed"
    return parent


def _adopt_sqlite_cursor_publication_native_projection_receipt_intrinsic(
    composition: _SQLiteCursorPublicationOwnerComposition,
    native_receipt: object,
    consume_receipt: Callable[[object, object], int],
) -> _SQLiteCursorPublicationMutationParentScope:
    """Adopt an exact lower-source receipt without converting it to shape evidence."""

    composition_record = _record_for(composition)
    try:
        _reauthenticate_composition(composition, composition_record)
        _inject_sqlite_cursor_publication_native_projection_adoption_fault_intrinsic(
            "consume-before", composition
        )
        retained_count = consume_receipt(composition, native_receipt)
        _inject_sqlite_cursor_publication_native_projection_adoption_fault_intrinsic(
            "consume-after", composition
        )
    except BaseException as primary:
        if composition_record.lifecycle == "begin-adopted":
            _terminal_composition_failure(composition, composition_record, primary)
        raise
    descriptor = _SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[2]
    parent = _SQLiteCursorPublicationMutationParentScope(composition, _CONSTRUCTION_TOKEN)
    _register_parent(
        parent,
        _ParentRecord(
            ref(composition),
            descriptor,
            retained_count,
            "parent-issued",
            count_provenance="lower-native",
            retained_count_receipt=None,
        ),
    )
    _inject_sqlite_cursor_publication_native_projection_adoption_fault_intrinsic(
        "parent-registered", composition
    )
    return parent


def _install_bound_sqlite_cursor_publication_native_projection_adopter() -> None:
    adopter_implementation = (
        _adopt_sqlite_cursor_publication_native_projection_receipt_intrinsic
    )
    consumer = (
        _invoke_sqlite_cursor_publication_native_projection_receipt_consume_intrinsic
    )
    snapshotter = (
        _invoke_sqlite_cursor_publication_native_projection_receipt_snapshot_intrinsic
    )
    retainer = _retain_native_projection_parent_receipt

    def adopt(composition: object, receipt: object) -> tuple[object, object]:
        if _TYPE(composition) is not _SQLiteCursorPublicationOwnerComposition:
            raise ValueError("GE_SQLITE_P11_NATIVE_PROJECTION_ADOPTION")
        parent = adopter_implementation(composition, receipt, consumer)
        snapshot = snapshotter(composition, receipt)
        parent_entry = _DICT_GET(_PARENT_SCOPES, _ID(parent))
        if parent_entry is None or parent_entry.token_ref() is not parent:
            raise ValueError("GE_SQLITE_P11_NATIVE_PROJECTION_ADOPTION")
        retainer(parent, composition, receipt, snapshot, parent_entry.record)
        _inject_sqlite_cursor_publication_native_projection_adoption_fault_intrinsic(
            "parent-after", composition
        )
        return parent, snapshot

    _install_sqlite_cursor_publication_native_projection_adopter_intrinsic(adopt)


_install_bound_sqlite_cursor_publication_native_projection_adopter()


def _bind_sqlite_cursor_publication_native_projection_atomic_entry() -> Callable[
    [_SQLiteCursorPublicationOwnerComposition, object],
    _SQLiteCursorPublicationNativeProjectionAdoption,
]:
    pipeline = _invoke_sqlite_cursor_publication_native_projection_pipeline_intrinsic

    def capture_and_adopt(
        composition: _SQLiteCursorPublicationOwnerComposition,
        source_summary: object,
    ) -> _SQLiteCursorPublicationNativeProjectionAdoption:
        """Synchronously drain and adopt NP1 evidence without exposing a raw receipt."""

        composition_record = _record_for(composition)
        try:
            owner, begin_receipt = _composition_owner_receipt(
                composition, composition_record
            )
            _reauthenticate_composition(composition, composition_record)
            parent, receipt_snapshot = pipeline(
                owner,
                begin_receipt,
                composition,
                source_summary,
            )
            if _TYPE(parent) is not _SQLiteCursorPublicationMutationParentScope:
                raise ValueError("GE_SQLITE_P11_NATIVE_PROJECTION_ADOPTION")
            return _SQLiteCursorPublicationNativeProjectionAdoption(
                parent, receipt_snapshot
            )
        except BaseException as primary:
            if composition_record.lifecycle == "begin-adopted":
                _terminal_composition_failure(composition, composition_record, primary)
            raise

    return capture_and_adopt


_capture_and_adopt_sqlite_cursor_publication_native_projection_intrinsic = (
    _bind_sqlite_cursor_publication_native_projection_atomic_entry()
)
_seal_sqlite_cursor_publication_native_projection_bridge_intrinsic()


def _prepare_sqlite_cursor_publication_reusable_parent_intrinsic(
    parent: _SQLiteCursorPublicationMutationParentScope,
    _advance_native: Callable[
        [_SQLiteCursorPublicationMutationParentScope, _ParentRecord], None
    ] = _advance_native_projection_parent_state,
) -> None:
    state, composition, composition_record = _parent_record_for(parent)
    if (
        state.descriptor.model != "parent-owned-reusable"
        or state.lifecycle != "parent-issued"
        or state.reusable_parent_prepare_count != 0
    ):
        _poison_parent(state, composition, composition_record)
    state.reusable_parent_prepare_count = 1
    state.lifecycle = "awaiting-zero-postflight" if state.expected_count == 0 else "parent-ready"
    _advance_native(parent, state)


def _issue_sqlite_cursor_publication_mutation_child_permit_intrinsic(
    parent: _SQLiteCursorPublicationMutationParentScope,
    ordinal: int,
    _advance_native: Callable[
        [_SQLiteCursorPublicationMutationParentScope, _ParentRecord], None
    ] = _advance_native_projection_parent_state,
) -> _SQLiteCursorPublicationMutationChildPermit:
    state, composition, composition_record = _parent_record_for(parent)
    active_child = None if state.active_child_ref is None else state.active_child_ref()
    if (
        state.lifecycle != "parent-ready"
        or active_child is not None
        or _TYPE(ordinal) is not _INT
        or ordinal != state.next_ordinal
        or ordinal >= state.expected_count
    ):
        _poison_parent(state, composition, composition_record)
    child = _SQLiteCursorPublicationMutationChildPermit(parent, _CONSTRUCTION_TOKEN)
    child_record = _ChildRecord(ref(parent), ordinal, state.descriptor.model)
    _register_child(child, child_record)
    state.active_child_ref = ref(child)
    state.child_issued_count += 1
    state.lifecycle = "child-active"
    _advance_native(parent, state)
    return child


def _enter_sqlite_cursor_publication_mutation_child_permit_intrinsic(
    child: _SQLiteCursorPublicationMutationChildPermit,
    _advance_native: Callable[
        [_SQLiteCursorPublicationMutationParentScope, _ParentRecord], None
    ] = _advance_native_projection_parent_state,
) -> None:
    child_state, parent_state, parent = _child_record_for(child)
    _mutation_child_transition(
        child,
        child_state,
        parent_state,
        parent,
        "child-issued",
        "child-entered",
    )
    parent_state.child_entered_count += 1
    _advance_native(parent, parent_state)


def _record_sqlite_cursor_publication_mutation_child_return_intrinsic(
    child: _SQLiteCursorPublicationMutationChildPermit,
    _advance_native: Callable[
        [_SQLiteCursorPublicationMutationParentScope, _ParentRecord], None
    ] = _advance_native_projection_parent_state,
) -> None:
    child_state, parent_state, parent = _child_record_for(child)
    _mutation_child_transition(
        child,
        child_state,
        parent_state,
        parent,
        "child-entered",
        "child-native-returned",
    )
    parent_state.child_native_return_count += 1
    _advance_native(parent, parent_state)


def _retire_sqlite_cursor_publication_mutation_child_resource_intrinsic(
    child: _SQLiteCursorPublicationMutationChildPermit,
    _advance_native: Callable[
        [_SQLiteCursorPublicationMutationParentScope, _ParentRecord], None
    ] = _advance_native_projection_parent_state,
) -> None:
    child_state, parent_state, parent = _child_record_for(child)
    _mutation_child_transition(
        child,
        child_state,
        parent_state,
        parent,
        "child-native-returned",
        "child-resource-retired",
    )
    parent_state.child_resource_retired_count += 1
    if child_state.model == "parent-owned-reusable":
        parent_state.reusable_execution_lease_released_count += 1
    _advance_native(parent, parent_state)


def _accept_sqlite_cursor_publication_mutation_child_postflight_intrinsic(
    child: _SQLiteCursorPublicationMutationChildPermit,
    _advance_native: Callable[
        [_SQLiteCursorPublicationMutationParentScope, _ParentRecord], None
    ] = _advance_native_projection_parent_state,
) -> None:
    child_state, parent_state, parent = _child_record_for(child)
    _mutation_child_transition(
        child,
        child_state,
        parent_state,
        parent,
        "child-resource-retired",
        "child-postflight-accepted",
    )
    parent_state.child_postflight_accepted_count += 1
    _advance_native(parent, parent_state)


def _mutation_child_transition(
    child: _SQLiteCursorPublicationMutationChildPermit,
    child_state: _ChildRecord,
    parent_state: _ParentRecord,
    parent: _SQLiteCursorPublicationMutationParentScope,
    expected: str,
    successor: str,
) -> None:
    active = None if parent_state.active_child_ref is None else parent_state.active_child_ref()
    if (
        parent_state.lifecycle != "child-active"
        or active is not child
        or child_state.lifecycle != expected
    ):
        _state, composition, composition_record = _parent_record_for(parent)
        _poison_parent(parent_state, composition, composition_record, child_state)
    child_state.lifecycle = successor


def _consume_sqlite_cursor_publication_mutation_child_permit_intrinsic(
    child: _SQLiteCursorPublicationMutationChildPermit,
    _advance_native: Callable[
        [_SQLiteCursorPublicationMutationParentScope, _ParentRecord], None
    ] = _advance_native_projection_parent_state,
) -> None:
    child_state, parent_state, parent = _child_record_for(child)
    active = None if parent_state.active_child_ref is None else parent_state.active_child_ref()
    if (
        parent_state.lifecycle != "child-active"
        or active is not child
        or child_state.lifecycle != "child-postflight-accepted"
        or child_state.ordinal != parent_state.next_ordinal
        or parent_state.child_issued_count
        != parent_state.child_entered_count
        or parent_state.child_entered_count
        != parent_state.child_native_return_count
        or parent_state.child_native_return_count
        != parent_state.child_resource_retired_count
        or parent_state.child_resource_retired_count
        != parent_state.child_postflight_accepted_count
        or parent_state.child_postflight_accepted_count
        != parent_state.child_consumed_count + 1
    ):
        _state, composition, composition_record = _parent_record_for(parent)
        _poison_parent(parent_state, composition, composition_record, child_state)
    child_state.lifecycle = "child-consumed"
    parent_state.child_consumed_count += 1
    parent_state.next_ordinal += 1
    parent_state.active_child_ref = None
    if parent_state.next_ordinal < parent_state.expected_count:
        parent_state.lifecycle = "parent-ready"
    elif parent_state.descriptor.model == "parent-owned-reusable":
        parent_state.lifecycle = "awaiting-parent-resource-retirement"
    else:
        parent_state.lifecycle = "parent-complete"
    _advance_native(parent, parent_state)


def _accept_sqlite_cursor_publication_mutation_zero_item_postflight_intrinsic(
    parent: _SQLiteCursorPublicationMutationParentScope,
    _advance_native: Callable[
        [_SQLiteCursorPublicationMutationParentScope, _ParentRecord], None
    ] = _advance_native_projection_parent_state,
) -> None:
    state, composition, composition_record = _parent_record_for(parent)
    if state.expected_count != 0 or state.lifecycle != "awaiting-zero-postflight":
        _poison_parent(state, composition, composition_record)
    state.lifecycle = (
        "awaiting-parent-resource-retirement"
        if state.descriptor.model == "parent-owned-reusable"
        else "parent-complete"
    )
    _advance_native(parent, state)


def _retire_sqlite_cursor_publication_reusable_parent_resource_intrinsic(
    parent: _SQLiteCursorPublicationMutationParentScope,
    _advance_native: Callable[
        [_SQLiteCursorPublicationMutationParentScope, _ParentRecord], None
    ] = _advance_native_projection_parent_state,
) -> None:
    state, composition, composition_record = _parent_record_for(parent)
    if (
        state.descriptor.model != "parent-owned-reusable"
        or state.lifecycle != "awaiting-parent-resource-retirement"
        or state.reusable_parent_prepare_count != 1
        or state.parent_resource_retired_count != 0
    ):
        _poison_parent(state, composition, composition_record)
    state.parent_resource_retired_count = 1
    state.lifecycle = "parent-complete"
    _advance_native(parent, state)


def _consume_sqlite_cursor_publication_mutation_parent_scope_implementation(
    parent: _SQLiteCursorPublicationMutationParentScope,
    release_native: Callable[[_SQLiteCursorPublicationMutationParentScope], None],
    advance_native: Callable[
        [_SQLiteCursorPublicationMutationParentScope, _ParentRecord], None
    ],
) -> None:
    state, composition, composition_record = _parent_record_for(parent)
    if state.lifecycle != "parent-complete" or state.next_ordinal != state.expected_count:
        _poison_parent(state, composition, composition_record)
    state.lifecycle = "parent-consumed"
    if state.count_provenance == "lower-native":
        advance_native(parent, state)
        release_native(parent)


def _bind_sqlite_cursor_publication_mutation_parent_consumer() -> Callable[
    [_SQLiteCursorPublicationMutationParentScope], None
]:
    implementation = (
        _consume_sqlite_cursor_publication_mutation_parent_scope_implementation
    )
    release_native = _release_native_projection_parent_receipt
    advance_native = _advance_native_projection_parent_state

    def consume(parent: _SQLiteCursorPublicationMutationParentScope) -> None:
        implementation(parent, release_native, advance_native)

    return consume


_consume_sqlite_cursor_publication_mutation_parent_scope_intrinsic = (
    _bind_sqlite_cursor_publication_mutation_parent_consumer()
)


def _read_sqlite_cursor_publication_mutation_parent_scope_snapshot_intrinsic(
    parent: _SQLiteCursorPublicationMutationParentScope,
) -> _SQLiteCursorPublicationMutationParentScopeSnapshot:
    state, _composition, _composition_record = _parent_record_for(parent)
    return _SQLiteCursorPublicationMutationParentScopeSnapshot(
        state.descriptor.route_id,
        state.descriptor.binding_kind,
        state.descriptor.binding_sha256,
        state.descriptor.model,
        state.lifecycle,
        state.expected_count,
        state.next_ordinal,
        state.child_issued_count,
        state.child_entered_count,
        state.child_native_return_count,
        state.child_resource_retired_count,
        state.child_postflight_accepted_count,
        state.child_consumed_count,
        state.reusable_parent_prepare_count,
        state.reusable_execution_lease_released_count,
        state.parent_resource_retired_count,
        state.count_provenance,
        0,
        False,
    )


def _read_sqlite_cursor_publication_mutation_child_permit_snapshot_intrinsic(
    child: _SQLiteCursorPublicationMutationChildPermit,
) -> _SQLiteCursorPublicationMutationChildPermitSnapshot:
    state, _parent_state, _parent = _child_record_for(child)
    return _SQLiteCursorPublicationMutationChildPermitSnapshot(
        state.ordinal, state.model, state.lifecycle, 0, False
    )


def _issue_sqlite_cursor_publication_fixed_read_permit_intrinsic(
    composition: _SQLiteCursorPublicationOwnerComposition,
    descriptor: _SQLiteCursorPublicationFixedReadRouteDescriptor,
    maximum_rows: int,
) -> _SQLiteCursorPublicationFixedReadPermit:
    """Mint one exact fixed-read lattice token without executing or accepting SQL."""

    composition_record = _record_for(composition)
    if composition_record.lifecycle != "begin-adopted":
        _fail("GE_SQLITE_P11_FIXED_READ_INVALID")
    if (
        not _is_exact_fixed_read_descriptor(descriptor)
        or _TYPE(maximum_rows) is not _INT
        or maximum_rows < 0
        or maximum_rows > 4_096
    ):
        _terminal_composition_failure(
            composition,
            composition_record,
            ValueError("GE_SQLITE_P11_FIXED_READ_INVALID"),
        )
    try:
        _reauthenticate_composition(composition, composition_record)
    except BaseException as primary:
        _terminal_composition_failure(composition, composition_record, primary)
    permit = _SQLiteCursorPublicationFixedReadPermit(composition, _CONSTRUCTION_TOKEN)
    _register_fixed_read(permit, _FixedReadRecord(ref(composition), descriptor, maximum_rows))
    return permit


def _fixed_read_order(
    state: _FixedReadRecord,
    composition: _SQLiteCursorPublicationOwnerComposition,
    composition_record: _Record,
) -> Never:
    state.lifecycle = "poisoned"
    _terminal_composition_failure(
        composition,
        composition_record,
        ValueError("GE_SQLITE_P11_FIXED_READ_ORDER"),
    )


def _prepare_sqlite_cursor_publication_fixed_read_permit_intrinsic(
    permit: _SQLiteCursorPublicationFixedReadPermit,
) -> None:
    state, composition, composition_record = _fixed_read_record_for(permit)
    if state.lifecycle != "issued" or state.prepare_count != 0:
        _fixed_read_order(state, composition, composition_record)
    state.prepare_count = 1
    state.lifecycle = "prepared"


def _begin_sqlite_cursor_publication_fixed_read_intrinsic(
    permit: _SQLiteCursorPublicationFixedReadPermit,
) -> None:
    state, composition, composition_record = _fixed_read_record_for(permit)
    if state.lifecycle != "prepared":
        _fixed_read_order(state, composition, composition_record)
    state.lifecycle = "bounded-reading"


def _observe_sqlite_cursor_publication_fixed_read_row_intrinsic(
    permit: _SQLiteCursorPublicationFixedReadPermit,
) -> None:
    state, composition, composition_record = _fixed_read_record_for(permit)
    if state.lifecycle != "bounded-reading" or state.observed_rows >= state.maximum_rows:
        _fixed_read_order(state, composition, composition_record)
    state.observed_rows += 1


def _observe_sqlite_cursor_publication_fixed_read_terminal_intrinsic(
    permit: _SQLiteCursorPublicationFixedReadPermit,
) -> None:
    state, composition, composition_record = _fixed_read_record_for(permit)
    if state.lifecycle != "bounded-reading" or state.terminal_row_observed:
        _fixed_read_order(state, composition, composition_record)
    state.terminal_row_observed = True
    state.lifecycle = "terminal-row-observed"


def _retire_sqlite_cursor_publication_fixed_read_resource_intrinsic(
    permit: _SQLiteCursorPublicationFixedReadPermit,
    resource_kind: str,
) -> None:
    state, composition, composition_record = _fixed_read_record_for(permit)
    if (
        state.lifecycle != "terminal-row-observed"
        or state.resource_retired
        or resource_kind != "abstract-python-cursor-release"
    ):
        _fixed_read_order(state, composition, composition_record)
    state.resource_kind = resource_kind
    state.resource_retired = True
    state.lifecycle = "resource-retired"


def _consume_sqlite_cursor_publication_fixed_read_permit_intrinsic(
    permit: _SQLiteCursorPublicationFixedReadPermit,
) -> None:
    state, composition, composition_record = _fixed_read_record_for(permit)
    if state.lifecycle != "resource-retired" or state.consume_count != 0:
        _fixed_read_order(state, composition, composition_record)
    state.consume_count = 1
    state.lifecycle = "consumed"


def _read_sqlite_cursor_publication_fixed_read_permit_snapshot_intrinsic(
    permit: _SQLiteCursorPublicationFixedReadPermit,
) -> _SQLiteCursorPublicationFixedReadPermitSnapshot:
    state, _composition, _composition_record = _fixed_read_record_for(permit)
    return _SQLiteCursorPublicationFixedReadPermitSnapshot(
        state.descriptor.route_id,
        state.descriptor.sql_sha256,
        state.descriptor.family,
        state.lifecycle,
        state.maximum_rows,
        state.observed_rows,
        1,
        state.prepare_count,
        state.terminal_row_observed,
        state.resource_retired,
        state.resource_kind,
        state.consume_count,
        0,
        0,
        0,
        0,
        False,
    )


globals().pop("_retain_native_projection_parent_receipt", None)
globals().pop("_assert_native_projection_parent_receipt", None)
globals().pop("_advance_native_projection_parent_state", None)
globals().pop("_release_native_projection_parent_receipt", None)
globals().pop("_release_native_projection_composition_receipts", None)
globals().pop("_native_projection_parent_receipt_cell", None)
globals().pop("_adopt_sqlite_cursor_publication_native_projection_receipt_intrinsic", None)
globals().pop("_install_bound_sqlite_cursor_publication_native_projection_adopter", None)
globals().pop("_bind_sqlite_cursor_publication_native_projection_atomic_entry", None)
globals().pop(
    "_consume_sqlite_cursor_publication_mutation_parent_scope_implementation", None
)
globals().pop("_bind_sqlite_cursor_publication_mutation_parent_consumer", None)
globals().pop(
    "_install_sqlite_cursor_publication_native_projection_adopter_intrinsic", None
)
globals().pop(
    "_invoke_sqlite_cursor_publication_native_projection_pipeline_intrinsic", None
)
globals().pop(
    "_invoke_sqlite_cursor_publication_native_projection_receipt_consume_intrinsic",
    None,
)
globals().pop(
    "_invoke_sqlite_cursor_publication_native_projection_receipt_snapshot_intrinsic",
    None,
)
globals().pop("_seal_sqlite_cursor_publication_native_projection_bridge_intrinsic", None)
