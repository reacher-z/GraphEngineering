"""Stable JSON export helpers for deterministic primitive records."""

from __future__ import annotations

from .._json import compact_json as _compact_json


def compact_json(value: object) -> str:
    """Encode insertion-ordered portable JSON with no insignificant bytes."""

    return _compact_json(value)
