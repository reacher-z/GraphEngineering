"""Native Python coverage for the durable operational CLI surface.

The operational CLI is a read-only projection of a durable event journal in
either of the two layouts a store can carry: the guarded ``events-v1alpha2/``
journal this runtime writes today, and the legacy ``events/`` v1alpha1 journal
that ``redaction-semantics.md`` Section 9 requires be detectable. Both are
exercised here.

The authentic v1alpha1 fixtures in this module are byte-frozen histories the
real Python durable runtime wrote before the redaction hard cut, since it no
longer writes that contract; the authentic v1alpha2 fixtures in the shared
corpus came off disk from the real protected scheduler. The adversarial fixtures
come from the shared cross-language corpus, which is input only: no expectation
is copied out of it.
"""

from __future__ import annotations

import hashlib
import json
import os
import stat
import subprocess
import sys
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest

from graph_engineering.cli import ExitCode
from graph_engineering.cli_operations import (
    DEFAULT_LOG_LIMIT,
    JOURNAL_API_VERSION,
    JOURNAL_API_VERSION_V1ALPHA2,
    JOURNAL_EVENT_TYPES_V1ALPHA2,
    JOURNAL_SOURCES,
    MAX_LOG_LIMIT,
    UNSUPPORTED_OPERATIONS,
)

ROOT = Path(__file__).resolve().parents[2]
CORPUS = json.loads(
    (ROOT / "tools/conformance/cli-operations.case.json").read_text(encoding="utf-8")
)

READ_COMMANDS = ("status", "inspect", "logs")

#: The graph the frozen legacy journals below were produced from.
DIAMOND: dict[str, Any] = {
    "apiVersion": "graphengineering.reacher-z.github.io/v1alpha1",
    "kind": "Graph",
    "metadata": {"name": "durable-operations", "version": "1"},
    "inputSchema": {},
    "outputSchema": {},
    "entrypoints": ["root"],
    "outputs": {"result": {"node": "join"}},
    "nodes": [
        {
            "id": node_id,
            "kind": "agent",
            "inputSchema": {},
            "outputSchema": {},
            "config": {},
            "sideEffects": "none",
        }
        for node_id in ("root", "left", "right", "join")
    ],
    "edges": [
        {"id": "root-left", "from": {"node": "root"}, "to": {"node": "left"}},
        {"id": "root-right", "from": {"node": "root"}, "to": {"node": "right"}},
        {"id": "left-join", "from": {"node": "left"}, "to": {"node": "join"}},
        {"id": "right-join", "from": {"node": "right"}, "to": {"node": "join"}},
    ],
}


@dataclass(frozen=True, slots=True)
class Invocation:
    status: int
    stdout: bytes
    stderr: bytes


def invoke(args: list[str]) -> Invocation:
    result = subprocess.run(
        [sys.executable, "-m", "graph_engineering.cli", *args],
        cwd=ROOT,
        capture_output=True,
        check=False,
    )
    return Invocation(result.returncode, result.stdout, result.stderr)


def machine(result: Invocation) -> dict[str, Any]:
    assert result.stderr == b""
    assert result.stdout.endswith(b"\n")
    assert len(result.stdout.rstrip(b"\n").splitlines()) == 1
    envelope: dict[str, Any] = json.loads(result.stdout)
    assert list(envelope) == [
        "schemaVersion",
        "command",
        "ok",
        "exitCode",
        "data",
        "error",
    ]
    assert envelope["schemaVersion"] == "graph-engineering.cli/v1alpha1"
    assert envelope["exitCode"] == result.status
    assert envelope["ok"] is (result.status == 0)
    return envelope


def journal_path(store: Path, run_id: str, directory: str = "events") -> Path:
    digest = hashlib.sha256(run_id.encode("utf-8")).hexdigest()
    return store / directory / f"{digest}.jsonl"


def corpus_journal_path(store: Path, journal_name: str) -> Path:
    journal = CORPUS["journals"][journal_name]
    return journal_path(store, journal["runId"], journal["directory"])


def fingerprint(path: Path) -> tuple[bytes, int, int]:
    state = path.stat()
    return path.read_bytes(), state.st_size, state.st_mtime_ns


def corpus_store(root: Path, *journal_names: str) -> Path:
    """Materialize one or more shared-corpus journals into a private store."""

    store = root / journal_names[0]
    store.mkdir(parents=True, exist_ok=True)
    for journal_name in journal_names:
        journal = CORPUS["journals"][journal_name]
        if journal["content"] is None:
            continue
        path = journal_path(store, journal["runId"], journal["directory"])
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(journal["content"].encode("utf-8"))
    return store


#: Histories this implementation actually wrote, frozen at the last commit whose
#: durable writer emitted `events/v1alpha1`. `redaction-semantics.md` Section 9
#: makes those journals legacy data: the live runtime now writes the guarded
#: `events/v1alpha2` journal and refuses to continue a v1alpha1 stream, so an
#: authentic v1alpha1 fixture can no longer be produced by calling the runtime.
#: They are still exactly what the read-only operational projection must be able
#: to read, which is what these tests check. The bytes are used verbatim; no
#: expectation below is copied out of them.
LEGACY_JOURNALS: Mapping[str, str] = json.loads(
    (Path(__file__).resolve().parent / "data" / "legacy-v1alpha1-journals.json").read_text(
        encoding="utf-8"
    )
)


def build_run(store_root: Path, run_id: str, *, cancel: bool = False) -> Path:
    """Materialize one frozen legacy v1alpha1 history into a private store."""

    path = journal_path(store_root, run_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(LEGACY_JOURNALS[run_id].encode("utf-8"))
    return store_root


@pytest.fixture(scope="module")
def succeeded_store(tmp_path_factory: pytest.TempPathFactory) -> Path:
    root = tmp_path_factory.mktemp("succeeded")
    return build_run(root, "python-succeeded")


@pytest.fixture(scope="module")
def cancelled_store(tmp_path_factory: pytest.TempPathFactory) -> Path:
    root = tmp_path_factory.mktemp("cancelled")
    return build_run(root, "python-cancelled", cancel=True)


def test_status_projects_a_real_python_runtime_history(succeeded_store: Path) -> None:
    envelope = machine(
        invoke(["status", "--run", "python-succeeded", "--store", str(succeeded_store), "--json"])
    )

    assert envelope["command"] == "status"
    assert envelope["error"] is None
    data = envelope["data"]
    assert list(data) == [
        "runId",
        "runIdHash",
        "journalApiVersion",
        "status",
        "terminal",
        "eventCount",
        "lastSequence",
        "graphRevision",
        "firstEventTimestamp",
        "lastEventTimestamp",
        "resumeCount",
        "pauseCount",
        "observedNodeCount",
        "redaction",
    ]
    assert data["runId"] == "python-succeeded"
    assert data["runIdHash"] == hashlib.sha256(b"python-succeeded").hexdigest()
    assert data["journalApiVersion"] == JOURNAL_API_VERSION
    assert data["status"] == "succeeded"
    assert data["terminal"] is True
    assert data["lastSequence"] == data["eventCount"] - 1
    assert data["graphRevision"] == 1
    assert data["resumeCount"] == 0
    assert data["pauseCount"] == 0
    assert data["observedNodeCount"] == 4
    assert data["redaction"] == {
        "sink": "cli-json",
        "eventDataEmitted": False,
        "payloadsEmitted": False,
        "pathsEmitted": False,
    }


def test_inspect_reports_only_observed_node_and_edge_activity(succeeded_store: Path) -> None:
    envelope = machine(
        invoke(["inspect", "--run", "python-succeeded", "--store", str(succeeded_store), "--json"])
    )

    data = envelope["data"]
    assert [node["nodeId"] for node in data["observedNodes"]] == ["join", "left", "right", "root"]
    assert [edge["edgeId"] for edge in data["observedEdges"]] == [
        "left-join",
        "right-join",
        "root-left",
        "root-right",
    ]
    for node in data["observedNodes"]:
        assert list(node) == [
            "nodeId",
            "eventCount",
            "firstSequence",
            "lastSequence",
            "observedMaxAttempt",
            "scheduled",
            "started",
            "succeeded",
            "attemptFailures",
            "retries",
            "settledWithoutAttempt",
        ]
        assert node["succeeded"] is True
        assert node["attemptFailures"] == 0
        assert node["retries"] == 0
    # The event-type histogram may only contain types the history contains.
    assert set(data["eventTypeCounts"]) <= {
        "RunCreated",
        "RunStarted",
        "NodeScheduled",
        "NodeStarted",
        "NodeSucceeded",
        "EdgeEmitted",
        "RunSucceeded",
    }
    assert sum(data["eventTypeCounts"].values()) == data["eventCount"]


def test_logs_emits_envelope_metadata_and_never_payloads(succeeded_store: Path) -> None:
    envelope = machine(
        invoke(["logs", "--run", "python-succeeded", "--store", str(succeeded_store), "--json"])
    )

    data = envelope["data"]
    assert data["fromSequence"] == 0
    assert data["limit"] == DEFAULT_LOG_LIMIT
    assert data["returned"] == data["eventCount"]
    assert data["truncated"] is False
    assert data["nextSequence"] is None
    assert [event["sequence"] for event in data["events"]] == list(range(data["eventCount"]))
    for event in data["events"]:
        assert list(event) == [
            "sequence",
            "type",
            "timestamp",
            "nodeId",
            "edgeId",
            "attempt",
            "redacted",
        ]
    text = json.dumps(data)
    for marker in ("implementationHash", "inputHash", "payloadHash", "activityKey", "outputHash"):
        assert marker not in text


def test_logs_windows_are_bounded_and_stable(succeeded_store: Path) -> None:
    envelope = machine(
        invoke(
            [
                "logs",
                "--run",
                "python-succeeded",
                "--store",
                str(succeeded_store),
                "--from",
                "2",
                "--limit",
                "3",
                "--json",
            ]
        )
    )

    data = envelope["data"]
    assert data["returned"] == 3
    assert [event["sequence"] for event in data["events"]] == [2, 3, 4]
    assert data["truncated"] is True
    assert data["nextSequence"] == 5

    beyond = machine(
        invoke(
            [
                "logs",
                "--run",
                "python-succeeded",
                "--store",
                str(succeeded_store),
                "--from",
                "10000",
                "--json",
            ]
        )
    )
    assert beyond["data"]["returned"] == 0
    assert beyond["data"]["events"] == []
    assert beyond["data"]["truncated"] is False
    assert beyond["data"]["nextSequence"] is None


def test_cancelled_history_projects_a_cancelled_run(cancelled_store: Path) -> None:
    envelope = machine(
        invoke(["status", "--run", "python-cancelled", "--store", str(cancelled_store), "--json"])
    )

    assert envelope["data"]["status"] == "cancelled"
    assert envelope["data"]["terminal"] is True
    # A cancelled run is still a successful read.
    assert envelope["exitCode"] == ExitCode.SUCCESS


@pytest.mark.parametrize("command", READ_COMMANDS)
def test_read_commands_never_append_to_a_durable_history(
    succeeded_store: Path, command: str
) -> None:
    path = journal_path(succeeded_store, "python-succeeded")
    before = fingerprint(path)
    entries_before = sorted(str(item) for item in succeeded_store.rglob("*"))

    result = invoke(
        [command, "--run", "python-succeeded", "--store", str(succeeded_store), "--json"]
    )

    assert result.status == ExitCode.SUCCESS
    assert fingerprint(path) == before
    assert sorted(str(item) for item in succeeded_store.rglob("*")) == entries_before


@pytest.mark.skipif(os.getuid() == 0, reason="root bypasses filesystem write permissions")
@pytest.mark.parametrize("command", READ_COMMANDS)
def test_read_commands_succeed_against_a_read_only_store(tmp_path: Path, command: str) -> None:
    root = build_run(tmp_path / "readonly", "python-readonly")
    path = journal_path(root, "python-readonly")
    original_file = path.stat().st_mode
    original_events = path.parent.stat().st_mode
    original_root = root.stat().st_mode
    path.chmod(stat.S_IRUSR)
    path.parent.chmod(stat.S_IRUSR | stat.S_IXUSR)
    root.chmod(stat.S_IRUSR | stat.S_IXUSR)
    try:
        result = invoke([command, "--run", "python-readonly", "--store", str(root), "--json"])
    finally:
        root.chmod(original_root)
        path.parent.chmod(original_events)
        path.chmod(original_file)

    assert result.status == ExitCode.SUCCESS, result.stderr


def test_missing_run_history_fails_with_a_stable_not_found_envelope(tmp_path: Path) -> None:
    store = corpus_store(tmp_path, "absent-run")
    result = invoke(["status", "--run", "absent-run", "--store", str(store), "--json"])

    assert result.status == ExitCode.RUN_NOT_FOUND
    envelope = machine(result)
    assert envelope["data"] is None
    assert envelope["error"] == {
        "code": "GECLI_RUN_NOT_FOUND",
        "message": "durable run history does not exist",
        "runId": "absent-run",
    }


def test_empty_history_is_reported_as_malformed(tmp_path: Path) -> None:
    store = corpus_store(tmp_path, "empty-run")
    result = invoke(["status", "--run", "empty-run", "--store", str(store), "--json"])

    assert result.status == ExitCode.HISTORY
    envelope = machine(result)
    assert envelope["error"] == {
        "code": "GECLI_HISTORY_MALFORMED",
        "message": "durable history is empty",
        "runId": "empty-run",
        "record": None,
    }


@pytest.mark.parametrize(
    ("journal_name", "message", "record"),
    [
        ("truncated-run", "durable history has a truncated final record", None),
        ("blank-record-run", "durable history record is blank", 2),
        ("not-json-run", "durable history record is not JSON", 2),
        ("non-object-run", "durable history record is not a JSON object", 2),
        ("unknown-property-run", "durable history record has an unknown property", 2),
        ("missing-property-run", "durable history record is missing a required property", 2),
        (
            "bad-api-version-run",
            "durable history record has an unsupported event apiVersion",
            2,
        ),
        ("unknown-type-run", "durable history record has an unknown event type", 2),
        ("foreign-run-id-run", "durable history record does not belong to this run", 2),
        ("out-of-sequence-run", "durable history record is out of sequence", 2),
        ("non-object-data-run", "durable history record has a non-object data member", 2),
        ("invalid-timestamp-run", "durable history record has an invalid timestamp", 2),
        ("invalid-attempt-run", "durable history record has an invalid attempt", 3),
        ("invalid-revision-run", "durable history record has an invalid graphRevision", 2),
        ("invalid-event-id-run", "durable history record has an invalid eventId", 2),
    ],
)
def test_malformed_histories_fail_closed_with_a_record_ordinal(
    tmp_path: Path, journal_name: str, message: str, record: int | None
) -> None:
    store = corpus_store(tmp_path, journal_name)
    run_id = CORPUS["journals"][journal_name]["runId"]
    result = invoke(["status", "--run", run_id, "--store", str(store), "--json"])

    assert result.status == ExitCode.HISTORY
    envelope = machine(result)
    assert envelope["data"] is None
    assert envelope["error"] == {
        "code": "GECLI_HISTORY_MALFORMED",
        "message": message,
        "runId": run_id,
        "record": record,
    }


@pytest.mark.parametrize("command", sorted(UNSUPPORTED_OPERATIONS))
def test_unsupported_commands_fail_closed_without_touching_the_store(
    tmp_path: Path, command: str
) -> None:
    store = corpus_store(tmp_path / command, "succeeded-run")
    path = journal_path(store, "succeeded-run")
    before = fingerprint(path)
    entries_before = sorted(str(item) for item in store.rglob("*"))

    argv = [command, "--run", "succeeded-run", "--store", str(store), "--json"]
    if command == "retry":
        argv[3:3] = ["--node", "root"]
    result = invoke(argv)

    assert result.status == ExitCode.UNSUPPORTED
    envelope = machine(result)
    assert envelope["command"] == command
    assert envelope["data"] is None, "a refused command must never return a result"
    error = envelope["error"]
    assert error["code"] == "GECLI_UNSUPPORTED_CAPABILITY"
    assert error["runId"] == "succeeded-run"
    assert error["capability"] == UNSUPPORTED_OPERATIONS[command].capability
    assert error["message"] == UNSUPPORTED_OPERATIONS[command].message
    assert fingerprint(path) == before
    assert sorted(str(item) for item in store.rglob("*")) == entries_before


@pytest.mark.parametrize("command", sorted(UNSUPPORTED_OPERATIONS))
def test_unsupported_commands_refuse_even_when_the_run_is_absent(
    tmp_path: Path, command: str
) -> None:
    store = corpus_store(tmp_path / command, "absent-run")
    argv = [command, "--run", "absent-run", "--store", str(store), "--json"]
    if command == "retry":
        argv[3:3] = ["--node", "root"]
    result = invoke(argv)

    # The capability check precedes the store read, so a missing run does not
    # change the answer.
    assert result.status == ExitCode.UNSUPPORTED
    assert machine(result)["error"]["code"] == "GECLI_UNSUPPORTED_CAPABILITY"


@pytest.mark.parametrize(
    ("argv", "code"),
    [
        (["status", "--store", "STORE", "--json"], "GECLI_USAGE"),
        (["status", "--run", "succeeded-run", "--json"], "GECLI_USAGE"),
        (
            ["status", "--run", "not a safe id", "--store", "STORE", "--json"],
            "GECLI_RUN_ID_INVALID",
        ),
        (["status", "--run", "..", "--store", "STORE", "--json"], "GECLI_RUN_ID_INVALID"),
        (["status", "--run", "a", "--run", "b", "--store", "STORE", "--json"], "GECLI_USAGE"),
        (["status", "--run", "succeeded-run", "--store", "STORE", "x", "--json"], "GECLI_USAGE"),
        (
            ["status", "--run", "succeeded-run", "--store", "STORE", "--format", "dot", "--json"],
            "GECLI_USAGE",
        ),
        (["retry", "--run", "succeeded-run", "--store", "STORE", "--json"], "GECLI_USAGE"),
        (
            ["logs", "--run", "succeeded-run", "--store", "STORE", "--limit", "0", "--json"],
            "GECLI_USAGE",
        ),
        (
            ["logs", "--run", "succeeded-run", "--store", "STORE", "--limit", "10001", "--json"],
            "GECLI_USAGE",
        ),
        (
            ["logs", "--run", "succeeded-run", "--store", "STORE", "--from", "-1", "--json"],
            "GECLI_USAGE",
        ),
        (["doctor", "--run", "succeeded-run", "--json"], "GECLI_USAGE"),
        (["validate", "--store", "STORE", "--json"], "GECLI_USAGE"),
    ],
)
def test_usage_failures_exit_two_with_a_stable_code(
    tmp_path: Path, argv: list[str], code: str
) -> None:
    store = corpus_store(tmp_path, "succeeded-run")
    result = invoke([str(store) if item == "STORE" else item for item in argv])

    assert result.status == ExitCode.INPUT
    envelope = machine(result)
    assert envelope["data"] is None
    assert envelope["error"]["code"] == code


def test_an_unreadable_store_directory_is_an_input_failure(tmp_path: Path) -> None:
    result = invoke(
        ["status", "--run", "succeeded-run", "--store", str(tmp_path / "absent"), "--json"]
    )

    assert result.status == ExitCode.INPUT
    assert machine(result)["error"]["code"] == "GECLI_STORE_UNREADABLE"


@pytest.mark.parametrize("command", READ_COMMANDS)
def test_human_mode_writes_stdout_only_and_omits_payloads(
    succeeded_store: Path, command: str
) -> None:
    result = invoke([command, "--run", "python-succeeded", "--store", str(succeeded_store)])

    assert result.status == ExitCode.SUCCESS
    assert result.stderr == b""
    text = result.stdout.decode("utf-8")
    assert text.startswith("Run python-succeeded")
    assert "payloads and event data are never emitted by this sink" in text
    assert str(succeeded_store) not in text
    for marker in ("implementationHash", "inputHash", "payloadHash", "activityKey"):
        assert marker not in text


def test_human_mode_failures_write_stderr_only(tmp_path: Path) -> None:
    store = corpus_store(tmp_path, "absent-run")
    result = invoke(["status", "--run", "absent-run", "--store", str(store)])

    assert result.status == ExitCode.RUN_NOT_FOUND
    assert result.stdout == b""
    assert result.stderr.decode("utf-8") == (
        "graph: durable run history does not exist: absent-run\n"
    )


def test_help_documents_the_operational_surface_and_its_exit_codes() -> None:
    result = invoke(["--help"])
    text = result.stdout.decode("utf-8")

    assert result.status == ExitCode.SUCCESS
    for command in (*READ_COMMANDS, *sorted(UNSUPPORTED_OPERATIONS)):
        assert f"graph {command} --run <runId>" in text
    assert "4 durable run history does not exist" in text
    assert "5 durable run history is malformed" in text
    assert "6 the requested durable capability is not implemented" in text


def test_the_exit_code_table_is_the_documented_one() -> None:
    table: Mapping[str, int] = {
        "SUCCESS": 0,
        "INVALID_GRAPH": 1,
        "INPUT": 2,
        "UNHEALTHY": 3,
        "RUN_NOT_FOUND": 4,
        "HISTORY": 5,
        "UNSUPPORTED": 6,
        "INTERNAL": 70,
    }
    for name, value in table.items():
        assert getattr(ExitCode, name) == value
    assert DEFAULT_LOG_LIMIT == 200
    assert MAX_LOG_LIMIT == 10_000


def test_no_operational_command_invents_a_status_the_history_lacks(tmp_path: Path) -> None:
    for journal_name, expected in (
        ("created-only-run", "created"),
        ("paused-run", "paused"),
        ("interrupted-run", "running"),
        ("failed-run", "failed"),
        ("cancelled-run", "cancelled"),
        ("succeeded-run", "succeeded"),
    ):
        store = corpus_store(tmp_path / journal_name, journal_name)
        run_id = CORPUS["journals"][journal_name]["runId"]
        envelope = machine(invoke(["status", "--run", run_id, "--store", str(store), "--json"]))
        assert envelope["data"]["status"] == expected
        assert envelope["data"]["terminal"] is (
            expected in {"succeeded", "failed", "cancelled"}
        )


#: The protected run the shared corpus carries, produced today by the real
#: durable scheduler over the quickstart research diamond.
PROTECTED_RUN = "v1alpha2-succeeded-run"


def test_the_shared_corpus_carries_journals_of_both_durable_layouts() -> None:
    assert CORPUS["journalApiVersion"] == JOURNAL_API_VERSION
    assert CORPUS["journalApiVersionV1Alpha2"] == JOURNAL_API_VERSION_V1ALPHA2
    # Every journal states the layout it belongs in, and the only layouts are
    # the two this reader probes, in the order it probes them.
    assert [(source.directory, source.api_version) for source in JOURNAL_SOURCES] == [
        ("events-v1alpha2", JOURNAL_API_VERSION_V1ALPHA2),
        ("events", JOURNAL_API_VERSION),
    ]
    directories = {
        journal["directory"]
        for journal in CORPUS["journals"].values()
        if journal["content"] is not None
    }
    assert sorted(directories) == ["events", "events-v1alpha2"]
    content: str = CORPUS["journals"][PROTECTED_RUN]["content"]
    for index, line in enumerate(content.rstrip("\n").split("\n")):
        record = json.loads(line)
        assert record["apiVersion"] == JOURNAL_API_VERSION_V1ALPHA2
        assert record["sequence"] == index
        assert record["runId"] == PROTECTED_RUN
        assert record["redacted"] is False
        assert record["payloadDisposition"] in {"metadata-only", "protected-ref"}
        assert record["type"] in JOURNAL_EVENT_TYPES_V1ALPHA2


def test_status_projects_a_protected_v1alpha2_run(tmp_path: Path) -> None:
    store = corpus_store(tmp_path, PROTECTED_RUN)
    result = invoke(["status", "--run", PROTECTED_RUN, "--store", str(store), "--json"])

    assert result.status == ExitCode.SUCCESS
    envelope = machine(result)
    data = envelope["data"]
    # The envelope contract does not change with the journal contract: the same
    # closed, ordered member list, and the same redaction marker.
    assert list(data) == [
        "runId",
        "runIdHash",
        "journalApiVersion",
        "status",
        "terminal",
        "eventCount",
        "lastSequence",
        "graphRevision",
        "firstEventTimestamp",
        "lastEventTimestamp",
        "resumeCount",
        "pauseCount",
        "observedNodeCount",
        "redaction",
    ]
    assert data["journalApiVersion"] == JOURNAL_API_VERSION_V1ALPHA2
    assert data["status"] == "succeeded"
    assert data["terminal"] is True
    assert data["eventCount"] == 19
    assert data["observedNodeCount"] == 4
    assert data["redaction"] == {
        "sink": "cli-json",
        "eventDataEmitted": False,
        "payloadsEmitted": False,
        "pathsEmitted": False,
    }


def test_inspect_counts_protected_event_types_in_contract_order(tmp_path: Path) -> None:
    store = corpus_store(tmp_path, "v1alpha2-failed-run")
    envelope = machine(
        invoke(
            ["inspect", "--run", "v1alpha2-failed-run", "--store", str(store), "--json"]
        )
    )
    data = envelope["data"]

    assert data["journalApiVersion"] == JOURNAL_API_VERSION_V1ALPHA2
    assert data["status"] == "failed"
    counts: dict[str, int] = data["eventTypeCounts"]
    assert list(counts) == [
        event_type for event_type in JOURNAL_EVENT_TYPES_V1ALPHA2 if event_type in counts
    ]
    assert sum(counts.values()) == data["eventCount"]
    # A protected failure is projected from envelope metadata alone.
    assert "NodeAttemptFailed" in counts
    assert "NodeSettledWithoutAttempt" in counts


def test_logs_pages_protected_metadata_without_resolving_a_reference(
    tmp_path: Path,
) -> None:
    store = corpus_store(tmp_path, PROTECTED_RUN)
    envelope = machine(
        invoke(["logs", "--run", PROTECTED_RUN, "--store", str(store), "--json"])
    )
    data = envelope["data"]

    assert data["journalApiVersion"] == JOURNAL_API_VERSION_V1ALPHA2
    assert data["returned"] == 19
    for event in data["events"]:
        assert list(event) == [
            "sequence",
            "type",
            "timestamp",
            "nodeId",
            "edgeId",
            "attempt",
            "redacted",
        ]
        # v1alpha2 records are always `redacted: false`; the CLI restates the
        # envelope fact rather than inventing one.
        assert event["redacted"] is False
    text = json.dumps(data)
    for marker in (
        "payloadHash",
        "capturePolicyHash",
        "protected-ref",
        "inputRef",
        "outputRef",
        "valueMac",
        "ciphertextHash",
        "activityKey",
    ):
        assert marker not in text


def test_a_store_with_both_layouts_projects_the_protected_journal(tmp_path: Path) -> None:
    store = corpus_store(tmp_path, PROTECTED_RUN, "v1alpha2-precedence-legacy-run")
    envelope = machine(
        invoke(["status", "--run", PROTECTED_RUN, "--store", str(store), "--json"])
    )

    # The legacy half of this pair is a paused three-record history, so the
    # projection below could only come from the protected journal.
    assert envelope["data"]["journalApiVersion"] == JOURNAL_API_VERSION_V1ALPHA2
    assert envelope["data"]["status"] == "succeeded"
    assert envelope["data"]["eventCount"] == 19


def test_a_legacy_only_store_still_reads_and_reports_the_legacy_contract(
    tmp_path: Path,
) -> None:
    store = corpus_store(tmp_path, "v1alpha2-precedence-legacy-run")
    envelope = machine(
        invoke(["status", "--run", PROTECTED_RUN, "--store", str(store), "--json"])
    )

    assert envelope["data"]["journalApiVersion"] == JOURNAL_API_VERSION
    assert envelope["data"]["status"] == "paused"
    assert envelope["data"]["eventCount"] == 3


@pytest.mark.parametrize(
    ("journal_name", "message", "record"),
    [
        ("v1alpha2-empty-run", "durable history is empty", None),
        (
            "v1alpha2-truncated-run",
            "durable history has a truncated final record",
            None,
        ),
        (
            "v1alpha2-unknown-property-run",
            "durable history record has an unknown property",
            2,
        ),
        (
            "v1alpha2-missing-property-run",
            "durable history record is missing a required property",
            2,
        ),
        (
            "v1alpha2-bad-api-version-run",
            "durable history record has an unsupported event apiVersion",
            2,
        ),
        (
            "v1alpha2-redacted-run",
            "durable history record has an invalid redacted flag",
            2,
        ),
        (
            "v1alpha2-inline-disposition-run",
            "durable history record has an invalid payloadDisposition",
            2,
        ),
        (
            "v1alpha2-bad-payload-hash-run",
            "durable history record has an invalid payload hash",
            2,
        ),
        (
            "v1alpha2-out-of-sequence-run",
            "durable history record is out of sequence",
            2,
        ),
        (
            "v1alpha2-unknown-type-run",
            "durable history record has an unknown event type",
            2,
        ),
        (
            "v1alpha2-foreign-run-id-run",
            "durable history record does not belong to this run",
            2,
        ),
    ],
)
def test_malformed_protected_histories_fail_closed(
    tmp_path: Path, journal_name: str, message: str, record: int | None
) -> None:
    store = corpus_store(tmp_path, journal_name)
    result = invoke(["status", "--run", PROTECTED_RUN, "--store", str(store), "--json"])

    assert result.status == ExitCode.HISTORY
    envelope = machine(result)
    assert envelope["data"] is None
    assert envelope["error"] == {
        "code": "GECLI_HISTORY_MALFORMED",
        "message": message,
        "runId": PROTECTED_RUN,
        "record": record,
    }


@pytest.mark.parametrize("command", READ_COMMANDS)
def test_read_commands_append_nothing_to_a_protected_store(
    tmp_path: Path, command: str
) -> None:
    store = corpus_store(tmp_path / command, PROTECTED_RUN, "v1alpha2-precedence-legacy-run")
    protected_path = corpus_journal_path(store, PROTECTED_RUN)
    legacy_path = corpus_journal_path(store, "v1alpha2-precedence-legacy-run")
    before = (fingerprint(protected_path), fingerprint(legacy_path))
    entries_before = sorted(str(item) for item in store.rglob("*"))

    result = invoke([command, "--run", PROTECTED_RUN, "--store", str(store), "--json"])

    assert result.status == ExitCode.SUCCESS
    # Neither the layout that was read nor the one that was not.
    assert (fingerprint(protected_path), fingerprint(legacy_path)) == before
    assert sorted(str(item) for item in store.rglob("*")) == entries_before


@pytest.mark.parametrize("command", READ_COMMANDS)
def test_human_output_names_the_journal_contract(tmp_path: Path, command: str) -> None:
    protected_store = corpus_store(tmp_path / f"{command}-protected", PROTECTED_RUN)
    protected = invoke([command, "--run", PROTECTED_RUN, "--store", str(protected_store)])
    assert protected.status == ExitCode.SUCCESS
    assert b"journal events/v1alpha2" in protected.stdout
    assert b"journal events/v1alpha1" not in protected.stdout
    assert b"payloads and event data are never emitted by this sink" in protected.stdout
    assert str(protected_store).encode() not in protected.stdout

    legacy_store = corpus_store(tmp_path / f"{command}-legacy", "succeeded-run")
    legacy = invoke([command, "--run", "succeeded-run", "--store", str(legacy_store)])
    assert legacy.status == ExitCode.SUCCESS
    assert b"journal events/v1alpha1" in legacy.stdout
