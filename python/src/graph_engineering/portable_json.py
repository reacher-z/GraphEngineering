"""Portable, detached runtime JSON snapshots.

The runtime boundary is intentionally narrower than Python's ``json`` module:
only values with the same lossless representation in Python and JavaScript are
accepted.  Container identity is not part of JSON, so repeated aliases are
copied independently while actual ancestry cycles are rejected.
"""

from __future__ import annotations

import math

from ._json import normalize_json_string
from .models import MAX_SAFE_INTEGER, JsonValue


class PortableJsonError(TypeError):
    """Raised when a value cannot cross the portable runtime JSON boundary."""


def portable_json_snapshot(value: object) -> JsonValue:
    """Validate and detach one finite, cross-language JSON value.

    Repeated references are legal and become independent container copies.
    A reference back to a container on the active ancestry path is a cycle and
    is rejected.  Excessive nesting is also converted into this structured
    boundary error rather than leaking ``RecursionError``.
    """

    try:
        return _snapshot(value, set())
    except RecursionError as exc:
        raise PortableJsonError("portable JSON value is nested too deeply") from exc


def _snapshot(value: object, ancestors: set[int]) -> JsonValue:
    if value is None:
        return None
    if isinstance(value, str) and type(value) is str:
        return normalize_json_string(value)
    if isinstance(value, bool) and type(value) is bool:
        return value
    if isinstance(value, int) and type(value) is int:
        if abs(value) > MAX_SAFE_INTEGER:
            raise PortableJsonError("integer exceeds the portable safe range")
        return value
    if isinstance(value, float) and type(value) is float:
        if not math.isfinite(value):
            raise PortableJsonError("floating-point value must be finite")
        if value.is_integer():
            if abs(value) > MAX_SAFE_INTEGER:
                raise PortableJsonError("integer-valued float exceeds the portable safe range")
            # JavaScript JSON has one numeric type and JSON.stringify normalizes
            # integer-valued doubles, including negative zero, to an integer token.
            return int(value)
        return value

    if isinstance(value, list) and type(value) is list:
        identity = id(value)
        if identity in ancestors:
            raise PortableJsonError("portable JSON value contains a cycle")
        ancestors.add(identity)
        try:
            return [_snapshot(item, ancestors) for item in value]
        finally:
            ancestors.remove(identity)

    if isinstance(value, dict) and type(value) is dict:
        identity = id(value)
        if identity in ancestors:
            raise PortableJsonError("portable JSON value contains a cycle")
        ancestors.add(identity)
        try:
            snapshot: dict[str, JsonValue] = {}
            for key, item in value.items():
                if not isinstance(key, str) or type(key) is not str:
                    raise PortableJsonError("portable JSON object keys must be strings")
                normalized_key = normalize_json_string(key)
                if normalized_key in snapshot:
                    raise PortableJsonError(
                        "portable JSON object keys collide after surrogate-pair normalization"
                    )
                snapshot[normalized_key] = _snapshot(item, ancestors)
            return snapshot
        finally:
            ancestors.remove(identity)

    raise PortableJsonError(
        f"value of type {type(value).__name__!r} is not portable JSON"
    )
