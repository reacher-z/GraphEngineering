import type {
  EdgeSpec,
  GraphSpec,
  NodeSpec,
} from "@graph-engineering/core";
import type { JsonValue } from "./types.js";

export type CycleMode = "until-dry" | "while" | "evaluator-optimizer";

export interface CycleControllerPolicy {
  readonly apiVersion: "graphengineering.reacher-z.github.io/cycle-policies/v1alpha1";
  readonly kind: "CycleControllerPolicy";
  readonly mode: CycleMode;
  readonly maxIterations: number;
  readonly maxDurationMs: number;
  readonly maxCostUsd: number;
  readonly maxTotalAttempts: number;
  readonly maxDiscoveries: number;
  readonly maxDynamicNodes: number;
  readonly maxCandidatesPerRound: number;
  readonly maxCandidateBytes: number;
  readonly maxCandidateBatchBytes: number;
  readonly consecutiveDryRounds?: number;
}

export interface CycleGraphCoordinate {
  readonly graphRevision: number;
  readonly graphHash: string;
  readonly revisionHash: string;
}

export interface CycleInlinePayload {
  readonly disposition: "inline-unredacted";
  readonly redacted: false;
  readonly encoding: "canonical-json/v1alpha1";
  readonly canonicalJson: string;
  readonly utf8ByteLength: number;
  readonly sha256: string;
}

export type CycleActivitySideEffects = "none" | "idempotent" | "non-idempotent";

export interface CycleActivityBinding {
  readonly activityId: string;
  readonly implementationHash: string;
  readonly sideEffects: CycleActivitySideEffects;
  readonly maxAttemptsPerRound: number;
  readonly maxCostUsdPerAttempt: number;
  readonly timeoutMs: number;
}

export interface CycleGraphLimits {
  readonly maxNodes: number;
  readonly maxEdges: number;
  readonly maxOutputs: number;
  readonly maxDepth: number;
  readonly maxFanOut: number;
}

export interface CycleControllerRequest {
  readonly apiVersion: "graphengineering.reacher-z.github.io/cycle-controllers/v1alpha1";
  readonly kind: "CycleControllerRequest";
  readonly controllerRunId: string;
  readonly controllerId: string;
  readonly hostRun: {
    readonly relationship: "standalone-child-controller";
    readonly runId: string;
  };
  readonly eventStreamId: string;
  readonly checkpointScope: string;
  readonly policy: CycleControllerPolicy;
  readonly objective: CycleInlinePayload;
  readonly keyStrategyId: string;
  readonly rubricIdentity: string;
  readonly authorityCeilingHash: string;
  readonly pricingPolicyHash: string;
  readonly implementationHash: string;
  readonly payloadProfile: {
    readonly contractVersion: "cycle-controller-inline-payloads/v1alpha1";
    readonly disposition: "inline-unredacted";
    readonly redacted: false;
    readonly inlineRiskAuthorizationHash: string;
  };
  readonly initialGraph: CycleGraphCoordinate;
  readonly activities: {
    readonly finder: CycleActivityBinding;
    readonly candidateEvaluator: CycleActivityBinding;
    readonly condition: CycleActivityBinding | null;
    readonly optimizerEvaluator: CycleActivityBinding | null;
    readonly patchPlanner: CycleActivityBinding | null;
  };
  readonly patches: {
    readonly enabled: boolean;
    readonly limits: CycleGraphLimits | null;
  };
  readonly lineage:
    | { readonly origin: "start" }
    | {
      readonly origin: "fork";
      readonly parentControllerRunId: string;
      readonly parentSequence: number;
      readonly parentHistoryHash: string;
    };
}

export interface CycleCandidate {
  readonly key: string;
  readonly value: JsonValue;
}

export type CycleCandidateVerdictValue = "accept" | "reject" | "unknown";

export interface CycleCandidateVerdict {
  readonly key: string;
  readonly verdict: CycleCandidateVerdictValue;
}

export type CycleOptimizerVerdict = "accept" | "revise" | "unknown";

export type CycleModeOutcome =
  | { readonly mode: "until-dry" }
  | { readonly mode: "while"; readonly condition: boolean }
  | { readonly mode: "evaluator-optimizer"; readonly verdict: CycleOptimizerVerdict };

export interface CycleBudgetDelta {
  readonly attempts: number;
  readonly costUsd: number;
  readonly dynamicNodes: number;
}

export interface CycleUsage {
  readonly attempts: number;
  readonly costUsd: number;
}

export type CycleActivityPhase =
  | "finder"
  | "candidate-evaluator"
  | "condition"
  | "optimizer-evaluator"
  | "patch-planner";

export interface CycleActivityReservation {
  readonly phase: CycleActivityPhase;
  readonly activityId: string;
  readonly maxAttempts: number;
  readonly maxCostUsd: number;
}

export interface CycleRoundPlan {
  readonly finder: CycleActivityReservation;
  readonly candidateEvaluator: CycleActivityReservation;
  readonly modeActivity: CycleActivityReservation | null;
  readonly patchPlanner: CycleActivityReservation | null;
  readonly maxDynamicNodes: number;
}

export interface GraphPatch {
  readonly apiVersion: "graphengineering.reacher-z.github.io/patches/v1alpha1";
  readonly kind: "GraphPatch";
  readonly patchId: string;
  readonly base: CycleGraphCoordinate;
  readonly append: {
    readonly nodes: readonly NodeSpec[];
    readonly edges: readonly EdgeSpec[];
    readonly outputs: Readonly<Record<string, { readonly node: string; readonly port?: string }>>;
  };
}

export interface GraphRevisionBody {
  readonly apiVersion: "graphengineering.reacher-z.github.io/graph-revisions/v1alpha1";
  readonly kind: "GraphRevision";
  readonly graphRevision: number;
  readonly previousRevisionHash: string;
  readonly patchHash: string;
  readonly graphHash: string;
}

export interface GraphRevision {
  readonly body: GraphRevisionBody;
  readonly revisionHash: string;
}

export type GraphPatchErrorCode =
  | "GE_PATCH_INVALID"
  | "GE_PATCH_STALE_BASE"
  | "GE_PATCH_IDEMPOTENCY_CONFLICT"
  | "GE_PATCH_DUPLICATE_ID"
  | "GE_PATCH_GRAPH_INVALID"
  | "GE_PATCH_AUTHORITY_EXPANSION"
  | "GE_PATCH_BUDGET_EXCEEDED"
  | "GE_PATCH_STATE_CONFLICT"
  | "GE_PATCH_UNSUPPORTED";

export interface GraphPatchDiagnostic {
  readonly code: GraphPatchErrorCode;
  readonly phase: number;
  readonly path: string;
}

export interface CycleAuthoritySnapshot {
  readonly proposerActivityKey: string;
  readonly principalHash: string;
  readonly proposerGrantHash: string;
  readonly runGrantHash: string;
  readonly tenantGrantHash: string;
  readonly deploymentGrantHash: string;
  readonly effectiveGrantHash: string;
  readonly policyHash: string;
  readonly approvalHash: string | null;
}

export interface GraphPatchBudgetOutcome {
  readonly reservationId: string;
  readonly requested: CycleBudgetDelta;
  readonly committed: CycleBudgetDelta;
  readonly released: CycleBudgetDelta;
}

interface GraphPatchDecisionBase {
  readonly patchId: string;
  readonly patchHash: string;
  readonly patch: CycleInlinePayload;
  readonly requestedBase: CycleGraphCoordinate;
  readonly authoritySnapshot: CycleAuthoritySnapshot;
  readonly policySnapshotHash: string;
  readonly budgetOutcome: GraphPatchBudgetOutcome;
  readonly diagnostics: readonly GraphPatchDiagnostic[];
  readonly decidedAtDurationMs: number;
}

export interface GraphPatchAcceptedDecision extends GraphPatchDecisionBase {
  readonly outcome: "accepted";
  readonly resultingRevision: GraphRevision;
}

export interface GraphPatchRejectedDecision extends GraphPatchDecisionBase {
  readonly outcome: "rejected";
  readonly errorCode: GraphPatchErrorCode;
}

export type GraphPatchDecision = GraphPatchAcceptedDecision | GraphPatchRejectedDecision;

export interface GraphPatchApplication {
  readonly decision: GraphPatchDecision;
  readonly graph: GraphSpec;
  readonly coordinate: CycleGraphCoordinate;
  readonly dryRun: boolean;
  readonly mutated: boolean;
}

export interface GraphPatchApplyContext {
  readonly dryRun?: boolean;
  readonly cancelled?: boolean;
  readonly runState?: "active" | "paused" | "terminal";
  readonly allowPausedMutation?: boolean;
  readonly authoritySnapshot: CycleAuthoritySnapshot;
  readonly policySnapshotHash: string;
  readonly reservationId: string;
  readonly reserved: CycleBudgetDelta;
  readonly activityUsage?: CycleUsage;
  readonly durationMs: number;
  readonly deadlineMsRemaining: number;
  readonly effectiveCapabilities?: readonly string[];
  readonly succeededNodeIds?: readonly string[];
  readonly supportedEdgeModes?: readonly ("value" | "stream" | "artifact-ref")[];
}

export interface GraphPatchApplierOptions {
  readonly limits: CycleGraphLimits;
  readonly maxDynamicNodes: number;
  readonly initialDynamicNodes?: number;
}

export type CycleExitReason =
  | "DRY"
  | "CONDITION_FALSE"
  | "EVALUATOR_ACCEPTED"
  | "UNKNOWN_VERDICT"
  | "MAX_ITERATIONS"
  | "MAX_DURATION"
  | "MAX_COST"
  | "MAX_TOTAL_ATTEMPTS"
  | "MAX_DYNAMIC_NODES"
  | "MAX_DISCOVERIES"
  | "PATCH_REJECTED"
  | "FAILED"
  | "CANCELLED";

export type CycleResultStatus = "converged" | "bounded" | "unknown" | "failed" | "cancelled";

export interface CycleControllerResult {
  readonly apiVersion: "graphengineering.reacher-z.github.io/cycle-results/v1alpha1";
  readonly kind: "CycleControllerResult";
  readonly controllerRunId: string;
  readonly controllerHash: string;
  readonly requestHash: string;
  readonly mode: CycleMode;
  readonly status: CycleResultStatus;
  readonly exitReason: CycleExitReason;
  readonly iterations: number;
  readonly consecutiveDryRounds: number;
  readonly seenCount: number;
  readonly acceptedCount: number;
  readonly rejectedCount: number;
  readonly unknownCount: number;
  readonly unevaluatedCount: number;
  readonly attemptsUsed: number;
  readonly costUsd: number;
  readonly dynamicNodes: number;
  readonly durationMs: number;
  readonly lastGraphRevision: number;
  readonly lastGraphHash: string;
  readonly lastRevisionHash: string;
  readonly terminalSequence: number;
  readonly historyPrefixHash: string;
}

export interface CycleExitObservation {
  readonly cancelled: boolean;
  readonly maxDuration: boolean;
  readonly maxCost: boolean;
  readonly maxTotalAttempts: boolean;
  readonly maxDynamicNodes: boolean;
  readonly maxDiscoveries: boolean;
  readonly maxIterations: boolean;
  readonly patchRejected: boolean;
  readonly failed: boolean;
  readonly failureCode: string | null;
  readonly unknownVerdict: boolean;
  readonly convergenceReason: "DRY" | "CONDITION_FALSE" | "EVALUATOR_ACCEPTED" | null;
}

export interface CycleLease {
  readonly leaseId: string;
  readonly holderId: string;
  readonly leaseEpoch: number;
  readonly fencingToken: number;
  readonly acquiredAt: string;
  readonly expiresAt: string;
}

export type CycleInDoubtResolutionDisposition =
  | "confirmed-applied"
  | "confirmed-not-applied";

export interface CycleInDoubtResolutionAuthority {
  readonly principalHash: string;
  readonly grantHash: string;
  readonly policyHash: string;
  readonly leaseHolderHash: string;
}

export interface CycleInDoubtResolutionCommand {
  readonly apiVersion: "graphengineering.reacher-z.github.io/cycle-in-doubt-resolutions/v1alpha1";
  readonly kind: "CycleInDoubtResolution";
  readonly resolutionId: string;
  readonly controllerRunId: string;
  readonly controllerHash: string;
  readonly requestHash: string;
  readonly eventStreamId: string;
  readonly expectedSequence: number;
  readonly expectedHistoryPrefixHash: string;
  readonly activityKey: string;
  readonly disposition: CycleInDoubtResolutionDisposition;
  readonly evidenceHash: string;
  readonly authoritySnapshot: CycleInDoubtResolutionAuthority;
}

export type CycleControllerEventType =
  | "ControllerCreated"
  | "LeaseAcquired"
  | "LeaseRenewed"
  | "LeaseReleased"
  | "RoundReserved"
  | "ActivityStarted"
  | "ActivityFailed"
  | "InDoubtActivityResolved"
  | "DiscoveryCommitted"
  | "CandidateEvaluationCommitted"
  | "ModeOutcomeCommitted"
  | "BudgetReservationSettled"
  | "BudgetReservationReleased"
  | "PatchAccepted"
  | "PatchRejected"
  | "RoundCommitted"
  | "ControllerTerminated";

export interface CycleControllerEvent {
  readonly apiVersion: "graphengineering.reacher-z.github.io/cycle-controller-events/v1alpha1";
  readonly contractVersion: "cycle-controller-recovery/v1alpha1";
  readonly eventId: string;
  readonly type: CycleControllerEventType;
  readonly timestamp: string;
  readonly controllerRunId: string;
  readonly hostRunId: string;
  readonly controllerHash: string;
  readonly requestHash: string;
  readonly graphRevision: number;
  readonly sequence: number;
  readonly expectedPreviousSequence: number;
  readonly previousEventHash: string | null;
  readonly lease: CycleLease | null;
  readonly payloadDisposition: "inline-unredacted";
  readonly redacted: false;
  readonly payloadHash: string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly recordHash: string;
}

export interface CycleControllerEventStore {
  append(
    streamId: string,
    expectedSequence: number,
    events: readonly CycleControllerEvent[],
  ): Promise<number>;
  read(streamId: string, fromSequence?: number): AsyncIterable<CycleControllerEvent>;
}

export interface CycleControllerCheckpointStore {
  write(
    scope: string,
    checkpointId: string,
    checkpoint: CycleControllerCheckpoint,
  ): Promise<void>;
  read(scope: string, checkpointId: string): Promise<CycleControllerCheckpoint | null>;
}

export interface CycleRoundRecord {
  readonly iteration: number;
  readonly candidateBatchHash: string;
  readonly candidateCount: number;
  readonly freshKeys: readonly string[];
  readonly duplicateKeys: readonly string[];
  readonly acceptedKeys: readonly string[];
  readonly rejectedKeys: readonly string[];
  readonly unknownKeys: readonly string[];
  readonly modeOutcome: CycleModeOutcome;
  readonly patchDecision: Readonly<Record<string, unknown>> | null;
  readonly consecutiveDryRounds: number;
  readonly attemptsUsed: number;
  readonly costUsd: number;
  readonly dynamicNodes: number;
  readonly durationMs: number;
  readonly currentRevision: CycleGraphCoordinate;
}

export interface CycleOpenActivity {
  readonly iteration: number;
  readonly reservationId: string;
  readonly phase: CycleActivityPhase;
  readonly activityId: string;
  readonly activityKey: string;
  readonly attempt: number;
  readonly sideEffects: CycleActivitySideEffects;
  readonly inputHash: string;
}

export interface CycleReservationProjection {
  readonly reservationId: string;
  readonly iteration: number;
  readonly maximum: CycleBudgetDelta;
  readonly committed: CycleBudgetDelta;
  readonly released: CycleBudgetDelta;
  readonly remaining: CycleBudgetDelta;
}

export interface CycleOpenRoundProjection {
  readonly iteration: number;
  readonly phase:
    | "reserved"
    | "running"
    | "discovered"
    | "evaluated"
    | "mode-decided"
    | "patch-decided"
    | "failed"
    | "cancelled";
  readonly plan: CycleRoundPlan;
  readonly planHash: string;
  readonly reservationId: string;
  readonly openActivity: CycleOpenActivity | null;
  readonly discovery: {
    readonly candidateBatchHash: string;
    readonly candidateCount: number;
    readonly freshKeys: readonly string[];
    readonly duplicateKeys: readonly string[];
    readonly seenAdditions: readonly string[];
    readonly candidates: readonly CycleCandidate[];
  } | null;
  readonly evaluation: {
    readonly verdicts: readonly CycleCandidateVerdict[];
    readonly acceptedKeys: readonly string[];
    readonly rejectedKeys: readonly string[];
    readonly unknownKeys: readonly string[];
  } | null;
  readonly modeOutcome: CycleModeOutcome | null;
  readonly patchDecision: GraphPatchDecision | null;
}

export interface CycleControllerFold {
  readonly request: CycleControllerRequest;
  readonly requestHash: string;
  readonly controllerHash: string;
  readonly startedAt: string;
  readonly deadlineAt: string;
  readonly currentRevision: CycleGraphCoordinate;
  readonly activeLease: CycleLease | null;
  readonly maxLeaseEpoch: number;
  readonly maxFencingToken: number;
  readonly lastLeaseId: string | null;
  readonly nextIteration: number;
  readonly seenKeys: readonly string[];
  readonly acceptedKeys: readonly string[];
  readonly rejectedKeys: readonly string[];
  readonly unknownKeys: readonly string[];
  readonly unevaluatedKeys: readonly string[];
  readonly consecutiveDryRounds: number;
  readonly attemptsUsed: number;
  readonly costUsd: number;
  readonly dynamicNodes: number;
  readonly durationMs: number;
  readonly liveReservations: readonly CycleReservationProjection[];
  readonly inDoubtActivities: readonly CycleOpenActivity[];
  readonly decidedPatches: readonly {
    readonly patchId: string;
    readonly patchHash: string;
    readonly outcome: "accepted" | "rejected";
    readonly decisionSequence: number;
  }[];
  readonly committedRounds: readonly CycleRoundRecord[];
  readonly openRound: CycleOpenRoundProjection | null;
  readonly terminalObservation: CycleExitObservation | null;
  readonly terminalResult: CycleControllerResult | null;
  readonly lastSequence: number;
  readonly historyPrefixHash: string;
}

export interface CycleControllerCheckpoint {
  readonly apiVersion: "graphengineering.reacher-z.github.io/cycle-controller-checkpoints/v1alpha1";
  readonly kind: "CycleControllerCheckpoint";
  readonly controllerRunId: string;
  readonly hostRunId: string;
  readonly eventStreamId: string;
  readonly checkpointId: string;
  readonly lastSequence: number;
  readonly historyPrefixHash: string;
  readonly controllerHash: string;
  readonly requestHash: string;
  readonly graphRevision: number;
  readonly createdAt: string;
  readonly lease: CycleLease | null;
  readonly payloadDisposition: "inline-unredacted";
  readonly redacted: false;
  readonly state: Readonly<Record<string, unknown>>;
  readonly contentHash: string;
}

export interface CycleActivityExecution<T> {
  readonly output: T;
  readonly costUsd?: number;
}

export interface CycleActivityContext {
  readonly request: CycleControllerRequest;
  readonly graph: GraphSpec;
  readonly iteration: number;
  readonly phase: CycleActivityPhase;
  readonly activityKey: string;
  readonly idempotencyKey: string;
  readonly attempt: number;
  readonly input: JsonValue;
  readonly seenKeys: readonly string[];
  readonly remainingDiscoveryCredit: number;
  readonly signal: AbortSignal;
}

export type CycleActivityHandler<T> = (
  context: CycleActivityContext,
) => CycleActivityExecution<T> | Promise<CycleActivityExecution<T>>;

export interface CycleControllerActivities {
  readonly finder: CycleActivityHandler<readonly CycleCandidate[]>;
  readonly candidateEvaluator: CycleActivityHandler<readonly CycleCandidateVerdict[]>;
  readonly condition?: CycleActivityHandler<boolean>;
  readonly optimizerEvaluator?: CycleActivityHandler<CycleOptimizerVerdict>;
  readonly patchPlanner?: CycleActivityHandler<GraphPatch>;
  /** A deterministic edge decision. Returning false means the planner is not invoked. */
  readonly shouldPlanPatch?: (context: {
    readonly request: CycleControllerRequest;
    readonly iteration: number;
    readonly candidates: readonly CycleCandidate[];
    readonly verdicts: readonly CycleCandidateVerdict[];
    readonly modeOutcome: CycleModeOutcome;
  }) => boolean;
}

export interface CycleControllerRunOptions {
  readonly eventStore: CycleControllerEventStore;
  readonly checkpointStore?: CycleControllerCheckpointStore;
  readonly checkpointEveryEvents?: number;
  readonly lease: CycleLease;
  readonly activities: CycleControllerActivities;
  readonly signal?: AbortSignal;
  readonly now?: () => Date;
  readonly createEventId?: (context: {
    readonly controllerRunId: string;
    readonly sequence: number;
    readonly type: CycleControllerEventType;
  }) => string;
  readonly patchContext?: Omit<GraphPatchApplyContext, "dryRun" | "reserved" | "reservationId" | "durationMs" | "deadlineMsRemaining">;
}

export interface CycleResumeOptions extends CycleControllerRunOptions {
  readonly expectedSequence: number;
  readonly leaseReason?: "resume" | "takeover";
}

export interface CycleInDoubtResolutionOptions {
  readonly eventStore: CycleControllerEventStore;
  readonly checkpointStore?: CycleControllerCheckpointStore;
  readonly lease: CycleLease;
  readonly now?: () => Date;
  readonly createEventId?: CycleControllerRunOptions["createEventId"];
}

export interface CycleInDoubtResolutionResult {
  readonly commandHash: string;
  readonly event: CycleControllerEvent;
  readonly fold: CycleControllerFold;
  readonly duplicate: boolean;
}

export type CycleControllerErrorCode =
  | "GE_CYCLE_INVALID_POLICY"
  | "GE_CYCLE_INVALID_CANDIDATE"
  | "GE_CYCLE_COUNTER_MISMATCH"
  | "GE_CYCLE_INVALID_HISTORY"
  | "GE_CYCLE_INVALID_REQUEST"
  | "GE_CYCLE_RUN_NOT_FOUND"
  | "GE_CYCLE_RUN_ALREADY_EXISTS"
  | "GE_CYCLE_REQUEST_MISMATCH"
  | "GE_CYCLE_RESUME_CONFLICT"
  | "GE_CYCLE_LEASE_CONFLICT"
  | "GE_CYCLE_STORE_FAILED"
  | "GE_CYCLE_ACTIVITY_FAILED"
  | "IN_DOUBT_SIDE_EFFECT"
  | "GE_CYCLE_RESOLUTION_INVALID"
  | "GE_CYCLE_RESOLUTION_CONFLICT"
  | "GE_CYCLE_RESOLUTION_TARGET_MISMATCH"
  | "GE_CYCLE_RESOLUTION_NOT_TERMINAL"
  | "GE_CYCLE_RESOLUTION_STALE"
  | "GE_CYCLE_RESOLUTION_AUTHORITY_MISMATCH"
  | "GE_CYCLE_STALE_LEASE"
  | GraphPatchErrorCode;

export interface SerializedCycleControllerError {
  readonly name: "CycleControllerError";
  readonly code: CycleControllerErrorCode;
  readonly controllerRunId: string;
  readonly message: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export class CycleControllerError extends Error {
  readonly code: CycleControllerErrorCode;
  readonly controllerRunId: string;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: CycleControllerErrorCode,
    controllerRunId: string,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
    options: ErrorOptions = {},
  ) {
    super(message, options);
    this.name = "CycleControllerError";
    this.code = code;
    this.controllerRunId = controllerRunId;
    this.details = details;
  }

  toJSON(): SerializedCycleControllerError {
    return {
      name: "CycleControllerError",
      code: this.code,
      controllerRunId: this.controllerRunId,
      message: this.message,
      details: this.details,
    };
  }
}

export class CycleActivityFailure extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly inDoubt: boolean;
  readonly costUsd: number;

  constructor(
    code: string,
    message: string,
    options: {
      readonly retryable?: boolean;
      readonly inDoubt?: boolean;
      readonly costUsd?: number;
      readonly cause?: unknown;
    } = {},
  ) {
    super(message, options.cause === undefined ? {} : { cause: options.cause });
    this.name = "CycleActivityFailure";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.inDoubt = options.inDoubt ?? false;
    this.costUsd = options.costUsd ?? 0;
  }
}
