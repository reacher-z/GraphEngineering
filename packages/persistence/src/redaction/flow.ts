/**
 * The deterministic `source-sink-intersection/v1alpha1` evaluator of
 * spec/redaction-semantics.md Sections 1.2 and 7.
 *
 * It reads exactly one source row, exactly one sink row, and the named effective
 * policy control. Unknown source, sink, or control returns `failed` with
 * `REDACTION_POLICY_INVALID`. The requested representation is intersected with
 * `acceptsProtected`/`acceptsMetadata`; incompatibility is `suppressed` and
 * never falls back or promotes.
 *
 * The domain is the complete 57 x 54 = 3,078-pair Cartesian product even though
 * the implementation is a table join rather than a materialized file.
 */

import type { PolicyControl } from "./codes.js";
import { sinkRow, sourceRow, type SinkPolicyRow, type SourceClassificationRow } from "./inventory.js";

export type FlowOutcome =
  | "suppressed"
  | "metadata-only"
  | "protected-ref"
  | "redacted"
  | "inline-unredacted"
  | "failed";

export interface FlowRequest {
  readonly sourceClass: string;
  readonly sink: string;
  readonly policyControl: string;
  /**
   * True when the source row's control and every control named by the sink row
   * are enabled by the effective policy.
   */
  readonly policyEnabled: boolean;
}

export interface FlowDecision {
  readonly outcome: FlowOutcome;
  readonly writeAuthorized: boolean;
  readonly code?: "REDACTION_POLICY_INVALID";
  readonly sourceRow?: SourceClassificationRow;
  readonly sinkRow?: SinkPolicyRow;
  /**
   * Section 1.2: a caller-controlled identifier is replaced with a runtime
   * opaque identifier and its original is protected before persistence.
   */
  readonly requiresOpaqueIdentifierReplacement: boolean;
}

function authorized(outcome: FlowOutcome): boolean {
  return outcome === "protected-ref" || outcome === "metadata-only" || outcome === "redacted";
}

export function evaluateFlow(request: FlowRequest): FlowDecision {
  const source = sourceRow(request.sourceClass);
  const sink = sinkRow(request.sink);
  if (source === undefined || sink === undefined) {
    return {
      outcome: "failed",
      writeAuthorized: false,
      code: "REDACTION_POLICY_INVALID",
      requiresOpaqueIdentifierReplacement: false,
    };
  }
  if (!sink.policyControls.includes(request.policyControl as PolicyControl)) {
    return {
      outcome: "failed",
      writeAuthorized: false,
      code: "REDACTION_POLICY_INVALID",
      sourceRow: source,
      sinkRow: sink,
      requiresOpaqueIdentifierReplacement: false,
    };
  }

  const replaceIdentifier =
    source.identifierTreatment === "replace-with-runtime-opaque-and-protect-original";

  if (!request.policyEnabled || source.policyControl === "deny") {
    return {
      outcome: "suppressed",
      writeAuthorized: false,
      sourceRow: source,
      sinkRow: sink,
      requiresOpaqueIdentifierReplacement: replaceIdentifier,
    };
  }

  const requested =
    source.defaultAction === "metadata-only-allowlist" ? "metadata-only" : "protected-ref";
  const accepted =
    requested === "metadata-only" ? sink.acceptsMetadata : sink.acceptsProtected;
  const outcome: FlowOutcome = accepted ? requested : "suppressed";

  return {
    outcome,
    writeAuthorized: authorized(outcome),
    sourceRow: source,
    sinkRow: sink,
    requiresOpaqueIdentifierReplacement: replaceIdentifier,
  };
}

// `defaultPolicyEnabled` used to live here. Its default-matrix condition now
// lives inside `policyEnabledFor` in guard.ts, intersected with the Section
// 1.2 explicit-widening formula; a standalone default-matrix predicate had
// exactly one caller and its result there was constant.
