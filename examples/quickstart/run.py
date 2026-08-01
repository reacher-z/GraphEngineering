#!/usr/bin/env python3
"""The Graph Engineering quickstart, Python lane.

Four things happen here, in order:

1. A research diamond runs on the native Python DAG scheduler.  The two
   research nodes are model-shaped: each one dispatches through the
   deterministic mock adapter, which enforces the same capability, bounds and
   usage rules every other adapter kind must satisfy.
2. The adapter refuses an undeclared capability before dispatch.
3. The same graph runs durably.  Payload protection is configured explicitly,
   and a durable run without it fails closed.
4. The run is resumed.  A terminal run replays from the journal and calls no
   handler at all.

No network access, no credential, no API key.  This is a native runtime, not a
client for the TypeScript one: it reads the same Graph IR and the same adapter
descriptor file that ``run.mjs`` reads.
"""

from __future__ import annotations

import asyncio
import json
import shutil
import tempfile
from pathlib import Path

from graph_engineering import (
    DurableRunError,
    DurableRunErrorCode,
    NodeContext,
    PayloadProtection,
    compile_graph,
    default_durable_capture_policy,
    resume_graph_run,
    run_graph,
    start_graph_run,
)
from graph_engineering.adapters import (
    AdapterCallOptions,
    AdapterDescriptor,
    AdapterRequest,
    MockOutcome,
    create_mock_adapter,
)
from graph_engineering.persistence import GuardedJsonlEventStore
from graph_engineering.redaction import EphemeralKeyProvider, FileProtectedPayloadStore

HERE = Path(__file__).parent
GRAPH_PATH = HERE / "research-diamond.graph.json"
DESCRIPTOR_PATH = HERE / "mock-adapter.descriptor.json"

TOPIC = "durable agent graphs"

DESCRIPTOR_DOCUMENT = json.loads(DESCRIPTOR_PATH.read_text(encoding="utf-8"))


def research_lane(lane: str, finding: str):
    """One scripted lane.  The mock returns exactly what the script declares."""

    document = dict(DESCRIPTOR_DOCUMENT, adapterId=f"quickstart-mock-{lane}")
    adapter = create_mock_adapter(
        AdapterDescriptor.from_document(document),
        script=(
            MockOutcome(text=finding, structured_output={"source": lane, "finding": finding}),
        ),
    )

    def request(payload: object) -> AdapterRequest:
        # The preflight view of a request carries no prompt text on purpose: a
        # refusal can never quote a payload.
        return AdapterRequest(
            request_id=f"research-{lane}",
            side_effect_class="none",
            required_capabilities=("structured-output", "usage-reporting"),
            request_bytes=len(json.dumps(payload, sort_keys=True).encode("utf-8")),
            structured_output=True,
        )

    async def handler(context: NodeContext):
        nonlocal_state["dispatches"] += 1
        outcome = await adapter.call(
            request(context.input), AdapterCallOptions(attempt=context.attempt)
        )
        if not outcome.ok:
            raise RuntimeError(outcome.error.code)
        return outcome.value.structured_output

    return adapter, handler


nonlocal_state = {"dispatches": 0}

docs_adapter, docs_handler = research_lane("docs", f"Document the contract for {TOPIC}")
code_adapter, code_handler = research_lane("code", f"Test the runtime for {TOPIC}")


async def scope(context: NodeContext):
    return context.input


async def synthesize(context: NodeContext):
    return context.input


HANDLERS = {
    "scope": scope,
    "research-docs": docs_handler,
    "research-code": code_handler,
    "synthesize": synthesize,
}


async def main() -> None:
    graph = compile_graph(json.loads(GRAPH_PATH.read_text(encoding="utf-8")))

    # ------------------------------------------------------------------
    # 1. Two model-shaped nodes on the deterministic mock adapter
    # ------------------------------------------------------------------
    result = await run_graph(graph, {"topic": TOPIC}, HANDLERS)
    assert result.status.value == "succeeded"
    assert result.max_observed_concurrency == 2, "the two research lanes must overlap"
    assert nonlocal_state["dispatches"] == 2

    # ------------------------------------------------------------------
    # 2. The adapter boundary is real: an undeclared capability is refused
    #    before dispatch, so the call performs zero usage.
    # ------------------------------------------------------------------
    refusal = await docs_adapter.call(
        AdapterRequest(
            request_id="streaming-probe",
            side_effect_class="none",
            request_bytes=16,
            streaming=True,
        )
    )
    assert not refusal.ok
    assert refusal.error.code == "GE_ADAPTER_CAPABILITY_UNSUPPORTED"
    assert refusal.error.boundary == "pre-dispatch"
    assert refusal.error.usage is None

    # ------------------------------------------------------------------
    # 3. The same graph, durably, with payload protection configured
    # ------------------------------------------------------------------
    directory = Path(tempfile.mkdtemp(prefix="ge-quickstart-"))
    run_id = "quickstart-research-001"
    try:
        # Key material is operator-owned.  This quickstart mints it per process
        # from the platform CSPRNG; a deployment holds it in a KMS.  It is never
        # written beside the ciphertext, so losing it means losing the journal —
        # that is the point.
        keys = EphemeralKeyProvider(key_ref="quickstart/ephemeral-key/v1")
        protection = PayloadProtection(
            key_provider=keys,
            payload_store=FileProtectedPayloadStore(directory),
            policy=default_durable_capture_policy(keys.key_ref),
            # Opaque tenant/authority identity.  Never a personal identifier.
            tenant_scope_id="quickstart-tenant",
            authority_provider_id="quickstart-provider",
            authority_subject_id="quickstart-subject",
        )
        event_store = GuardedJsonlEventStore(directory)

        # A durable run with no payload protection fails closed before the first
        # event, the first temporary file and the first handler call.
        failed_closed = None
        try:
            await start_graph_run(
                graph,
                {"topic": TOPIC},
                HANDLERS,
                run_id=run_id,
                implementation_id="quickstart-handlers@1",
                event_store=event_store,
                payload_protection=None,
            )
        except DurableRunError as error:
            failed_closed = error.code
        assert failed_closed is DurableRunErrorCode.PAYLOAD_PROTECTION_REQUIRED
        assert nonlocal_state["dispatches"] == 2, "a failed-closed run invokes no handler"

        durable = await start_graph_run(
            graph,
            {"topic": TOPIC},
            HANDLERS,
            run_id=run_id,
            implementation_id="quickstart-handlers@1",
            event_store=event_store,
            payload_protection=protection,
        )
        assert durable.status.value == "succeeded"
        assert nonlocal_state["dispatches"] == 4

        # Every authoritative application value reaches the journal only as a
        # validated protected reference.  The topic never appears on disk.
        journal_bytes = 0
        for path in sorted(directory.rglob("*")):
            if not path.is_file():
                continue
            payload = path.read_bytes()
            journal_bytes += len(payload)
            assert TOPIC.encode("utf-8") not in payload, f"plaintext topic leaked into {path.name}"

        # --------------------------------------------------------------
        # 4. Resume: a terminal run replays without calling a handler
        # --------------------------------------------------------------
        resumed = await resume_graph_run(
            graph,
            HANDLERS,
            run_id=run_id,
            implementation_id="quickstart-handlers@1",
            event_store=event_store,
            payload_protection=protection,
        )
        assert resumed.status.value == "succeeded"
        assert nonlocal_state["dispatches"] == 4, "resuming a terminal run calls no handler"
        assert resumed.outputs == durable.outputs
    finally:
        shutil.rmtree(directory, ignore_errors=True)

    print(
        json.dumps(
            {
                "1-parallel-run": {
                    "status": result.status.value,
                    "maxObservedConcurrency": result.max_observed_concurrency,
                    "adapterDispatches": 2,
                    "report": result.outputs["report"],
                },
                "2-adapter-boundary": {
                    "refusedCapability": "streaming",
                    "code": refusal.error.code,
                    "boundary": refusal.error.boundary,
                    "usage": refusal.error.usage,
                },
                "3-durable-protected": {
                    "unprotectedStart": failed_closed.value,
                    "status": durable.status.value,
                    "protectedJournalBytesOnDisk": journal_bytes,
                    "plaintextTopicOnDisk": False,
                },
                "4-resume": {
                    "status": resumed.status.value,
                    "totalAdapterDispatches": nonlocal_state["dispatches"],
                    "handlerCallsDuringResume": 0,
                },
            },
            indent=2,
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    asyncio.run(main())
