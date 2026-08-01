from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

import graph_engineering.sqlite_cursor_publication_initial_write_digest as digest_module
from graph_engineering.sqlite_cursor_publication_initial_write_digest import (
    SQLITE_INITIAL_WRITE_PARAMETER_DOMAIN_UTF8,
    SQLITE_INITIAL_WRITE_RESULT_DOMAIN_UTF8,
    SQLITE_INITIAL_WRITE_SIGNED_INT64_MAXIMUM,
    SQLITE_INITIAL_WRITE_SIGNED_INT64_MINIMUM,
    _digest_sqlite_initial_write_parameters_intrinsic,
    _digest_sqlite_initial_write_result_intrinsic,
    _encode_sqlite_initial_write_parameter_payload_intrinsic,
    _encode_sqlite_initial_write_result_payload_intrinsic,
)

ROOT = Path(__file__).resolve().parents[2]
INVALID = "GE_CURSOR_B3_INITIAL_WRITE_DIGEST"


def text(value: str) -> dict[str, str]:
    return {"type": "text", "value": value}


def integer(value: object) -> dict[str, object]:
    return {"type": "integer", "value": value}


def blob(value: object) -> dict[str, object]:
    return {"type": "blob", "value": value}


def expect_parameter_invalid(value: object) -> None:
    with pytest.raises(ValueError, match=f"^{INVALID}$"):
        _encode_sqlite_initial_write_parameter_payload_intrinsic(value)
    with pytest.raises(ValueError, match=f"^{INVALID}$"):
        _digest_sqlite_initial_write_parameters_intrinsic(value)


def expect_result_invalid(value: object) -> None:
    with pytest.raises(ValueError, match=f"^{INVALID}$"):
        _encode_sqlite_initial_write_result_payload_intrinsic(value)
    with pytest.raises(ValueError, match=f"^{INVALID}$"):
        _digest_sqlite_initial_write_result_intrinsic(value)


GOLDENS: tuple[tuple[str, str, object, str, str], ...] = (
    (
        "one-empty-execution",
        "parameters",
        [[]],
        "[[]]",
        "8acdf04fe02395192d1c7d704cf8ecf52e29513ccd77024ff4f9cc9e230da80a",
    ),
    (
        "one-mixed-execution",
        "parameters",
        [[text("Aé😀"), integer("-42"), blob("AP8"), {"type": "null"}]],
        '[[{"type":"text","value":"Aé😀"},{"type":"integer","value":"-42"},'
        '{"type":"blob","value":"AP8"},{"type":"null"}]]',
        "8fcf64e97e9fda027b287997e43efc5226b596207dfc56ed161e46859027c271",
    ),
    (
        "two-executions",
        "parameters",
        [[text("x"), integer("0")], [text("y"), integer("9007199254740991")]],
        '[[{"type":"text","value":"x"},{"type":"integer","value":"0"}],'
        '[{"type":"text","value":"y"},{"type":"integer",'
        '"value":"9007199254740991"}]]',
        "379049937f6797daade28d4b963dcc865f51afa5fa3422b90f4e505deaad838e",
    ),
    (
        "integer-signed-64-minimum",
        "parameters",
        [[integer("-9223372036854775808")]],
        '[[{"type":"integer","value":"-9223372036854775808"}]]',
        "d3d9b55872b8b14e2ec8a3c2b5ca27db179993b97ce9e47845efd2923eef4460",
    ),
    (
        "integer-signed-64-maximum",
        "parameters",
        [[integer("9223372036854775807")]],
        '[[{"type":"integer","value":"9223372036854775807"}]]',
        "be263941652b27aa8254e518d3de8853c3071e7b7310449a7af13fb8bd2765ce",
    ),
    (
        "result-zero",
        "result",
        {"affectedRows": "0"},
        '{"affectedRows":"0"}',
        "7d4e42c580be36f078371942187c0bdf048da4ffa35556c3f219f5930c5abd62",
    ),
    (
        "result-three",
        "result",
        {"affectedRows": "3"},
        '{"affectedRows":"3"}',
        "9c4a39646a7cb26c3ba53e91941b6fe0f4435355a06d2138156d1fd9551ba417",
    ),
)


def test_matches_all_seven_frozen_fixture_vectors() -> None:
    fixture = json.loads(
        (ROOT / "spec/conformance/sqlite-cursor-publication-rebind-v2.case.json").read_text()
    )
    vectors = fixture["authority"]["initialOuterWriteReceiptContract"]["canonicalDigestCodec"][
        "goldenVectors"
    ]
    assert [(item[0], item[1], item[3], item[4]) for item in GOLDENS] == [
        (vector["id"], vector["kind"], vector["canonicalJson"], vector["sha256"])
        for vector in vectors
    ]
    for _, kind, value, canonical, expected_digest in GOLDENS:
        if kind == "parameters":
            assert _encode_sqlite_initial_write_parameter_payload_intrinsic(value) == canonical
            assert _digest_sqlite_initial_write_parameters_intrinsic(value) == expected_digest
        else:
            assert _encode_sqlite_initial_write_result_payload_intrinsic(value) == canonical
            assert _digest_sqlite_initial_write_result_intrinsic(value) == expected_digest


def test_exact_nul_terminated_domains_and_direct_concatenation() -> None:
    assert SQLITE_INITIAL_WRITE_PARAMETER_DOMAIN_UTF8.endswith("\0")
    assert SQLITE_INITIAL_WRITE_RESULT_DOMAIN_UTF8.endswith("\0")
    assert SQLITE_INITIAL_WRITE_PARAMETER_DOMAIN_UTF8 != SQLITE_INITIAL_WRITE_RESULT_DOMAIN_UTF8
    for _, kind, _, canonical, expected_digest in GOLDENS:
        domain = (
            SQLITE_INITIAL_WRITE_PARAMETER_DOMAIN_UTF8
            if kind == "parameters"
            else SQLITE_INITIAL_WRITE_RESULT_DOMAIN_UTF8
        )
        assert hashlib.sha256((domain + canonical).encode()).hexdigest() == expected_digest


def test_preserves_two_dimensional_execution_and_parameter_order() -> None:
    controls = (
        ([], [[]]),
        ([[text("a"), text("b")]], [[text("a")], [text("b")]]),
        ([[text("first")], [text("second")]], [[text("second")], [text("first")]]),
        ([[text("first"), text("second")]], [[text("second"), text("first")]]),
    )
    assert _encode_sqlite_initial_write_parameter_payload_intrinsic([]) == "[]"
    assert _encode_sqlite_initial_write_parameter_payload_intrinsic([[]]) == "[[]]"
    for left, right in controls:
        assert _digest_sqlite_initial_write_parameters_intrinsic(
            left
        ) != _digest_sqlite_initial_write_parameters_intrinsic(right)


def test_uses_code_point_key_order_and_strict_unicode_scalar_text() -> None:
    reversed_keys = {"value": "Aé😀", "type": "text"}
    assert _encode_sqlite_initial_write_parameter_payload_intrinsic([[reversed_keys]]) == (
        '[[{"type":"text","value":"Aé😀"}]]'
    )
    composed = [[text("é")]]
    decomposed = [[text("e\u0301")]]
    assert _digest_sqlite_initial_write_parameters_intrinsic(
        composed
    ) != _digest_sqlite_initial_write_parameters_intrinsic(decomposed)
    for hostile in ("\ud800", "\udc00", "before\ud800after", "\ud83dtext", "\ud83d\ude00"):
        expect_parameter_invalid([[text(hostile)]])


def test_exact_json_string_escape_vectors() -> None:
    c0_escapes = {chr(code_point): f"\\u{code_point:04x}" for code_point in range(0x20)}
    c0_escapes.update(
        {
            "\b": "\\b",
            "\t": "\\t",
            "\n": "\\n",
            "\f": "\\f",
            "\r": "\\r",
        }
    )
    vectors = (
        ('"', '\\"'),
        ("\\", "\\\\"),
        *c0_escapes.items(),
        ("\u2028", "\u2028"),
        ("\u2029", "\u2029"),
        ("\x7f", "\x7f"),
    )
    for value, encoded in vectors:
        assert _encode_sqlite_initial_write_parameter_payload_intrinsic([[text(value)]]) == (
            '[[{"type":"text","value":"' + encoded + '"}]]'
        )


def test_parameter_payload_detaches_all_caller_owned_containers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    scalar = text("before")
    execution = [scalar]
    executions = [execution]
    original_encoder = digest_module._encode_tagged_scalar

    def mutate_caller_after_detach(detached: dict[str, object]) -> str:
        scalar["value"] = "after"
        execution.clear()
        executions.clear()
        return original_encoder(detached)

    monkeypatch.setattr(digest_module, "_encode_tagged_scalar", mutate_caller_after_detach)
    assert digest_module._encode_sqlite_initial_write_parameter_payload_intrinsic(executions) == (
        '[[{"type":"text","value":"before"}]]'
    )
    assert executions == []


def test_result_payload_detaches_caller_owned_dict(monkeypatch: pytest.MonkeyPatch) -> None:
    result = {"affectedRows": "7"}
    original_encoder = digest_module._encode_code_point_ordered_string_object

    def mutate_caller_after_detach(members: object) -> str:
        result["affectedRows"] = "999"
        return original_encoder(members)  # type: ignore[arg-type]

    monkeypatch.setattr(
        digest_module,
        "_encode_code_point_ordered_string_object",
        mutate_caller_after_detach,
    )
    assert digest_module._encode_sqlite_initial_write_result_payload_intrinsic(result) == (
        '{"affectedRows":"7"}'
    )
    assert result == {"affectedRows": "999"}


def test_signed_int64_boundaries_and_lexemes_are_exact() -> None:
    assert SQLITE_INITIAL_WRITE_SIGNED_INT64_MINIMUM == "-9223372036854775808"
    assert SQLITE_INITIAL_WRITE_SIGNED_INT64_MAXIMUM == "9223372036854775807"
    for value in ("0", "-1", "1", "-9223372036854775808", "9223372036854775807"):
        _digest_sqlite_initial_write_parameters_intrinsic([[integer(value)]])
    for value in (
        "+1",
        "01",
        "00",
        "-0",
        "-01",
        " 1",
        "1 ",
        "1.0",
        "1e0",
        "",
        "9223372036854775808",
        "-9223372036854775809",
        "9" * 100_000,
        0,
        True,
        1.0,
    ):
        expect_parameter_invalid([[integer(value)]])


def test_unpadded_base64url_is_canonical() -> None:
    for value in ("", "AA", "AAE", "AAEC", "-_8", "AP8"):
        _digest_sqlite_initial_write_parameters_intrinsic([[blob(value)]])
    for value in ("AA=", "AA==", "+/8", "AA/", "AA+", "A A", "A\nA", "A", "AB", "AAB"):
        expect_parameter_invalid([[blob(value)]])


def test_rejects_wrong_shapes_and_noncanonical_results() -> None:
    for value in (
        None,
        (),
        {},
        [{"type": "null"}],
        [[{"type": "null", "value": None}]],
        [[{"type": "text"}]],
        [[{"type": "blob", "value": 0}]],
        [[{"type": "unknown"}]],
    ):
        expect_parameter_invalid(value)
    for value in (
        None,
        {},
        {"affectedRows": 0},
        {"affectedRows": ""},
        {"affectedRows": "00"},
        {"affectedRows": "-1"},
        {"affectedRows": "+1"},
        {"affectedRows": "1", "extra": True},
    ):
        expect_result_invalid(value)


def test_module_remains_package_private_and_avoids_general_canonical_json() -> None:
    root_source = (ROOT / "python/src/graph_engineering/__init__.py").read_text()
    module_source = (
        ROOT / "python/src/graph_engineering/sqlite_cursor_publication_initial_write_digest.py"
    ).read_text()
    assert "sqlite_cursor_publication_initial_write_digest" not in root_source
    assert "from .canonical import" not in module_source
    assert "executescript" not in module_source
