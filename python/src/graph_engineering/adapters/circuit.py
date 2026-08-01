"""The circuit breaker, rules ``C-001`` through ``C-007``.

adapter-semantics 8.4: a three-state machine driven by an *injected* clock.
``closed`` opens after ``consecutiveFailureThreshold`` consecutive retryable
dispatch failures; ``open`` admits nothing and half-opens only once
``openDurationMs`` has elapsed on that clock; ``half-open`` admits exactly one
probe and closes on success or reopens on failure.  Pre-dispatch refusals and
non-retryable dispatch codes never move the breaker — a malformed request is the
caller's fault, not the provider's health.

There is no wall clock anywhere in this file.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Final

from .contract import taxonomy_facts
from .types import (
    AdapterCircuitPolicy,
    AdapterDescriptor,
    CircuitProjection,
    CircuitState,
    CircuitStep,
)

_CIRCUIT_EVENTS: Final[frozenset[str]] = frozenset({"advance", "failure", "success"})


class CircuitBreaker:
    """The one implementation an adapter and the conformance fold share."""

    __slots__ = (
        "_admitted",
        "_consecutive_failures",
        "_opened_at_ms",
        "_policy",
        "_refused",
        "_state",
    )

    def __init__(self, policy: AdapterCircuitPolicy) -> None:
        self._policy = policy
        self._state: CircuitState = "closed"
        self._consecutive_failures = 0
        self._opened_at_ms: int | None = None
        self._admitted = 0
        self._refused = 0

    @property
    def state(self) -> CircuitState:
        return self._state

    def advance(self, now_ms: int) -> CircuitState:
        """``C-003``.  An open circuit half-opens only after the injected window."""
        if (
            self._state == "open"
            and self._opened_at_ms is not None
            and now_ms - self._opened_at_ms >= self._policy.open_duration_ms
        ):
            self._state = "half-open"
        return self._state

    def admit(self) -> bool:
        """``C-004``.  An open circuit admits no dispatch."""
        if self._state == "open":
            self._refused += 1
            return False
        self._admitted += 1
        return True

    def record_success(self) -> None:
        """``C-002`` and ``C-005``.  A success resets the counter and closes."""
        self._consecutive_failures = 0
        self._state = "closed"
        self._opened_at_ms = None

    def record_failure(self, code: str, now_ms: int) -> None:
        """``C-001``, ``C-006`` and ``C-007``."""
        facts = taxonomy_facts(code)
        if facts.boundary == "pre-dispatch" or not facts.retryable:
            return  # C-007: only retryable dispatch failures move the breaker.
        if self._state == "half-open":
            self._state = "open"  # C-006
            self._opened_at_ms = now_ms
            self._consecutive_failures = self._policy.consecutive_failure_threshold
            return
        self._consecutive_failures += 1
        if self._consecutive_failures >= self._policy.consecutive_failure_threshold:
            self._state = "open"  # C-001
            self._opened_at_ms = now_ms

    def projection(self) -> CircuitProjection:
        return CircuitProjection(
            state=self._state,
            consecutive_failures=self._consecutive_failures,
            opened_at_ms=self._opened_at_ms,
            admitted=self._admitted,
            refused=self._refused,
        )


def circuit_fold(
    descriptor: AdapterDescriptor,
    script: Sequence[CircuitStep],
) -> CircuitProjection:
    """Replay a deterministic script through the same state machine an adapter
    uses.  The corpus asserts the projection; the breaker and the fold cannot
    diverge because there is only one implementation.
    """
    for step in script:
        if step.event not in _CIRCUIT_EVENTS:
            raise ValueError(f"unknown circuit script event {step.event!r}")
        if step.now_ms < 0:
            raise ValueError("circuit script time must be an injected non-negative integer")
        if step.event == "failure":
            if step.code is None:
                raise ValueError("a circuit failure step must name an adapter error code")
            taxonomy_facts(step.code)

    breaker = CircuitBreaker(descriptor.circuit_policy)
    for step in script:
        if step.event == "advance":
            breaker.advance(step.now_ms)
            continue
        if not breaker.admit():
            continue
        if step.event == "success":
            breaker.record_success()
            continue
        if step.code is None:  # pragma: no cover - proved unreachable above
            raise ValueError("a circuit failure step must name an adapter error code")
        breaker.record_failure(step.code, step.now_ms)
    return breaker.projection()
