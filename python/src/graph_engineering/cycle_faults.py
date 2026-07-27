"""Event-vocabulary-derived D7 durable-boundary fault matrix."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, TypeAlias

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


__all__ = [
    "CYCLE_ACTIVITY_INTERRUPTION_TRIGGERS",
    "CYCLE_ACTIVITY_PHASES",
    "CYCLE_DURABLE_FAULT_STAGES",
    "CYCLE_FAULT_KINDS",
    "CycleActivityInterruptionMatrixEntry",
    "CycleDurableFaultMatrixEntry",
    "CycleDurableFaultStage",
    "CycleFaultDurability",
    "CycleFaultKind",
    "build_cycle_activity_interruption_matrix",
    "build_cycle_durable_fault_matrix",
    "cycle_durable_fault_boundary",
]
