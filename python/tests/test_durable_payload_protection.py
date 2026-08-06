"""Durable payload protection: fail-closed, legacy refusal, and the canary gate.

``redaction-semantics.md`` Section 4.2 makes protection a precondition of a
durable run rather than an option, Section 9 forbids continuing or silently
repairing an ``events/v1alpha1`` history, and Section 12 makes the seeded-canary
campaign the acceptance evidence.  The gate that matters here is the last one:
not that a flag says ``redacted``, but that a value a real graph produced is
absent from every byte the runtime left on disk.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

import pytest

from graph_engineering import (
    DurableRunError,
    DurableRunErrorCode,
    NodeContext,
    RunStatus,
    compile_graph,
    resume_graph_run,
    start_graph_run,
)
from graph_engineering.durable import ATTEMPT_TEMPLATE_MESSAGES
from graph_engineering.durable_protection import (
    PayloadProtection,
    default_durable_capture_policy,
)
from graph_engineering.persistence import MemoryEventStore
from graph_engineering.redaction.keys import DeterministicTestKeyProvider
from graph_engineering.redaction.protect import FileProtectedPayloadStore
from graph_engineering.redaction.scan import encoded_forms
from tests.durable_support import (
    file_journal,
    file_protection,
    memory_journal,
    memory_protection,
)

FIXED_TIME = "2026-07-26T12:00:00.000Z"

LEGACY_JOURNALS: dict[str, str] = json.loads(
    (Path(__file__).resolve().parent / "data" / "legacy-v1alpha1-journals.json").read_text(
        encoding="utf-8"
    )
)


def fixed_clock() -> str:
    return FIXED_TIME


def chain_graph() -> Any:
    """root -> child, so graph input, a bound node input, and outputs all exist."""

    return compile_graph(
        {
            "apiVersion": "graphengineering.reacher-z.github.io/v1alpha1",
            "kind": "Graph",
            "metadata": {"name": "canary-chain", "version": "1"},
            "inputSchema": {},
            "outputSchema": {},
            "entrypoints": ["root"],
            "outputs": {"result": {"node": "child"}},
            "nodes": [
                {
                    "id": node_id,
                    "kind": "agent",
                    "inputSchema": {},
                    "outputSchema": {},
                    "config": {},
                    "sideEffects": "none",
                }
                for node_id in ("root", "child")
            ],
            "edges": [{"id": "root-child", "from": {"node": "root"}, "to": {"node": "child"}}],
        }
    )


def single_graph() -> Any:
    return compile_graph(
        {
            "apiVersion": "graphengineering.reacher-z.github.io/v1alpha1",
            "kind": "Graph",
            "metadata": {"name": "protection-single", "version": "1"},
            "inputSchema": {},
            "outputSchema": {},
            "entrypoints": ["root"],
            "outputs": {"result": {"node": "root"}},
            "nodes": [
                {
                    "id": "root",
                    "kind": "agent",
                    "inputSchema": {},
                    "outputSchema": {},
                    "config": {},
                    "sideEffects": "none",
                }
            ],
            "edges": [],
        }
    )


# ----------------------------------------------------------------------
# Section 4.2: an unconfigured durable run fails closed.


def test_an_unconfigured_durable_run_refuses_before_any_write_or_executor() -> None:
    async def scenario() -> None:
        store = memory_journal()
        calls = 0

        def handler(_: NodeContext) -> Any:
            nonlocal calls
            calls += 1
            return "must-not-run"

        with pytest.raises(DurableRunError) as started:
            await start_graph_run(
                single_graph(),
                {"question": "synthetic"},
                {"root": handler},
                run_id="unconfigured-start",
                implementation_id="v1",
                event_store=store,
                clock=fixed_clock,
            )
        assert started.value.code is DurableRunErrorCode.PAYLOAD_PROTECTION_REQUIRED
        assert started.value.details["redactionCode"] == "PAYLOAD_PROTECTION_REQUIRED"

        with pytest.raises(DurableRunError) as resumed:
            await resume_graph_run(
                single_graph(),
                {"root": handler},
                run_id="unconfigured-start",
                implementation_id="v1",
                event_store=store,
                clock=fixed_clock,
            )
        assert resumed.value.code is DurableRunErrorCode.PAYLOAD_PROTECTION_REQUIRED

        # Nothing was written and no executor ran.
        assert await store.read("unconfigured-start") == ()
        assert calls == 0

    asyncio.run(scenario())


def test_an_unconfigured_run_does_not_fall_back_to_the_legacy_writer(tmp_path: Path) -> None:
    """Section 4.2: never fall back to inline capture, never invent a key."""

    async def scenario() -> None:
        store = file_journal(tmp_path)
        with pytest.raises(DurableRunError) as error:
            await start_graph_run(
                single_graph(),
                {"question": "synthetic"},
                {"root": lambda _: "answer"},
                run_id="no-fallback",
                implementation_id="v1",
                event_store=store,
                clock=fixed_clock,
            )
        assert error.value.code is DurableRunErrorCode.PAYLOAD_PROTECTION_REQUIRED

    asyncio.run(scenario())
    written = [path for path in tmp_path.rglob("*") if path.is_file()]
    assert written == []


def test_an_unguarded_event_store_is_refused() -> None:
    """The journal sink must be one that only accepts a prepared write."""

    async def scenario() -> None:
        with pytest.raises(DurableRunError) as error:
            await start_graph_run(
                single_graph(),
                {},
                {"root": lambda _: "answer"},
                run_id="unguarded-sink",
                implementation_id="v1",
                event_store=MemoryEventStore(),  # type: ignore[arg-type]
                payload_protection=memory_protection(),
                clock=fixed_clock,
            )
        assert error.value.code is DurableRunErrorCode.PAYLOAD_PROTECTION_REQUIRED

    asyncio.run(scenario())


# ----------------------------------------------------------------------
# Section 12: the seeded-canary gate at the durable layer.

CANARIES: dict[str, str] = {
    "graph-input": "SYNTHETIC-CANARY-DURABLE-GRAPH-INPUT-5a6b7c8d",
    "node-output": "SYNTHETIC-CANARY-DURABLE-NODE-OUTPUT-6b7c8d9e",
    "run-result": "SYNTHETIC-CANARY-DURABLE-RUN-RESULT-7c8d9e0f",
    "failure-detail": "SYNTHETIC-CANARY-DURABLE-FAILURE-8d9e0f10",
}

#: Section 12 names more spellings than these three, and the guard's own scanner
#: checks all eight. The gate below is the one the release blocker names.
GATE_FORMS = ("utf-8", "base64url", "hex")


def _scan(root: Path, forms: tuple[str, ...]) -> list[tuple[str, str, str]]:
    hits: list[tuple[str, str, str]] = []
    for path in sorted(item for item in root.rglob("*") if item.is_file()):
        raw = path.read_bytes()
        for canary_id, value in CANARIES.items():
            spellings = encoded_forms(value)
            for form in forms:
                encoded = spellings[form]
                haystack = raw.lower() if form == "hex" else raw
                needle = encoded.lower() if form == "hex" else encoded
                if needle in haystack:
                    hits.append((str(path.relative_to(root)), canary_id, form))
    return hits


def test_a_real_durable_run_leaves_no_canary_in_any_byte_on_disk(tmp_path: Path) -> None:
    """The acceptance evidence for the durable cutover.

    A real durable graph is executed against the real on-disk journal and blob
    store. Its graph input, a node's returned output, a failing node's exception
    text, and therefore the terminal run result each carry a distinct synthetic
    canary. Every byte the runtime wrote is then read back off disk and scanned
    in UTF-8, base64url, and hexadecimal.
    """

    async def scenario() -> RunStatus:
        store = file_journal(tmp_path / "store")
        protection = file_protection(tmp_path / "store" / "protected")

        def root(context: NodeContext) -> Any:
            assert isinstance(context.input, dict)
            assert context.input["question"] == CANARIES["graph-input"]
            return {"answer": CANARIES["node-output"]}

        def child(context: NodeContext) -> Any:
            raise RuntimeError(CANARIES["failure-detail"])

        result = await start_graph_run(
            chain_graph(),
            {"question": CANARIES["graph-input"], "tag": CANARIES["run-result"]},
            {"root": root, "child": child},
            run_id="canary-run",
            implementation_id="canary@1",
            event_store=store,
            payload_protection=protection,
            clock=fixed_clock,
        )
        return result.status

    status = asyncio.run(scenario())
    assert status is RunStatus.FAILED

    root = tmp_path / "store"
    files = sorted(path for path in root.rglob("*") if path.is_file())
    assert files, "the run must have produced durable bytes to scan"
    assert sum(1 for path in files if path.suffix == ".jsonl") == 1
    assert sum(1 for path in files if path.suffix == ".blob") >= 4

    assert _scan(root, GATE_FORMS) == [], "a canary reached a durable sink"
    # The guard's complete spelling set finds nothing either.
    assert _scan(root, tuple(encoded_forms("x"))) == []

    # A positive control proves the scan can see a leak at all.
    control = root / "unsafe-control.txt"
    control.write_bytes(CANARIES["node-output"].encode("utf-8"))
    assert _scan(root, GATE_FORMS) == [("unsafe-control.txt", "node-output", "utf-8")]


def test_a_protected_run_still_recovers_every_canary_value(tmp_path: Path) -> None:
    """Absence from disk is only useful if recovery still returns the value."""

    async def scenario() -> Any:
        store = file_journal(tmp_path / "store")
        protection = file_protection(tmp_path / "store" / "protected")
        started = await start_graph_run(
            chain_graph(),
            {"question": CANARIES["graph-input"]},
            {
                "root": lambda _: {"answer": CANARIES["node-output"]},
                "child": lambda context: context.input,
            },
            run_id="canary-recovery",
            implementation_id="canary@1",
            event_store=store,
            payload_protection=protection,
            clock=fixed_clock,
        )
        resumed = await resume_graph_run(
            chain_graph(),
            {"*": lambda _: (_ for _ in ()).throw(AssertionError("must not run"))},
            run_id="canary-recovery",
            implementation_id="canary@1",
            event_store=store,
            payload_protection=protection,
            clock=fixed_clock,
        )
        return started, resumed

    started, resumed = asyncio.run(scenario())
    assert started.status is RunStatus.SUCCEEDED
    assert resumed == started
    assert started.nodes["root"].value == {"answer": CANARIES["node-output"]}


def test_no_durable_event_carries_an_inline_application_field(tmp_path: Path) -> None:
    """Section 6.1: the legacy inline aliases are absent from every record."""

    async def scenario() -> list[dict[str, Any]]:
        store = file_journal(tmp_path / "store")
        protection = file_protection(tmp_path / "store" / "protected")
        await start_graph_run(
            chain_graph(),
            {"question": CANARIES["graph-input"]},
            {
                "root": lambda _: {"answer": CANARIES["node-output"]},
                "child": lambda context: context.input,
            },
            run_id="inline-audit",
            implementation_id="v1",
            event_store=store,
            payload_protection=protection,
            clock=fixed_clock,
        )
        raw = store.path_for_run("inline-audit").read_bytes()
        return [json.loads(line) for line in raw.splitlines()]

    documents = asyncio.run(scenario())
    forbidden = {"input", "output", "result", "state", "inputHash", "outputHash", "resultHash"}
    for document in documents:
        assert document["apiVersion"].endswith("events/v1alpha2")
        assert document["redacted"] is False
        assert document["payloadDisposition"] in ("metadata-only", "protected-ref")
        assert not set(document["data"]) & forbidden


def test_an_attempt_failure_carries_a_template_message_and_no_host_cause_name(
    tmp_path: Path,
) -> None:
    """Section 6.1: `NodeAttemptFailed` is metadata-only closed fields.

    The executor's own text and its exception class name are application-derived
    and stay out of the inline record; they survive only inside the protected
    terminal result.
    """

    async def scenario() -> list[dict[str, Any]]:
        store = file_journal(tmp_path / "store")
        protection = file_protection(tmp_path / "store" / "protected")

        class SyntheticProviderError(RuntimeError):
            pass

        def root(_: NodeContext) -> Any:
            raise SyntheticProviderError(CANARIES["failure-detail"])

        await start_graph_run(
            single_graph(),
            {},
            {"root": root},
            run_id="failure-metadata",
            implementation_id="v1",
            event_store=store,
            payload_protection=protection,
            clock=fixed_clock,
        )
        return [
            json.loads(line)
            for line in store.path_for_run("failure-metadata").read_bytes().splitlines()
        ]

    documents = asyncio.run(scenario())
    attempt_failed = next(item for item in documents if item["type"] == "NodeAttemptFailed")
    failure = attempt_failed["data"]["failure"]
    # `$defs.attemptFailure` closes the object at exactly these members. The
    # message itself no longer reaches the wire at all: a versioned template
    # identifier stands in for it, so there is no string on the wire that a
    # caught exception could ever be a substring of.
    assert failure == {
        "phase": "execute",
        "code": "NODE_EXECUTION_FAILED",
        "messageTemplate": "node-execution-failed/v1",
        "retryable": False,
        "causeCode": "EXECUTOR_REJECTED",
    }
    assert ATTEMPT_TEMPLATE_MESSAGES["node-execution-failed/v1"] == "the node executor raised"
    for absent in ("message", "causeName", "nodeId", "attempt"):
        assert absent not in failure
    # The default profile captures no diagnostic evidence, so the record is the
    # metadata-only shape and carries no reference at all.
    assert attempt_failed["payloadDisposition"] == "metadata-only"
    assert "evidenceRef" not in attempt_failed["data"]
    assert CANARIES["failure-detail"] not in json.dumps(attempt_failed)


def _protection_with_policy(root: Path, **overrides: str) -> PayloadProtection:
    """A file-backed protection authority under a policy widened from default."""

    from dataclasses import replace

    key_provider = DeterministicTestKeyProvider(key_ref="test://deterministic/key-1")
    policy = replace(default_durable_capture_policy(key_provider.key_ref), **overrides)  # type: ignore[arg-type]
    return PayloadProtection(
        key_provider=key_provider,
        payload_store=FileProtectedPayloadStore(str(root)),
        policy=policy,
    )


def _failed_attempt_documents(
    tmp_path: Path, **policy_overrides: str
) -> list[dict[str, Any]]:
    """Run one failing single-node graph and return the persisted journal."""

    async def scenario() -> list[dict[str, Any]]:
        store = file_journal(tmp_path / "store")
        protection = _protection_with_policy(
            tmp_path / "store" / "protected", **policy_overrides
        )

        def root(_: NodeContext) -> Any:
            raise RuntimeError(CANARIES["failure-detail"])

        await start_graph_run(
            single_graph(),
            {},
            {"root": root},
            run_id="failure-evidence",
            implementation_id="v1",
            event_store=store,
            payload_protection=protection,
            clock=fixed_clock,
        )
        return [
            json.loads(line)
            for line in store.path_for_run("failure-evidence").read_bytes().splitlines()
        ]

    return asyncio.run(scenario())


def test_protected_evidence_alone_flips_the_attempt_failure_to_the_protected_shape(
    tmp_path: Path,
) -> None:
    """Section 6.1: `errors: "protected-evidence"` is the one operator lever.

    With every other control at the Section 4.1 default (events stays
    `metadata-or-protected`), the NodeAttemptFailed record carries the raw
    evidence as a protected reference — and only as a protected reference.
    """

    documents = _failed_attempt_documents(tmp_path, errors="protected-evidence")
    attempt_failed = next(item for item in documents if item["type"] == "NodeAttemptFailed")
    assert attempt_failed["payloadDisposition"] == "protected-ref"
    assert sorted(attempt_failed["data"]) == [
        "evidenceMac",
        "evidenceRef",
        "failure",
        "terminal",
    ]
    # Section 6.1: the adjacent MAC equals the reference's valueMac.
    assert (
        attempt_failed["data"]["evidenceMac"]
        == attempt_failed["data"]["evidenceRef"]["valueMac"]
    )
    # The raw text still never reaches the journal inline.
    assert CANARIES["failure-detail"] not in json.dumps(documents)


def test_codes_only_is_a_disabled_mode_and_captures_no_evidence(tmp_path: Path) -> None:
    """Section 1.2/4.1: codes-only means stable codes only, no payload evidence.

    `errors: "codes-only"` differs from the default profile, but it is a
    disabled mode, so the pair stays off and the record stays metadata-only —
    the same verdict the TypeScript lane's `controlEnabled` has always given.
    """

    documents = _failed_attempt_documents(tmp_path, errors="codes-only")
    attempt_failed = next(item for item in documents if item["type"] == "NodeAttemptFailed")
    assert attempt_failed["payloadDisposition"] == "metadata-only"
    assert sorted(attempt_failed["data"]) == ["failure", "terminal"]
    assert CANARIES["failure-detail"] not in json.dumps(documents)


def test_widening_an_unrelated_control_is_not_protected_evidence_policy(
    tmp_path: Path,
) -> None:
    """Section 6.1: only the `errors` mode is the evidence lever.

    Widening the event sink's own control (`events: "allow-redacted"`) enables
    the Section 1.2 pair, but raw evidence still requires
    `errors: "protected-evidence"`, so the record stays metadata-only.
    """

    documents = _failed_attempt_documents(tmp_path, events="allow-redacted")
    attempt_failed = next(item for item in documents if item["type"] == "NodeAttemptFailed")
    assert attempt_failed["payloadDisposition"] == "metadata-only"
    assert sorted(attempt_failed["data"]) == ["failure", "terminal"]
    assert CANARIES["failure-detail"] not in json.dumps(documents)


def test_the_shared_evidence_predicate_is_pinned_mode_by_mode() -> None:
    """The pure Section 6.1/1.2 predicate both language lanes share."""

    from dataclasses import replace

    from graph_engineering.durable_protection import diagnostic_evidence_authorized
    from graph_engineering.redaction.policy import control_enabled, policy_enabled_for

    default = default_durable_capture_policy("test://deterministic/key-1")
    cases: list[tuple[dict[str, str], bool]] = [
        ({}, False),
        ({"errors": "protected-evidence"}, True),
        ({"errors": "codes-only"}, False),
        ({"errors": "codes-and-sanitized-message"}, False),
        ({"events": "allow-redacted"}, False),
        ({"errors": "protected-evidence", "events": "allow-redacted"}, True),
    ]
    for overrides, expected in cases:
        policy = replace(default, **overrides)  # type: ignore[arg-type]
        assert diagnostic_evidence_authorized(policy, "event-journal") is expected, overrides
    # Section 1.2: the pair-enablement formula spans the union of the source
    # row's control and the sink row's controls. codes-only widens the union but
    # is itself disabled; an events widening enables the pair without enabling
    # the stricter Section 6.1 evidence gate above.
    assert policy_enabled_for(default, "exception-message", "event-journal") is False
    assert (
        policy_enabled_for(
            replace(default, errors="codes-only"), "exception-message", "event-journal"
        )
        is False
    )
    assert (
        policy_enabled_for(
            replace(default, errors="protected-evidence"), "exception-message", "event-journal"
        )
        is True
    )
    assert (
        policy_enabled_for(
            replace(default, events="allow-redacted"), "exception-message", "event-journal"
        )
        is True
    )
    assert control_enabled(replace(default, errors="codes-only"), "errors") is False
    assert control_enabled(default, "errors") is True


# ----------------------------------------------------------------------
# Section 9: legacy histories.


def test_a_legacy_v1alpha1_history_is_refused_and_never_rewritten(tmp_path: Path) -> None:
    root = tmp_path / "store"
    legacy = root / "events"
    legacy.mkdir(parents=True)
    import hashlib

    run_id = "python-succeeded"
    path = legacy / f"{hashlib.sha256(run_id.encode('utf-8')).hexdigest()}.jsonl"
    original = LEGACY_JOURNALS[run_id].encode("utf-8")
    path.write_bytes(original)

    async def scenario() -> tuple[DurableRunError, DurableRunError]:
        store = file_journal(root)
        protection = file_protection(root / "protected")
        with pytest.raises(DurableRunError) as resumed:
            await resume_graph_run(
                compile_graph(json.loads(json.dumps(DIAMOND))),
                run_id=run_id,
                implementation_id="operations-test",
                event_store=store,
                payload_protection=protection,
            )
        with pytest.raises(DurableRunError) as started:
            await start_graph_run(
                compile_graph(json.loads(json.dumps(DIAMOND))),
                {},
                run_id=run_id,
                implementation_id="operations-test",
                event_store=store,
                payload_protection=protection,
            )
        return resumed.value, started.value

    resumed, started = asyncio.run(scenario())
    for error in (resumed, started):
        assert error.code is DurableRunErrorCode.LEGACY_HISTORY_UNSAFE
        assert error.details["contractVersion"] == "scheduler-recovery/v1alpha1"
        # Section 3.1 made this journal truthful, which does not make it safe.
        assert error.details["redactionCode"] == "INLINE_CAPTURE_NOT_AUTHORIZED"

    # Section 9.2: the original bytes are not flipped, rehashed, or scrubbed.
    assert path.read_bytes() == original


def test_a_misleading_legacy_history_reports_the_mismatch(tmp_path: Path) -> None:
    root = tmp_path / "store"
    legacy = root / "events"
    legacy.mkdir(parents=True)
    import hashlib

    run_id = "python-succeeded"
    lines = []
    for line in LEGACY_JOURNALS[run_id].splitlines():
        document = json.loads(line)
        document["redacted"] = True
        lines.append(json.dumps(document, sort_keys=True))
    path = legacy / f"{hashlib.sha256(run_id.encode('utf-8')).hexdigest()}.jsonl"
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    async def scenario() -> DurableRunError:
        store = file_journal(root)
        with pytest.raises(DurableRunError) as error:
            await resume_graph_run(
                compile_graph(json.loads(json.dumps(DIAMOND))),
                run_id=run_id,
                implementation_id="operations-test",
                event_store=store,
                payload_protection=file_protection(root / "protected"),
            )
        return error.value

    error = asyncio.run(scenario())
    assert error.code is DurableRunErrorCode.LEGACY_HISTORY_UNSAFE
    assert error.details["redactionCode"] == "LEGACY_REDACTION_MISMATCH"


# ----------------------------------------------------------------------
# Section 4.4: policy identity on resume.


def test_a_different_capture_policy_cannot_resume_the_run() -> None:
    async def scenario() -> DurableRunError:
        store = memory_journal()
        await start_graph_run(
            single_graph(),
            {"question": "synthetic"},
            {"root": lambda _: (_ for _ in ()).throw(RuntimeError("stop"))},
            run_id="policy-identity",
            implementation_id="v1",
            event_store=store,
            payload_protection=memory_protection(),
            clock=fixed_clock,
        )
        with pytest.raises(DurableRunError) as error:
            await resume_graph_run(
                single_graph(),
                run_id="policy-identity",
                implementation_id="v1",
                event_store=store,
                payload_protection=memory_protection(key_ref="test://deterministic/key-2"),
                clock=fixed_clock,
            )
        return error.value

    error = asyncio.run(scenario())
    assert error.code is DurableRunErrorCode.CAPTURE_POLICY_MISMATCH


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
        {"id": "root-left", "from": {"node": "root"}, "to": {"node": "left", "port": "root"}},
        {"id": "root-right", "from": {"node": "root"}, "to": {"node": "right", "port": "root"}},
        {"id": "left-join", "from": {"node": "left"}, "to": {"node": "join", "port": "left"}},
        {"id": "right-join", "from": {"node": "right"}, "to": {"node": "join", "port": "right"}},
    ],
}
