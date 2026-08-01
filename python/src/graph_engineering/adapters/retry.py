"""Retry decisions, rules ``R-001`` through ``R-006``.

adapter-semantics 8.4: backoff is integer arithmetic with no jitter, because
runtime-capability-semantics admits retry without jitter only and a jittered
schedule is not reproducible across two runtimes::

    computed(n)  = min(maxBackoffMs, floor(initialBackoffMs * m^(n-1) / 1000^(n-1)))
    effective(n) = retryAfterMs is None ? computed(n) : max(computed(n), retryAfterMs)

A provider hint above the local ceiling abandons the attempt rather than
truncating it: truncating would re-dispatch inside exactly the window the
provider refused.
"""

from __future__ import annotations

from .contract import SIDE_EFFECT_ORDER, side_effect_permits_retry, taxonomy_facts
from .types import AdapterDescriptor, AdapterRetryPolicy, RetryDecision


def computed_backoff_ms(policy: AdapterRetryPolicy, attempt: int) -> int:
    """Exact integer arithmetic.  Python integers keep a long schedule portable."""
    numerator = policy.initial_backoff_ms
    denominator = 1
    for _ in range(1, attempt):
        numerator *= policy.backoff_multiplier_milli
        denominator *= 1000
    value = numerator // denominator
    return min(value, policy.max_backoff_ms)


def retry_decision(
    descriptor: AdapterDescriptor,
    code: str,
    side_effect_class: str,
    attempt: int,
    retry_after_ms: int | None,
) -> RetryDecision:
    facts = taxonomy_facts(code)
    if side_effect_class not in SIDE_EFFECT_ORDER:
        raise ValueError(f"unknown side-effect class {side_effect_class!r}")
    if attempt < 1:
        raise ValueError("attempt must be a positive integer")
    if retry_after_ms is not None and retry_after_ms < 0:
        raise ValueError("retryAfterMs must be None or a non-negative integer")
    policy = descriptor.retry_policy

    if not facts.retryable:
        return RetryDecision(may_retry=False, backoff_ms=None, rule="R-005")
    if attempt >= policy.max_attempts:
        return RetryDecision(may_retry=False, backoff_ms=None, rule="R-004")
    if not side_effect_permits_retry(facts.effect_disposition, side_effect_class):
        return RetryDecision(may_retry=False, backoff_ms=None, rule="R-006")
    computed = computed_backoff_ms(policy, attempt)
    if retry_after_ms is None:
        return RetryDecision(may_retry=True, backoff_ms=computed, rule="R-001")
    effective = max(computed, retry_after_ms)
    if effective > policy.max_backoff_ms:
        return RetryDecision(may_retry=False, backoff_ms=None, rule="R-003")
    return RetryDecision(may_retry=True, backoff_ms=effective, rule="R-002")
