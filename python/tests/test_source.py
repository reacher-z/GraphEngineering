from __future__ import annotations

import json
from collections.abc import Iterator, Mapping
from pathlib import Path

import pytest

import graph_engineering.source as source_module
from graph_engineering import (
    DiagnosticCode,
    GraphSourceError,
    SourceErrorCode,
    SourceLimits,
    compile_graph,
    create_compiled_graph_identity,
    parse_graph_source,
    try_compile_graph,
)

ROOT = Path(__file__).resolve().parents[2]


def assert_source_error(
    source: str | bytes,
    code: SourceErrorCode,
    *,
    format: str = "yaml",
    limits: SourceLimits | None = None,
) -> GraphSourceError:
    with pytest.raises(GraphSourceError) as raised:
        parse_graph_source(source, format=format, limits=limits)  # type: ignore[arg-type]
    assert raised.value.code is code
    assert raised.value.format == format
    assert raised.value.to_dict() == {
        "code": code.value,
        "format": format,
        "message": raised.value.message,
        "path": raised.value.path,
        "line": raised.value.line,
        "column": raised.value.column,
    }
    return raised.value


def test_json_and_yaml_decode_to_the_same_detached_portable_value() -> None:
    expected = {
        "name": "图",
        "enabled": True,
        "empty": None,
        "items": [1, -2, 1.5, "yes", "no", "on", "off"],
        "description": "first\nsecond\n",
    }
    json_value = parse_graph_source(json.dumps(expected, ensure_ascii=False), format="json")
    yaml_value = parse_graph_source(
        """
        # YAML 1.2 core scalars, comments, flow syntax and a block scalar.
        name: 图
        enabled: true
        empty: null
        items: [1, -2, 1.5, yes, no, on, off]
        description: |
          first
          second
        """,
        format="yaml",
    )

    assert yaml_value == json_value == expected


def test_yaml_sequences_are_portable_source_values_and_not_graph_repaired() -> None:
    value = parse_graph_source("[one, two, null]", format="yaml")

    assert value == ["one", "two", None]


@pytest.mark.parametrize(
    ("source", "code"),
    [
        ("a: 1\na: 2\n", SourceErrorCode.DUPLICATE_KEY),
        ("outer:\n  a: 1\n  a: 2\n", SourceErrorCode.DUPLICATE_KEY),
        ("a: &value 1\n", SourceErrorCode.UNSAFE_YAML_FEATURE),
        ("a: *missing\n", SourceErrorCode.UNSAFE_YAML_FEATURE),
        ("<<: {a: 1}\n", SourceErrorCode.UNSAFE_YAML_FEATURE),
        ("a: !custom value\n", SourceErrorCode.UNSAFE_YAML_FEATURE),
        ("a: !!str value\n", SourceErrorCode.UNSAFE_YAML_FEATURE),
        ("%YAML 1.2\n---\na: 1\n", SourceErrorCode.UNSAFE_YAML_FEATURE),
        ("%FOO bar\n---\na: 1\n", SourceErrorCode.UNSAFE_YAML_FEATURE),
        ("%YAML 9.9\n---\na: 1\n", SourceErrorCode.UNSAFE_YAML_FEATURE),
        ("\ufeff%FOO bar\n---\na: 1\n", SourceErrorCode.UNSAFE_YAML_FEATURE),
        ("a: 1\n---\nb: 2\n", SourceErrorCode.MULTIPLE_DOCUMENTS),
        ("...\n---\n", SourceErrorCode.MULTIPLE_DOCUMENTS),
        ("? [a, b]\n: value\n", SourceErrorCode.NON_JSON_VALUE),
        ("1: value\n", SourceErrorCode.NON_JSON_VALUE),
        ("a: 2026-07-26\n", SourceErrorCode.NON_JSON_VALUE),
        ("a: 2026-07-26T12:30:00Z\n", SourceErrorCode.NON_JSON_VALUE),
        ("a: .nan\n", SourceErrorCode.NON_JSON_VALUE),
        ("a: -.Inf\n", SourceErrorCode.NON_JSON_VALUE),
        (f"a: {2**53}\n", SourceErrorCode.NON_JSON_VALUE),
        ("a: [1, 2\n", SourceErrorCode.SYNTAX),
        ("a: 1\ntrailing: ]\n", SourceErrorCode.SYNTAX),
    ],
)
def test_yaml_unsafe_or_non_json_inputs_fail_closed(source: str, code: SourceErrorCode) -> None:
    error = assert_source_error(source, code)

    assert error.line is None or error.line >= 1
    assert error.column is None or error.column >= 1
    assert source.strip() not in error.message


@pytest.mark.parametrize("source", ["...\nfoo\n", "...\n...\n"])
def test_leading_document_end_followed_by_content_is_syntax(source: str) -> None:
    assert_source_error(source, SourceErrorCode.SYNTAX)


def test_end_marker_with_trailing_spaces_obeys_preamble_rules() -> None:
    assert parse_graph_source("...   \n", format="yaml") is None
    assert_source_error("...   \nfoo\n", SourceErrorCode.SYNTAX)
    assert_source_error("...   \n---\n", SourceErrorCode.MULTIPLE_DOCUMENTS)
    assert_source_error("...   \n%x\n", SourceErrorCode.UNSAFE_YAML_FEATURE)


@pytest.mark.parametrize(
    "source",
    [
        "---\n...\n%YAML 1.2\n---\n",
        "---\n...\n%x\n",
        "value: one\n...\n%x\n",
    ],
)
def test_lexer_directives_after_an_explicit_document_end_are_unsafe(source: str) -> None:
    assert_source_error(source, SourceErrorCode.UNSAFE_YAML_FEATURE)


@pytest.mark.parametrize(
    ("source", "code"),
    [
        ("a: &anchor value\ntrailing: ]\n", SourceErrorCode.SYNTAX),
        ("a: 1\na: 2\n---\nb: 3\n", SourceErrorCode.MULTIPLE_DOCUMENTS),
        ("a: !custom value\n---\nb: 3\n", SourceErrorCode.MULTIPLE_DOCUMENTS),
        ("%FOO bar\n---\ntrailing: ]\n", SourceErrorCode.UNSAFE_YAML_FEATURE),
    ],
)
def test_yaml_mixed_failure_precedence_is_frozen(
    source: str,
    code: SourceErrorCode,
) -> None:
    assert_source_error(source, code)


@pytest.mark.parametrize(
    "source",
    ['a: "x\ny"\n', "a: 'x\ny'\n", '- "x\ny"\n', "- 'x\ny'\n"],
)
def test_multiline_quoted_values_in_block_collections_require_indentation(
    source: str,
) -> None:
    assert_source_error(source, SourceErrorCode.SYNTAX)


@pytest.mark.parametrize(
    ("source", "expected"),
    [
        ('a: "x\n y"\n', {"a": "x y"}),
        ("- 'x\n y'\n", ["x y"]),
        ('"x\ny"\n', "x y"),
        ('{a: "x\ny"}\n', {"a": "x y"}),
    ],
)
def test_multiline_quoted_values_with_valid_context_indentation_are_accepted(
    source: str,
    expected: object,
) -> None:
    assert parse_graph_source(source, format="yaml") == expected


@pytest.mark.parametrize(
    "source",
    ["{a:}\n", "{a:,b: 2}\n", "{a:[]}\n", "{a:{}}\n", "[a:]\n"],
)
def test_plain_flow_key_adjacent_colon_profile_fails_closed(source: str) -> None:
    assert_source_error(source, SourceErrorCode.SYNTAX)


def test_spaced_or_quoted_flow_key_colons_are_supported() -> None:
    assert parse_graph_source("{a: []}\n", format="yaml") == {"a": []}
    assert parse_graph_source('{"a":[]}\n', format="yaml") == {"a": []}


@pytest.mark.parametrize(
    "source",
    [
        "''#comment\n",
        '"x"#comment\n',
        "[]#comment\n",
        "{a: b}#comment\n",
        'a: "x"#comment\n',
        "a: []#comment\n",
        "- {}#comment\n",
    ],
)
def test_yaml_comments_after_quoted_or_flow_tokens_require_separation(source: str) -> None:
    assert_source_error(source, SourceErrorCode.SYNTAX)


@pytest.mark.parametrize(
    ("source", "expected"),
    [
        ('"x" #comment\n', "x"),
        ("[] #comment\n", []),
        ("{a: b} #comment\n", {"a": "b"}),
        ('a: "x" #comment\n', {"a": "x"}),
        ("a#comment\n", "a#comment"),
    ],
)
def test_yaml_separated_comments_and_plain_hashes_remain_valid(
    source: str,
    expected: object,
) -> None:
    assert parse_graph_source(source, format="yaml") == expected


def test_yaml_event_intake_enforces_the_hard_node_limit_streamingly() -> None:
    source = "-\n" * 100_001

    assert_source_error(source, SourceErrorCode.TOO_LARGE)


def test_large_yaml_sequence_within_the_node_limit_remains_supported() -> None:
    value = parse_graph_source("-\n" * 10_000, format="yaml")

    assert isinstance(value, list)
    assert len(value) == 10_000
    assert all(item is None for item in value)


def test_quoted_merge_and_non_string_like_keys_are_plain_strings() -> None:
    # A quoted key has no YAML merge semantics, but the profile reserves <<
    # entirely so authoring behavior cannot drift across parser versions.
    assert_source_error('"<<": value\n', SourceErrorCode.UNSAFE_YAML_FEATURE)
    assert parse_graph_source('"1": value\n', format="yaml") == {"1": "value"}


@pytest.mark.parametrize(
    ("token", "expected"),
    [
        (str(2**53 - 1), 2**53 - 1),
        (str(-(2**53 - 1)), -(2**53 - 1)),
        ("0x10", 16),
        ("0o10", 8),
        ("-0", 0),
        ("1e3", 1000),
        (".5", 0.5),
        ("1.", 1),
    ],
)
def test_yaml_numeric_boundaries_are_deterministic(token: str, expected: object) -> None:
    assert parse_graph_source(f"value: {token}\n", format="yaml") == {"value": expected}


@pytest.mark.parametrize("token", ["yes", "Yes", "NO", "on", "Off"])
def test_yaml_1_1_boolean_traps_remain_strings(token: str) -> None:
    assert parse_graph_source(f"value: {token}\n", format="yaml") == {"value": token}


@pytest.mark.parametrize("token", ["nUlL", "tRuE", "fAlSe", ".iNf", "+.iNf", "-.iNf", ".nAn"])
def test_yaml_mixed_case_core_tokens_remain_strings(token: str) -> None:
    assert parse_graph_source(f"value: {token}\n", format="yaml") == {"value": token}


@pytest.mark.parametrize(
    ("token", "expected"),
    [
        ("null", None),
        ("Null", None),
        ("NULL", None),
        ("true", True),
        ("True", True),
        ("TRUE", True),
        ("false", False),
        ("False", False),
        ("FALSE", False),
    ],
)
def test_yaml_exact_core_case_variants_resolve(token: str, expected: object) -> None:
    assert parse_graph_source(f"value: {token}\n", format="yaml") == {"value": expected}


def test_utf8_is_strict_for_bytes_and_python_strings() -> None:
    assert_source_error(b"\xff", SourceErrorCode.INVALID_UTF8, format="json")
    assert_source_error("\ud800", SourceErrorCode.INVALID_UTF8, format="yaml")


def test_byte_depth_and_node_limits_are_hard_and_caller_lowerable() -> None:
    assert_source_error(
        "a: 12345\n",
        SourceErrorCode.TOO_LARGE,
        limits=SourceLimits(max_bytes=5),
    )
    assert_source_error(
        "a:\n  b:\n    c: 1\n",
        SourceErrorCode.TOO_LARGE,
        limits=SourceLimits(max_depth=3),
    )
    assert_source_error(
        "a: 1\nb: 2\n",
        SourceErrorCode.TOO_LARGE,
        limits=SourceLimits(max_nodes=4),
    )


@pytest.mark.parametrize(
    "kwargs",
    [
        {"max_bytes": 0},
        {"max_depth": 101},
        {"max_nodes": 100_001},
        {"max_nodes": True},
    ],
)
def test_limits_cannot_disable_protocol_ceilings(kwargs: dict[str, object]) -> None:
    with pytest.raises(ValueError):
        SourceLimits(**kwargs)  # type: ignore[arg-type]


@pytest.mark.parametrize(
    ("source", "code"),
    [
        ('{"a":1,"a":2}', SourceErrorCode.DUPLICATE_KEY),
        ('{"a":NaN}', SourceErrorCode.NON_JSON_VALUE),
        (f'{{"a":{2**53}}}', SourceErrorCode.NON_JSON_VALUE),
        ('{"a":', SourceErrorCode.SYNTAX),
    ],
)
def test_strict_json_rejects_duplicate_nonstandard_unsafe_and_partial_input(
    source: str, code: SourceErrorCode
) -> None:
    assert_source_error(source, code, format="json")


@pytest.mark.parametrize("source", ["1" * 5000, "-" + "1" * 5000])
def test_very_long_json_integer_is_redacted_non_json_value(source: str) -> None:
    error = assert_source_error(source, SourceErrorCode.NON_JSON_VALUE, format="json")

    assert source[:100] not in error.message


@pytest.mark.parametrize("token", ["1" * 5000, "-" + "1" * 5000])
def test_very_long_yaml_integer_is_redacted_non_json_value(token: str) -> None:
    error = assert_source_error(
        f"value: {token}\n",
        SourceErrorCode.NON_JSON_VALUE,
    )

    assert token[:100] not in error.message


def test_json_parser_recursion_ceiling_is_reported_as_too_large() -> None:
    source = "[" * 1000 + "0" + "]" * 1000

    assert_source_error(source, SourceErrorCode.TOO_LARGE, format="json")


@pytest.mark.parametrize(
    ("source", "limits"),
    [
        ("[]", SourceLimits(max_bytes=1)),
        ("[" * 101 + "0" + "]" * 101, SourceLimits()),
        ("[0,0]", SourceLimits(max_nodes=2)),
    ],
)
def test_json_resource_preflight_runs_before_parser_allocation(
    source: str,
    limits: SourceLimits,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def forbidden_parser(*args: object, **kwargs: object) -> object:
        raise AssertionError("json.loads must not run for a preflight budget failure")

    monkeypatch.setattr(source_module.json, "loads", forbidden_parser)

    assert_source_error(
        source,
        SourceErrorCode.TOO_LARGE,
        format="json",
        limits=limits,
    )


def test_json_resource_preflight_does_not_scan_escaped_string_contents() -> None:
    document = {"text": '[{\\"nested\\":true}]'}
    source = json.dumps(document)

    assert (
        parse_graph_source(
            source,
            format="json",
            limits=SourceLimits(max_depth=2, max_nodes=3),
        )
        == document
    )


def test_nested_json_duplicate_reports_the_complete_pointer() -> None:
    error = assert_source_error(
        '{"root":{"a":1,"a":2}}',
        SourceErrorCode.DUPLICATE_KEY,
        format="json",
    )

    assert error.path == "#/root/a"


@pytest.mark.parametrize(
    "source",
    [
        "",
        "# no graph document\n",
        "...\n",
        "# implicit null\n... # explicit end\n# trailing comment\n",
        "---\n...\n",
    ],
)
def test_empty_or_comment_only_yaml_is_one_implicit_null_document(source: str) -> None:
    value = parse_graph_source(source, format="yaml")

    assert value is None
    compiled = try_compile_graph(value)  # type: ignore[arg-type]
    assert [item.code for item in compiled.diagnostics] == [DiagnosticCode.INVALID_GRAPH]


def test_percent_inside_block_scalar_is_not_treated_as_a_directive() -> None:
    value = parse_graph_source("value: |\n  %not-a-directive\n", format="yaml")

    assert value == {"value": "%not-a-directive\n"}


@pytest.mark.parametrize(
    "source",
    ['"a\n%b"\n', "'a\n%b'\n", "a\n%b\n"],
)
def test_column_zero_percent_inside_a_multiline_scalar_is_data(source: str) -> None:
    assert parse_graph_source(source, format="yaml") == "a %b"


@pytest.mark.parametrize(
    "source",
    [" ...\n", "  ... # comment\n", "# comment\n ...\n"],
)
def test_indented_end_marker_is_a_plain_scalar(source: str) -> None:
    assert parse_graph_source(source, format="yaml") == "..."


@pytest.mark.parametrize(
    "source",
    [
        "value:\tbad\n",
        "value:\x00bad\n",
        "value:\x1fbad\n",
        "value:\x7fbad\n",
        "value:\x85bad\n",
        "value:\x9fbad\n",
        "value:\u2028bad\n",
        "value:\u2029bad\n",
        "value:\ufffebad\n",
        "value:\uffffbad\n",
        "value: one\rvalue: two\n",
        "value: one\n\ufeffother: two\n",
        "\ufeff\ufeffvalue: one\n",
    ],
)
def test_yaml_raw_character_profile_rejects_cross_parser_drift(source: str) -> None:
    error = assert_source_error(source, SourceErrorCode.SYNTAX)

    assert error.line is not None and error.line >= 1
    assert error.column is not None and error.column >= 1


def test_yaml_crlf_and_one_leading_bom_are_accepted() -> None:
    value = parse_graph_source("\ufeffvalue:\r\n  nested: true\r\n", format="yaml")

    assert value == {"value": {"nested": True}}


def test_yaml_escaped_tab_and_line_separators_remain_string_values() -> None:
    value = parse_graph_source('value: "\\t\\L\\P"\n', format="yaml")

    assert value == {"value": "\t\u2028\u2029"}


def test_yaml_invalid_unicode_escape_is_a_redacted_syntax_error() -> None:
    error = assert_source_error(
        'value: "\\U00110000"\n',
        SourceErrorCode.SYNTAX,
    )

    assert "00110000" not in error.message


def test_json_and_yaml_node_budget_counts_mapping_keys_at_exact_boundary() -> None:
    limits = SourceLimits(max_nodes=3)
    assert parse_graph_source('{"a":1}', format="json", limits=limits) == {"a": 1}
    assert parse_graph_source("a: 1\n", format="yaml", limits=limits) == {"a": 1}

    lower = SourceLimits(max_nodes=2)
    assert_source_error('{"a":1}', SourceErrorCode.TOO_LARGE, format="json", limits=lower)
    assert_source_error("a: 1\n", SourceErrorCode.TOO_LARGE, limits=lower)


class _HostileMapping(Mapping[str, object]):
    def __getitem__(self, key: str) -> object:
        raise AssertionError("must not inspect mapping")

    def __iter__(self) -> Iterator[str]:
        raise AssertionError("must not iterate mapping")

    def __len__(self) -> int:
        raise AssertionError("must not get mapping length")


def test_source_rejects_non_text_without_coercion_or_hostile_access() -> None:
    with pytest.raises(TypeError, match="exact str or bytes"):
        parse_graph_source(_HostileMapping(), format="json")  # type: ignore[arg-type]


def test_source_error_does_not_capture_source_secret_or_parser_stack() -> None:
    secret = "TOP-SECRET-VALUE"
    error = assert_source_error(f"password: [{secret}\n", SourceErrorCode.SYNTAX)
    projection = json.dumps(error.to_dict())

    assert secret not in projection
    assert "/home/" not in projection
    assert "Traceback" not in projection


def test_format_and_limits_are_programmer_contracts() -> None:
    with pytest.raises(ValueError, match="format"):
        parse_graph_source("{}", format="auto")  # type: ignore[arg-type]
    with pytest.raises(TypeError, match="SourceLimits"):
        parse_graph_source("{}", format="json", limits={})  # type: ignore[arg-type]


def test_hostile_format_subclass_is_rejected_without_comparison() -> None:
    calls: list[str] = []

    class HostileFormat(str):
        def __eq__(self, other: object) -> bool:
            calls.append("eq")
            raise RuntimeError("SECRET_FORMAT")

    with pytest.raises(ValueError, match="format") as raised:
        parse_graph_source("{}", format=HostileFormat("json"))  # type: ignore[arg-type]

    assert calls == []
    assert "SECRET_FORMAT" not in str(raised.value)


def test_hostile_limits_subclass_is_rejected_without_field_access() -> None:
    calls: list[str] = []
    armed = False

    class HostileLimits(SourceLimits):
        def __getattribute__(self, name: str) -> object:
            if armed:
                calls.append(name)
                raise RuntimeError("SECRET_LIMIT")
            return object.__getattribute__(self, name)

    hostile = HostileLimits()
    armed = True

    with pytest.raises(TypeError, match="SourceLimits") as raised:
        parse_graph_source("{}", format="json", limits=hostile)

    assert calls == []
    assert "SECRET_LIMIT" not in str(raised.value)


def test_tampered_exact_limits_are_recaptured_without_nested_access() -> None:
    calls: list[str] = []

    class Evil:
        def __getattribute__(self, name: str) -> object:
            calls.append(name)
            raise RuntimeError("SECRET_LIMIT_VALUE")

    limits = SourceLimits()
    object.__setattr__(limits, "max_nodes", Evil())

    with pytest.raises(TypeError, match="SourceLimits") as raised:
        parse_graph_source("{}", format="json", limits=limits)

    assert calls == []
    assert "SECRET_LIMIT_VALUE" not in str(raised.value)


def test_shared_source_failure_corpus_matches_frozen_codes_and_paths() -> None:
    corpus = json.loads((ROOT / "spec/conformance/authoring/yaml-invalid.case.json").read_text())
    limit_names = {
        "maxBytes": "max_bytes",
        "maxDepth": "max_depth",
        "maxNodes": "max_nodes",
    }

    for case in corpus["cases"]:
        if "sourceHex" in case:
            source = bytes.fromhex(case["sourceHex"])
        elif "sourceRepeat" in case:
            repeat = case["sourceRepeat"]
            source = (
                repeat.get("prefix", "")
                + repeat["value"] * repeat["count"]
                + repeat.get("suffix", "")
            )
        elif "sourceSegments" in case:
            source = "".join(
                segment["value"] * segment["count"] for segment in case["sourceSegments"]
            )
        else:
            source = case["source"]
        raw_limits = case.get("limits", {})
        limits = SourceLimits(**{limit_names[name]: value for name, value in raw_limits.items()})
        error = assert_source_error(
            source,
            SourceErrorCode(case["expect"]["code"]),
            format=case["format"],
            limits=limits,
        )
        if "path" in case["expect"]:
            assert error.path == case["expect"]["path"], case["name"]


def test_shared_valid_source_cases_match_frozen_graph_and_revision_hashes() -> None:
    fixture_root = ROOT / "spec/conformance/authoring"
    manifest = json.loads((fixture_root / "authoring.case.json").read_text())

    for case in manifest["validSourceCases"]:
        filename = case.get("yaml") or case.get("json")
        source_format = "yaml" if "yaml" in case else "json"
        document = parse_graph_source(
            (fixture_root / filename).read_bytes(),
            format=source_format,  # type: ignore[arg-type]
        )
        compiled = compile_graph(document)  # type: ignore[arg-type]
        identity = create_compiled_graph_identity(compiled)

        assert compiled.graph_hash == case["expect"]["graphHash"], case["name"]
        assert identity.revision_hash == case["expect"]["revisionHash"], case["name"]
        if "nodeOrder" in case["expect"]:
            assert [node.id for node in compiled.spec.nodes] == case["expect"]["nodeOrder"]
        if "edgeOrder" in case["expect"]:
            assert [edge.id for edge in compiled.spec.edges] == case["expect"]["edgeOrder"]
        if "topologicalLayers" in case["expect"]:
            assert [list(layer) for layer in compiled.topological_layers] == case["expect"][
                "topologicalLayers"
            ]


def test_shared_source_boundaries_decode_to_the_frozen_values() -> None:
    fixture_root = ROOT / "spec/conformance/authoring"
    manifest = json.loads((fixture_root / "authoring.case.json").read_text())
    limit_names = {
        "maxBytes": "max_bytes",
        "maxDepth": "max_depth",
        "maxNodes": "max_nodes",
    }

    for case in manifest["sourceBoundaryCases"]:
        limits = SourceLimits(
            **{limit_names[name]: value for name, value in case.get("limits", {}).items()}
        )
        value = parse_graph_source(
            case["source"],
            format=case["format"],
            limits=limits,
        )

        assert value == case["expect"]["value"], case["name"]


def test_shared_invalid_graph_yaml_reaches_the_canonical_compiler() -> None:
    fixture_root = ROOT / "spec/conformance/authoring"
    manifest = json.loads((fixture_root / "authoring.case.json").read_text())

    for case in manifest["compilerInvalidYamlCases"]:
        document = parse_graph_source(
            (fixture_root / case["yaml"]).read_bytes(),
            format="yaml",
        )
        result = try_compile_graph(document)  # type: ignore[arg-type]

        assert [item.code.value for item in result.diagnostics] == case["expect"][
            "diagnosticCodes"
        ], case["name"]


@pytest.mark.parametrize(
    "token",
    ["1_000", "0b10", "+0o10", "-0o10", "+0xA", "-0xA"],
)
def test_yaml_non_shared_numeric_extensions_remain_strings(token: str) -> None:
    assert parse_graph_source(f"value: {token}\n", format="yaml") == {"value": token}
