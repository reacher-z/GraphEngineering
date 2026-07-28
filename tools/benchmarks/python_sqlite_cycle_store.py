"""Raw, reproducible characterization of the native Python SQLite CycleStore.

This script deliberately emits observations rather than a release threshold.
It exercises only public provider operations for workload behavior. Direct
read-only SQLite connections are limited to environment and query-plan
inspection, where the database itself is the object being characterized.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import os
import platform
import shutil
import sqlite3
import sys
import tempfile
import time
from collections.abc import Awaitable, Callable, Sequence
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, NoReturn

from graph_engineering import (
    CycleStoreProviderError,
    SQLiteCycleStoreProvider,
    create_cycle_store_checkpoint,
    create_cycle_store_record,
)

AUTHORIZATION = {
    "tenantId": "benchmark-tenant",
    "principalHash": "a" * 64,
    "authorizationHash": "b" * 64,
}
MISSING_TAIL = {"exists": False, "sequence": -1, "recordHash": None}
PROVIDER_OPTIONS = {
    "busy_timeout_ms": 250,
    "busy_retry_attempts": 3,
    "busy_retry_elapsed_ms": 1_500,
    "wal_autocheckpoint": 1_000,
}
REPORT_API_VERSION = (
    "graphengineering.reacher-z.github.io/python-sqlite-cycle-store-benchmarks/v1alpha1"
)
SCRIPT_PATH = Path(__file__).resolve()
WORKER_TIMEOUT_SECONDS = 30
CONTENTION_CLOCK = "2026-07-27T00:00:00Z"


class BenchmarkFailure(RuntimeError):
    """Closed benchmark failure with no workload payloads."""


def fail(message: str) -> NoReturn:
    raise BenchmarkFailure(f"Python SQLite CycleStore benchmark: {message}")


def checked_integer(value: int, minimum: int, maximum: int, label: str) -> int:
    if type(value) is not int or value < minimum or value > maximum:
        fail(f"{label} must be an integer between {minimum} and {maximum}")
    return value


def positive_integer(argument: str) -> int:
    try:
        value = int(argument)
    except ValueError:
        raise argparse.ArgumentTypeError("expected an integer") from None
    if value < 1:
        raise argparse.ArgumentTypeError("expected an integer greater than zero")
    return value


def nonnegative_integer(argument: str) -> int:
    try:
        value = int(argument)
    except ValueError:
        raise argparse.ArgumentTypeError("expected an integer") from None
    if value < 0:
        raise argparse.ArgumentTypeError("expected a nonnegative integer")
    return value


def parse_options(arguments: Sequence[str]) -> dict[str, Any]:
    parser = argparse.ArgumentParser(
        description="Characterize the native Python SQLite CycleStore provider",
        allow_abbrev=False,
    )
    parser.add_argument("--quick", action="store_true")
    parser.add_argument("--samples", type=positive_integer)
    parser.add_argument("--warmup", type=nonnegative_integer)
    parser.add_argument("--expensive-samples", type=positive_integer)
    parser.add_argument("--contention-samples", type=positive_integer)
    parser.add_argument("--contention-operations", type=positive_integer)
    parsed = parser.parse_args(arguments)
    quick = bool(parsed.quick)
    samples = checked_integer(
        parsed.samples if parsed.samples is not None else (2 if quick else 20),
        1,
        1_000,
        "samples",
    )
    warmup = checked_integer(
        parsed.warmup if parsed.warmup is not None else (0 if quick else 5),
        0,
        1_000,
        "warmup",
    )
    expensive_samples = checked_integer(
        (
            parsed.expensive_samples
            if parsed.expensive_samples is not None
            else (1 if quick else 5)
        ),
        1,
        100,
        "expensive samples",
    )
    contention_samples = checked_integer(
        (
            parsed.contention_samples
            if parsed.contention_samples is not None
            else (1 if quick else 5)
        ),
        1,
        100,
        "contention samples",
    )
    contention_operations = checked_integer(
        (
            parsed.contention_operations
            if parsed.contention_operations is not None
            else (2 if quick else 25)
        ),
        1,
        1_000,
        "contention operations",
    )
    return {
        "quick": quick,
        "samples": samples,
        "warmup": warmup,
        "expensiveSamples": expensive_samples,
        "contentionSamples": contention_samples,
        "contentionOperations": contention_operations,
        "auditRecordTargets": [128, 1_024] if quick else [10_000, 100_000],
    }


class StrictBenchmarkClock:
    """Return millisecond timestamps that strictly advance for lease renewal."""

    def __init__(self) -> None:
        self._last_epoch_ms = int(time.time() * 1_000) - 1

    def __call__(self) -> datetime:
        candidate = int(time.time() * 1_000)
        self._last_epoch_ms = max(candidate, self._last_epoch_ms + 1)
        return datetime.fromtimestamp(self._last_epoch_ms / 1_000, tz=UTC)


def mutation(operation_id: str) -> dict[str, Any]:
    return {**AUTHORIZATION, "operationId": operation_id}


def records(
    prefix: str,
    count: int,
    start_sequence: int = 0,
    previous_record_hash: str | None = None,
) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    previous = previous_record_hash
    for offset in range(count):
        sequence = start_sequence + offset
        record = create_cycle_store_record(
            record_id=f"{prefix}-{sequence}",
            sequence=sequence,
            previous_record_hash=previous,
            value={"benchmark": prefix, "sequence": sequence},
        )
        result.append(record)
        previous = str(record["recordHash"])
    return result


def rounded(value: float) -> float:
    return round(value, 3)


def percentile(sorted_samples: Sequence[float], proportion: float) -> float:
    if not sorted_samples:
        fail("cannot calculate a percentile without samples")
    rank = max(0, math.ceil(proportion * len(sorted_samples)) - 1)
    return sorted_samples[min(rank, len(sorted_samples) - 1)]


def summarize(
    name: str,
    category: str,
    raw_samples: Sequence[float],
    storage_after: dict[str, int],
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    samples = [rounded(sample) for sample in raw_samples]
    ordered = sorted(samples)
    return {
        "name": name,
        "category": category,
        "unit": "milliseconds",
        "percentileMethod": "nearest-rank",
        "sampleCount": len(samples),
        "rawSamples": samples,
        "p50": percentile(ordered, 0.50),
        "p95": percentile(ordered, 0.95),
        "p99": percentile(ordered, 0.99),
        "storageAfter": storage_after,
        "metadata": metadata or {},
    }


async def measured_samples(
    count: int,
    warmup: int,
    action: Callable[[int, bool], Awaitable[None]],
) -> list[float]:
    for index in range(warmup):
        await action(index, True)
    samples: list[float] = []
    for index in range(count):
        started_ns = time.perf_counter_ns()
        await action(index, False)
        samples.append((time.perf_counter_ns() - started_ns) / 1_000_000)
    return samples


def size_or_zero(path: Path) -> int:
    try:
        return path.stat().st_size
    except FileNotFoundError:
        return 0


def storage_sizes(path: Path) -> dict[str, int]:
    return {
        "databaseBytes": size_or_zero(path),
        "walBytes": size_or_zero(Path(f"{path}-wal")),
        "sharedMemoryBytes": size_or_zero(Path(f"{path}-shm")),
    }


def read_only_connection(path: Path) -> sqlite3.Connection:
    if not path.is_file():
        fail("SQLite inspection database does not exist")
    connection = sqlite3.connect(
        f"file:{path.as_posix()}?mode=ro",
        uri=True,
        isolation_level=None,
        timeout=PROVIDER_OPTIONS["busy_timeout_ms"] / 1_000,
    )
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA trusted_schema = OFF")
    connection.execute("PRAGMA synchronous = FULL")
    connection.execute("PRAGMA wal_autocheckpoint = 1000")
    connection.execute("PRAGMA writable_schema = OFF")
    connection.execute("PRAGMA query_only = ON")
    connection.execute("PRAGMA busy_timeout = 250")
    return connection


def pragma_scalar(connection: sqlite3.Connection, name: str) -> Any:
    row = connection.execute(f"PRAGMA {name}").fetchone()
    if row is None or len(row) != 1:
        fail(f"PRAGMA {name} returned an unexpected shape")
    return row[0]


def sqlite_environment(path: Path) -> dict[str, Any]:
    connection = read_only_connection(path)
    try:
        synchronous = int(pragma_scalar(connection, "synchronous"))
        return {
            "moduleVersion": sqlite3.version,
            "runtimeVersion": sqlite3.sqlite_version,
            "threadSafety": sqlite3.threadsafety,
            "settings": {
                "journalMode": str(pragma_scalar(connection, "journal_mode")).lower(),
                "synchronous": synchronous,
                "synchronousName": "FULL" if synchronous == 2 else "unexpected",
                "foreignKeys": int(pragma_scalar(connection, "foreign_keys")),
                "trustedSchema": int(pragma_scalar(connection, "trusted_schema")),
                "writableSchema": int(pragma_scalar(connection, "writable_schema")),
                "queryOnly": int(pragma_scalar(connection, "query_only")),
                "walAutocheckpointPages": int(
                    pragma_scalar(connection, "wal_autocheckpoint")
                ),
                "busyTimeoutMs": int(pragma_scalar(connection, "busy_timeout")),
            },
            "database": {
                "applicationId": int(pragma_scalar(connection, "application_id")),
                "userVersion": int(pragma_scalar(connection, "user_version")),
                "pageSizeBytes": int(pragma_scalar(connection, "page_size")),
                "pageCount": int(pragma_scalar(connection, "page_count")),
                "freelistPages": int(pragma_scalar(connection, "freelist_count")),
                "files": storage_sizes(path),
            },
        }
    finally:
        connection.close()


def filesystem_environment(root: Path) -> dict[str, int]:
    status = os.statvfs(root)
    inode = root.stat()
    return {
        "deviceId": int(inode.st_dev),
        "blockSizeBytes": int(status.f_bsize),
        "fragmentSizeBytes": int(status.f_frsize),
        "blocks": int(status.f_blocks),
        "availableBlocks": int(status.f_bavail),
    }


def query_plan_assertions(path: Path) -> list[dict[str, Any]]:
    checks: tuple[tuple[str, str, str, tuple[Any, ...]], ...] = (
        (
            "tenant-stream-tail",
            "PRIMARY KEY",
            (
                "EXPLAIN QUERY PLAN SELECT tail_sequence, tail_record_hash "
                "FROM ge_cycle_streams WHERE tenant_id = ? AND stream_id = ?"
            ),
            (AUTHORIZATION["tenantId"], "query-plan-stream"),
        ),
        (
            "record-range",
            "PRIMARY KEY",
            (
                "EXPLAIN QUERY PLAN SELECT record_blob FROM ge_cycle_records "
                "WHERE tenant_id = ? AND stream_id = ? AND sequence >= ? AND sequence <= ? "
                "ORDER BY sequence"
            ),
            (AUTHORIZATION["tenantId"], "query-plan-stream", 0, 255),
        ),
        (
            "operation-id",
            "PRIMARY KEY",
            (
                "EXPLAIN QUERY PLAN SELECT operation_name, request_hash, result_blob, "
                "result_hash FROM ge_cycle_operations WHERE tenant_id = ? AND operation_id = ?"
            ),
            (AUTHORIZATION["tenantId"], "query-plan-operation"),
        ),
        (
            "checkpoint-order",
            "ge_cycle_checkpoints_order_idx",
            (
                "EXPLAIN QUERY PLAN SELECT summary_blob FROM ge_cycle_checkpoints "
                "WHERE tenant_id = ? AND checkpoint_scope = ? "
                "ORDER BY bound_sequence DESC, created_at DESC, checkpoint_id ASC"
            ),
            (AUTHORIZATION["tenantId"], "query-plan-scope"),
        ),
        (
            "lease",
            "PRIMARY KEY",
            (
                "EXPLAIN QUERY PLAN SELECT active_lease_id, active_fencing_token "
                "FROM ge_cycle_leases WHERE tenant_id = ? AND stream_id = ?"
            ),
            (AUTHORIZATION["tenantId"], "query-plan-stream"),
        ),
        (
            "legal-hold",
            "ge_cycle_holds_lookup_idx",
            (
                "EXPLAIN QUERY PLAN SELECT hold_id FROM ge_cycle_legal_holds "
                "WHERE tenant_id = ? AND stream_id = ? ORDER BY placed_at_ms, hold_id"
            ),
            (AUTHORIZATION["tenantId"], "query-plan-stream"),
        ),
        (
            "cursor-token",
            "PRIMARY KEY",
            (
                "EXPLAIN QUERY PLAN SELECT kind, expires_at_ms, consumed_at_ms "
                "FROM ge_cycle_cursors WHERE tenant_id = ? AND token_hash = ?"
            ),
            (AUTHORIZATION["tenantId"], "0" * 64),
        ),
        (
            "cursor-expiry",
            "ge_cycle_cursors_expiry_idx",
            (
                "EXPLAIN QUERY PLAN SELECT tenant_id, token_hash FROM ge_cycle_cursors "
                "WHERE expires_at_ms <= ? "
                "ORDER BY expires_at_ms, tenant_id, token_hash LIMIT 64"
            ),
            (0,),
        ),
        (
            "migration-lock",
            "INTEGER PRIMARY KEY",
            (
                "EXPLAIN QUERY PLAN SELECT active_lock_id, active_fencing_token "
                "FROM ge_cycle_migration_lock WHERE singleton = 1"
            ),
            (),
        ),
        (
            "migration-fence",
            "ge_cycle_used_migration_lock_ids_fence_uq",
            (
                "EXPLAIN QUERY PLAN SELECT lock_id FROM ge_cycle_used_migration_lock_ids "
                "WHERE fencing_token = ?"
            ),
            (1,),
        ),
    )
    connection = read_only_connection(path)
    try:
        reports: list[dict[str, Any]] = []
        for name, expected, sql, parameters in checks:
            details = [
                str(row[3]) for row in connection.execute(sql, parameters).fetchall()
            ]
            if not any(expected in detail for detail in details):
                fail(f"hot query {name} did not use {expected}")
            if any(
                "SCAN " in detail or "USE TEMP B-TREE" in detail for detail in details
            ):
                fail(
                    f"hot query {name} used an unbounded scan or temporary ordering tree"
                )
            reports.append(
                {"name": name, "expectedAccessPath": expected, "details": details}
            )
        return reports
    finally:
        connection.close()


async def append_batch(
    provider: SQLiteCycleStoreProvider,
    stream_id: str,
    operation_id: str,
    batch: Sequence[dict[str, Any]],
    expected_tail: dict[str, Any],
) -> dict[str, Any]:
    return await provider.append(
        {
            "context": mutation(operation_id),
            "streamId": stream_id,
            "expectedTail": expected_tail,
            "lease": None,
            "records": list(batch),
        }
    )


async def grow_stream(
    provider: SQLiteCycleStoreProvider,
    stream_id: str,
    target: int,
    state: dict[str, Any],
) -> None:
    while int(state["count"]) < target:
        count = min(64, target - int(state["count"]))
        tail = state["tail"]
        if not isinstance(tail, dict):
            fail("stream growth tail state is invalid")
        batch = records(
            stream_id,
            count,
            int(state["count"]),
            tail.get("recordHash"),
        )
        appended = await append_batch(
            provider,
            stream_id,
            f"grow-{stream_id}-{state['count']}",
            batch,
            tail,
        )
        state["count"] = int(state["count"]) + count
        state["tail"] = appended["tail"]


async def child_process_json(arguments: Sequence[str]) -> dict[str, Any]:
    process = await asyncio.create_subprocess_exec(
        sys.executable,
        str(SCRIPT_PATH),
        *arguments,
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, stderr = await asyncio.wait_for(
            process.communicate(), timeout=WORKER_TIMEOUT_SECONDS
        )
    except TimeoutError:
        process.kill()
        await process.wait()
        fail("contention worker exceeded its bounded timeout")
    if process.returncode != 0:
        message = stderr.decode("utf-8", errors="replace")[-4_096:]
        fail(f"contention worker exited with {process.returncode}: {message}")
    try:
        decoded = json.loads(stdout)
    except (UnicodeDecodeError, json.JSONDecodeError):
        fail("contention worker returned invalid JSON")
    if type(decoded) is not dict:
        fail("contention worker result is not an object")
    return decoded


async def run_contention_sample(
    path: Path,
    writers: int,
    operations: int,
    sample: int,
) -> dict[str, Any]:
    bootstrap = SQLiteCycleStoreProvider(
        path, initial_time=CONTENTION_CLOCK, **PROVIDER_OPTIONS
    )
    await bootstrap.close()
    started_ns = time.perf_counter_ns()
    results = await asyncio.gather(
        *(
            child_process_json(
                (
                    "--worker",
                    str(path),
                    str(writer),
                    str(operations),
                    str(sample),
                )
            )
            for writer in range(writers)
        )
    )
    operation_samples = [
        float(operation_sample)
        for result in results
        for operation_sample in result["operationSamples"]
    ]
    return {
        "elapsedMs": (time.perf_counter_ns() - started_ns) / 1_000_000,
        "operationSamples": operation_samples,
        "completedOperations": sum(
            int(result["completedOperations"]) for result in results
        ),
        "exhaustedOperations": sum(
            int(result["exhaustedOperations"]) for result in results
        ),
        "exhaustedTransactionAttempts": sum(
            int(result["exhaustedTransactionAttempts"]) for result in results
        ),
    }


async def worker_main(arguments: Sequence[str]) -> None:
    if len(arguments) != 4:
        fail("worker requires database path, writer, operation count, and sample")
    path_text, writer_text, operations_text, sample_text = arguments
    if not path_text or "\0" in path_text:
        fail("worker path is invalid")
    try:
        writer = checked_integer(int(writer_text), 0, 63, "worker index")
        operations = checked_integer(
            int(operations_text), 1, 1_000, "worker operations"
        )
        sample = checked_integer(int(sample_text), 0, 10_000, "worker sample")
    except ValueError:
        fail("worker numeric argument is invalid")
    provider = SQLiteCycleStoreProvider(
        Path(path_text), initial_time=CONTENTION_CLOCK, **PROVIDER_OPTIONS
    )
    operation_samples: list[float] = []
    completed_operations = 0
    exhausted_operations = 0
    exhausted_transaction_attempts = 0
    try:
        for index in range(operations):
            stream_id = f"contention-{sample}-{writer}-{index}"
            batch = records(stream_id, 1)
            started_ns = time.perf_counter_ns()
            try:
                await append_batch(
                    provider,
                    stream_id,
                    f"contention-{sample}-{writer}-{index}",
                    batch,
                    MISSING_TAIL,
                )
                completed_operations += 1
            except CycleStoreProviderError as error:
                if error.code != "GE_CYCLE_STORE_UNAVAILABLE":
                    raise
                exhausted_operations += 1
                attempt_count = error.details.get("attemptCount", 0)
                if type(attempt_count) is int and attempt_count > 0:
                    exhausted_transaction_attempts += attempt_count
            operation_samples.append(
                rounded((time.perf_counter_ns() - started_ns) / 1_000_000)
            )
    finally:
        await provider.close()
    print(
        json.dumps(
            {
                "operationSamples": operation_samples,
                "completedOperations": completed_operations,
                "exhaustedOperations": exhausted_operations,
                "exhaustedTransactionAttempts": exhausted_transaction_attempts,
            },
            separators=(",", ":"),
            sort_keys=True,
        )
    )


async def benchmark_main(arguments: Sequence[str]) -> None:
    options = parse_options(arguments)
    root = Path(tempfile.mkdtemp(prefix="graph-engineering-python-sqlite-benchmark-"))
    database_path = root / "benchmark.db"
    provider: SQLiteCycleStoreProvider | None = None
    report: dict[str, Any] | None = None
    try:
        provider = SQLiteCycleStoreProvider(
            database_path,
            now=StrictBenchmarkClock(),
            **PROVIDER_OPTIONS,
        )
        benchmarks: list[dict[str, Any]] = []
        retry_accounting = {
            "clientOperationRetries": 0,
            "exhaustedOperations": 0,
            "exhaustedTransactionAttempts": 0,
            "successfulProviderInternalRetries": None,
            "successfulProviderInternalRetriesReason": (
                "The safe public Python adapter does not expose successful transaction "
                "retry internals; only typed exhaustion attempt counts are observable."
            ),
        }
        query_plans = query_plan_assertions(database_path)
        identifier = 0

        single_fixtures: list[dict[str, Any]] = []
        for _ in range(int(options["samples"]) + int(options["warmup"])):
            current = identifier
            identifier += 1
            stream_id = f"single-{current}"
            single_fixtures.append(
                {
                    "streamId": stream_id,
                    "operationId": f"single-{current}",
                    "batch": records(stream_id, 1),
                }
            )
        single_index = 0

        async def single_action(_index: int, _warmup: bool) -> None:
            nonlocal single_index
            fixture = single_fixtures[single_index]
            single_index += 1
            await append_batch(
                provider,
                fixture["streamId"],
                fixture["operationId"],
                fixture["batch"],
                MISSING_TAIL,
            )

        one_record = await measured_samples(
            int(options["samples"]), int(options["warmup"]), single_action
        )
        benchmarks.append(
            summarize(
                "single-record-append",
                "single-record-append",
                one_record,
                storage_sizes(database_path),
                {"recordsPerTransaction": 1, "fixtureConstructionInsideTimer": False},
            )
        )

        batch_fixtures: list[dict[str, Any]] = []
        for _ in range(int(options["samples"]) + int(options["warmup"])):
            current = identifier
            identifier += 1
            stream_id = f"batch64-{current}"
            batch_fixtures.append(
                {
                    "streamId": stream_id,
                    "operationId": f"batch64-{current}",
                    "batch": records(stream_id, 64),
                }
            )
        batch_index = 0

        async def batch_action(_index: int, _warmup: bool) -> None:
            nonlocal batch_index
            fixture = batch_fixtures[batch_index]
            batch_index += 1
            await append_batch(
                provider,
                fixture["streamId"],
                fixture["operationId"],
                fixture["batch"],
                MISSING_TAIL,
            )

        sixty_four_records = await measured_samples(
            int(options["samples"]), int(options["warmup"]), batch_action
        )
        benchmarks.append(
            summarize(
                "sixty-four-record-append",
                "64-record-append",
                sixty_four_records,
                storage_sizes(database_path),
                {"recordsPerTransaction": 64, "fixtureConstructionInsideTimer": False},
            )
        )

        for writers in (1, 2, 4):
            contention_path = root / f"contention-{writers}.db"
            raw_samples: list[float] = []
            operation_samples: list[float] = []
            completed_operations = 0
            exhausted_operations = 0
            exhausted_transaction_attempts = 0
            for sample in range(int(options["contentionSamples"])):
                result = await run_contention_sample(
                    contention_path,
                    writers,
                    int(options["contentionOperations"]),
                    sample,
                )
                raw_samples.append(float(result["elapsedMs"]))
                operation_samples.extend(result["operationSamples"])
                completed_operations += int(result["completedOperations"])
                exhausted_operations += int(result["exhaustedOperations"])
                exhausted_transaction_attempts += int(
                    result["exhaustedTransactionAttempts"]
                )
            retry_accounting["exhaustedOperations"] += exhausted_operations
            retry_accounting["exhaustedTransactionAttempts"] += (
                exhausted_transaction_attempts
            )
            benchmarks.append(
                summarize(
                    f"{writers}-writer-contention-campaign",
                    "local-writer-contention",
                    raw_samples,
                    storage_sizes(contention_path),
                    {
                        "writers": writers,
                        "operatingSystemProcesses": writers,
                        "operationsPerWriterPerSample": int(
                            options["contentionOperations"]
                        ),
                        "contentionSamples": int(options["contentionSamples"]),
                        "completedOperations": completed_operations,
                        "exhaustedOperations": exhausted_operations,
                        "exhaustedTransactionAttempts": exhausted_transaction_attempts,
                        "operationRawSamplesMilliseconds": operation_samples,
                    },
                )
            )

        tail_stream = "tail-read-stream"
        await append_batch(
            provider,
            tail_stream,
            "tail-read-setup",
            records(tail_stream, 1),
            MISSING_TAIL,
        )

        async def tail_action(_index: int, _warmup: bool) -> None:
            tail = await provider.read_tail(
                {"context": AUTHORIZATION, "streamId": tail_stream}
            )
            if tail["exists"] is not True or tail["sequence"] != 0:
                fail("tail read benchmark returned an unexpected tail")

        tail_reads = await measured_samples(
            int(options["samples"]), int(options["warmup"]), tail_action
        )
        benchmarks.append(
            summarize(
                "tail-read", "tail-read", tail_reads, storage_sizes(database_path)
            )
        )

        page_stream = "page-read-stream"
        page_state: dict[str, Any] = {"count": 0, "tail": MISSING_TAIL}
        await grow_stream(provider, page_stream, 256, page_state)

        async def page_action(_index: int, _warmup: bool) -> None:
            page = await provider.read_event_page(
                {
                    "context": AUTHORIZATION,
                    "streamId": page_stream,
                    "fromSequence": 0,
                    "pageSize": 256,
                    "cursor": None,
                }
            )
            if len(page["records"]) != 256 or page["nextCursor"] is not None:
                fail("256-record page returned an unexpected shape")

        page_reads = await measured_samples(
            int(options["samples"]), int(options["warmup"]), page_action
        )
        benchmarks.append(
            summarize(
                "two-hundred-fifty-six-record-page",
                "256-record-page",
                page_reads,
                storage_sizes(database_path),
                {"pageSize": 256},
            )
        )

        checkpoint_fixtures: list[dict[str, Any]] = []
        checkpoint_epoch = datetime(2026, 7, 27, tzinfo=UTC)
        for _ in range(int(options["samples"]) + int(options["warmup"])):
            current = identifier
            identifier += 1
            checkpoint_fixtures.append(
                {
                    "operationId": f"checkpoint-save-{current}",
                    "checkpoint": create_cycle_store_checkpoint(
                        checkpoint_scope="benchmark-scope",
                        checkpoint_id=f"checkpoint-{current}",
                        stream_id=page_stream,
                        bound_sequence=int(page_state["tail"]["sequence"]),
                        bound_record_hash=str(page_state["tail"]["recordHash"]),
                        created_at=(checkpoint_epoch + timedelta(milliseconds=current))
                        .isoformat(timespec="milliseconds")
                        .replace("+00:00", "Z"),
                        value={"benchmark": "checkpoint", "current": current},
                    ),
                }
            )
        checkpoint_index = 0

        async def checkpoint_save_action(_index: int, _warmup: bool) -> None:
            nonlocal checkpoint_index
            fixture = checkpoint_fixtures[checkpoint_index]
            checkpoint_index += 1
            await provider.save_checkpoint(
                {
                    "context": mutation(fixture["operationId"]),
                    "checkpoint": fixture["checkpoint"],
                    "lease": None,
                }
            )

        checkpoint_saves = await measured_samples(
            int(options["samples"]),
            int(options["warmup"]),
            checkpoint_save_action,
        )
        benchmarks.append(
            summarize(
                "checkpoint-save",
                "checkpoint-save-load",
                checkpoint_saves,
                storage_sizes(database_path),
                {"fixtureConstructionInsideTimer": False},
            )
        )
        load_checkpoint_id = checkpoint_fixtures[-1]["checkpoint"]["checkpointId"]

        async def checkpoint_load_action(_index: int, _warmup: bool) -> None:
            checkpoint = await provider.load_checkpoint(
                {
                    "context": AUTHORIZATION,
                    "checkpointScope": "benchmark-scope",
                    "checkpointId": load_checkpoint_id,
                }
            )
            if checkpoint is None:
                fail("checkpoint load benchmark lost its fixture")

        checkpoint_loads = await measured_samples(
            int(options["samples"]),
            int(options["warmup"]),
            checkpoint_load_action,
        )
        benchmarks.append(
            summarize(
                "checkpoint-load",
                "checkpoint-save-load",
                checkpoint_loads,
                storage_sizes(database_path),
            )
        )

        lease_stream = "lease-renew-stream"
        await append_batch(
            provider,
            lease_stream,
            "lease-stream-setup",
            records(lease_stream, 1),
            MISSING_TAIL,
        )
        lease = await provider.acquire_lease(
            {
                "context": mutation("lease-acquire-setup"),
                "streamId": lease_stream,
                "leaseId": "benchmark-lease",
                "holderId": "benchmark-holder",
                "ttlMs": 60_000,
                "mode": "acquire",
                "expectedFencingToken": 0,
            }
        )

        async def lease_action(_index: int, _warmup: bool) -> None:
            nonlocal identifier, lease
            current = identifier
            identifier += 1
            lease = await provider.renew_lease(
                {
                    "context": mutation(f"lease-renew-{current}"),
                    "streamId": lease_stream,
                    "lease": {
                        "leaseId": lease["leaseId"],
                        "holderId": lease["holderId"],
                        "fencingToken": lease["fencingToken"],
                    },
                    "ttlMs": 60_000,
                }
            )

        lease_renewals = await measured_samples(
            int(options["samples"]), int(options["warmup"]), lease_action
        )
        benchmarks.append(
            summarize(
                "lease-renew",
                "lease-renew",
                lease_renewals,
                storage_sizes(database_path),
            )
        )

        audit_path = root / "semantic-audit.db"
        audit_provider = SQLiteCycleStoreProvider(
            audit_path,
            now=StrictBenchmarkClock(),
            **PROVIDER_OPTIONS,
        )
        audit_state: dict[str, Any] = {"count": 0, "tail": MISSING_TAIL}
        try:
            for target_index, target in enumerate(options["auditRecordTargets"]):
                await grow_stream(
                    audit_provider, "semantic-audit-stream", int(target), audit_state
                )
                last_audit: dict[str, Any] | None = None

                async def audit_action(
                    _index: int,
                    _warmup: bool,
                    expected_records: int = int(target),
                ) -> None:
                    nonlocal last_audit
                    last_audit = await audit_provider.audit_integrity("semantic")
                    if (
                        last_audit["level"] != "semantic"
                        or last_audit["integrityCheck"] != "ok"
                        or last_audit["counters"]["records"] != expected_records
                    ):
                        fail("semantic audit benchmark returned an unexpected result")

                audit_samples = await measured_samples(
                    int(options["expensiveSamples"]), 0, audit_action
                )
                if last_audit is None:
                    fail("semantic audit benchmark did not execute")
                benchmarks.append(
                    summarize(
                        f"{target}-record-semantic-audit",
                        (
                            "10K-record-semantic-audit"
                            if target_index == 0
                            else "100K-record-semantic-audit"
                        ),
                        audit_samples,
                        storage_sizes(audit_path),
                        {
                            "configuredTarget": 10_000
                            if target_index == 0
                            else 100_000,
                            "actualRecords": target,
                            "quickModeScaleDown": bool(options["quick"]),
                            "semanticSha256": last_audit["semanticSha256"],
                        },
                    )
                )
        finally:
            await audit_provider.close()

        source_integrity = await provider.audit_integrity("semantic")
        source_semantic_sha256 = str(source_integrity["semanticSha256"])
        source_tail = await provider.read_tail(
            {"context": AUTHORIZATION, "streamId": page_stream}
        )
        backup_samples: list[float] = []
        retained_backup: Path | None = None
        retained_backup_report: dict[str, Any] | None = None
        for sample in range(int(options["expensiveSamples"])):
            destination = root / f"backup-{sample}.db"
            started_ns = time.perf_counter_ns()
            backup_report = await provider.backup(destination)
            backup_samples.append((time.perf_counter_ns() - started_ns) / 1_000_000)
            backup_integrity = backup_report.get("integrity")
            if (
                type(backup_integrity) is not dict
                or backup_integrity.get("semanticSha256") != source_semantic_sha256
            ):
                fail("online backup semantic identity drifted")
            retained_backup = destination
            retained_backup_report = backup_report
        if retained_backup is None or retained_backup_report is None:
            fail("online backup benchmark did not execute")
        manifest_path = Path(str(retained_backup_report["manifestPath"]))
        benchmarks.append(
            summarize(
                "online-backup",
                "online-backup",
                backup_samples,
                storage_sizes(database_path),
                {
                    "backupStorage": storage_sizes(retained_backup),
                    "manifestBytes": size_or_zero(manifest_path),
                    "sourceSemanticSha256": source_semantic_sha256,
                    "backupSemanticSha256": retained_backup_report["integrity"][
                        "semanticSha256"
                    ],
                    "semanticIdentityMatched": True,
                },
            )
        )

        restore_samples: list[float] = []
        retained_restore: Path | None = None
        restored_semantic_sha256: str | None = None
        for sample in range(int(options["expensiveSamples"])):
            destination = root / f"restore-{sample}.db"
            started_ns = time.perf_counter_ns()
            restored = await SQLiteCycleStoreProvider.restore_backup(
                retained_backup,
                destination,
                now=StrictBenchmarkClock(),
                **PROVIDER_OPTIONS,
            )
            try:
                restored_tail = await restored.read_tail(
                    {"context": AUTHORIZATION, "streamId": page_stream}
                )
                restored_integrity = await restored.audit_integrity("semantic")
                restored_semantic_sha256 = str(restored_integrity["semanticSha256"])
                if (
                    restored_tail != source_tail
                    or restored_semantic_sha256 != source_semantic_sha256
                ):
                    fail("restored database verification drifted from the source")
            finally:
                await restored.close()
            restore_samples.append((time.perf_counter_ns() - started_ns) / 1_000_000)
            retained_restore = destination
        if retained_restore is None or restored_semantic_sha256 is None:
            fail("restore verification benchmark did not execute")
        benchmarks.append(
            summarize(
                "restore-verification",
                "restore-verification",
                restore_samples,
                storage_sizes(retained_restore),
                {
                    "includesManifestAndSemanticVerification": True,
                    "includesPublicTailAndSemanticAudit": True,
                    "sourceSemanticSha256": source_semantic_sha256,
                    "restoredSemanticSha256": restored_semantic_sha256,
                    "semanticIdentityMatched": True,
                    "tailIdentityMatched": True,
                },
            )
        )

        report = {
            "apiVersion": REPORT_API_VERSION,
            "kind": "PythonSQLiteCycleStoreBenchmarkReport",
            "language": "python",
            "mode": "quick-smoke" if options["quick"] else "full-characterization",
            "releaseGate": False,
            "productionThroughputClaim": False,
            "crossLanguagePerformanceClaim": False,
            "generatedAt": datetime.now(UTC)
            .isoformat(timespec="milliseconds")
            .replace("+00:00", "Z"),
            "environment": {
                "python": {
                    "version": platform.python_version(),
                    "implementation": platform.python_implementation(),
                    "executableName": Path(sys.executable).name,
                    "byteOrder": sys.byteorder,
                },
                "platform": {
                    "system": platform.system(),
                    "release": platform.release(),
                    "machine": platform.machine(),
                    "logicalCpuCount": os.cpu_count(),
                },
                "filesystem": filesystem_environment(root),
                "sqlite": sqlite_environment(database_path),
            },
            "configuration": options,
            "retryAccounting": retry_accounting,
            "queryPlans": query_plans,
            "benchmarks": benchmarks,
        }
    finally:
        try:
            if provider is not None:
                await provider.close()
        finally:
            shutil.rmtree(root)
    if root.exists():
        fail("temporary benchmark directory survived cleanup")
    if report is None:
        fail("benchmark report was not constructed")
    report["temporaryDirectoryCleanup"] = {
        "strategy": "recursive-after-all-provider-and-worker-handles-close",
        "verified": True,
    }
    print(json.dumps(report, indent=2, sort_keys=True))


def main() -> None:
    if len(sys.argv) >= 2 and sys.argv[1] == "--worker":
        asyncio.run(worker_main(sys.argv[2:]))
    else:
        asyncio.run(benchmark_main(sys.argv[1:]))


if __name__ == "__main__":
    main()
