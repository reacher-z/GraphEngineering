from __future__ import annotations

import copy
import hashlib
from dataclasses import FrozenInstanceError, replace
from pathlib import Path
from types import MappingProxyType

import pytest

import graph_engineering.sqlite_operation_baseline_cursor_ownership as ownership
from graph_engineering.canonical import canonical_bytes
from graph_engineering.models import MAX_SAFE_INTEGER
from graph_engineering.sqlite_cycle_store import (
    _REQUIRED_MIGRATION_POSTCONDITIONS,
    SQLITE_CYCLE_STORE_DESCRIPTOR_HASH,
    SQLITE_CYCLE_STORE_SCHEMA_IDENTITY_SHA256,
    _load_migration_assets,
)
from graph_engineering.sqlite_operation_baseline import (
    BASELINE_EMPTY_ROOT,
    BaselineAccumulator,
    create_baseline_id,
)
from graph_engineering.sqlite_operation_baseline_cursor_invariants import (
    SQLITE_CURSOR_SEAL_EMPTY_ROOT,
    SQLiteCursorImmutableSealReceipt,
    seal_sqlite_v1_cursor_rows,
)
from graph_engineering.sqlite_operation_baseline_cursor_ownership import (
    SQLiteCursorPreRebindReceipt,
    SQLiteCursorPreRebindReceiptCandidate,
    SQLiteCursorPreRebindReceiptIssuer,
    assert_sqlite_cursor_pre_rebind_receipt_provenance,
    create_sqlite_cursor_capture_session,
    create_sqlite_cursor_exact_projection_reference,
    create_sqlite_cursor_ownership_capability,
)
from graph_engineering.sqlite_operation_baseline_source import (
    SQLiteV1BaselineConnectionOwner,
    capture_sqlite_v1_baseline_source_summary,
)

ROOT = Path(__file__).resolve().parents[2]
CAPTURED_AT_MS = 1_785_110_405_000
SOURCE_ASSETS = _load_migration_assets()
SHARED_A = "a" * 64
SHARED_B = "b" * 64
SHARED_C = "c" * 64
SHARED_D = "d" * 64


def _shared_event_row() -> tuple[object, ...]:
    return (
        "tenant-alpha",
        SHARED_A,
        "event",
        SHARED_B,
        SHARED_C,
        "stream-alpha",
        None,
        b'{"contractVersion":"cycle-store-provider/v1alpha1","pageSize":64,"streamId":"stream-alpha"}',
        64,
        7,
        6,
        SHARED_D,
        SQLITE_CYCLE_STORE_DESCRIPTOR_HASH,
        SQLITE_CYCLE_STORE_SCHEMA_IDENTITY_SHA256,
        (f'{{"recordHash":"{SHARED_D}","sequence":6}}').encode(),
        1_700_000_000_000,
        1_700_000_300_000,
        None,
    )


def _shared_checkpoint_row() -> tuple[object, ...]:
    return (
        "tenant-beta",
        SHARED_B,
        "checkpoint",
        SHARED_C,
        SHARED_D,
        None,
        "checkpoint-scope",
        b'{"checkpointScope":"checkpoint-scope","contractVersion":"cycle-store-provider/v1alpha1","pageSize":16}',
        16,
        2,
        None,
        None,
        SQLITE_CYCLE_STORE_DESCRIPTOR_HASH,
        SQLITE_CYCLE_STORE_SCHEMA_IDENTITY_SHA256,
        (
            b'[{"checkpointId":"cp-b","checkpointScope":"checkpoint-scope","revision":2},'
            b'{"checkpointId":"cp-a","checkpointScope":"checkpoint-scope","revision":1}]'
        ),
        1_700_000_000_000,
        1_700_000_300_000,
        1_700_000_100_000,
    )


def _fleet_row(index: int) -> tuple[object, ...]:
    return (
        "tenant-fleet",
        f"{index:064x}",
        "event",
        SHARED_B,
        SHARED_C,
        "stream-fleet",
        None,
        b'{"contractVersion":"cycle-store-provider/v1alpha1","pageSize":32,"streamId":"stream-fleet"}',
        32,
        index,
        index,
        SHARED_D,
        SQLITE_CYCLE_STORE_DESCRIPTOR_HASH,
        SQLITE_CYCLE_STORE_SCHEMA_IDENTITY_SHA256,
        (f'{{"recordHash":"{SHARED_D}","sequence":{index}}}').encode(),
        1_700_000_000_000 + index,
        1_700_000_300_000 + index,
        None,
    )


def _database(captured_at_ms: int = CAPTURED_AT_MS) -> SQLiteV1BaselineConnectionOwner:
    connection = SQLiteV1BaselineConnectionOwner(":memory:")
    schema = (ROOT / "python/src/graph_engineering/_sqlite_migrations/schema-v1.sql").read_text()
    connection.executescript(schema)
    connection.execute(
        """INSERT INTO ge_cycle_schema VALUES
           (1, 1, 1, 1, 1, 1, ?, ?, ?, ?, ?, ?)""",
        (
            SQLITE_CYCLE_STORE_SCHEMA_IDENTITY_SHA256,
            SOURCE_ASSETS.schema_sql_hash,
            captured_at_ms,
            SQLITE_CYCLE_STORE_DESCRIPTOR_HASH,
            captured_at_ms,
            captured_at_ms,
        ),
    ).close()
    connection.execute(
        """INSERT INTO ge_cycle_migrations VALUES
           (1, 0, 'fresh-v1-baseline', ?, ?, ?,
            'rebuild-from-verified-backup-only', ?)""",
        (
            SOURCE_ASSETS.schema_sql_hash,
            SQLITE_CYCLE_STORE_SCHEMA_IDENTITY_SHA256,
            captured_at_ms,
            canonical_bytes({"requiredPostconditions": list(_REQUIRED_MIGRATION_POSTCONDITIONS)}),
        ),
    ).close()
    connection.execute(
        """INSERT INTO ge_cycle_migration_lock VALUES
           (1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, 0, ?)""",
        (captured_at_ms,),
    ).close()
    connection.commit()
    return connection


def _candidate(
    *,
    ownership_fill: tuple[int, int, int, int, int] = (0, 17, 34, 51, 68),
    captured_at_ms: int = CAPTURED_AT_MS,
    cursor_rows: tuple[tuple[object, ...], ...] = (),
) -> tuple[SQLiteV1BaselineConnectionOwner, SQLiteCursorPreRebindReceiptCandidate]:
    connection = _database(captured_at_ms)
    connection.execute("BEGIN EXCLUSIVE").close()
    summary = capture_sqlite_v1_baseline_source_summary(
        connection,
        captured_at_ms=captured_at_ms,
    )
    accumulator = BaselineAccumulator(
        create_baseline_id(summary.source_envelope),
        summary.expected_entry_count,
    )
    for entry in summary.iter_identity_entries():
        accumulator.append(entry)
    projection = accumulator.finish()
    envelope = summary.source_envelope
    seal = seal_sqlite_v1_cursor_rows(
        cursor_rows,
        expected_count=len(cursor_rows),
        source_descriptor_hash=str(envelope["sourceDescriptorHash"]),
        source_schema_identity_sha256=str(envelope["sourceSchemaIdentitySha256"]),
    )
    kinds = ("tenant", "source-stage", "campaign", "connection")
    capabilities = tuple(
        create_sqlite_cursor_ownership_capability(kind, bytes([fill]) * 32)
        for kind, fill in zip(kinds, ownership_fill[:4], strict=True)
    )
    tenant, source_stage, campaign, connection_capability = capabilities
    session = create_sqlite_cursor_capture_session(
        tenant_ownership=tenant,
        source_stage_ownership=source_stage,
        campaign_ownership=campaign,
        connection_ownership=connection_capability,
        nonce=bytes([ownership_fill[4]]) * 32,
    )
    reference = create_sqlite_cursor_exact_projection_reference(projection)
    return connection, SQLiteCursorPreRebindReceiptCandidate(
        summary,
        summary.clock_evidence,
        seal,
        projection,
        reference,
        session,
        tenant,
        source_stage,
        campaign,
        connection_capability,
    )


def test_opaque_mint_and_sole_input_repeatable_provenance_fence() -> None:
    connection, candidate = _candidate()
    try:
        issuer = SQLiteCursorPreRebindReceiptIssuer(candidate)
        receipt = issuer.issue(candidate)
        assert type(receipt) is SQLiteCursorPreRebindReceipt
        first = assert_sqlite_cursor_pre_rebind_receipt_provenance(receipt)
        second = assert_sqlite_cursor_pre_rebind_receipt_provenance(receipt)
        assert first == second
        assert first.source_summary is candidate.source_summary
        assert first.clock_evidence is candidate.clock_evidence
        assert first.immutable_seal_receipt is candidate.immutable_seal_receipt
        assert first.projection_identity is candidate.projection_identity
        assert first.projection_reference is candidate.projection_reference
        assert first.capture_session is candidate.capture_session
        assert first.tenant_ownership is candidate.tenant_ownership
        assert first.source_stage_ownership is candidate.source_stage_ownership
        assert first.campaign_ownership is candidate.campaign_ownership
        assert first.connection_ownership is candidate.connection_ownership
        assert first.projection_reference_sha256 == (
            "2f512edf3ef9899fc109d415a2d392604f083257445ca43c2fab1aa29e06f615"
        )
        assert first.receipt_sha256 == (
            "e63c0eed6c3cb3aee2f8d12e1562395ff577af4c4721b59397111cae6bc032ad"
        )
        validated = ownership._validate_candidate(candidate)
        assert (
            tuple(validated.receipt_document) == ownership.SQLITE_CURSOR_PRE_REBIND_RECEIPT_FIELDS
        )
        assert len(canonical_bytes(validated.receipt_document)) == 964
        with pytest.raises(FrozenInstanceError):
            first.receipt_sha256 = "0" * 64  # type: ignore[misc]
        with pytest.raises(TypeError, match="module-minted"):
            SQLiteCursorPreRebindReceipt(object())
        with pytest.raises((TypeError, ValueError), match="receipt"):
            assert_sqlite_cursor_pre_rebind_receipt_provenance(object())  # type: ignore[arg-type]
    finally:
        connection.close()


@pytest.mark.parametrize(
    (
        "vector",
        "captured_at_ms",
        "ownership_fill",
        "expected_a1_root",
        "expected_projection_reference",
        "expected_receipt_root",
    ),
    [
        (
            "empty",
            CAPTURED_AT_MS,
            (0, 17, 34, 51, 68),
            "587bd52db10d2d03c9f7b8bbcecee9c6f83d0c076b17846883e6885e10e2b47f",
            "2f512edf3ef9899fc109d415a2d392604f083257445ca43c2fab1aa29e06f615",
            "e63c0eed6c3cb3aee2f8d12e1562395ff577af4c4721b59397111cae6bc032ad",
        ),
        (
            "one",
            CAPTURED_AT_MS + 100,
            (1, 18, 35, 52, 69),
            "1445422fdd2e7e6f93458c6d5e4cf35c53ebac8596cf117595c1f926086681ea",
            "1b1216f52ee1065506d4bc95d8f60e7bb7ed770650d5642bcb5f3af489035f41",
            "cb710d7ec15c2e5c729ee813d5f0b03dcfdf795203df8a4ecf5a174b063743f6",
        ),
        (
            "multi",
            CAPTURED_AT_MS + 200,
            (2, 19, 36, 53, 70),
            "3ee9a67ea7d1d961af54178d1df8c3cdf32dddfd4d7c5dcae03aca31efad84d1",
            "f251a94daf436f8e0f6ab26b15e2c308756697990dd1c08be9e8591dc8fb9073",
            "f0571ef81f6864bccc2bedbe81f586363bb3d8ca2ff38b3545f95bfbe808b6c7",
        ),
        (
            "hostile",
            MAX_SAFE_INTEGER,
            (255, 238, 221, 204, 187),
            "2d9327dc17dadaf43c3643b853d38ea09e0e396d7005e553a5a5e88469b3857f",
            "a7e33b7658cdb0040d842c5652db713bfdb87ba4403a807b77cffb385066ca94",
            "e319abeed2696190770ff3a54669afeb24eff4810dae6072cb3a8141766037fa",
        ),
    ],
)
def test_shared_real_empty_one_multi_and_hostile_roots(
    vector: str,
    captured_at_ms: int,
    ownership_fill: tuple[int, int, int, int, int],
    expected_a1_root: str,
    expected_projection_reference: str,
    expected_receipt_root: str,
) -> None:
    rows = {
        "empty": (),
        "one": (_shared_event_row(),),
        "multi": (_shared_event_row(), _shared_checkpoint_row()),
        "hostile": tuple(_fleet_row(index) for index in range(1_024)),
    }[vector]
    connection, candidate = _candidate(
        ownership_fill=ownership_fill,
        captured_at_ms=captured_at_ms,
        cursor_rows=rows,
    )
    try:
        assert candidate.immutable_seal_receipt.immutable_root_sha256 == expected_a1_root
        receipt = SQLiteCursorPreRebindReceiptIssuer(candidate).issue(candidate)
        witness = assert_sqlite_cursor_pre_rebind_receipt_provenance(receipt)
        assert witness.projection_reference_sha256 == expected_projection_reference
        assert witness.receipt_sha256 == expected_receipt_root
    finally:
        connection.close()


def test_all_ten_equal_value_substitutions_are_atomic_before_one_success() -> None:
    connection, candidate = _candidate()
    try:
        issuer = SQLiteCursorPreRebindReceiptIssuer(candidate)
        summary_clone = replace(candidate.source_summary)
        clock_clone = replace(candidate.clock_evidence)
        seal_clone = replace(candidate.immutable_seal_receipt)
        projection_clone = replace(candidate.projection_identity)
        reference_clone = create_sqlite_cursor_exact_projection_reference(
            candidate.projection_identity
        )
        session_clone = create_sqlite_cursor_capture_session(
            tenant_ownership=candidate.tenant_ownership,
            source_stage_ownership=candidate.source_stage_ownership,
            campaign_ownership=candidate.campaign_ownership,
            connection_ownership=candidate.connection_ownership,
            nonce=bytes([68]) * 32,
        )
        capability_clones = (
            create_sqlite_cursor_ownership_capability("tenant", bytes(32)),
            create_sqlite_cursor_ownership_capability("source-stage", bytes([17]) * 32),
            create_sqlite_cursor_ownership_capability("campaign", bytes([34]) * 32),
            create_sqlite_cursor_ownership_capability("connection", bytes([51]) * 32),
        )
        substitutions = (
            replace(candidate, source_summary=summary_clone),
            replace(candidate, clock_evidence=clock_clone),
            replace(candidate, immutable_seal_receipt=seal_clone),
            replace(candidate, projection_identity=projection_clone),
            replace(candidate, projection_reference=reference_clone),
            replace(candidate, capture_session=session_clone),
            replace(candidate, tenant_ownership=capability_clones[0]),
            replace(candidate, source_stage_ownership=capability_clones[1]),
            replace(candidate, campaign_ownership=capability_clones[2]),
            replace(candidate, connection_ownership=capability_clones[3]),
        )
        for substitution in substitutions:
            with pytest.raises((TypeError, ValueError), match=r"ownership|substituted|summary"):
                issuer.issue(substitution)
            assert not issuer.is_issued
        receipt = issuer.issue(candidate)
        assert issuer.is_issued
        assert assert_sqlite_cursor_pre_rebind_receipt_provenance(receipt).receipt_sha256
        with pytest.raises(ValueError, match="consumed"):
            issuer.issue(candidate)
    finally:
        connection.close()


def test_source_projection_clock_a1_identity_and_empty_root_cross_checks() -> None:
    connection, candidate = _candidate()
    try:
        assert candidate.projection_identity.baseline_id == create_baseline_id(
            candidate.source_summary.source_envelope
        )
        assert (
            candidate.projection_identity.entry_count
            == candidate.source_summary.expected_entry_count
        )
        assert (
            candidate.projection_identity.legacy_operation_count
            == candidate.source_summary.counts_by_kind["legacy-operation"]
        )
        assert candidate.clock_evidence is candidate.source_summary.clock_evidence
        assert candidate.immutable_seal_receipt.cursor_count == 0
        assert (
            candidate.immutable_seal_receipt.immutable_root_sha256 == SQLITE_CURSOR_SEAL_EMPTY_ROOT
        )

        invalids = (
            replace(
                candidate,
                projection_identity=replace(
                    candidate.projection_identity,
                    baseline_id="v2-" + "0" * 64,
                ),
            ),
            replace(
                candidate,
                immutable_seal_receipt=replace(
                    candidate.immutable_seal_receipt,
                    immutable_root_sha256="0" * 64,
                ),
            ),
            replace(
                candidate,
                immutable_seal_receipt=SQLiteCursorImmutableSealReceipt(
                    1,
                    SQLITE_CURSOR_SEAL_EMPTY_ROOT,
                    candidate.immutable_seal_receipt.source_descriptor_hash,
                    candidate.immutable_seal_receipt.source_schema_identity_sha256,
                ),
            ),
            replace(
                candidate,
                source_summary=replace(
                    candidate.source_summary,
                    counts_by_kind=MappingProxyType(
                        {
                            **candidate.source_summary.counts_by_kind,
                            "schema-envelope": 2,
                        }
                    ),
                ),
            ),
        )
        for invalid in invalids:
            with pytest.raises((TypeError, ValueError)):
                SQLiteCursorPreRebindReceiptIssuer(invalid)

        invalid_projection_hash = replace(candidate.projection_identity, projection_sha256="0" * 64)
        with pytest.raises(ValueError, match="projection hash"):
            create_sqlite_cursor_exact_projection_reference(invalid_projection_hash)
        invalid_baseline_id = replace(candidate.projection_identity, baseline_id="V2-" + "0" * 64)
        with pytest.raises(ValueError, match="identifier"):
            create_sqlite_cursor_exact_projection_reference(invalid_baseline_id)
        nonempty_with_empty_root = replace(
            candidate.projection_identity,
            first_entry_hash=BASELINE_EMPTY_ROOT,
        )
        with pytest.raises(ValueError, match="empty baseline"):
            create_sqlite_cursor_exact_projection_reference(nonempty_with_empty_root)

        assert ownership.SQLITE_CURSOR_STATIC_CONTRACT_SHA256 == (
            "82bbb4c486590745fb6363151418bb8f50a1c56c4438c8b535b60f01fca7f8b9"
        )
        normalized_query = " ".join(ownership.SQLITE_CURSOR_MAIN_PROJECTION_SQL.split())
        assert ";" not in normalized_query
        assert normalized_query.endswith(
            "ORDER BY tenant_id COLLATE BINARY, token_hash COLLATE BINARY"
        )
        assert hashlib.sha256(normalized_query.encode()).hexdigest() == (
            "dda30c873dcae965e1cac3f6478549b98e2414e982c1287997b93a2c09d760a4"
        )
        assert tuple(ownership.sqlite_cursor_static_contract_document()) == (
            ownership.SQLITE_CURSOR_STATIC_CONTRACT_FIELDS
        )
        assert not hasattr(__import__("graph_engineering"), "SQLiteCursorPreRebindReceiptIssuer")
    finally:
        connection.close()


def test_mutable_references_and_nonce_are_defensively_copied() -> None:
    tenant_bytes = bytearray(bytes([7]) * 32)
    stage_backing = bytearray(bytes([8]) * 32)
    stage_view = memoryview(stage_backing)
    nonce = bytearray(bytes([9]) * 32)
    tenant = create_sqlite_cursor_ownership_capability("tenant", tenant_bytes)
    stage = create_sqlite_cursor_ownership_capability("source-stage", stage_view)
    campaign = create_sqlite_cursor_ownership_capability("campaign", bytes([10]) * 32)
    connection = create_sqlite_cursor_ownership_capability("connection", bytes([11]) * 32)
    tenant_hash = ownership._capability(tenant, "tenant").contribution_sha256
    stage_hash = ownership._capability(stage, "source-stage").contribution_sha256
    session = create_sqlite_cursor_capture_session(
        tenant_ownership=tenant,
        source_stage_ownership=stage,
        campaign_ownership=campaign,
        connection_ownership=connection,
        nonce=nonce,
    )
    session_hash = ownership._session(session).capture_session_sha256

    tenant_bytes[:] = bytes([70]) * 32
    stage_backing[:] = bytes([80]) * 32
    nonce[:] = bytes([90]) * 32
    assert ownership._capability(tenant, "tenant").contribution_sha256 == tenant_hash
    assert ownership._capability(stage, "source-stage").contribution_sha256 == stage_hash
    assert ownership._session(session).capture_session_sha256 == session_hash

    changed_tenant = create_sqlite_cursor_ownership_capability("tenant", tenant_bytes)
    changed_stage = create_sqlite_cursor_ownership_capability("source-stage", stage_view)
    assert ownership._capability(changed_tenant, "tenant").contribution_sha256 != tenant_hash
    assert ownership._capability(changed_stage, "source-stage").contribution_sha256 != stage_hash


def test_same_bytes_mint_equal_commitments_but_distinct_identity_capabilities() -> None:
    first = tuple(
        create_sqlite_cursor_ownership_capability(kind, bytes([fill]) * 32)
        for kind, fill in zip(
            ("tenant", "source-stage", "campaign", "connection"),
            (1, 2, 3, 4),
            strict=True,
        )
    )
    second = tuple(
        create_sqlite_cursor_ownership_capability(kind, bytes([fill]) * 32)
        for kind, fill in zip(
            ("tenant", "source-stage", "campaign", "connection"),
            (1, 2, 3, 4),
            strict=True,
        )
    )
    for kind, left, right in zip(
        ("tenant", "source-stage", "campaign", "connection"),
        first,
        second,
        strict=True,
    ):
        assert left is not right
        assert (
            ownership._capability(left, kind).contribution_sha256
            == ownership._capability(right, kind).contribution_sha256
        )
    first_session = create_sqlite_cursor_capture_session(
        tenant_ownership=first[0],
        source_stage_ownership=first[1],
        campaign_ownership=first[2],
        connection_ownership=first[3],
        nonce=bytes([5]) * 32,
    )
    second_session = create_sqlite_cursor_capture_session(
        tenant_ownership=second[0],
        source_stage_ownership=second[1],
        campaign_ownership=second[2],
        connection_ownership=second[3],
        nonce=bytes([5]) * 32,
    )
    assert first_session is not second_session
    assert (
        ownership._session(first_session).capture_session_sha256
        == ownership._session(second_session).capture_session_sha256
    )


@pytest.mark.parametrize(
    "clock_field",
    ["captured_at_ms", "maximum_non_cursor_observed_at_ms", "provider_high_water_at_ms"],
)
@pytest.mark.parametrize("unsafe", [-1, True, 1.5, MAX_SAFE_INTEGER + 1])
def test_all_clock_fields_reject_unsafe_integer_values(clock_field: str, unsafe: object) -> None:
    connection, candidate = _candidate()
    try:
        bad_clock = replace(candidate.clock_evidence, **{clock_field: unsafe})
        bad_summary = replace(candidate.source_summary, clock_evidence=bad_clock)
        bad_candidate = replace(
            candidate,
            source_summary=bad_summary,
            clock_evidence=bad_clock,
        )
        with pytest.raises(ValueError, match=r"clock|high-water"):
            SQLiteCursorPreRebindReceiptIssuer(bad_candidate)
    finally:
        connection.close()


def test_maximum_safe_clock_fixture_issues_successfully() -> None:
    connection, candidate = _candidate(captured_at_ms=MAX_SAFE_INTEGER)
    try:
        assert candidate.clock_evidence.captured_at_ms == MAX_SAFE_INTEGER
        receipt = SQLiteCursorPreRebindReceiptIssuer(candidate).issue(candidate)
        assert assert_sqlite_cursor_pre_rebind_receipt_provenance(receipt).receipt_sha256
    finally:
        connection.close()


def test_every_receipt_contribution_changes_the_framed_root() -> None:
    connection, candidate = _candidate()
    try:
        document = ownership._validate_candidate(candidate).receipt_document
        assert tuple(document) == ownership.SQLITE_CURSOR_PRE_REBIND_RECEIPT_FIELDS
        baseline = ownership._framed_hash(
            ownership.SQLITE_CURSOR_PRE_REBIND_RECEIPT_DOMAIN, document
        )
        roots: set[str] = set()
        for field in ownership.SQLITE_CURSOR_PRE_REBIND_RECEIPT_FIELDS:
            mutated = dict(document)
            value = mutated[field]
            if type(value) is int:
                mutated[field] = value + 1
            else:
                assert type(value) is str and len(value) == 64
                mutated[field] = ("0" if value[0] != "0" else "1") + value[1:]
            root = ownership._framed_hash(
                ownership.SQLITE_CURSOR_PRE_REBIND_RECEIPT_DOMAIN,
                mutated,
            )
            assert root != baseline, field
            roots.add(root)
        assert len(roots) == len(ownership.SQLITE_CURSOR_PRE_REBIND_RECEIPT_FIELDS)
        reversed_document = dict(reversed(tuple(document.items())))
        assert (
            ownership._framed_hash(
                ownership.SQLITE_CURSOR_PRE_REBIND_RECEIPT_DOMAIN,
                reversed_document,
            )
            == baseline
        )
    finally:
        connection.close()


def test_pairwise_mixed_source_stage_campaign_projection_and_high_water_are_atomic() -> None:
    connection_a, candidate_a = _candidate()
    connection_b, candidate_b = _candidate(
        ownership_fill=(5, 22, 39, 56, 73),
        captured_at_ms=CAPTURED_AT_MS + 1,
    )
    try:
        issuer = SQLiteCursorPreRebindReceiptIssuer(candidate_a)
        mixed = (
            replace(
                candidate_a,
                source_summary=candidate_b.source_summary,
                clock_evidence=candidate_b.clock_evidence,
            ),
            replace(candidate_a, source_stage_ownership=candidate_b.source_stage_ownership),
            replace(candidate_a, campaign_ownership=candidate_b.campaign_ownership),
            replace(
                candidate_a,
                projection_identity=candidate_b.projection_identity,
                projection_reference=candidate_b.projection_reference,
            ),
            replace(candidate_a, clock_evidence=candidate_b.clock_evidence),
        )
        for candidate in mixed:
            with pytest.raises((TypeError, ValueError)):
                issuer.issue(candidate)
            assert not issuer.is_issued
        receipt = issuer.issue(candidate_a)
        assert issuer.is_issued
        assert assert_sqlite_cursor_pre_rebind_receipt_provenance(receipt).source_summary is (
            candidate_a.source_summary
        )
    finally:
        connection_a.close()
        connection_b.close()


def test_frozen_exact_candidate_and_opaque_constructor_clone_attacks_fail() -> None:
    connection, candidate = _candidate()
    try:
        with pytest.raises(FrozenInstanceError):
            candidate.clock_evidence = replace(candidate.clock_evidence)  # type: ignore[misc]

        class CandidateSubclass(SQLiteCursorPreRebindReceiptCandidate):
            pass

        subclass = CandidateSubclass(
            *tuple(getattr(candidate, field) for field in candidate.__slots__)
        )
        with pytest.raises(TypeError, match="candidate"):
            SQLiteCursorPreRebindReceiptIssuer(subclass)

        attacks = (
            (copy.copy(candidate.tenant_ownership), ownership._capability, "tenant"),
            (copy.copy(candidate.capture_session), ownership._session, None),
            (copy.copy(candidate.projection_reference), ownership._projection_reference, None),
        )
        for clone, validator, kind in attacks:
            with pytest.raises((TypeError, ValueError)):
                if kind is None:
                    validator(clone)
                else:
                    validator(clone, kind)
        receipt = SQLiteCursorPreRebindReceiptIssuer(candidate).issue(candidate)
        with pytest.raises((TypeError, ValueError), match="provenance"):
            assert_sqlite_cursor_pre_rebind_receipt_provenance(copy.copy(receipt))
    finally:
        connection.close()
