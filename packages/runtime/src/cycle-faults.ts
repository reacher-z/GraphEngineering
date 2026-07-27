import {
  CYCLE_ACTIVITY_PHASES,
  CYCLE_CONTROLLER_EVENT_TYPES,
  CYCLE_DURABLE_FAULT_STAGES,
  CYCLE_FAULT_KINDS,
  CYCLE_OPERATION_INTERRUPTION_BOUNDARIES,
  type CycleControllerEventType,
  type CycleActivityInterruptionMatrixEntry,
  type CycleActivityInterruptionTrigger,
  type CycleActivitySideEffects,
  type CycleFaultBoundary,
  type CycleDurableFaultBoundary,
  type CycleDurableFaultMatrixEntry,
  type CycleDurableFaultStage,
  type CycleFaultDurability,
  type CycleFaultHook,
  type CycleOperationInterruptionMatrixEntry,
} from "./cycle-types.js";

const INTERRUPTION_SIDE_EFFECTS = Object.freeze([
  "none",
  "idempotent",
  "non-idempotent",
] as const satisfies readonly CycleActivitySideEffects[]);

const EXPANDED_INTERRUPTION_TRIGGERS = Object.freeze([
  "during-handler",
  "after-handler-before-outcome",
  "after-outcome-before-next-dispatch",
  "attempt-timeout",
] as const satisfies readonly CycleActivityInterruptionTrigger[]);

function durability(stage: CycleDurableFaultStage): CycleFaultDurability {
  if (stage === "before-event-construction"
      || stage === "after-event-construction"
      || stage === "after-prospective-fold"
      || stage === "before-store-commit") return "event-not-committed";
  if (stage === "after-checkpoint-save") return "event-and-checkpoint-committed";
  if (stage === "terminal-result-delivery") return "terminal-event-committed";
  return "event-committed";
}

/** Return the canonical fault boundary for one event/stage pair. */
export function cycleDurableFaultBoundary(
  eventType: CycleControllerEventType,
  stage: CycleDurableFaultStage,
): CycleDurableFaultBoundary {
  if (!(CYCLE_CONTROLLER_EVENT_TYPES as readonly unknown[]).includes(eventType)) {
    throw new TypeError("unknown cycle-controller event type");
  }
  if (!(CYCLE_DURABLE_FAULT_STAGES as readonly unknown[]).includes(stage)) {
    throw new TypeError("unknown durable fault stage");
  }
  switch (stage) {
    case "before-event-construction": return `event:${eventType}:before-construction`;
    case "after-event-construction": return `event:${eventType}:after-construction`;
    case "after-prospective-fold": return `event:${eventType}:after-fold-before-cas`;
    case "before-store-commit": return `store:event:${eventType}:before-commit`;
    case "after-store-commit": return `store:event:${eventType}:after-commit-before-return`;
    case "after-store-return": return `event:${eventType}:after-store-before-state`;
    case "after-state-update": return `event:${eventType}:after-state-before-dispatch`;
    case "before-checkpoint-construction": return `checkpoint:${eventType}:before-construction`;
    case "after-checkpoint-construction": return `checkpoint:${eventType}:after-construction-before-save`;
    case "after-checkpoint-save": return `checkpoint:${eventType}:after-save-before-ack`;
    case "terminal-result-delivery": return "terminal:ControllerTerminated:during-delivery";
    default: throw new TypeError("unknown durable fault stage");
  }
}

/**
 * Build the closed executable lattice from the event vocabulary. The terminal
 * delivery point applies only to ControllerTerminated; all other stages apply
 * to every event because interval checkpoints may follow any committed event.
 */
export function buildCycleDurableFaultMatrix(): readonly CycleDurableFaultMatrixEntry[] {
  const matrix: CycleDurableFaultMatrixEntry[] = [];
  for (const eventType of CYCLE_CONTROLLER_EVENT_TYPES) {
    for (const stage of CYCLE_DURABLE_FAULT_STAGES) {
      if (stage === "terminal-result-delivery" && eventType !== "ControllerTerminated") continue;
      for (const faultKind of CYCLE_FAULT_KINDS) {
        matrix.push(Object.freeze({
          eventType,
          stage,
          faultKind,
          boundary: cycleDurableFaultBoundary(eventType, stage),
          durability: durability(stage),
        }));
      }
    }
  }
  return Object.freeze(matrix);
}

/**
 * Build the closed H03 activity interruption matrix. The two global rows have
 * no activity binding; before-claim rows deliberately omit side-effect classes
 * because no external call has started. Every other activity row crosses all
 * five phases with every declared side-effect class.
 */
export function buildCycleActivityInterruptionMatrix(): readonly CycleActivityInterruptionMatrixEntry[] {
  const matrix: CycleActivityInterruptionMatrixEntry[] = [{
    id: "before-first-round",
    interruption: "caller-cancellation",
    trigger: "before-first-round",
    phase: null,
    sideEffects: null,
  }];
  for (const phase of CYCLE_ACTIVITY_PHASES) {
    matrix.push({
      id: `${phase}:before-claim`,
      interruption: "caller-cancellation",
      trigger: "before-claim",
      phase,
      sideEffects: null,
    });
  }
  for (const trigger of EXPANDED_INTERRUPTION_TRIGGERS) {
    for (const phase of CYCLE_ACTIVITY_PHASES) {
      for (const sideEffects of INTERRUPTION_SIDE_EFFECTS) {
        matrix.push({
          id: `${phase}:${trigger}:${sideEffects}`,
          interruption: trigger === "attempt-timeout" ? "attempt-timeout" : "caller-cancellation",
          trigger,
          phase,
          sideEffects,
        });
      }
    }
  }
  matrix.push({
    id: "after-round-commit",
    interruption: "caller-cancellation",
    trigger: "after-round-commit",
    phase: null,
    sideEffects: null,
  });
  matrix.push({
    id: "finder:repeated-cancellation:none",
    interruption: "caller-cancellation",
    trigger: "repeated-cancellation",
    phase: "finder",
    sideEffects: "none",
  });
  return Object.freeze(matrix.map((entry) => Object.freeze(entry)));
}

/**
 * Build the closed 25-row H03B public-operation cancellation lattice. The
 * ordering is part of the conformance contract and matches
 * CYCLE_OPERATION_INTERRUPTION_BOUNDARIES exactly.
 */
export function buildCycleOperationInterruptionMatrix(): readonly CycleOperationInterruptionMatrixEntry[] {
  const preCommit: ReadonlySet<string> = new Set([
    "operation:pause:before-read",
    "operation:pause:after-read",
    "operation:pause:after-fold",
    "operation:pause:before-commit",
    "operation:resume:before-read",
    "operation:resume:after-read",
    "operation:resume:after-fold",
    "operation:resume:before-commit",
    "operation:fork:before-parent-read",
    "operation:fork:after-parent-read",
    "operation:fork:after-parent-fold",
    "operation:fork:before-child-read",
    "operation:fork:after-child-read",
    "operation:fork:before-child-commit",
  ] as const);
  const controllerCancelled: ReadonlySet<string> = new Set([
    "operation:resume:after-lease-acquired",
    "operation:fork:after-child-created",
    "operation:fork:after-child-lease",
  ] as const);
  return Object.freeze(CYCLE_OPERATION_INTERRUPTION_BOUNDARIES.map((boundary) => {
    const operation = boundary.split(":")[1] as CycleOperationInterruptionMatrixEntry["operation"];
    const readOnly = operation === "replay";
    return Object.freeze({
      id: boundary,
      operation,
      boundary,
      durability: readOnly
        ? "read-only" as const
        : preCommit.has(boundary)
          ? "operation-not-committed" as const
          : "operation-committed" as const,
      outcome: readOnly || preCommit.has(boundary)
        ? "operation-cancelled" as const
        : controllerCancelled.has(boundary)
          ? "controller-cancelled" as const
          : "committed-result" as const,
    });
  }));
}

/** Invoke a deterministic boundary without translating the injected failure. */
export async function runCycleFaultHook(
  hook: CycleFaultHook | undefined,
  boundary: CycleFaultBoundary,
): Promise<void> {
  if (hook !== undefined) await hook(boundary);
}
