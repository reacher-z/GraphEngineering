"""Retry and circuit-breaker composition across a real adapter.

The loop reads no clock: the backoff schedule is integer arithmetic and the
breaker takes its time from the injected script.  Nothing here sleeps.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any

from graph_engineering.adapters import (
    AdapterCallOptions,
    AdapterErrorEnvelope,
    CircuitBreaker,
    CircuitStep,
    MockOutcome,
    circuit_fold,
    computed_backoff_ms,
    create_mock_adapter,
    retry_decision,
)
from tests.adapter_corpus import budget_policy_metrics, descriptor_for, request_from


@dataclass(frozen=True, slots=True)
class Attempt:
    index: int
    code: str
    may_retry: bool
    backoff_ms: int | None
    rule: str


def drive(
    adapter_id: str,
    script: tuple[MockOutcome, ...],
    side_effect_class: str = "none",
    request_mutations: object = (),
) -> tuple[list[Attempt], AdapterErrorEnvelope | None, Any]:
    """Run the dispatch loop the contract describes, with no wall clock."""
    descriptor = descriptor_for(adapter_id)
    adapter = create_mock_adapter(
        descriptor,
        script=script,
        budget_policy_allowed_provider_metrics=budget_policy_metrics(),
    )
    request = request_from(request_mutations)
    attempts: list[Attempt] = []
    last_error: AdapterErrorEnvelope | None = None
    attempt = 1
    while True:
        outcome = asyncio.run(adapter.call(request, AdapterCallOptions(attempt=attempt)))
        if outcome.ok:
            return attempts, None, outcome.value
        last_error = outcome.error
        decision = retry_decision(
            descriptor,
            last_error.code,
            side_effect_class,
            attempt,
            last_error.retry_after_ms,
        )
        attempts.append(
            Attempt(
                index=attempt,
                code=last_error.code,
                may_retry=decision.may_retry,
                backoff_ms=decision.backoff_ms,
                rule=decision.rule,
            )
        )
        if not decision.may_retry:
            return attempts, last_error, None
        attempt += 1


def test_the_integer_backoff_schedule_is_reproducible_and_clamped() -> None:
    policy = descriptor_for("mock-full").retry_policy
    assert [computed_backoff_ms(policy, n) for n in range(1, 6)] == [250, 500, 1000, 2000, 4000]
    assert computed_backoff_ms(policy, 9) == policy.max_backoff_ms


def test_a_retryable_failure_walks_the_schedule_to_the_attempt_ceiling() -> None:
    attempts, error, response = drive("mock-full", (MockOutcome(fail="GE_ADAPTER_TIMEOUT"),))
    assert response is None
    assert error is not None
    assert [(a.index, a.backoff_ms, a.rule) for a in attempts] == [
        (1, 250, "R-001"),
        (2, 500, "R-001"),
        (3, 1000, "R-001"),
        (4, None, "R-004"),
    ]


def test_a_recovered_attempt_ends_the_loop_with_a_response() -> None:
    attempts, error, response = drive(
        "mock-full",
        (MockOutcome(fail="GE_ADAPTER_TRANSPORT_FAILURE"), MockOutcome(text="recovered")),
    )
    assert error is None
    assert response is not None
    assert response.text == "recovered"
    assert [a.index for a in attempts] == [1]


def test_a_provider_hint_dominates_the_computed_backoff() -> None:
    attempts, _, _ = drive(
        "mock-full",
        (MockOutcome(fail="GE_ADAPTER_RATE_LIMITED", retry_after_ms=3000),),
    )
    assert attempts[0].backoff_ms == 3000
    assert attempts[0].rule == "R-002"


def test_a_hint_above_the_local_ceiling_abandons_rather_than_truncates() -> None:
    attempts, error, _ = drive(
        "mock-full",
        (MockOutcome(fail="GE_ADAPTER_RATE_LIMITED", retry_after_ms=5000),),
    )
    assert attempts == [
        Attempt(
            index=1,
            code="GE_ADAPTER_RATE_LIMITED",
            may_retry=False,
            backoff_ms=None,
            rule="R-003",
        )
    ]
    assert error is not None


def test_a_non_retryable_code_is_never_retried() -> None:
    attempts, _, _ = drive("mock-full", (MockOutcome(fail="GE_ADAPTER_AUTHENTICATION"),))
    assert [a.rule for a in attempts] == ["R-005"]


def test_a_non_idempotent_call_stops_while_its_effect_is_uncertain() -> None:
    attempts, error, _ = drive(
        "mock-nonidempotent",
        (MockOutcome(fail="GE_ADAPTER_TIMEOUT"),),
        side_effect_class="non-idempotent",
        request_mutations=[
            {"op": "replace", "path": "/sideEffectClass", "value": "non-idempotent"}
        ],
    )
    assert [a.rule for a in attempts] == ["R-006"]
    assert error is not None
    assert error.effect_disposition == "in-doubt"
    # cycle-semantics 13.4: an external in-doubt claim retains one in-doubt identity.
    assert error.side_effect_class == "non-idempotent"


def test_a_non_idempotent_call_refused_before_the_work_may_still_retry() -> None:
    attempts, _, _ = drive(
        "mock-nonidempotent",
        (MockOutcome(fail="GE_ADAPTER_RATE_LIMITED"),),
        side_effect_class="non-idempotent",
        request_mutations=[
            {"op": "replace", "path": "/sideEffectClass", "value": "non-idempotent"}
        ],
    )
    assert attempts[0].rule == "R-001"
    assert attempts[0].may_retry is True


def test_the_breaker_opens_on_consecutive_retryable_dispatch_failures() -> None:
    descriptor = descriptor_for("mock-full")
    breaker = CircuitBreaker(descriptor.circuit_policy)
    for now_ms in (0, 10, 20):
        assert breaker.admit() is True
        breaker.record_failure("GE_ADAPTER_TIMEOUT", now_ms)
    assert breaker.state == "open"
    assert breaker.admit() is False
    assert breaker.advance(1019) == "open"
    assert breaker.advance(1020) == "half-open"
    assert breaker.admit() is True
    breaker.record_success()
    assert breaker.state == "closed"
    assert breaker.projection().consecutive_failures == 0


def test_a_pre_dispatch_refusal_never_moves_the_breaker() -> None:
    descriptor = descriptor_for("mock-full")
    projection = circuit_fold(
        descriptor,
        tuple(
            CircuitStep(event="failure", now_ms=index * 10, code=code)
            for index, code in enumerate(
                (
                    "GE_ADAPTER_BOUNDS_EXCEEDED",
                    "GE_ADAPTER_CAPABILITY_UNSUPPORTED",
                    "GE_ADAPTER_DESCRIPTOR_INVALID",
                    "GE_ADAPTER_POLICY_DENIED",
                    "GE_ADAPTER_TOOL_VALIDATION_FAILED",
                )
            )
        ),
    )
    assert projection.state == "closed"
    assert projection.consecutive_failures == 0


def test_an_open_circuit_refuses_the_call_before_any_dispatch() -> None:
    adapter = create_mock_adapter(
        descriptor_for("mock-full"),
        budget_policy_allowed_provider_metrics=budget_policy_metrics(),
        script=(MockOutcome(text="never reached"),),
    )
    outcome = asyncio.run(
        adapter.call(request_from([{"op": "replace", "path": "/circuitState", "value": "open"}]))
    )
    assert not outcome.ok
    assert outcome.error.code == "GE_ADAPTER_POLICY_DENIED"
    assert outcome.error.denial_reason == "circuit-open"
    assert outcome.error.boundary == "pre-dispatch"
    assert outcome.error.usage is None


def test_all_three_adapters_expose_the_same_portable_boundary() -> None:
    from graph_engineering.adapters import (
        HttpResponse,
        create_http_adapter,
        create_shell_adapter,
    )

    async def transport(url: str, init: object) -> HttpResponse:
        return HttpResponse(status=200, body="ok")

    built = [
        create_mock_adapter(descriptor_for("mock-full")),
        create_http_adapter(descriptor_for("http-mock"), transport=transport),
        create_shell_adapter(descriptor_for("shell-mock")),
    ]
    for adapter in built:
        for name in ("capabilities", "supports", "preflight", "call"):
            assert callable(getattr(adapter, name))
        assert adapter.descriptor.adapter_id
        assert isinstance(adapter.capabilities(), tuple)
