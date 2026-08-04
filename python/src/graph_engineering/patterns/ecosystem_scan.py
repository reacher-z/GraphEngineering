"""Pattern 10 — the scheduled ecosystem scan (reduced), native Python constructor.

The contract this file must hold is exact: for the same options, the document
returned here must equal the document returned by ``ecosystemScan`` in
``@graph-engineering/patterns`` under canonical JSON.  Node identity, source
key normalization, edge identity, normalize port names, the reserved pattern
labels, the named output key and the derived policies are all decided here in
the same way the TypeScript constructor decides them.

Like its TypeScript peer this constructor declares no schedule, no budget, no
permission, no network policy and no isolation.  The master-plan Pattern 10 is
*scheduled*, but no scheduler, schedule identity or overlap lease exists in
this repository, so the graph carries none — every run is started explicitly
by a caller.  The ``normalize`` barrier is the static all-success
``{"condition": "all"}`` join, not an integrated barrier policy: a permanently
failed source means no digest at all.
"""

from __future__ import annotations

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

_PATTERN_LABEL: Final = "graphengineering.reacher-z.github.io/pattern"
_CAPABILITY_LABEL: Final = "graphengineering.reacher-z.github.io/runtime-capability"
_API_VERSION: Final = "graphengineering.reacher-z.github.io/v1alpha1"

_OBJECT_SCHEMA: Final[dict[str, JsonValue]] = {"type": "object"}
_DESCRIPTION: Final = (
    "Enumerate a versioned source inventory, fetch in parallel, "
    "normalize at one barrier, then rank one digest"
)


@dataclass(frozen=True, slots=True)
class ScanSource:
    """One independent, bounded fetch job against a declared feed."""

    key: str
    feed: str


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


def _normalized_sources(sources: object) -> tuple[ScanSource, ...]:
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

    parsed: list[ScanSource] = []
    seen: set[str] = set()
    for index, item in enumerate(sources):
        path = f"#/sources/{index}"
        if isinstance(item, ScanSource):
            key_value: object = item.key
            feed_value: object = item.feed
        elif isinstance(item, dict):
            unknown = sorted(set(item) - {"key", "feed"})
            if unknown:
                raise PatternInputError(
                    "GE_PATTERN_UNKNOWN_FIELD",
                    f"unknown source field '{unknown[0]}'",
                    f"{path}/{unknown[0]}",
                )
            key_value = item.get("key")
            feed_value = item.get("feed")
        else:
            raise PatternInputError(
                "GE_PATTERN_INVALID_INPUT", "expected a mapping or ScanSource", path
            )

        key = _safe_key(key_value, f"{path}/key", "source key")
        if key in seen:
            raise PatternInputError(
                "GE_PATTERN_DUPLICATE_KEY", f"duplicate source key '{key}'", f"{path}/key"
            )
        seen.add(key)
        if not isinstance(feed_value, str) or feed_value == "":
            raise PatternInputError(
                "GE_PATTERN_INVALID_INPUT",
                "source feed must be a non-empty string",
                f"{path}/feed",
            )
        parsed.append(ScanSource(key=key, feed=feed_value))

    # Unicode code-point order, exactly as the TypeScript ``diamond`` normalizes
    # keyed workers. Python string comparison is already code-point ordered.
    return tuple(sorted(parsed, key=lambda source: source.key))


def _fetch_node(source: ScanSource, max_attempts: int) -> dict[str, JsonValue]:
    return {
        "config": {"feed": source.feed, "sourceKey": source.key},
        "id": f"fetch-{source.key}",
        "inputSchema": _object_schema(),
        "kind": "agent",
        "outputSchema": _object_schema(),
        "retry": {"maxAttempts": max_attempts},
        "sideEffects": "none",
    }


def ecosystem_scan(
    *,
    sources: object,
    name: str = "ecosystem-scan",
    version: str = "1.0.0",
    inventory_version: str = "1",
    max_attempts_per_fetch: int = 2,
) -> dict[str, JsonValue]:
    """Build the Pattern 10 ecosystem scan (reduced) as portable Graph IR.

    ``inventory`` fans out to one ``fetch-<key>`` node per source, every fetch
    result reaches a unique ``normalize`` input port named by its key,
    ``normalize`` is the single all-success fan-in barrier, and ``digest`` is
    the final global-ranking transform and the named graph output.

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
    if not isinstance(inventory_version, str) or inventory_version == "":
        raise PatternInputError(
            "GE_PATTERN_INVALID_INPUT",
            "inventory_version must be a non-empty string",
            "#/inventoryVersion",
        )
    if (
        type(max_attempts_per_fetch) is not int
        or max_attempts_per_fetch < 1
        or max_attempts_per_fetch > _MAX_ATTEMPTS_CEILING
    ):
        raise PatternInputError(
            "GE_PATTERN_INVALID_INPUT",
            f"max_attempts_per_fetch must be an integer from 1 through {_MAX_ATTEMPTS_CEILING}",
            "#/maxAttemptsPerFetch",
        )

    normalized = _normalized_sources(sources)
    keys = [source.key for source in normalized]
    # Built element by element rather than annotated from `sorted`: `list` is
    # invariant, so `list[str]` is not assignable to `list[JsonValue]`.
    declared_keys: list[JsonValue] = list(sorted(keys))

    nodes: list[JsonValue] = [
        {
            "config": {
                "inventoryVersion": inventory_version,
                "operation": "inventory",
                "sources": declared_keys,
            },
            "id": "inventory",
            "inputSchema": _object_schema(),
            "kind": "transform",
            "outputSchema": _object_schema(),
            "sideEffects": "none",
        }
    ]
    nodes.extend(_fetch_node(source, max_attempts_per_fetch) for source in normalized)
    nodes.append(
        {
            "config": {"condition": "all"},
            "id": "normalize",
            "inputSchema": _object_schema(),
            "kind": "barrier",
            "outputSchema": _object_schema(),
            "sideEffects": "none",
        }
    )
    nodes.append(
        {
            "config": {"operation": "rank-digest"},
            "id": "digest",
            "inputSchema": _object_schema(),
            "kind": "transform",
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
                "from": {"node": "inventory"},
                "to": {"node": f"fetch-{key}"},
                "mode": "value",
            }
        )
        index += 1
    for key in keys:
        edges.append(
            {
                "id": f"ge-diamond-{index:04d}",
                "from": {"node": f"fetch-{key}"},
                "to": {"node": "normalize", "port": key},
                "mode": "value",
            }
        )
        index += 1
    edges.append(
        {
            "id": f"ge-diamond-{index:04d}",
            "from": {"node": "normalize"},
            "to": {"node": "digest"},
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
        "entrypoints": ["inventory"],
        "outputs": {"digest": {"node": "digest"}},
        "nodes": nodes,
        "edges": edges,
        "policies": {
            "maxConcurrency": len(normalized),
            "maxDepth": 4,
            "maxFanOut": len(normalized),
            "maxTotalAttempts": 3 + len(normalized) * max_attempts_per_fetch,
        },
    }
