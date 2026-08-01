"""The documents this package emits, validated against the shipped D13 schemas.

What is proved here is the thing an implementation can get wrong: that a usage
envelope or an error envelope this package *constructs* is accepted by
``adapter-usage.schema.json`` and ``adapter-error.schema.json``, and that the
twenty-four schema negatives are still rejected.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

import pytest
from jsonschema import Draft202012Validator  # type: ignore[import-untyped]
from referencing import Registry, Resource  # type: ignore[import-untyped]

from graph_engineering.adapters import (
    HttpResponse,
    ProviderQuantity,
    compose_usage,
    create_http_adapter,
    create_mock_adapter,
    create_shell_adapter,
    normalized_adapter_error,
)
from tests.adapter_corpus import (
    CORPUS,
    SPEC_DIR,
    apply_mutations,
    budget_policy_metrics,
    case_ids,
    cases,
    descriptor_for,
    request_from,
)

SCHEMA_NAMES = (
    "adapter-capability.schema.json",
    "adapter-error.schema.json",
    "adapter-usage.schema.json",
    "adapter-descriptor.schema.json",
)

GATEWAY_TARGET = {
    "op": "replace",
    "path": "/target",
    "value": {
        "scheme": "https",
        "host": "gateway.invalid",
        "port": 443,
        "redirected": False,
        "reauthorized": False,
    },
}


def _load_schemas() -> tuple[dict[str, Any], Registry]:
    schemas: dict[str, Any] = {}
    resources = []
    for name in SCHEMA_NAMES:
        schema = json.loads((SPEC_DIR / name).read_text(encoding="utf-8"))
        Draft202012Validator.check_schema(schema)
        schemas[name] = schema
        resources.append((schema["$id"], Resource.from_contents(schema)))
    return schemas, Registry().with_resources(resources)


SCHEMAS, REGISTRY = _load_schemas()


def validates(name: str, document: object) -> bool:
    validator = Draft202012Validator(SCHEMAS[name], registry=REGISTRY)
    return validator.is_valid(document)


def test_the_corpus_documents_validate() -> None:
    for descriptor in CORPUS["descriptors"]:
        assert validates("adapter-descriptor.schema.json", descriptor)
    assert validates("adapter-usage.schema.json", CORPUS["usageTemplate"])
    assert validates("adapter-error.schema.json", CORPUS["errorTemplate"])


@pytest.mark.parametrize(
    "case", cases("schemaNegativeCases"), ids=case_ids("schemaNegativeCases")
)
def test_schema_negative_is_rejected_by_the_schema_it_names(case: dict[str, Any]) -> None:
    schema = str(case["schema"])
    if schema == "adapter-descriptor.schema.json":
        base: Any = descriptor_for(str(CORPUS["schemaNegativeBase"])).as_document()
    elif schema == "adapter-usage.schema.json":
        base = json.loads(json.dumps(CORPUS["usageTemplate"]))
    elif schema == "adapter-error.schema.json":
        base = json.loads(json.dumps(CORPUS["errorTemplate"]))
    else:  # pragma: no cover - the corpus names only three schemas
        raise AssertionError(f"unknown schema {schema!r}")
    document = apply_mutations(base, case["mutations"])
    assert not validates(schema, document)


def test_a_composed_usage_envelope_is_schema_valid_and_cannot_carry_money() -> None:
    descriptor = descriptor_for("mock-full")
    usage = compose_usage(
        descriptor,
        request_id="req-baseline",
        provider_request_id="mock-req-000001",
        trust="provider-reported",
        finish_reason="stop",
        meters={
            "provider-calls": 1,
            "input-units": 8,
            "output-units": 4,
            "transport-bytes": 64,
        },
        provider_specific=tuple(
            ProviderQuantity(
                metric_id=metric.metric_id,
                unit_id=metric.unit_id,
                aggregation=metric.aggregation,
                amount=3,
            )
            for metric in budget_policy_metrics()
        ),
    )
    document = usage.as_document()
    assert validates("adapter-usage.schema.json", document)
    # adapter-semantics 7.1: the envelope is unable to carry money.
    assert "currency" not in document
    assert "minorUnitExponent" not in document
    assert "money-nano-minor" not in [q.resource for q in usage.quantities]


def test_an_envelope_for_every_code_in_the_closed_taxonomy_is_schema_valid() -> None:
    descriptor = descriptor_for("mock-full")
    for row in CORPUS["errorTaxonomy"]:
        code = row["code"]
        envelope = normalized_adapter_error(
            descriptor,
            request_id="req-baseline",
            attempt=1,
            code=code,
            side_effect_class="none",
            message=f"normalized {code}",
            denial_reason="circuit-open" if code == "GE_ADAPTER_POLICY_DENIED" else None,
            rule="none",
        )
        assert validates("adapter-error.schema.json", envelope.as_document())
        assert envelope.boundary == row["boundary"]
        assert envelope.retryable == row["retryable"]
        assert envelope.effect_disposition == row["effectDisposition"]
        assert envelope.usage_disposition == row["usageDisposition"]


def test_every_envelope_the_three_adapters_actually_emit_is_schema_valid() -> None:
    emitted = []

    mock = create_mock_adapter(
        descriptor_for("mock-full"),
        script=(_timeout_outcome(),),
        budget_policy_allowed_provider_metrics=budget_policy_metrics(),
    )
    mock_outcome = asyncio.run(mock.call(request_from()))
    assert not mock_outcome.ok
    emitted.append(mock_outcome.error)

    async def rate_limited(url: str, init: object) -> HttpResponse:
        assert url.startswith("https://gateway.invalid")
        return HttpResponse(status=429, headers={"retry-after": "2"}, body=None)

    http = create_http_adapter(descriptor_for("http-mock"), transport=rate_limited)
    http_outcome = asyncio.run(http.call(request_from([GATEWAY_TARGET])))
    assert not http_outcome.ok
    emitted.append(http_outcome.error)

    shell = create_shell_adapter(descriptor_for("shell-mock"))
    shell_outcome = asyncio.run(shell.call(request_from()))
    assert not shell_outcome.ok
    emitted.append(shell_outcome.error)

    assert len(emitted) == 3
    for envelope in emitted:
        assert validates("adapter-error.schema.json", envelope.as_document())
        if envelope.usage is not None:
            assert validates("adapter-usage.schema.json", envelope.usage.as_document())


def test_a_successful_calls_usage_envelope_is_schema_valid() -> None:
    mock = create_mock_adapter(
        descriptor_for("mock-full"),
        budget_policy_allowed_provider_metrics=budget_policy_metrics(),
    )
    outcome = asyncio.run(mock.call(request_from()))
    assert outcome.ok
    assert validates("adapter-usage.schema.json", outcome.value.usage.as_document())


def _timeout_outcome() -> Any:
    from graph_engineering.adapters import MockOutcome

    return MockOutcome(fail="GE_ADAPTER_TIMEOUT")
