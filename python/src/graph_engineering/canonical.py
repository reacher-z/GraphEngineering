"""Canonical Graph IR serialization and hashing."""

from __future__ import annotations

import hashlib
from typing import Any

from ._json import _compact_captured_json, utf8_bytes
from .portable_json import portable_json_snapshot


def _json_value(value: Any) -> Any:
    # Avoid virtual BaseModel serialization: only an exact GraphSpec is part of
    # this public convenience boundary, and its raw Pydantic storage is captured
    # without invoking caller-controlled methods or nested subclasses.
    from .models import GraphSpec, capture_graph_model_document

    if type(value) is GraphSpec:
        return capture_graph_model_document(value, GraphSpec)
    return value


def canonical_json(value: Any) -> str:
    """Serialize using the Graph Engineering v1alpha1 canonical JSON rules."""

    return _compact_captured_json(
        portable_json_snapshot(_json_value(value)),
        sort_keys=True,
    )


def canonical_bytes(value: Any) -> bytes:
    return utf8_bytes(canonical_json(value))


def canonical_sha256(value: Any) -> str:
    return hashlib.sha256(canonical_bytes(value)).hexdigest()
