"""The exact RFC 6901 pointer transform frozen by Section 3.3.1.

The transform is a total deterministic result operation: it returns one
transformed snapshot plus its canonical path list, or one structured denial.  It
never returns a partly transformed object, never raises provider text, and never
mutates the caller's value.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final, Literal, TypeAlias

from ..models import JsonValue
from .errors import GuardPhase, RedactionFailure, failure
from .limits import (
    DEFAULT_LIMITS,
    PortableLimits,
    SnapshotKeyCollisionError,
    SnapshotLimitError,
    SnapshotUnsupportedValueError,
    portable_snapshot,
)

REDACTION_TOKEN: Final = "[REDACTED]"

PROTECTED_VALUE_API_VERSION: Final = (
    "graphengineering.reacher-z.github.io/protected-value/v1alpha1"
)
PROTECTED_BLOB_API_VERSION: Final = (
    "graphengineering.reacher-z.github.io/protected-blob/v1alpha1"
)

ReplacementMode: TypeAlias = Literal["remove", "constant-token"]

REPLACEMENT_MODES: tuple[ReplacementMode, ...] = ("remove", "constant-token")

# Section 3.3.1 step 2: rejected at any depth, regardless of whether the token
# names an own JSON member. RFC 6901 escapes only "~" and "/", and none of these
# names contains either character, so each has exactly one spelling.
FORBIDDEN_TOKENS: frozenset[str] = frozenset({"__proto__", "prototype", "constructor"})

_ARRAY_INDEX_ZERO: Final = "0"


class PointerSyntaxError(ValueError):
    """A pointer is not a canonical RFC 6901 pointer accepted by this contract."""


@dataclass(frozen=True, slots=True)
class PointerTransformResult:
    """A complete transform: the new snapshot plus its canonical path list."""

    output: JsonValue
    canonical_paths: tuple[str, ...]

    @property
    def count(self) -> int:
        return len(self.canonical_paths)


@dataclass(frozen=True, slots=True)
class PointerTransformDenied:
    """A total denial. No partial result exists."""

    failure: RedactionFailure


PointerOutcome: TypeAlias = PointerTransformResult | PointerTransformDenied


def decode_pointer(
    path: str,
    *,
    limits: PortableLimits = DEFAULT_LIMITS,
) -> tuple[str, ...]:
    """Decode one pointer into reference tokens, or raise :class:`PointerSyntaxError`.

    Section 11 pointer bounds are enforced here, before any target lookup.
    """

    if type(path) is not str:
        raise PointerSyntaxError("a redaction path must be a string")
    if path == "":
        # The empty pointer addresses the document root, and root replacement or
        # removal is not permitted.
        raise PointerSyntaxError("the empty pointer is not an acceptable redaction path")
    if len(path.encode("utf-8")) > limits.max_pointer_utf8_bytes:
        raise PointerSyntaxError("pointer exceeds the portable byte bound")
    if not path.startswith("/"):
        raise PointerSyntaxError("every accepted pointer starts with '/'")

    raw_tokens = path.split("/")[1:]
    if len(raw_tokens) > limits.max_pointer_tokens:
        raise PointerSyntaxError("pointer exceeds the portable reference-token bound")

    tokens: list[str] = []
    for raw in raw_tokens:
        decoded = _decode_token(raw)
        if len(decoded.encode("utf-8")) > limits.max_pointer_token_utf8_bytes:
            raise PointerSyntaxError("decoded reference token exceeds the portable byte bound")
        if _encode_token(decoded) != raw:
            raise PointerSyntaxError("reference token is not canonically escaped")
        if decoded in FORBIDDEN_TOKENS:
            raise PointerSyntaxError("pointer traverses a prototype-bearing member name")
        tokens.append(decoded)
    return tuple(tokens)


def _decode_token(raw: str) -> str:
    decoded: list[str] = []
    index = 0
    length = len(raw)
    while index < length:
        character = raw[index]
        if character != "~":
            decoded.append(character)
            index += 1
            continue
        if index + 1 >= length:
            raise PointerSyntaxError("'~' at end of a reference token is invalid")
        follower = raw[index + 1]
        if follower == "0":
            decoded.append("~")
        elif follower == "1":
            decoded.append("/")
        else:
            raise PointerSyntaxError("'~' must be followed by '0' or '1'")
        index += 2
    return "".join(decoded)


def _encode_token(decoded: str) -> str:
    # Escape "~" first, then "/", exactly as RFC 6901 requires.
    return decoded.replace("~", "~0").replace("/", "~1")


def _array_index(token: str, length: int) -> int:
    if token == _ARRAY_INDEX_ZERO:
        index = 0
    elif token and token[0] in "123456789" and token.isascii() and token.isdigit():
        index = int(token)
    else:
        raise PointerSyntaxError("array reference tokens are '0' or /[1-9][0-9]*/")
    if index >= length:
        raise PointerSyntaxError("array index is not less than the original array length")
    return index


def _resolve(snapshot: JsonValue, tokens: tuple[str, ...]) -> None:
    """Walk the snapshot iteratively; raise if any component is missing."""

    current: JsonValue = snapshot
    for token in tokens:
        kind = type(current)
        if kind is dict:
            mapping = current
            assert isinstance(mapping, dict)
            if token not in mapping:
                raise PointerSyntaxError("pointer component does not exist")
            current = mapping[token]
        elif kind is list:
            sequence = current
            assert isinstance(sequence, list)
            current = sequence[_array_index(token, len(sequence))]
        else:
            raise PointerSyntaxError("pointer traverses a non-container value")


def contains_transformed_material(snapshot: JsonValue) -> bool:
    """Detect a value that a previous attempt already transformed.

    Section 7.1 forbids re-transforming an already transformed value: hashing a
    replacement token as though it were raw yields a receipt that attests to a
    source nobody ever held, and re-protecting ciphertext produces a value whose
    plaintext is another ciphertext.
    """

    stack: list[JsonValue] = [snapshot]
    while stack:
        current = stack.pop()
        kind = type(current)
        if kind is str and current == REDACTION_TOKEN:
            return True
        if kind is list:
            assert isinstance(current, list)
            stack.extend(current)
        elif kind is dict:
            assert isinstance(current, dict)
            api_version = current.get("apiVersion")
            if api_version in (PROTECTED_VALUE_API_VERSION, PROTECTED_BLOB_API_VERSION):
                return True
            stack.extend(current.values())
    return False


def apply_pointer_transform(
    candidate: object,
    paths: object,
    replacement_mode: object,
    *,
    limits: PortableLimits = DEFAULT_LIMITS,
) -> PointerOutcome:
    """Run steps 1 through 5 of Section 3.3.1 over one candidate value."""

    denial = _denied

    if replacement_mode not in REPLACEMENT_MODES:
        return denial("replacementMode is 'remove' or 'constant-token'", phase="receipt")
    mode: ReplacementMode = replacement_mode

    # Step 1: one immutable pre-transform snapshot, portable-string normalized,
    # with normalized-key collisions rejected before any path is consulted.
    try:
        snapshot, _ = portable_snapshot(candidate, limits=limits)
    except SnapshotKeyCollisionError:
        return denial("object keys collide after portable normalization", phase="snapshot")
    except SnapshotLimitError:
        return denial("candidate exceeds a portable resource bound", phase="snapshot")
    except SnapshotUnsupportedValueError:
        return denial("candidate is not portable JSON", phase="snapshot")

    if type(paths) is not tuple and type(paths) is not list:
        return denial("paths must be an ordered pointer list", phase="receipt")
    path_list = list(paths)
    if not path_list:
        return denial("a transform requires at least one path", phase="receipt")

    # Section 3.3.1: Section 11 limits are evaluated before target existence and
    # overlap checks, and produce no partial result.
    if len(path_list) > limits.max_pointers_per_rule:
        return denial("path count exceeds the portable bound", phase="receipt")

    # Step 2: syntax, escaping round-trip, and prototype rejection.
    decoded: list[tuple[str, ...]] = []
    for path in path_list:
        try:
            decoded.append(decode_pointer(path, limits=limits))
        except PointerSyntaxError:
            return denial("pointer is not a canonical safe RFC 6901 pointer", phase="receipt")

    # Step 4: strict canonical order, duplicate source strings, duplicate
    # resolved locations, and ancestor/descendant overlap.
    for index in range(1, len(path_list)):
        if not path_list[index - 1] < path_list[index]:
            return denial("paths must be in strictly increasing code-point order", phase="receipt")

    resolved: set[tuple[str, ...]] = set()
    for tokens in decoded:
        if tokens in resolved:
            return denial("duplicate resolved pointer location", phase="receipt")
        resolved.add(tokens)
    for tokens in decoded:
        for other in decoded:
            if tokens is other:
                continue
            if len(tokens) < len(other) and other[: len(tokens)] == tokens:
                return denial("overlapping ancestor/descendant pointers", phase="receipt")

    # Step 3 and step 4 target existence, against the one immutable snapshot.
    for tokens in decoded:
        try:
            _resolve(snapshot, tokens)
        except PointerSyntaxError:
            return denial("pointer target does not exist", phase="receipt")

    if mode == "remove":
        for tokens in decoded:
            if not _removes_object_member(snapshot, tokens):
                return denial("remove addresses the root or an array element", phase="receipt")

    # Step 5: apply from greatest depth to least, reverse code-point order for
    # equal depth. A fresh copy keeps the pre-transform snapshot immutable.
    # ``path_list`` is already strictly increasing, so a greater position is a
    # greater pointer and ``-position`` is exactly reverse code-point order.
    output, _ = portable_snapshot(snapshot, limits=limits)
    order = sorted(
        range(len(decoded)),
        key=lambda position: (-len(decoded[position]), -position),
    )
    for position in order:
        _apply_one(output, decoded[position], mode)

    # Step 6 (first half): the result must still be portable JSON within bounds.
    try:
        result, _ = portable_snapshot(output, limits=limits)
    except (SnapshotKeyCollisionError, SnapshotLimitError, SnapshotUnsupportedValueError):
        return denial("transformed value is not portable JSON", phase="receipt")

    return PointerTransformResult(output=result, canonical_paths=tuple(path_list))


def _removes_object_member(snapshot: JsonValue, tokens: tuple[str, ...]) -> bool:
    if not tokens:
        return False
    parent: JsonValue = snapshot
    for token in tokens[:-1]:
        if type(parent) is dict:
            assert isinstance(parent, dict)
            parent = parent[token]
        else:
            assert isinstance(parent, list)
            parent = parent[_array_index(token, len(parent))]
    return type(parent) is dict


def _apply_one(root: JsonValue, tokens: tuple[str, ...], mode: ReplacementMode) -> None:
    parent: JsonValue = root
    for token in tokens[:-1]:
        if type(parent) is dict:
            assert isinstance(parent, dict)
            parent = parent[token]
        else:
            assert isinstance(parent, list)
            parent = parent[_array_index(token, len(parent))]
    last = tokens[-1]
    if type(parent) is dict:
        assert isinstance(parent, dict)
        if mode == "remove":
            del parent[last]
        else:
            parent[last] = REDACTION_TOKEN
        return
    assert isinstance(parent, list)
    parent[_array_index(last, len(parent))] = REDACTION_TOKEN


def _denied(_reason: str, *, phase: GuardPhase = "receipt") -> PointerTransformDenied:
    # The reason string is developer documentation at the call site and is never
    # persisted: Section 10 forbids echoing the offending value, and a pointer or
    # key name is caller-derived material.
    return PointerTransformDenied(failure("REDACTION_RECEIPT_INVALID", phase))
