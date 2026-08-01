"""The HTTP tool adapter over an injected transport.

There is no default transport and no module-level fallback: every test here
supplies its own fake, and the fake is the only thing that could ever perform
I/O — it never does.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any

import pytest

from graph_engineering.adapters import (
    AdapterCallOptions,
    HttpCallSpec,
    HttpRequestInit,
    HttpResponse,
    HttpTransportTimeout,
    classify_http_status,
    create_http_adapter,
    parse_retry_after_ms,
)
from tests.adapter_corpus import budget_policy_metrics, descriptor_for, request_from

GATEWAY = {
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
OFF_ALLOWLIST = {
    "op": "replace",
    "path": "/target",
    "value": {
        "scheme": "https",
        "host": "elsewhere.invalid",
        "port": 443,
        "redirected": False,
        "reauthorized": False,
    },
}


@dataclass
class FakeTransport:
    """A scripted transport.  It performs no I/O; it returns values."""

    responses: list[HttpResponse | Exception]
    calls: list[tuple[str, HttpRequestInit]] = field(default_factory=list)

    async def __call__(self, url: str, init: HttpRequestInit) -> HttpResponse:
        self.calls.append((url, init))
        entry = self.responses[min(len(self.calls) - 1, len(self.responses) - 1)]
        if isinstance(entry, Exception):
            raise entry
        return entry


def adapter(transport: Any, **kwargs: Any) -> Any:
    return create_http_adapter(
        descriptor_for("http-mock"),
        transport=transport,
        budget_policy_allowed_provider_metrics=budget_policy_metrics(),
        **kwargs,
    )


def ok_transport(body: str = "ok", **headers: str) -> FakeTransport:
    return FakeTransport([HttpResponse(status=200, headers=headers, body=body)])


# ---------------------------------------------------------------------------
# The transport is injected, never defaulted
# ---------------------------------------------------------------------------


def test_the_adapter_requires_an_injected_transport() -> None:
    with pytest.raises(ValueError, match="injected transport"):
        create_http_adapter(descriptor_for("http-mock"), transport=None)  # type: ignore[arg-type]


def test_a_refused_preflight_never_touches_the_transport() -> None:
    transport = ok_transport()
    http = adapter(transport)
    outcome = asyncio.run(http.call(request_from([OFF_ALLOWLIST])))
    assert not outcome.ok
    assert outcome.error.code == "GE_ADAPTER_POLICY_DENIED"
    assert outcome.error.denial_reason == "egress-not-allowlisted"
    assert transport.calls == []


# ---------------------------------------------------------------------------
# The request plan is a pure value
# ---------------------------------------------------------------------------


def test_a_request_plan_is_built_without_any_transport_call() -> None:
    transport = ok_transport()
    http = adapter(transport)
    plan = http.build_request_plan(
        request_from([GATEWAY]), HttpCallSpec(method="POST", path="/v1/echo", body="hello")
    )
    assert plan.url == "https://gateway.invalid/v1/echo"
    assert plan.init.method == "POST"
    assert plan.init.redirect == "manual"
    assert plan.init.tls_minimum_version == "TLSv1.3"
    assert plan.init.timeout_ms == 30000
    assert plan.body_bytes == 5
    assert transport.calls == []


def test_credentials_are_host_isolated_and_header_names_are_canonical() -> None:
    http = adapter(
        ok_transport(),
        credentials={"gateway.invalid": {"Authorization": "Bearer local-only"}},
    )
    plan = http.build_request_plan(
        request_from([GATEWAY]), HttpCallSpec(headers={"X-Trace": "t-1"})
    )
    assert list(plan.init.headers) == ["authorization", "x-trace"]

    other = http.build_request_plan(
        request_from(
            [
                {
                    "op": "replace",
                    "path": "/target",
                    "value": {
                        "scheme": "https",
                        "host": "stream.invalid",
                        "port": 443,
                        "redirected": False,
                        "reauthorized": False,
                    },
                }
            ]
        )
    )
    assert "authorization" not in other.init.headers


def test_a_non_default_port_is_carried_in_the_authority() -> None:
    http = adapter(ok_transport())
    plan = http.build_request_plan(
        request_from(
            [
                {
                    "op": "replace",
                    "path": "/target",
                    "value": {
                        "scheme": "https",
                        "host": "gateway.invalid",
                        "port": 8443,
                        "redirected": False,
                        "reauthorized": False,
                    },
                }
            ]
        )
    )
    assert plan.url == "https://gateway.invalid:8443/"


# ---------------------------------------------------------------------------
# Dispatch outcomes
# ---------------------------------------------------------------------------


def test_a_successful_call_reports_transport_bytes_and_one_provider_call() -> None:
    transport = ok_transport("hello")
    http = adapter(transport)
    outcome = asyncio.run(http.call(request_from([GATEWAY])))
    assert outcome.ok
    assert len(transport.calls) == 1
    assert outcome.value.text == "hello"
    meters = {q.resource: q.amount for q in outcome.value.usage.quantities}
    assert meters["provider-calls"] == 1
    assert meters["transport-bytes"] == 5
    # http-mock declares no usage-reporting, so `U-018` pins the trust.
    assert outcome.value.usage.trust == "unknown"
    assert outcome.value.provider_request_id is None


def test_a_rate_limit_is_retryable_and_carries_the_provider_hint() -> None:
    transport = FakeTransport(
        [HttpResponse(status=429, headers={"Retry-After": "2"}, body=None)]
    )
    http = adapter(transport)
    outcome = asyncio.run(http.call(request_from([GATEWAY])))
    assert not outcome.ok
    assert outcome.error.code == "GE_ADAPTER_RATE_LIMITED"
    assert outcome.error.retryable is True
    assert outcome.error.effect_disposition == "not-applied"
    assert outcome.error.retry_after_ms == 2000
    assert outcome.error.usage is None


def test_a_server_error_is_in_doubt_rather_than_failed() -> None:
    http = adapter(FakeTransport([HttpResponse(status=500, body="boom")]))
    outcome = asyncio.run(http.call(request_from([GATEWAY])))
    assert not outcome.ok
    assert outcome.error.code == "GE_ADAPTER_TRANSPORT_FAILURE"
    assert outcome.error.effect_disposition == "in-doubt"
    assert outcome.error.usage_disposition == "conservative"
    assert outcome.error.usage is not None


def test_an_unmapped_client_status_is_a_provably_absent_effect() -> None:
    http = adapter(FakeTransport([HttpResponse(status=404, body="missing")]))
    outcome = asyncio.run(http.call(request_from([GATEWAY])))
    assert not outcome.ok
    assert outcome.error.code == "GE_ADAPTER_INVALID_REQUEST"
    assert outcome.error.effect_disposition == "not-applied"


def test_an_oversized_response_is_a_dispatch_code_not_a_bounds_refusal() -> None:
    http = create_http_adapter(
        descriptor_for(
            "http-mock",
            [
                {"op": "replace", "path": "/bounds/maxResponseBytes", "value": 4},
                {"op": "replace", "path": "/bounds/maxStreamFrameBytes", "value": 4},
            ],
        ),
        transport=FakeTransport([HttpResponse(status=200, body="far too long")]),
    )
    outcome = asyncio.run(http.call(request_from([GATEWAY])))
    assert not outcome.ok
    assert outcome.error.code == "GE_ADAPTER_MALFORMED_RESPONSE"
    assert outcome.error.boundary == "dispatch"


def test_a_transport_exception_is_normalized_and_the_cause_is_never_quoted() -> None:
    http = adapter(FakeTransport([RuntimeError("https://user:synthetic@gateway.invalid/")]))
    outcome = asyncio.run(http.call(request_from([GATEWAY])))
    assert not outcome.ok
    assert outcome.error.code == "GE_ADAPTER_TRANSPORT_FAILURE"
    assert "synthetic" not in outcome.error.message
    assert "gateway.invalid" not in outcome.error.message
    assert "RuntimeError" in outcome.error.message


def test_a_transport_timeout_is_a_timeout_and_the_effect_is_in_doubt() -> None:
    http = adapter(FakeTransport([HttpTransportTimeout("the declared bound elapsed")]))
    outcome = asyncio.run(http.call(request_from([GATEWAY])))
    assert not outcome.ok
    assert outcome.error.code == "GE_ADAPTER_TIMEOUT"
    assert outcome.error.effect_disposition == "in-doubt"


def test_cancellation_before_dispatch_never_reaches_the_transport() -> None:
    class Cancelled:
        cancelled = True

    transport = ok_transport()
    http = adapter(transport)
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(
            http.call(request_from([GATEWAY]), AdapterCallOptions(signal=Cancelled()))
        )
    assert transport.calls == []


# ---------------------------------------------------------------------------
# Redirects: every hop is re-authorized
# ---------------------------------------------------------------------------


def test_a_redirect_to_an_allowlisted_host_is_followed_and_reauthorized() -> None:
    transport = FakeTransport(
        [
            HttpResponse(status=302, headers={"Location": "https://stream.invalid/next"}),
            HttpResponse(status=200, body="second"),
        ]
    )
    http = adapter(transport)
    outcome = asyncio.run(http.call(request_from([GATEWAY])))
    assert outcome.ok
    assert [url for url, _ in transport.calls] == [
        "https://gateway.invalid/",
        "https://stream.invalid/next",
    ]
    meters = {q.resource: q.amount for q in outcome.value.usage.quantities}
    assert meters["provider-calls"] == 2


def test_a_redirect_to_an_unallowlisted_host_is_refused_before_the_second_hop() -> None:
    transport = FakeTransport(
        [HttpResponse(status=302, headers={"Location": "https://elsewhere.invalid/next"})]
    )
    http = adapter(transport)
    outcome = asyncio.run(http.call(request_from([GATEWAY])))
    assert not outcome.ok
    assert outcome.error.code == "GE_ADAPTER_POLICY_DENIED"
    assert outcome.error.denial_reason == "egress-not-allowlisted"
    assert len(transport.calls) == 1


def test_a_redirect_may_never_downgrade_the_transport_to_plaintext() -> None:
    transport = FakeTransport(
        [HttpResponse(status=302, headers={"Location": "http://gateway.invalid:443/next"})]
    )
    http = adapter(transport)
    outcome = asyncio.run(http.call(request_from([GATEWAY])))
    assert not outcome.ok
    assert outcome.error.code == "GE_ADAPTER_POLICY_DENIED"
    assert outcome.error.denial_reason == "tls-policy"
    assert len(transport.calls) == 1


def test_a_redirect_onto_an_unallowlisted_port_is_refused_by_the_allowlist() -> None:
    transport = FakeTransport(
        [HttpResponse(status=302, headers={"Location": "http://gateway.invalid/next"})]
    )
    http = adapter(transport)
    outcome = asyncio.run(http.call(request_from([GATEWAY])))
    assert not outcome.ok
    assert outcome.error.denial_reason == "egress-not-allowlisted"
    assert len(transport.calls) == 1


def test_a_redirect_this_adapter_may_not_follow_is_refused() -> None:
    http = create_http_adapter(
        descriptor_for(
            "http-mock", [{"op": "replace", "path": "/network/allowRedirects", "value": False}]
        ),
        transport=FakeTransport(
            [HttpResponse(status=302, headers={"Location": "/next"})]
        ),
    )
    outcome = asyncio.run(http.call(request_from([GATEWAY])))
    assert not outcome.ok
    assert outcome.error.denial_reason == "egress-not-allowlisted"


def test_an_unparseable_redirect_location_is_refused_rather_than_guessed() -> None:
    transport = FakeTransport(
        [HttpResponse(status=302, headers={"Location": "gopher:elsewhere"})]
    )
    http = adapter(transport)
    outcome = asyncio.run(http.call(request_from([GATEWAY])))
    assert not outcome.ok
    assert outcome.error.code == "GE_ADAPTER_INVALID_REQUEST"


def test_a_redirect_chain_is_bounded() -> None:
    transport = FakeTransport(
        [HttpResponse(status=302, headers={"Location": "/loop"})]
    )
    http = adapter(transport, max_redirects=2)
    outcome = asyncio.run(http.call(request_from([GATEWAY])))
    assert not outcome.ok
    assert outcome.error.code == "GE_ADAPTER_TRANSPORT_FAILURE"
    assert len(transport.calls) == 3


def test_a_redirect_without_a_location_is_a_transport_failure() -> None:
    http = adapter(FakeTransport([HttpResponse(status=302)]))
    outcome = asyncio.run(http.call(request_from([GATEWAY])))
    assert not outcome.ok
    assert outcome.error.code == "GE_ADAPTER_TRANSPORT_FAILURE"


# ---------------------------------------------------------------------------
# Pure classification helpers
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("status", "expected"),
    [
        (200, None),
        (204, None),
        (400, "GE_ADAPTER_INVALID_REQUEST"),
        (401, "GE_ADAPTER_AUTHENTICATION"),
        (402, "GE_ADAPTER_QUOTA_EXCEEDED"),
        (403, "GE_ADAPTER_AUTHENTICATION"),
        (408, "GE_ADAPTER_TIMEOUT"),
        (418, "GE_ADAPTER_INVALID_REQUEST"),
        (422, "GE_ADAPTER_INVALID_REQUEST"),
        (429, "GE_ADAPTER_RATE_LIMITED"),
        (500, "GE_ADAPTER_TRANSPORT_FAILURE"),
        (503, "GE_ADAPTER_RATE_LIMITED"),
        (504, "GE_ADAPTER_TIMEOUT"),
    ],
)
def test_status_classification_never_reads_a_status_text(status: int, expected: str | None) -> None:
    assert classify_http_status(status) == expected


def test_a_caller_supplied_status_override_wins() -> None:
    assert (
        classify_http_status(418, {418: "GE_ADAPTER_CONTENT_FILTERED"})
        == "GE_ADAPTER_CONTENT_FILTERED"
    )


@pytest.mark.parametrize(
    ("header", "expected"),
    [
        (None, None),
        ("2", 2000),
        (" 30 ", 30000),
        ("0", 0),
        ("Wed, 21 Oct 2015 07:28:00 GMT", None),
        ("-1", None),
        ("3601", None),
        ("not-a-number", None),
    ],
)
def test_retry_after_is_delta_seconds_only_because_there_is_no_wall_clock(
    header: str | None, expected: int | None
) -> None:
    assert parse_retry_after_ms(header) == expected


def test_the_stream_surface_delivers_one_conforming_frame_sequence() -> None:
    http = adapter(ok_transport("hello"))
    outcome, frames = asyncio.run(http.stream(request_from([GATEWAY])))
    assert outcome.ok
    assert [frame.kind for frame in frames] == ["start", "text-delta", "finish"]
    assert [frame.sequence for frame in frames] == [0, 1, 2]


def test_a_declared_provider_request_id_and_usage_reporting_are_honoured() -> None:
    descriptor = descriptor_for(
        "http-mock",
        [
            {
                "op": "replace",
                "path": "/capabilities",
                "value": [
                    "cancellation",
                    "idempotency-key",
                    "provider-request-id",
                    "rate-limit-reporting",
                    "retry-after-hint",
                    "streaming",
                    "usage-reporting",
                ],
            }
        ],
    )
    http = create_http_adapter(
        descriptor,
        transport=FakeTransport(
            [HttpResponse(status=200, headers={"X-Request-Id": "gw-42"}, body="ok")]
        ),
    )
    outcome = asyncio.run(http.call(request_from([GATEWAY])))
    assert outcome.ok
    assert outcome.value.provider_request_id == "gw-42"
    # The HTTP adapter never claims a provider reported these meters.
    assert outcome.value.usage.trust == "adapter-conservative"
    assert outcome.value.usage.budget_cost_state == "estimated"
