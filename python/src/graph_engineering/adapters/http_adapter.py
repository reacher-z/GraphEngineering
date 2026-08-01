"""The generic HTTP tool adapter.

The transport is *injected*.  There is no default, no fallback to any client
library and no import of ``http.client``, ``urllib.request``, ``socket`` or
``asyncio.open_connection`` anywhere in this package, so a request plan can be
constructed and asserted with no network access at all.

Every hop is authorized by :func:`preflight` against the descriptor's network
profile: scheme, host and port allowlists (``P-014``..``P-016``), redirect
permission (``P-018``), redirect re-authorization (``P-017``) and the plaintext
downgrade refusal (``P-019``).  Redirects are never followed by the transport —
the adapter follows them itself so that each hop is re-authorized.
"""

from __future__ import annotations

import asyncio
import re
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass, field, replace
from typing import Final

from .base import (
    AdapterCallOptions,
    AdapterOutcome,
    AdapterResponse,
    is_aborted,
    ok,
    refused,
    run_preflight,
)
from .circuit import CircuitBreaker
from .contract import taxonomy_facts
from .envelope import normalized_adapter_error
from .types import (
    AdapterCapability,
    AdapterDescriptor,
    AdapterErrorCode,
    AdapterErrorEnvelope,
    AdapterRequest,
    AdapterUsage,
    EgressTarget,
    PreflightOutcome,
    ProviderMetricDeclaration,
    StreamFrame,
)
from .usage import compose_usage

DEFAULT_PORTS: Final[dict[str, int]] = {"http": 80, "https": 443}
DEFAULT_MAX_REDIRECTS: Final = 3
_ABSOLUTE_LOCATION = re.compile(
    r"^(https?)://([A-Za-z0-9.-]+)(?::([0-9]{1,5}))?(/[^\s]*)?$", re.IGNORECASE
)
_DELTA_SECONDS = re.compile(r"^[0-9]{1,7}$")
_MAX_RETRY_AFTER_MS: Final = 3_600_000


@dataclass(frozen=True, slots=True)
class HttpRequestInit:
    """The exact bytes that would be sent, as a value."""

    method: str
    headers: Mapping[str, str]
    body: str | None
    #: Always manual: the adapter re-authorizes every redirect hop itself.
    redirect: str = "manual"
    #: Enforced by the injected transport; this package reads no clock.
    timeout_ms: int = 0
    tls_minimum_version: str = "TLSv1.3"


@dataclass(frozen=True, slots=True)
class HttpResponse:
    """What an injected transport returns.  There is no live counterpart."""

    status: int
    headers: Mapping[str, str] = field(default_factory=dict)
    body: str | None = None

    def header(self, name: str) -> str | None:
        wanted = name.lower()
        for key, value in self.headers.items():
            if key.lower() == wanted:
                return value
        return None


#: The injected transport.  Required; there is no module-level fallback.
HttpTransport = Callable[[str, HttpRequestInit], Awaitable[HttpResponse]]


class HttpTransportError(Exception):
    """A transport failed before a trusted response arrived."""


class HttpTransportTimeout(HttpTransportError):
    """The injected transport enforced the declared timeout."""


@dataclass(frozen=True, slots=True)
class HttpRequestPlan:
    target: EgressTarget
    url: str
    init: HttpRequestInit
    body_bytes: int


@dataclass(frozen=True, slots=True)
class HttpCallSpec:
    method: str = "GET"
    path: str = "/"
    headers: Mapping[str, str] = field(default_factory=dict)
    body: str | None = None


#: The status-to-taxonomy map.  Retryability is never read from a status text or
#: a payload: the status selects a code, and the code carries retryability.
#:
#: An unmapped 4xx is ``GE_ADAPTER_INVALID_REQUEST`` (the provider rejected the
#: request, provably no work).  An unmapped 5xx is
#: ``GE_ADAPTER_TRANSPORT_FAILURE`` because the request was delivered and the
#: effect is in doubt — the conservative direction.
DEFAULT_HTTP_STATUS_CODES: Final[dict[int, AdapterErrorCode]] = {
    400: "GE_ADAPTER_INVALID_REQUEST",
    401: "GE_ADAPTER_AUTHENTICATION",
    402: "GE_ADAPTER_QUOTA_EXCEEDED",
    403: "GE_ADAPTER_AUTHENTICATION",
    408: "GE_ADAPTER_TIMEOUT",
    422: "GE_ADAPTER_INVALID_REQUEST",
    429: "GE_ADAPTER_RATE_LIMITED",
    503: "GE_ADAPTER_RATE_LIMITED",
    504: "GE_ADAPTER_TIMEOUT",
}


def classify_http_status(
    status: int,
    overrides: Mapping[int, AdapterErrorCode] | None = None,
) -> AdapterErrorCode | None:
    if 200 <= status < 300:
        return None
    if overrides is not None and status in overrides:
        return overrides[status]
    mapped = DEFAULT_HTTP_STATUS_CODES.get(status)
    if mapped is not None:
        return mapped
    if status >= 500:
        return "GE_ADAPTER_TRANSPORT_FAILURE"
    return "GE_ADAPTER_INVALID_REQUEST"


def parse_retry_after_ms(value: str | None) -> int | None:
    """``Retry-After`` in delta-seconds only.

    An HTTP-date form is deliberately ignored: converting it needs a wall clock,
    and this contract has none.
    """
    if value is None:
        return None
    trimmed = value.strip()
    if _DELTA_SECONDS.fullmatch(trimmed) is None:
        return None
    milliseconds = int(trimmed) * 1000
    if milliseconds < 0 or milliseconds > _MAX_RETRY_AFTER_MS:
        return None
    return milliseconds


def _authority(target: EgressTarget) -> str:
    if DEFAULT_PORTS.get(target.scheme) == target.port:
        return target.host
    return f"{target.host}:{target.port}"


def _canonical_headers(headers: Mapping[str, str]) -> dict[str, str]:
    return {name.lower(): value for name, value in sorted(headers.items(), key=_lowered)}


def _lowered(entry: tuple[str, str]) -> str:
    return entry[0].lower()


class HttpAdapter:
    """A request/response tool adapter over an injected transport."""

    __slots__ = (
        "_breaker",
        "_credentials",
        "_forbidden_markers",
        "_max_redirects",
        "_policy_metrics",
        "_status_codes",
        "_transport",
        "descriptor",
    )

    def __init__(
        self,
        descriptor: AdapterDescriptor,
        *,
        transport: HttpTransport,
        credentials: Mapping[str, Mapping[str, str]] | None = None,
        status_codes: Mapping[int, AdapterErrorCode] | None = None,
        max_redirects: int = DEFAULT_MAX_REDIRECTS,
        budget_policy_allowed_provider_metrics: Sequence[ProviderMetricDeclaration] = (),
        forbidden_markers: Sequence[str] = (),
    ) -> None:
        if not callable(transport):
            raise ValueError("an HTTP adapter requires an injected transport")
        self.descriptor = descriptor
        self._transport = transport
        self._credentials = dict(credentials or {})
        self._status_codes = dict(status_codes or {})
        self._max_redirects = max_redirects
        self._policy_metrics = tuple(budget_policy_allowed_provider_metrics)
        self._forbidden_markers = tuple(forbidden_markers)
        self._breaker = CircuitBreaker(descriptor.circuit_policy)

    def capabilities(self) -> tuple[str, ...]:
        return self.descriptor.capabilities

    def supports(self, capability: AdapterCapability) -> bool:
        return capability in self.descriptor.capabilities

    @property
    def circuit(self) -> CircuitBreaker:
        return self._breaker

    def preflight(self, request: AdapterRequest) -> AdapterOutcome[PreflightOutcome]:
        return run_preflight(
            self.descriptor, request, self._policy_metrics, 1, self._forbidden_markers
        )

    def build_request_plan(
        self,
        request: AdapterRequest,
        spec: HttpCallSpec | None = None,
    ) -> HttpRequestPlan:
        """Build the exact bytes that would be sent, without sending them.

        This is a pure function of the descriptor, the request and the call
        spec, which is what makes the corpus assertable with no transport at
        all.
        """
        call = spec if spec is not None else HttpCallSpec()
        target = request.target
        if target is None:
            raise ValueError("an HTTP call requires a request target")
        # Credentials are attached per host and never merged across hosts.
        merged = {**call.headers, **self._credentials.get(target.host, {})}
        body = call.body
        return HttpRequestPlan(
            target=target,
            url=f"{target.scheme}://{_authority(target)}{call.path}",
            body_bytes=0 if body is None else len(body),
            init=HttpRequestInit(
                method=call.method,
                headers=_canonical_headers(merged),
                body=body,
                redirect="manual",
                timeout_ms=self.descriptor.bounds.request_timeout_ms,
                tls_minimum_version=(
                    self.descriptor.network.tls_minimum_version
                    if self.descriptor.network is not None
                    else "TLSv1.3"
                ),
            ),
        )

    async def call(
        self,
        request: AdapterRequest,
        options: AdapterCallOptions | None = None,
        spec: HttpCallSpec | None = None,
    ) -> AdapterOutcome[AdapterResponse]:
        settings = options if options is not None else AdapterCallOptions()
        attempt = settings.attempt
        admitted = self.preflight(request)
        if not admitted.ok:
            return refused(admitted.error)

        # adapter-semantics 8.3: cancellation before dispatch normalizes to
        # nothing at all — there is no adapter error to report.
        if is_aborted(settings.signal):
            raise _cancelled_before_dispatch(request.request_id)

        current = request
        current_spec = spec if spec is not None else HttpCallSpec()
        hops = 0
        transport_bytes = 0
        provider_calls = 0

        while True:
            plan = self.build_request_plan(current, current_spec)
            transport_bytes += plan.body_bytes
            provider_calls += 1

            try:
                response = await self._transport(plan.url, plan.init)
            except Exception as error:  # normalized into a code; never quoted
                return refused(self._transport_failure(request, attempt, error, settings))

            body_bytes = 0 if response.body is None else len(response.body)
            transport_bytes += body_bytes

            if 300 <= response.status < 400:
                location = response.header("location")
                hops += 1
                if location is None or hops > self._max_redirects:
                    return refused(
                        self._dispatch_failure(
                            request,
                            attempt,
                            "GE_ADAPTER_TRANSPORT_FAILURE",
                            "the provider redirected without a usable location "
                            "or beyond the hop bound",
                            None,
                            transport_bytes,
                            provider_calls,
                        )
                    )
                redirected = _redirect_target(plan.target, location)
                if redirected is None:
                    return refused(
                        self._dispatch_failure(
                            request,
                            attempt,
                            "GE_ADAPTER_INVALID_REQUEST",
                            "the provider redirect location is not a target "
                            "this adapter can authorize",
                            None,
                            transport_bytes,
                            provider_calls,
                        )
                    )
                target, path = redirected
                current = replace(current, target=target)
                current_spec = replace(current_spec, path=path)
                # Every hop is re-authorized against the same allowlist.
                reauthorized = self.preflight(current)
                if not reauthorized.ok:
                    return refused(reauthorized.error)
                continue

            if body_bytes > self.descriptor.bounds.max_response_bytes:
                # adapter-semantics 6.1: a provider that exceeds the declared
                # response bound has already performed work, so this is a
                # dispatch code, not GE_ADAPTER_BOUNDS_EXCEEDED.
                return refused(
                    self._dispatch_failure(
                        request,
                        attempt,
                        "GE_ADAPTER_MALFORMED_RESPONSE",
                        "the provider response exceeds maxResponseBytes",
                        None,
                        transport_bytes,
                        provider_calls,
                    )
                )

            code = classify_http_status(response.status, self._status_codes)
            if code is not None:
                retry_after_ms = parse_retry_after_ms(response.header("retry-after"))
                return refused(
                    self._dispatch_failure(
                        request,
                        attempt,
                        code,
                        f"the provider returned HTTP {response.status}",
                        retry_after_ms,
                        transport_bytes,
                        provider_calls,
                    )
                )

            provider_request_id = self._provider_request_id(response)
            return ok(
                AdapterResponse(
                    request_id=request.request_id,
                    provider_request_id=provider_request_id,
                    finish_reason="stop",
                    text=response.body or "",
                    structured_output=None,
                    tool_calls=(),
                    usage=self._usage(
                        request, transport_bytes, provider_calls, provider_request_id
                    ),
                    normalized_stream=None,
                )
            )

    async def stream(
        self,
        request: AdapterRequest,
        options: AdapterCallOptions | None = None,
        spec: HttpCallSpec | None = None,
    ) -> tuple[AdapterOutcome[AdapterResponse], tuple[StreamFrame, ...]]:
        """Deliver one completed response as one conforming frame sequence.

        The HTTP adapter is a request/response tool adapter.  It declares
        ``streaming`` for callers that need frame-shaped delivery and does not
        pretend to have an incremental source.
        """
        outcome = await self.call(request, options, spec)
        if not outcome.ok:
            return outcome, ()
        frames = (
            StreamFrame(sequence=0, kind="start", bytes=16),
            StreamFrame(sequence=1, kind="text-delta", bytes=len(outcome.value.text)),
            StreamFrame(sequence=2, kind="finish", bytes=8, finish_reason="stop"),
        )
        return outcome, frames

    def _provider_request_id(self, response: HttpResponse) -> str | None:
        if not self.supports("provider-request-id"):
            return None
        value = response.header("x-request-id")
        if value is None or not value:
            return None
        return value[:256]

    def _usage(
        self,
        request: AdapterRequest,
        transport_bytes: int,
        provider_calls: int,
        provider_request_id: str | None,
    ) -> AdapterUsage:
        return compose_usage(
            self.descriptor,
            request_id=request.request_id,
            provider_request_id=provider_request_id,
            # An adapter without usage-reporting reports unknown trust and no
            # usage-unit meter (`U-018`).  `transport-bytes` is a byte meter, so
            # it remains reportable.
            trust="adapter-conservative" if self.supports("usage-reporting") else "unknown",
            finish_reason=None,
            meters={"provider-calls": provider_calls, "transport-bytes": transport_bytes},
        )

    def _dispatch_failure(
        self,
        request: AdapterRequest,
        attempt: int,
        code: AdapterErrorCode,
        message: str,
        retry_after_ms: int | None,
        transport_bytes: int,
        provider_calls: int,
    ) -> AdapterErrorEnvelope:
        facts = taxonomy_facts(code)
        conservative = facts.effect_disposition != "not-applied"
        hinted = (
            retry_after_ms is not None and facts.retryable and self.supports("retry-after-hint")
        )
        return normalized_adapter_error(
            self.descriptor,
            request_id=request.request_id,
            attempt=attempt,
            code=code,
            side_effect_class=request.side_effect_class,
            message=message,
            retry_after_ms=retry_after_ms if hinted else None,
            usage=(
                self._usage(request, transport_bytes, provider_calls, None)
                if conservative
                else None
            ),
            forbidden_markers=self._forbidden_markers,
        )

    def _transport_failure(
        self,
        request: AdapterRequest,
        attempt: int,
        error: Exception,
        options: AdapterCallOptions,
    ) -> AdapterErrorEnvelope:
        # The transport enforces the timeout; this package reads no clock.
        if isinstance(error, HttpTransportTimeout | TimeoutError):
            code: AdapterErrorCode = "GE_ADAPTER_TIMEOUT"
        elif is_aborted(options.signal):
            code = "GE_ADAPTER_CANCELLED"
        else:
            code = "GE_ADAPTER_TRANSPORT_FAILURE"
        # The cause is deliberately not quoted: a transport error can carry a
        # URL with credentials in it.  Only the exception's type name survives.
        return normalized_adapter_error(
            self.descriptor,
            request_id=request.request_id,
            attempt=attempt,
            code=code,
            side_effect_class=request.side_effect_class,
            message=(
                "the injected transport failed before a trusted response "
                f"arrived ({type(error).__name__})"
            ),
            usage=self._usage(request, request.request_bytes, 1, None),
            forbidden_markers=self._forbidden_markers,
        )


def _cancelled_before_dispatch(request_id: str) -> BaseException:
    return asyncio.CancelledError(f"request {request_id!r} was cancelled before dispatch")


def _redirect_target(
    origin: EgressTarget,
    location: str,
) -> tuple[EgressTarget, str] | None:
    """The next hop a ``Location`` header names.

    Only absolute http(s) targets and root-relative paths are representable;
    anything else is refused rather than guessed, because a guess would be an
    unauthorized egress decision.
    """
    absolute = _ABSOLUTE_LOCATION.match(location)
    if absolute is not None:
        scheme = absolute.group(1).lower()
        host = absolute.group(2).lower()
        port_text = absolute.group(3)
        port = DEFAULT_PORTS.get(scheme, 0) if port_text is None else int(port_text)
        return (
            EgressTarget(
                scheme=scheme, host=host, port=port, redirected=True, reauthorized=True
            ),
            absolute.group(4) or "/",
        )
    if location.startswith("/"):
        return replace(origin, redirected=True, reauthorized=True), location
    return None


def create_http_adapter(
    descriptor: AdapterDescriptor,
    *,
    transport: HttpTransport,
    credentials: Mapping[str, Mapping[str, str]] | None = None,
    status_codes: Mapping[int, AdapterErrorCode] | None = None,
    max_redirects: int = DEFAULT_MAX_REDIRECTS,
    budget_policy_allowed_provider_metrics: Sequence[ProviderMetricDeclaration] = (),
    forbidden_markers: Sequence[str] = (),
) -> HttpAdapter:
    return HttpAdapter(
        descriptor,
        transport=transport,
        credentials=credentials,
        status_codes=status_codes,
        max_redirects=max_redirects,
        budget_policy_allowed_provider_metrics=budget_policy_allowed_provider_metrics,
        forbidden_markers=forbidden_markers,
    )
