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
import math
import struct
from fractions import Fraction


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


def _floor_log10(value: Fraction) -> int:
    """Return ``floor(log10(value))`` using exact integer arithmetic."""

    numerator = value.numerator
    denominator = value.denominator
    exponent = len(str(numerator)) - len(str(denominator))
    if exponent >= 0:
        if numerator < denominator * 10**exponent:
            exponent -= 1
    elif numerator * 10 ** (-exponent) < denominator:
        exponent -= 1
    return exponent


def _integer_interval_bound(
    value: Fraction,
    *,
    lower: bool,
    inclusive: bool,
) -> int:
    """Round an exact rational inward to an integer interval endpoint."""

    quotient, remainder = divmod(value.numerator, value.denominator)
    if lower:
        if remainder != 0 or not inclusive:
            quotient += 1
    elif remainder == 0 and not inclusive:
        quotient -= 1
    return quotient


def _nearest_integer(value: Fraction) -> int:
    """Round a non-negative rational to nearest integer, ties to even."""

    quotient, remainder = divmod(value.numerator, value.denominator)
    doubled = remainder * 2
    if doubled > value.denominator or (
        doubled == value.denominator and quotient % 2 != 0
    ):
        return quotient + 1
    return quotient


def _scaled(value: Fraction, decimal_exponent: int) -> Fraction:
    """Divide ``value`` by ``10 ** decimal_exponent`` exactly."""

    if decimal_exponent >= 0:
        return Fraction(value.numerator, value.denominator * 10**decimal_exponent)
    return Fraction(value.numerator * 10 ** (-decimal_exponent), value.denominator)


def _decimal_value(coefficient: int, decimal_exponent: int) -> Fraction:
    if decimal_exponent >= 0:
        return Fraction(coefficient * 10**decimal_exponent)
    return Fraction(coefficient, 10 ** (-decimal_exponent))


def _decimal_power(exponent: int) -> Fraction:
    if exponent >= 0:
        return Fraction(10**exponent)
    return Fraction(1, 10 ** (-exponent))


def _shortest_decimal(value: float) -> tuple[int, int]:
    """Return the ECMAScript shortest decimal ``coefficient * 10**exponent``.

    CPython and ECMAScript use different presentation thresholds and can also
    select different shortest representatives at binary64 rounding boundaries.
    Searching the exact round-to-nearest-even interval avoids depending on
    Python's ``repr`` while keeping the implementation compact and auditable.
    """

    exact = Fraction.from_float(value)
    previous = Fraction.from_float(math.nextafter(value, 0.0))
    following_float = math.nextafter(value, math.inf)
    following = (
        Fraction.from_float(following_float)
        if math.isfinite(following_float)
        else exact + (exact - previous)
    )
    lower = (previous + exact) / 2
    upper = (exact + following) / 2

    bits = struct.unpack(">Q", struct.pack(">d", value))[0]
    boundary_is_inclusive = bits & 1 == 0
    scientific_exponent = _floor_log10(exact)

    def candidates_for(digit_count: int) -> list[tuple[int, int]]:
        base_exponent = scientific_exponent - digit_count + 1
        decimal_exponents = [base_exponent]
        if lower < _decimal_power(scientific_exponent):
            decimal_exponents.append(base_exponent - 1)
        if upper >= _decimal_power(scientific_exponent + 1):
            decimal_exponents.append(base_exponent + 1)
        candidates: list[tuple[int, int]] = []
        for decimal_exponent in decimal_exponents:
            scaled_lower = _scaled(lower, decimal_exponent)
            scaled_upper = _scaled(upper, decimal_exponent)
            minimum = max(
                10 ** (digit_count - 1),
                _integer_interval_bound(
                    scaled_lower,
                    lower=True,
                    inclusive=boundary_is_inclusive,
                ),
            )
            maximum = min(
                10**digit_count - 1,
                _integer_interval_bound(
                    scaled_upper,
                    lower=False,
                    inclusive=boundary_is_inclusive,
                ),
            )
            if minimum > maximum:
                continue
            coefficient = min(
                maximum,
                max(minimum, _nearest_integer(_scaled(exact, decimal_exponent))),
            )
            candidates.append((coefficient, decimal_exponent))
        return candidates

    # Every finite binary64 has a round-tripping decimal with at most 17
    # significant digits.  Existence is monotonic: appending a zero gives an
    # equivalent representation with one more digit, so binary search locates
    # the shortest length without scanning all seventeen possibilities.
    minimum_digits = 1
    maximum_digits = 17
    shortest_candidates: list[tuple[int, int]] = []
    while minimum_digits < maximum_digits:
        candidate_digits = (minimum_digits + maximum_digits) // 2
        candidates = candidates_for(candidate_digits)
        if candidates:
            maximum_digits = candidate_digits
            shortest_candidates = candidates
        else:
            minimum_digits = candidate_digits + 1
    if not shortest_candidates or minimum_digits != maximum_digits:
        shortest_candidates = candidates_for(minimum_digits)

    if shortest_candidates:
        best_coefficient, best_exponent = shortest_candidates[0]
        best_distance = abs(_decimal_value(best_coefficient, best_exponent) - exact)
        for coefficient, decimal_exponent in shortest_candidates[1:]:
            distance = abs(_decimal_value(coefficient, decimal_exponent) - exact)
            if distance < best_distance or (
                distance == best_distance
                and (
                    coefficient % 2 == 0,
                    -coefficient,
                    -decimal_exponent,
                )
                > (
                    best_coefficient % 2 == 0,
                    -best_coefficient,
                    -best_exponent,
                )
            ):
                best_coefficient = coefficient
                best_exponent = decimal_exponent
                best_distance = distance
        return best_coefficient, best_exponent

    raise AssertionError("finite binary64 has no shortest decimal representation")


def _render_finite_float(value: float) -> str:
    """Render one finite binary64 exactly as ECMAScript ``JSON.stringify``."""

    if not math.isfinite(value):
        raise ValueError("Out of range float values are not JSON compliant")
    if value == 0.0:
        return "0"

    prefix = "-" if value < 0 else ""
    coefficient, decimal_exponent = _shortest_decimal(abs(value))
    digits = str(coefficient)
    digit_count = len(digits)
    decimal_point = digit_count + decimal_exponent

    if digit_count <= decimal_point <= 21:
        body = digits + "0" * (decimal_point - digit_count)
    elif 0 < decimal_point <= 21:
        body = f"{digits[:decimal_point]}.{digits[decimal_point:]}"
    elif -6 < decimal_point <= 0:
        body = f"0.{('0' * -decimal_point)}{digits}"
    else:
        exponent = decimal_point - 1
        significand = digits if digit_count == 1 else f"{digits[0]}.{digits[1:]}"
        body = f"{significand}e{'+' if exponent >= 0 else ''}{exponent}"
    return prefix + body


def _render_compact_json(value: object, *, sort_keys: bool) -> str:
    if value is None:
        return "null"
    if type(value) is str:
        return _escape_lone_surrogates(json.dumps(value, ensure_ascii=False))
    if type(value) is bool:
        return "true" if value else "false"
    if type(value) is int:
        return str(value)
    if type(value) is float:
        return _render_finite_float(value)
    if type(value) is list:
        return "[" + ",".join(
            _render_compact_json(item, sort_keys=sort_keys) for item in value
        ) + "]"
    if type(value) is dict:
        items = list(value.items())
        if not all(type(key) is str for key, _ in items):
            raise TypeError("JSON object keys must be strings")
        if sort_keys:
            items.sort(key=lambda item: item[0])
        return "{" + ",".join(
            f"{_render_compact_json(key, sort_keys=sort_keys)}:"
            f"{_render_compact_json(item, sort_keys=sort_keys)}"
            for key, item in items
        ) + "}"
    raise TypeError(
        f"Object of type {type(value).__name__} is not JSON serializable"
    )


def _compact_captured_json(value: object, *, sort_keys: bool = False) -> str:
    """Render a value already captured by the portable JSON boundary."""

    return _render_compact_json(value, sort_keys=sort_keys)


def compact_json(value: object, *, sort_keys: bool = False) -> str:
    """Return deterministic compact JSON that is always UTF-8 encodable."""

    # Import locally to keep the string normalizer usable by portable_json
    # without creating a module-initialization cycle.
    from .portable_json import portable_json_snapshot

    captured = portable_json_snapshot(value)
    return _compact_captured_json(captured, sort_keys=sort_keys)


def utf8_bytes(value: str) -> bytes:
    """Encode text produced by :func:`compact_json` as strict UTF-8."""

    return value.encode("utf-8")
