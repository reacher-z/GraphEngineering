"""Tagged, cross-language Durable JSON encoding and hashing."""

from __future__ import annotations

import math
import re
import struct
from typing import cast

from ._json import normalize_json_string
from .canonical import canonical_sha256
from .models import MAX_SAFE_INTEGER, JsonValue
from .portable_json import PortableJsonError, portable_json_snapshot

_FLOAT_BITS = re.compile(r"^[0-9a-f]{16}$")


class DurableJsonError(ValueError):
    """Raised when tagged Durable JSON is malformed or non-canonical."""


def _encode(value: JsonValue) -> JsonValue:
    if value is None:
        return ["n"]
    if type(value) is bool:
        return ["b", value]
    if type(value) is str:
        return ["s", value]
    if type(value) is int:
        return ["i", value]
    if type(value) is float:
        return ["f", struct.pack(">d", value).hex()]
    if type(value) is list:
        return ["a", [_encode(item) for item in value]]
    if type(value) is dict:
        return [
            "o",
            [[key, _encode(value[key])] for key in sorted(value)],
        ]
    raise AssertionError("portable JSON snapshot returned an unsupported value")


def encode_durable_json(value: object) -> JsonValue:
    """Detach and encode one portable finite JSON value."""

    try:
        snapshot = portable_json_snapshot(value)
    except PortableJsonError as exc:
        raise DurableJsonError(str(exc)) from exc
    return _encode(snapshot)


def _tagged_array(value: object, *, path: str) -> list[JsonValue]:
    if type(value) is not list or not value or type(value[0]) is not str:
        raise DurableJsonError(f"{path}: expected a non-empty tagged array")
    return cast(list[JsonValue], value)


def _decode(value: object, *, path: str) -> JsonValue:
    tagged = _tagged_array(value, path=path)
    tag = tagged[0]
    if tag == "n":
        if len(tagged) != 1:
            raise DurableJsonError(f"{path}: tag 'n' requires arity 1")
        return None
    if tag == "b":
        if len(tagged) != 2 or type(tagged[1]) is not bool:
            raise DurableJsonError(f"{path}: tag 'b' requires one boolean payload")
        return tagged[1]
    if tag == "s":
        if len(tagged) != 2 or type(tagged[1]) is not str:
            raise DurableJsonError(f"{path}: tag 's' requires one string payload")
        return normalize_json_string(tagged[1])
    if tag == "i":
        if (
            len(tagged) != 2
            or type(tagged[1]) is not int
            or abs(tagged[1]) > MAX_SAFE_INTEGER
        ):
            raise DurableJsonError(f"{path}: tag 'i' requires one safe-integer payload")
        return tagged[1]
    if tag == "f":
        bits = tagged[1] if len(tagged) == 2 else None
        if type(bits) is not str or _FLOAT_BITS.fullmatch(bits) is None:
            raise DurableJsonError(f"{path}: tag 'f' requires sixteen lowercase hex digits")
        decoded = float(struct.unpack(">d", bytes.fromhex(bits))[0])
        if not math.isfinite(decoded) or decoded.is_integer():
            raise DurableJsonError(
                f"{path}: tag 'f' must encode a finite non-integer binary64 value"
            )
        return decoded
    if tag == "a":
        payload = tagged[1] if len(tagged) == 2 else None
        if type(payload) is not list:
            raise DurableJsonError(f"{path}: tag 'a' requires one array payload")
        return [_decode(item, path=f"{path}/1/{index}") for index, item in enumerate(payload)]
    if tag == "o":
        payload = tagged[1] if len(tagged) == 2 else None
        if type(payload) is not list:
            raise DurableJsonError(f"{path}: tag 'o' requires one entries-array payload")
        result: dict[str, JsonValue] = {}
        previous: str | None = None
        for index, entry in enumerate(payload):
            if type(entry) is not list or len(entry) != 2 or type(entry[0]) is not str:
                raise DurableJsonError(f"{path}/1/{index}: expected [string, tagged-value]")
            key = normalize_json_string(entry[0])
            if previous is not None and key <= previous:
                raise DurableJsonError(
                    f"{path}/1/{index}/0: object keys must be unique and code-point sorted"
                )
            previous = key
            result[key] = _decode(entry[1], path=f"{path}/1/{index}/1")
        return result
    raise DurableJsonError(f"{path}: unknown Durable JSON tag {tag!r}")


def decode_durable_json(value: object) -> JsonValue:
    """Decode and strictly validate one canonical tagged Durable JSON value."""

    return _decode(value, path="#")


def durable_json_hash(value: object) -> str:
    """Hash the canonical tagged representation of one portable JSON value."""

    return canonical_sha256(encode_durable_json(value))
