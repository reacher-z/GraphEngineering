"""The deterministic mock adapter as a running adapter, not a fixture.

Every observable here is a function of the descriptor, the script and the
request.  There is no clock, no credential, no socket and no process.
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from graph_engineering.adapters import (
    ADAPTER_ERROR_CODES,
    REPORTABLE_RESOURCES,
    AdapterCallOptions,
    AdapterOutcomeMisuse,
    MockOutcome,
    ModelToolCall,
    StreamFrame,
    create_mock_adapter,
    taxonomy_facts,
)
from tests.adapter_corpus import budget_policy_metrics, descriptor_for, forbidden_markers

ECHO_TOOL = {
    "op": "replace",
    "path": "/toolDefinitions",
    "value": [
        {"name": "echo", "requiredArguments": ["text"], "allowedArguments": ["locale", "text"]}
    ],
}


class Cancelled:
    """A caller-owned cancellation fact, injected as a value."""

    def __init__(self, cancelled: bool = False) -> None:
        self._cancelled = cancelled

    @property
    def cancelled(self) -> bool:
        return self._cancelled

    def cancel(self) -> None:
        self._cancelled = True


def adapter(adapter_id: str = "mock-full", **kwargs: Any) -> Any:
    return create_mock_adapter(
        descriptor_for(adapter_id),
        budget_policy_allowed_provider_metrics=budget_policy_metrics(),
        forbidden_markers=forbidden_markers(),
        **kwargs,
    )


def request(mutations: object = ()) -> Any:
    from tests.adapter_corpus import request_from

    return request_from(mutations)


# ---------------------------------------------------------------------------
# Capability discovery is pre-dispatch
# ---------------------------------------------------------------------------


def test_capability_discovery_reports_the_declared_inventory() -> None:
    mock = adapter()
    assert mock.capabilities() == descriptor_for("mock-full").capabilities
    assert mock.supports("streaming") is True
    assert adapter("mock-minimal").supports("streaming") is False


def test_an_undeclared_capability_fails_before_dispatch_with_a_pre_dispatch_code() -> None:
    mock = adapter("mock-minimal")
    outcome = asyncio.run(
        mock.call(request([{"op": "replace", "path": "/streaming", "value": True}]))
    )
    assert not outcome.ok
    error = outcome.error
    assert error.code == "GE_ADAPTER_CAPABILITY_UNSUPPORTED"
    assert error.boundary == "pre-dispatch"
    assert error.effect_disposition == "not-applied"
    assert error.usage_disposition == "none"
    assert error.usage is None
    assert error.provider_request_id is None
    assert error.message == (
        "Adapter capability 'streaming' required by request 'req-baseline' "
        "is not declared by adapter 'mock-minimal'"
    )


def test_a_refused_call_performs_no_provider_request_at_all() -> None:
    mock = adapter("mock-minimal")
    for _ in range(3):
        outcome = asyncio.run(
            mock.call(request([{"op": "replace", "path": "/cancellable", "value": True}]))
        )
        assert not outcome.ok
        assert outcome.error.provider_request_id is None


def test_reading_a_refusal_as_a_value_is_a_misuse() -> None:
    mock = adapter("mock-minimal")
    outcome = asyncio.run(
        mock.call(request([{"op": "replace", "path": "/structuredOutput", "value": True}]))
    )
    with pytest.raises(AdapterOutcomeMisuse):
        _ = outcome.value


# ---------------------------------------------------------------------------
# A full call
# ---------------------------------------------------------------------------


def test_a_default_call_succeeds_with_a_provider_reported_usage_envelope() -> None:
    mock = adapter()
    outcome = asyncio.run(mock.call(request()))
    assert outcome.ok
    response = outcome.value
    assert response.request_id == "req-baseline"
    assert response.provider_request_id == "mock-req-000001"
    assert response.finish_reason == "stop"
    assert response.usage.trust == "provider-reported"
    assert response.usage.budget_cost_state == "provider-reported"
    resources = [quantity.resource for quantity in response.usage.quantities]
    assert resources == sorted(resources)
    assert "provider-calls" in resources
    for resource in resources:
        assert resource in REPORTABLE_RESOURCES


def test_an_adapter_without_usage_reporting_reports_unknown_trust_and_no_usage_unit_meter() -> None:
    mock = adapter("mock-minimal")
    outcome = asyncio.run(mock.call(request()))
    assert outcome.ok
    usage = outcome.value.usage
    assert usage.trust == "unknown"
    assert usage.budget_cost_state == "unknown"
    assert usage.provider_request_id is None
    assert [q.resource for q in usage.quantities] == ["provider-calls", "transport-bytes"]


def test_a_usage_envelope_can_never_carry_money() -> None:
    mock = adapter()
    outcome = asyncio.run(mock.call(request()))
    assert outcome.ok
    document = outcome.value.usage.as_document()
    assert "currency" not in document
    assert "minorUnitExponent" not in document
    assert all(q.resource != "money-nano-minor" for q in outcome.value.usage.quantities)


def test_structured_output_is_returned_only_when_the_request_asked_for_it() -> None:
    payload = {"answer": 42}
    mock = adapter(script=(MockOutcome(structured_output=payload),))
    plain = asyncio.run(mock.call(request()))
    assert plain.ok
    assert plain.value.structured_output is None

    structured = asyncio.run(
        mock.call(request([{"op": "replace", "path": "/structuredOutput", "value": True}]))
    )
    assert structured.ok
    assert structured.value.structured_output == payload


def test_a_streamed_call_normalizes_its_own_frames() -> None:
    mock = adapter()
    stream = asyncio.run(
        mock.stream(request([{"op": "replace", "path": "/streaming", "value": True}]))
    )
    assert stream.outcome.ok
    normalized = stream.outcome.value.normalized_stream
    assert normalized is not None
    assert normalized.frames == len(stream.frames)
    assert normalized.finish_reason == "stop"
    assert normalized.usage_frames == 1

    async def drain() -> list[StreamFrame]:
        return [frame async for frame in stream]

    frames = asyncio.run(drain())
    assert [frame.kind for frame in frames] == ["start", "text-delta", "usage", "finish"]
    assert [frame.sequence for frame in frames] == [0, 1, 2, 3]


def test_a_malformed_scripted_stream_is_a_dispatch_code_not_a_bounds_refusal() -> None:
    mock = adapter(
        script=(
            MockOutcome(
                frames=(
                    StreamFrame(sequence=0, kind="start", bytes=16),
                    StreamFrame(sequence=2, kind="finish", bytes=8, finish_reason="stop"),
                )
            ),
        )
    )
    outcome = asyncio.run(mock.call(request()))
    assert not outcome.ok
    assert outcome.error.code == "GE_ADAPTER_MALFORMED_RESPONSE"
    assert outcome.error.boundary == "dispatch"
    assert _rule(outcome.error) == "S-004"


def test_a_provider_disconnect_is_a_transport_failure_and_the_effect_is_in_doubt() -> None:
    mock = adapter(
        script=(MockOutcome(frames=(StreamFrame(sequence=0, kind="start", bytes=16),)),)
    )
    outcome = asyncio.run(mock.call(request()))
    assert not outcome.ok
    assert outcome.error.code == "GE_ADAPTER_TRANSPORT_FAILURE"
    assert outcome.error.effect_disposition == "in-doubt"
    assert _rule(outcome.error) == "S-006"


def test_tool_calls_are_validated_before_the_tool_runs() -> None:
    mock = adapter(
        script=(
            MockOutcome(
                tool_calls=(ModelToolCall(id="call-1", name="echo", arguments={"text": "mock"}),)
            ),
        )
    )
    outcome = asyncio.run(mock.call(request([ECHO_TOOL])))
    assert outcome.ok
    assert outcome.value.finish_reason == "tool-calls"
    assert [q.resource for q in outcome.value.usage.quantities].count("tool-calls") == 1


def test_authority_comes_from_policy_and_never_from_the_model() -> None:
    mock = adapter(
        script=(
            MockOutcome(
                tool_calls=(ModelToolCall(id="call-1", name="echo", arguments={"text": "mock"}),)
            ),
        )
    )
    outcome = asyncio.run(
        mock.call(request([ECHO_TOOL]), AdapterCallOptions(authorized_tools=()))
    )
    assert not outcome.ok
    assert outcome.error.code == "GE_ADAPTER_TOOL_VALIDATION_FAILED"
    assert _rule(outcome.error) == "T-005"


# ---------------------------------------------------------------------------
# Cancellation
# ---------------------------------------------------------------------------


def test_cancellation_before_dispatch_produces_no_adapter_error_at_all() -> None:
    mock = adapter()
    signal = Cancelled(cancelled=True)
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(mock.call(request(), AdapterCallOptions(signal=signal)))


def test_cancellation_after_dispatch_is_in_doubt_with_conservative_usage() -> None:
    mock = adapter()
    signal = Cancelled()

    class LateCancel:
        """Reads as not-cancelled once (pre-dispatch), then cancelled."""

        def __init__(self) -> None:
            self.reads = 0

        @property
        def cancelled(self) -> bool:
            self.reads += 1
            return self.reads > 1

    late = LateCancel()
    outcome = asyncio.run(mock.call(request(), AdapterCallOptions(signal=late)))
    assert not outcome.ok
    error = outcome.error
    assert error.code == "GE_ADAPTER_CANCELLED"
    assert error.boundary == "dispatch"
    assert error.effect_disposition == "in-doubt"
    assert error.usage_disposition == "conservative"
    assert error.usage is not None
    assert error.usage.trust == "adapter-conservative"
    assert signal.cancelled is False


# ---------------------------------------------------------------------------
# Every closed-taxonomy error is reachable by configuration
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("code", ADAPTER_ERROR_CODES)
def test_every_taxonomy_code_is_reachable_by_configuration(code: str) -> None:
    mock = adapter(
        script=(
            MockOutcome(
                fail=code,
                denial_reason="circuit-open" if code == "GE_ADAPTER_POLICY_DENIED" else None,
            ),
        )
    )
    outcome = asyncio.run(mock.call(request()))
    assert not outcome.ok
    error = outcome.error
    facts = taxonomy_facts(code)
    assert error.code == code
    assert error.boundary == facts.boundary
    assert error.retryable == facts.retryable
    assert error.effect_disposition == facts.effect_disposition
    assert (error.usage is None) == (facts.effect_disposition == "not-applied")
    assert (error.provider_request_id is not None) == (facts.boundary == "dispatch")
    assert (error.denial_reason is not None) == (code == "GE_ADAPTER_POLICY_DENIED")


def test_a_retry_after_hint_survives_only_on_a_retryable_code() -> None:
    retryable = adapter(script=(MockOutcome(fail="GE_ADAPTER_RATE_LIMITED", retry_after_ms=2000),))
    outcome = asyncio.run(retryable.call(request()))
    assert not outcome.ok
    assert outcome.error.retry_after_ms == 2000

    fixed = adapter(script=(MockOutcome(fail="GE_ADAPTER_AUTHENTICATION", retry_after_ms=2000),))
    other = asyncio.run(fixed.call(request()))
    assert not other.ok
    assert other.error.retry_after_ms is None


def test_fault_injection_requires_the_capability_and_is_never_laundered_into_a_code() -> None:
    mock = create_mock_adapter(
        descriptor_for("local-mock"),
        budget_policy_allowed_provider_metrics=budget_policy_metrics(),
        script=(MockOutcome(fail="GE_ADAPTER_TIMEOUT"),),
    )
    assert mock.supports("fault-injection") is False
    with pytest.raises(ValueError, match="fault-injection"):
        asyncio.run(mock.call(request()))


def test_the_script_is_consumed_in_order_and_the_last_entry_repeats() -> None:
    mock = adapter(
        script=(MockOutcome(fail="GE_ADAPTER_TIMEOUT"), MockOutcome(text="second attempt"))
    )
    first = asyncio.run(mock.call(request(), AdapterCallOptions(attempt=1)))
    assert not first.ok
    second = asyncio.run(mock.call(request(), AdapterCallOptions(attempt=2)))
    assert second.ok
    assert second.value.text == "second attempt"
    third = asyncio.run(mock.call(request(), AdapterCallOptions(attempt=3)))
    assert third.ok
    assert third.value.text == "second attempt"


def test_an_error_message_never_carries_a_forbidden_marker() -> None:
    mock = adapter(script=(MockOutcome(fail="GE_ADAPTER_TIMEOUT"),))
    outcome = asyncio.run(mock.call(request()))
    assert not outcome.ok
    haystack = outcome.error.message + "".join(
        f"{field.name}={field.value}" for field in outcome.error.provider_safe_fields
    )
    for marker in forbidden_markers():
        assert marker not in haystack


def _rule(error: Any) -> str | None:
    for field in error.provider_safe_fields:
        if field.name == "rule":
            return str(field.value)
    return None
