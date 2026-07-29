from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path
from typing import Any, cast

import pytest

from graph_engineering.sqlite_operation_baseline_cursor_inspection import (
    _inspect_sqlite_v1_cursor_row,
    _SQLiteCursorRowInspection,
)
from graph_engineering.sqlite_operation_baseline_cursor_invariants import (
    SQLiteCursorSealAccumulator,
)

_CASE_PATH = (
    Path(__file__).resolve().parents[2]
    / "spec"
    / "conformance"
    / "sqlite-cursor-pre-rebind-v1.case.json"
)
_CASE = cast(dict[str, Any], json.loads(_CASE_PATH.read_text(encoding="utf-8")))
_FIELDS = (
    "tenant_id",
    "token_hash",
    "kind",
    "principal_hash",
    "authorization_hash",
    "stream_id",
    "checkpoint_scope",
    "request_scope_blob",
    "page_size",
    "next_position",
    "snapshot_tail_sequence",
    "snapshot_tail_record_hash",
    "descriptor_hash",
    "schema_identity_sha256",
    "snapshot_blob",
    "created_at_ms",
    "expires_at_ms",
    "consumed_at_ms",
)


def _physical_row(name: str) -> tuple[object, ...]:
    literal = dict(_CASE["literalRows"][name])
    literal["request_scope_blob"] = literal.pop("request_scope_blob_utf8").encode()
    literal["snapshot_blob"] = literal.pop("snapshot_blob_utf8").encode()
    return tuple(literal[field] for field in _FIELDS)


def _history(vector: dict[str, Any]) -> tuple[Callable[..., bool], Callable[..., bool]]:
    events = {
        (
            row["tenant_id"],
            row["stream_id"],
            row["sequence"],
            row["record_hash"],
        )
        for row in vector["eventHistory"]
    }
    checkpoints = {
        (
            row["tenant_id"],
            row["checkpoint_scope"],
            row["checkpoint_id"],
            row["summary_blob_utf8"].encode(),
        )
        for row in vector["checkpointPutHistory"]
    }
    return (
        lambda tenant, stream, sequence, record_hash: (
            (
                tenant,
                stream,
                sequence,
                record_hash,
            )
            in events
        ),
        lambda tenant, scope, checkpoint_id, summary: (
            (
                tenant,
                scope,
                checkpoint_id,
                summary,
            )
            in checkpoints
        ),
    )


def _inspect(
    row: object,
    *,
    vector_name: str = "event-empty",
    event_tail_exists: Callable[..., bool] | None = None,
    checkpoint_revision_exists: Callable[..., bool] | None = None,
) -> _SQLiteCursorRowInspection:
    vector = next(vector for vector in _CASE["semanticVectors"] if vector["name"] == vector_name)
    event_history, checkpoint_history = _history(vector)
    return _inspect_sqlite_v1_cursor_row(
        row,
        source_ordinal=0,
        source_descriptor_hash=vector["identities"]["descriptorHash"],
        source_schema_identity_sha256=vector["identities"]["schemaIdentitySha256"],
        provider_high_water_at_ms=vector["clocks"]["providerHighWaterAtMs"],
        event_tail_exists=event_tail_exists or event_history,
        checkpoint_revision_exists=checkpoint_revision_exists or checkpoint_history,
    )


@pytest.mark.parametrize(
    ("vector_name", "literal_names"),
    [
        ("empty", ()),
        ("event-empty", ("eventEmpty",)),
        ("event-nonempty", ("eventNonempty",)),
        ("checkpoint", ("checkpoint",)),
        ("cross-order", ("checkpoint", "eventNonempty")),
    ],
    ids=[
        "b2:empty",
        "b2:event-empty-tail",
        "b2:event-nonempty-tail",
        "b2:checkpoint-historical-put",
        "b2:event-checkpoint-cross-order",
    ],
)
def test_shared_semantic_vectors_recompute_exact_a1_roots(
    vector_name: str, literal_names: tuple[str, ...]
) -> None:
    vector = next(vector for vector in _CASE["semanticVectors"] if vector["name"] == vector_name)
    event_history, checkpoint_history = _history(vector)
    seal_rows = []
    for ordinal, literal_name in enumerate(literal_names):
        inspected = _inspect_sqlite_v1_cursor_row(
            _physical_row(literal_name),
            source_ordinal=ordinal,
            source_descriptor_hash=vector["identities"]["descriptorHash"],
            source_schema_identity_sha256=vector["identities"]["schemaIdentitySha256"],
            provider_high_water_at_ms=vector["clocks"]["providerHighWaterAtMs"],
            event_tail_exists=event_history,
            checkpoint_revision_exists=checkpoint_history,
        )
        assert inspected.rule_flags == (True,) * 9
        assert inspected.stageable is True
        assert len(inspected.staged_values) == 20
        assert len(inspected.insert_values) == 30
        assert inspected.seal_row is not None
        seal_rows.append(inspected.seal_row)
    seal_rows.sort(
        key=lambda row: (
            row.carrier.token_hash.encode(),
            row.carrier.tenant_id.encode(),
        )
    )
    accumulator = SQLiteCursorSealAccumulator(
        vector["expected"]["cursorCount"],
        vector["identities"]["descriptorHash"],
        vector["identities"]["schemaIdentitySha256"],
    )
    for seal_row in seal_rows:
        accumulator.append(seal_row)
    receipt = accumulator.finish()
    assert receipt.cursor_count == vector["expected"]["cursorCount"]
    assert receipt.immutable_root_sha256 == vector["expected"]["immutableRootSha256"]


@pytest.mark.parametrize(
    "bad_blob",
    [
        b"\xff{}",
        b"\xef\xbb\xbf{}",
        b'{"streamId":"stream-alpha","streamId":"stream-alpha"}',
        b'{"streamId":"stream-alpha", "pageSize":64}',
    ],
    ids=[
        "b2:blob-invalid-utf8",
        "b2:blob-bom",
        "b2:blob-duplicate-key",
        "b2:blob-noncanonical-order",
    ],
)
def test_malformed_request_blob_is_isolated_to_rule_three(bad_blob: bytes) -> None:
    row = list(_physical_row("eventEmpty"))
    row[7] = bad_blob
    inspected = _inspect(tuple(row))
    assert inspected.rule_flags == (True, True, False, True, True, True, True, True, True)
    assert inspected.seal_row is None


def test_malformed_snapshot_blob_is_isolated_to_rule_three() -> None:
    row = list(_physical_row("eventNonempty"))
    row[14] = b"[invalid"
    inspected = _inspect(tuple(row), vector_name="event-nonempty")
    assert inspected.rule_flags == (True, True, False, True, True, True, True, True, True)


def test_invalid_bounded_text_key_is_staged_and_only_rule_one_fails() -> None:
    row = list(_physical_row("eventEmpty"))
    row[1] = "not-a-hash"
    inspected = _inspect(tuple(row))
    assert inspected.stageable is True
    assert inspected.staged_values[0] == "!ge-invalid-token-0"
    assert inspected.rule_flags == (False, True, True, True, True, True, True, True, True)


def test_non_text_key_uses_prestage_path_and_does_not_call_strict_decoder(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    row = list(_physical_row("eventEmpty"))
    row[0] = 7
    monkeypatch.setattr(
        "graph_engineering.sqlite_operation_baseline_cursor_inspection."
        "decode_sqlite_v1_cursor_seal_row",
        lambda _row: pytest.fail("strict A1 decoder ran for an invalid row"),
    )
    inspected = _inspect(tuple(row))
    assert inspected.stageable is False
    assert inspected.shape_ok is False
    assert inspected.seal_row is None


def test_sentinels_are_bounded_distinct_and_do_not_retain_unbounded_text() -> None:
    staged_keys: set[tuple[object, object]] = set()
    for ordinal in range(2):
        row = list(_physical_row("eventEmpty"))
        row[0] = "x" * 1024
        row[1] = "y" * 1024
        row[3] = "z" * 1024
        vector = next(
            vector for vector in _CASE["semanticVectors"] if vector["name"] == "event-empty"
        )
        inspected = _inspect_sqlite_v1_cursor_row(
            tuple(row),
            source_ordinal=ordinal,
            source_descriptor_hash=vector["identities"]["descriptorHash"],
            source_schema_identity_sha256=vector["identities"]["schemaIdentitySha256"],
            provider_high_water_at_ms=vector["clocks"]["providerHighWaterAtMs"],
            event_tail_exists=lambda *_args: True,
            checkpoint_revision_exists=lambda *_args: True,
        )
        assert inspected.stageable is True
        assert all("x" * 128 not in str(value) for value in inspected.staged_values)
        assert all("y" * 128 not in str(value) for value in inspected.staged_values)
        assert all("z" * 128 not in str(value) for value in inspected.staged_values)
        assert inspected.staged_values[0] == f"!ge-invalid-token-{ordinal}"
        assert inspected.staged_values[1] == f"!ge-invalid-{ordinal}-tenant"
        staged_keys.add((inspected.staged_values[0], inspected.staged_values[1]))
    assert len(staged_keys) == 2


@pytest.mark.parametrize("tail_sequence", [-2, 9007199254740992])
def test_event_tail_integer_bounds_are_isolated_to_rule_four(
    tail_sequence: int,
) -> None:
    row = list(_physical_row("eventNonempty"))
    row[10] = tail_sequence
    inspected = _inspect(tuple(row), vector_name="event-nonempty")
    assert inspected.rule_flags == (True, True, True, False, True, True, True, True, True)


def test_checkpoint_lookup_consumes_exact_fixture_summary_bytes() -> None:
    expected = _CASE["semanticVectors"][3]["checkpointPutHistory"][0]
    seen: list[tuple[str, str, str, bytes]] = []

    def lookup(tenant: str, scope: str, checkpoint_id: str, summary: bytes) -> bool:
        seen.append((tenant, scope, checkpoint_id, summary))
        return True

    inspected = _inspect(
        _physical_row("checkpoint"),
        vector_name="checkpoint",
        checkpoint_revision_exists=lookup,
    )
    assert inspected.checkpoint_binding_ok is True
    assert seen == [
        (
            expected["tenant_id"],
            expected["checkpoint_scope"],
            expected["checkpoint_id"],
            expected["summary_blob_utf8"].encode(),
        )
    ]


def test_nonapplicable_history_flags_are_true() -> None:
    event = _inspect(_physical_row("eventEmpty"))
    checkpoint = _inspect(_physical_row("checkpoint"), vector_name="checkpoint")
    assert event.checkpoint_binding_ok is True
    assert checkpoint.event_binding_ok is True


@pytest.mark.parametrize(
    ("index", "replacement"),
    [
        (0, 7),
        (1, b"not-text"),
        (2, 1),
        (3, 3),
        (5, 9),
        (7, "not-bytes"),
        (8, 1.5),
        (10, "not-integer"),
        (11, 7),
        (12, b"not-text"),
        (14, "not-bytes"),
        (17, 1.5),
    ],
    ids=[f"storage-class-{index}" for index in range(1, 13)],
)
def test_wrong_sqlite_storage_class_is_isolated_to_rule_eight(
    index: int, replacement: object
) -> None:
    row = list(_physical_row("eventEmpty"))
    row[index] = replacement
    inspected = _inspect(tuple(row))
    assert inspected.rule_flags == (True, True, True, True, True, True, False, True, True)


@pytest.mark.parametrize("_b2_case", [None], ids=["b2:storage-class-shape"])
def test_representable_nonkey_storage_defect_is_rule_eight_only(
    _b2_case: None,
) -> None:
    row = list(_physical_row("eventEmpty"))
    row[11] = 7
    inspected = _inspect(tuple(row))
    assert inspected.source_key_storage_ok is True
    assert inspected.stageable is True
    assert inspected.rule_flags == (True, True, True, True, True, True, False, True, True)


@pytest.mark.parametrize(
    ("case_name", "expected"),
    [
        (
            "authorization-plus-text-page",
            (False, True, True, True, True, True, False, True, True),
        ),
        (
            "checkpoint-text-created-plus-missing-put",
            (True, True, True, True, True, True, False, True, False),
        ),
        (
            "scope-mismatch-plus-text-expiry",
            (True, False, True, True, True, True, False, True, True),
        ),
        (
            "text-consumed-plus-missing-event-tail",
            (True, True, True, True, True, True, False, False, True),
        ),
    ],
)
def test_mixed_storage_preserves_independent_field_local_evidence(
    case_name: str,
    expected: tuple[bool, ...],
) -> None:
    literal = "checkpoint" if case_name.startswith("checkpoint") else "eventEmpty"
    if case_name.startswith("text-consumed"):
        literal = "eventNonempty"
    row = list(_physical_row(literal))
    event_tail_exists: Callable[..., bool] | None = None
    checkpoint_revision_exists: Callable[..., bool] | None = None
    vector_name = "event-empty"
    if case_name == "authorization-plus-text-page":
        row[3] = "bad"
        row[8] = "1"
    elif case_name == "checkpoint-text-created-plus-missing-put":
        row[15] = "500"
        vector_name = "checkpoint"

        def missing_checkpoint(*_args: object) -> bool:
            return False

        checkpoint_revision_exists = missing_checkpoint
    elif case_name == "scope-mismatch-plus-text-expiry":
        row[6] = "wrong-scope"
        row[16] = "1500"
    else:
        row[17] = "600"
        vector_name = "event-nonempty"

        def missing_event(*_args: object) -> bool:
            return False

        event_tail_exists = missing_event
    inspected = _inspect(
        tuple(row),
        vector_name=vector_name,
        event_tail_exists=event_tail_exists,
        checkpoint_revision_exists=checkpoint_revision_exists,
    )
    assert inspected.stageable is True
    assert inspected.rule_flags == expected


def test_kind_storage_is_independent_from_authorization_semantics() -> None:
    row = list(_physical_row("eventEmpty"))
    row[2] = b"event"
    row[3] = "bad"
    inspected = _inspect(tuple(row))
    assert inspected.stageable is True
    assert inspected.rule_flags == (False, True, True, True, True, True, False, True, True)


def test_wrong_arity_is_isolated_to_rule_eight() -> None:
    inspected = _inspect(_physical_row("eventEmpty")[:-1])
    assert inspected.stageable is False
    assert inspected.source_key_storage_ok is True
    assert inspected.rule_flags == (True, True, True, True, True, True, False, True, True)


@pytest.mark.parametrize("page_size", [0, 257], ids=["b2:page-zero", "b2:page-257"])
def test_page_bounds_are_isolated_to_rule_four(page_size: int) -> None:
    row = list(_physical_row("eventEmpty"))
    row[8] = page_size
    inspected = _inspect(tuple(row))
    assert inspected.rule_flags == (True, True, True, False, True, True, True, True, True)


@pytest.mark.parametrize("_b2_case", [None], ids=["b2:request-extra-key"])
def test_canonical_request_extra_key_is_isolated_to_rule_two(_b2_case: None) -> None:
    row = list(_physical_row("eventEmpty"))
    request = json.loads(cast(bytes, row[7]))
    request["extra"] = True
    row[7] = json.dumps(request, sort_keys=True, separators=(",", ":")).encode()
    inspected = _inspect(tuple(row))
    assert inspected.rule_flags == (True, False, True, True, True, True, True, True, True)


@pytest.mark.parametrize("_b2_case", [None], ids=["b2:event-missing-retained-tail"])
def test_event_missing_history_is_isolated_to_rule_nine(_b2_case: None) -> None:
    inspected = _inspect(
        _physical_row("eventNonempty"),
        vector_name="event-nonempty",
        event_tail_exists=lambda *_args: False,
    )
    assert inspected.rule_flags == (True, True, True, True, True, True, True, False, True)


@pytest.mark.parametrize("_b2_case", [None], ids=["b2:checkpoint-missing-put"])
def test_checkpoint_missing_put_is_isolated_to_rule_ten(_b2_case: None) -> None:
    inspected = _inspect(
        _physical_row("checkpoint"),
        vector_name="checkpoint",
        checkpoint_revision_exists=lambda *_args: False,
    )
    assert inspected.rule_flags == (True, True, True, True, True, True, True, True, False)
