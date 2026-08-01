"""The deterministic mock adapter.

adapter-semantics 3: ``mock`` is the deterministic reference.  It is implemented
first, it is the only adapter the candidate gate uses, and every other kind is
defined by the same boundary the mock already satisfies.

It performs no network access, requires no credential, reads no clock and spawns
no process.  Every observable it produces is a function of its descriptor, its
script and the request.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Mapping, Sequence
from dataclasses import dataclass, field

from ..models import JsonValue
from .base import (
    AdapterCallOptions,
    AdapterOutcome,
    AdapterResponse,
    envelope_from_contract_error,
    is_aborted,
    ok,
    refused,
    run_preflight,
)
from .circuit import CircuitBreaker
from .contract import taxonomy_facts
from .envelope import normalized_adapter_error
from .errors import AdapterContractError
from .stream import normalize_stream
from .tools import validate_tool_calls
from .types import (
    AdapterCapability,
    AdapterDescriptor,
    AdapterErrorCode,
    AdapterErrorEnvelope,
    AdapterRequest,
    AdapterUsage,
    DenialReason,
    FinishReason,
    ModelToolCall,
    NormalizedStream,
    PreflightOutcome,
    ProviderMetricDeclaration,
    ProviderQuantity,
    ReportableResource,
    StreamFrame,
    ToolCallResponse,
    UsageTrust,
)
from .usage import compose_usage

DEFAULT_TEXT = "deterministic mock response"
DEFAULT_PROVIDER_REQUEST_ID_PREFIX = "mock-req"


@dataclass(frozen=True, slots=True)
class MockOutcome:
    """One scripted attempt.  The script is consumed in order; the last repeats."""

    #: A scripted dispatch failure.  Requires the ``fault-injection`` capability,
    #: which ``D-014`` restricts to deterministic-mock evidence.
    fail: AdapterErrorCode | None = None
    #: Provider backoff hint.  Requires a retryable code and ``retry-after-hint``.
    retry_after_ms: int | None = None
    #: The closed denial reason ``GE_ADAPTER_POLICY_DENIED`` carries, and which
    #: ``E-005`` forbids on every other code.
    denial_reason: DenialReason | None = None
    #: A scripted frame sequence, including deliberately malformed ones.
    frames: tuple[StreamFrame, ...] | None = None
    text: str | None = None
    structured_output: JsonValue = None
    tool_calls: tuple[ModelToolCall, ...] = ()
    finish_reason: FinishReason | None = None
    trust: UsageTrust | None = None
    meters: Mapping[ReportableResource, int] | None = None
    provider_specific: tuple[ProviderQuantity, ...] = ()


@dataclass(frozen=True, slots=True)
class AdapterStream:
    """The frames of one streamed call and the outcome that call reached."""

    outcome: AdapterOutcome[AdapterResponse]
    frames: tuple[StreamFrame, ...] = field(default=())

    def __aiter__(self) -> AsyncIterator[StreamFrame]:
        return self._emit()

    async def _emit(self) -> AsyncIterator[StreamFrame]:
        for frame in self.frames:
            yield frame


def _padded(value: int) -> str:
    return str(value).rjust(6, "0")


def plan_frames(
    descriptor: AdapterDescriptor,
    text: str,
    tool_calls: Sequence[ModelToolCall],
    finish_reason: str,
) -> tuple[StreamFrame, ...]:
    """The default frame plan: exactly one ``start``, the text deltas, one frame
    per tool call, one ``usage`` frame when the adapter reports usage, and
    exactly one ``finish``.
    """
    frames: list[StreamFrame] = [StreamFrame(sequence=0, kind="start", bytes=16)]
    sequence = 1
    if text:
        frames.append(StreamFrame(sequence=sequence, kind="text-delta", bytes=len(text)))
        sequence += 1
    for call in tool_calls:
        frames.append(
            StreamFrame(sequence=sequence, kind="tool-call", bytes=48, tool_call_id=call.id)
        )
        sequence += 1
    if descriptor.declares("usage-reporting"):
        frames.append(StreamFrame(sequence=sequence, kind="usage", bytes=32))
        sequence += 1
    frames.append(
        StreamFrame(sequence=sequence, kind="finish", bytes=8, finish_reason=finish_reason)
    )
    return tuple(frames)


def plan_meters(
    descriptor: AdapterDescriptor,
    request: AdapterRequest,
    tool_calls: Sequence[ModelToolCall],
    text: str,
) -> dict[ReportableResource, int]:
    """Default meters.

    Every meter is gated on the capability ``U-009``..``U-012`` require, so an
    adapter can never report a meter its descriptor does not authorize.
    """
    meters: dict[ReportableResource, int] = {
        "provider-calls": 1,
        "transport-bytes": request.request_bytes + len(text),
    }
    if descriptor.declares("usage-reporting"):
        meters["input-units"] = max(1, request.request_bytes // 4)
        meters["output-units"] = max(1, len(text))
        if descriptor.declares("cached-input-usage-reporting"):
            meters["cached-input-units"] = 1
        if descriptor.declares("reasoning-usage-reporting"):
            meters["reasoning-units"] = 1
        if descriptor.declares("attachments") and request.attachments:
            meters["image-units"] = len(request.attachments)
    if descriptor.declares("tool-calling") and tool_calls:
        meters["tool-calls"] = len(tool_calls)
    return meters


class MockAdapter:
    """The deterministic reference adapter."""

    __slots__ = (
        "_breaker",
        "_forbidden_markers",
        "_policy_metrics",
        "_prefix",
        "_provider_request_counter",
        "_script",
        "descriptor",
    )

    def __init__(
        self,
        descriptor: AdapterDescriptor,
        *,
        script: Sequence[MockOutcome] = (),
        budget_policy_allowed_provider_metrics: Sequence[ProviderMetricDeclaration] = (),
        forbidden_markers: Sequence[str] = (),
        provider_request_id_prefix: str = DEFAULT_PROVIDER_REQUEST_ID_PREFIX,
    ) -> None:
        self.descriptor = descriptor
        self._script = tuple(script)
        self._policy_metrics = tuple(budget_policy_allowed_provider_metrics)
        self._forbidden_markers = tuple(forbidden_markers)
        self._prefix = provider_request_id_prefix
        self._breaker = CircuitBreaker(descriptor.circuit_policy)
        self._provider_request_counter = 0

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

    def _outcome_for(self, attempt: int) -> MockOutcome:
        if not self._script:
            return MockOutcome()
        return self._script[min(attempt - 1, len(self._script) - 1)]

    def _next_provider_request_id(self) -> str | None:
        self._provider_request_counter += 1
        if not self.supports("provider-request-id"):
            return None
        return f"{self._prefix}-{_padded(self._provider_request_counter)}"

    async def call(
        self,
        request: AdapterRequest,
        options: AdapterCallOptions | None = None,
    ) -> AdapterOutcome[AdapterResponse]:
        settings = options if options is not None else AdapterCallOptions()
        attempt = settings.attempt
        admitted = self.preflight(request)
        if not admitted.ok:
            return refused(admitted.error)

        # adapter-semantics 8.3: a cancellation that arrives before dispatch
        # produces no adapter error at all — nothing was sent, so there is
        # nothing to normalize.
        if is_aborted(settings.signal):
            raise asyncio.CancelledError(
                f"request {request.request_id!r} was cancelled before dispatch"
            )

        plan = self._outcome_for(attempt)
        provider_request_id = self._next_provider_request_id()

        # The dispatch boundary.  The mock crosses it on an event-loop yield
        # rather than on a timer, so the crossing is observable without reading
        # a clock.
        await asyncio.sleep(0)

        try:
            # A cancellation from here on is GE_ADAPTER_CANCELLED with an
            # in-doubt external effect: the deterministic mock is the reference
            # for what a provider that may already have done the work looks like.
            if is_aborted(settings.signal):
                return refused(
                    normalized_adapter_error(
                        self.descriptor,
                        request_id=request.request_id,
                        attempt=attempt,
                        code="GE_ADAPTER_CANCELLED",
                        side_effect_class=request.side_effect_class,
                        message=(
                            "the caller cancelled a mock call that had already been dispatched"
                        ),
                        provider_request_id=provider_request_id,
                        usage=self._conservative_usage(request, provider_request_id),
                        forbidden_markers=self._forbidden_markers,
                    )
                )

            if plan.fail is not None:
                return refused(
                    self._injected_failure(request, attempt, provider_request_id, plan)
                )

            return ok(self._normalize(request, plan, provider_request_id, settings))
        except AdapterContractError as error:
            return refused(
                envelope_from_contract_error(
                    error,
                    descriptor=self.descriptor,
                    request_id=request.request_id,
                    attempt=attempt,
                    side_effect_class=request.side_effect_class,
                    forbidden_markers=self._forbidden_markers,
                )
            )

    async def stream(
        self,
        request: AdapterRequest,
        options: AdapterCallOptions | None = None,
    ) -> AdapterStream:
        settings = options if options is not None else AdapterCallOptions()
        outcome = await self.call(request, settings)
        if not outcome.ok:
            return AdapterStream(outcome=outcome, frames=())
        return AdapterStream(outcome=outcome, frames=self._frames_for(settings))

    def _frames_for(self, options: AdapterCallOptions) -> tuple[StreamFrame, ...]:
        plan = self._outcome_for(options.attempt)
        if plan.frames is not None:
            return plan.frames
        tool_calls = plan.tool_calls
        finish_reason = plan.finish_reason or ("tool-calls" if tool_calls else "stop")
        return plan_frames(self.descriptor, plan.text or DEFAULT_TEXT, tool_calls, finish_reason)

    def _injected_failure(
        self,
        request: AdapterRequest,
        attempt: int,
        provider_request_id: str | None,
        plan: MockOutcome,
    ) -> AdapterErrorEnvelope:
        code = plan.fail
        if code is None:  # pragma: no cover - proved unreachable by the caller
            raise ValueError("an injected failure requires an adapter error code")
        if not self.supports("fault-injection"):
            raise ValueError(
                f"adapter {self.descriptor.adapter_id!r} cannot inject {code!r} "
                "without the fault-injection capability"
            )
        facts = taxonomy_facts(code)
        conservative = facts.effect_disposition != "not-applied"
        hinted = (
            plan.retry_after_ms is not None
            and facts.retryable
            and self.supports("retry-after-hint")
        )
        return normalized_adapter_error(
            self.descriptor,
            request_id=request.request_id,
            attempt=attempt,
            code=code,
            side_effect_class=request.side_effect_class,
            message=f"the deterministic mock produced {code} by configuration",
            denial_reason=plan.denial_reason,
            provider_request_id=(
                provider_request_id if facts.boundary == "dispatch" else None
            ),
            retry_after_ms=plan.retry_after_ms if hinted else None,
            usage=(
                self._conservative_usage(request, provider_request_id) if conservative else None
            ),
            forbidden_markers=self._forbidden_markers,
        )

    def _conservative_usage(
        self,
        request: AdapterRequest,
        provider_request_id: str | None,
    ) -> AdapterUsage:
        """adapter-semantics 7.3 and 8.1.

        Where the adapter cannot assert zero external usage it substitutes a
        sound worst case, which maps onto the ``estimated`` public cost state.
        """
        return compose_usage(
            self.descriptor,
            request_id=request.request_id,
            provider_request_id=provider_request_id,
            trust="adapter-conservative" if self.supports("usage-reporting") else "unknown",
            finish_reason=None,
            meters={"provider-calls": 1, "transport-bytes": request.request_bytes},
        )

    def _normalize(
        self,
        request: AdapterRequest,
        plan: MockOutcome,
        provider_request_id: str | None,
        options: AdapterCallOptions,
    ) -> AdapterResponse:
        text = plan.text if plan.text is not None else DEFAULT_TEXT
        tool_calls = plan.tool_calls
        finish_reason: str = plan.finish_reason or ("tool-calls" if tool_calls else "stop")
        frames = (
            plan.frames
            if plan.frames is not None
            else plan_frames(self.descriptor, text, tool_calls, finish_reason)
        )

        normalized_stream: NormalizedStream | None = None
        if request.streaming or plan.frames is not None:
            normalized_stream = normalize_stream(self.descriptor, frames)

        if tool_calls:
            authorized = (
                tuple(options.authorized_tools)
                if options.authorized_tools is not None
                else tuple(definition.name for definition in request.tool_definitions)
            )
            validate_tool_calls(
                self.descriptor,
                request,
                ToolCallResponse(tool_calls=tool_calls, authorized_tools=authorized),
            )

        trust: UsageTrust = plan.trust or (
            "provider-reported" if self.supports("usage-reporting") else "unknown"
        )
        usage = compose_usage(
            self.descriptor,
            request_id=request.request_id,
            provider_request_id=provider_request_id,
            trust=trust,
            finish_reason=finish_reason,  # type: ignore[arg-type]
            meters=(
                plan.meters
                if plan.meters is not None
                else plan_meters(self.descriptor, request, tool_calls, text)
            ),
            provider_specific=plan.provider_specific,
        )

        return AdapterResponse(
            request_id=request.request_id,
            provider_request_id=provider_request_id,
            finish_reason=finish_reason,
            text=text,
            structured_output=plan.structured_output if request.structured_output else None,
            tool_calls=tuple(tool_calls),
            usage=usage,
            normalized_stream=normalized_stream,
        )


def create_mock_adapter(
    descriptor: AdapterDescriptor,
    *,
    script: Sequence[MockOutcome] = (),
    budget_policy_allowed_provider_metrics: Sequence[ProviderMetricDeclaration] = (),
    forbidden_markers: Sequence[str] = (),
    provider_request_id_prefix: str = DEFAULT_PROVIDER_REQUEST_ID_PREFIX,
) -> MockAdapter:
    return MockAdapter(
        descriptor,
        script=script,
        budget_policy_allowed_provider_metrics=budget_policy_allowed_provider_metrics,
        forbidden_markers=forbidden_markers,
        provider_request_id_prefix=provider_request_id_prefix,
    )
