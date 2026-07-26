from __future__ import annotations

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from graph_engineering import GraphEvent

ROOT = Path(__file__).resolve().parents[2]


def test_graph_event_consumes_shared_strict_rfc3339_corpus() -> None:
    corpus = json.loads((ROOT / "spec/conformance/strict-rfc3339.case.json").read_text())
    base = json.loads((ROOT / "spec/conformance/run-created.event.json").read_text())

    for timestamp in corpus["valid"]:
        GraphEvent.model_validate({**base, "timestamp": timestamp})
    for timestamp in corpus["invalid"]:
        with pytest.raises(ValidationError):
            GraphEvent.model_validate({**base, "timestamp": timestamp})


def test_graph_event_matches_shared_conformance_envelope() -> None:
    document = json.loads((ROOT / "spec/conformance/run-created.event.json").read_text())

    event = GraphEvent.model_validate(document)

    assert event.api_version == "graphengineering.reacher-z.github.io/events/v1alpha1"
    assert event.sequence == 0
    assert event.model_dump(mode="json", by_alias=True, exclude_unset=True) == document


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("timestamp", "2026-07-26T00:00:00"),
        ("timestamp", "not-a-date"),
        ("timestamp", "20260726T000000Z"),
        ("timestamp", "2026-02-30T00:00:00Z"),
        ("timestamp", "2026-07-26T24:00:00Z"),
        ("sequence", -1),
        ("sequence", 2**53),
        ("graphRevision", 0),
        ("graphRevision", 2**53),
        ("attempt", 2**53),
        ("type", "UnknownEvent"),
    ],
)
def test_graph_event_rejects_invalid_envelope_values(field: str, value: object) -> None:
    document = json.loads((ROOT / "spec/conformance/run-created.event.json").read_text())
    document[field] = value

    with pytest.raises(ValidationError):
        GraphEvent.model_validate(document)


def test_graph_event_rejects_unknown_fields() -> None:
    document = json.loads((ROOT / "spec/conformance/run-created.event.json").read_text())
    document["secretPrompt"] = "must not be persisted"

    with pytest.raises(ValidationError):
        GraphEvent.model_validate(document)


@pytest.mark.parametrize(
    ("field", "value"),
    [("traceId", None), ("attempt", None), ("data", {"bad": float("nan")})],
)
def test_graph_event_rejects_present_null_optionals_and_nonfinite_json(
    field: str, value: object
) -> None:
    document = json.loads((ROOT / "spec/conformance/run-created.event.json").read_text())
    document[field] = value

    with pytest.raises(ValidationError):
        GraphEvent.model_validate(document)


def test_graph_event_normalizes_surrogate_pairs_and_rejects_key_collisions() -> None:
    scalar = json.loads(r'"\ud83d\ude00"')
    explicit_pair = "\ud83d\ude00"
    document = json.loads((ROOT / "spec/conformance/run-created.event.json").read_text())
    document["data"] = {explicit_pair: explicit_pair}

    event = GraphEvent.model_validate(document)

    assert event.data == {scalar: scalar}
    document["data"] = {explicit_pair: 1, scalar: 2}
    with pytest.raises(ValidationError, match="keys collide"):
        GraphEvent.model_validate(document)
