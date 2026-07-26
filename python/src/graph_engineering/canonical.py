"""Canonical Graph IR serialization and hashing."""

from __future__ import annotations

import hashlib
from typing import Any

from pydantic import BaseModel

from ._json import compact_json, utf8_bytes


def _json_value(value: Any) -> Any:
    if isinstance(value, BaseModel):
        # exclude_unset preserves explicit JSON null while omitting absent optional fields.
        return value.model_dump(mode="json", by_alias=True, exclude_unset=True)
    return value


def canonical_json(value: Any) -> str:
    """Serialize using the Graph Engineering v1alpha1 canonical JSON rules."""

    return compact_json(_json_value(value), sort_keys=True)


def canonical_bytes(value: Any) -> bytes:
    return utf8_bytes(canonical_json(value))


def canonical_sha256(value: Any) -> str:
    return hashlib.sha256(canonical_bytes(value)).hexdigest()
