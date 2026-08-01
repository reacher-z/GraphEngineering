/**
 * The circuit breaker, rules `C-001` through `C-007`.
 *
 * adapter-semantics 8.4: a three-state machine driven by an *injected* clock.
 * `closed` opens after `consecutiveFailureThreshold` consecutive retryable
 * dispatch failures; `open` admits nothing and half-opens only once
 * `openDurationMs` has elapsed on that clock; `half-open` admits exactly one
 * probe and closes on success or reopens on failure. Pre-dispatch refusals and
 * non-retryable dispatch codes never move the breaker — a malformed request is
 * the caller's fault, not the provider's health.
 *
 * There is no wall clock anywhere in this file.
 */

import { taxonomyFacts } from "./contract.js";
import type {
  AdapterCircuitPolicy,
  AdapterDescriptor,
  AdapterErrorCode,
  CircuitProjection,
  CircuitState,
  CircuitStep,
} from "./types.js";

const CIRCUIT_EVENTS: readonly string[] = Object.freeze(["advance", "failure", "success"]);

export class CircuitBreaker {
  readonly #policy: AdapterCircuitPolicy;
  #state: CircuitState = "closed";
  #consecutiveFailures = 0;
  #openedAtMs: number | null = null;
  #admitted = 0;
  #refused = 0;

  constructor(policy: AdapterCircuitPolicy) {
    this.#policy = policy;
  }

  get state(): CircuitState {
    return this.#state;
  }

  /** `C-003`. An open circuit half-opens only after the injected-clock window. */
  advance(nowMs: number): CircuitState {
    if (
      this.#state === "open" &&
      this.#openedAtMs !== null &&
      nowMs - this.#openedAtMs >= this.#policy.openDurationMs
    ) {
      this.#state = "half-open";
    }
    return this.#state;
  }

  /** `C-004`. An open circuit admits no dispatch. */
  admit(): boolean {
    if (this.#state === "open") {
      this.#refused += 1;
      return false;
    }
    this.#admitted += 1;
    return true;
  }

  /** `C-002` and `C-005`. A success resets the counter and closes the circuit. */
  recordSuccess(): void {
    this.#consecutiveFailures = 0;
    this.#state = "closed";
    this.#openedAtMs = null;
  }

  /** `C-001`, `C-006` and `C-007`. */
  recordFailure(code: AdapterErrorCode, nowMs: number): void {
    const facts = taxonomyFacts(code);
    if (facts.boundary === "pre-dispatch" || !facts.retryable) {
      return; // C-007: only retryable dispatch failures move the breaker.
    }
    if (this.#state === "half-open") {
      this.#state = "open"; // C-006
      this.#openedAtMs = nowMs;
      this.#consecutiveFailures = this.#policy.consecutiveFailureThreshold;
      return;
    }
    this.#consecutiveFailures += 1;
    if (this.#consecutiveFailures >= this.#policy.consecutiveFailureThreshold) {
      this.#state = "open"; // C-001
      this.#openedAtMs = nowMs;
    }
  }

  projection(): CircuitProjection {
    return Object.freeze({
      state: this.#state,
      consecutiveFailures: this.#consecutiveFailures,
      openedAtMs: this.#openedAtMs,
      admitted: this.#admitted,
      refused: this.#refused,
    });
  }
}

/**
 * Replay a deterministic script through the same state machine an adapter
 * uses. The corpus asserts the projection; the breaker and the fold cannot
 * diverge because there is only one implementation.
 */
export function circuitFold(
  descriptor: AdapterDescriptor,
  script: readonly CircuitStep[],
): CircuitProjection {
  for (const step of script) {
    if (!CIRCUIT_EVENTS.includes(step.event)) {
      throw new Error(`unknown circuit script event '${String(step.event)}'`);
    }
    if (!Number.isSafeInteger(step.nowMs) || step.nowMs < 0) {
      throw new Error("circuit script time must be an injected non-negative integer");
    }
    if (step.event === "failure") {
      taxonomyFacts(step.code as AdapterErrorCode);
    }
  }

  const breaker = new CircuitBreaker(descriptor.circuitPolicy);
  for (const step of script) {
    if (step.event === "advance") {
      breaker.advance(step.nowMs);
      continue;
    }
    if (!breaker.admit()) continue;
    if (step.event === "success") {
      breaker.recordSuccess();
      continue;
    }
    breaker.recordFailure(step.code as AdapterErrorCode, step.nowMs);
  }
  return breaker.projection();
}
