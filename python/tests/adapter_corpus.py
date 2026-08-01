"""The literal D13 conformance corpus, loaded once for the adapter tests.

Nothing in this module restates a contract fact.  Every expectation the adapter
tests assert is read from ``spec/conformance/adapter.case.json``, and the
mutation language is applied exactly as the shipped oracle applies it.
"""

from __future__ import annotations

import json
from copy import deepcopy
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from graph_engineering.adapters import (
    AdapterDescriptor,
    AdapterRequest,
    ProviderMetricDeclaration,
)

CORPUS_PATH = Path(__file__).resolve().parents[2] / "spec" / "conformance" / "adapter.case.json"
SPEC_DIR = CORPUS_PATH.parent.parent

CORPUS: dict[str, Any] = json.loads(CORPUS_PATH.read_text(encoding="utf-8"))


@dataclass(frozen=True, slots=True)
class Mutation:
    op: str
    path: str
    value: Any = None
    has_value: bool = False


def mutations(entries: object) -> tuple[Mutation, ...]:
    if entries is None or entries == ():
        return ()
    assert isinstance(entries, list)
    parsed: list[Mutation] = []
    for entry in entries:
        assert isinstance(entry, dict)
        parsed.append(
            Mutation(
                op=str(entry["op"]),
                path=str(entry["path"]),
                value=entry.get("value"),
                has_value="value" in entry,
            )
        )
    return tuple(parsed)


def _pointer_segments(pointer: str) -> list[str]:
    if pointer == "":
        return []
    if not pointer.startswith("/"):
        raise ValueError(f"JSON Pointer must be empty or start with '/': {pointer}")
    return [
        segment.replace("~1", "/").replace("~0", "~") for segment in pointer[1:].split("/")
    ]


def apply_mutations(document: Any, entries: object = ()) -> Any:
    """The corpus mutation language, applied to a raw JSON document."""
    for mutation in mutations(entries):
        segments = _pointer_segments(mutation.path)
        if not segments:
            raise ValueError(f"root mutation is not supported: {mutation.path}")
        leaf = segments.pop()
        parent = document
        for segment in segments:
            parent = parent[int(segment)] if isinstance(parent, list) else parent[segment]
        if mutation.op == "remove":
            if isinstance(parent, list):
                parent.pop(int(leaf))
            else:
                del parent[leaf]
            continue
        value = deepcopy(mutation.value)
        if mutation.op == "add":
            if isinstance(parent, list):
                parent.insert(int(leaf), value)
            else:
                parent[leaf] = value
            continue
        if mutation.op != "replace":
            raise ValueError(f"unknown mutation op: {mutation.op}")
        if isinstance(parent, list):
            parent[int(leaf)] = value
        else:
            parent[leaf] = value
    return document


def descriptor_document(adapter_id: str) -> dict[str, Any]:
    for item in CORPUS["descriptors"]:
        if item["adapterId"] == adapter_id:
            return deepcopy(item)
    raise KeyError(f"unknown corpus descriptor {adapter_id!r}")


def descriptor_for(adapter_id: str, entries: object = ()) -> AdapterDescriptor:
    return AdapterDescriptor.from_document(
        apply_mutations(descriptor_document(adapter_id), entries)
    )


def request_from(entries: object = ()) -> AdapterRequest:
    return AdapterRequest.from_document(
        apply_mutations(deepcopy(CORPUS["requestTemplate"]), entries)
    )


def budget_policy_metrics() -> tuple[ProviderMetricDeclaration, ...]:
    return tuple(
        ProviderMetricDeclaration.from_document(item)
        for item in CORPUS["budgetPolicyAllowedProviderMetrics"]
    )


def forbidden_markers() -> tuple[str, ...]:
    return tuple(str(marker) for marker in CORPUS["forbiddenMarkers"])


def cases(section: str) -> list[dict[str, Any]]:
    entries = CORPUS[section]
    assert isinstance(entries, list)
    return entries


def case_ids(section: str) -> list[str]:
    return [str(case["id"]) for case in cases(section)]
