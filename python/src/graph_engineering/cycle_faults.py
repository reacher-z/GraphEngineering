"""Event-vocabulary-derived D7 durable-boundary fault matrix."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, TypeAlias, cast

from .cycle_contract import CYCLE_EVENT_TYPES, CycleEventType

CycleDurableFaultStage: TypeAlias = Literal[
    "before-event-construction",
    "after-event-construction",
    "after-prospective-fold",
    "before-store-commit",
    "after-store-commit",
    "after-store-return",
    "after-state-update",
    "before-checkpoint-construction",
    "after-checkpoint-construction",
    "after-checkpoint-save",
    "terminal-result-delivery",
]
CycleFaultKind: TypeAlias = Literal[
    "process-loss",
    "store-error",
    "timeout",
    "cancellation",
    "commit-then-throw",
]
CycleFaultDurability: TypeAlias = Literal[
    "event-not-committed",
    "event-committed",
    "event-and-checkpoint-committed",
    "terminal-event-committed",
]
CycleActivityPhase: TypeAlias = Literal[
    "finder",
    "candidate-evaluator",
    "condition",
    "optimizer-evaluator",
    "patch-planner",
]
CycleActivitySideEffects: TypeAlias = Literal[
    "none",
    "idempotent",
    "non-idempotent",
]
CycleActivityInterruptionTrigger: TypeAlias = Literal[
    "before-first-round",
    "before-claim",
    "during-handler",
    "after-handler-before-outcome",
    "after-outcome-before-next-dispatch",
    "attempt-timeout",
    "after-round-commit",
    "repeated-cancellation",
]
CycleActivityInterruptionKind: TypeAlias = Literal[
    "caller-cancellation",
    "attempt-timeout",
]
CyclePublicOperation: TypeAlias = Literal["pause", "resume", "replay", "fork"]
CycleOperationInterruptionDurability: TypeAlias = Literal[
    "read-only",
    "operation-not-committed",
    "operation-committed",
]
CycleOperationInterruptionOutcome: TypeAlias = Literal[
    "operation-cancelled",
    "controller-cancelled",
    "committed-result",
]

CYCLE_ACTIVITY_PHASES: tuple[CycleActivityPhase, ...] = (
    "finder",
    "candidate-evaluator",
    "condition",
    "optimizer-evaluator",
    "patch-planner",
)
CYCLE_ACTIVITY_INTERRUPTION_TRIGGERS: tuple[
    CycleActivityInterruptionTrigger, ...
] = (
    "before-first-round",
    "before-claim",
    "during-handler",
    "after-handler-before-outcome",
    "after-outcome-before-next-dispatch",
    "attempt-timeout",
    "after-round-commit",
    "repeated-cancellation",
)
CYCLE_PUBLIC_OPERATIONS: tuple[CyclePublicOperation, ...] = (
    "pause",
    "resume",
    "replay",
    "fork",
)
CYCLE_OPERATION_INTERRUPTION_BOUNDARIES: tuple[str, ...] = (
    "operation:pause:before-read",
    "operation:pause:after-read",
    "operation:pause:after-fold",
    "operation:pause:before-commit",
    "operation:pause:after-lease-released",
    "operation:pause:before-return",
    "operation:resume:before-read",
    "operation:resume:after-read",
    "operation:resume:after-fold",
    "operation:resume:before-commit",
    "operation:resume:after-lease-acquired",
    "operation:resume:before-return",
    "operation:replay:before-read",
    "operation:replay:after-read",
    "operation:replay:after-fold",
    "operation:replay:before-return",
    "operation:fork:before-parent-read",
    "operation:fork:after-parent-read",
    "operation:fork:after-parent-fold",
    "operation:fork:before-child-read",
    "operation:fork:after-child-read",
    "operation:fork:before-child-commit",
    "operation:fork:after-child-created",
    "operation:fork:after-child-lease",
    "operation:fork:before-return",
)
_INTERRUPTION_SIDE_EFFECTS: tuple[CycleActivitySideEffects, ...] = (
    "none",
    "idempotent",
    "non-idempotent",
)
_EXPANDED_INTERRUPTION_TRIGGERS: tuple[CycleActivityInterruptionTrigger, ...] = (
    "during-handler",
    "after-handler-before-outcome",
    "after-outcome-before-next-dispatch",
    "attempt-timeout",
)

CYCLE_DURABLE_FAULT_STAGES: tuple[CycleDurableFaultStage, ...] = (
    "before-event-construction",
    "after-event-construction",
    "after-prospective-fold",
    "before-store-commit",
    "after-store-commit",
    "after-store-return",
    "after-state-update",
    "before-checkpoint-construction",
    "after-checkpoint-construction",
    "after-checkpoint-save",
    "terminal-result-delivery",
)
CYCLE_FAULT_KINDS: tuple[CycleFaultKind, ...] = (
    "process-loss",
    "store-error",
    "timeout",
    "cancellation",
    "commit-then-throw",
)


@dataclass(frozen=True, slots=True)
class CycleDurableFaultMatrixEntry:
    event_type: CycleEventType
    stage: CycleDurableFaultStage
    fault_kind: CycleFaultKind
    boundary: str
    durability: CycleFaultDurability

    def to_dict(self) -> dict[str, str]:
        return {
            "eventType": self.event_type,
            "stage": self.stage,
            "faultKind": self.fault_kind,
            "boundary": self.boundary,
            "durability": self.durability,
        }


@dataclass(frozen=True, slots=True)
class CycleActivityInterruptionMatrixEntry:
    id: str
    interruption: CycleActivityInterruptionKind
    trigger: CycleActivityInterruptionTrigger
    phase: CycleActivityPhase | None
    side_effects: CycleActivitySideEffects | None

    def to_dict(self) -> dict[str, str | None]:
        return {
            "id": self.id,
            "interruption": self.interruption,
            "trigger": self.trigger,
            "phase": self.phase,
            "sideEffects": self.side_effects,
        }


@dataclass(frozen=True, slots=True)
class CycleOperationInterruptionMatrixEntry:
    id: str
    operation: CyclePublicOperation
    boundary: str
    durability: CycleOperationInterruptionDurability
    outcome: CycleOperationInterruptionOutcome

    def to_dict(self) -> dict[str, str]:
        return {
            "id": self.id,
            "operation": self.operation,
            "boundary": self.boundary,
            "durability": self.durability,
            "outcome": self.outcome,
        }


def cycle_durable_fault_boundary(
    event_type: CycleEventType,
    stage: CycleDurableFaultStage,
) -> str:
    """Return the canonical boundary name for one event/stage pair."""

    if event_type not in CYCLE_EVENT_TYPES:
        raise ValueError("unknown cycle-controller event type")
    if stage not in CYCLE_DURABLE_FAULT_STAGES:
        raise ValueError("unknown durable fault stage")
    if stage == "before-event-construction":
        return f"event:{event_type}:before-construction"
    if stage == "after-event-construction":
        return f"event:{event_type}:after-construction"
    if stage == "after-prospective-fold":
        return f"event:{event_type}:after-fold-before-cas"
    if stage == "before-store-commit":
        return f"store:event:{event_type}:before-commit"
    if stage == "after-store-commit":
        return f"store:event:{event_type}:after-commit-before-return"
    if stage == "after-store-return":
        return f"event:{event_type}:after-store-before-state"
    if stage == "after-state-update":
        return f"event:{event_type}:after-state-before-dispatch"
    if stage == "before-checkpoint-construction":
        return f"checkpoint:{event_type}:before-construction"
    if stage == "after-checkpoint-construction":
        return f"checkpoint:{event_type}:after-construction-before-save"
    if stage == "after-checkpoint-save":
        return f"checkpoint:{event_type}:after-save-before-ack"
    if stage == "terminal-result-delivery":
        return "terminal:ControllerTerminated:during-delivery"
    raise ValueError("unknown durable fault stage")  # pragma: no cover - closed tuple above


def _durability(stage: CycleDurableFaultStage) -> CycleFaultDurability:
    if stage in {
        "before-event-construction",
        "after-event-construction",
        "after-prospective-fold",
        "before-store-commit",
    }:
        return "event-not-committed"
    if stage == "after-checkpoint-save":
        return "event-and-checkpoint-committed"
    if stage == "terminal-result-delivery":
        return "terminal-event-committed"
    return "event-committed"


def build_cycle_durable_fault_matrix() -> tuple[CycleDurableFaultMatrixEntry, ...]:
    """Build all 855 applicable event/stage/fault-kind obligations."""

    matrix: list[CycleDurableFaultMatrixEntry] = []
    for event_type in CYCLE_EVENT_TYPES:
        for stage in CYCLE_DURABLE_FAULT_STAGES:
            if stage == "terminal-result-delivery" and event_type != "ControllerTerminated":
                continue
            for fault_kind in CYCLE_FAULT_KINDS:
                matrix.append(
                    CycleDurableFaultMatrixEntry(
                        event_type=event_type,
                        stage=stage,
                        fault_kind=fault_kind,
                        boundary=cycle_durable_fault_boundary(event_type, stage),
                        durability=_durability(stage),
                    )
                )
    return tuple(matrix)


def build_cycle_activity_interruption_matrix() -> tuple[
    CycleActivityInterruptionMatrixEntry, ...
]:
    """Build all 68 deterministic H03 activity interruption obligations."""

    matrix = [
        CycleActivityInterruptionMatrixEntry(
            id="before-first-round",
            interruption="caller-cancellation",
            trigger="before-first-round",
            phase=None,
            side_effects=None,
        )
    ]
    for phase in CYCLE_ACTIVITY_PHASES:
        matrix.append(
            CycleActivityInterruptionMatrixEntry(
                id=f"{phase}:before-claim",
                interruption="caller-cancellation",
                trigger="before-claim",
                phase=phase,
                side_effects=None,
            )
        )
    for trigger in _EXPANDED_INTERRUPTION_TRIGGERS:
        for phase in CYCLE_ACTIVITY_PHASES:
            for side_effects in _INTERRUPTION_SIDE_EFFECTS:
                matrix.append(
                    CycleActivityInterruptionMatrixEntry(
                        id=f"{phase}:{trigger}:{side_effects}",
                        interruption=(
                            "attempt-timeout"
                            if trigger == "attempt-timeout"
                            else "caller-cancellation"
                        ),
                        trigger=trigger,
                        phase=phase,
                        side_effects=side_effects,
                    )
                )
    matrix.extend(
        (
            CycleActivityInterruptionMatrixEntry(
                id="after-round-commit",
                interruption="caller-cancellation",
                trigger="after-round-commit",
                phase=None,
                side_effects=None,
            ),
            CycleActivityInterruptionMatrixEntry(
                id="finder:repeated-cancellation:none",
                interruption="caller-cancellation",
                trigger="repeated-cancellation",
                phase="finder",
                side_effects="none",
            ),
        )
    )
    return tuple(matrix)


def build_cycle_operation_interruption_matrix() -> tuple[
    CycleOperationInterruptionMatrixEntry, ...
]:
    """Build all 25 deterministic H03B public-operation obligations."""

    pre_commit = {
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
    }
    controller_cancelled = {
        "operation:resume:after-lease-acquired",
        "operation:fork:after-child-created",
        "operation:fork:after-child-lease",
    }
    matrix: list[CycleOperationInterruptionMatrixEntry] = []
    for boundary in CYCLE_OPERATION_INTERRUPTION_BOUNDARIES:
        operation = cast(CyclePublicOperation, boundary.split(":", 2)[1])
        read_only = operation == "replay"
        matrix.append(
            CycleOperationInterruptionMatrixEntry(
                id=boundary,
                operation=operation,
                boundary=boundary,
                durability=(
                    "read-only"
                    if read_only
                    else (
                        "operation-not-committed"
                        if boundary in pre_commit
                        else "operation-committed"
                    )
                ),
                outcome=(
                    "operation-cancelled"
                    if read_only or boundary in pre_commit
                    else (
                        "controller-cancelled"
                        if boundary in controller_cancelled
                        else "committed-result"
                    )
                ),
            )
        )
    return tuple(matrix)


__all__ = [
    "CYCLE_ACTIVITY_INTERRUPTION_TRIGGERS",
    "CYCLE_ACTIVITY_PHASES",
    "CYCLE_DURABLE_FAULT_STAGES",
    "CYCLE_FAULT_KINDS",
    "CYCLE_OPERATION_INTERRUPTION_BOUNDARIES",
    "CYCLE_PUBLIC_OPERATIONS",
    "CycleActivityInterruptionMatrixEntry",
    "CycleDurableFaultMatrixEntry",
    "CycleDurableFaultStage",
    "CycleFaultDurability",
    "CycleFaultKind",
    "CycleOperationInterruptionMatrixEntry",
    "build_cycle_activity_interruption_matrix",
    "build_cycle_durable_fault_matrix",
    "build_cycle_operation_interruption_matrix",
    "cycle_durable_fault_boundary",
]
