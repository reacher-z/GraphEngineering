#!/usr/bin/env python3
"""Run the shared crash/resume case through the native Python runtime.

`spec/redaction-semantics.md` Section 4.2 makes a configured protected payload
store plus key provider a precondition of every durable run, so this report
configures the guarded `events/v1alpha2` write path exactly as a durable
deployment must: a `GuardedMemoryEventStore` journal and a `PayloadProtection`
built from the clearly named deterministic test key provider and an in-memory
protected payload store.  There is no unguarded fallback to fall back to.

Because every authoritative value now exists on the wire only as a
`protected-ref`, the cross-language comparison cannot be a byte comparison of
`data`.  This report therefore emits three separable projections:

* the closed metadata envelope of every committed event, minus the members whose
  value is an opaque per-call reference (see `OPAQUE_REFERENCE_MEMBERS`) — but
  including the full sorted member-name list, so a missing or extra member is
  still caught;
* the recovered (decrypted, AAD-authenticated) value behind every protected
  reference, which is what the raw `data` members used to carry; and
* the scheduler-observable result of the resume, unchanged from before.
"""

from __future__ import annotations

import asyncio
import dataclasses
import json
from pathlib import Path
from typing import Any

from graph_engineering import (
    NodeContext,
    PayloadProtection,
    compile_graph,
    resume_graph_run,
    start_graph_run,
)
from graph_engineering.events import ProtectedGraphEvent
from graph_engineering.persistence import GuardedMemoryEventStore
from graph_engineering.redaction.errors import RedactionFailure
from graph_engineering.redaction.keys import DeterministicTestKeyProvider
from graph_engineering.redaction.policy import CapturePolicy
from graph_engineering.redaction.protect import (
    MemoryProtectedPayloadStore,
    diagnostic_evidence_context,
    graph_input_context,
    node_input_context,
    node_output_context,
    node_result_context,
    run_result_context,
)

ROOT = Path(__file__).resolve().parents[2]
CASE_PATH = ROOT / "spec" / "conformance" / "durable-resume.case.json"
FIXED_TIME = "2026-07-26T12:00:00.000Z"

#: `data` members that cannot be compared byte-for-byte across the two lanes.
#:
#: This set used to hold every key-derived member on the stated grounds that "the
#: two lanes ship different deterministic test providers, so these values are
#: language-local".  That is no longer true: both lanes now derive protection
#: keys, identity keys and nonces from one shared rule, so `activityKey`,
#: `capturePolicyHash`, `keyRefHash` and every `*Mac` are byte-identical and are
#: compared directly.
#:
#: What remains is the opaque reference object itself. Its `ref` is a fresh
#: `uuid4` minted per protect call, which is deliberately not a function of
#: anything — the point of the reference is that it carries no filename, path,
#: tenant or key identity. Its `aadHash` and `ciphertextHash` are compared
#: through the recovered projection instead, which authenticates the reference
#: under its exact event AAD before returning the value.
OPAQUE_REFERENCE_MEMBERS = frozenset(
    {
        "evidenceRef",
        "inputRef",
        "outputRef",
        "resultRef",
    }
)

#: `capturePolicyHash` is excluded for one specific, named reason, and the thing
#: it stands for is compared directly instead (see :func:`capture_policy_modes`).
#:
#: The two lanes ship the same nineteen control modes and the same diagnostic
#: limit, but different ``transform_implementation_hash``,
#: ``rule_registry_version`` and ``rule_registry_hash`` — a redaction-policy
#: divergence that is not this lane's to settle.  Excluding the hash without
#: comparing the modes would hide that; this comparison makes the modes a gate
#: and leaves exactly the three known fields outstanding.
POLICY_HASH_MEMBERS = frozenset({"capturePolicyHash"})

#: The capture-policy fields that are derived rather than declared modes.
_DERIVED_POLICY_FIELDS = frozenset(
    {
        "key_ref",
        "redaction_rules",
        "rule_registry_hash",
        "rule_registry_version",
        "transform_implementation_hash",
    }
)


def capture_policy_modes(policy: CapturePolicy) -> dict[str, Any]:
    """The semantic content of a capture policy: every control mode it declares.

    The member names are emitted in the TypeScript lane's spelling so the two
    reports compare as documents rather than as two different vocabularies.
    """

    def camel(name: str) -> str:
        head, *rest = name.split("_")
        return head + "".join(part.title() for part in rest)

    return {
        camel(field.name): getattr(policy, field.name)
        for field in sorted(dataclasses.fields(policy), key=lambda item: camel(item.name))
        if field.name not in _DERIVED_POLICY_FIELDS
        and getattr(policy, field.name) is not None
    }

#: The protected reference each event type carries, and the semantic context it
#: is bound to.  This mirrors the runtime's own field map on both lanes.
PROTECTED_FIELDS: dict[str, tuple[str, str]] = {
    "RunCreated": ("inputRef", "graph-input"),
    "NodeScheduled": ("inputRef", "node-input"),
    "NodeSucceeded": ("outputRef", "node-output"),
    "NodeSettledWithoutAttempt": ("resultRef", "node-result"),
    "RunSucceeded": ("resultRef", "run-result"),
    "RunFailed": ("resultRef", "run-result"),
    "RunCancelled": ("resultRef", "run-result"),
    "NodeAttemptFailed": ("evidenceRef", "diagnostic-evidence"),
}


class ProcessLost(BaseException):
    """Escape normal attempt handling to model abrupt process loss."""


def _semantic_context(kind: str, event: ProtectedGraphEvent) -> dict[str, Any]:
    revision = event.graph_revision
    if kind == "graph-input":
        return dict(graph_input_context(event.run_id, revision))
    if kind == "run-result":
        return dict(run_result_context(event.run_id, revision))
    node_id = event.node_id
    assert node_id is not None
    if kind == "node-input":
        return dict(node_input_context(event.run_id, revision, node_id))
    if kind == "node-output":
        return dict(node_output_context(event.run_id, revision, node_id))
    if kind == "node-result":
        return dict(node_result_context(event.run_id, revision, node_id))
    inline = event.data.get("failure")
    code = str(inline.get("code")) if isinstance(inline, dict) else ""
    assert event.attempt is not None
    return dict(
        diagnostic_evidence_context(
            event.run_id, revision, node_id, event.attempt, code
        )
    )


def envelope(event: ProtectedGraphEvent) -> dict[str, Any]:
    """The closed, key-independent metadata of one committed event.

    `eventId` and `payloadHash` are deliberately absent: the two lanes mint
    different default event identifiers (`runId:sequence` here, `runId.sequence`
    on the TypeScript lane) and `payloadHash` is the hash of a `data` member that
    now contains key-derived references.
    """

    return {
        "apiVersion": event.api_version,
        "sequence": event.sequence,
        "type": event.type,
        "nodeId": event.node_id,
        "edgeId": event.edge_id,
        "attempt": event.attempt,
        "timestamp": event.timestamp,
        "redacted": event.redacted,
        "payloadDisposition": event.payload_disposition,
        "dataKeys": sorted(event.data),
        "closedData": {
            name: value
            for name, value in sorted(event.data.items())
            if name not in OPAQUE_REFERENCE_MEMBERS and name not in POLICY_HASH_MEMBERS
        },
    }


def recovered_values(
    protection: PayloadProtection,
    events: tuple[ProtectedGraphEvent, ...],
) -> list[dict[str, Any]]:
    """Every protected reference in `events`, resolved back to its value.

    This is the projection the campaign compares in place of the raw inline
    `data` values that the pre-hard-cut history carried.
    """

    resolved: list[dict[str, Any]] = []
    for event in events:
        fields = PROTECTED_FIELDS.get(event.type)
        if fields is None:
            continue
        reference_field, kind = fields
        document = event.data.get(reference_field)
        if document is None:
            continue
        reference = protection.reference_from_document(document)
        if isinstance(reference, RedactionFailure):
            raise AssertionError(
                f"{event.type}.{reference_field} is not a valid protected reference:"
                f" {reference.code}"
            )
        value = protection.recover(
            reference,
            run_id=event.run_id,
            graph_revision=event.graph_revision,
            record_type=event.type,
            event_id=event.event_id,
            sequence=event.sequence,
            field_path=f"/data/{reference_field}",
            capture_policy_hash_value=event.capture_policy_hash,
            semantic_context=_semantic_context(kind, event),
            node_id=event.node_id,
            edge_id=event.edge_id,
            attempt=event.attempt,
        )
        if isinstance(value, RedactionFailure):
            raise AssertionError(
                f"{event.type}.{reference_field} did not authenticate under its"
                f" event AAD: {value.code}"
            )
        resolved.append(
            {
                "sequence": event.sequence,
                "type": event.type,
                "nodeId": event.node_id,
                "field": reference_field,
                "value": value,
            }
        )
    return resolved


async def execute() -> dict[str, Any]:
    case = json.loads(CASE_PATH.read_text(encoding="utf-8"))
    graph = compile_graph(case["graph"])
    # Section 4.2: the guarded journal and the protection authority are both
    # mandatory. An unconfigured run fails closed with
    # PAYLOAD_PROTECTION_REQUIRED before the first event or executor call.
    store = GuardedMemoryEventStore()
    protection = PayloadProtection(
        key_provider=DeterministicTestKeyProvider(),
        payload_store=MemoryProtectedPayloadStore(),
    )

    async def left(_: NodeContext) -> Any:
        return case["preCrash"]["succeeded"]["output"]

    async def right_crashes(_: NodeContext) -> Any:
        await asyncio.sleep(0.02)
        raise ProcessLost

    try:
        await start_graph_run(
            graph,
            case["graphInput"],
            {"left": left, "right": right_crashes, "merge": lambda _: None},
            run_id=case["runId"],
            implementation_id=case["implementationId"],
            event_store=store,
            payload_protection=protection,
            clock=lambda: FIXED_TIME,
        )
    except ProcessLost:
        pass
    else:
        raise AssertionError("the pre-crash execution unexpectedly completed")

    before_resume = await store.read(case["runId"])
    executor_calls: list[dict[str, Any]] = []
    merge_input: Any = None
    resumed_activity_keys: list[str | None] = []

    def left_must_not_run(_: NodeContext) -> Any:
        raise AssertionError("resume reran the committed left node")

    def right(context: NodeContext) -> Any:
        executor_calls.append({"nodeId": context.node.id, "attempt": context.attempt})
        resumed_activity_keys.append(context.activity_key)
        return case["resumeReturns"]["right"]

    def merge(context: NodeContext) -> Any:
        nonlocal merge_input
        executor_calls.append({"nodeId": context.node.id, "attempt": context.attempt})
        merge_input = context.input
        return case["resumeReturns"]["merge"]

    result = await resume_graph_run(
        graph,
        {"left": left_must_not_run, "right": right, "merge": merge},
        run_id=case["runId"],
        implementation_id=case["implementationId"],
        event_store=store,
        payload_protection=protection,
        clock=lambda: FIXED_TIME,
    )
    after_resume = await store.read(case["runId"])
    resumed = next(event for event in after_resume if event.type == "RunResumed")
    right_schedules = [
        event
        for event in after_resume
        if event.type == "NodeScheduled" and event.node_id == "right"
    ]

    terminal_calls = 0

    def terminal_must_not_run(_: NodeContext) -> Any:
        nonlocal terminal_calls
        terminal_calls += 1
        raise AssertionError("terminal resume invoked an executor")

    terminal_version = len(after_resume)
    terminal = await resume_graph_run(
        graph,
        {
            "left": terminal_must_not_run,
            "right": terminal_must_not_run,
            "merge": terminal_must_not_run,
        },
        run_id=case["runId"],
        implementation_id=case["implementationId"],
        event_store=store,
        payload_protection=protection,
        clock=lambda: FIXED_TIME,
    )
    final_history = await store.read(case["runId"])
    resume_events = after_resume[len(before_resume) :]

    return {
        "status": result.status.value,
        "output": dict(result.outputs or {}),
        "nodeStatuses": {
            node_id: node.status.value for node_id, node in result.nodes.items()
        },
        "attempts": {
            node_id: node.attempts for node_id, node in result.nodes.items()
        },
        "totalAttempts": result.total_attempts,
        "executorCalls": executor_calls,
        "mergeInput": merge_input,
        "reusedNodeIds": resumed.data["reusedNodeIds"],
        "interruptedNodeIds": resumed.data["interruptedNodeIds"],
        "preCrashEventTypes": [event.type for event in before_resume],
        "preCrashEnvelope": [envelope(event) for event in before_resume],
        "preCrashValues": recovered_values(protection, before_resume),
        "resumeEventTypes": [event.type for event in resume_events],
        "resumeEnvelope": [envelope(event) for event in resume_events],
        "resumeValues": recovered_values(protection, resume_events),
        "activityKeyStable": (
            len(right_schedules) == 2
            and right_schedules[0].data["activityKey"]
            == right_schedules[1].data["activityKey"]
            and resumed_activity_keys
            == [right_schedules[0].data["activityKey"]]
        ),
        "terminalResume": {
            "newEvents": len(final_history) - terminal_version,
            "executorCalls": terminal_calls,
            "sameResult": terminal == result,
        },
        "capturePolicyModes": capture_policy_modes(protection.policy),
        "capturePolicyNamesTheProviderKey": (
            protection.policy.key_ref == protection.key_provider.key_ref
        ),
    }


if __name__ == "__main__":
    print(
        json.dumps(
            asyncio.run(execute()),
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
    )
