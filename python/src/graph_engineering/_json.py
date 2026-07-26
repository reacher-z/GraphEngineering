"""Shared UTF-8-safe JSON text encoding helpers.

Python strings can contain isolated UTF-16 surrogate code points after parsing
JSON escape sequences, or a program can construct a valid surrogate pair as two
code units instead of one Unicode scalar. JavaScript treats a valid pair as one
code point for canonical key sorting and emits a lone code unit as a lowercase
``\\uXXXX`` escape. Normalize strings before sorting, then escape only remaining
lone code units so ordinary non-ASCII text and existing hashes stay unchanged.
"""

from __future__ import annotations

import json


class JsonKeyCollisionError(ValueError):
    """Raised when distinct Python keys become one JavaScript string key."""


def normalize_json_string(value: str) -> str:
    """Combine valid UTF-16 surrogate pairs while preserving lone code units."""

    normalized: list[str] = []
    index = 0
    while index < len(value):
        code_point = ord(value[index])
        if 0xD800 <= code_point <= 0xDBFF and index + 1 < len(value):
            low = ord(value[index + 1])
            if 0xDC00 <= low <= 0xDFFF:
                normalized.append(
                    chr(0x10000 + ((code_point - 0xD800) << 10) + low - 0xDC00)
                )
                index += 2
                continue
        normalized.append(value[index])
        index += 1
    return "".join(normalized)


def _normalize_json_strings(value: object, ancestors: set[int]) -> object:
    if isinstance(value, str):
        return normalize_json_string(value)
    if isinstance(value, (list, tuple)):
        identity = id(value)
        if identity in ancestors:
            raise ValueError("Circular reference detected")
        ancestors.add(identity)
        try:
            return [_normalize_json_strings(item, ancestors) for item in value]
        finally:
            ancestors.remove(identity)
    if isinstance(value, dict):
        identity = id(value)
        if identity in ancestors:
            raise ValueError("Circular reference detected")
        ancestors.add(identity)
        try:
            normalized: dict[object, object] = {}
            normalized_string_keys: set[str] = set()
            for key, item in value.items():
                normalized_key: object = (
                    normalize_json_string(key) if isinstance(key, str) else key
                )
                if isinstance(normalized_key, str):
                    if normalized_key in normalized_string_keys:
                        raise JsonKeyCollisionError(
                            "JSON object keys collide after surrogate-pair normalization"
                        )
                    normalized_string_keys.add(normalized_key)
                normalized[normalized_key] = _normalize_json_strings(item, ancestors)
            return normalized
        finally:
            ancestors.remove(identity)
    return value


def normalize_json_strings(value: object) -> object:
    """Recursively normalize string keys/values and reject key collisions."""

    return _normalize_json_strings(value, set())


def _escape_lone_surrogates(value: str) -> str:
    escaped: list[str] = []
    for character in value:
        code_point = ord(character)
        escaped.append(
            f"\\u{code_point:04x}"
            if 0xD800 <= code_point <= 0xDFFF
            else character
        )
    return "".join(escaped)


def compact_json(value: object, *, sort_keys: bool = False) -> str:
    """Return deterministic compact JSON that is always UTF-8 encodable."""

    rendered = json.dumps(
        normalize_json_strings(value),
        ensure_ascii=False,
        allow_nan=False,
        sort_keys=sort_keys,
        separators=(",", ":"),
    )
    return _escape_lone_surrogates(rendered)


def utf8_bytes(value: str) -> bytes:
    """Encode text produced by :func:`compact_json` as strict UTF-8."""

    return value.encode("utf-8")
