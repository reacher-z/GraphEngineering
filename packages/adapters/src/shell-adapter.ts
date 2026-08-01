/**
 * The shell / subprocess adapter — declaration and argument construction only.
 *
 * ## Why this adapter does not execute
 *
 * `spec/isolation-semantics.md` §0 states, without qualification, that no
 * isolation provider, capability policy engine, merge gate or approval runtime
 * exists in this repository, and that "a node executor has the ambient
 * authority of the host process that runs it". A working `exec` path here would
 * hand arbitrary command execution to graph-supplied content with nothing
 * between it and the host, and adapter-semantics 10 requires deny by default.
 *
 * So this adapter implements its descriptor obligations (`D-005`, `D-022`,
 * `D-023`), its capability declaration, its share of the closed error taxonomy
 * and its argument-construction logic — and refuses to launch anything. The
 * refusal is `GE_ADAPTER_POLICY_DENIED` with denial reason
 * `capability-approval`, and it carries the isolation contract's own vocabulary
 * as provider-safe detail: `GE_ISO_PROVIDER_UNSUPPORTED` in the `process`
 * capability domain, blocked on `D12-TS-ISOLATION-045`.
 *
 * `GE_ADAPTER_CAPABILITY_UNSUPPORTED` is deliberately *not* used: the closed
 * sixteen-member capability inventory has no member denoting subprocess
 * execution, and the message that code pins would have to name one.
 *
 * This file imports no `node:child_process`, no `node:process` and no
 * `node:fs`. There is nothing here to disable.
 */

import {
  ok,
  refused,
  runPreflight,
  type AdapterBaseOptions,
  type AdapterCallOptions,
  type AdapterOutcome,
  type AdapterResponse,
  type Adapter,
} from "./adapter.js";
import { normalizedAdapterError } from "./envelope.js";
import { sortByCodePoint } from "./ordering.js";
import type {
  AdapterCapability,
  AdapterDescriptor,
  AdapterErrorEnvelope,
  AdapterRequest,
  PreflightOutcome,
  ProcessCall,
  ProviderMetricDeclaration,
} from "./types.js";

/** `capability-manifest.schema.json#/$defs/code`. No provider is implemented. */
export const SHELL_EXECUTION_ISOLATION_CODE = "GE_ISO_PROVIDER_UNSUPPORTED" as const;
/** `capability-manifest.schema.json#/$defs/capabilityDomain`. */
export const SHELL_EXECUTION_CAPABILITY_DOMAIN = "process" as const;
/** The task that must land before this refusal can be lifted. */
export const SHELL_EXECUTION_BLOCKING_TASK = "D12-TS-ISOLATION-045" as const;
/** The closed denial reason this refusal reports. */
export const SHELL_EXECUTION_DENIAL_REASON = "capability-approval" as const;

export interface ProcessLaunchSpec {
  /** Arguments appended after the descriptor's declared vector. */
  readonly arguments?: readonly string[];
  /** Requested environment names; anything outside the allowlist is refused. */
  readonly environment?: readonly string[];
  readonly stdinBytes?: number;
}

/**
 * A fully constructed, fully bounded launch. Producing one performs no I/O and
 * grants no authority; it is the value an isolation provider would consume once
 * one exists.
 */
export interface ProcessLaunchPlan {
  readonly executablePath: string;
  readonly argumentVector: readonly string[];
  readonly workingDirectory: string;
  readonly environmentNames: readonly string[];
  readonly stdinPolicy: "closed" | "explicit-bytes";
  readonly stdinBytes: number;
  readonly shellExpansion: false;
  readonly maxOutputBytes: number;
  readonly maxDurationMs: number;
  readonly maxProcesses: number;
  readonly maxMemoryBytes: number;
  readonly cancelSignal: "SIGKILL" | "SIGTERM";
}

export interface ShellAdapterOptions extends AdapterBaseOptions {}

export class ShellAdapter implements Adapter {
  readonly descriptor: AdapterDescriptor;
  readonly #policyMetrics: readonly ProviderMetricDeclaration[];
  readonly #forbiddenMarkers: readonly string[];

  constructor(options: ShellAdapterOptions) {
    this.descriptor = options.descriptor;
    this.#policyMetrics = options.budgetPolicyAllowedProviderMetrics ?? [];
    this.#forbiddenMarkers = options.forbiddenMarkers ?? [];
  }

  capabilities(): readonly AdapterCapability[] {
    return this.descriptor.capabilities;
  }

  supports(capability: AdapterCapability): boolean {
    return this.descriptor.capabilities.includes(capability);
  }

  preflight(request: AdapterRequest): AdapterOutcome<PreflightOutcome> {
    return runPreflight(this.descriptor, request, this.#policyMetrics, 1, this.#forbiddenMarkers);
  }

  /**
   * The process call a launch spec implies. The declared argument vector is an
   * exact prefix by construction (`P-024`), there is no implicit shell and no
   * argument-string interpolation, and environment names are canonically
   * ordered so two runtimes build the same call.
   */
  buildProcessCall(spec: ProcessLaunchSpec = {}): ProcessCall {
    const profile = this.descriptor.process;
    if (profile === null) {
      throw new Error(
        `shell adapter '${this.descriptor.adapterId}' declares no process profile`,
      );
    }
    return Object.freeze({
      argumentVector: Object.freeze([...profile.argumentVector, ...(spec.arguments ?? [])]),
      environment: Object.freeze(sortByCodePoint(spec.environment ?? [])),
      stdinBytes: spec.stdinBytes ?? 0,
    });
  }

  /**
   * Authorize a launch without performing it. Every process rule
   * (`P-023`..`P-027`) runs here, so a caller can prove a command would be
   * refused — or would be admitted — with no host effect whatsoever.
   */
  planLaunch(
    request: AdapterRequest,
    spec: ProcessLaunchSpec = {},
  ): AdapterOutcome<ProcessLaunchPlan> {
    const profile = this.descriptor.process;
    if (profile === null) {
      throw new Error(
        `shell adapter '${this.descriptor.adapterId}' declares no process profile`,
      );
    }
    // An explicit launch spec wins; otherwise a call the request already
    // carries is authorized as supplied, so a malformed caller-supplied vector
    // reports the process rule it violated rather than the blanket refusal.
    const explicit =
      spec.arguments !== undefined ||
      spec.environment !== undefined ||
      spec.stdinBytes !== undefined;
    const call = explicit
      ? this.buildProcessCall(spec)
      : (request.processCall ?? this.buildProcessCall());
    const authorized = this.preflight({ ...request, processCall: call });
    if (!authorized.ok) return refused(authorized.error);

    return ok(
      Object.freeze({
        executablePath: profile.executablePath,
        argumentVector: call.argumentVector,
        workingDirectory: profile.workingDirectory,
        environmentNames: call.environment,
        stdinPolicy: profile.stdinPolicy,
        stdinBytes: call.stdinBytes,
        shellExpansion: false as const,
        maxOutputBytes: profile.maxOutputBytes,
        maxDurationMs: profile.maxDurationMs,
        maxProcesses: profile.maxProcesses,
        maxMemoryBytes: profile.maxMemoryBytes,
        cancelSignal: profile.cancelSignal,
      }),
    );
  }

  /**
   * The refusal. It is produced only after the launch has been fully
   * authorized, so a caller whose command is malformed still learns the precise
   * process rule it violated instead of this blanket refusal.
   */
  refuseExecution(request: AdapterRequest, attempt = 1): AdapterErrorEnvelope {
    return normalizedAdapterError({
      descriptor: this.descriptor,
      requestId: request.requestId,
      attempt,
      code: "GE_ADAPTER_POLICY_DENIED",
      sideEffectClass: request.sideEffectClass,
      denialReason: SHELL_EXECUTION_DENIAL_REASON,
      message:
        "subprocess execution is refused: no isolation provider exists, so a launch would run with the ambient authority of the host process",
      detail: [
        { name: "blocking-task", value: SHELL_EXECUTION_BLOCKING_TASK },
        { name: "capability-domain", value: SHELL_EXECUTION_CAPABILITY_DOMAIN },
        { name: "isolation-code", value: SHELL_EXECUTION_ISOLATION_CODE },
      ],
      // The rule register of adapter-semantics 12 names no rule for this
      // refusal, and an implementation may never invent a register identifier.
      rule: "none",
      forbiddenMarkers: this.#forbiddenMarkers,
    });
  }

  /**
   * Always refuses. There is no `exec` path in this package: no
   * `node:child_process` import exists, so there is no code path to enable.
   */
  async call(
    request: AdapterRequest,
    options: AdapterCallOptions = {},
  ): Promise<AdapterOutcome<AdapterResponse>> {
    const attempt = options.attempt ?? 1;
    const planned = this.planLaunch(request, {});
    if (!planned.ok) return refused(planned.error);
    return refused(this.refuseExecution(request, attempt));
  }
}

export function createShellAdapter(options: ShellAdapterOptions): ShellAdapter {
  return new ShellAdapter(options);
}
