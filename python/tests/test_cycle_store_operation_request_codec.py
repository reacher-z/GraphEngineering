from __future__ import annotations

import hashlib
import json
from typing import Any

import pytest

from graph_engineering import (
    CYCLE_STORE_OPERATION_DOMAIN,
    CycleStoreProviderError,
    canonical_bytes,
    create_cycle_store_checkpoint,
    create_cycle_store_record,
    create_reference_cycle_store_provider_descriptor,
    cycle_store_adapter_codec,
    decode_canonical_mutation_request,
    encode_canonical_mutation_request,
)
from graph_engineering.cycle_store_provider import MAX_CYCLE_STORE_APPEND_BYTES

AUTH = {
    "tenantId": "tenant-a",
    "principalHash": "a" * 64,
    "authorizationHash": "b" * 64,
}


def mutation(operation_id: str) -> dict[str, Any]:
    return {**AUTH, "operationId": operation_id}


def mutation_vectors() -> list[tuple[str, dict[str, Any]]]:
    descriptor = create_reference_cycle_store_provider_descriptor()
    record = create_cycle_store_record(
        record_id="record-0",
        sequence=0,
        previous_record_hash=None,
        value={"nested": ["graph", {"exact": True}], "ratio": 1.25},
    )
    checkpoint = create_cycle_store_checkpoint(
        checkpoint_scope="scope-a",
        checkpoint_id="checkpoint-a",
        stream_id="stream-a",
        bound_sequence=0,
        bound_record_hash=str(record["recordHash"]),
        created_at="2026-07-27T00:00:01Z",
        value={"state": "ready", "attempts": [1, 2, 3]},
    )
    lease = {"leaseId": "lease-a", "holderId": "holder-a", "fencingToken": 1}
    raw: list[tuple[str, dict[str, Any]]] = [
        (
            "append",
            {
                "context": mutation("op-append"),
                "streamId": "stream-a",
                "expectedTail": {
                    "exists": False,
                    "sequence": -1,
                    "recordHash": None,
                },
                "lease": None,
                "records": [record],
            },
        ),
        (
            "save-checkpoint",
            {"context": mutation("op-save"), "checkpoint": checkpoint, "lease": None},
        ),
        (
            "delete-checkpoint",
            {
                "context": mutation("op-delete"),
                "checkpointScope": "scope-a",
                "checkpointId": "checkpoint-a",
                "expectedValueHash": checkpoint["valueHash"],
            },
        ),
        (
            "acquire-lease",
            {
                "context": mutation("op-acquire-lease"),
                "streamId": "stream-a",
                "leaseId": "lease-a",
                "holderId": "holder-a",
                "ttlMs": 1_000,
                "mode": "acquire",
                "expectedFencingToken": 0,
            },
        ),
        (
            "renew-lease",
            {
                "context": mutation("op-renew-lease"),
                "streamId": "stream-a",
                "lease": lease,
                "ttlMs": 2_000,
            },
        ),
        (
            "release-lease",
            {
                "context": mutation("op-release-lease"),
                "streamId": "stream-a",
                "lease": lease,
            },
        ),
        (
            "set-legal-hold",
            {
                "context": mutation("op-legal-hold"),
                "streamId": "stream-a",
                "holdId": "hold-a",
                "action": "place",
            },
        ),
        (
            "acquire-migration-lock",
            {
                "context": mutation("op-acquire-migration"),
                "lockId": "migration-a",
                "ownerId": "owner-a",
                "sourceSchemaVersion": 1,
                "targetSchemaVersion": 2,
                "ttlMs": 3_000,
                "mode": "acquire",
                "expectedFencingToken": 0,
            },
        ),
        (
            "release-migration-lock",
            {
                "context": mutation("op-release-migration"),
                "lockId": "migration-a",
                "ownerId": "owner-a",
                "fencingToken": 1,
            },
        ),
    ]
    return [
        (
            operation,
            cycle_store_adapter_codec.capture_request(operation, value, descriptor),
        )
        for operation, value in raw
    ]


def expect_corruption(operation: str, value: bytes) -> CycleStoreProviderError:
    with pytest.raises(CycleStoreProviderError) as caught:
        decode_canonical_mutation_request(operation, value)
    error = caught.value
    assert error.code == "GE_CYCLE_STORE_CORRUPTION"
    assert error.operation == operation
    assert error.retryable is False
    assert str(error) == "operation ledger request bytes are corrupt"
    assert error.details == {}
    return error


def test_python_request_vectors_are_byte_identical_to_typescript() -> None:
    expected_byte_digests = {
        "append": "f8c2b14eaed47cbd761e84125fc9c59fe3869c848a90eb26240dfbcca6341d23",
        "save-checkpoint": "dc1a5978db6fa16a37feae8506852fb5dfaf2245126d3b6febe2668cc9aa38cf",
        "delete-checkpoint": "f5b8023f875d9fde2058fcd46a8a774a3a3e9aa2287d90741ef279092d307c3a",
        "acquire-lease": "3dc466db729fbae8aa32251f1e877bd3d722b82426cdb3d6224603d49951f698",
        "renew-lease": "d0cb7056c5cf11147ef7f939b26bad37110ef79fd190e9b058865069557901cd",
        "release-lease": "bc81d03dca032deb3a3361fe1f6f0beae87237902d6918075fd491ef0261c7b1",
        "set-legal-hold": "ca2fa725ce0c504e173c91bb003134d8bff1e6b77803229bb91a52c68f83de13",
        "acquire-migration-lock": (
            "d69ad30bcd3004390feba799ac5840483bc88b1f2b97e97a7c3ecb5ab72df26f"
        ),
        "release-migration-lock": (
            "e58c1bc1902e1f17b05268e3199bae4a562c53b91c0ecd81d0548684635bb99a"
        ),
    }
    expected_request_hashes = {
        "append": "88a1f35127aa3aa2499c4df133d667b9d56d8067cea61162359de7acc48be826",
        "save-checkpoint": "c2dda448a616b64d6d7d07be2b8a4ac7528c5f928eefa745a859d92389936c57",
        "delete-checkpoint": "a529641f4fb853f8bc712df2b216ea75539ee4dd0b69c3db9331c93711e71be1",
        "acquire-lease": "d63bf8db6351f9d07aa10c7a6022cf0bf4d325e01dd5544398500bd5ea63b66e",
        "renew-lease": "80a033b7274b0e52dfd31ac91c87659ca83ce8ff305a9c35983824dc07653b8c",
        "release-lease": "4ef921ec5d717cadcd87b26ec4777660301861c4989cec5fd30043298d0a644f",
        "set-legal-hold": "77ab0a0c24e192fe3894ae3522f358c044d26cf8a8a4a89be8a0c9231e1d4f21",
        "acquire-migration-lock": (
            "a3fa5fe0c98bebeb20958e8ae6ec8a2713d821ae084d91f364e60559586b402d"
        ),
        "release-migration-lock": (
            "9476bb24dc6325cfb27ef3f75bfe1465997fefa559df5a5bf68e15e7d0424218"
        ),
    }
    vectors = mutation_vectors()
    assert [operation for operation, _request in vectors] == list(expected_byte_digests)
    for operation, request in vectors:
        encoded = encode_canonical_mutation_request(operation, request)
        assert encoded == canonical_bytes(request)
        assert hashlib.sha256(encoded).hexdigest() == expected_byte_digests[operation]
        assert (
            cycle_store_adapter_codec.operation_request_hash(operation, request)
            == expected_request_hashes[operation]
        )
        decoded = decode_canonical_mutation_request(operation, encoded)
        assert decoded == request
        assert encode_canonical_mutation_request(operation, decoded) == encoded
    assert CYCLE_STORE_OPERATION_DOMAIN.endswith("\0")


def test_python_request_decoder_rejects_hostile_stored_bytes_without_leaks() -> None:
    request = dict(mutation_vectors()[6][1])
    canonical = encode_canonical_mutation_request("set-legal-hold", request)
    raw = json.loads(canonical)
    reordered = json.dumps(
        {
            "streamId": raw["streamId"],
            "context": raw["context"],
            "holdId": raw["holdId"],
            "action": raw["action"],
        },
        separators=(",", ":"),
    ).encode()
    for hostile in (
        b"\xc3\x28",
        b"{",
        b" " + canonical,
        reordered,
        canonical.replace(b"tenant-a", b"tenant\\u002da"),
        b"\xef\xbb\xbf" + canonical,
    ):
        expect_corruption("set-legal-hold", hostile)
    marker = "MUST_NOT_LEAK_BEARER_7f9238"
    error = expect_corruption(
        "set-legal-hold",
        canonical_bytes({"bearerToken": marker}),
    )
    assert marker not in json.dumps(error.to_dict(), sort_keys=True)
    assert "bearerToken" not in json.dumps(error.to_dict(), sort_keys=True)


def test_python_request_codec_rejects_operation_shape_and_number_confusion() -> None:
    hold = mutation_vectors()[6][1]
    hold_bytes = encode_canonical_mutation_request("set-legal-hold", hold)
    expect_corruption("release-lease", hold_bytes)
    raw = json.loads(hold_bytes)
    expect_corruption(
        "set-legal-hold",
        canonical_bytes({**raw, "requestHash": "c" * 64}),
    )
    missing = {key: value for key, value in raw.items() if key != "action"}
    expect_corruption("set-legal-hold", canonical_bytes(missing))
    context = dict(raw["context"])
    expect_corruption(
        "set-legal-hold",
        canonical_bytes({**raw, "context": {**context, "bearerToken": "secret"}}),
    )
    unsafe = (
        '{"context":{"authorizationHash":"'
        + "b" * 64
        + '","operationId":"unsafe","principalHash":"'
        + "a" * 64
        + '","tenantId":"tenant-a"},"expectedFencingToken":9007199254740992,'
        '"holderId":"holder-a","leaseId":"lease-a","mode":"acquire",'
        '"streamId":"stream-a","ttlMs":1000}'
    ).encode()
    expect_corruption("acquire-lease", unsafe)
    expect_corruption("append", b"\0" * (MAX_CYCLE_STORE_APPEND_BYTES + 1))
    with pytest.raises(CycleStoreProviderError):
        cycle_store_adapter_codec.operation_request_hash("release-lease", hold)


def test_python_request_codec_detaches_input_output_and_accepts_schema_v2_lock() -> None:
    append = json.loads(canonical_bytes(mutation_vectors()[0][1]))
    encoded = encode_canonical_mutation_request("append", append)
    retained = bytes(encoded)
    append["streamId"] = "changed-after-encode"
    append["records"][0]["value"]["nested"][0] = "changed-after-encode"
    assert encoded == retained
    first = decode_canonical_mutation_request("append", encoded)
    first["streamId"] = "changed-after-decode"
    second = decode_canonical_mutation_request("append", encoded)
    assert second["streamId"] == "stream-a"
    assert second["records"][0]["value"] == {
        "nested": ["graph", {"exact": True}],
        "ratio": 1.25,
    }

    v2_request = dict(mutation_vectors()[7][1])
    v2_request["context"] = mutation("op-acquire-migration-v2")
    v2_request["sourceSchemaVersion"] = 2
    v2_request["targetSchemaVersion"] = 3
    v2_bytes = encode_canonical_mutation_request("acquire-migration-lock", v2_request)
    assert decode_canonical_mutation_request("acquire-migration-lock", v2_bytes) == v2_request
