"""Portable v1alpha2 resource limits and the iterative portable snapshot.

``redaction-semantics.md`` Section 11 fixes hard maxima that are semantic and
cross-language: they count UTF-8 bytes, decoded pointer tokens, and JSON value
nodes rather than Python objects.  Section 3.3.1 additionally requires that
resolution and mutation use an explicit work stack so a hostile value can never
drive recursive host traversal, and that limit failure wins before any
missing-target, overlap, or mutation check.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final

from .._json import normalize_json_string
from ..models import MAX_SAFE_INTEGER, JsonValue

MAX_POLICY_UTF8_BYTES: Final = 65_536
MAX_PROTECTED_VALUE_UTF8_BYTES: Final = 67_108_864
MAX_TRANSFORMED_UTF8_BYTES: Final = 67_108_864
MAX_VALUE_DEPTH: Final = 128
MAX_VALUE_NODES: Final = 1_000_000
MAX_CONTAINERS: Final = 100_000
MAX_OBJECT_MEMBERS: Final = 1_000_000
MAX_POINTERS_PER_RULE: Final = 1_024
MAX_POINTER_TOKENS: Final = 128
MAX_POINTER_UTF8_BYTES: Final = 1_024
MAX_POINTER_TOKEN_UTF8_BYTES: Final = 256
MAX_PROTECTED_REFS_PER_RECORD: Final = 1_024
MAX_REF_UTF8_BYTES: Final = 128
MAX_AAD_FIELD_PATH_UTF8_BYTES: Final = 1_024
MAX_DIAGNOSTIC_UTF8_BYTES: Final = 1_024
MAX_REDACTION_RULES: Final = 54


@dataclass(frozen=True, slots=True)
class PortableLimits:
    """The Section 11 maxima. Deployments may configure smaller bounds."""

    max_policy_utf8_bytes: int = MAX_POLICY_UTF8_BYTES
    max_protected_value_utf8_bytes: int = MAX_PROTECTED_VALUE_UTF8_BYTES
    max_transformed_utf8_bytes: int = MAX_TRANSFORMED_UTF8_BYTES
    max_value_depth: int = MAX_VALUE_DEPTH
    max_value_nodes: int = MAX_VALUE_NODES
    max_containers: int = MAX_CONTAINERS
    max_object_members: int = MAX_OBJECT_MEMBERS
    max_pointers_per_rule: int = MAX_POINTERS_PER_RULE
    max_pointer_tokens: int = MAX_POINTER_TOKENS
    max_pointer_utf8_bytes: int = MAX_POINTER_UTF8_BYTES
    max_pointer_token_utf8_bytes: int = MAX_POINTER_TOKEN_UTF8_BYTES
    max_protected_refs_per_record: int = MAX_PROTECTED_REFS_PER_RECORD
    max_ref_utf8_bytes: int = MAX_REF_UTF8_BYTES
    max_diagnostic_utf8_bytes: int = MAX_DIAGNOSTIC_UTF8_BYTES

    def narrowed(self, **overrides: int) -> PortableLimits:
        """Return a copy with smaller bounds; widening past Section 11 fails."""

        ceiling = PortableLimits()
        merged = {
            field: getattr(self, field)
            for field in (
                "max_policy_utf8_bytes",
                "max_protected_value_utf8_bytes",
                "max_transformed_utf8_bytes",
                "max_value_depth",
                "max_value_nodes",
                "max_containers",
                "max_object_members",
                "max_pointers_per_rule",
                "max_pointer_tokens",
                "max_pointer_utf8_bytes",
                "max_pointer_token_utf8_bytes",
                "max_protected_refs_per_record",
                "max_ref_utf8_bytes",
                "max_diagnostic_utf8_bytes",
            )
        }
        for name, value in overrides.items():
            if name not in merged:
                raise ValueError(f"unknown portable limit {name!r}")
            if value > getattr(ceiling, name):
                raise ValueError(f"portable limit {name!r} cannot exceed the v1alpha2 maximum")
            merged[name] = value
        return PortableLimits(**merged)


DEFAULT_LIMITS: Final = PortableLimits()


class SnapshotError(ValueError):
    """Base class for portable snapshot rejections."""


class SnapshotUnsupportedValueError(SnapshotError):
    """A value cannot cross the portable JSON boundary."""


class SnapshotKeyCollisionError(SnapshotError):
    """Two object keys collide after portable string normalization."""


class SnapshotLimitError(SnapshotError):
    """A Section 11 resource bound was exceeded."""

    def __init__(self, limit_name: str, limit: int) -> None:
        super().__init__(f"portable limit {limit_name} ({limit}) exceeded")
        self.limit_name = limit_name
        self.limit = limit


@dataclass(frozen=True, slots=True)
class ValueMeasurements:
    """Semantic counters described by Section 11."""

    depth: int
    nodes: int
    containers: int
    object_members: int


_EXIT = object()


def portable_snapshot(
    value: object,
    *,
    limits: PortableLimits = DEFAULT_LIMITS,
) -> tuple[JsonValue, ValueMeasurements]:
    """Detach one immutable portable JSON snapshot with an explicit work stack.

    Step 1 of Section 3.3.1: valid UTF-16 surrogate pairs in keys and values are
    combined using the repository portable-string rule, and two object keys that
    collide after that normalization reject the candidate before transformation.

    Python is the only one of the two native runtimes that can observe this
    collision.  A JavaScript string is a UTF-16 sequence, so a valid pair and its
    combined scalar are the same string and the object never holds two keys.  A
    Python ``str`` is a code-point sequence, so ``"\\ud83d\\ude00"`` and
    ``"\\U0001f600"`` are two distinct ``dict`` keys until this rule folds them
    together.  Rejecting here is therefore a real obligation, not a no-op.

    Traversal reads only exact built-in ``dict``/``list`` instances, so getters,
    proxies, custom mappings, and inherited attributes are never invoked.
    """

    nodes = 0
    containers = 0
    members = 0
    max_depth = 0

    holder: dict[str, JsonValue] = {}
    ancestors: set[int] = set()
    stack: list[tuple[object, int, object, object]] = [(value, 0, holder, "root")]

    while stack:
        source, depth, parent, key = stack.pop()
        if parent is _EXIT:
            ancestors.discard(depth)
            continue

        if depth > limits.max_value_depth:
            raise SnapshotLimitError("max_value_depth", limits.max_value_depth)
        if depth > max_depth:
            max_depth = depth
        nodes += 1
        if nodes > limits.max_value_nodes:
            raise SnapshotLimitError("max_value_nodes", limits.max_value_nodes)

        kind = type(source)
        if source is None or kind is bool or kind is str or kind is int or kind is float:
            _assign(parent, key, _primitive(source))
            continue

        # ``type(...) is`` is repeated inline rather than read from ``kind`` so
        # the exact-type test also narrows the value for the type checker: an
        # ``isinstance`` test would admit ``dict``/``list`` subclasses whose
        # overridden ``items``/``__iter__`` are exactly what this walker refuses
        # to invoke.
        if type(source) is list:
            identity = id(source)
            if identity in ancestors:
                raise SnapshotUnsupportedValueError("portable JSON value contains a cycle")
            containers += 1
            if containers > limits.max_containers:
                raise SnapshotLimitError("max_containers", limits.max_containers)
            ancestors.add(identity)
            items = list(source)
            target: list[JsonValue] = [None] * len(items)
            _assign(parent, key, target)
            stack.append((None, identity, _EXIT, None))
            for index in range(len(items) - 1, -1, -1):
                stack.append((items[index], depth + 1, target, index))
            continue

        if type(source) is dict:
            identity = id(source)
            if identity in ancestors:
                raise SnapshotUnsupportedValueError("portable JSON value contains a cycle")
            containers += 1
            if containers > limits.max_containers:
                raise SnapshotLimitError("max_containers", limits.max_containers)
            ancestors.add(identity)
            entries = list(source.items())
            mapping: dict[str, JsonValue] = {}
            _assign(parent, key, mapping)
            stack.append((None, identity, _EXIT, None))
            normalized_keys: list[str] = []
            for entry_key, _ in entries:
                if type(entry_key) is not str:
                    raise SnapshotUnsupportedValueError(
                        "portable JSON object keys must be strings"
                    )
                normalized = normalize_json_string(entry_key)
                if normalized in mapping:
                    raise SnapshotKeyCollisionError(
                        "portable JSON object keys collide after "
                        "surrogate-pair normalization"
                    )
                members += 1
                if members > limits.max_object_members:
                    raise SnapshotLimitError("max_object_members", limits.max_object_members)
                mapping[normalized] = None
                normalized_keys.append(normalized)
            for index in range(len(entries) - 1, -1, -1):
                stack.append((entries[index][1], depth + 1, mapping, normalized_keys[index]))
            continue

        # Never inspect a rejected class name: a hostile metaclass can turn a
        # structured boundary rejection into code execution.
        raise SnapshotUnsupportedValueError("value is not portable JSON")

    return holder["root"], ValueMeasurements(
        depth=max_depth,
        nodes=nodes,
        containers=containers,
        object_members=members,
    )


def _primitive(source: object) -> JsonValue:
    """Copy one exact built-in scalar, re-testing its type rather than trusting a tag.

    Each branch narrows ``source`` itself, so the bound that follows it is
    checked against the value that was actually admitted.
    """

    if source is None:
        return None
    if type(source) is bool:
        return bool(source)
    if type(source) is str:
        return normalize_json_string(str(source))
    if type(source) is int:
        number = int(source)
        if abs(number) > MAX_SAFE_INTEGER:
            raise SnapshotUnsupportedValueError("integer exceeds the portable safe range")
        return number
    if type(source) is float:
        value = float(source)
        if value != value or value in (float("inf"), float("-inf")):
            raise SnapshotUnsupportedValueError("floating-point value must be finite")
        if value.is_integer():
            if abs(value) > MAX_SAFE_INTEGER:
                raise SnapshotUnsupportedValueError(
                    "integer-valued float exceeds the portable safe range"
                )
            return int(value)
        return value
    raise SnapshotUnsupportedValueError("value is not portable JSON")


def _assign(parent: object, key: object, value: JsonValue) -> None:
    """Write one snapshot slot into a container this walker built itself.

    The parent and key are re-tested rather than assumed: the snapshot targets
    are constructed above, so a mismatch here means the walker lost its own
    invariant and the value must not be admitted.
    """

    if type(parent) is list:
        if type(key) is not int:
            raise SnapshotUnsupportedValueError("portable snapshot array index must be an integer")
        parent[key] = value
    elif type(parent) is dict:
        if type(key) is not str:
            raise SnapshotUnsupportedValueError("portable snapshot object key must be a string")
        parent[key] = value
    else:
        raise SnapshotUnsupportedValueError("portable snapshot target must be a JSON container")


def measure(value: JsonValue, *, limits: PortableLimits = DEFAULT_LIMITS) -> ValueMeasurements:
    """Re-measure an already portable value without copying it."""

    return portable_snapshot(value, limits=limits)[1]
