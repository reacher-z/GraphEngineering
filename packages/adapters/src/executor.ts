/**
 * The bridge from an adapter to a graph node executor.
 *
 * The context and return types are structural on purpose: they are assignable
 * to `NodeExecutor` from `@graph-engineering/runtime` without this package
 * depending on the runtime, so an adapter can be handed to `runGraph` through
 * `SchedulerOptions.nodeExecutors` or `SchedulerOptions.executors`.
 */

import type { Adapter, AdapterCallOptions } from "./adapter.js";
import type { AdapterErrorEnvelope, AdapterRequest } from "./types.js";

/** Structurally the subset of `NodeExecutionContext` an adapter reads. */
export interface AdapterExecutorContext {
  readonly input: unknown;
  readonly attempt: number;
  readonly signal: AbortSignal;
}

/**
 * A refused dispatch, thrown so the scheduler records a node failure. The
 * normalized envelope is the payload: the message is never load-bearing.
 */
export class AdapterDispatchError extends Error {
  readonly envelope: AdapterErrorEnvelope;

  constructor(envelope: AdapterErrorEnvelope) {
    super(`${envelope.code}: ${envelope.message}`);
    this.name = "AdapterDispatchError";
    this.envelope = envelope;
  }
}

export interface AdapterExecutorOptions {
  readonly adapter: Adapter;
  /** Build the preflight view of the request from the node input. */
  readonly request: (input: unknown, attempt: number) => AdapterRequest;
  /** Extra call options; `attempt` and `signal` are supplied by the scheduler. */
  readonly callOptions?: Omit<AdapterCallOptions, "attempt" | "signal">;
}

export function createAdapterExecutor(
  options: AdapterExecutorOptions,
): (context: AdapterExecutorContext) => Promise<unknown> {
  return async (context) => {
    const request = options.request(context.input, context.attempt);
    const outcome = await options.adapter.call(request, {
      ...(options.callOptions ?? {}),
      attempt: context.attempt,
      signal: context.signal,
    });
    if (!outcome.ok) throw new AdapterDispatchError(outcome.error);
    return request.structuredOutput ? outcome.value.structuredOutput : outcome.value.text;
  };
}
