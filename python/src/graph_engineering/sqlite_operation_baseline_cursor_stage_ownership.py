"""Package-private B0b source-to-stage ownership transfer.

This module executes no cursor SQL and creates no cursor TEMP object.  It only
joins the exact A2b receipt and B0a captured-source witness to one exact,
completed baseline TEMP stage and publishes one opaque live-stage handle.
"""

from __future__ import annotations

from collections.abc import Callable
from contextlib import suppress
from dataclasses import dataclass
from typing import Literal, Never, cast
from weakref import WeakKeyDictionary

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
from .sqlite_operation_baseline_stage import SQLiteV1BaselineTempStage

_CONSTRUCTION_TOKEN = object()


class _SQLiteCursorStageOwnershipTransfer:
    """Empty exact-identity handle whose authority lives in a weak registry."""

    __slots__ = ("__weakref__",)

    def __init__(self, construction_token: object) -> None:
        if construction_token is not _CONSTRUCTION_TOKEN:
            raise TypeError("cursor stage ownership transfers are module-minted")


@dataclass(frozen=True, slots=True)
class _TransferMetadata:
    connection: SQLiteV1BaselineConnectionOwner
    stage: SQLiteV1BaselineTempStage
    receipt: SQLiteCursorPreRebindReceipt
    witness: _SQLiteCursorCapturedSourceConnectionWitness
    stage_session: object


_TRANSFERS: WeakKeyDictionary[_SQLiteCursorStageOwnershipTransfer, _TransferMetadata] = (
    WeakKeyDictionary()
)


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
    assert_sqlite_cursor_pre_rebind_receipt_provenance(receipt)
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
    ):
        raise ValueError("cursor stage ownership transfer context is invalid")
    _STAGE_ASSERT_TRANSFER(
        stage,
        connection,
        receipt,
        metadata.stage_session,
    )
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
    if metadata is None:
        raise ValueError("cursor stage ownership transfer provenance is invalid")
    _STAGE_CREATE_CURSOR_SEAL_TEMP_TABLE(
        stage,
        connection,
        receipt,
        metadata.stage_session,
    )
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
    if transfer_metadata is None:
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
    _STAGE_ABORT_CAMPAIGN(stage, campaign_session, primary)
