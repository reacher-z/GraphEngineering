"""Pattern 02 — cited deep research (reduced), native Python constructor.

The contract this file must hold is exact: for the same options, the document
returned here must equal the document returned by ``citedResearch`` in
``@graph-engineering/patterns`` under canonical JSON.  Node identity, source
key normalization, edge identity, barrier port names, the fixed skeptic slot
numbering, the reserved pattern labels, the named output key and the derived
policies are all decided here in the same way the TypeScript constructor
decides them, and :func:`claim_id` is the same stable claim-identity rule as
``claimId`` — the first 12 lowercase hex characters of SHA-256 over the exact
UTF-8 claim text.

Like its TypeScript peer this constructor does not fan out per claim: the
master-plan Pattern 02 spawns one skeptic per extracted claim, which is
runtime graph growth, and the delivered runtimes refuse that pre-dispatch
(``maxDynamicNodes`` requires the unimplemented ``dynamic-graph-patch``
capability).  The skeptic stage is a fixed slot count chosen at construction
time.  The skeptics are ``agent`` nodes, not ``validator`` nodes, because the
``validator`` node kind is capability-gated and refused before dispatch.  Both
barriers are the static all-success ``{"condition": "all"}`` join, not
integrated barrier policies: a permanently failed source or skeptic means no
verdicts at all.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from typing import Final

from ..models import JsonValue
from .research_diamond import PatternInputError

_KEY_IDENTIFIER: Final = re.compile(r"^[A-Za-z][A-Za-z0-9_.-]{0,63}$")
_GRAPH_NAME: Final = re.compile(r"^[a-z][a-z0-9-]{0,62}$")
_RESERVED_KEYS: Final = frozenset({"__proto__", "constructor", "prototype"})
_MAX_SOURCES: Final = 100
_MAX_ATTEMPTS_CEILING: Final = 8
_MAX_SKEPTIC_SLOTS: Final = 8
_CLAIM_ID_HEX_LENGTH: Final = 12

_PATTERN_LABEL: Final = "graphengineering.reacher-z.github.io/pattern"
_CAPABILITY_LABEL: Final = "graphengineering.reacher-z.github.io/runtime-capability"
_API_VERSION: Final = "graphengineering.reacher-z.github.io/v1alpha1"

_OBJECT_SCHEMA: Final[dict[str, JsonValue]] = {"type": "object"}
_DESCRIPTION: Final = (
    "Scope one question into cited source jobs, extract stable claims at one barrier, "
    "adversarially review fixed claim slots, then adjudicate verdicts behind a "
    "citation-coverage gate"
)


@dataclass(frozen=True, slots=True)
class CitedSource:
    """One independent, bounded source job."""

    key: str
    role: str


def claim_id(text: object) -> str:
    """The stable claim identity rule shared with the TypeScript lane.

    The first 12 lowercase hex characters of SHA-256 over the exact UTF-8
    claim text.  The id is a function of the exact text and nothing else: a
    paraphrased duplicate claim gets a different id — a documented limitation,
    not a feature.
    """

    if not isinstance(text, str) or text == "":
        raise PatternInputError(
            "GE_PATTERN_INVALID_INPUT", "claim text must be a non-empty string", "#/text"
        )
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:_CLAIM_ID_HEX_LENGTH]


def _object_schema() -> dict[str, JsonValue]:
    return dict(_OBJECT_SCHEMA)


def _safe_key(value: object, path: str, description: str) -> str:
    if (
        not isinstance(value, str)
        or _KEY_IDENTIFIER.match(value) is None
        or value in _RESERVED_KEYS
    ):
        raise PatternInputError(
            "GE_PATTERN_INVALID_IDENTIFIER",
            f"{description} must match {_KEY_IDENTIFIER.pattern} and not be a reserved key",
            path,
        )
    return value


def _normalized_sources(sources: object) -> tuple[CitedSource, ...]:
    if isinstance(sources, str) or not isinstance(sources, (list, tuple)):
        raise PatternInputError("GE_PATTERN_INVALID_INPUT", "expected a sequence", "#/sources")
    if len(sources) == 0:
        raise PatternInputError(
            "GE_PATTERN_EMPTY_COLLECTION", "at least one source is required", "#/sources"
        )
    if len(sources) > _MAX_SOURCES:
        raise PatternInputError(
            "GE_PATTERN_TOO_MANY_ITEMS",
            f"at most {_MAX_SOURCES} sources are allowed",
            "#/sources",
        )

    parsed: list[CitedSource] = []
    seen: set[str] = set()
    for index, item in enumerate(sources):
        path = f"#/sources/{index}"
        if isinstance(item, CitedSource):
            key_value: object = item.key
            role_value: object = item.role
        elif isinstance(item, dict):
            unknown = sorted(set(item) - {"key", "role"})
            if unknown:
                raise PatternInputError(
                    "GE_PATTERN_UNKNOWN_FIELD",
                    f"unknown source field '{unknown[0]}'",
                    f"{path}/{unknown[0]}",
                )
            key_value = item.get("key")
            role_value = item.get("role")
        else:
            raise PatternInputError(
                "GE_PATTERN_INVALID_INPUT", "expected a mapping or CitedSource", path
            )

        key = _safe_key(key_value, f"{path}/key", "source key")
        if key in seen:
            raise PatternInputError(
                "GE_PATTERN_DUPLICATE_KEY", f"duplicate source key '{key}'", f"{path}/key"
            )
        seen.add(key)
        if not isinstance(role_value, str) or role_value == "":
            raise PatternInputError(
                "GE_PATTERN_INVALID_INPUT",
                "source role must be a non-empty string",
                f"{path}/role",
            )
        parsed.append(CitedSource(key=key, role=role_value))

    # Unicode code-point order, exactly as the TypeScript ``diamond`` normalizes
    # keyed workers. Python string comparison is already code-point ordered.
    return tuple(sorted(parsed, key=lambda source: source.key))


def _source_node(source: CitedSource, max_attempts: int) -> dict[str, JsonValue]:
    return {
        "config": {"role": source.role, "sourceKey": source.key},
        "id": f"source-{source.key}",
        "inputSchema": _object_schema(),
        "kind": "agent",
        "outputSchema": _object_schema(),
        "retry": {"maxAttempts": max_attempts},
        "sideEffects": "none",
    }


def _skeptic_node(slot: int, max_attempts: int) -> dict[str, JsonValue]:
    return {
        "config": {"operation": "adversarial-review", "slot": slot},
        "id": f"skeptic-{slot}",
        "inputSchema": _object_schema(),
        "kind": "agent",
        "outputSchema": _object_schema(),
        "retry": {"maxAttempts": max_attempts},
        "sideEffects": "none",
    }


def cited_research(
    *,
    sources: object,
    name: str = "cited-research",
    version: str = "1.0.0",
    skeptic_slots: int = 3,
    max_attempts_per_agent: int = 2,
) -> dict[str, JsonValue]:
    """Build the Pattern 02 cited deep research graph (reduced) as Graph IR.

    ``scope`` fans out to one ``source-<key>`` node per source, every source
    result reaches a unique ``claims`` input port named by its key, ``claims``
    is the first all-success fan-in barrier and the sole place claims gain
    their stable hash-derived identity, a fixed set of ``skeptic-<n>`` agent
    nodes each review one claim slot, and ``adjudicate`` — fed by every
    skeptic port plus the direct ``claims`` port — is the final barrier and
    the named graph output (``verdicts``).

    The returned value is a plain portable-JSON document.  It is not compiled
    here; callers pass it to :func:`graph_engineering.compile_graph`, which is
    the only authority on graph validity.
    """

    if not isinstance(name, str) or _GRAPH_NAME.match(name) is None:
        raise PatternInputError(
            "GE_PATTERN_INVALID_IDENTIFIER",
            f"graph metadata name must match {_GRAPH_NAME.pattern}",
            "#/name",
        )
    if not isinstance(version, str) or version == "":
        raise PatternInputError(
            "GE_PATTERN_INVALID_INPUT",
            "graph metadata version must be a non-empty string",
            "#/version",
        )
    if (
        type(max_attempts_per_agent) is not int
        or max_attempts_per_agent < 1
        or max_attempts_per_agent > _MAX_ATTEMPTS_CEILING
    ):
        raise PatternInputError(
            "GE_PATTERN_INVALID_INPUT",
            f"max_attempts_per_agent must be an integer from 1 through {_MAX_ATTEMPTS_CEILING}",
            "#/maxAttemptsPerAgent",
        )
    if (
        type(skeptic_slots) is not int
        or skeptic_slots < 1
        or skeptic_slots > _MAX_SKEPTIC_SLOTS
    ):
        raise PatternInputError(
            "GE_PATTERN_INVALID_INPUT",
            f"skeptic_slots must be an integer from 1 through {_MAX_SKEPTIC_SLOTS}",
            "#/skepticSlots",
        )

    normalized = _normalized_sources(sources)
    keys = [source.key for source in normalized]
    slots = list(range(1, skeptic_slots + 1))
    # Built element by element rather than annotated from `sorted`: `list` is
    # invariant, so `list[str]` is not assignable to `list[JsonValue]`.
    declared_keys: list[JsonValue] = list(sorted(keys))

    nodes: list[JsonValue] = [
        {
            "config": {
                "claimSlots": skeptic_slots,
                "operation": "scope",
                "sources": declared_keys,
            },
            "id": "scope",
            "inputSchema": _object_schema(),
            "kind": "transform",
            "outputSchema": _object_schema(),
            "sideEffects": "none",
        }
    ]
    nodes.extend(_source_node(source, max_attempts_per_agent) for source in normalized)
    nodes.append(
        {
            "config": {"condition": "all"},
            "id": "claims",
            "inputSchema": _object_schema(),
            "kind": "barrier",
            "outputSchema": _object_schema(),
            "sideEffects": "none",
        }
    )
    nodes.extend(_skeptic_node(slot, max_attempts_per_agent) for slot in slots)
    nodes.append(
        {
            "config": {"condition": "all"},
            "id": "adjudicate",
            "inputSchema": _object_schema(),
            "kind": "barrier",
            "outputSchema": _object_schema(),
            "sideEffects": "none",
        }
    )

    edges: list[JsonValue] = []
    index = 1
    for key in keys:
        edges.append(
            {
                "id": f"ge-diamond-{index:04d}",
                "from": {"node": "scope"},
                "to": {"node": f"source-{key}"},
                "mode": "value",
            }
        )
        index += 1
    for key in keys:
        edges.append(
            {
                "id": f"ge-diamond-{index:04d}",
                "from": {"node": f"source-{key}"},
                "to": {"node": "claims", "port": key},
                "mode": "value",
            }
        )
        index += 1
    for slot in slots:
        edges.append(
            {
                "id": f"ge-diamond-{index:04d}",
                "from": {"node": "claims"},
                "to": {"node": f"skeptic-{slot}"},
                "mode": "value",
            }
        )
        index += 1
    for slot in slots:
        edges.append(
            {
                "id": f"ge-diamond-{index:04d}",
                "from": {"node": f"skeptic-{slot}"},
                "to": {"node": "adjudicate", "port": f"skeptic-{slot}"},
                "mode": "value",
            }
        )
        index += 1
    edges.append(
        {
            "id": f"ge-diamond-{index:04d}",
            "from": {"node": "claims"},
            "to": {"node": "adjudicate", "port": "claims"},
            "mode": "value",
        }
    )

    return {
        "apiVersion": _API_VERSION,
        "kind": "Graph",
        "metadata": {
            "description": _DESCRIPTION,
            "labels": {
                _PATTERN_LABEL: "diamond/v1alpha1",
                _CAPABILITY_LABEL: "dag/v1alpha1",
            },
            "name": name,
            "version": version,
        },
        "inputSchema": _object_schema(),
        "outputSchema": _object_schema(),
        "entrypoints": ["scope"],
        "outputs": {"verdicts": {"node": "adjudicate"}},
        "nodes": nodes,
        "edges": edges,
        "policies": {
            "maxConcurrency": max(len(normalized), skeptic_slots),
            "maxDepth": 5,
            "maxFanOut": max(len(normalized), skeptic_slots + 1),
            "maxTotalAttempts": 3 + (len(normalized) + skeptic_slots) * max_attempts_per_agent,
        },
    }
