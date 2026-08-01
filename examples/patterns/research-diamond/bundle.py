"""The shared, side-effect-free half of the Python lane of the bundle.

``run.py`` and ``resume.py`` both import from here so that "what the graph
does" is defined exactly once per language.  Everything below is a pure
function of the committed fixtures: nothing reads a clock, a network or an
environment variable.

The merge semantics here are the peer of ``synthesize`` in ``bundle.mjs`` and
must stay identical — both lanes are compared against the same
``fixtures/expected-run.json``.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from graph_engineering import (
    NodeContext,
    PayloadProtection,
    default_durable_capture_policy,
)
from graph_engineering.adapters import (
    AdapterCallOptions,
    AdapterDescriptor,
    AdapterRequest,
    MockOutcome,
    create_mock_adapter,
)
from graph_engineering.redaction import (
    DeterministicTestKeyProvider,
    MemoryProtectedPayloadStore,
)

HERE = Path(__file__).parent
RUN_ID = "research-diamond-bundle-001"
SOURCE_KEYS = ("code", "docs", "web")

ROLES = {
    "code": "Find executable examples and implementation constraints",
    "docs": "Find primary documentation and return cited facts",
    "web": "Find third-party reports and dated claims",
}


def source_options() -> list[dict[str, str]]:
    """The exact constructor input the committed bundle graph was built from."""

    return [{"key": key, "role": ROLES[key]} for key in SOURCE_KEYS]


def read_json(name: str) -> Any:
    return json.loads((HERE / name).read_text(encoding="utf-8"))


def scope_question(payload: Any) -> dict[str, Any]:
    """Decompose one question into one independent, bounded job per source."""

    question = payload["question"]
    assert isinstance(question, str)
    return {
        "question": question,
        "jobs": {
            key: {"sourceKey": key, "role": ROLES[key], "question": question}
            for key in SOURCE_KEYS
        },
    }


def synthesize(barrier_input: dict[str, Any]) -> dict[str, Any]:
    """Flatten, verify citations, deduplicate, and detect contradictions.

    Three rules, in order:

    1. A claim whose ``documentId`` is not in the manifest of documents that
       same source returned is never accepted.  That is the citation-laundering
       gate.
    2. Claims are keyed by ``claimId``, so the same claim found by two sources
       is one claim with two citations, not two claims.
    3. If the surviving citations for one claim disagree on stance, the claim is
       reported as a contradiction and is not accepted.  The pattern never
       silently picks a winner.
    """

    sources = sorted(barrier_input)
    unsupported: list[dict[str, Any]] = []
    by_claim: dict[str, dict[str, Any]] = {}

    for source in sources:
        record = barrier_input[source]
        manifest = {
            document["documentId"]: document["contentHash"] for document in record["documents"]
        }
        for claim in record["claims"]:
            content_hash = manifest.get(claim["documentId"])
            if content_hash is None:
                unsupported.append(
                    {
                        "claimId": claim["claimId"],
                        "source": source,
                        "documentId": claim["documentId"],
                        "reason": "citation-not-in-source-manifest",
                    }
                )
                continue
            entry = by_claim.setdefault(
                claim["claimId"], {"subject": claim["subject"], "citations": []}
            )
            entry["citations"].append(
                {
                    "source": source,
                    "stance": claim["stance"],
                    "text": claim["text"],
                    "documentId": claim["documentId"],
                    "contentHash": content_hash,
                    "retrievedAt": record["retrievedAt"],
                }
            )

    accepted: list[dict[str, Any]] = []
    contradictions: list[dict[str, Any]] = []
    multi_source: list[str] = []
    for claim_id in sorted(by_claim):
        entry = by_claim[claim_id]
        citations = sorted(entry["citations"], key=lambda citation: citation["source"])
        if len(citations) > 1:
            multi_source.append(claim_id)
        stances = sorted({citation["stance"] for citation in citations})
        if len(stances) > 1:
            contradictions.append(
                {
                    "claimId": claim_id,
                    "subject": entry["subject"],
                    "stances": stances,
                    "positions": [
                        {
                            "source": citation["source"],
                            "stance": citation["stance"],
                            "documentId": citation["documentId"],
                        }
                        for citation in citations
                    ],
                }
            )
            continue
        accepted.append(
            {
                "claimId": claim_id,
                "subject": entry["subject"],
                "stance": citations[0]["stance"],
                "text": citations[0]["text"],
                "citations": [
                    {
                        "source": citation["source"],
                        "documentId": citation["documentId"],
                        "contentHash": citation["contentHash"],
                        "retrievedAt": citation["retrievedAt"],
                    }
                    for citation in citations
                ],
            }
        )

    return {
        "question": barrier_input[sources[0]]["question"],
        "sources": sources,
        "acceptedClaims": accepted,
        "contradictions": contradictions,
        "unsupportedClaims": unsupported,
        "multiSourceClaimIds": multi_source,
        "coverage": {"sourcesReporting": len(sources), "sourcesFailed": 0},
    }


class Handlers:
    """Node handlers wired to one deterministic mock adapter per source.

    ``scripts`` optionally replaces one source's script — that is how the
    injected failure in ``resume.py`` is introduced without a second copy of
    this wiring.  ``arrive`` is an optional overlap gate, used only where every
    source is known to run.
    """

    def __init__(
        self,
        corpus: dict[str, Any],
        descriptor_document: dict[str, Any],
        *,
        scripts: dict[str, tuple[MockOutcome, ...]] | None = None,
        arrive: Any = None,
    ) -> None:
        self.dispatches = 0
        self.attempts: list[tuple[str, int]] = []
        self.adapters: dict[str, Any] = {}
        self._arrive = arrive
        self.map: dict[str, Any] = {
            "scope": self._scope,
            "synthesize": self._synthesize,
        }
        for key in SOURCE_KEYS:
            record = corpus["sources"][key]
            document = dict(
                descriptor_document,
                adapterId=f"{descriptor_document['adapterId']}-{key}",
            )
            script = (scripts or {}).get(key) or (
                MockOutcome(
                    text=f"source {key} reported {len(record['claims'])} claims",
                    # The source echoes the scoped question it answered, so the
                    # barrier is never told out of band what the run was about.
                    structured_output={**record, "sourceKey": key, "question": corpus["question"]},
                ),
            )
            adapter = create_mock_adapter(
                AdapterDescriptor.from_document(document), script=script
            )
            self.adapters[key] = adapter
            self.map[f"source-{key}"] = self._source_handler(key, adapter)

    async def _scope(self, context: NodeContext) -> Any:
        return scope_question(context.input)

    async def _synthesize(self, context: NodeContext) -> Any:
        return synthesize(dict(context.input))

    def _source_handler(self, key: str, adapter: Any) -> Any:
        async def handler(context: NodeContext) -> Any:
            self.dispatches += 1
            self.attempts.append((key, context.attempt))
            # The preflight view of a request never carries prompt text: a
            # refusal must not be able to quote a payload.
            request = AdapterRequest(
                request_id=f"research-{key}",
                side_effect_class="none",
                required_capabilities=("structured-output", "usage-reporting"),
                request_bytes=len(
                    json.dumps(context.input, sort_keys=True).encode("utf-8")
                ),
                structured_output=True,
            )
            outcome = await adapter.call(
                request, AdapterCallOptions(attempt=context.attempt)
            )
            if not outcome.ok:
                raise RuntimeError(outcome.error.code)
            if self._arrive is not None:
                await self._arrive()
            return outcome.value.structured_output

        return handler


def memory_protection() -> PayloadProtection:
    """A fully configured in-memory protected write path."""

    keys = DeterministicTestKeyProvider(key_ref="research-diamond://deterministic/key-1")
    return PayloadProtection(
        key_provider=keys,
        payload_store=MemoryProtectedPayloadStore(),
        policy=default_durable_capture_policy(keys.key_ref),
        # Opaque tenant and authority identity.  Never a personal identifier.
        tenant_scope_id="research-diamond-tenant",
        authority_provider_id="research-diamond-provider",
        authority_subject_id="research-diamond-subject",
    )


async def committed_events(store: Any, run_id: str, from_sequence: int = 0) -> list[list[Any]]:
    events = await store.read(run_id, from_sequence)
    return [[event.sequence, event.type, event.node_id] for event in events]


def render_trace(events: list[list[Any]]) -> dict[str, Any]:
    """Render parallelism versus barrier wait from the committed event order.

    This is an *event-order* trace, not a wall-clock one.  The scale is the
    journal sequence number, which is exactly reproducible; a duration chart
    would not be.
    """

    lanes: dict[str, list[int | None]] = {}
    for sequence, event_type, node_id in events:
        if node_id is None:
            continue
        lane = lanes.setdefault(node_id, [None, None])
        if event_type == "NodeStarted" and lane[0] is None:
            lane[0] = sequence
        if event_type in ("NodeSucceeded", "NodeAttemptFailed"):
            lane[1] = sequence
    width = len(events)
    rows = []
    for node_id, (start, end) in lanes.items():
        if start is None or end is None:
            continue
        cells = "".join("=" if start <= index <= end else "." for index in range(width))
        rows.append({"nodeId": node_id, "span": [start, end], "lane": cells})
    concurrent = sorted(
        row["nodeId"]
        for row in rows
        if any(
            other is not row
            and other["span"][0] <= row["span"][1]
            and row["span"][0] <= other["span"][1]
            for other in rows
        )
    )
    return {
        "scale": "journal sequence number, not wall clock",
        "rows": rows,
        "concurrentLanes": concurrent,
    }
