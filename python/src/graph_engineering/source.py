"""Strict JSON and safe-YAML source decoding for Graph IR authoring.

The decoder deliberately stops at the portable JSON boundary.  It does not
compile or repair a graph document, so every authoring path still flows through
the canonical compiler.
"""

from __future__ import annotations

import json
import math
import re
from collections.abc import Iterator
from dataclasses import dataclass
from enum import StrEnum
from typing import Final, Literal, NoReturn, TypeAlias, cast

from ruamel.yaml import YAML
from ruamel.yaml.error import MarkedYAMLError, YAMLError
from ruamel.yaml.events import (
    AliasEvent,
    DocumentEndEvent,
    DocumentStartEvent,
    MappingEndEvent,
    MappingStartEvent,
    ScalarEvent,
    SequenceEndEvent,
    SequenceStartEvent,
    StreamEndEvent,
    StreamStartEvent,
)
from ruamel.yaml.tokens import DirectiveToken

from ._json import normalize_json_string
from .models import MAX_SAFE_INTEGER, JsonValue
from .portable_json import PortableJsonError, portable_json_snapshot

SourceFormat: TypeAlias = Literal["json", "yaml"]

MAX_SOURCE_BYTES = 1024 * 1024
MAX_SOURCE_DEPTH = 100
MAX_SOURCE_NODES = 100_000

_DECIMAL_DIGITS = r"[0-9]+"
_INTEGER = re.compile(rf"(?:[-+]?{_DECIMAL_DIGITS}|0o[0-7]+|0x[0-9a-fA-F]+)\Z")
_FLOAT = re.compile(
    rf"[-+]?(?:{_DECIMAL_DIGITS}\.(?:{_DECIMAL_DIGITS})?"
    rf"(?:[eE][-+]?{_DECIMAL_DIGITS})?"
    rf"|\.{_DECIMAL_DIGITS}(?:[eE][-+]?{_DECIMAL_DIGITS})?"
    rf"|{_DECIMAL_DIGITS}(?:[eE][-+]?{_DECIMAL_DIGITS}))\Z"
)
_JSON_NUMBER_TOKEN = re.compile(r"-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][-+]?[0-9]+)?\Z")
_JSON_NON_STRING_DELIMITERS = frozenset('[]{}:,"')
_JSON_LITERAL_TOKENS = frozenset({"true", "false", "null", "NaN", "Infinity", "-Infinity"})
_TIMESTAMP = re.compile(
    r"[0-9]{4}-[0-9]{2}-[0-9]{2}"
    r"(?:[Tt]|[ \t]+)[0-9]{1,2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?"
    r"(?:[ \t]*(?:Z|[-+][0-9]{1,2}(?::[0-9]{2})?))?\Z"
    r"|[0-9]{4}-[0-9]{2}-[0-9]{2}\Z"
)
_MAX_SAFE_DECIMAL = str(MAX_SAFE_INTEGER)
_MAX_SAFE_OCTAL = format(MAX_SAFE_INTEGER, "o")
_MAX_SAFE_HEXADECIMAL = format(MAX_SAFE_INTEGER, "x")
_NO_EVENT: Final = object()


class SourceErrorCode(StrEnum):
    """Stable source-decoding error codes shared with TypeScript."""

    INVALID_UTF8 = "GE_SOURCE_INVALID_UTF8"
    TOO_LARGE = "GE_SOURCE_TOO_LARGE"
    SYNTAX = "GE_SOURCE_SYNTAX"
    MULTIPLE_DOCUMENTS = "GE_SOURCE_MULTIPLE_DOCUMENTS"
    DUPLICATE_KEY = "GE_SOURCE_DUPLICATE_KEY"
    UNSAFE_YAML_FEATURE = "GE_SOURCE_UNSAFE_YAML_FEATURE"
    NON_JSON_VALUE = "GE_SOURCE_NON_JSON_VALUE"


@dataclass(frozen=True, slots=True)
class SourceLimits:
    """Caller-lowerable limits bounded by the v1alpha1 hard ceilings."""

    max_bytes: int = MAX_SOURCE_BYTES
    max_depth: int = MAX_SOURCE_DEPTH
    max_nodes: int = MAX_SOURCE_NODES

    def __post_init__(self) -> None:
        values = (
            ("max_bytes", self.max_bytes, MAX_SOURCE_BYTES),
            ("max_depth", self.max_depth, MAX_SOURCE_DEPTH),
            ("max_nodes", self.max_nodes, MAX_SOURCE_NODES),
        )
        for name, value, ceiling in values:
            if type(value) is not int or value < 1 or value > ceiling:
                raise ValueError(f"{name} must be an integer between 1 and {ceiling}")


def _trusted_source_limits(value: SourceLimits | None) -> SourceLimits:
    if value is None:
        return SourceLimits()
    if type(value) is not SourceLimits:
        raise TypeError("limits must be an exact SourceLimits value or None")
    try:
        captured = (
            object.__getattribute__(value, "max_bytes"),
            object.__getattribute__(value, "max_depth"),
            object.__getattribute__(value, "max_nodes"),
        )
    except (AttributeError, TypeError):
        raise TypeError("limits must be an untampered SourceLimits value") from None
    ceilings = (MAX_SOURCE_BYTES, MAX_SOURCE_DEPTH, MAX_SOURCE_NODES)
    if any(
        type(item) is not int or item < 1 or item > ceiling
        for item, ceiling in zip(captured, ceilings, strict=True)
    ):
        raise TypeError("limits must be an untampered SourceLimits value")
    return SourceLimits(
        max_bytes=cast(int, captured[0]),
        max_depth=cast(int, captured[1]),
        max_nodes=cast(int, captured[2]),
    )


class GraphSourceError(ValueError):
    """A redacted, location-aware source decoding failure."""

    def __init__(
        self,
        code: SourceErrorCode,
        format: SourceFormat,
        message: str,
        *,
        path: str | None = None,
        line: int | None = None,
        column: int | None = None,
    ) -> None:
        self.code = code
        self.format = format
        self.path = path
        self.line = line
        self.column = column
        super().__init__(message)

    @property
    def message(self) -> str:
        return str(self)

    def to_dict(self) -> dict[str, str | int | None]:
        """Return the exact cross-language source-error projection."""

        return {
            "code": self.code.value,
            "format": self.format,
            "message": self.message,
            "path": self.path,
            "line": self.line,
            "column": self.column,
        }


class _DuplicateJsonKey(ValueError):
    def __init__(self, path: str) -> None:
        self.path = path


class _NonJsonNumber(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class _JsonObjectPairs:
    pairs: list[tuple[str, object]]


@dataclass(slots=True)
class _JsonPreflightFrame:
    kind: Literal["array", "object"]
    path: str | None
    next_index: int = 0
    expecting_key: bool = False
    pending_value_path: str | None = None


@dataclass(slots=True)
class _YamlResourceFrame:
    kind: Literal["sequence", "mapping"]
    path: str
    depth: int
    next_index: int = 0
    expecting_key: bool = False
    pending_value_path: str | None = None


def _json_object(pairs: list[tuple[str, object]]) -> _JsonObjectPairs:
    return _JsonObjectPairs(pairs)


def _materialize_json(value: object, path: str = "#") -> JsonValue:
    """Build the decoded tree while preserving nested duplicate-key paths."""

    if isinstance(value, _JsonObjectPairs):
        result: dict[str, JsonValue] = {}
        for raw_key, item in value.pairs:
            key = normalize_json_string(raw_key)
            key_path = _pointer(path, key)
            if key in result:
                raise _DuplicateJsonKey(key_path)
            result[key] = _materialize_json(item, key_path)
        return result
    if type(value) is list:
        return [_materialize_json(item, _pointer(path, index)) for index, item in enumerate(value)]
    return cast(JsonValue, value)


def _bounded_unsigned_integer(digits: str, base: int, maximum: str) -> int:
    normalized = digits.lstrip("0") or "0"
    comparable = normalized.lower()
    if len(comparable) > len(maximum) or (len(comparable) == len(maximum) and comparable > maximum):
        raise _NonJsonNumber("integer exceeds the portable safe range")
    try:
        return int(comparable, base)
    except ValueError:
        raise _NonJsonNumber("integer is not portable") from None


def _json_integer(token: str) -> int:
    negative = token.startswith("-")
    unsigned = token[1:] if token[:1] in {"-", "+"} else token
    value = _bounded_unsigned_integer(unsigned, 10, _MAX_SAFE_DECIMAL)
    return -value if negative else value


def _json_float(token: str) -> int | float:
    value = float(token)
    if not math.isfinite(value):
        raise _NonJsonNumber("floating-point value must be finite")
    if value.is_integer():
        if abs(value) > MAX_SAFE_INTEGER:
            raise _NonJsonNumber("integer-valued float exceeds the portable safe range")
        return int(value)
    return value


def _reject_json_constant(_: str) -> NoReturn:
    raise _NonJsonNumber("non-standard JSON number is not permitted")


def _pointer(path: str, part: str | int) -> str:
    escaped = str(part).replace("~", "~0").replace("/", "~1")
    return f"{path}/{escaped}" if path != "#" else f"#/{escaped}"


def _parent_pointer(path: str) -> str:
    if path == "#" or "/" not in path:
        return "#"
    return path.rsplit("/", 1)[0]


def _enforce_tree_limits(value: JsonValue, limits: SourceLimits, format: SourceFormat) -> None:
    stack: list[tuple[JsonValue, int, str]] = [(value, 1, "#")]
    count = 0
    while stack:
        current, depth, path = stack.pop()
        count += 1
        if count > limits.max_nodes:
            raise GraphSourceError(
                SourceErrorCode.TOO_LARGE,
                format,
                "source exceeds the configured node limit",
                path=path,
            )
        if depth > limits.max_depth:
            raise GraphSourceError(
                SourceErrorCode.TOO_LARGE,
                format,
                "source exceeds the configured nesting-depth limit",
                path=_parent_pointer(path),
            )
        if isinstance(current, list):
            stack.extend(
                (item, depth + 1, _pointer(path, index))
                for index, item in reversed(tuple(enumerate(current)))
            )
        elif isinstance(current, dict):
            for key, item in reversed(tuple(current.items())):
                child_path = _pointer(path, key)
                stack.append((item, depth + 1, child_path))
                stack.append((key, depth + 1, child_path))


def _preflight_json_resources(text: str, limits: SourceLimits) -> None:
    """Bound JSON parser allocation without interpreting string contents.

    For syntactically valid JSON, an opening container and every scalar or
    object-key token correspond exactly to one node counted by the post-parse
    limiter. The parser remains authoritative for grammar and duplicate keys.
    """

    containers: list[_JsonPreflightFrame] = []
    nodes = 0

    def count_node(path: str | None) -> None:
        nonlocal nodes
        nodes += 1
        if nodes > limits.max_nodes:
            raise GraphSourceError(
                SourceErrorCode.TOO_LARGE,
                "json",
                "JSON source exceeds the configured node limit",
                path=path,
            )
        if len(containers) + 1 > limits.max_depth:
            raise GraphSourceError(
                SourceErrorCode.TOO_LARGE,
                "json",
                "JSON source exceeds the configured nesting-depth limit",
                path=_parent_pointer(path) if path is not None else None,
            )

    def take_value_path() -> str | None:
        if not containers:
            return "#"
        parent = containers[-1]
        if parent.kind == "array":
            path = _pointer(parent.path, parent.next_index) if parent.path is not None else None
            parent.next_index += 1
            return path
        path = parent.pending_value_path
        parent.pending_value_path = None
        parent.expecting_key = True
        return path

    index = 0
    while index < len(text):
        character = text[index]
        if character.isspace():
            index += 1
            continue
        if character == '"':
            start = index
            index += 1
            while index < len(text):
                if text[index] == "\\":
                    index += 2
                    continue
                if text[index] == '"':
                    index += 1
                    break
                index += 1
            parent = containers[-1] if containers else None
            if parent is not None and parent.kind == "object" and parent.expecting_key:
                key_path: str | None = None
                try:
                    key, _ = json.decoder.scanstring(  # type: ignore[attr-defined]
                        text, start + 1, True
                    )
                    key_path = (
                        _pointer(parent.path, normalize_json_string(key)) if parent.path else None
                    )
                except (UnicodeError, ValueError):
                    pass
                count_node(key_path)
                parent.pending_value_path = key_path
                parent.expecting_key = False
            else:
                count_node(take_value_path())
            continue
        if character in "[{":
            path = take_value_path()
            count_node(path)
            containers.append(
                _JsonPreflightFrame(
                    kind="array" if character == "[" else "object",
                    path=path,
                    expecting_key=character == "{",
                )
            )
            index += 1
            continue
        if character in "]}":
            if containers:
                containers.pop()
            index += 1
            continue
        if character in ",:":
            index += 1
            continue

        end = index + 1
        while end < len(text):
            candidate = text[end]
            if candidate.isspace() or candidate in _JSON_NON_STRING_DELIMITERS:
                break
            end += 1
        token = text[index:end]
        if token in _JSON_LITERAL_TOKENS or _JSON_NUMBER_TOKEN.fullmatch(token):
            count_node(take_value_path())
        index = end


def _decode_json(text: str, limits: SourceLimits) -> JsonValue:
    _preflight_json_resources(text, limits)
    try:
        parsed = json.loads(
            text,
            object_pairs_hook=_json_object,
            parse_int=_json_integer,
            parse_float=_json_float,
            parse_constant=_reject_json_constant,
        )
        value = _materialize_json(parsed)
    except _DuplicateJsonKey as exc:
        raise GraphSourceError(
            SourceErrorCode.DUPLICATE_KEY,
            "json",
            "JSON mapping contains a duplicate key",
            path=exc.path,
        ) from None
    except _NonJsonNumber:
        raise GraphSourceError(
            SourceErrorCode.NON_JSON_VALUE,
            "json",
            "JSON number is outside the portable finite range",
        ) from None
    except RecursionError:
        # CPython's JSON decoder can hit its own recursion ceiling before our
        # iterative post-parse limiter sees a deeply nested but valid value.
        # Such input necessarily exceeds the protocol depth ceiling.
        raise GraphSourceError(
            SourceErrorCode.TOO_LARGE,
            "json",
            "JSON source exceeds the configured nesting-depth limit",
        ) from None
    except json.JSONDecodeError as exc:
        raise GraphSourceError(
            SourceErrorCode.SYNTAX,
            "json",
            "JSON source is not syntactically valid",
            line=exc.lineno,
            column=exc.colno,
        ) from None

    try:
        snapshot = portable_json_snapshot(value)
    except PortableJsonError:
        raise GraphSourceError(
            SourceErrorCode.NON_JSON_VALUE,
            "json",
            "JSON source is not portable across supported runtimes",
        ) from None
    _enforce_tree_limits(snapshot, limits, "json")
    return snapshot


def _mark_location(event: object) -> tuple[int | None, int | None]:
    mark = getattr(event, "start_mark", None)
    line = getattr(mark, "line", None)
    column = getattr(mark, "column", None)
    return (
        line + 1 if type(line) is int else None,
        column + 1 if type(column) is int else None,
    )


def _raise_yaml_lexical_syntax(line: int, column: int) -> NoReturn:
    raise GraphSourceError(
        SourceErrorCode.SYNTAX,
        "yaml",
        "YAML source contains a disallowed raw character",
        line=line,
        column=column,
    )


def _validate_yaml_lexical_profile(text: str) -> None:
    """Enforce one cross-parser raw-character and line-break profile."""

    index = 0
    line = 1
    column = 1
    while index < len(text):
        character = text[index]
        code_point = ord(character)
        if character == "\ufeff":
            if index != 0:
                _raise_yaml_lexical_syntax(line, column)
            index += 1
            column += 1
            continue
        if character == "\r":
            if index + 1 >= len(text) or text[index + 1] != "\n":
                _raise_yaml_lexical_syntax(line, column)
            index += 2
            line += 1
            column = 1
            continue
        if character == "\n":
            index += 1
            line += 1
            column = 1
            continue
        if (
            code_point <= 0x1F
            or 0x7F <= code_point <= 0x9F
            or code_point in {0x2028, 0x2029, 0xFFFE, 0xFFFF}
        ):
            _raise_yaml_lexical_syntax(line, column)
        index += 1
        column += 1


def _iter_yaml_lines(text: str) -> Iterator[tuple[int, str]]:
    """Yield validated LF/CRLF lines without allocating a complete line list."""

    start = 0
    line_number = 1
    while start < len(text):
        end = text.find("\n", start)
        if end < 0:
            line = text[start:]
            if line.endswith("\r"):
                line = line[:-1]
            yield line_number, line
            return
        line = text[start:end]
        if line.endswith("\r"):
            line = line[:-1]
        yield line_number, line
        start = end + 1
        line_number += 1


def _reject_yaml_directives(text: str) -> None:
    """Reject directives only where a document preamble may contain one."""

    after_leading_end_marker = False
    for line_number, line in _iter_yaml_lines(text):
        bom_offset = 1 if line_number == 1 and line.startswith("\ufeff") else 0
        candidate = line[bom_offset:]
        stripped = candidate.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if candidate.startswith("%"):
            raise GraphSourceError(
                SourceErrorCode.UNSAFE_YAML_FEATURE,
                "yaml",
                "YAML directives are not permitted",
                line=line_number,
                column=1 + bom_offset,
            )
        if after_leading_end_marker:
            return
        if _is_yaml_document_marker(candidate, "..."):
            after_leading_end_marker = True
            continue
        return


def _is_yaml_document_marker(value: str, marker: str) -> bool:
    if not value.startswith(marker):
        return False
    remainder = value[len(marker) :]
    return not remainder or (
        remainder[0].isspace() and (not remainder.strip() or remainder.lstrip().startswith("#"))
    )


def _implicit_null_with_leading_end_marker(text: str) -> bool:
    saw_end_marker = False
    for line_number, line in _iter_yaml_lines(text):
        if line_number == 1 and line.startswith("\ufeff"):
            line = line[1:]
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if not saw_end_marker:
            if not _is_yaml_document_marker(line, "..."):
                return False
            saw_end_marker = True
            continue
        if _is_yaml_document_marker(line, "---"):
            raise GraphSourceError(
                SourceErrorCode.MULTIPLE_DOCUMENTS,
                "yaml",
                "YAML input must contain exactly one document",
                line=line_number,
                column=1,
            )
        return False
    return saw_end_marker


def _yaml_profile_syntax(
    message: str,
    event: object,
    *,
    line: int | None = None,
    column: int | None = None,
) -> GraphSourceError:
    marked_line, marked_column = _mark_location(event)
    return GraphSourceError(
        SourceErrorCode.SYNTAX,
        "yaml",
        message,
        line=line if line is not None else marked_line,
        column=column if column is not None else marked_column,
    )


def _underindented_quoted_scalar_error(
    text: str,
    event: ScalarEvent,
    block_indent: int,
) -> GraphSourceError | None:
    start_mark = getattr(event, "start_mark", None)
    end_mark = getattr(event, "end_mark", None)
    start_index = getattr(start_mark, "index", None)
    end_index = getattr(end_mark, "index", None)
    start_line = getattr(start_mark, "line", None)
    end_line = getattr(end_mark, "line", None)
    if (
        event.style not in {'"', "'"}
        or type(start_index) is not int
        or type(end_index) is not int
        or type(start_line) is not int
        or type(end_line) is not int
        or end_line <= start_line
    ):
        return None

    newline = text.find("\n", start_index, end_index)
    line_number = start_line + 2
    while newline >= 0 and newline < end_index:
        line_start = newline + 1
        next_newline = text.find("\n", line_start, end_index)
        line_end = end_index if next_newline < 0 else next_newline
        source_line = text[line_start:line_end]
        if source_line.endswith("\r"):
            source_line = source_line[:-1]
        if source_line.strip(" \r"):
            indentation = len(source_line) - len(source_line.lstrip(" "))
            if indentation <= block_indent:
                return _yaml_profile_syntax(
                    "multiline quoted scalar continuation is under-indented",
                    event,
                    line=line_number,
                    column=indentation + 1,
                )
        if next_newline < 0:
            break
        newline = next_newline
        line_number += 1
    return None


def _observe_yaml_event_profile(
    text: str,
    event: object,
    containers: list[tuple[bool, int]],
) -> GraphSourceError | None:
    """Track source-sensitive gaps in ruamel's otherwise safe event stream."""

    if isinstance(event, (MappingStartEvent, SequenceStartEvent)):
        column = getattr(getattr(event, "start_mark", None), "column", 0)
        containers.append((bool(getattr(event, "flow_style", False)), column))
        return None

    if isinstance(event, (MappingEndEvent, SequenceEndEvent)):
        flow = bool(containers and containers[-1][0])
        end_index = getattr(getattr(event, "end_mark", None), "index", None)
        error = (
            _yaml_profile_syntax("YAML comments require whitespace separation", event)
            if flow and type(end_index) is int and text[end_index : end_index + 1] == "#"
            else None
        )
        if containers:
            containers.pop()
        return error

    if not isinstance(event, ScalarEvent):
        return None

    start_mark = getattr(event, "start_mark", None)
    end_mark = getattr(event, "end_mark", None)
    start_index = getattr(start_mark, "index", None)
    end_index = getattr(end_mark, "index", None)
    tag = getattr(event, "tag", None)
    if type(tag) is str and any(character in tag for character in "[]{}"):
        return _yaml_profile_syntax("YAML tag token is malformed", event)
    if (
        event.style in {'"', "'"}
        and type(end_index) is int
        and text[end_index : end_index + 1] == "#"
    ):
        return _yaml_profile_syntax("YAML comments require whitespace separation", event)
    if (
        event.style is None
        and any(flow for flow, _ in containers)
        and type(start_index) is int
        and type(end_index) is int
        and end_index > start_index
        and text[end_index - 1 : end_index] == ":"
        and text[end_index : end_index + 1] in {",", "]", "}", "[", "{"}
    ):
        return _yaml_profile_syntax(
            "plain flow keys require whitespace after the colon",
            event,
        )

    block_indent = next(
        (indent for flow, indent in reversed(containers) if not flow),
        None,
    )
    return (
        _underindented_quoted_scalar_error(text, event, block_indent)
        if block_indent is not None
        else None
    )


def _yaml_node_path(
    event: object,
    containers: list[_YamlResourceFrame],
) -> tuple[str, int]:
    if not containers:
        return "#", 1
    parent = containers[-1]
    depth = parent.depth + 1
    if parent.kind == "sequence":
        path = _pointer(parent.path, parent.next_index)
        parent.next_index += 1
        return path, depth
    if parent.expecting_key:
        path = (
            _pointer(parent.path, normalize_json_string(event.value))
            if isinstance(event, ScalarEvent)
            else parent.path
        )
        parent.pending_value_path = path
        parent.expecting_key = False
        return path, depth
    path = parent.pending_value_path or parent.path
    parent.pending_value_path = None
    parent.expecting_key = True
    return path, depth


def _preflight_yaml_events(text: str, yaml: YAML, limits: SourceLimits) -> None:
    """Exhaust YAML syntax with O(depth) state and hard event resource guards."""

    resource_containers: list[_YamlResourceFrame] = []
    profile_containers: list[tuple[bool, int]] = []
    profile_error: GraphSourceError | None = None
    second_document: object | None = None
    document_count = 0
    nodes = 0
    work_limit = limits.max_nodes * 4 + 16
    events = cast(Iterator[object], yaml.parse(text))
    try:
        for work, event in enumerate(events, start=1):
            if work > work_limit:
                line, column = _mark_location(event)
                raise GraphSourceError(
                    SourceErrorCode.TOO_LARGE,
                    "yaml",
                    "YAML parser work exceeds the configured resource budget",
                    line=line,
                    column=column,
                )

            if isinstance(event, DocumentStartEvent):
                if (
                    getattr(event, "version", None) is not None
                    or getattr(event, "tags", None) is not None
                ):
                    line, column = _mark_location(event)
                    raise GraphSourceError(
                        SourceErrorCode.UNSAFE_YAML_FEATURE,
                        "yaml",
                        "YAML directives are not permitted",
                        line=line,
                        column=column,
                    )
                document_count += 1
                if document_count == 2:
                    second_document = event

            if isinstance(event, (MappingStartEvent, SequenceStartEvent, ScalarEvent, AliasEvent)):
                path, depth = _yaml_node_path(event, resource_containers)
                nodes += 1
                if nodes > limits.max_nodes:
                    line, column = _mark_location(event)
                    raise GraphSourceError(
                        SourceErrorCode.TOO_LARGE,
                        "yaml",
                        "YAML source exceeds the configured node limit",
                        path=path,
                        line=line,
                        column=column,
                    )
                if depth > limits.max_depth:
                    line, column = _mark_location(event)
                    raise GraphSourceError(
                        SourceErrorCode.TOO_LARGE,
                        "yaml",
                        "YAML source exceeds the configured nesting-depth limit",
                        path=_parent_pointer(path),
                        line=line,
                        column=column,
                    )
                if isinstance(event, (MappingStartEvent, SequenceStartEvent)):
                    resource_containers.append(
                        _YamlResourceFrame(
                            kind=(
                                "mapping" if isinstance(event, MappingStartEvent) else "sequence"
                            ),
                            path=path,
                            depth=depth,
                            expecting_key=isinstance(event, MappingStartEvent),
                        )
                    )
            elif isinstance(event, (MappingEndEvent, SequenceEndEvent)) and resource_containers:
                resource_containers.pop()

            candidate = _observe_yaml_event_profile(text, event, profile_containers)
            if profile_error is None and candidate is not None:
                profile_error = candidate
    except GraphSourceError:
        raise
    except (YAMLError, ValueError):
        _reject_yaml_lexer_directives(text, yaml)
        raise

    _reject_yaml_lexer_directives(text, yaml)

    if second_document is not None:
        line, column = _mark_location(second_document)
        raise GraphSourceError(
            SourceErrorCode.MULTIPLE_DOCUMENTS,
            "yaml",
            "YAML input must contain exactly one document",
            line=line,
            column=column,
        )
    if profile_error is not None:
        raise profile_error


def _reject_yaml_lexer_directives(text: str, yaml: YAML) -> None:
    """Reject only percent lines tokenized as directives, not scalar content."""

    try:
        tokens = cast(Iterator[object], yaml.scan(text))
        for token in tokens:
            if isinstance(token, DirectiveToken):
                line, column = _mark_location(token)
                raise GraphSourceError(
                    SourceErrorCode.UNSAFE_YAML_FEATURE,
                    "yaml",
                    "YAML directives are not permitted",
                    line=line,
                    column=column,
                )
    except GraphSourceError:
        raise
    except (YAMLError, RecursionError, ValueError):
        # The event parser remains authoritative for non-directive syntax and
        # resource classification.
        return


class _YamlReader:
    def __init__(self, events: Iterator[object], limits: SourceLimits) -> None:
        self._events = events
        self._limits = limits
        self._next_event: object = _NO_EVENT
        self._nodes = 0

    def peek(self) -> object:
        if self._next_event is _NO_EVENT:
            try:
                self._next_event = next(self._events)
            except StopIteration:
                raise GraphSourceError(
                    SourceErrorCode.SYNTAX,
                    "yaml",
                    "YAML document ended unexpectedly",
                ) from None
        return self._next_event

    def take(self, expected: type[object] | None = None) -> object:
        event = self.peek()
        if expected is not None and not isinstance(event, expected):
            self.fail(SourceErrorCode.SYNTAX, "YAML event stream is malformed", event=event)
        self._next_event = _NO_EVENT
        return event

    def ensure_exhausted(self) -> None:
        try:
            event = next(self._events)
        except StopIteration:
            return
        self.fail(
            SourceErrorCode.SYNTAX,
            "YAML event stream has trailing content",
            event=event,
        )

    def fail(
        self,
        code: SourceErrorCode,
        message: str,
        *,
        path: str | None = None,
        event: object | None = None,
    ) -> NoReturn:
        located_event = (
            event
            if event is not None
            else (self._next_event if self._next_event is not _NO_EVENT else None)
        )
        line, column = _mark_location(located_event) if located_event is not None else (None, None)
        raise GraphSourceError(
            code,
            "yaml",
            message,
            path=path,
            line=line,
            column=column,
        )

    def count_node(self, event: object, depth: int, path: str) -> None:
        self._nodes += 1
        if self._nodes > self._limits.max_nodes:
            self.fail(
                SourceErrorCode.TOO_LARGE,
                "YAML source exceeds the configured node limit",
                path=path,
                event=event,
            )
        if depth > self._limits.max_depth:
            self.fail(
                SourceErrorCode.TOO_LARGE,
                "YAML source exceeds the configured nesting-depth limit",
                path=_parent_pointer(path),
                event=event,
            )

    def reject_unsafe_node(self, event: object, path: str) -> None:
        if isinstance(event, AliasEvent):
            self.fail(
                SourceErrorCode.UNSAFE_YAML_FEATURE,
                "YAML aliases are not permitted",
                path=path,
                event=event,
            )
        if getattr(event, "anchor", None) is not None:
            self.fail(
                SourceErrorCode.UNSAFE_YAML_FEATURE,
                "YAML anchors are not permitted",
                path=path,
                event=event,
            )
        if getattr(event, "tag", None) is not None:
            self.fail(
                SourceErrorCode.UNSAFE_YAML_FEATURE,
                "explicit YAML tags are not permitted",
                path=path,
                event=event,
            )

    def value(self, *, depth: int, path: str) -> JsonValue:
        event = self.peek()
        self.reject_unsafe_node(event, path)
        self.count_node(event, depth, path)

        if isinstance(event, ScalarEvent):
            self.take(ScalarEvent)
            return self.scalar(event, path)
        if isinstance(event, SequenceStartEvent):
            self.take(SequenceStartEvent)
            result: list[JsonValue] = []
            while not isinstance(self.peek(), SequenceEndEvent):
                result.append(self.value(depth=depth + 1, path=_pointer(path, len(result))))
            self.take(SequenceEndEvent)
            return result
        if isinstance(event, MappingStartEvent):
            self.take(MappingStartEvent)
            result_map: dict[str, JsonValue] = {}
            while not isinstance(self.peek(), MappingEndEvent):
                key_event = self.peek()
                self.reject_unsafe_node(key_event, path)
                if not isinstance(key_event, ScalarEvent):
                    self.fail(
                        SourceErrorCode.NON_JSON_VALUE,
                        "YAML mapping keys must be strings",
                        path=path,
                        event=key_event,
                    )
                self.take(ScalarEvent)
                key_value = self.scalar(key_event, path)
                if not isinstance(key_value, str):
                    self.fail(
                        SourceErrorCode.NON_JSON_VALUE,
                        "YAML mapping keys must resolve to strings",
                        path=path,
                        event=key_event,
                    )
                key = normalize_json_string(key_value)
                key_path = _pointer(path, key)
                self.count_node(key_event, depth + 1, key_path)
                if key == "<<":
                    self.fail(
                        SourceErrorCode.UNSAFE_YAML_FEATURE,
                        "YAML merge keys are not permitted",
                        path=key_path,
                        event=key_event,
                    )
                if key in result_map:
                    self.fail(
                        SourceErrorCode.DUPLICATE_KEY,
                        "YAML mapping contains a duplicate key",
                        path=key_path,
                        event=key_event,
                    )
                result_map[key] = self.value(depth=depth + 1, path=key_path)
            self.take(MappingEndEvent)
            return result_map

        self.fail(
            SourceErrorCode.SYNTAX,
            "YAML document contains an unexpected event",
            path=path,
            event=event,
        )

    def scalar(self, event: ScalarEvent, path: str) -> JsonValue:
        value = event.value
        if event.style is not None:
            return normalize_json_string(value)

        if value == "" or value in {"null", "Null", "NULL", "~"}:
            return None
        if value in {"true", "True", "TRUE"}:
            return True
        if value in {"false", "False", "FALSE"}:
            return False
        if value in {
            ".nan",
            ".NaN",
            ".NAN",
            ".inf",
            ".Inf",
            ".INF",
            "+.inf",
            "+.Inf",
            "+.INF",
            "-.inf",
            "-.Inf",
            "-.INF",
        }:
            self.fail(
                SourceErrorCode.NON_JSON_VALUE,
                "non-finite YAML numbers are not permitted",
                path=path,
                event=event,
            )
        if _TIMESTAMP.fullmatch(value):
            self.fail(
                SourceErrorCode.NON_JSON_VALUE,
                "YAML timestamps are not part of the portable JSON model",
                path=path,
                event=event,
            )
        if _INTEGER.fullmatch(value):
            try:
                if value.startswith("0o"):
                    number = _bounded_unsigned_integer(value[2:], 8, _MAX_SAFE_OCTAL)
                elif value.startswith("0x"):
                    number = _bounded_unsigned_integer(value[2:], 16, _MAX_SAFE_HEXADECIMAL)
                else:
                    number = _json_integer(value)
            except _NonJsonNumber:
                self.fail(
                    SourceErrorCode.NON_JSON_VALUE,
                    "YAML integer exceeds the portable safe range",
                    path=path,
                    event=event,
                )
            return number
        if _FLOAT.fullmatch(value):
            float_number = float(value.replace("_", ""))
            if not math.isfinite(float_number) or (
                float_number.is_integer() and abs(float_number) > MAX_SAFE_INTEGER
            ):
                self.fail(
                    SourceErrorCode.NON_JSON_VALUE,
                    "YAML number is outside the portable finite range",
                    path=path,
                    event=event,
                )
            return int(float_number) if float_number.is_integer() else float_number
        return normalize_json_string(value)


def _decode_yaml(text: str, limits: SourceLimits) -> JsonValue:
    _validate_yaml_lexical_profile(text)
    _reject_yaml_directives(text)
    if _implicit_null_with_leading_end_marker(text):
        return None

    yaml = YAML(typ="base", pure=True)
    yaml.version = (1, 2)
    try:
        # First exhaust syntax with bounded streaming state. A second parse is
        # safe only after node/depth/work budgets have been proven, and lets the
        # AST reader remain single-pass without retaining every parser event.
        _preflight_yaml_events(text, yaml, limits)
        reader = _YamlReader(cast(Iterator[object], yaml.parse(text)), limits)
        reader.take(StreamStartEvent)
        if isinstance(reader.peek(), StreamEndEvent):
            reader.take(StreamEndEvent)
            reader.ensure_exhausted()
            return None
        document_start = reader.take(DocumentStartEvent)
        if (
            getattr(document_start, "version", None) is not None
            or getattr(document_start, "tags", None) is not None
        ):
            reader.fail(
                SourceErrorCode.UNSAFE_YAML_FEATURE,
                "YAML directives are not permitted",
                event=document_start,
            )

        value = reader.value(depth=1, path="#")
        reader.take(DocumentEndEvent)
        if isinstance(reader.peek(), DocumentStartEvent):
            reader.fail(
                SourceErrorCode.MULTIPLE_DOCUMENTS,
                "YAML input must contain exactly one document",
            )
        reader.take(StreamEndEvent)
        reader.ensure_exhausted()
    except GraphSourceError:
        raise
    except MarkedYAMLError as exc:
        mark = exc.problem_mark
        raise GraphSourceError(
            SourceErrorCode.SYNTAX,
            "yaml",
            "YAML source is not syntactically valid",
            line=mark.line + 1 if mark is not None else None,
            column=mark.column + 1 if mark is not None else None,
        ) from None
    except RecursionError:
        raise GraphSourceError(
            SourceErrorCode.TOO_LARGE,
            "yaml",
            "YAML parser exceeded the configured resource budget",
        ) from None
    except (YAMLError, ValueError):
        raise GraphSourceError(
            SourceErrorCode.SYNTAX,
            "yaml",
            "YAML source is not syntactically valid",
        ) from None

    try:
        return portable_json_snapshot(value)
    except PortableJsonError:
        raise GraphSourceError(
            SourceErrorCode.NON_JSON_VALUE,
            "yaml",
            "YAML source is not portable across supported runtimes",
        ) from None


def parse_graph_source(
    source: str | bytes,
    *,
    format: SourceFormat = "json",
    limits: SourceLimits | None = None,
) -> JsonValue:
    """Decode one JSON or safe-YAML document into detached portable JSON.

    ``format`` is explicit by design.  Filename extension and stdin defaults
    are CLI concerns and must not be inferred from the document contents.
    """

    if type(format) is not str or format not in ("json", "yaml"):
        raise ValueError("format must be 'json' or 'yaml'")
    effective_limits = _trusted_source_limits(limits)

    if type(source) is bytes:
        source_bytes = source
        if len(source_bytes) > effective_limits.max_bytes:
            raise GraphSourceError(
                SourceErrorCode.TOO_LARGE,
                format,
                "source exceeds the configured byte limit",
            )
        try:
            text = source_bytes.decode("utf-8", errors="strict")
        except UnicodeDecodeError:
            raise GraphSourceError(
                SourceErrorCode.INVALID_UTF8,
                format,
                "source is not valid UTF-8",
            ) from None
    elif type(source) is str:
        try:
            source_bytes = source.encode("utf-8", errors="strict")
        except UnicodeEncodeError:
            raise GraphSourceError(
                SourceErrorCode.INVALID_UTF8,
                format,
                "source is not valid UTF-8",
            ) from None
        if len(source_bytes) > effective_limits.max_bytes:
            raise GraphSourceError(
                SourceErrorCode.TOO_LARGE,
                format,
                "source exceeds the configured byte limit",
            )
        text = source
    else:
        raise TypeError("source must be an exact str or bytes value")

    return (
        _decode_json(text, effective_limits)
        if format == "json"
        else _decode_yaml(text, effective_limits)
    )


__all__ = [
    "MAX_SOURCE_BYTES",
    "MAX_SOURCE_DEPTH",
    "MAX_SOURCE_NODES",
    "GraphSourceError",
    "SourceErrorCode",
    "SourceFormat",
    "SourceLimits",
    "parse_graph_source",
]
