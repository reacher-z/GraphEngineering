"""Cross-language mathematical-integer validation for primitive wire fields."""

from __future__ import annotations

import math

from ..models import MAX_SAFE_INTEGER


def portable_integer(
    value: object,
    *,
    minimum: int,
    maximum: int = MAX_SAFE_INTEGER,
) -> int | None:
    """Return a normalized safe integer, or ``None`` when it is invalid.

    JavaScript has one numeric type, so JSON lexical forms such as ``1`` and
    ``1.0`` are indistinguishable after parsing. Python therefore accepts exact
    built-in integers and exact finite, integer-valued built-in floats, while
    rejecting booleans and numeric subclasses. Conversion also normalizes
    signed floating-point zero to integer zero.
    """

    normalized: int
    if isinstance(value, int) and type(value) is int:
        normalized = value
    elif (
        isinstance(value, float)
        and type(value) is float
        and math.isfinite(value)
        and value.is_integer()
        and abs(value) <= MAX_SAFE_INTEGER
    ):
        normalized = int(value)
    else:
        return None
    if abs(normalized) > MAX_SAFE_INTEGER:
        return None
    if normalized < minimum or normalized > maximum:
        return None
    return normalized
