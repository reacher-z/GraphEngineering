"""Emit Python results for the shared durable CLI operations corpus.

This report is one half of a cross-language join. It reads exactly one input --
``tools/conformance/cli-operations.case.json`` -- materializes each case's
durable journal into its own temporary store, and runs the **native Python
CLI** (``graph_engineering.cli.main``) over the case argv. Every value it prints
is produced by that CLI. It never imports, spawns, or reads anything produced by
the TypeScript implementation, and the corpus carries no ``expect`` block for it
to copy: the corpus is input only. The consuming join in
``tools/conformance/run.mjs`` drives the TypeScript CLI natively over the same
input and compares the two halves stdout byte for byte, stderr byte for byte,
and exit code for exit code.

The report also carries the zero-append evidence. Before and after every
invocation the journal file's exact bytes, size, and modification time are
captured; ``journalUnchanged`` is false if any of them moved. A read command
that appended to a durable history would fail the join.

The corpus declares five ``false`` capability claims. This report proves nothing
about durable cancellation, resume, replay, fork, or node retry; it proves those
commands refuse.
"""

from __future__ import annotations

import contextlib
import hashlib
import io
import json
import os
import shutil
import tempfile
from pathlib import Path
from typing import Any

from graph_engineering.cli import ExitCode
from graph_engineering.cli import main as cli_main
from graph_engineering.cli_operations import (
    DEFAULT_LOG_LIMIT,
    JOURNAL_API_VERSION,
    JOURNAL_EVENT_TYPES,
    MAX_JOURNAL_BYTES,
    MAX_LOG_LIMIT,
    UNSUPPORTED_OPERATIONS,
)

ROOT = Path(__file__).resolve().parents[2]
CASE_PATH = ROOT / "tools" / "conformance" / "cli-operations.case.json"

# Payload markers that only ever appear inside `event.data`. The CLI is a
# capture sink, so none of them may reach stdout or stderr.
FORBIDDEN_MARKERS = (
    "implementationHash",
    "contractVersion",
    "inputHash",
    "maxTotalAttempts",
    "payloadHash",
    "activityKey",
    "outputHash",
    "reusedNodeIds",
    "availableAt",
)


def load_corpus() -> dict[str, Any]:
    corpus: dict[str, Any] = json.loads(CASE_PATH.read_text(encoding="utf-8"))
    return corpus


def journal_path(store: Path, run_id: str) -> Path:
    digest = hashlib.sha256(run_id.encode("utf-8")).hexdigest()
    return store / "events" / f"{digest}.jsonl"


def materialize(store: Path, journal: dict[str, Any] | None) -> Path | None:
    """Write one case's journal bytes; return the path when a file exists."""

    store.mkdir(parents=True, exist_ok=True)
    if journal is None or journal["content"] is None:
        return None
    path = journal_path(store, journal["runId"])
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(journal["content"].encode("utf-8"))
    return path


def fingerprint(path: Path | None) -> tuple[str, int, int] | None:
    if path is None or not path.exists():
        return None
    state = path.stat()
    return (
        hashlib.sha256(path.read_bytes()).hexdigest(),
        state.st_size,
        state.st_mtime_ns,
    )


def invoke(argv: list[str]) -> dict[str, Any]:
    out = io.StringIO()
    err = io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        exit_code = cli_main(argv)
    return {"exitCode": exit_code, "stdout": out.getvalue(), "stderr": err.getvalue()}


def main() -> None:
    corpus = load_corpus()
    store_token: str = corpus["storeToken"]
    journals: dict[str, Any] = corpus["journals"]
    cases: list[dict[str, Any]] = corpus["cases"]

    names = [str(case["name"]) for case in cases]
    if len(set(names)) != len(names):
        raise AssertionError("cases: corpus declares a duplicate case name")

    report: dict[str, Any] = {}
    workspace = Path(tempfile.mkdtemp(prefix="graph-cli-operations-python-"))
    try:
        for index, case in enumerate(cases):
            name = str(case["name"])
            store = workspace / f"case-{index:04d}"
            journal_name = case["journal"]
            path = materialize(store, journals[journal_name] if journal_name else None)
            before = fingerprint(path)
            argv = [str(item).replace(store_token, os.fspath(store)) for item in case["argv"]]
            result = invoke(argv)
            after = fingerprint(path)
            result["journalUnchanged"] = None if path is None else before == after
            # Directory listings must be untouched too: a read command may not
            # create a lock, a temporary file, or an events directory.
            result["storeEntries"] = sorted(
                os.fspath(item.relative_to(store)) for item in store.rglob("*")
            )
            emitted = result["stdout"] + result["stderr"]
            result["storePathLeaked"] = os.fspath(store) in emitted
            result["payloadMarkersLeaked"] = sorted(
                marker for marker in FORBIDDEN_MARKERS if marker in emitted
            )
            report[name] = result
    finally:
        shutil.rmtree(workspace, ignore_errors=True)

    document: dict[str, Any] = {
        "contract": corpus["contract"],
        "journalApiVersion": corpus["journalApiVersion"],
        # Read by this process from the corpus file; the join proves the Node
        # process read literally the same five `false` flags.
        "claims": corpus["claims"],
        "exitCodes": corpus["exitCodes"],
        "unsupportedCapabilities": corpus["unsupportedCapabilities"],
        # Read from the native Python modules, not from the corpus, so the join
        # compares two implementations rather than two corpus reads.
        "nativeExitCodes": {
            "success": ExitCode.SUCCESS,
            "invalidGraph": ExitCode.INVALID_GRAPH,
            "input": ExitCode.INPUT,
            "unhealthy": ExitCode.UNHEALTHY,
            "runNotFound": ExitCode.RUN_NOT_FOUND,
            "history": ExitCode.HISTORY,
            "unsupported": ExitCode.UNSUPPORTED,
            "internal": ExitCode.INTERNAL,
        },
        "nativeUnsupported": {
            command: {
                "capability": descriptor.capability,
                "message": descriptor.message,
            }
            for command, descriptor in UNSUPPORTED_OPERATIONS.items()
        },
        "nativeJournalApiVersion": JOURNAL_API_VERSION,
        "nativeJournalEventTypes": list(JOURNAL_EVENT_TYPES),
        "nativeLimits": {
            "defaultLogLimit": DEFAULT_LOG_LIMIT,
            "maxLogLimit": MAX_LOG_LIMIT,
            "maxJournalBytes": MAX_JOURNAL_BYTES,
        },
        "caseOrder": names,
        "cases": report,
    }
    print(json.dumps(document, ensure_ascii=True, sort_keys=True, separators=(",", ":")))


if __name__ == "__main__":
    main()
