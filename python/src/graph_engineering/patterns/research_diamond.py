"""Pattern 01 — the multi-source research diamond, native Python constructor.

The contract this file must hold is exact: for the same options, the document
returned here must equal the document returned by ``researchDiamond`` in
``@graph-engineering/patterns`` under canonical JSON.  Node identity, source
key normalization, edge identity, merge port names, the reserved pattern
labels, the named output key and the derived policies are all decided here in
the same way the TypeScript constructor decides them.

Like its TypeScript peer this constructor declares no budget, no permission,
no network policy and no isolation.  No runtime in this repository enforces
any of those, and emitting them into the graph would make an ungoverned run
read as a governed one.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Final

from ..models import JsonValue

_KEY_IDENTIFIER: Final = re.compile(r"^[A-Za-z][A-Za-z0-9_.-]{0,63}$")
_GRAPH_NAME: Final = re.compile(r"^[a-z][a-z0-9-]{0,62}$")
_RESERVED_KEYS: Final = frozenset({"__proto__", "constructor", "prototype"})
_MAX_SOURCES: Final = 100
_MAX_ATTEMPTS_CEILING: Final = 8

_PATTERN_LABEL: Final = "graphengineering.reacher-z.github.io/pattern"
_CAPABILITY_LABEL: Final = "graphengineering.reacher-z.github.io/runtime-capability"
_API_VERSION: Final = "graphengineering.reacher-z.github.io/v1alpha1"

_OBJECT_SCHEMA: Final[dict[str, JsonValue]] = {"type": "object"}


class PatternInputError(ValueError):
    """A rejected constructor input, carrying a stable code and JSON pointer.

    The codes are the same strings the TypeScript ``PatternInputError`` uses,
    so a cross-language test can compare refusals and not just successes.
    """

    def __init__(self, code: str, message: str, path: str) -> None:
        super().__init__(f"{message} at {path}")
        self.code = code
        self.path = path


@dataclass(frozen=True, slots=True)
class ResearchSource:
    """One independent, bounded source job."""

    key: str
    role: str


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


def _normalized_sources(sources: object) -> tuple[ResearchSource, ...]:
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

    parsed: list[ResearchSource] = []
    seen: set[str] = set()
    for index, item in enumerate(sources):
        path = f"#/sources/{index}"
        if isinstance(item, ResearchSource):
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
                "GE_PATTERN_INVALID_INPUT", "expected a mapping or ResearchSource", path
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
        parsed.append(ResearchSource(key=key, role=role_value))

    # Unicode code-point order, exactly as the TypeScript ``diamond`` normalizes
    # keyed workers. Python string comparison is already code-point ordered.
    return tuple(sorted(parsed, key=lambda source: source.key))


def _source_node(source: ResearchSource, max_attempts: int) -> dict[str, JsonValue]:
    return {
        "config": {"role": source.role, "sourceKey": source.key},
        "id": f"source-{source.key}",
        "inputSchema": _object_schema(),
        "kind": "agent",
        "outputSchema": _object_schema(),
        "retry": {"maxAttempts": max_attempts},
        "sideEffects": "none",
    }


def research_diamond(
    *,
    sources: object,
    name: str = "research-diamond",
    version: str = "1.0.0",
    max_attempts_per_source: int = 2,
) -> dict[str, JsonValue]:
    """Build the Pattern 01 research diamond as portable Graph IR.

    ``scope`` fans out to one ``source-<key>`` node per source, and every
    source result reaches a unique ``synthesize`` input port named by its key.
    ``synthesize`` is the single fan-in barrier and the named graph output.

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
        type(max_attempts_per_source) is not int
        or max_attempts_per_source < 1
        or max_attempts_per_source > _MAX_ATTEMPTS_CEILING
    ):
        raise PatternInputError(
            "GE_PATTERN_INVALID_INPUT",
            f"max_attempts_per_source must be an integer from 1 through {_MAX_ATTEMPTS_CEILING}",
            "#/maxAttemptsPerSource",
        )

    normalized = _normalized_sources(sources)
    keys = [source.key for source in normalized]
    # Built element by element rather than annotated from `sorted`: `list` is
    # invariant, so `list[str]` is not assignable to `list[JsonValue]`.
    declared_keys: list[JsonValue] = list(sorted(keys))

    nodes: list[JsonValue] = [
        {
            "config": {"operation": "decompose", "sources": declared_keys},
            "id": "scope",
            "inputSchema": _object_schema(),
            "kind": "transform",
            "outputSchema": _object_schema(),
            "sideEffects": "none",
        }
    ]
    nodes.extend(_source_node(source, max_attempts_per_source) for source in normalized)
    nodes.append(
        {
            "config": {"condition": "all"},
            "id": "synthesize",
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
                "to": {"node": "synthesize", "port": key},
                "mode": "value",
            }
        )
        index += 1

    return {
        "apiVersion": _API_VERSION,
        "kind": "Graph",
        "metadata": {
            "description": (
                "Decompose one question into independent sources, then merge at one barrier"
            ),
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
        "outputs": {"report": {"node": "synthesize"}},
        "nodes": nodes,
        "edges": edges,
        "policies": {
            "maxConcurrency": len(normalized),
            "maxDepth": 3,
            "maxFanOut": len(normalized),
            "maxTotalAttempts": 2 + len(normalized) * max_attempts_per_source,
        },
    }
