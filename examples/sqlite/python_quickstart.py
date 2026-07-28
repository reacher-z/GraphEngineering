#!/usr/bin/env python3
"""Temporary-path Python smoke for the durable SQLite CycleStore provider."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

from graph_engineering import SQLiteCycleStoreProvider, create_cycle_store_record

AUTHORIZATION = {
    "tenantId": "quickstart-tenant",
    "principalHash": "a" * 64,
    "authorizationHash": "b" * 64,
}
MISSING_TAIL = {"exists": False, "sequence": -1, "recordHash": None}


def mutation(operation_id: str) -> dict[str, Any]:
    return {**AUTHORIZATION, "operationId": operation_id}


async def main() -> None:
    with TemporaryDirectory(prefix="graph-engineering-sqlite-python-example-") as root:
        source_path = Path(root) / "cycle-store.db"
        backup_path = Path(root) / "cycle-store.backup.db"
        restored_path = Path(root) / "cycle-store.restored.db"
        provider = SQLiteCycleStoreProvider(source_path)
        restored: SQLiteCycleStoreProvider | None = None
        try:
            record = create_cycle_store_record(
                record_id="record-0",
                sequence=0,
                previous_record_hash=None,
                value={"status": "ready"},
            )
            append_request = {
                "context": mutation("append-record-0"),
                "streamId": "example-stream",
                "expectedTail": MISSING_TAIL,
                "lease": None,
                "records": [record],
            }
            appended = await provider.append(append_request)
            schema = await provider.inspect_schema(AUTHORIZATION)
            migration_lock = await provider.acquire_migration_lock(
                {
                    "context": mutation("migration-lock-acquire"),
                    "lockId": "migration-lock-example",
                    "ownerId": "operator-example",
                    "sourceSchemaVersion": 1,
                    "targetSchemaVersion": 2,
                    "ttlMs": 30_000,
                    "mode": "acquire",
                    "expectedFencingToken": 0,
                }
            )
            await provider.release_migration_lock(
                {
                    "context": mutation("migration-lock-release"),
                    "lockId": migration_lock["lockId"],
                    "ownerId": migration_lock["ownerId"],
                    "fencingToken": migration_lock["fencingToken"],
                }
            )
            source_audit = await provider.audit_integrity("semantic")
            backup = await provider.backup(backup_path)
            backup_integrity = backup.get("integrity")
            if not isinstance(backup_integrity, dict):
                raise TypeError("backup integrity report is missing")
            await provider.close()

            restored = await SQLiteCycleStoreProvider.restore_backup(
                backup_path,
                restored_path,
            )
            restored_tail = await restored.read_tail(
                {"context": AUTHORIZATION, "streamId": "example-stream"}
            )
            replay = await restored.append(append_request)
            restored_audit = await restored.audit_integrity("semantic")
            descriptor = await restored.describe()
            print(
                json.dumps(
                    {
                        "providerId": descriptor["providerId"],
                        "descriptorHash": schema["descriptorHash"],
                        "appendedRecords": appended["appendedRecords"],
                        "restoredTail": restored_tail,
                        "exactOperationReplay": replay == appended,
                        "sourceSemanticSha256": source_audit["semanticSha256"],
                        "backupSemanticSha256": backup_integrity["semanticSha256"],
                        "restoreSemanticSha256": restored_audit["semanticSha256"],
                        "backupManifestSha256": backup["manifestSha256"],
                    },
                    indent=2,
                    sort_keys=True,
                )
            )
        finally:
            await provider.close()
            if restored is not None:
                await restored.close()


if __name__ == "__main__":
    asyncio.run(main())
