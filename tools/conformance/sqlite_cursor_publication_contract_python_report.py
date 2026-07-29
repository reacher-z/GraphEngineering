#!/usr/bin/env python3
"""Independently derive Python's SQLite v1/v2 provider descriptor identities."""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
PYTHON_ROOT = ROOT / "python"
if str(PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(PYTHON_ROOT))

from graph_engineering.canonical import canonical_bytes  # noqa: E402
from graph_engineering.cycle_store_provider import (  # noqa: E402
    MAX_CYCLE_STORE_APPEND_BYTES,
    MAX_CYCLE_STORE_APPEND_RECORDS,
    MAX_CYCLE_STORE_CHECKPOINT_BYTES,
    MAX_CYCLE_STORE_LEASE_TTL_MS,
    MAX_CYCLE_STORE_PAGE_SIZE,
    MAX_CYCLE_STORE_RECORD_BYTES,
    cycle_store_adapter_codec,
)

DOMAIN = b"graph-engineering/cycle-store-provider-descriptor/v1alpha1\0"


def _profile(version: int) -> dict[str, Any]:
    return {
        "providerId": "sqlite-local",
        "schemaVersion": version,
        "compatibility": {
            "minReaderVersion": version,
            "maxReaderVersion": version,
            "minWriterVersion": version,
            "maxWriterVersion": version,
        },
        "limits": {
            "maxAppendRecords": MAX_CYCLE_STORE_APPEND_RECORDS,
            "maxRecordBytes": MAX_CYCLE_STORE_RECORD_BYTES,
            "maxAppendBytes": MAX_CYCLE_STORE_APPEND_BYTES,
            "maxPageSize": MAX_CYCLE_STORE_PAGE_SIZE,
            "maxCheckpointBytes": MAX_CYCLE_STORE_CHECKPOINT_BYTES,
            "maxLeaseTtlMs": MAX_CYCLE_STORE_LEASE_TTL_MS,
        },
        "capabilities": {
            "durability": "durable",
            "distributedFencing": False,
            "snapshotPagination": True,
            "checkpointCrud": True,
            "legalHold": "enforced",
            "backupRestore": "enforced",
            "compaction": "logical-history-preserving",
        },
        "protection": {
            "payloadProtection": "external",
            "encryptionAtRest": "external",
            "rawPayloadObservability": False,
        },
        "governance": {
            "retention": "descriptor-only",
            "archival": "descriptor-only",
            "legalHoldBlocksDeletion": True,
            "migrationLock": "exclusive-fenced",
            "backupIdentity": "content-addressed",
        },
    }


def _derive(version: int) -> dict[str, Any]:
    descriptor = cycle_store_adapter_codec.create_descriptor(_profile(version))
    body = {key: value for key, value in descriptor.items() if key != "descriptorHash"}
    body_bytes = canonical_bytes(body)
    descriptor_bytes = canonical_bytes(descriptor)
    calculated = hashlib.sha256(DOMAIN + body_bytes).hexdigest()
    if calculated != descriptor["descriptorHash"]:
        raise AssertionError("Python descriptor codec and independent domain hash disagree")
    return {
        "schemaVersion": version,
        "descriptorHash": descriptor["descriptorHash"],
        "descriptorBodyBytes": len(body_bytes),
        "descriptorBodySha256": hashlib.sha256(body_bytes).hexdigest(),
        "descriptorCanonicalBytes": len(descriptor_bytes),
        "descriptorCanonicalSha256": hashlib.sha256(descriptor_bytes).hexdigest(),
        "domainBytes": len(DOMAIN),
        "domainSeparatedBytes": len(DOMAIN) + len(body_bytes),
    }


def main() -> None:
    fixture = json.loads(
        (ROOT / "spec/conformance/sqlite-cursor-publication-rebind-v2.case.json").read_text(
            encoding="utf-8"
        )
    )
    source = _derive(1)
    target = _derive(2)
    if source["descriptorHash"] != fixture["identities"]["source"]["descriptorHash"]:
        raise AssertionError("Python v1 descriptor differs from the B3 source literal")
    target_fixture = fixture["identities"]["target"]
    if target["descriptorHash"] != target_fixture["descriptorHash"]:
        raise AssertionError("Python v2 descriptor differs from the B3 target literal")
    if target["descriptorBodySha256"] != target_fixture["descriptorBodySha256"]:
        raise AssertionError("Python v2 descriptor body differs from the B3 literal")
    if target["descriptorCanonicalSha256"] != target_fixture["descriptorCanonicalSha256"]:
        raise AssertionError("Python v2 canonical descriptor differs from the B3 literal")
    print(
        json.dumps(
            {
                "schemaVersion": 1,
                "runtime": "python",
                "contract": fixture["id"],
                "source": source,
                "target": target,
                "implementationClaim": fixture["claims"]["implementationClaim"],
                "activeManifestClaim": fixture["claims"]["activeManifestClaim"],
            },
            separators=(",", ":"),
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
