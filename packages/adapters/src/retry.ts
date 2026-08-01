/**
 * Retry decisions, rules `R-001` through `R-006`.
 *
 * adapter-semantics 8.4: backoff is integer arithmetic with no jitter, because
 * runtime-capability-semantics admits retry without jitter only and a jittered
 * schedule is not reproducible across two runtimes.
 *
 *   computed(n)  = min(maxBackoffMs, floor(initialBackoffMs * m^(n-1) / 1000^(n-1)))
 *   effective(n) = retryAfterMs == null ? computed(n) : max(computed(n), retryAfterMs)
 *
 * A provider hint above the local ceiling abandons the attempt rather than
 * truncating it: truncating would re-dispatch inside exactly the window the
 * provider refused.
 */

import { SIDE_EFFECT_ORDER, sideEffectPermitsRetry, taxonomyFacts } from "./contract.js";
import type {
  AdapterDescriptor,
  AdapterErrorCode,
  AdapterRetryPolicy,
  RetryDecision,
  SideEffectClass,
} from "./types.js";

/** Exact integer arithmetic; `BigInt` keeps a long schedule portable. */
export function computedBackoffMs(policy: AdapterRetryPolicy, attempt: number): number {
  let numerator = BigInt(policy.initialBackoffMs);
  let denominator = 1n;
  for (let step = 1; step < attempt; step += 1) {
    numerator *= BigInt(policy.backoffMultiplierMilli);
    denominator *= 1000n;
  }
  const value = numerator / denominator;
  const ceiling = BigInt(policy.maxBackoffMs);
  return Number(value > ceiling ? ceiling : value);
}

export function retryDecision(
  descriptor: AdapterDescriptor,
  code: AdapterErrorCode,
  sideEffectClass: SideEffectClass,
  attempt: number,
  retryAfterMs: number | null,
): RetryDecision {
  const facts = taxonomyFacts(code);
  if (!SIDE_EFFECT_ORDER.includes(sideEffectClass)) {
    throw new Error(`unknown side-effect class '${String(sideEffectClass)}'`);
  }
  if (!Number.isSafeInteger(attempt) || attempt < 1) {
    throw new Error("attempt must be a positive integer");
  }
  if (retryAfterMs !== null && (!Number.isSafeInteger(retryAfterMs) || retryAfterMs < 0)) {
    throw new Error("retryAfterMs must be null or a non-negative integer");
  }
  const policy = descriptor.retryPolicy;

  if (!facts.retryable) {
    return Object.freeze({ mayRetry: false, backoffMs: null, rule: "R-005" as const });
  }
  if (attempt >= policy.maxAttempts) {
    return Object.freeze({ mayRetry: false, backoffMs: null, rule: "R-004" as const });
  }
  if (!sideEffectPermitsRetry(facts.effectDisposition, sideEffectClass)) {
    return Object.freeze({ mayRetry: false, backoffMs: null, rule: "R-006" as const });
  }
  const computed = computedBackoffMs(policy, attempt);
  if (retryAfterMs === null) {
    return Object.freeze({ mayRetry: true, backoffMs: computed, rule: "R-001" as const });
  }
  const effective = Math.max(computed, retryAfterMs);
  if (effective > policy.maxBackoffMs) {
    return Object.freeze({ mayRetry: false, backoffMs: null, rule: "R-003" as const });
  }
  return Object.freeze({ mayRetry: true, backoffMs: effective, rule: "R-002" as const });
}
