from __future__ import annotations

import hashlib
import json
import weakref
from collections.abc import Iterator
from dataclasses import FrozenInstanceError, fields, replace

import pytest

import graph_engineering.sqlite_operation_baseline_cursor_invariants as cursor_seal
from graph_engineering.models import MAX_SAFE_INTEGER
from graph_engineering.sqlite_operation_baseline_cursor_invariants import (
    SQLITE_CURSOR_IMMUTABLE_PHYSICAL_FIELDS,
    SQLITE_CURSOR_MAX_COUNT,
    SQLITE_CURSOR_MUTABLE_REBIND_FIELDS,
    SQLITE_CURSOR_PHYSICAL_FIELDS,
    SQLITE_CURSOR_SEAL_ALGORITHM_VERSION,
    SQLITE_CURSOR_SEAL_CARRIER_FIELDS,
    SQLITE_CURSOR_SEAL_DOMAIN,
    SQLITE_CURSOR_SEAL_ROW_DOMAIN,
    SQLiteCursorImmutableSealCarrier,
    SQLiteCursorImmutableSealReceipt,
    SQLiteCursorSealAccumulator,
    SQLiteCursorSealRow,
    decode_sqlite_v1_cursor_seal_row,
    seal_sqlite_v1_cursor_rows,
    sqlite_cursor_seal_carrier_document,
)

DESCRIPTOR_HASH = "d" * 64
SCHEMA_HASH = "e" * 64
PRINCIPAL_HASH = "a" * 64
AUTHORIZATION_HASH = "b" * 64
TAIL_HASH = "c" * 64


def _json_bytes(value: object) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        allow_nan=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode()


def _event_row(
    *,
    tenant_id: str = "tenant-a",
    token_hash: str = "1" * 64,
    page_size: int = 1,
    next_position: int = 1,
    tail_sequence: int = 3,
    tail_hash: str | None = TAIL_HASH,
    created_at_ms: int = 1_000,
    expires_at_ms: int = 2_000,
    consumed_at_ms: int | None = None,
) -> tuple[object, ...]:
    request = {
        "contractVersion": "cycle-store-provider/v1alpha1",
        "streamId": "stream-a",
        "pageSize": page_size,
    }
    snapshot = {
        "exists": tail_sequence != -1,
        "sequence": tail_sequence,
        "recordHash": tail_hash,
    }
    return (
        tenant_id,
        token_hash,
        "event",
        PRINCIPAL_HASH,
        AUTHORIZATION_HASH,
        "stream-a",
        None,
        _json_bytes(request),
        page_size,
        next_position,
        tail_sequence,
        tail_hash,
        DESCRIPTOR_HASH,
        SCHEMA_HASH,
        _json_bytes(snapshot),
        created_at_ms,
        expires_at_ms,
        consumed_at_ms,
    )


def _summary(
    checkpoint_id: str,
    *,
    bound_sequence: int = 7,
    created_at: str = "2026-07-28T12:00:00Z",
) -> dict[str, object]:
    return {
        "checkpointScope": "scope-a",
        "checkpointId": checkpoint_id,
        "streamId": "stream-a",
        "boundSequence": bound_sequence,
        "boundRecordHash": "7" * 64,
        "createdAt": created_at,
        "valueHash": "8" * 64,
        "valueBytes": 17,
    }


def _checkpoint_row(
    *,
    tenant_id: str = "tenant-b",
    token_hash: str = "2" * 64,
    page_size: int = 256,
    next_position: int = 1,
    snapshot: list[dict[str, object]] | None = None,
) -> tuple[object, ...]:
    actual_snapshot = (
        [
            _summary("checkpoint-a"),
            _summary("checkpoint-b"),
        ]
        if snapshot is None
        else snapshot
    )
    request = {
        "contractVersion": "cycle-store-provider/v1alpha1",
        "checkpointScope": "scope-a",
        "pageSize": page_size,
    }
    return (
        tenant_id,
        token_hash,
        "checkpoint",
        PRINCIPAL_HASH,
        AUTHORIZATION_HASH,
        None,
        "scope-a",
        _json_bytes(request),
        page_size,
        next_position,
        None,
        None,
        DESCRIPTOR_HASH,
        SCHEMA_HASH,
        _json_bytes(actual_snapshot),
        2_000,
        3_000,
        2_000,
    )


def _replace_physical(row: tuple[object, ...], index: int, value: object) -> tuple[object, ...]:
    changed = list(row)
    changed[index] = value
    return tuple(changed)


def _oracle_root(carriers: list[SQLiteCursorImmutableSealCarrier]) -> str:
    state = hashlib.sha256(SQLITE_CURSOR_SEAL_DOMAIN + b"\x00").digest()
    for ordinal, carrier in enumerate(carriers, 1):
        encoded = _json_bytes(
            {
                "tenantId": carrier.tenant_id,
                "tokenHash": carrier.token_hash,
                "kind": carrier.kind,
                "principalHash": carrier.principal_hash,
                "authorizationHash": carrier.authorization_hash,
                "streamId": carrier.stream_id,
                "checkpointScope": carrier.checkpoint_scope,
                "requestScopeByteLength": carrier.request_scope_byte_length,
                "requestScopeBlobSha256": carrier.request_scope_blob_sha256,
                "pageSize": carrier.page_size,
                "nextPosition": carrier.next_position,
                "snapshotTailSequence": carrier.snapshot_tail_sequence,
                "snapshotTailRecordHash": carrier.snapshot_tail_record_hash,
                "snapshotByteLength": carrier.snapshot_byte_length,
                "snapshotBlobSha256": carrier.snapshot_blob_sha256,
                "createdAtMs": carrier.created_at_ms,
                "expiresAtMs": carrier.expires_at_ms,
                "consumedAtMs": carrier.consumed_at_ms,
            }
        )
        row_digest = hashlib.sha256(
            SQLITE_CURSOR_SEAL_ROW_DOMAIN + len(encoded).to_bytes(8, "big") + encoded
        ).digest()
        state = hashlib.sha256(
            SQLITE_CURSOR_SEAL_DOMAIN + b"\x01" + state + ordinal.to_bytes(8, "big") + row_digest
        ).digest()
    return hashlib.sha256(
        SQLITE_CURSOR_SEAL_DOMAIN + b"\x02" + len(carriers).to_bytes(8, "big") + state
    ).hexdigest()


def _receipt(*rows: tuple[object, ...]) -> SQLiteCursorImmutableSealReceipt:
    return seal_sqlite_v1_cursor_rows(
        iter(rows),
        expected_count=len(rows),
        source_descriptor_hash=DESCRIPTOR_HASH,
        source_schema_identity_sha256=SCHEMA_HASH,
    )


def test_frozen_algorithm_domains_field_closure_and_private_boundary() -> None:
    assert SQLITE_CURSOR_SEAL_ALGORITHM_VERSION == "sqlite-cursor-seal/v1"
    assert SQLITE_CURSOR_SEAL_ROW_DOMAIN == b"graph-engineering/sqlite-cursor-seal-row/v1\0"
    assert SQLITE_CURSOR_SEAL_DOMAIN == b"graph-engineering/sqlite-cursor-seal/v1\0"
    assert SQLITE_CURSOR_MAX_COUNT == MAX_SAFE_INTEGER
    assert len(SQLITE_CURSOR_PHYSICAL_FIELDS) == 18
    assert len(SQLITE_CURSOR_IMMUTABLE_PHYSICAL_FIELDS) == 16
    assert len(SQLITE_CURSOR_MUTABLE_REBIND_FIELDS) == 2
    assert set(SQLITE_CURSOR_IMMUTABLE_PHYSICAL_FIELDS).isdisjoint(
        SQLITE_CURSOR_MUTABLE_REBIND_FIELDS
    )
    assert set(SQLITE_CURSOR_PHYSICAL_FIELDS) == {
        *SQLITE_CURSOR_IMMUTABLE_PHYSICAL_FIELDS,
        *SQLITE_CURSOR_MUTABLE_REBIND_FIELDS,
    }
    assert SQLITE_CURSOR_SEAL_CARRIER_FIELDS == (
        "authorizationHash",
        "checkpointScope",
        "consumedAtMs",
        "createdAtMs",
        "expiresAtMs",
        "kind",
        "nextPosition",
        "pageSize",
        "principalHash",
        "requestScopeBlobSha256",
        "requestScopeByteLength",
        "snapshotBlobSha256",
        "snapshotByteLength",
        "snapshotTailRecordHash",
        "snapshotTailSequence",
        "streamId",
        "tenantId",
        "tokenHash",
    )
    assert [item.name for item in fields(SQLiteCursorImmutableSealCarrier)] == [
        "tenant_id",
        "token_hash",
        "kind",
        "principal_hash",
        "authorization_hash",
        "stream_id",
        "checkpoint_scope",
        "request_scope_byte_length",
        "request_scope_blob_sha256",
        "page_size",
        "next_position",
        "snapshot_tail_sequence",
        "snapshot_tail_record_hash",
        "snapshot_byte_length",
        "snapshot_blob_sha256",
        "created_at_ms",
        "expires_at_ms",
        "consumed_at_ms",
    ]
    assert [item.name for item in fields(SQLiteCursorImmutableSealReceipt)] == [
        "cursor_count",
        "immutable_root_sha256",
        "source_descriptor_hash",
        "source_schema_identity_sha256",
    ]
    assert (
        tuple(
            sqlite_cursor_seal_carrier_document(
                decode_sqlite_v1_cursor_seal_row(_event_row()).carrier
            )
        )
        == SQLITE_CURSOR_SEAL_CARRIER_FIELDS
    )
    import graph_engineering

    assert not hasattr(graph_engineering, "SQLiteCursorSealAccumulator")


def test_literal_empty_event_and_checkpoint_roots_match_independent_oracle() -> None:
    event = decode_sqlite_v1_cursor_seal_row(_event_row())
    checkpoint = decode_sqlite_v1_cursor_seal_row(_checkpoint_row())

    empty_receipt = _receipt()
    event_receipt = _receipt(_event_row())
    checkpoint_receipt = _receipt(_checkpoint_row())

    assert (
        empty_receipt.immutable_root_sha256
        == "587bd52db10d2d03c9f7b8bbcecee9c6f83d0c076b17846883e6885e10e2b47f"
    )
    assert (
        event_receipt.immutable_root_sha256
        == "7e5bc37091acd9ef089e8b7b6d74223220806c443abf895bd88964eb1183a894"
    )
    assert (
        checkpoint_receipt.immutable_root_sha256
        == "182e83e03417108ba77453153f7b28595de85eb7e11e31b8660825de973356f1"
    )
    assert empty_receipt.immutable_root_sha256 == _oracle_root([])
    assert event_receipt.immutable_root_sha256 == _oracle_root([event.carrier])
    assert checkpoint_receipt.immutable_root_sha256 == _oracle_root([checkpoint.carrier])
    with pytest.raises(FrozenInstanceError):
        event_receipt.cursor_count = 2  # type: ignore[misc]


def test_shared_typescript_event_checkpoint_and_pair_roots_are_byte_exact() -> None:
    a = "a" * 64
    b = "b" * 64
    c = "c" * 64
    d = "d" * 64
    e = "e" * 64
    f = "f" * 64
    event = (
        "tenant-alpha",
        a,
        "event",
        b,
        c,
        "stream-alpha",
        None,
        b'{"contractVersion":"cycle-store-provider/v1alpha1","pageSize":64,"streamId":"stream-alpha"}',
        64,
        7,
        6,
        d,
        e,
        f,
        (f'{{"recordHash":"{d}","sequence":6}}').encode(),
        1_700_000_000_000,
        1_700_000_300_000,
        None,
    )
    checkpoint = (
        "tenant-beta",
        b,
        "checkpoint",
        c,
        d,
        None,
        "checkpoint-scope",
        b'{"checkpointScope":"checkpoint-scope","contractVersion":"cycle-store-provider/v1alpha1","pageSize":16}',
        16,
        2,
        None,
        None,
        e,
        f,
        (
            b'[{"checkpointId":"cp-b","checkpointScope":"checkpoint-scope","revision":2},'
            b'{"checkpointId":"cp-a","checkpointScope":"checkpoint-scope","revision":1}]'
        ),
        1_700_000_000_000,
        1_700_000_300_000,
        1_700_000_100_000,
    )

    def shared_receipt(*rows: object) -> SQLiteCursorImmutableSealReceipt:
        return seal_sqlite_v1_cursor_rows(
            rows,
            expected_count=len(rows),
            source_descriptor_hash=e,
            source_schema_identity_sha256=f,
        )

    assert shared_receipt(event).immutable_root_sha256 == (
        "1445422fdd2e7e6f93458c6d5e4cf35c53ebac8596cf117595c1f926086681ea"
    )
    assert shared_receipt(checkpoint).immutable_root_sha256 == (
        "4fefb119ba4e71217c64470627ce9b07388ffdd29cf0b3549b7127b06436f5f6"
    )
    assert shared_receipt(event, checkpoint).immutable_root_sha256 == (
        "3ee9a67ea7d1d961af54178d1df8c3cdf32dddfd4d7c5dcae03aca31efad84d1"
    )


def test_decoder_accepts_empty_event_and_page_size_clock_edges() -> None:
    empty = decode_sqlite_v1_cursor_seal_row(
        _event_row(
            page_size=1,
            next_position=0,
            tail_sequence=-1,
            tail_hash=None,
            created_at_ms=0,
            expires_at_ms=MAX_SAFE_INTEGER,
            consumed_at_ms=0,
        )
    )
    assert empty.carrier.snapshot_tail_sequence == -1
    assert empty.carrier.snapshot_tail_record_hash is None
    assert empty.carrier.consumed_at_ms == 0

    maximum_page = decode_sqlite_v1_cursor_seal_row(_event_row(page_size=256))
    assert maximum_page.carrier.page_size == 256


@pytest.mark.parametrize(
    ("index", "value"),
    [
        (8, 0),
        (8, 257),
        (9, -1),
        (15, -1),
        (16, MAX_SAFE_INTEGER + 1),
    ],
)
def test_decoder_rejects_integer_and_safe_clock_bounds(index: int, value: int) -> None:
    with pytest.raises(ValueError):
        decode_sqlite_v1_cursor_seal_row(_replace_physical(_event_row(), index, value))


@pytest.mark.parametrize(
    "row",
    [
        _replace_physical(_event_row(created_at_ms=1_000), 16, 1_000),
        _event_row(created_at_ms=1_000, expires_at_ms=2_000, consumed_at_ms=999),
    ],
)
def test_decoder_rejects_invalid_clock_intervals(row: tuple[object, ...]) -> None:
    with pytest.raises(ValueError, match="clock"):
        decode_sqlite_v1_cursor_seal_row(row)


def test_all_sixteen_immutable_physical_fields_contribute_to_root() -> None:
    original = decode_sqlite_v1_cursor_seal_row(_event_row()).carrier
    base = _oracle_root([original])
    mutations = {
        "tenant_id": replace(original, tenant_id="tenant-z"),
        "token_hash": replace(original, token_hash="9" * 64),
        "kind": replace(original, kind="checkpoint"),
        "principal_hash": replace(original, principal_hash="1" * 64),
        "authorization_hash": replace(original, authorization_hash="2" * 64),
        "stream_id": replace(original, stream_id="stream-z"),
        "checkpoint_scope": replace(original, checkpoint_scope="scope-z"),
        "request_scope_blob": replace(
            original,
            request_scope_byte_length=original.request_scope_byte_length + 1,
            request_scope_blob_sha256="3" * 64,
        ),
        "page_size": replace(original, page_size=256),
        "next_position": replace(original, next_position=2),
        "snapshot_tail_sequence": replace(original, snapshot_tail_sequence=4),
        "snapshot_tail_record_hash": replace(original, snapshot_tail_record_hash="4" * 64),
        "snapshot_blob": replace(
            original,
            snapshot_byte_length=original.snapshot_byte_length + 1,
            snapshot_blob_sha256="5" * 64,
        ),
        "created_at_ms": replace(original, created_at_ms=999),
        "expires_at_ms": replace(original, expires_at_ms=2_001),
        "consumed_at_ms": replace(original, consumed_at_ms=1_000),
    }
    assert set(mutations) == set(SQLITE_CURSOR_IMMUTABLE_PHYSICAL_FIELDS)
    assert all(_oracle_root([carrier]) != base for carrier in mutations.values())


def test_mutable_rebind_identities_are_validated_but_excluded_from_root() -> None:
    original = _event_row()
    changed_descriptor = _replace_physical(original, 12, "1" * 64)
    changed_schema = _replace_physical(original, 13, "2" * 64)

    def seal(
        row: tuple[object, ...], descriptor: str, schema: str
    ) -> SQLiteCursorImmutableSealReceipt:
        return seal_sqlite_v1_cursor_rows(
            iter([row]),
            expected_count=1,
            source_descriptor_hash=descriptor,
            source_schema_identity_sha256=schema,
        )

    base = seal(original, DESCRIPTOR_HASH, SCHEMA_HASH)
    descriptor_receipt = seal(changed_descriptor, "1" * 64, SCHEMA_HASH)
    schema_receipt = seal(changed_schema, DESCRIPTOR_HASH, "2" * 64)
    assert descriptor_receipt.immutable_root_sha256 == base.immutable_root_sha256
    assert schema_receipt.immutable_root_sha256 == base.immutable_root_sha256
    assert descriptor_receipt.source_descriptor_hash != base.source_descriptor_hash
    assert schema_receipt.source_schema_identity_sha256 != base.source_schema_identity_sha256

    with pytest.raises(ValueError, match="mutable identity"):
        seal(changed_descriptor, DESCRIPTOR_HASH, SCHEMA_HASH)


def test_blob_length_and_same_length_content_attacks_change_seal_evidence() -> None:
    first = _checkpoint_row(snapshot=[_summary("checkpoint-a")])
    same_length = _checkpoint_row(snapshot=[_summary("checkpoint-z")])
    longer = _checkpoint_row(snapshot=[_summary("checkpoint-a"), _summary("checkpoint-b")])
    first_carrier = decode_sqlite_v1_cursor_seal_row(first).carrier
    same_carrier = decode_sqlite_v1_cursor_seal_row(same_length).carrier
    longer_carrier = decode_sqlite_v1_cursor_seal_row(longer).carrier
    assert first_carrier.snapshot_byte_length == same_carrier.snapshot_byte_length
    assert first_carrier.snapshot_blob_sha256 != same_carrier.snapshot_blob_sha256
    assert _oracle_root([first_carrier]) != _oracle_root([same_carrier])
    assert first_carrier.snapshot_byte_length != longer_carrier.snapshot_byte_length
    assert _oracle_root([first_carrier]) != _oracle_root([longer_carrier])

    request = _event_row()[7]
    assert type(request) is bytes
    attacked = request.replace(b"stream-a", b"stream-z")
    assert len(attacked) == len(request)
    attacked_carrier = decode_sqlite_v1_cursor_seal_row(
        _replace_physical(_event_row(), 7, attacked)
    ).carrier
    original_carrier = decode_sqlite_v1_cursor_seal_row(_event_row()).carrier
    assert attacked_carrier.request_scope_byte_length == original_carrier.request_scope_byte_length
    assert attacked_carrier.request_scope_blob_sha256 != original_carrier.request_scope_blob_sha256
    assert _oracle_root([attacked_carrier]) != _oracle_root([original_carrier])


@pytest.mark.parametrize(
    "blob",
    [
        b"\xff{}",
        b"\xef\xbb\xbf{}",
        (
            b'{"contractVersion":"cycle-store-provider/v1alpha1",'
            b'"pageSize":1,"streamId":"stream-a","streamId":"stream-b"}'
        ),
        (
            b'{"contractVersion":"cycle-store-provider/v1alpha1", '
            b'"pageSize":1,"streamId":"stream-a"}'
        ),
        (b'{"streamId":"stream-a","pageSize":1,"contractVersion":"cycle-store-provider/v1alpha1"}'),
        b"x" * 1_048_577,
    ],
)
def test_bounded_decoder_rejects_noncanonical_request_blobs_without_plaintext(
    blob: bytes,
) -> None:
    with pytest.raises(ValueError) as error:
        decode_sqlite_v1_cursor_seal_row(_replace_physical(_event_row(), 7, blob))
    assert "tenant-a" not in str(error.value)
    assert "stream-a" not in str(error.value)


def test_bounded_decoder_rejects_noncanonical_and_oversized_snapshot_blobs() -> None:
    for blob in (
        b"\xff[]",
        b"\xef\xbb\xbf[]",
        b'[{"checkpointId":"a","checkpointId":"b"}]',
        b"[ ]",
        b"x" * 16_777_217,
    ):
        with pytest.raises(ValueError, match="canonical blob"):
            decode_sqlite_v1_cursor_seal_row(_replace_physical(_checkpoint_row(), 14, blob))


def test_slice_a_seals_checkpoint_order_changes_without_freezing_slice_b_semantics() -> None:
    valid = [
        _summary("a", bound_sequence=8),
        _summary("a", bound_sequence=7, created_at="2026-07-28T13:00:00Z"),
        _summary("b", bound_sequence=7, created_at="2026-07-28T13:00:00Z"),
    ]
    variants = (
        valid,
        list(reversed(valid)),
        [valid[0], valid[0]],
        [{**valid[0], "extra": True}],
        [{**valid[0], "checkpointScope": "scope-z"}],
    )
    carriers = [
        decode_sqlite_v1_cursor_seal_row(
            _checkpoint_row(snapshot=snapshot, next_position=MAX_SAFE_INTEGER)
        ).carrier
        for snapshot in variants
    ]
    assert len({carrier.snapshot_blob_sha256 for carrier in carriers}) == len(variants)
    assert len({_oracle_root([carrier]) for carrier in carriers}) == len(variants)


@pytest.mark.parametrize(
    ("request_scope", "snapshot"),
    [
        ({}, []),
        (["request", 1, None], {"arbitrary": True}),
        ("request", "snapshot"),
        (False, 10),
    ],
)
def test_slice_a_accepts_arbitrary_bounded_canonical_json_without_retention(
    request_scope: object,
    snapshot: object,
) -> None:
    row = _replace_physical(_event_row(), 7, _json_bytes(request_scope))
    row = _replace_physical(row, 14, _json_bytes(snapshot))
    decoded = decode_sqlite_v1_cursor_seal_row(row)
    assert decoded.carrier.request_scope_byte_length == len(_json_bytes(request_scope))
    assert decoded.carrier.snapshot_byte_length == len(_json_bytes(snapshot))
    assert not hasattr(decoded.carrier, "request_scope_blob")
    assert not hasattr(decoded.carrier, "snapshot_blob")


def test_physical_shape_storage_classes_and_nullable_groups_are_closed() -> None:
    with pytest.raises(ValueError, match="physical shape"):
        decode_sqlite_v1_cursor_seal_row(_event_row()[:-1])
    with pytest.raises(ValueError, match="physical shape"):
        decode_sqlite_v1_cursor_seal_row(list(_event_row()))
    with pytest.raises(ValueError, match="hash"):
        decode_sqlite_v1_cursor_seal_row(_replace_physical(_event_row(), 1, "A" * 64))
    with pytest.raises(ValueError, match="integer"):
        decode_sqlite_v1_cursor_seal_row(_replace_physical(_event_row(), 8, True))
    with pytest.raises(ValueError, match="event scope"):
        decode_sqlite_v1_cursor_seal_row(_replace_physical(_event_row(), 6, "scope-a"))
    with pytest.raises(ValueError, match="checkpoint scope"):
        decode_sqlite_v1_cursor_seal_row(_replace_physical(_checkpoint_row(), 5, "stream-a"))


def test_canonical_order_is_token_hash_then_tenant_utf8_bytes() -> None:
    token_first = _event_row(tenant_id="tenant-z", token_hash="1" * 64)
    tenant_first = _event_row(tenant_id="tenant-a", token_hash="2" * 64)
    assert _receipt(token_first, tenant_first).cursor_count == 2
    with pytest.raises(ValueError, match="canonical order"):
        _receipt(tenant_first, token_first)

    same_token_a = _event_row(tenant_id="tenant-a", token_hash="3" * 64)
    same_token_b = _event_row(tenant_id="tenant-b", token_hash="3" * 64)
    assert _receipt(same_token_a, same_token_b).cursor_count == 2


def test_accumulator_rejections_are_atomic_and_finish_is_one_shot() -> None:
    first = decode_sqlite_v1_cursor_seal_row(_event_row(tenant_id="tenant-z", token_hash="1" * 64))
    second = decode_sqlite_v1_cursor_seal_row(_event_row(tenant_id="tenant-a", token_hash="2" * 64))
    accumulator = SQLiteCursorSealAccumulator(2, DESCRIPTOR_HASH, SCHEMA_HASH)
    with pytest.raises(ValueError, match="below expected"):
        accumulator.finish()
    assert not accumulator.is_finished
    accumulator.append(first)
    snapshot = (
        accumulator.cursor_count,
        accumulator.chain_state,
        accumulator.last_sort_key,
    )
    for rejected, message in (
        (first, "duplicate"),
        (
            decode_sqlite_v1_cursor_seal_row(_event_row(tenant_id="tenant-a", token_hash="0" * 64)),
            "canonical order",
        ),
    ):
        with pytest.raises(ValueError, match=message):
            accumulator.append(rejected)
        assert (
            accumulator.cursor_count,
            accumulator.chain_state,
            accumulator.last_sort_key,
        ) == snapshot
    with pytest.raises(TypeError, match="row"):
        accumulator.append("invalid")  # type: ignore[arg-type]
    assert (
        accumulator.cursor_count,
        accumulator.chain_state,
        accumulator.last_sort_key,
    ) == snapshot
    with pytest.raises(ValueError, match="integer"):
        accumulator.append(replace(second, carrier=replace(second.carrier, page_size=0)))
    assert (
        accumulator.cursor_count,
        accumulator.chain_state,
        accumulator.last_sort_key,
    ) == snapshot
    with pytest.raises(ValueError, match="identity"):
        accumulator.append(replace(second, descriptor_hash="f" * 64))
    assert (
        accumulator.cursor_count,
        accumulator.chain_state,
        accumulator.last_sort_key,
    ) == snapshot
    accumulator.append(second)
    receipt = accumulator.finish()
    assert receipt.cursor_count == 2
    with pytest.raises(ValueError, match="already finished"):
        accumulator.finish()
    with pytest.raises(ValueError, match="already finished"):
        accumulator.append(second)

    overflow = SQLiteCursorSealAccumulator(1, DESCRIPTOR_HASH, SCHEMA_HASH)
    overflow.append(first)
    overflow_snapshot = (overflow.cursor_count, overflow.chain_state, overflow.last_sort_key)
    with pytest.raises(ValueError, match="exceeds expected"):
        overflow.append(second)
    assert (overflow.cursor_count, overflow.chain_state, overflow.last_sort_key) == (
        overflow_snapshot
    )


@pytest.mark.parametrize("count", [128, 1_024])
def test_streaming_characterization_has_one_live_carrier_and_no_growing_state(
    monkeypatch: pytest.MonkeyPatch,
    count: int,
) -> None:
    original_decode = cursor_seal.decode_sqlite_v1_cursor_seal_row
    live = 0
    maximum_live = 0

    def tracked_decode(row: object) -> SQLiteCursorSealRow:
        nonlocal live, maximum_live
        decoded = original_decode(row)
        live += 1
        maximum_live = max(maximum_live, live)

        def release() -> None:
            nonlocal live
            live -= 1

        weakref.finalize(decoded.carrier, release)
        return decoded

    monkeypatch.setattr(cursor_seal, "decode_sqlite_v1_cursor_seal_row", tracked_decode)

    def rows() -> Iterator[tuple[object, ...]]:
        for index in range(count):
            yield _event_row(
                tenant_id=f"tenant-{count - index:04d}",
                token_hash=f"{index:064x}",
            )

    receipt = seal_sqlite_v1_cursor_rows(
        rows(),
        expected_count=count,
        source_descriptor_hash=DESCRIPTOR_HASH,
        source_schema_identity_sha256=SCHEMA_HASH,
    )
    assert receipt.cursor_count == count
    assert maximum_live == 1
    assert live == 0

    retained = [
        getattr(SQLiteCursorSealAccumulator(0, DESCRIPTOR_HASH, SCHEMA_HASH), slot)
        for slot in SQLiteCursorSealAccumulator.__slots__
    ]
    assert not any(isinstance(value, (list, tuple, set, dict)) for value in retained)
