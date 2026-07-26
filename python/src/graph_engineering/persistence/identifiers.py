"""Safe opaque identifiers and disk names."""

from __future__ import annotations

import hashlib
import re
from typing import Literal

from .errors import UnsafeIdentifierError

IdentifierKind = Literal["runId", "checkpointId"]
_SAFE_IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


def assert_safe_identifier(value: str, kind: IdentifierKind) -> None:
    if not isinstance(value, str) or not _SAFE_IDENTIFIER.fullmatch(value) or value in {".", ".."}:
        raise UnsafeIdentifierError(kind, value)


def identifier_hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()
