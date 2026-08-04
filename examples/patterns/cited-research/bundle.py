"""The shared, side-effect-free half of the Python lane of the bundle.

``run.py`` and ``resume.py`` both import from here so that "what the graph
does" is defined exactly once per language.  Everything below is a pure
function of the committed fixtures: nothing reads a clock, a network or an
environment variable.  Every claim, citation, contradiction and verdict below
came out of ``fixtures/sources.json``, and every claim id is recomputed from
the exact claim text through :func:`graph_engineering.patterns.claim_id` —
the same rule the TypeScript lane applies through ``claimId``.

The claims-extraction and adjudication semantics here are the peers of
``extractClaims`` and ``adjudicate`` in ``bundle.mjs`` and must stay
identical — both lanes are compared against the same
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
from graph_engineering.patterns import claim_id
from graph_engineering.redaction import (
    DeterministicTestKeyProvider,
    MemoryProtectedPayloadStore,
)

HERE = Path(__file__).parent
RUN_ID = "cited-research-bundle-001"
SOURCE_KEYS = ("changelog", "docs", "interviews")
SKEPTIC_SLOTS = 3

ROLES = {
    "changelog": "release history and changelog entries",
    "docs": "reference documentation and manifests",
    "interviews": "practitioner interview notes",
}


def source_options() -> list[dict[str, str]]:
    """The exact constructor input the committed bundle graph was built from."""

    return [{"key": key, "role": ROLES[key]} for key in SOURCE_KEYS]


def read_json(name: str) -> Any:
    return json.loads((HERE / name).read_text(encoding="utf-8"))


def build_scope(payload: Any) -> dict[str, Any]:
    """Decompose the question into one bounded source job per declared source."""

    question = payload["question"]
    assert isinstance(question, str)
    return {
        "question": question,
        "claimSlots": SKEPTIC_SLOTS,
        "jobs": {
            key: {"sourceKey": key, "role": ROLES[key], "question": question}
            for key in SOURCE_KEYS
        },
    }


def extract_claims(barrier_input: dict[str, Any]) -> dict[str, Any]:
    """Extract claims and give each one its stable identity.

    Three rules, in order:

    1. A claim's identity is ``claim_id(text)`` — the first 12 hex characters
       of SHA-256 over the exact claim text.  Two sources proposing the same
       text propose the same claim; their citations are merged, never
       double-counted as two claims.
    2. Claims are ordered by claim id, and only claims carrying at least one
       citation are assigned to the fixed skeptic slots, in that order.  An
       uncited claim holds no slot — it is dead on arrival at the coverage
       gate and adversarial review is not spent on it — but it is *kept*, and
       travels to the adjudicator on the direct ``claims`` port.
    3. More cited claims than slots is a loud failure, not a truncation.  The
       slot count is static because dynamic per-claim fan-out needs the
       ``dynamic-graph-patch`` capability, which the runtimes refuse.
    """

    sources = sorted(barrier_input)
    first = barrier_input[sources[0]]
    question = first["question"]
    by_claim: dict[str, dict[str, Any]] = {}
    source_items: dict[str, dict[str, Any]] = {}

    for source in sources:
        record = barrier_input[source]
        assert record["question"] == question, "every source must echo the same question"
        source_items[source] = {
            item["itemId"]: {"title": item["title"], "link": item["link"]}
            for item in record["items"]
        }
        for claim in record["claims"]:
            identifier = claim_id(claim["text"])
            entry = by_claim.setdefault(
                identifier,
                {"claimId": identifier, "text": claim["text"], "citations": [], "proposedBy": []},
            )
            assert entry["text"] == claim["text"], "one claim id must never carry two texts"
            entry["proposedBy"].append(source)
            for item_id in claim["citations"]:
                entry["citations"].append({"source": source, "itemId": item_id})

    claims = [by_claim[identifier] for identifier in sorted(by_claim)]
    cited = [claim for claim in claims if claim["citations"]]
    assert len(cited) <= SKEPTIC_SLOTS, (
        f"{len(cited)} cited claims exceed the {SKEPTIC_SLOTS} static skeptic slots"
    )
    slot_assignments: dict[str, str] = {}
    for index, claim in enumerate(cited):
        claim["slot"] = index + 1
        slot_assignments[str(index + 1)] = claim["claimId"]
    for claim in claims:
        claim.setdefault("slot", None)

    return {
        "question": question,
        "claimSlots": SKEPTIC_SLOTS,
        "claims": claims,
        "slotAssignments": slot_assignments,
        "sourceItems": source_items,
        "uncitedClaimIds": [claim["claimId"] for claim in claims if claim["slot"] is None],
    }


def adjudicate(barrier_input: dict[str, Any]) -> dict[str, Any]:
    """Verdicts, the citation-coverage gate, and the exportable evidence table.

    Verdict rules, in order, per claim (claims arrive sorted by claim id):

    1. **Citation-coverage gate.**  Every citation is resolved against the
       source items the claims barrier catalogued.  A claim with no
       resolvable citation is ``rejected`` with reason ``citation-coverage:
       cites no source item`` — recorded in the evidence table, never
       silently dropped.
    2. **Contradiction wins.**  If the claim's skeptic reports
       ``contradicted``, the verdict is ``contradicted`` and the
       counter-evidence — itself resolved against the source catalogue —
       stays in the table.
    3. **Corroboration.**  Citations from two or more distinct sources with
       no contradiction: ``supported``.
    4. Otherwise: ``insufficient-evidence`` — a single-source claim is kept
       but not accepted.

    The adjudicator also cross-checks every skeptic review: the reported
    slot, the reported claim id, and ``claim_id(reported claim text)`` must
    all agree with the slot assignment the claims barrier committed.
    """

    claims_record = barrier_input["claims"]
    reviews: dict[int, dict[str, Any]] = {}
    for slot in range(1, claims_record["claimSlots"] + 1):
        review = barrier_input[f"skeptic-{slot}"]
        assert review["slot"] == slot, "a skeptic must report its own slot"
        assert review["claimId"] == claims_record["slotAssignments"][str(slot)], (
            "a skeptic must review the claim assigned to its slot"
        )
        assert claim_id(review["claimText"]) == review["claimId"], (
            "a skeptic's claim text must hash to the claim id it reviewed"
        )
        reviews[slot] = review

    def resolve_item(reference: dict[str, Any]) -> dict[str, Any] | None:
        item = claims_record["sourceItems"].get(reference["source"], {}).get(
            reference["itemId"]
        )
        if item is None:
            return None
        return {
            "source": reference["source"],
            "itemId": reference["itemId"],
            "title": item["title"],
            "link": item["link"],
        }

    evidence_table: list[dict[str, Any]] = []
    verdicts: dict[str, list[str]] = {
        "supported": [],
        "contradicted": [],
        "insufficientEvidence": [],
        "rejected": [],
    }
    for claim in claims_record["claims"]:
        citations = [
            resolved
            for resolved in (resolve_item(reference) for reference in claim["citations"])
            if resolved is not None
        ]
        distinct_sources = sorted({citation["source"] for citation in citations})
        review = None if claim["slot"] is None else reviews[claim["slot"]]
        if len(citations) == 0:
            verdict = "rejected"
            accepted = False
            reason = "citation-coverage: cites no source item"
        elif review is not None and review["finding"] == "contradicted":
            verdict = "contradicted"
            accepted = False
            reason = "skeptic presented counter-evidence"
        elif len(distinct_sources) >= 2:
            verdict = "supported"
            accepted = True
            reason = (
                f"corroborated by {len(distinct_sources)} independent sources "
                "with no contradiction"
            )
        else:
            verdict = "insufficient-evidence"
            accepted = False
            reason = "single-source claim without independent corroboration"

        skeptic = None
        if review is not None:
            counter_evidence = None
            if review["counterEvidence"] is not None:
                counter_evidence = resolve_item(review["counterEvidence"])
                assert counter_evidence is not None, (
                    "counter-evidence must resolve to a source item"
                )
                counter_evidence = {**counter_evidence, "note": review["counterEvidence"]["note"]}
            skeptic = {
                "slot": review["slot"],
                "finding": review["finding"],
                "counterEvidence": counter_evidence,
            }

        evidence_table.append(
            {
                "claimId": claim["claimId"],
                "text": claim["text"],
                "proposedBy": sorted(claim["proposedBy"]),
                "citations": citations,
                "distinctSources": distinct_sources,
                "skeptic": skeptic,
                "verdict": verdict,
                "accepted": accepted,
                "reason": reason,
            }
        )
        if verdict == "supported":
            verdicts["supported"].append(claim["claimId"])
        elif verdict == "contradicted":
            verdicts["contradicted"].append(claim["claimId"])
        elif verdict == "insufficient-evidence":
            verdicts["insufficientEvidence"].append(claim["claimId"])
        else:
            verdicts["rejected"].append(claim["claimId"])

    return {
        "question": claims_record["question"],
        "generatedFrom": "committed fixture corpus; no provider was contacted and no clock was read",
        "evidenceTable": evidence_table,
        "verdicts": verdicts,
        "citationCoverage": {
            "requiredCitationsPerClaim": 1,
            "claimsTotal": len(claims_record["claims"]),
            "claimsCited": len(claims_record["claims"]) - len(verdicts["rejected"]),
            "claimsRejectedForNoCitation": verdicts["rejected"],
        },
        "slotAssignments": claims_record["slotAssignments"],
    }


class Handlers:
    """Node handlers wired to one deterministic mock adapter per agent node.

    ``scripts`` optionally replaces one source's script — that is how the
    injected failure in ``resume.py`` is introduced without a second copy of
    this wiring.  ``arrive_source`` and ``arrive_skeptic`` are optional
    overlap gates, used only where every lane is known to run.
    """

    def __init__(
        self,
        corpus: dict[str, Any],
        descriptor_document: dict[str, Any],
        *,
        scripts: dict[str, tuple[MockOutcome, ...]] | None = None,
        arrive_source: Any = None,
        arrive_skeptic: Any = None,
    ) -> None:
        self.dispatches = 0
        self.attempts: list[tuple[str, int]] = []
        self.adapters: dict[str, Any] = {}
        self.map: dict[str, Any] = {
            "scope": self._scope,
            "claims": self._claims,
            "adjudicate": self._adjudicate,
        }
        for key in SOURCE_KEYS:
            record = corpus["sources"][key]
            document = dict(
                descriptor_document,
                adapterId=f"{descriptor_document['adapterId']}-{key}",
            )
            script = (scripts or {}).get(key) or (
                MockOutcome(
                    text=f"source {key} proposed {len(record['claims'])} claims",
                    # The source echoes the question it answered, so the
                    # barrier is never told out of band what the research was.
                    structured_output={
                        "sourceKey": key,
                        "role": record["role"],
                        "question": corpus["question"],
                        "items": record["items"],
                        "claims": record["claims"],
                    },
                ),
            )
            adapter = create_mock_adapter(
                AdapterDescriptor.from_document(document), script=script
            )
            self.adapters[key] = adapter
            self.map[f"source-{key}"] = self._agent_handler(
                f"source-{key}", f"research-{key}", adapter, arrive_source
            )
        for slot in range(1, SKEPTIC_SLOTS + 1):
            entry = corpus["skeptics"][str(slot)]
            document = dict(
                descriptor_document,
                adapterId=f"{descriptor_document['adapterId']}-skeptic-{slot}",
            )
            script = (
                MockOutcome(
                    text=(
                        f"skeptic {slot} adversarially reviewed claim "
                        f"{claim_id(entry['claimText'])}"
                    ),
                    structured_output={
                        "slot": slot,
                        "claimId": claim_id(entry["claimText"]),
                        "claimText": entry["claimText"],
                        "finding": entry["finding"],
                        "counterEvidence": entry["counterEvidence"],
                    },
                ),
            )
            adapter = create_mock_adapter(
                AdapterDescriptor.from_document(document), script=script
            )
            self.adapters[f"skeptic-{slot}"] = adapter
            self.map[f"skeptic-{slot}"] = self._agent_handler(
                f"skeptic-{slot}", f"skeptic-{slot}", adapter, arrive_skeptic
            )

    async def _scope(self, context: NodeContext) -> Any:
        return build_scope(context.input)

    async def _claims(self, context: NodeContext) -> Any:
        return extract_claims(dict(context.input))

    async def _adjudicate(self, context: NodeContext) -> Any:
        return adjudicate(dict(context.input))

    def _agent_handler(self, node_id: str, request_id: str, adapter: Any, arrive: Any) -> Any:
        async def handler(context: NodeContext) -> Any:
            self.dispatches += 1
            self.attempts.append((node_id, context.attempt))
            # The preflight view of a request never carries prompt text: a
            # refusal must not be able to quote a payload.
            request = AdapterRequest(
                request_id=request_id,
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
            if arrive is not None:
                await arrive()
            return outcome.value.structured_output

        return handler


def memory_protection() -> PayloadProtection:
    """A fully configured in-memory protected write path."""

    keys = DeterministicTestKeyProvider(key_ref="cited-research://deterministic/key-1")
    return PayloadProtection(
        key_provider=keys,
        payload_store=MemoryProtectedPayloadStore(),
        policy=default_durable_capture_policy(keys.key_ref),
        # Opaque tenant and authority identity.  Never a personal identifier.
        tenant_scope_id="cited-research-tenant",
        authority_provider_id="cited-research-provider",
        authority_subject_id="cited-research-subject",
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
