"""The shared, side-effect-free half of the Python lane of the bundle.

``run.py`` and ``resume.py`` both import from here so that "what the graph
does" is defined exactly once per language.  Everything below is a pure
function of the committed fixtures: nothing reads a clock, a network or an
environment variable.  Every date in every output below came out of
``fixtures/sources.json``.

The normalize and digest semantics here are the peers of ``normalize`` and
``digest`` in ``bundle.mjs`` and must stay identical — both lanes are compared
against the same ``fixtures/expected-run.json``.
"""

from __future__ import annotations

import json
import re
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
RUN_ID = "ecosystem-scan-bundle-001"
SOURCE_KEYS = ("advisories", "registry", "releases")
INVENTORY_VERSION = "2026-01"

FEEDS = {
    "advisories": "advisories://example.invalid/security",
    "registry": "registry://example.invalid/packages",
    "releases": "releases://example.invalid/graph-engineering",
}

_ALL_DIGITS = re.compile(r"^\d+$")


def source_options() -> list[dict[str, str]]:
    """The exact constructor input the committed bundle graph was built from."""

    return [{"key": key, "feed": FEEDS[key]} for key in SOURCE_KEYS]


def read_json(name: str) -> Any:
    return json.loads((HERE / name).read_text(encoding="utf-8"))


def build_inventory(payload: Any) -> dict[str, Any]:
    """Enumerate one independent, bounded fetch job per declared source."""

    inventory_version = payload["inventoryVersion"]
    window = payload["window"]
    assert isinstance(inventory_version, str)
    assert isinstance(window["from"], str)
    assert isinstance(window["to"], str)
    return {
        "inventoryVersion": inventory_version,
        "window": window,
        "jobs": {
            key: {"sourceKey": key, "feed": FEEDS[key], "window": window}
            for key in SOURCE_KEYS
        },
    }


def compare_versions(left: str, right: str) -> int:
    """Total order over version strings, identical to ``bundle.mjs``.

    Dot-separated segments, numeric when both segments are all digits,
    code-point order otherwise, missing segments read as ``"0"``.
    """

    left_parts = left.split(".")
    right_parts = right.split(".")
    for index in range(max(len(left_parts), len(right_parts))):
        a = left_parts[index] if index < len(left_parts) else "0"
        b = right_parts[index] if index < len(right_parts) else "0"
        if _ALL_DIGITS.match(a) and _ALL_DIGITS.match(b):
            difference = int(a) - int(b)
            if difference != 0:
                return difference
        elif a != b:
            return -1 if a < b else 1
    return 0


def normalize(barrier_input: dict[str, Any]) -> dict[str, Any]:
    """Window-gate, deduplicate, and resolve version disagreements.

    Three rules, in order:

    1. An item published outside the scan window is never kept.  It is dropped
       with reason ``published-outside-scan-window``; ISO-8601 strings compare
       lexicographically, so no date is ever parsed against a clock.
    2. Items are keyed by ``itemId``, so the same item syndicated by two
       sources is one item with two sightings, not two items.
    3. If the surviving sightings for one item disagree on version, the
       highest version wins (``highest-version-wins``) and the disagreement is
       reported in ``versionConflicts`` — resolved, but never hidden.  The
       canonical title, date and link come from the winning sighting; among
       equal versions the lowest source key wins.
    """

    sources = sorted(barrier_input)
    first = barrier_input[sources[0]]
    window = first["window"]
    inventory_version = first["inventoryVersion"]
    dropped: list[dict[str, Any]] = []
    by_item: dict[str, list[dict[str, Any]]] = {}

    for source in sources:
        record = barrier_input[source]
        assert record["window"] == window, "every fetch must echo the same scan window"
        for item in record["items"]:
            if item["publishedAt"] < window["from"] or item["publishedAt"] > window["to"]:
                dropped.append(
                    {
                        "itemId": item["itemId"],
                        "source": source,
                        "publishedAt": item["publishedAt"],
                        "reason": "published-outside-scan-window",
                    }
                )
                continue
            by_item.setdefault(item["itemId"], []).append(
                {
                    "source": source,
                    "title": item["title"],
                    "version": item["version"],
                    "publishedAt": item["publishedAt"],
                    "link": item["link"],
                    "retrievedAt": record["retrievedAt"],
                }
            )

    items: list[dict[str, Any]] = []
    duplicate_item_ids: list[str] = []
    version_conflicts: list[dict[str, Any]] = []
    for item_id in sorted(by_item):
        sightings = sorted(by_item[item_id], key=lambda sighting: sighting["source"])
        if len(sightings) > 1:
            duplicate_item_ids.append(item_id)
        versions = sorted({sighting["version"] for sighting in sightings})
        resolved_version = versions[0]
        for candidate in versions[1:]:
            if compare_versions(candidate, resolved_version) > 0:
                resolved_version = candidate
        if len(versions) > 1:
            version_conflicts.append(
                {
                    "itemId": item_id,
                    "reported": [
                        {
                            "source": sighting["source"],
                            "version": sighting["version"],
                            "publishedAt": sighting["publishedAt"],
                        }
                        for sighting in sightings
                    ],
                    "resolvedVersion": resolved_version,
                    "rule": "highest-version-wins",
                }
            )
        # Lowest source key among the winning-version sightings: deterministic.
        winner = next(
            sighting for sighting in sightings if sighting["version"] == resolved_version
        )
        items.append(
            {
                "itemId": item_id,
                "title": winner["title"],
                "version": resolved_version,
                "publishedAt": winner["publishedAt"],
                "link": winner["link"],
                "sources": [sighting["source"] for sighting in sightings],
                "sightings": [
                    {
                        "source": sighting["source"],
                        "version": sighting["version"],
                        "publishedAt": sighting["publishedAt"],
                        "link": sighting["link"],
                        "retrievedAt": sighting["retrievedAt"],
                    }
                    for sighting in sightings
                ],
            }
        )

    return {
        "inventoryVersion": inventory_version,
        "window": window,
        "sources": sources,
        "items": items,
        "duplicateItemIds": duplicate_item_ids,
        "versionConflicts": version_conflicts,
        "droppedItems": dropped,
        "coverage": {"sourcesReporting": len(sources), "sourcesFailed": 0},
    }


def digest(normalized: dict[str, Any]) -> dict[str, Any]:
    """Global ranking and digest, downstream of the barrier.

    Rank is by ``publishedAt`` descending (fixture dates, never a clock), ties
    broken by ``itemId`` ascending.  The digest carries the exact dates and
    links of every entry, and passes the normalize verdicts (conflicts, drops,
    duplicates) through unchanged.
    """

    ranked = sorted(
        normalized["items"],
        key=lambda item: (_descending(item["publishedAt"]), item["itemId"]),
    )
    entries = [
        {
            "rank": index + 1,
            "itemId": item["itemId"],
            "title": item["title"],
            "version": item["version"],
            "publishedAt": item["publishedAt"],
            "link": item["link"],
            "sources": item["sources"],
        }
        for index, item in enumerate(ranked)
    ]
    return {
        "inventoryVersion": normalized["inventoryVersion"],
        "window": normalized["window"],
        "generatedFrom": "committed fixture dates; no clock was read",
        "entries": entries,
        "duplicateItemIds": normalized["duplicateItemIds"],
        "versionConflicts": normalized["versionConflicts"],
        "droppedItems": normalized["droppedItems"],
        "coverage": normalized["coverage"],
    }


def _descending(timestamp: str) -> tuple[int, ...]:
    """Invert a code-point ordering without parsing the timestamp."""

    return tuple(-ord(character) for character in timestamp)


class Handlers:
    """Node handlers wired to one deterministic mock adapter per source.

    ``scripts`` optionally replaces one source's script — that is how the
    injected failure in ``resume.py`` is introduced without a second copy of
    this wiring.  ``arrive`` is an optional overlap gate, used only where every
    fetch is known to run.
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
            "inventory": self._inventory,
            "normalize": self._normalize,
            "digest": self._digest,
        }
        for key in SOURCE_KEYS:
            record = corpus["sources"][key]
            document = dict(
                descriptor_document,
                adapterId=f"{descriptor_document['adapterId']}-{key}",
            )
            script = (scripts or {}).get(key) or (
                MockOutcome(
                    text=f"source {key} reported {len(record['items'])} items",
                    # The fetch echoes the inventory version and window it
                    # answered, so the barrier is never told out of band what
                    # the scan was.
                    structured_output={
                        **record,
                        "sourceKey": key,
                        "inventoryVersion": corpus["inventoryVersion"],
                        "window": corpus["window"],
                    },
                ),
            )
            adapter = create_mock_adapter(
                AdapterDescriptor.from_document(document), script=script
            )
            self.adapters[key] = adapter
            self.map[f"fetch-{key}"] = self._fetch_handler(key, adapter)

    async def _inventory(self, context: NodeContext) -> Any:
        return build_inventory(context.input)

    async def _normalize(self, context: NodeContext) -> Any:
        return normalize(dict(context.input))

    async def _digest(self, context: NodeContext) -> Any:
        # A single un-ported edge binds its value under the upstream node id.
        return digest(context.input["normalize"])

    def _fetch_handler(self, key: str, adapter: Any) -> Any:
        async def handler(context: NodeContext) -> Any:
            self.dispatches += 1
            self.attempts.append((key, context.attempt))
            # The preflight view of a request never carries prompt text: a
            # refusal must not be able to quote a payload.
            request = AdapterRequest(
                request_id=f"scan-{key}",
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

    keys = DeterministicTestKeyProvider(key_ref="ecosystem-scan://deterministic/key-1")
    return PayloadProtection(
        key_provider=keys,
        payload_store=MemoryProtectedPayloadStore(),
        policy=default_durable_capture_policy(keys.key_ref),
        # Opaque tenant and authority identity.  Never a personal identifier.
        tenant_scope_id="ecosystem-scan-tenant",
        authority_provider_id="ecosystem-scan-provider",
        authority_subject_id="ecosystem-scan-subject",
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
