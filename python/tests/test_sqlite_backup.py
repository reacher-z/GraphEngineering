from __future__ import annotations

import asyncio
import hashlib
import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any

import pytest

from graph_engineering.canonical import canonical_bytes
from graph_engineering.cycle_store_provider import (
    CycleStoreProviderError,
    create_cycle_store_record,
)
from graph_engineering.sqlite_cycle_store import (
    SQLITE_BACKUP_MANIFEST_DOMAIN,
    SQLiteCycleStoreProvider,
)

AUTH: dict[str, Any] = {
    "tenantId": "tenant-a",
    "principalHash": "a" * 64,
    "authorizationHash": "b" * 64,
}
MISSING = {"exists": False, "sequence": -1, "recordHash": None}

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
TYPESCRIPT_BACKUP_MODULE = REPOSITORY_ROOT / "packages/sqlite/dist/cycle-store-backup.js"
TYPESCRIPT_PROVIDER_MODULE = REPOSITORY_ROOT / "packages/sqlite/dist/sqlite-cycle-store.js"
NODE_BACKUP_INTEROP_READY = (
    shutil.which("node") is not None
    and TYPESCRIPT_BACKUP_MODULE.is_file()
    and TYPESCRIPT_PROVIDER_MODULE.is_file()
)

NODE_BACKUP_SCRIPT = r"""
import {
  createSQLiteCycleStoreBackup,
  restoreSQLiteCycleStoreBackup,
} from "./packages/sqlite/dist/cycle-store-backup.js";
import { SQLiteCycleStoreProvider } from "./packages/sqlite/dist/sqlite-cycle-store.js";
import { createCycleStoreRecord } from "./packages/runtime/dist/index.js";

const [mode, source, destination] = process.argv.slice(1);
const auth = {
  tenantId: "tenant-a",
  principalHash: "a".repeat(64),
  authorizationHash: "b".repeat(64),
};
const mutation = (operationId) => ({ ...auth, operationId });

if (mode === "create-backup") {
  const provider = new SQLiteCycleStoreProvider(source, {
    now: () => new Date("2026-07-27T00:00:00Z"),
  });
  try {
    const records = [];
    for (let sequence = 0; sequence < 3; sequence += 1) {
      records.push(createCycleStoreRecord({
        recordId: `ts-backup-${sequence}`,
        sequence,
        previousRecordHash: records.at(-1)?.recordHash ?? null,
        value: { sequence, source: "typescript" },
      }));
    }
    await provider.append({
      context: mutation("ts-backup-create"),
      streamId: "stream-a",
      expectedTail: { exists: false, sequence: -1, recordHash: null },
      lease: null,
      records,
    });
    const page = await provider.readEventPage({
      context: auth,
      streamId: "stream-a",
      fromSequence: 0,
      pageSize: 1,
      cursor: null,
    });
    const report = await createSQLiteCycleStoreBackup(source, destination);
    process.stdout.write(JSON.stringify({ report, cursor: page.nextCursor }));
  } finally {
    provider.close();
  }
} else if (mode === "restore-continue") {
  const report = await restoreSQLiteCycleStoreBackup(source, destination);
  const provider = new SQLiteCycleStoreProvider(destination, {
    now: () => new Date("2026-07-27T00:00:00Z"),
  });
  try {
    const tail = await provider.readTail({ context: auth, streamId: "stream-a" });
    const record = createCycleStoreRecord({
      recordId: "ts-after-restore",
      sequence: tail.sequence + 1,
      previousRecordHash: tail.recordHash,
      value: { sequence: tail.sequence + 1, source: "typescript-restore" },
    });
    const appended = await provider.append({
      context: mutation("ts-append-after-restore"),
      streamId: "stream-a",
      expectedTail: tail,
      lease: null,
      records: [record],
    });
    process.stdout.write(JSON.stringify({ report, tail, appended }));
  } finally {
    provider.close();
  }
} else {
  throw new Error("unknown backup interop mode");
}
"""


def run_typescript_backup(mode: str, source: Path, destination: Path) -> dict[str, Any]:
    completed = subprocess.run(
        [
            "node",
            "--input-type=module",
            "--no-warnings",
            "-e",
            NODE_BACKUP_SCRIPT,
            mode,
            str(source),
            str(destination),
        ],
        cwd=REPOSITORY_ROOT,
        check=False,
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert completed.returncode == 0, completed.stderr
    decoded = json.loads(completed.stdout)
    assert isinstance(decoded, dict)
    return decoded


def mutation(operation_id: str) -> dict[str, Any]:
    return {**AUTH, "operationId": operation_id}


async def expect_code(awaitable: Any, code: str) -> CycleStoreProviderError:
    with pytest.raises(CycleStoreProviderError) as caught:
        await awaitable
    assert caught.value.code == code
    return caught.value


def test_sqlite_online_backup_manifest_restore_and_continue(tmp_path: Path) -> None:
    async def scenario() -> None:
        source_path = tmp_path / "source.db"
        backup_path = tmp_path / "backup.db"
        restore_path = tmp_path / "restored.db"
        provider = SQLiteCycleStoreProvider(
            source_path,
            initial_time="2026-07-27T00:00:00Z",
        )
        records: list[dict[str, Any]] = []
        for sequence in range(3):
            records.append(
                create_cycle_store_record(
                    record_id=f"record-{sequence}",
                    sequence=sequence,
                    previous_record_hash=(
                        None if not records else str(records[-1]["recordHash"])
                    ),
                    value={"sequence": sequence},
                )
            )
        append_request = {
            "context": mutation("append-original"),
            "streamId": "stream-a",
            "expectedTail": MISSING,
            "lease": None,
            "records": records,
        }
        append_result = await provider.append(append_request)
        first_page = await provider.read_event_page(
            {
                "context": AUTH,
                "streamId": "stream-a",
                "fromSequence": 0,
                "pageSize": 1,
                "cursor": None,
            }
        )
        assert first_page["nextCursor"] is not None
        source_audit = await provider.audit_integrity("semantic")
        checkpoint = await provider.checkpoint_wal("PASSIVE")
        assert checkpoint["busy"] == 0

        report = await provider.backup(backup_path)
        manifest_path = Path(str(report["manifestPath"]))
        assert backup_path.is_file()
        assert manifest_path == Path(f"{backup_path}.manifest.json")
        assert manifest_path.is_file()
        assert report["integrity"]["semanticSha256"] == source_audit["semanticSha256"]
        assert report["integrity"]["counters"] == source_audit["counters"]
        assert report["sha256"] == hashlib.sha256(backup_path.read_bytes()).hexdigest()
        manifest_bytes = manifest_path.read_bytes()
        manifest = json.loads(manifest_bytes)
        assert canonical_bytes(manifest) == manifest_bytes
        manifest_hash = manifest.pop("manifestSha256")
        assert manifest_hash == hashlib.sha256(
            SQLITE_BACKUP_MANIFEST_DOMAIN.encode() + canonical_bytes(manifest)
        ).hexdigest()
        manifest["manifestSha256"] = manifest_hash
        assert report["manifestSha256"] == manifest_hash

        await expect_code(
            provider.backup(source_path),
            "GE_CYCLE_STORE_INVALID_ARGUMENT",
        )
        hardlink_alias = tmp_path / "source-hardlink.db"
        os.link(source_path, hardlink_alias)
        await expect_code(
            provider.backup(hardlink_alias),
            "GE_CYCLE_STORE_INVALID_ARGUMENT",
        )
        existing = tmp_path / "existing.db"
        existing.write_bytes(b"occupied")
        await expect_code(provider.backup(existing), "GE_CYCLE_STORE_CONFLICT")

        restored = await SQLiteCycleStoreProvider.restore_backup(
            backup_path,
            restore_path,
            report,
            initial_time="2026-07-27T00:00:00Z",
        )
        restored_audit = await restored.audit_integrity("semantic")
        assert restored_audit["semanticSha256"] == source_audit["semanticSha256"]
        assert restored_audit["counters"] == source_audit["counters"]
        assert await restored.append(append_request) == append_result
        continuation = await restored.read_event_page(
            {
                "context": AUTH,
                "streamId": "stream-a",
                "fromSequence": None,
                "pageSize": 1,
                "cursor": first_page["nextCursor"],
            }
        )
        assert continuation["records"][0]["sequence"] == 1
        fourth = create_cycle_store_record(
            record_id="record-3",
            sequence=3,
            previous_record_hash=str(records[-1]["recordHash"]),
            value={"sequence": 3},
        )
        await restored.append(
            {
                "context": mutation("append-restored"),
                "streamId": "stream-a",
                "expectedTail": append_result["tail"],
                "lease": None,
                "records": [fourth],
            }
        )
        await restored.close()

        tampered = json.loads(manifest_path.read_text(encoding="utf-8"))
        tampered["semantic"]["sha256"] = "0" * 64
        rejected_path = tmp_path / "rejected.db"
        await expect_code(
            SQLiteCycleStoreProvider.restore_backup(
                backup_path,
                rejected_path,
                tampered,
                initial_time="2026-07-27T00:00:00Z",
            ),
            "GE_CYCLE_STORE_CORRUPTION",
        )
        assert not rejected_path.exists()
        await provider.close()

    asyncio.run(scenario())


@pytest.mark.skipif(
    not NODE_BACKUP_INTEROP_READY,
    reason="built TypeScript SQLite modules and Node.js are required",
)
def test_sqlite_backup_restore_is_bidirectionally_interoperable(tmp_path: Path) -> None:
    python_source = tmp_path / "python-source.db"
    python_backup = tmp_path / "python-backup.db"

    async def create_python_backup() -> tuple[dict[str, Any], str]:
        provider = SQLiteCycleStoreProvider(
            python_source,
            initial_time="2026-07-27T00:00:00Z",
        )
        batch: list[dict[str, Any]] = []
        for sequence in range(3):
            batch.append(
                create_cycle_store_record(
                    record_id=f"py-backup-{sequence}",
                    sequence=sequence,
                    previous_record_hash=(
                        None if not batch else str(batch[-1]["recordHash"])
                    ),
                    value={"sequence": sequence, "source": "python"},
                )
            )
        await provider.append(
            {
                "context": mutation("py-backup-create"),
                "streamId": "stream-a",
                "expectedTail": MISSING,
                "lease": None,
                "records": batch,
            }
        )
        page = await provider.read_event_page(
            {
                "context": AUTH,
                "streamId": "stream-a",
                "fromSequence": 0,
                "pageSize": 1,
                "cursor": None,
            }
        )
        report = await provider.backup(python_backup)
        await provider.close()
        return report, str(page["nextCursor"])

    python_report, _python_cursor = asyncio.run(create_python_backup())
    typescript_restored = run_typescript_backup(
        "restore-continue",
        python_backup,
        tmp_path / "typescript-restored.db",
    )
    assert (
        typescript_restored["report"]["sourceManifestSha256"]
        == python_report["manifestSha256"]
    )
    assert (
        typescript_restored["report"]["integrity"]["semanticSha256"]
        == python_report["integrity"]["semanticSha256"]
    )
    assert typescript_restored["tail"]["sequence"] == 2
    assert typescript_restored["appended"]["tail"]["sequence"] == 3

    typescript_source = tmp_path / "typescript-source.db"
    typescript_backup = tmp_path / "typescript-backup.db"
    typescript_created = run_typescript_backup(
        "create-backup",
        typescript_source,
        typescript_backup,
    )
    typescript_report = typescript_created["report"]
    source_manifest = json.loads(
        Path(str(typescript_report["manifestPath"])).read_text(encoding="utf-8")
    )
    assert source_manifest["manifestSha256"] == typescript_report["manifestSha256"]

    async def restore_typescript_backup_with_python() -> None:
        restored = await SQLiteCycleStoreProvider.restore_backup(
            typescript_backup,
            tmp_path / "python-restored.db",
            initial_time="2026-07-27T00:00:00Z",
        )
        audit = await restored.audit_integrity("semantic")
        assert audit["semanticSha256"] == typescript_report["integrity"][
            "semanticSha256"
        ]
        assert audit["counters"] == typescript_report["integrity"]["counters"]
        continuation = await restored.read_event_page(
            {
                "context": AUTH,
                "streamId": "stream-a",
                "fromSequence": None,
                "pageSize": 1,
                "cursor": typescript_created["cursor"],
            }
        )
        assert continuation["records"][0]["sequence"] == 1
        tail = await restored.read_tail({"context": AUTH, "streamId": "stream-a"})
        fourth = create_cycle_store_record(
            record_id="py-after-ts-restore",
            sequence=3,
            previous_record_hash=str(tail["recordHash"]),
            value={"sequence": 3, "source": "python-restore"},
        )
        appended = await restored.append(
            {
                "context": mutation("py-append-after-ts-restore"),
                "streamId": "stream-a",
                "expectedTail": tail,
                "lease": None,
                "records": [fourth],
            }
        )
        assert appended["tail"]["sequence"] == 3
        await restored.close()

    asyncio.run(restore_typescript_backup_with_python())
