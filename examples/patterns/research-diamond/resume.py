#!/usr/bin/env python3
"""Pattern 01 — injected failure and resume.  Python lane.

Two failures are injected for real here.  Neither is described; both happen.

A. **A source fails and is retried.**  The ``web`` source's mock adapter is
   scripted to return ``GE_ADAPTER_RATE_LIMITED`` on its first attempt.  The
   node declares ``retry.maxAttempts = 2``, so the scheduler commits a
   ``NodeAttemptFailed``, a ``NodeRetried`` and then a successful second
   attempt.  The run succeeds with the same report as the nominal run.

B. **The process is lost mid-run and the run is resumed.**  A journal subclass
   commits its batch and then raises, exactly once, as soon as ``source-code``
   has a committed ``NodeSucceeded``.  ``start_graph_run`` raises
   ``DURABILITY_STORE_FAILED``.  The run is then resumed against the same
   journal with a handler for ``source-code`` that fails if it is ever invoked.
   It is not invoked: the committed source is reused, not re-fetched.

Both scenarios require payload protection to be configured — a durable run
without it fails closed before the first event and the first handler call,
which is also asserted below.

Run: uv run --project python python examples/patterns/research-diamond/resume.py
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

from bundle import (  # noqa: E402  (sibling module, loaded from this directory)
    Handlers,
    committed_events,
    memory_protection,
    read_json,
    render_trace,
)
from graph_engineering import (
    DurableRunError,
    DurableRunErrorCode,
    NodeContext,
    compile_graph,
    resume_graph_run,
    start_graph_run,
)
from graph_engineering.adapters import MockOutcome
from graph_engineering.persistence import GuardedMemoryEventStore

IMPLEMENTATION = "research-diamond-mock@1"
RATE_LIMITED_RUN_ID = "research-diamond-rate-limited-001"
RESUME_RUN_ID = "research-diamond-resume-001"


class CommitThenLoseProcess(GuardedMemoryEventStore):
    """A guarded journal that commits its batch and then loses the process, once.

    It is a subclass rather than a wrapper on purpose: a prepared sink write is
    bound to one journal *instance*, so a delegating proxy is rejected with
    ``PreparedSinkWriteMisuse`` before it can ever commit.  That refusal is the
    guard working; this subclass stays inside it and only fails *after* the
    commit it is observing has already happened.  It sees the closed metadata of
    what it committed — never a prepared write's contents, never a payload.
    """

    def __init__(self, should_raise: Any) -> None:
        super().__init__()
        self._should_raise = should_raise
        self.raised = False

    async def append(self, run_id: str, expected_version: int, prepared: Any) -> int:
        version = await super().append(run_id, expected_version, prepared)
        batch = await committed_events(self, run_id, expected_version + 1)
        if not self.raised and self._should_raise(batch):
            self.raised = True
            raise RuntimeError("simulated process loss after a durable commit")
        return version


async def main() -> None:
    graph_document = read_json("research-diamond.graph.json")
    corpus = read_json("fixtures/sources.json")
    descriptor_document = read_json("mock-adapter.descriptor.json")
    expected_run = read_json("fixtures/expected-run.json")
    expected_events = read_json("fixtures/expected-events.json")
    graph = compile_graph(graph_document)
    graph_input = {"question": corpus["question"]}

    # ------------------------------------------------------------------
    # A. An injected source failure, retried
    # ------------------------------------------------------------------
    web = corpus["sources"]["web"]
    injected = Handlers(
        corpus,
        descriptor_document,
        scripts={
            # Attempt 1 is refused by the provider; attempt 2 returns the corpus
            # record.  The last script entry repeats, so the node's own
            # `retry.maxAttempts = 2` is what bounds this, not the mock.
            "web": (
                MockOutcome(fail="GE_ADAPTER_RATE_LIMITED"),
                MockOutcome(
                    text=f"source web reported {len(web['claims'])} claims",
                    structured_output={
                        **web,
                        "sourceKey": "web",
                        "question": corpus["question"],
                    },
                ),
            )
        },
    )
    retry_store = GuardedMemoryEventStore()
    retry_run = await start_graph_run(
        graph,
        graph_input,
        injected.map,
        run_id=RATE_LIMITED_RUN_ID,
        implementation_id=IMPLEMENTATION,
        event_store=retry_store,
        payload_protection=memory_protection(),
        max_concurrency=3,
    )
    assert retry_run.status.value == "succeeded", retry_run.failures
    assert retry_run.outputs == expected_run["output"], "a retried source must not change the report"
    assert injected.dispatches == 4, "three sources, one of them dispatched twice"
    assert [attempt for key, attempt in injected.attempts if key == "web"] == [1, 2]
    retry_events = await committed_events(retry_store, RATE_LIMITED_RUN_ID)
    assert retry_events == expected_events["injectedSourceFailure"], (
        "injected-failure event sequence drifted from fixture"
    )
    web_node = retry_run.nodes["source-web"]
    assert web_node.status.value == "succeeded"
    assert web_node.attempts == 2, "the injected rate limit must have cost a real attempt"

    # ------------------------------------------------------------------
    # B. Process loss after a committed source, then resume
    # ------------------------------------------------------------------
    journal = CommitThenLoseProcess(
        lambda batch: any(
            event_type == "NodeSucceeded" and node_id == "source-code"
            for _, event_type, node_id in batch
        )
    )
    protection = memory_protection()

    # A durable run with no configured protection fails closed before the first
    # event, the first protected payload and the first handler call.
    preflight = Handlers(corpus, descriptor_document)
    failed_closed = None
    try:
        await start_graph_run(
            graph,
            graph_input,
            preflight.map,
            run_id=RESUME_RUN_ID,
            implementation_id=IMPLEMENTATION,
            event_store=journal,
            payload_protection=None,
        )
    except DurableRunError as error:
        failed_closed = error.code
    assert failed_closed is DurableRunErrorCode.PAYLOAD_PROTECTION_REQUIRED
    assert preflight.dispatches == 0, "a run that fails closed invokes no handler"

    before = Handlers(corpus, descriptor_document)
    crash_code = None
    try:
        await start_graph_run(
            graph,
            graph_input,
            before.map,
            run_id=RESUME_RUN_ID,
            implementation_id=IMPLEMENTATION,
            event_store=journal,
            payload_protection=protection,
            max_concurrency=3,
        )
    except DurableRunError as error:
        crash_code = error.code
    assert crash_code is DurableRunErrorCode.DURABILITY_STORE_FAILED, "the process loss must be real"
    assert journal.raised is True

    crash_history = await committed_events(journal, RESUME_RUN_ID)
    assert crash_history == expected_events["crashResume"]["beforeResume"], (
        "pre-crash event sequence drifted from fixture"
    )
    committed_sources = sorted(
        node_id
        for _, event_type, node_id in crash_history
        if event_type == "NodeSucceeded" and node_id is not None
    )
    assert "source-code" in committed_sources

    # The resume uses the same journal, run id and protection.  `source-code` is
    # committed, so its handler must never run again — this one raises if it does.
    after = Handlers(corpus, descriptor_document)

    async def never_again(context: NodeContext) -> Any:
        raise AssertionError("a committed source was re-fetched on resume")

    resume_handlers = dict(after.map)
    resume_handlers["source-code"] = never_again
    resumed = await resume_graph_run(
        graph,
        resume_handlers,
        run_id=RESUME_RUN_ID,
        implementation_id=IMPLEMENTATION,
        event_store=journal,
        payload_protection=protection,
        max_concurrency=3,
    )
    assert resumed.status.value == "succeeded", resumed.failures
    assert resumed.outputs == expected_run["output"], "the resumed report must equal the nominal one"

    resume_tail = await committed_events(journal, RESUME_RUN_ID, len(crash_history))
    assert resume_tail == expected_events["crashResume"]["afterResume"], (
        "resume event sequence drifted from fixture"
    )
    assert any(event_type == "RunResumed" for _, event_type, _ in resume_tail)

    # Resuming an already terminal run is a replay: no handler, no new event.
    terminal = Handlers(corpus, descriptor_document)
    replay = await resume_graph_run(
        graph,
        terminal.map,
        run_id=RESUME_RUN_ID,
        implementation_id=IMPLEMENTATION,
        event_store=journal,
        payload_protection=protection,
    )
    assert replay.status.value == "succeeded"
    assert replay.outputs == expected_run["output"]
    assert terminal.dispatches == 0, "a terminal resume must call no handler"
    after_replay = await committed_events(journal, RESUME_RUN_ID)
    assert len(after_replay) == len(crash_history) + len(resume_tail)

    print(
        json.dumps(
            {
                "schemaVersion": "graph-engineering.pattern-bundle-recovery/v1alpha1",
                "lane": "python",
                "injectedSourceFailure": {
                    "injected": "GE_ADAPTER_RATE_LIMITED on attempt 1 of source-web",
                    "status": retry_run.status.value,
                    "mockDispatches": injected.dispatches,
                    "webAttempts": [
                        attempt for key, attempt in injected.attempts if key == "web"
                    ],
                    "committedEvents": len(retry_events),
                    "reportUnchanged": True,
                },
                "crashAndResume": {
                    "failedClosedWithoutProtection": failed_closed.value,
                    "crashCode": crash_code.value,
                    "committedBeforeResume": len(crash_history),
                    "committedSourcesBeforeResume": committed_sources,
                    "resumeTail": [
                        event_type if node_id is None else f"{event_type}:{node_id}"
                        for _, event_type, node_id in resume_tail
                    ],
                    "committedSourceReExecuted": False,
                    "status": resumed.status.value,
                    "terminalReplayDispatches": terminal.dispatches,
                },
                "trace": render_trace(retry_events),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    asyncio.run(main())
