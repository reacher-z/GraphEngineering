"""Package-private B0b-to-B3 cursor stage ownership state machine.

The bridge joins the exact A2b receipt and B0a captured-source witness to one
completed TEMP stage, owns the B2 campaign lifecycle, and provides the two
single-use assignment tails that publish outer ownership and initial-stage
adoption.  SQL stays in the stage/publication owners; this module retains only
exact authority, reader-lease, terminal cleanup, and retirement provenance.
"""

from __future__ import annotations

from collections.abc import Callable
from contextlib import suppress
from dataclasses import dataclass
from typing import Literal, NamedTuple, Never, cast
from weakref import ReferenceType, WeakKeyDictionary, ref

from .sqlite_operation_baseline import BaselineProjectionIdentity
from .sqlite_operation_baseline_cursor_ownership import (
    SQLiteCursorPreRebindReceipt,
    assert_sqlite_cursor_pre_rebind_receipt_provenance,
)
from .sqlite_operation_baseline_cursor_source_fence import (
    _CONSTRUCTION_TOKEN as _SOURCE_WITNESS_CONSTRUCTION_TOKEN,
)
from .sqlite_operation_baseline_cursor_source_fence import (
    _WITNESSES,
    _assert_registered_witness,
    _register_witness,
    _SQLiteCursorCapturedSourceConnectionWitness,
)
from .sqlite_operation_baseline_source import (
    SQLiteV1BaselineClockEvidence,
    SQLiteV1BaselineConnectionOwner,
    _assert_sqlite_v1_baseline_source_summary_provenance,
    _SQLiteCursorCapability,
)
from .sqlite_operation_baseline_stage import (
    SQLiteV1BaselineTempStage,
    _SQLiteBaselineCursorB2FenceRetirement,
    _SQLiteBaselineCursorInitialPublicationAdoptionTail,
    _SQLiteCursorInitialPublicationOuterLedgerWatermark,
    _SQLiteCursorInitialPublicationStageWatermark,
)

_CONSTRUCTION_TOKEN = object()


class _SQLiteCursorStageOwnershipTransfer:
    """Empty exact-identity handle whose authority lives in a weak registry."""

    __slots__ = ("__weakref__",)

    def __init__(self, construction_token: object) -> None:
        if construction_token is not _CONSTRUCTION_TOKEN:
            raise TypeError("cursor stage ownership transfers are module-minted")


_TransferLifecycle = Literal[
    "b2-active",
    "pre-rebind-complete",
    "outer-publication-prepared",
    "outer-publication-owned",
    "initial-publication-adoption-prepared",
    "initial-publication-adopted",
    "retired",
    "poisoned",
]
_PostDdlReaderLifecycle = Literal["unused", "active", "closed", "poisoned"]


class _SQLiteCursorStageOwnershipOuterPublicationAuthority:
    """Exact package-private inactive/active outer-owner identity."""

    __slots__ = ("__weakref__",)

    def __init__(self, construction_token: object) -> None:
        if construction_token is not _CONSTRUCTION_TOKEN:
            raise TypeError("cursor outer publication authorities are module-minted")


class _SQLiteCursorStageOwnershipOuterPublicationTail:
    """Single-use continuation for the outer-publication assignment tail."""

    __slots__ = ("__weakref__",)

    def __init__(self, construction_token: object) -> None:
        if construction_token is not _CONSTRUCTION_TOKEN:
            raise TypeError("cursor outer publication tails are module-minted")


class _SQLiteCursorStageOwnershipOuterPublicationMint(NamedTuple):
    authority: _SQLiteCursorStageOwnershipOuterPublicationAuthority
    tail: _SQLiteCursorStageOwnershipOuterPublicationTail


class _SQLiteCursorStageOwnershipInitialPublicationAdoptionTail:
    """Single-use continuation for the stage-adoption assignment tail."""

    __slots__ = ("__weakref__",)

    def __init__(self, construction_token: object) -> None:
        if construction_token is not _CONSTRUCTION_TOKEN:
            raise TypeError("cursor initial publication adoption tails are module-minted")


class _SQLiteCursorStageOwnershipInitialPublicationAdoptionMint(NamedTuple):
    retired_b2_fence: _SQLiteBaselineCursorB2FenceRetirement
    tail: _SQLiteCursorStageOwnershipInitialPublicationAdoptionTail
    watermark: _SQLiteCursorInitialPublicationStageWatermark


@dataclass(slots=True, weakref_slot=True)
class _TransferMetadata:
    connection: SQLiteV1BaselineConnectionOwner
    stage: SQLiteV1BaselineTempStage
    receipt: SQLiteCursorPreRebindReceipt
    witness: _SQLiteCursorCapturedSourceConnectionWitness
    stage_session: object
    projection_identity: BaselineProjectionIdentity
    lifecycle: _TransferLifecycle = "b2-active"
    outer_authority_ref: (
        ReferenceType[_SQLiteCursorStageOwnershipOuterPublicationAuthority] | None
    ) = None
    outer_tail: _SQLiteCursorStageOwnershipOuterPublicationTail | None = None
    initial_publication_adoption_mint: (
        _SQLiteCursorStageOwnershipInitialPublicationAdoptionMint | None
    ) = None
    initial_publication_adoption_tail: (
        _SQLiteCursorStageOwnershipInitialPublicationAdoptionTail | None
    ) = None
    initial_publication_adoption_retired_b2_fence: _SQLiteBaselineCursorB2FenceRetirement | None = (
        None
    )
    initial_publication_adoption_stage_watermark: (
        _SQLiteCursorInitialPublicationStageWatermark | None
    ) = None
    initial_publication_adoption_watermark_record: tuple[int, int, int, str, int, int] | None = None
    post_ddl_reader_cleanup: Callable[[], None] | None = None
    post_ddl_reader_lease: object | None = None
    post_ddl_reader_lifecycle: _PostDdlReaderLifecycle = "unused"


_TRANSFERS: WeakKeyDictionary[_SQLiteCursorStageOwnershipTransfer, _TransferMetadata] = (
    WeakKeyDictionary()
)


@dataclass(frozen=True, slots=True)
class _OuterPublicationTailContinuation:
    tail_ref: ReferenceType[_SQLiteCursorStageOwnershipOuterPublicationTail]
    authority_ref: ReferenceType[_SQLiteCursorStageOwnershipOuterPublicationAuthority]
    stage: SQLiteV1BaselineTempStage
    transfer_ref: ReferenceType[_TransferMetadata]


@dataclass(frozen=True, slots=True)
class _InitialPublicationAdoptionTailContinuation:
    tail_ref: ReferenceType[_SQLiteCursorStageOwnershipInitialPublicationAdoptionTail]
    stage_tail: _SQLiteBaselineCursorInitialPublicationAdoptionTail
    transfer_ref: ReferenceType[_TransferMetadata]


# These registries deliberately do not key on the caller-provided object.  A
# WeakKeyDictionary would execute hostile ``__hash__``/``__eq__`` hooks before
# validating exact provenance.  The id-keyed entry carries a weak referent and
# every lookup requires exact type plus ``referent is token`` before mutation.
_OUTER_PUBLICATION_TAILS: dict[int, _OuterPublicationTailContinuation] = {}
_INITIAL_PUBLICATION_ADOPTION_TAILS: dict[int, _InitialPublicationAdoptionTailContinuation] = {}

_DICT_GET = dict.get
_DICT_POP = dict.pop
_DICT_SETITEM = dict.__setitem__


def _retire_dead_outer_tail(
    tail_id: int,
    tail_ref: ReferenceType[_SQLiteCursorStageOwnershipOuterPublicationTail],
) -> None:
    continuation = _DICT_GET(_OUTER_PUBLICATION_TAILS, tail_id)
    if continuation is not None and continuation.tail_ref is tail_ref:
        _DICT_POP(_OUTER_PUBLICATION_TAILS, tail_id, None)


def _retire_dead_adoption_tail(
    tail_id: int,
    tail_ref: ReferenceType[_SQLiteCursorStageOwnershipInitialPublicationAdoptionTail],
) -> None:
    continuation = _DICT_GET(_INITIAL_PUBLICATION_ADOPTION_TAILS, tail_id)
    if continuation is not None and continuation.tail_ref is tail_ref:
        _DICT_POP(_INITIAL_PUBLICATION_ADOPTION_TAILS, tail_id, None)


class _SQLiteCursorPreRebindCampaignAuthority:
    """Empty exact-identity B2 handle backed only by a weak registry."""

    __slots__ = ("__weakref__",)

    def __init__(self, construction_token: object) -> None:
        if construction_token is not _CONSTRUCTION_TOKEN:
            raise TypeError("cursor pre-rebind campaign authorities are module-minted")


@dataclass(frozen=True, slots=True)
class _CampaignAuthorityMetadata:
    connection: SQLiteV1BaselineConnectionOwner
    stage: SQLiteV1BaselineTempStage
    receipt: SQLiteCursorPreRebindReceipt
    transfer: _SQLiteCursorStageOwnershipTransfer
    transfer_session: object
    campaign_session: object


_CAMPAIGNS: WeakKeyDictionary[
    _SQLiteCursorPreRebindCampaignAuthority, _CampaignAuthorityMetadata
] = WeakKeyDictionary()

# Abort paths must preserve an already-authoritative primary even if hostile
# code later replaces the mutable registry class API.  Capture the unbound
# intrinsic once and invoke it directly for best-effort registry retirement.
_WEAK_KEY_DICTIONARY_POP = WeakKeyDictionary.pop

# Freeze the exact stage intrinsics before any hostile class-level replacement.
# Internal calls must never redispatch through a mutable class attribute.
_STAGE_BEGIN_TRANSFER = SQLiteV1BaselineTempStage._begin_cursor_stage_transfer
_STAGE_ASSERT_TRANSFER = SQLiteV1BaselineTempStage._assert_cursor_stage_transfer
_STAGE_ABORT_TRANSFER = SQLiteV1BaselineTempStage._abort_cursor_stage_transfer
_STAGE_CREATE_CURSOR_SEAL_TEMP_TABLE = SQLiteV1BaselineTempStage._create_cursor_seal_temp_table
_STAGE_BEGIN_CAMPAIGN = SQLiteV1BaselineTempStage._begin_cursor_pre_rebind_campaign
_STAGE_ASSERT_CAMPAIGN = SQLiteV1BaselineTempStage._assert_cursor_pre_rebind_campaign
_STAGE_REGISTER_CAMPAIGN_CURSOR = (
    SQLiteV1BaselineTempStage._register_cursor_pre_rebind_campaign_cursor
)
_STAGE_FINALIZE_CAMPAIGN_CURSOR = (
    SQLiteV1BaselineTempStage._finalize_cursor_pre_rebind_campaign_cursor
)
_STAGE_ADOPT_CAMPAIGN_INSERT = SQLiteV1BaselineTempStage._adopt_cursor_pre_rebind_insert
_STAGE_COMPLETE_CAMPAIGN = SQLiteV1BaselineTempStage._complete_cursor_pre_rebind_campaign
_STAGE_ABORT_CAMPAIGN = SQLiteV1BaselineTempStage._abort_cursor_pre_rebind_campaign
_STAGE_ASSERT_PRE_REBIND_COMPLETE = SQLiteV1BaselineTempStage._assert_cursor_pre_rebind_complete
_STAGE_PREPARE_OUTER_PUBLICATION = SQLiteV1BaselineTempStage._prepare_cursor_outer_publication
_STAGE_PUBLISH_OUTER_PUBLICATION = SQLiteV1BaselineTempStage._publish_cursor_outer_publication
_STAGE_ASSERT_OUTER_PUBLICATION_OWNED = (
    SQLiteV1BaselineTempStage._assert_cursor_outer_publication_owned
)
_STAGE_ASSERT_OUTER_PUBLICATION_ACTIVE = (
    SQLiteV1BaselineTempStage._assert_cursor_outer_publication_active
)
_STAGE_REGISTER_POST_DDL_READER_CLEANUP = (
    SQLiteV1BaselineTempStage._register_cursor_post_ddl_reader_cleanup
)
_STAGE_CLEAR_POST_DDL_READER_CLEANUP = (
    SQLiteV1BaselineTempStage._clear_cursor_post_ddl_reader_cleanup
)
_STAGE_PREPARE_INITIAL_PUBLICATION_ADOPTION = (
    SQLiteV1BaselineTempStage._prepare_cursor_initial_publication_adoption
)
_STAGE_PUBLISH_INITIAL_PUBLICATION_ADOPTION = (
    SQLiteV1BaselineTempStage._publish_cursor_initial_publication_adoption
)
_STAGE_ASSERT_INITIAL_PUBLICATION_ADOPTED = (
    SQLiteV1BaselineTempStage._assert_cursor_initial_publication_adopted
)
_STAGE_RETIRE_OUTER_PUBLICATION = SQLiteV1BaselineTempStage._retire_cursor_outer_publication
_STAGE_POISON_OUTER_PUBLICATION = SQLiteV1BaselineTempStage._poison_cursor_outer_publication
_OWNER_TRANSACTION_EPOCH_GETTER = cast(
    "Callable[[SQLiteV1BaselineConnectionOwner], int]",
    cast(property, SQLiteV1BaselineConnectionOwner.__dict__["transaction_epoch"]).fget,
)
_OWNER_EXCLUSIVE_TRANSACTION_GETTER = cast(
    "Callable[[SQLiteV1BaselineConnectionOwner], bool]",
    cast(property, SQLiteV1BaselineConnectionOwner.__dict__["in_exclusive_transaction"]).fget,
)


def _mint_hardened_source_witness(
    connection: SQLiteV1BaselineConnectionOwner,
    receipt: SQLiteCursorPreRebindReceipt,
) -> _SQLiteCursorCapturedSourceConnectionWitness:
    """Mint the registered B0a witness without mutable descriptor dispatch."""

    provenance = assert_sqlite_cursor_pre_rebind_receipt_provenance(receipt)
    if type(connection) is not SQLiteV1BaselineConnectionOwner:
        raise TypeError("cursor captured-source connection has the wrong type")
    summary = provenance.source_summary
    clock = provenance.clock_evidence
    _assert_sqlite_v1_baseline_source_summary_provenance(summary)
    if type(clock) is not SQLiteV1BaselineClockEvidence or clock is not summary.clock_evidence:
        raise ValueError("cursor captured-source clock ownership is invalid")
    if summary._connection is not connection:
        raise ValueError("cursor captured-source connection ownership is invalid")
    try:
        epoch = _OWNER_TRANSACTION_EPOCH_GETTER(connection)
        in_exclusive_transaction = _OWNER_EXCLUSIVE_TRANSACTION_GETTER(connection)
        confirmed_epoch = _OWNER_TRANSACTION_EPOCH_GETTER(connection)
    except Exception:
        raise ValueError("cursor captured-source connection is closed or unavailable") from None
    if (
        not in_exclusive_transaction
        or summary._captured_transaction_epoch != epoch
        or confirmed_epoch != epoch
    ):
        raise ValueError("cursor captured-source transaction epoch is invalid")
    witness = _SQLiteCursorCapturedSourceConnectionWitness(
        connection,
        receipt,
        provenance,
        summary,
        clock,
        epoch,
        _SOURCE_WITNESS_CONSTRUCTION_TOKEN,
    )
    _register_witness(witness)
    try:
        metadata = _assert_registered_witness(witness)
        if (
            metadata.connection is not connection
            or metadata.receipt is not receipt
            or metadata.provenance is not provenance
            or metadata.source_summary is not summary
            or metadata.clock_evidence is not clock
            or metadata.transaction_epoch != epoch
            or _OWNER_TRANSACTION_EPOCH_GETTER(connection) != epoch
            or not _OWNER_EXCLUSIVE_TRANSACTION_GETTER(connection)
            or _OWNER_TRANSACTION_EPOCH_GETTER(connection) != epoch
        ):
            raise ValueError("cursor captured-source connection witness drifted")
    except BaseException:
        _WITNESSES.pop(witness, None)
        raise
    return witness


def _begin_sqlite_cursor_stage_ownership_transfer(
    connection: SQLiteV1BaselineConnectionOwner,
    stage: SQLiteV1BaselineTempStage,
    receipt: SQLiteCursorPreRebindReceipt,
) -> _SQLiteCursorStageOwnershipTransfer:
    """Fence A2b/B0a first, then atomically publish exactly one B0b handle."""

    # Receipt authority is always first, including wrong/closed owner paths.
    provenance = assert_sqlite_cursor_pre_rebind_receipt_provenance(receipt)
    witness = _mint_hardened_source_witness(connection, receipt)
    transfer = _SQLiteCursorStageOwnershipTransfer(_CONSTRUCTION_TOKEN)
    if type(stage) is not SQLiteV1BaselineTempStage:
        raise TypeError("cursor stage ownership transfer has the wrong stage type")

    session: object | None = None
    try:
        session = _STAGE_BEGIN_TRANSFER(stage, connection, receipt, witness)
        _TRANSFERS[transfer] = _TransferMetadata(
            connection,
            stage,
            receipt,
            witness,
            session,
            provenance.projection_identity,
        )
    except BaseException as primary:
        _STAGE_ABORT_TRANSFER(
            stage,
            session,
            primary,
        )
    return transfer


def _assert_sqlite_cursor_stage_ownership_transfer(
    connection: SQLiteV1BaselineConnectionOwner,
    stage: SQLiteV1BaselineTempStage,
    receipt: SQLiteCursorPreRebindReceipt,
    transfer: _SQLiteCursorStageOwnershipTransfer,
) -> _SQLiteCursorStageOwnershipTransfer:
    """Revalidate exact live stage ownership without rerunning capture epoch."""

    # A2b remains authoritative even for a forged handle or disposed stage.
    assert_sqlite_cursor_pre_rebind_receipt_provenance(receipt)
    if type(transfer) is not _SQLiteCursorStageOwnershipTransfer:
        raise TypeError("cursor stage ownership transfer has the wrong type")
    metadata = _TRANSFERS.get(transfer)
    if metadata is None:
        raise ValueError("cursor stage ownership transfer provenance is invalid")
    if (
        type(connection) is not SQLiteV1BaselineConnectionOwner
        or type(stage) is not SQLiteV1BaselineTempStage
        or metadata.connection is not connection
        or metadata.stage is not stage
        or metadata.receipt is not receipt
        or metadata.lifecycle in {"retired", "poisoned"}
    ):
        raise ValueError("cursor stage ownership transfer context is invalid")
    if metadata.lifecycle == "initial-publication-adopted":
        mint = metadata.initial_publication_adoption_mint
        outer_authority = _metadata_outer_publication_authority(metadata)
        if (
            outer_authority is None
            or metadata.post_ddl_reader_lease is None
            or mint is None
            or metadata.initial_publication_adoption_retired_b2_fence is None
            or metadata.initial_publication_adoption_stage_watermark is None
        ):
            raise ValueError("cursor initial publication adopted authority is invalid")
        _STAGE_ASSERT_INITIAL_PUBLICATION_ADOPTED(
            stage,
            outer_authority,
            metadata.post_ddl_reader_lease,
            metadata.initial_publication_adoption_retired_b2_fence,
            metadata.initial_publication_adoption_stage_watermark,
        )
        return transfer
    try:
        _STAGE_ASSERT_TRANSFER(
            stage,
            connection,
            receipt,
            metadata.stage_session,
        )
    except BaseException:
        metadata.lifecycle = "poisoned"
        raise
    return transfer


def _create_sqlite_cursor_seal_temp_table(
    connection: SQLiteV1BaselineConnectionOwner,
    stage: SQLiteV1BaselineTempStage,
    receipt: SQLiteCursorPreRebindReceipt,
    transfer: _SQLiteCursorStageOwnershipTransfer,
) -> _SQLiteCursorStageOwnershipTransfer:
    """Run B1 through the exact retained B0b authority and return that handle."""

    _assert_sqlite_cursor_stage_ownership_transfer(
        connection,
        stage,
        receipt,
        transfer,
    )
    metadata = _TRANSFERS.get(transfer)
    if metadata is None or metadata.lifecycle != "b2-active":
        raise ValueError("cursor stage ownership transfer provenance is invalid")
    try:
        _STAGE_CREATE_CURSOR_SEAL_TEMP_TABLE(
            stage,
            connection,
            receipt,
            metadata.stage_session,
        )
    except BaseException:
        metadata.lifecycle = "poisoned"
        raise
    return transfer


def _begin_sqlite_cursor_pre_rebind_campaign(
    connection: SQLiteV1BaselineConnectionOwner,
    stage: SQLiteV1BaselineTempStage,
    receipt: SQLiteCursorPreRebindReceipt,
    transfer: _SQLiteCursorStageOwnershipTransfer,
) -> _SQLiteCursorPreRebindCampaignAuthority:
    """Validate B1 and atomically publish one registered B2 authority."""

    _assert_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt, transfer)
    transfer_metadata = _TRANSFERS.get(transfer)
    if transfer_metadata is None or transfer_metadata.lifecycle != "b2-active":
        raise ValueError("cursor stage ownership transfer provenance is invalid")
    authority = _SQLiteCursorPreRebindCampaignAuthority(_CONSTRUCTION_TOKEN)
    campaign_session: object | None = None
    try:
        campaign_session = _STAGE_BEGIN_CAMPAIGN(
            stage,
            connection,
            receipt,
            transfer_metadata.stage_session,
        )
        _CAMPAIGNS[authority] = _CampaignAuthorityMetadata(
            connection,
            stage,
            receipt,
            transfer,
            transfer_metadata.stage_session,
            campaign_session,
        )
    except BaseException as primary:
        transfer_metadata.lifecycle = "poisoned"
        _STAGE_ABORT_CAMPAIGN(stage, campaign_session, primary)
    return authority


def _campaign_metadata(
    connection: SQLiteV1BaselineConnectionOwner,
    stage: SQLiteV1BaselineTempStage,
    receipt: SQLiteCursorPreRebindReceipt,
    authority: _SQLiteCursorPreRebindCampaignAuthority,
) -> _CampaignAuthorityMetadata:
    assert_sqlite_cursor_pre_rebind_receipt_provenance(receipt)
    if type(authority) is not _SQLiteCursorPreRebindCampaignAuthority:
        raise TypeError("cursor pre-rebind campaign authority has the wrong type")
    metadata = _CAMPAIGNS.get(authority)
    if metadata is None:
        raise ValueError("cursor pre-rebind campaign authority provenance is invalid")
    if (
        type(connection) is not SQLiteV1BaselineConnectionOwner
        or type(stage) is not SQLiteV1BaselineTempStage
        or metadata.connection is not connection
        or metadata.stage is not stage
        or metadata.receipt is not receipt
    ):
        raise ValueError("cursor pre-rebind campaign authority context is invalid")
    transfer_metadata = _TRANSFERS.get(metadata.transfer)
    if (
        transfer_metadata is None
        or transfer_metadata.connection is not connection
        or transfer_metadata.stage is not stage
        or transfer_metadata.receipt is not receipt
        or transfer_metadata.stage_session is not metadata.transfer_session
        or transfer_metadata.lifecycle != "b2-active"
    ):
        raise ValueError("cursor pre-rebind campaign transfer authority drifted")
    return metadata


def _assert_sqlite_cursor_pre_rebind_campaign(
    connection: SQLiteV1BaselineConnectionOwner,
    stage: SQLiteV1BaselineTempStage,
    receipt: SQLiteCursorPreRebindReceipt,
    authority: _SQLiteCursorPreRebindCampaignAuthority,
) -> None:
    metadata = _campaign_metadata(connection, stage, receipt, authority)
    _STAGE_ASSERT_CAMPAIGN(
        stage,
        connection,
        receipt,
        metadata.transfer_session,
        metadata.campaign_session,
    )


def _register_sqlite_cursor_campaign_cursor(
    connection: SQLiteV1BaselineConnectionOwner,
    stage: SQLiteV1BaselineTempStage,
    receipt: SQLiteCursorPreRebindReceipt,
    authority: _SQLiteCursorPreRebindCampaignAuthority,
    cursor: _SQLiteCursorCapability,
    role: str,
    rule_index: int | None,
) -> None:
    metadata = _campaign_metadata(connection, stage, receipt, authority)
    _STAGE_REGISTER_CAMPAIGN_CURSOR(
        stage,
        connection,
        receipt,
        metadata.transfer_session,
        metadata.campaign_session,
        cursor,
        role,
        rule_index,
    )


def _finalize_sqlite_cursor_campaign_cursor(
    connection: SQLiteV1BaselineConnectionOwner,
    stage: SQLiteV1BaselineTempStage,
    receipt: SQLiteCursorPreRebindReceipt,
    authority: _SQLiteCursorPreRebindCampaignAuthority,
    cursor: _SQLiteCursorCapability,
    *,
    primary: BaseException | None,
) -> None:
    metadata = _campaign_metadata(connection, stage, receipt, authority)
    if primary is not None:
        with suppress(BaseException):
            _STAGE_FINALIZE_CAMPAIGN_CURSOR(
                stage,
                connection,
                receipt,
                metadata.transfer_session,
                metadata.campaign_session,
                cursor,
                preserve_primary=True,
            )
        return
    _STAGE_FINALIZE_CAMPAIGN_CURSOR(
        stage,
        connection,
        receipt,
        metadata.transfer_session,
        metadata.campaign_session,
        cursor,
        preserve_primary=False,
    )


def _adopt_sqlite_cursor_campaign_insert(
    connection: SQLiteV1BaselineConnectionOwner,
    stage: SQLiteV1BaselineTempStage,
    receipt: SQLiteCursorPreRebindReceipt,
    authority: _SQLiteCursorPreRebindCampaignAuthority,
    before_changes: int,
    rowcount: int,
) -> None:
    metadata = _campaign_metadata(connection, stage, receipt, authority)
    _STAGE_ADOPT_CAMPAIGN_INSERT(
        stage,
        connection,
        receipt,
        metadata.transfer_session,
        metadata.campaign_session,
        before_changes,
        rowcount,
    )


def _complete_sqlite_cursor_pre_rebind_campaign(
    connection: SQLiteV1BaselineConnectionOwner,
    stage: SQLiteV1BaselineTempStage,
    receipt: SQLiteCursorPreRebindReceipt,
    authority: _SQLiteCursorPreRebindCampaignAuthority,
    outcome_kind: str,
) -> None:
    metadata = _campaign_metadata(connection, stage, receipt, authority)
    if outcome_kind not in {"pre-rebind-complete", "diagnosed"}:
        raise ValueError("cursor pre-rebind campaign outcome is invalid")
    _STAGE_COMPLETE_CAMPAIGN(
        stage,
        connection,
        receipt,
        metadata.transfer_session,
        metadata.campaign_session,
        cast("Literal['pre-rebind-complete', 'diagnosed']", outcome_kind),
    )
    _CAMPAIGNS.pop(authority, None)
    if outcome_kind == "diagnosed":
        # A diagnosed campaign is terminal and cannot flow into B3.  Retire
        # the public transfer authority together with the stage-owned session
        # instead of leaving a registry entry that can only fail downstream.
        _TRANSFERS.pop(metadata.transfer, None)
    else:
        transfer_metadata = _TRANSFERS.get(metadata.transfer)
        if transfer_metadata is None or transfer_metadata.lifecycle != "b2-active":
            raise ValueError("cursor pre-rebind campaign transfer authority drifted")
        transfer_metadata.lifecycle = "pre-rebind-complete"


def _abort_sqlite_cursor_pre_rebind_campaign(
    connection: SQLiteV1BaselineConnectionOwner,
    stage: SQLiteV1BaselineTempStage,
    receipt: SQLiteCursorPreRebindReceipt,
    authority: _SQLiteCursorPreRebindCampaignAuthority | None,
    primary: BaseException,
) -> Never:
    if authority is None:
        raise primary
    # Do not re-run the fallible public authority/context validator while an
    # earlier exception is already authoritative.  A registry/context fault
    # here must neither replace `primary` nor skip stage poisoning and cursor
    # cleanup.  A missing or drifted registry entry is represented to the
    # stage as an absent session; the stage abort intrinsic still burns B2 and
    # preserves the supplied exception identity.
    try:
        metadata = _WEAK_KEY_DICTIONARY_POP(_CAMPAIGNS, authority, None)
    except BaseException:
        metadata = None
    campaign_session = (
        metadata.campaign_session
        if metadata is not None
        and metadata.connection is connection
        and metadata.stage is stage
        and metadata.receipt is receipt
        else None
    )
    if metadata is not None:
        transfer_metadata = _TRANSFERS.get(metadata.transfer)
        if transfer_metadata is not None:
            transfer_metadata.lifecycle = "poisoned"
    _STAGE_ABORT_CAMPAIGN(stage, campaign_session, primary)


def _checked_outer_publication_authority(
    authority: object,
) -> _SQLiteCursorStageOwnershipOuterPublicationAuthority:
    if type(authority) is not _SQLiteCursorStageOwnershipOuterPublicationAuthority:
        raise ValueError("SQLite cursor outer publication authority is invalid")
    return authority


def _metadata_outer_publication_authority(
    metadata: _TransferMetadata,
) -> _SQLiteCursorStageOwnershipOuterPublicationAuthority | None:
    authority_ref = metadata.outer_authority_ref
    if authority_ref is None:
        return None
    authority = authority_ref()
    return (
        authority
        if type(authority) is _SQLiteCursorStageOwnershipOuterPublicationAuthority
        else None
    )


def _read_transfer_metadata(
    transfer: object,
) -> _TransferMetadata | None:
    if type(transfer) is not _SQLiteCursorStageOwnershipTransfer:
        return None
    return _TRANSFERS.get(transfer)


def _checked_transfer_identity_graph(
    connection: SQLiteV1BaselineConnectionOwner,
    stage: SQLiteV1BaselineTempStage,
    receipt: SQLiteCursorPreRebindReceipt,
    projection_identity: BaselineProjectionIdentity,
    transfer: _SQLiteCursorStageOwnershipTransfer,
) -> _TransferMetadata:
    if type(transfer) is not _SQLiteCursorStageOwnershipTransfer:
        raise TypeError("cursor stage ownership transfer has the wrong type")
    metadata = _TRANSFERS.get(transfer)
    if (
        metadata is None
        or type(connection) is not SQLiteV1BaselineConnectionOwner
        or type(stage) is not SQLiteV1BaselineTempStage
        or type(projection_identity) is not BaselineProjectionIdentity
        or metadata.connection is not connection
        or metadata.stage is not stage
        or metadata.receipt is not receipt
        or metadata.projection_identity is not projection_identity
    ):
        raise ValueError("SQLite cursor stage ownership transfer provenance is invalid")
    return metadata


def _checked_transfer_graph(
    connection: SQLiteV1BaselineConnectionOwner,
    stage: SQLiteV1BaselineTempStage,
    receipt: SQLiteCursorPreRebindReceipt,
    projection_identity: BaselineProjectionIdentity,
    transfer: _SQLiteCursorStageOwnershipTransfer,
) -> _TransferMetadata:
    metadata = _checked_transfer_identity_graph(
        connection, stage, receipt, projection_identity, transfer
    )
    provenance = assert_sqlite_cursor_pre_rebind_receipt_provenance(receipt)
    if provenance.projection_identity is not projection_identity:
        raise ValueError("SQLite cursor stage ownership transfer projection is invalid")
    return metadata


def _register_outer_publication_tail(
    tail: _SQLiteCursorStageOwnershipOuterPublicationTail,
    authority: _SQLiteCursorStageOwnershipOuterPublicationAuthority,
    stage: SQLiteV1BaselineTempStage,
    metadata: _TransferMetadata,
) -> None:
    tail_id = id(tail)

    def retire_tail(
        current: ReferenceType[_SQLiteCursorStageOwnershipOuterPublicationTail],
    ) -> None:
        _retire_dead_outer_tail(tail_id, current)

    tail_ref = ref(tail, retire_tail)
    continuation = _OuterPublicationTailContinuation(
        tail_ref,
        ref(authority),
        stage,
        ref(metadata),
    )
    _DICT_SETITEM(_OUTER_PUBLICATION_TAILS, tail_id, continuation)


def _register_initial_publication_adoption_tail(
    tail: _SQLiteCursorStageOwnershipInitialPublicationAdoptionTail,
    stage_tail: _SQLiteBaselineCursorInitialPublicationAdoptionTail,
    metadata: _TransferMetadata,
) -> None:
    tail_id = id(tail)

    def retire_tail(
        current: ReferenceType[_SQLiteCursorStageOwnershipInitialPublicationAdoptionTail],
    ) -> None:
        _retire_dead_adoption_tail(tail_id, current)

    tail_ref = ref(tail, retire_tail)
    continuation = _InitialPublicationAdoptionTailContinuation(
        tail_ref,
        stage_tail,
        ref(metadata),
    )
    _DICT_SETITEM(_INITIAL_PUBLICATION_ADOPTION_TAILS, tail_id, continuation)


def _initial_publication_watermark_record(
    watermark: _SQLiteCursorInitialPublicationStageWatermark,
) -> tuple[int, int, int, str, int, int]:
    if type(watermark) is not _SQLiteCursorInitialPublicationStageWatermark:
        raise ValueError("SQLite cursor initial publication stage watermark is invalid")
    ledger = watermark.outer_ledger
    if type(ledger) is not _SQLiteCursorInitialPublicationOuterLedgerWatermark:
        raise ValueError("SQLite cursor initial publication stage watermark is invalid")
    return (
        ledger.affected_rows_watermark,
        ledger.fixed_statement_count,
        ledger.logical_write_sequence,
        watermark.target_catalog_sha256,
        watermark.total_changes,
        watermark.transaction_epoch,
    )


def _copy_initial_publication_watermark(
    watermark: _SQLiteCursorInitialPublicationStageWatermark,
) -> _SQLiteCursorInitialPublicationStageWatermark:
    record = _initial_publication_watermark_record(watermark)
    return _SQLiteCursorInitialPublicationStageWatermark(
        _SQLiteCursorInitialPublicationOuterLedgerWatermark(record[0], record[1], record[2]),
        record[3],
        record[4],
        record[5],
    )


def _burn_outer_publication_tail(
    tail: _SQLiteCursorStageOwnershipOuterPublicationTail | None,
) -> None:
    if tail is None:
        return
    continuation = _DICT_GET(_OUTER_PUBLICATION_TAILS, id(tail))
    if continuation is not None and continuation.tail_ref() is tail:
        _DICT_POP(_OUTER_PUBLICATION_TAILS, id(tail), None)


def _burn_initial_publication_adoption_tail(
    tail: _SQLiteCursorStageOwnershipInitialPublicationAdoptionTail | None,
) -> None:
    if tail is None:
        return
    continuation = _DICT_GET(_INITIAL_PUBLICATION_ADOPTION_TAILS, id(tail))
    if continuation is not None and continuation.tail_ref() is tail:
        _DICT_POP(_INITIAL_PUBLICATION_ADOPTION_TAILS, id(tail), None)


def _assert_sqlite_cursor_stage_ownership_pre_rebind_complete_intrinsic(
    connection: SQLiteV1BaselineConnectionOwner,
    stage: SQLiteV1BaselineTempStage,
    receipt: SQLiteCursorPreRebindReceipt,
    projection_identity: BaselineProjectionIdentity,
    transfer: _SQLiteCursorStageOwnershipTransfer,
) -> _SQLiteCursorStageOwnershipTransfer:
    """Validate the exact completed B2 graph before outer-authority work."""

    metadata = _checked_transfer_graph(connection, stage, receipt, projection_identity, transfer)
    if metadata.lifecycle in {"b2-active", "retired", "poisoned"}:
        raise ValueError("SQLite cursor pre-rebind transfer is not complete")
    _STAGE_ASSERT_PRE_REBIND_COMPLETE(
        stage,
        connection,
        receipt,
        projection_identity,
        metadata.stage_session,
    )
    return transfer


def _mint_sqlite_cursor_stage_ownership_outer_publication_authority_intrinsic(
    connection: SQLiteV1BaselineConnectionOwner,
    stage: SQLiteV1BaselineTempStage,
    receipt: SQLiteCursorPreRebindReceipt,
    projection_identity: BaselineProjectionIdentity,
    transfer: _SQLiteCursorStageOwnershipTransfer,
) -> _SQLiteCursorStageOwnershipOuterPublicationMint:
    """Mint and bind one inactive package-owned outer authority."""

    metadata = _checked_transfer_graph(connection, stage, receipt, projection_identity, transfer)
    if metadata.lifecycle == "outer-publication-prepared":
        authority = _metadata_outer_publication_authority(metadata)
        if authority is None or metadata.outer_tail is None:
            raise ValueError("SQLite cursor outer publication authority is invalid")
        return _SQLiteCursorStageOwnershipOuterPublicationMint(
            authority,
            metadata.outer_tail,
        )
    if (
        metadata.lifecycle != "pre-rebind-complete"
        or metadata.outer_authority_ref is not None
        or metadata.outer_tail is not None
    ):
        raise ValueError("SQLite cursor outer publication preparation is invalid")
    authority = _SQLiteCursorStageOwnershipOuterPublicationAuthority(_CONSTRUCTION_TOKEN)
    tail = _SQLiteCursorStageOwnershipOuterPublicationTail(_CONSTRUCTION_TOKEN)
    _STAGE_PREPARE_OUTER_PUBLICATION(
        stage,
        connection,
        receipt,
        projection_identity,
        metadata.stage_session,
        authority,
    )
    mint = _SQLiteCursorStageOwnershipOuterPublicationMint(authority, tail)
    metadata.outer_authority_ref = ref(authority)
    metadata.outer_tail = tail
    metadata.lifecycle = "outer-publication-prepared"
    return mint


def _assert_sqlite_cursor_stage_ownership_outer_publication_prepared_intrinsic(
    connection: SQLiteV1BaselineConnectionOwner,
    stage: SQLiteV1BaselineTempStage,
    receipt: SQLiteCursorPreRebindReceipt,
    projection_identity: BaselineProjectionIdentity,
    transfer: _SQLiteCursorStageOwnershipTransfer,
    authority: object,
    tail: _SQLiteCursorStageOwnershipOuterPublicationTail,
) -> None:
    """Finish fallible validation, then arm one publish continuation."""

    metadata = _checked_transfer_graph(connection, stage, receipt, projection_identity, transfer)
    checked_authority = _checked_outer_publication_authority(authority)
    registered_authority = _metadata_outer_publication_authority(metadata)
    if (
        type(tail) is not _SQLiteCursorStageOwnershipOuterPublicationTail
        or metadata.lifecycle != "outer-publication-prepared"
        or registered_authority is not checked_authority
        or metadata.outer_tail is not tail
    ):
        raise ValueError("SQLite cursor outer publication preparation is invalid")
    _STAGE_PREPARE_OUTER_PUBLICATION(
        stage,
        connection,
        receipt,
        projection_identity,
        metadata.stage_session,
        checked_authority,
    )
    _register_outer_publication_tail(tail, checked_authority, stage, metadata)


def _publish_sqlite_cursor_stage_ownership_outer_publication_intrinsic(
    tail: _SQLiteCursorStageOwnershipOuterPublicationTail,
) -> None:
    """Consume one exact prevalidated outer-publication tail."""

    if type(tail) is not _SQLiteCursorStageOwnershipOuterPublicationTail:
        raise ValueError("SQLite cursor outer publication tail is invalid")
    tail_id = id(tail)
    continuation = _DICT_GET(_OUTER_PUBLICATION_TAILS, tail_id)
    metadata = continuation.transfer_ref() if continuation is not None else None
    continuation_authority = continuation.authority_ref() if continuation is not None else None
    registered_authority = (
        _metadata_outer_publication_authority(metadata) if metadata is not None else None
    )
    if (
        continuation is None
        or continuation.tail_ref() is not tail
        or metadata is None
        or metadata.lifecycle != "outer-publication-prepared"
        or metadata.outer_tail is not tail
        or continuation_authority is None
        or registered_authority is not continuation_authority
        or metadata.stage is not continuation.stage
    ):
        raise ValueError("SQLite cursor outer publication tail is invalid")
    _DICT_POP(_OUTER_PUBLICATION_TAILS, tail_id, None)
    _STAGE_PUBLISH_OUTER_PUBLICATION(
        continuation.stage,
        continuation_authority,
    )
    metadata.lifecycle = "outer-publication-owned"


def _assert_sqlite_cursor_stage_ownership_outer_publication_owned_intrinsic(
    connection: SQLiteV1BaselineConnectionOwner,
    stage: SQLiteV1BaselineTempStage,
    receipt: SQLiteCursorPreRebindReceipt,
    projection_identity: BaselineProjectionIdentity,
    transfer: _SQLiteCursorStageOwnershipTransfer,
    authority: object,
) -> _SQLiteCursorStageOwnershipTransfer:
    """Revalidate the exact adopted outer owner."""

    metadata = _checked_transfer_identity_graph(
        connection, stage, receipt, projection_identity, transfer
    )
    checked_authority = _checked_outer_publication_authority(authority)
    registered_authority = _metadata_outer_publication_authority(metadata)
    if (
        metadata.lifecycle
        not in {"outer-publication-owned", "initial-publication-adoption-prepared"}
        or registered_authority is not checked_authority
    ):
        raise ValueError("SQLite cursor outer publication ownership is invalid")
    _STAGE_ASSERT_OUTER_PUBLICATION_ACTIVE(
        stage,
        connection,
        receipt,
        projection_identity,
        metadata.stage_session,
        checked_authority,
    )
    return transfer


def _register_sqlite_cursor_stage_ownership_post_ddl_reader_intrinsic(
    transfer: _SQLiteCursorStageOwnershipTransfer,
    authority: object,
    lease: object,
    cleanup: Callable[[], None],
) -> None:
    metadata = _read_transfer_metadata(transfer)
    checked_authority = _checked_outer_publication_authority(authority)
    registered_authority = (
        _metadata_outer_publication_authority(metadata) if metadata is not None else None
    )
    if (
        metadata is None
        or metadata.lifecycle != "outer-publication-owned"
        or registered_authority is not checked_authority
        or lease is None
        or not callable(cleanup)
        or metadata.post_ddl_reader_lifecycle != "unused"
        or metadata.post_ddl_reader_lease is not None
        or metadata.post_ddl_reader_cleanup is not None
    ):
        raise ValueError("SQLite post-DDL publication reader ownership is invalid")

    attempted = False

    def cleanup_once() -> None:
        nonlocal attempted
        if attempted:
            return
        attempted = True
        cleanup()

    _STAGE_REGISTER_POST_DDL_READER_CLEANUP(
        metadata.stage,
        checked_authority,
        lease,
        cleanup_once,
    )
    metadata.post_ddl_reader_lease = lease
    metadata.post_ddl_reader_cleanup = cleanup_once
    metadata.post_ddl_reader_lifecycle = "active"


def _complete_sqlite_cursor_stage_ownership_post_ddl_reader_intrinsic(
    transfer: _SQLiteCursorStageOwnershipTransfer,
    authority: object,
    lease: object,
    close_succeeded: bool,
) -> None:
    metadata = _read_transfer_metadata(transfer)
    registered_authority = (
        _metadata_outer_publication_authority(metadata) if metadata is not None else None
    )
    if (
        metadata is None
        or metadata.lifecycle != "outer-publication-owned"
        or registered_authority is not authority
        or metadata.post_ddl_reader_lifecycle != "active"
        or metadata.post_ddl_reader_lease is not lease
        or metadata.post_ddl_reader_cleanup is None
        or type(close_succeeded) is not bool
    ):
        raise ValueError("SQLite post-DDL publication reader ownership is invalid")
    _STAGE_CLEAR_POST_DDL_READER_CLEANUP(metadata.stage, authority, lease)
    metadata.post_ddl_reader_cleanup = None
    metadata.post_ddl_reader_lifecycle = "closed" if close_succeeded else "poisoned"


def _assert_sqlite_cursor_stage_ownership_post_ddl_reader_terminal_intrinsic(
    transfer: _SQLiteCursorStageOwnershipTransfer,
    authority: object,
    lease: object,
) -> None:
    metadata = _read_transfer_metadata(transfer)
    registered_authority = (
        _metadata_outer_publication_authority(metadata) if metadata is not None else None
    )
    if (
        metadata is None
        or metadata.lifecycle
        not in {
            "outer-publication-owned",
            "initial-publication-adoption-prepared",
            "initial-publication-adopted",
        }
        or registered_authority is not authority
        or metadata.post_ddl_reader_lifecycle != "closed"
        or metadata.post_ddl_reader_lease is not lease
        or metadata.post_ddl_reader_cleanup is not None
    ):
        raise ValueError("SQLite post-DDL publication reader is not terminal")


def _prepare_sqlite_cursor_stage_ownership_initial_publication_adoption_intrinsic(
    connection: SQLiteV1BaselineConnectionOwner,
    stage: SQLiteV1BaselineTempStage,
    receipt: SQLiteCursorPreRebindReceipt,
    projection_identity: BaselineProjectionIdentity,
    transfer: _SQLiteCursorStageOwnershipTransfer,
    authority: object,
    lease: object,
    watermark: _SQLiteCursorInitialPublicationStageWatermark,
) -> _SQLiteCursorStageOwnershipInitialPublicationAdoptionMint:
    metadata = _checked_transfer_identity_graph(
        connection, stage, receipt, projection_identity, transfer
    )
    checked_authority = _checked_outer_publication_authority(authority)
    registered_authority = _metadata_outer_publication_authority(metadata)
    if (
        metadata.lifecycle
        not in {"outer-publication-owned", "initial-publication-adoption-prepared"}
        or registered_authority is not checked_authority
        or metadata.post_ddl_reader_lifecycle != "closed"
        or metadata.post_ddl_reader_lease is not lease
        or metadata.post_ddl_reader_cleanup is not None
    ):
        raise ValueError("SQLite cursor initial publication adoption owner is invalid")
    stage_mint = _STAGE_PREPARE_INITIAL_PUBLICATION_ADOPTION(
        stage,
        checked_authority,
        lease,
        watermark,
    )
    if metadata.lifecycle == "initial-publication-adoption-prepared":
        existing = metadata.initial_publication_adoption_mint
        if (
            existing is None
            or metadata.initial_publication_adoption_tail is not existing.tail
            or metadata.initial_publication_adoption_retired_b2_fence
            is not stage_mint.retired_b2_fence
            or metadata.initial_publication_adoption_watermark_record
            != _initial_publication_watermark_record(stage_mint.watermark)
        ):
            raise ValueError("SQLite cursor initial publication adoption preparation is invalid")
        return existing
    if (
        metadata.initial_publication_adoption_mint is not None
        or metadata.initial_publication_adoption_tail is not None
        or metadata.initial_publication_adoption_retired_b2_fence is not None
        or metadata.initial_publication_adoption_stage_watermark is not None
        or metadata.initial_publication_adoption_watermark_record is not None
    ):
        raise ValueError("SQLite cursor initial publication adoption preparation is invalid")
    tail = _SQLiteCursorStageOwnershipInitialPublicationAdoptionTail(_CONSTRUCTION_TOKEN)
    stage_watermark = stage_mint.watermark
    watermark_record = _initial_publication_watermark_record(stage_watermark)
    exposed_watermark = _copy_initial_publication_watermark(stage_watermark)
    mint = _SQLiteCursorStageOwnershipInitialPublicationAdoptionMint(
        stage_mint.retired_b2_fence,
        tail,
        exposed_watermark,
    )
    _register_initial_publication_adoption_tail(tail, stage_mint.tail, metadata)
    metadata.initial_publication_adoption_mint = mint
    metadata.initial_publication_adoption_tail = tail
    metadata.initial_publication_adoption_retired_b2_fence = stage_mint.retired_b2_fence
    metadata.initial_publication_adoption_stage_watermark = stage_watermark
    metadata.initial_publication_adoption_watermark_record = watermark_record
    metadata.lifecycle = "initial-publication-adoption-prepared"
    return mint


def _publish_sqlite_cursor_stage_ownership_initial_publication_adoption_intrinsic(
    tail: _SQLiteCursorStageOwnershipInitialPublicationAdoptionTail,
) -> None:
    if type(tail) is not _SQLiteCursorStageOwnershipInitialPublicationAdoptionTail:
        raise ValueError("SQLite cursor initial publication adoption tail is invalid")
    tail_id = id(tail)
    continuation = _DICT_GET(_INITIAL_PUBLICATION_ADOPTION_TAILS, tail_id)
    metadata = continuation.transfer_ref() if continuation is not None else None
    if (
        continuation is None
        or continuation.tail_ref() is not tail
        or metadata is None
        or metadata.lifecycle != "initial-publication-adoption-prepared"
        or metadata.initial_publication_adoption_tail is not tail
    ):
        raise ValueError("SQLite cursor initial publication adoption tail is invalid")
    _DICT_POP(_INITIAL_PUBLICATION_ADOPTION_TAILS, tail_id, None)
    metadata.lifecycle = "poisoned"
    _STAGE_PUBLISH_INITIAL_PUBLICATION_ADOPTION(
        metadata.stage,
        continuation.stage_tail,
    )
    metadata.lifecycle = "initial-publication-adopted"


def _assert_sqlite_cursor_stage_ownership_initial_publication_adopted_intrinsic(
    connection: SQLiteV1BaselineConnectionOwner,
    stage: SQLiteV1BaselineTempStage,
    receipt: SQLiteCursorPreRebindReceipt,
    projection_identity: BaselineProjectionIdentity,
    transfer: _SQLiteCursorStageOwnershipTransfer,
    authority: object,
    lease: object,
    retired_b2_fence: _SQLiteBaselineCursorB2FenceRetirement,
    watermark: _SQLiteCursorInitialPublicationStageWatermark,
) -> _SQLiteCursorStageOwnershipTransfer:
    metadata = _checked_transfer_identity_graph(
        connection, stage, receipt, projection_identity, transfer
    )
    mint = metadata.initial_publication_adoption_mint
    registered_authority = _metadata_outer_publication_authority(metadata)
    try:
        supplied_watermark_record = _initial_publication_watermark_record(watermark)
    except ValueError:
        supplied_watermark_record = None
    if (
        metadata.lifecycle != "initial-publication-adopted"
        or registered_authority is not authority
        or metadata.post_ddl_reader_lifecycle != "closed"
        or metadata.post_ddl_reader_lease is not lease
        or mint is None
        or mint.retired_b2_fence is not retired_b2_fence
        or mint.watermark is not watermark
        or metadata.initial_publication_adoption_retired_b2_fence is not retired_b2_fence
        or metadata.initial_publication_adoption_watermark_record != supplied_watermark_record
        or metadata.initial_publication_adoption_stage_watermark is None
    ):
        raise ValueError("SQLite cursor initial publication adopted authority is invalid")
    _STAGE_ASSERT_INITIAL_PUBLICATION_ADOPTED(
        stage,
        authority,
        lease,
        retired_b2_fence,
        metadata.initial_publication_adoption_stage_watermark,
    )
    return transfer


def _close_active_post_ddl_reader(metadata: _TransferMetadata) -> None:
    cleanup = metadata.post_ddl_reader_cleanup
    metadata.post_ddl_reader_cleanup = None
    if metadata.post_ddl_reader_lifecycle != "active":
        return
    metadata.post_ddl_reader_lifecycle = "poisoned"
    authority = _metadata_outer_publication_authority(metadata)
    with suppress(BaseException):
        _STAGE_CLEAR_POST_DDL_READER_CLEANUP(
            metadata.stage,
            authority,
            metadata.post_ddl_reader_lease,
        )
    if cleanup is not None:
        with suppress(BaseException):
            cleanup()


def _retire_sqlite_cursor_stage_ownership_outer_publication_intrinsic(
    transfer: _SQLiteCursorStageOwnershipTransfer,
    authority: object,
) -> None:
    metadata = _read_transfer_metadata(transfer)
    registered_authority = (
        _metadata_outer_publication_authority(metadata) if metadata is not None else None
    )
    if (
        metadata is None
        or metadata.lifecycle
        not in {
            "outer-publication-prepared",
            "outer-publication-owned",
            "initial-publication-adoption-prepared",
            "initial-publication-adopted",
        }
        or registered_authority is not authority
    ):
        raise ValueError("SQLite cursor outer publication authority is invalid")
    _burn_outer_publication_tail(metadata.outer_tail)
    _burn_initial_publication_adoption_tail(metadata.initial_publication_adoption_tail)
    _close_active_post_ddl_reader(metadata)
    _STAGE_RETIRE_OUTER_PUBLICATION(metadata.stage)
    metadata.lifecycle = "retired"


def _poison_sqlite_cursor_stage_ownership_outer_publication_intrinsic(
    transfer: _SQLiteCursorStageOwnershipTransfer,
    authority: object,
    message: str,
) -> Never:
    metadata = _read_transfer_metadata(transfer)
    checked_authority = _checked_outer_publication_authority(authority)
    registered_authority = (
        _metadata_outer_publication_authority(metadata) if metadata is not None else None
    )
    if (
        metadata is None
        or registered_authority is not checked_authority
        or metadata.lifecycle
        not in {
            "outer-publication-prepared",
            "outer-publication-owned",
            "initial-publication-adoption-prepared",
            "initial-publication-adopted",
        }
    ):
        raise ValueError("SQLite cursor outer publication authority is invalid")
    metadata.lifecycle = "poisoned"
    _close_active_post_ddl_reader(metadata)
    _burn_outer_publication_tail(metadata.outer_tail)
    _burn_initial_publication_adoption_tail(metadata.initial_publication_adoption_tail)
    _STAGE_POISON_OUTER_PUBLICATION(
        metadata.stage,
        checked_authority,
        message,
    )
