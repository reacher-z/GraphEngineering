"""Package-private portable digest codec for SQLite B3 initial writes."""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
from collections.abc import Iterable
from typing import Final, NoReturn, cast

SQLITE_INITIAL_WRITE_PARAMETER_DOMAIN_UTF8: Final = (
    "graph-engineering/sqlite-initial-write-parameters/v1\0"
)
SQLITE_INITIAL_WRITE_RESULT_DOMAIN_UTF8: Final = (
    "graph-engineering/sqlite-initial-write-result/v1\0"
)
SQLITE_INITIAL_WRITE_SIGNED_INT64_MINIMUM: Final = "-9223372036854775808"
SQLITE_INITIAL_WRITE_SIGNED_INT64_MAXIMUM: Final = "9223372036854775807"

_INVALID: Final = "GE_CURSOR_B3_INITIAL_WRITE_DIGEST"
_SIGNED_INT64_MINIMUM: Final = -(2**63)
_SIGNED_INT64_MAXIMUM: Final = 2**63 - 1
_BASE64URL_ALPHABET: Final = frozenset(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
)


def _fail() -> NoReturn:
    raise ValueError(_INVALID)


def _is_unicode_scalar_text(value: str) -> bool:
    return all(not 0xD800 <= ord(character) <= 0xDFFF for character in value)


def _encode_json_string(value: object) -> str:
    if type(value) is not str or not _is_unicode_scalar_text(value):
        _fail()
    # This is deliberately not the repository's general canonical_json path.
    # The strict scalar check above dominates JSON encoding, so Python's ability
    # to serialize isolated surrogates can never become part of this codec.
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _encode_code_point_ordered_string_object(
    members: Iterable[tuple[str, str]],
) -> str:
    detached = list(members)
    keys = [key for key, _ in detached]
    if len(keys) != len(set(keys)):
        _fail()
    for key in keys:
        if not _is_unicode_scalar_text(key):
            _fail()
    detached.sort(key=lambda member: tuple(ord(character) for character in member[0]))
    return (
        "{"
        + ",".join(f"{_encode_json_string(key)}:{encoded_value}" for key, encoded_value in detached)
        + "}"
    )


def _detach_dict(value: object) -> dict[object, object]:
    """Take one exact-dict snapshot without retaining a caller-owned alias."""

    if type(value) is not dict:
        _fail()
    try:
        return cast(dict[object, object], value).copy()
    except (IndexError, KeyError, RuntimeError):
        # A concurrently mutated builtin container must never leak an
        # implementation-specific exception through this protocol boundary.
        _fail()


def _checked_exact_dict(value: object, expected_keys: frozenset[str]) -> dict[str, object]:
    detached = _detach_dict(value)
    if len(detached) != len(expected_keys):
        _fail()
    if any(type(key) is not str for key in detached) or frozenset(detached) != expected_keys:
        _fail()
    return cast(dict[str, object], detached)


def _checked_integer(value: object) -> str:
    if type(value) is not str or not value:
        _fail()
    if value == "0":
        return value
    negative = value[0] == "-"
    digits = value[1:] if negative else value
    if (
        not digits
        or digits[0] == "0"
        or any(character < "0" or character > "9" for character in digits)
    ):
        _fail()
    if len(digits) > 19:
        _fail()
    parsed = int(value)
    if parsed < _SIGNED_INT64_MINIMUM or parsed > _SIGNED_INT64_MAXIMUM:
        _fail()
    return value


def _checked_blob(value: object) -> str:
    if type(value) is not str or len(value) % 4 == 1:
        _fail()
    if any(character not in _BASE64URL_ALPHABET for character in value):
        _fail()
    padding = "=" * ((4 - len(value) % 4) % 4)
    try:
        decoded = base64.b64decode(value + padding, altchars=b"-_", validate=True)
    except (binascii.Error, ValueError):
        _fail()
    canonical = base64.urlsafe_b64encode(decoded).rstrip(b"=").decode("ascii")
    if canonical != value:
        _fail()
    return value


def _detach_tagged_scalar(value: object) -> dict[str, object]:
    candidate = _detach_dict(value)
    if any(type(key) is not str for key in candidate):
        _fail()
    scalar_type = candidate.get("type")
    if scalar_type == "null":
        if frozenset(candidate) != frozenset(("type",)):
            _fail()
    elif frozenset(candidate) != frozenset(("type", "value")):
        _fail()
    return cast(dict[str, object], candidate)


def _encode_tagged_scalar(checked: dict[str, object]) -> str:
    """Encode a detached scalar snapshot; never read caller-owned state."""

    scalar_type = checked["type"]
    if scalar_type == "null":
        return _encode_code_point_ordered_string_object(
            (("type", _encode_json_string(scalar_type)),)
        )
    raw = checked["value"]
    if scalar_type == "text":
        encoded_value = _encode_json_string(raw)
    elif scalar_type == "integer":
        encoded_value = _encode_json_string(_checked_integer(raw))
    elif scalar_type == "blob":
        encoded_value = _encode_json_string(_checked_blob(raw))
    else:
        _fail()
    return _encode_code_point_ordered_string_object(
        (("type", _encode_json_string(scalar_type)), ("value", encoded_value))
    )


def _detach_execution(execution: object) -> tuple[dict[str, object], ...]:
    if type(execution) is not list:
        _fail()
    try:
        parameters = tuple(cast(list[object], execution))
        return tuple(_detach_tagged_scalar(parameter) for parameter in parameters)
    except (IndexError, KeyError, RuntimeError):
        _fail()


def _encode_sqlite_initial_write_parameter_payload_intrinsic(executions: object) -> str:
    """Validate and encode the exact two-dimensional execution frame."""

    if type(executions) is not list:
        _fail()
    try:
        outer = tuple(cast(list[object], executions))
        detached = tuple(_detach_execution(execution) for execution in outer)
    except (IndexError, KeyError, RuntimeError):
        _fail()

    encoded_executions: list[str] = []
    for execution in detached:
        encoded_parameters = [_encode_tagged_scalar(parameter) for parameter in execution]
        encoded_executions.append("[" + ",".join(encoded_parameters) + "]")
    return "[" + ",".join(encoded_executions) + "]"


def _digest(domain: str, canonical_payload: str) -> str:
    digest = hashlib.sha256()
    digest.update(domain.encode("utf-8"))
    digest.update(canonical_payload.encode("utf-8"))
    return digest.hexdigest()


def _digest_sqlite_initial_write_parameters_intrinsic(executions: object) -> str:
    return _digest(
        SQLITE_INITIAL_WRITE_PARAMETER_DOMAIN_UTF8,
        _encode_sqlite_initial_write_parameter_payload_intrinsic(executions),
    )


def _encode_sqlite_initial_write_result_payload_intrinsic(result: object) -> str:
    """Validate and encode the complete logical result aggregate."""

    checked = _checked_exact_dict(result, frozenset(("affectedRows",)))
    affected_rows = checked["affectedRows"]
    if type(affected_rows) is not str or not affected_rows:
        _fail()
    if affected_rows != "0" and (
        affected_rows[0] < "1"
        or affected_rows[0] > "9"
        or any(character < "0" or character > "9" for character in affected_rows[1:])
    ):
        _fail()
    return _encode_code_point_ordered_string_object(
        (("affectedRows", _encode_json_string(affected_rows)),)
    )


def _digest_sqlite_initial_write_result_intrinsic(result: object) -> str:
    return _digest(
        SQLITE_INITIAL_WRITE_RESULT_DOMAIN_UTF8,
        _encode_sqlite_initial_write_result_payload_intrinsic(result),
    )
