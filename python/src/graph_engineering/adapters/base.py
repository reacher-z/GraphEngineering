"""The portable adapter boundary.

adapter-semantics 2: a conforming adapter has four ordered layers —
declaration, preflight, dispatch, normalization.  Every adapter in this package
shares the declaration, preflight and normalization layers verbatim; only the
dispatch layer differs, and one of the three refuses to have one.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Generic, Protocol, TypeVar, runtime_checkable

from ..models import JsonValue
from .contract import escalates_side_effect
from .envelope import normalized_adapter_error
from .errors import AdapterContractError
from .preflight import preflight
from .types import (
    AdapterCapability,
    AdapterDescriptor,
    AdapterErrorEnvelope,
    AdapterRequest,
    AdapterUsage,
    ModelToolCall,
    NormalizedStream,
    PreflightOutcome,
    ProviderMetricDeclaration,
)

T = TypeVar("T")


class AdapterOutcomeMisuse(RuntimeError):
    """A refused outcome was read as a value, or the reverse."""


@dataclass(frozen=True, slots=True)
class AdapterOutcome(Generic[T]):
    """Either an admitted value or exactly one normalized refusal.

    A refusal is a value, never a raised provider exception: the caller must
    read the code, and a code is not something a ``try`` block can lose.
    """

    ok: bool
    _value: T | None
    _error: AdapterErrorEnvelope | None

    @property
    def value(self) -> T:
        if not self.ok or self._value is None:
            raise AdapterOutcomeMisuse("a refused adapter outcome carries no value")
        return self._value

    @property
    def error(self) -> AdapterErrorEnvelope:
        if self.ok or self._error is None:
            raise AdapterOutcomeMisuse("an admitted adapter outcome carries no error")
        return self._error


def ok(value: T) -> AdapterOutcome[T]:
    return AdapterOutcome(ok=True, _value=value, _error=None)


def refused(error: AdapterErrorEnvelope) -> AdapterOutcome[T]:
    return AdapterOutcome(ok=False, _value=None, _error=error)


@runtime_checkable
class CancelSignal(Protocol):
    """Caller cancellation.  Cancellation is a caller fact, never a provider one.

    Structurally satisfied by ``graph_engineering.scheduler.CancellationSignal``
    without this package importing the scheduler.
    """

    @property
    def cancelled(self) -> bool: ...


def is_aborted(signal: CancelSignal | None) -> bool:
    return signal is not None and signal.cancelled


@dataclass(frozen=True, slots=True)
class AdapterResponse:
    request_id: str
    provider_request_id: str | None
    finish_reason: str
    text: str
    #: Present only when the request asked for structured output.
    structured_output: JsonValue
    tool_calls: tuple[ModelToolCall, ...]
    usage: AdapterUsage
    normalized_stream: NormalizedStream | None


@dataclass(frozen=True, slots=True)
class AdapterCallOptions:
    """Everything a dispatch reads that is not the request itself."""

    #: One-based dispatch attempt index.
    attempt: int = 1
    signal: CancelSignal | None = None
    #: Injected clock reading for the circuit breaker.  There is no wall clock.
    now_ms: int | None = None
    #: Tools policy authorizes for this call (``T-005``).  Authority comes from
    #: policy and never from the model; ``None`` defaults to the declared names.
    authorized_tools: Sequence[str] | None = None


class Adapter(Protocol):
    descriptor: AdapterDescriptor

    def capabilities(self) -> tuple[str, ...]: ...

    def supports(self, capability: AdapterCapability) -> bool: ...

    def preflight(self, request: AdapterRequest) -> AdapterOutcome[PreflightOutcome]: ...

    async def call(
        self,
        request: AdapterRequest,
        options: AdapterCallOptions | None = None,
    ) -> AdapterOutcome[AdapterResponse]: ...


def narrow_side_effect(requested: str, authorized: str) -> str:
    """An error can never escalate the side-effect class the descriptor
    authorizes (``E-013``), so a refused escalation reports the authorized class
    rather than the class the request asked for.
    """
    return authorized if escalates_side_effect(requested, authorized) else requested


def envelope_from_contract_error(
    error: AdapterContractError,
    *,
    descriptor: AdapterDescriptor,
    request_id: str,
    attempt: int,
    side_effect_class: str,
    forbidden_markers: Sequence[str] = (),
) -> AdapterErrorEnvelope:
    """Convert a raised contract rejection into a normalized envelope.

    Anything that is not an ``AdapterContractError`` is a defect in this package
    and is never laundered into a portable adapter code: the caller re-raises it.
    """
    return normalized_adapter_error(
        descriptor,
        request_id=request_id,
        attempt=attempt,
        code=error.code,
        side_effect_class=side_effect_class,
        message=error.message,
        denial_reason=error.denial_reason,
        rule=error.rule,
        forbidden_markers=forbidden_markers,
    )


def run_preflight(
    descriptor: AdapterDescriptor,
    request: AdapterRequest,
    policy_metrics: Sequence[ProviderMetricDeclaration],
    attempt: int,
    forbidden_markers: Sequence[str] = (),
) -> AdapterOutcome[PreflightOutcome]:
    """Run the shared preflight layer and normalize any refusal.

    A refused call has performed zero provider requests, zero usage and zero
    ledger writes.
    """
    try:
        return ok(preflight(descriptor, request, policy_metrics))
    except AdapterContractError as error:
        return refused(
            envelope_from_contract_error(
                error,
                descriptor=descriptor,
                request_id=request.request_id,
                attempt=attempt,
                side_effect_class=narrow_side_effect(
                    request.side_effect_class, descriptor.side_effect_class
                ),
                forbidden_markers=forbidden_markers,
            )
        )


def structured_output_document(response: AdapterResponse) -> Mapping[str, JsonValue] | None:
    """The structured payload, when the caller asked for one and got an object."""
    if isinstance(response.structured_output, Mapping):
        return {str(key): value for key, value in response.structured_output.items()}
    return None
