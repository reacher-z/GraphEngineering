"""Native asyncio D7 bounded-cycle controller.

The controller writes every claim before caller code, validates a complete
candidate event by folding the prospective prefix before CAS append, charges
attempt/cost from the authenticated request binding (never handler claims),
and keeps late/non-cooperative outcomes outside downstream state.
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import inspect
import json
import math
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from typing import Any, Literal, TypeAlias, cast

from .canonical import canonical_json
from .cycle_contract import (
    CycleActivityBinding,
    CycleErrorCode,
    CycleEvent,
    CycleEventType,
    CycleRuntimeError,
    ValidatedCycleRequest,
    activity_key,
    capture_portable_json,
    make_cycle_event,
    parse_timestamp,
    round_plan_hash,
    strict_rfc3339,
    validate_cycle_request,
    validate_lease,
)
from .cycle_fold import (
    CycleFold,
    HardStopFacts,
    build_checkpoint,
    classify_candidates,
    fold_cycle_events,
    select_exit_reason,
    validate_checkpoint,
)
from .cycle_store import CycleStore, FaultHook, run_fault_hook
from .graph_patch import (
    GraphPatchRuntime,
    PatchAuthority,
    PatchDecision,
    PatchReservation,
)
from .models import JsonObject, JsonValue

Clock: TypeAlias = Callable[[], str]
EventIdFactory: TypeAlias = Callable[[str, int], str]
ActivityHandler: TypeAlias = Callable[["CycleActivityContext"], object | Awaitable[object]]


class ActivityPhase(StrEnum):
    FINDER = "finder"
    CANDIDATE_EVALUATOR = "candidate-evaluator"
    CONDITION = "condition"
    OPTIMIZER_EVALUATOR = "optimizer-evaluator"
    PATCH_PLANNER = "patch-planner"


class CycleCancellation:
    """Cooperative cancellation signal observed at every durable boundary."""

    def __init__(self) -> None:
        self._event = asyncio.Event()

    def cancel(self) -> None:
        self._event.set()

    @property
    def cancelled(self) -> bool:
        return self._event.is_set()

    async def wait(self) -> None:
        await self._event.wait()


@dataclass(frozen=True, slots=True)
class CycleActivityContext:
    controller_run_id: str
    iteration: int
    phase: ActivityPhase
    attempt: int
    activity_key: str
    idempotency_key: str
    deadline_at: str
    input: JsonValue
    cancellation: CycleCancellation


@dataclass(frozen=True, slots=True)
class CycleHandlers:
    finder: ActivityHandler
    candidate_evaluator: ActivityHandler
    condition: ActivityHandler | None = None
    optimizer_evaluator: ActivityHandler | None = None
    patch_planner: ActivityHandler | None = None

    def for_phase(self, phase: ActivityPhase) -> ActivityHandler | None:
        return {
            ActivityPhase.FINDER: self.finder,
            ActivityPhase.CANDIDATE_EVALUATOR: self.candidate_evaluator,
            ActivityPhase.CONDITION: self.condition,
            ActivityPhase.OPTIMIZER_EVALUATOR: self.optimizer_evaluator,
            ActivityPhase.PATCH_PLANNER: self.patch_planner,
        }[phase]


@dataclass(frozen=True, slots=True)
class CycleRunResult:
    result: JsonObject
    events: tuple[CycleEvent, ...]
    checkpoint_warning: CycleRuntimeError | None = None


@dataclass(frozen=True, slots=True)
class CycleReplayResult:
    """Read-only fold of either a terminal stream or an exact valid prefix."""

    result: JsonObject | None
    state: JsonObject
    events: tuple[CycleEvent, ...]
    terminal: bool


@dataclass(frozen=True, slots=True)
class CyclePauseResult:
    events: tuple[CycleEvent, ...]
    released_lease_id: str


@dataclass(frozen=True, slots=True)
class _Invocation:
    value: object | None = None
    error: BaseException | None = None
    cancelled: bool = False
    timed_out: bool = False


def _default_clock() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _default_event_id(run_id: str, sequence: int) -> str:
    return f"{run_id}-{sequence}"


def _add_milliseconds(timestamp: str, milliseconds: int) -> str:
    value = parse_timestamp(timestamp) + timedelta(milliseconds=milliseconds)
    return value.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _elapsed_milliseconds(started_at: str, current: str) -> int:
    delta = parse_timestamp(current) - parse_timestamp(started_at)
    milliseconds = int(delta.total_seconds() * 1000)
    if milliseconds < 0:
        raise CycleRuntimeError(
            CycleErrorCode.CLOCK_ROLLBACK,
            "trusted controller clock moved before startedAt",
        )
    if milliseconds > 2_147_483_647:
        raise CycleRuntimeError(
            CycleErrorCode.INVALID_HISTORY,
            "controller duration exceeds the protocol timer range",
        )
    return milliseconds


class _CycleJournal:
    def __init__(
        self,
        request: ValidatedCycleRequest,
        store: CycleStore,
        *,
        events: tuple[CycleEvent, ...] = (),
        clock: Clock,
        event_id_factory: EventIdFactory,
        fault_hook: FaultHook | None,
        parent_fold: CycleFold | None = None,
    ) -> None:
        self.request = request
        self.store = store
        self.events = events
        self.clock = clock
        self.event_id_factory = event_id_factory
        self.fault_hook = fault_hook
        self.parent_fold = parent_fold
        self.fold: CycleFold | None = (
            fold_cycle_events(events, parent_fold=parent_fold) if events else None
        )
        self._last_observed_time = parse_timestamp(events[-1].timestamp) if events else None

    def timestamp(self) -> str:
        try:
            value = strict_rfc3339(self.clock())
        except CycleRuntimeError:
            raise
        except Exception as exc:
            raise CycleRuntimeError(
                CycleErrorCode.CLOCK_ROLLBACK,
                "trusted clock failed",
                details={"causeName": type(exc).__name__},
                cause=exc,
            ) from exc
        parsed = parse_timestamp(value)
        if self._last_observed_time is not None and parsed < self._last_observed_time:
            raise CycleRuntimeError(
                CycleErrorCode.CLOCK_ROLLBACK,
                "trusted clock moved backwards",
            )
        self._last_observed_time = parsed
        return value

    async def append(
        self,
        event_type: CycleEventType,
        data: object | Callable[[str], object],
        *,
        lease: JsonObject | None = None,
        graph_revision: int | None = None,
    ) -> CycleEvent:
        timestamp = self.timestamp()
        payload = data(timestamp) if callable(data) else data
        sequence = len(self.events)
        previous_hash = self.events[-1].record_hash if self.events else None
        active_lease = lease
        if active_lease is None and self.fold is not None:
            active_lease = self.fold.active_lease
        if graph_revision is None:
            graph_revision = (
                self.request.model.initial_graph.graph_revision
                if self.fold is None
                else cast(int, self.fold.current_revision["graphRevision"])
            )
        try:
            event_id = self.event_id_factory(self.request.model.controller_run_id, sequence)
        except Exception as exc:
            raise CycleRuntimeError(
                CycleErrorCode.STORE_FAILED,
                "event identity factory failed before append",
                details={"causeName": type(exc).__name__},
                cause=exc,
            ) from exc
        event = make_cycle_event(
            event_id=event_id,
            event_type=event_type,
            timestamp=timestamp,
            request=self.request,
            graph_revision=graph_revision,
            sequence=sequence,
            previous_event_hash=previous_hash,
            lease=active_lease,
            data=payload,
        )
        candidate = (*self.events, event)
        # Prospective full-prefix fold is mandatory before the store sees bytes.
        candidate_fold = fold_cycle_events(candidate, parent_fold=self.parent_fold)
        await run_fault_hook(self.fault_hook, f"event:{event_type}:before-cas")
        try:
            tail = await self.store.append(
                self.request.model.event_stream_id,
                sequence - 1,
                (event,),
            )
        except CycleRuntimeError:
            raise
        except Exception as exc:
            raise CycleRuntimeError(
                CycleErrorCode.STORE_FAILED,
                "cycle event append failed",
                details={"causeName": type(exc).__name__},
                cause=exc,
            ) from exc
        if tail != sequence:
            raise CycleRuntimeError(
                CycleErrorCode.STORE_FAILED,
                "cycle store returned an inconsistent committed tail",
            )
        self.events = candidate
        self.fold = candidate_fold
        await run_fault_hook(self.fault_hook, f"event:{event_type}:after-cas")
        return event

    async def checkpoint(self, checkpoint_id: str) -> CycleRuntimeError | None:
        if self.fold is None:
            raise CycleRuntimeError(
                CycleErrorCode.INVALID_HISTORY,
                "cannot checkpoint empty stream",
            )
        try:
            checkpoint = build_checkpoint(
                self.fold,
                checkpoint_id=checkpoint_id,
                created_at=self.timestamp(),
            )
            await self.store.save_checkpoint(
                self.request.model.checkpoint_scope,
                checkpoint_id,
                self.fold.tail_sequence,
                checkpoint,
            )
        except CycleRuntimeError as exc:
            # The event stream remains authoritative.  Callers receive a
            # structured warning and resume must perform a full fold.
            return exc
        except Exception as exc:
            return CycleRuntimeError(
                CycleErrorCode.STORE_FAILED,
                "cycle checkpoint write failed; event history remains authoritative",
                details={"causeName": type(exc).__name__},
                cause=exc,
            )
        return None


class _CycleController:
    def __init__(
        self,
        request: ValidatedCycleRequest,
        handlers: CycleHandlers,
        journal: _CycleJournal,
        cancellation: CycleCancellation,
        *,
        patch_runtime: GraphPatchRuntime | None,
        patch_authority: PatchAuthority | None,
        patch_each_round: bool,
    ) -> None:
        self.request = request
        self.handlers = handlers
        self.journal = journal
        self.cancellation = cancellation
        self.patch_runtime = patch_runtime
        self.patch_authority = patch_authority
        self.patch_each_round = patch_each_round
        self.checkpoint_warning: CycleRuntimeError | None = None

    @property
    def fold(self) -> CycleFold:
        if self.journal.fold is None:  # pragma: no cover - start invariant
            raise CycleRuntimeError(CycleErrorCode.INVALID_HISTORY, "controller stream is empty")
        return self.journal.fold

    async def run(self) -> CycleRunResult:
        while True:
            if self.fold.terminal:
                assert self.fold.terminal_result is not None
                return CycleRunResult(
                    self.fold.terminal_result,
                    self.journal.events,
                    self.checkpoint_warning,
                )
            inherited_in_doubt = cast(
                list[dict[str, Any]],
                self.fold.state["inDoubtActivities"],
            )
            if any(
                activity["sideEffects"] == "non-idempotent"
                for activity in inherited_in_doubt
            ):
                raise CycleRuntimeError(
                    CycleErrorCode.IN_DOUBT_SIDE_EFFECT,
                    "controller inherited an in-doubt non-idempotent activity",
                )
            open_round = self.fold.state["openRound"]
            if open_round is not None:
                await self._drive_open_round(cast(dict[str, Any], open_round))
                continue

            reason = self._post_round_reason()
            if reason is not None:
                return await self._terminate(reason)
            preflight = self._round_plan()
            if isinstance(preflight, str):
                return await self._terminate(cast(Any, preflight))
            plan, maximum = preflight
            await self.journal.append(
                "RoundReserved",
                {
                    "iteration": cast(int, self.fold.state["nextIteration"]),
                    "plan": plan,
                    "planHash": round_plan_hash(plan),
                    "reservationId": f"round-{self.fold.state['nextIteration']}",
                    "maximum": maximum,
                    "deadlineAt": self.fold.state["deadlineAt"],
                    "currentRevision": self.fold.current_revision,
                },
            )

    def _post_round_reason(self) -> str | None:
        state = self.fold.state
        convergence, unknown_verdict = self._convergence_facts()
        facts = HardStopFacts(
            cancelled=self.cancellation.cancelled,
            duration_ms=self._observed_duration(),
            cost_usd=cast(int | float, state["costUsd"]),
            attempts_used=cast(int, state["attemptsUsed"]),
            dynamic_nodes=cast(int, state["dynamicNodes"]),
            seen_count=len(cast(list[Any], state["seenKeys"])),
            iterations=cast(int, state["nextIteration"]) - 1,
            unknown_verdict=unknown_verdict,
            convergence_reason=convergence,
        )
        return select_exit_reason(facts, self.request.model.policy)

    def _before_dispatch_reason(self) -> str | None:
        """Observe every hard boundary immediately before external caller code."""

        state = self.fold.state
        facts = HardStopFacts(
            cancelled=self.cancellation.cancelled,
            duration_ms=self._observed_duration(),
            cost_usd=cast(int | float, state["costUsd"]),
            attempts_used=cast(int, state["attemptsUsed"]),
            dynamic_nodes=cast(int, state["dynamicNodes"]),
            seen_count=len(cast(list[Any], state["seenKeys"])),
            # The already-reserved iteration is authorized to run.  Its bound
            # becomes terminal only after the round closes.
            iterations=0,
        )
        return select_exit_reason(facts, self.request.model.policy)

    async def _dispatch(self, phase: ActivityPhase) -> bool:
        reason = self._before_dispatch_reason()
        if reason is not None:
            await self._terminate(reason)
            return False
        await self._invoke_phase(phase)
        return True

    def _convergence_facts(
        self,
    ) -> tuple[
        Literal["DRY", "CONDITION_FALSE", "EVALUATOR_ACCEPTED"] | None,
        bool,
    ]:
        state = self.fold.state
        rounds = cast(list[Any], state["committedRounds"])
        convergence: Literal["DRY", "CONDITION_FALSE", "EVALUATOR_ACCEPTED"] | None = None
        unknown_verdict = False
        if rounds:
            last = cast(dict[str, Any], rounds[-1])
            outcome = cast(dict[str, Any], last["modeOutcome"])
            if (
                self.request.model.policy.mode == "until-dry"
                and cast(int, state["consecutiveDryRounds"])
                >= cast(int, self.request.model.policy.consecutive_dry_rounds)
            ):
                convergence = "DRY"
            elif self.request.model.policy.mode == "while" and outcome["condition"] is False:
                convergence = "CONDITION_FALSE"
            elif self.request.model.policy.mode == "evaluator-optimizer":
                if outcome["verdict"] == "accept":
                    convergence = "EVALUATOR_ACCEPTED"
                elif outcome["verdict"] == "unknown":
                    unknown_verdict = True
        return convergence, unknown_verdict

    def _round_plan(self) -> tuple[JsonObject, JsonObject] | str:
        state = self.fold.state
        policy = self.request.model.policy
        selected: list[tuple[ActivityPhase, CycleActivityBinding]] = [
            (ActivityPhase.FINDER, self.request.model.activities.finder),
            (
                ActivityPhase.CANDIDATE_EVALUATOR,
                self.request.model.activities.candidate_evaluator,
            ),
        ]
        if policy.mode == "while":
            assert self.request.model.activities.condition is not None
            selected.append(
                (ActivityPhase.CONDITION, self.request.model.activities.condition)
            )
        elif policy.mode == "evaluator-optimizer":
            assert self.request.model.activities.optimizer_evaluator is not None
            selected.append(
                (
                    ActivityPhase.OPTIMIZER_EVALUATOR,
                    self.request.model.activities.optimizer_evaluator,
                )
            )

        # The native v1alpha1 producer records the complete request-bound
        # worst case.  It never turns a tight controller budget into a smaller
        # per-round retry contract: doing so would make the same request emit a
        # different graph in another SDK.  Patch capacity is likewise
        # reserved whenever patches are enabled, even when the deterministic
        # runtime route will skip the planner and release that reservation.
        if self.request.model.patches.enabled:
            patch_binding = self.request.model.activities.patch_planner
            if patch_binding is None:  # pragma: no cover - request validator invariant
                raise CycleRuntimeError(
                    CycleErrorCode.INVALID_REQUEST,
                    "patch-enabled request requires a bound patch planner",
                )
            selected.append((ActivityPhase.PATCH_PLANNER, patch_binding))

        entries: dict[ActivityPhase, JsonObject] = {}
        planned_attempts = 0
        planned_cost: int | float = 0
        for phase, binding in selected:
            attempts = binding.max_attempts_per_round
            phase_cost: int | float = 0
            for _ in range(attempts):
                phase_cost += binding.max_cost_usd_per_attempt
                if not math.isfinite(phase_cost):
                    return "MAX_COST"
            entries[phase] = {
                "phase": phase.value,
                "activityId": binding.activity_id,
                "maxAttempts": attempts,
                "maxCostUsd": phase_cost,
            }
            planned_attempts += attempts
            planned_cost += phase_cost
            if not math.isfinite(planned_cost):
                return "MAX_COST"

        attempts_used = cast(int, state["attemptsUsed"])
        cost_used = cast(int | float, state["costUsd"])
        if attempts_used + planned_attempts > policy.max_total_attempts:
            return "MAX_TOTAL_ATTEMPTS"
        if cost_used + planned_cost > policy.max_cost_usd:
            return "MAX_COST"

        mode_phase = (
            ActivityPhase.CONDITION
            if policy.mode == "while"
            else ActivityPhase.OPTIMIZER_EVALUATOR
            if policy.mode == "evaluator-optimizer"
            else None
        )
        remaining_dynamic = (
            policy.max_dynamic_nodes - cast(int, state["dynamicNodes"])
            if self.request.model.patches.enabled
            else 0
        )
        plan: JsonObject = {
            "finder": entries[ActivityPhase.FINDER],
            "candidateEvaluator": entries[ActivityPhase.CANDIDATE_EVALUATOR],
            "modeActivity": None if mode_phase is None else entries[mode_phase],
            "patchPlanner": (
                entries[ActivityPhase.PATCH_PLANNER]
                if self.request.model.patches.enabled
                else None
            ),
            "maxDynamicNodes": remaining_dynamic,
        }
        maximum: JsonObject = {
            "attempts": planned_attempts,
            "costUsd": planned_cost,
            "dynamicNodes": remaining_dynamic,
        }
        return plan, maximum

    async def _drive_open_round(self, open_round: dict[str, Any]) -> None:
        phase = cast(str, open_round["phase"])
        pending = self._pending_settlement_event(cast(int, open_round["iteration"]))
        if phase == "reserved":
            await self._dispatch(ActivityPhase.FINDER)
            return
        if phase == "running":
            await self._recover_open_activity(open_round)
            return
        if phase == "failed":
            if pending is not None and pending.type == "ActivityFailed":
                await self._settle_pending(pending)
                return
            await self._after_failed_activity()
            return
        if phase == "discovered":
            if pending is not None and pending.type == "DiscoveryCommitted":
                await self._settle_pending(pending)
            else:
                await self._dispatch(ActivityPhase.CANDIDATE_EVALUATOR)
            return
        if phase == "evaluated":
            if pending is not None and pending.type == "CandidateEvaluationCommitted":
                await self._settle_pending(pending)
            elif self.request.model.policy.mode == "until-dry":
                await self.journal.append(
                    "ModeOutcomeCommitted",
                    lambda timestamp: {
                        "iteration": open_round["iteration"],
                        "activityKey": None,
                        "outcome": {"mode": "until-dry"},
                        "usage": {"attempts": 0, "costUsd": 0},
                        "durationMs": self._elapsed(timestamp),
                    },
                )
            elif self.request.model.policy.mode == "while":
                await self._dispatch(ActivityPhase.CONDITION)
            else:
                await self._dispatch(ActivityPhase.OPTIMIZER_EVALUATOR)
            return
        if phase == "mode-decided":
            if (
                pending is not None
                and pending.type == "ModeOutcomeCommitted"
                and pending.data["activityKey"] is not None
            ):
                await self._settle_pending(pending)
            elif (
                self.patch_each_round
                and cast(dict[str, Any], open_round["plan"])["patchPlanner"] is not None
            ):
                await self._dispatch(ActivityPhase.PATCH_PLANNER)
            else:
                await self._finish_round()
            return
        if phase == "patch-decided":
            if pending is not None and pending.type in {"PatchAccepted", "PatchRejected"}:
                await self._settle_pending(pending)
            elif cast(dict[str, Any], open_round["patchDecision"])["outcome"] == "rejected":
                await self._terminate("PATCH_REJECTED")
            else:
                await self._finish_round()
            return
        raise CycleRuntimeError(
            CycleErrorCode.INVALID_HISTORY,
            f"unsupported open round phase {phase}",
        )

    def _pending_settlement_event(self, iteration: int) -> CycleEvent | None:
        outcome_types = {
            "ActivityFailed",
            "DiscoveryCommitted",
            "CandidateEvaluationCommitted",
            "ModeOutcomeCommitted",
            "PatchAccepted",
            "PatchRejected",
        }
        for event in reversed(self.journal.events):
            if event.type in {"LeaseAcquired", "LeaseRenewed", "LeaseReleased"}:
                continue
            event_iteration = event.data.get("iteration")
            if event_iteration != iteration:
                continue
            if event.type == "BudgetReservationSettled":
                return None
            if event.type in outcome_types:
                return event
            if event.type in {"ActivityStarted", "RoundReserved"}:
                return None
        return None

    async def _invoke_phase(self, phase: ActivityPhase) -> None:
        open_round = cast(dict[str, Any], self.fold.state["openRound"])
        plan = cast(dict[str, Any], open_round["plan"])
        plan_entry = {
            ActivityPhase.FINDER: plan["finder"],
            ActivityPhase.CANDIDATE_EVALUATOR: plan["candidateEvaluator"],
            ActivityPhase.CONDITION: plan["modeActivity"],
            ActivityPhase.OPTIMIZER_EVALUATOR: plan["modeActivity"],
            ActivityPhase.PATCH_PLANNER: plan["patchPlanner"],
        }[phase]
        if type(plan_entry) is not dict:
            raise CycleRuntimeError(
                CycleErrorCode.INVALID_HISTORY,
                f"phase {phase} has no reserved plan entry",
            )
        binding = self._binding(phase)
        handler = self.handlers.for_phase(phase)
        if handler is None:
            raise CycleRuntimeError(
                CycleErrorCode.INVALID_REQUEST,
                f"phase {phase} has no native Python handler",
            )
        prior_attempts = [
            event
            for event in self.journal.events
            if event.type == "ActivityStarted"
            and event.data["iteration"] == open_round["iteration"]
            and event.data["phase"] == phase.value
        ]
        attempt = len(prior_attempts) + 1
        input_value = self._phase_input(phase)
        input_hash = hashlib.sha256(canonical_json(input_value).encode("utf-8")).hexdigest()
        key = activity_key(
            controller_run_id=self.request.model.controller_run_id,
            controller_hash=self.request.controller_hash,
            iteration=cast(int, open_round["iteration"]),
            phase=phase.value,
            activity_id=binding.activity_id,
            input_hash=input_hash,
        )
        await self.journal.append(
            "ActivityStarted",
            {
                "iteration": open_round["iteration"],
                "phase": phase.value,
                "activityId": binding.activity_id,
                "activityKey": key,
                "attempt": attempt,
                "sideEffects": binding.side_effects,
                "inputHash": input_hash,
                "reservationId": open_round["reservationId"],
            },
        )
        context = CycleActivityContext(
            controller_run_id=self.request.model.controller_run_id,
            iteration=cast(int, open_round["iteration"]),
            phase=phase,
            attempt=attempt,
            activity_key=key,
            idempotency_key=key,
            deadline_at=cast(str, self.fold.state["deadlineAt"]),
            input=input_value,
            cancellation=self.cancellation,
        )
        invocation = await self._call_handler(handler, context, binding)
        if invocation.cancelled or invocation.timed_out:
            reason = "CANCELLED" if invocation.cancelled else "FAILED"
            await self._settle_open_claim()
            await self._terminate(
                reason,
                failure_code=None if invocation.cancelled else "GE_ACTIVITY_TIMEOUT",
            )
            return
        boundary_reason = self._before_dispatch_reason()
        if boundary_reason is not None:
            # A result racing cancellation or the absolute deadline is late.
            # Charge the durable claim, retain it as in doubt, and do not let
            # the late value alter seen/verdict/revision state.
            await self._settle_open_claim()
            await self._terminate(boundary_reason)
            return
        if invocation.error is not None:
            await self._record_activity_failure(
                phase,
                key,
                attempt,
                binding,
                invocation.error,
            )
            return
        try:
            output = capture_portable_json(
                invocation.value,
                error_code=CycleErrorCode.ACTIVITY_OUTPUT_INVALID,
            )
            await self._record_output(phase, output, key, binding)
        except CycleRuntimeError as exc:
            if exc.code not in {
                CycleErrorCode.ACTIVITY_OUTPUT_INVALID,
                CycleErrorCode.INVALID_CANDIDATE,
                CycleErrorCode.PATCH_INVALID,
            }:
                raise
            await self._record_activity_failure(
                phase,
                key,
                attempt,
                binding,
                exc,
                retryable=False,
            )

    async def _call_handler(
        self,
        handler: ActivityHandler,
        context: CycleActivityContext,
        binding: CycleActivityBinding,
    ) -> _Invocation:
        async def call() -> object:
            if inspect.iscoroutinefunction(handler):
                return await cast(Callable[[CycleActivityContext], Awaitable[object]], handler)(
                    context
                )
            value = await asyncio.to_thread(handler, context)
            if inspect.isawaitable(value):
                return await cast(Awaitable[object], value)
            return value

        task = asyncio.create_task(call())
        cancel_task = asyncio.create_task(self.cancellation.wait())
        now = self.journal.timestamp()
        remaining_ms = max(
            0,
            int(
                (
                    parse_timestamp(context.deadline_at) - parse_timestamp(now)
                ).total_seconds()
                * 1000
            ),
        )
        timeout = min(binding.timeout_ms, remaining_ms) / 1000
        done, _ = await asyncio.wait(
            {task, cancel_task},
            timeout=timeout,
            return_when=asyncio.FIRST_COMPLETED,
        )
        if task in done:
            cancel_task.cancel()
            try:
                return _Invocation(value=task.result())
            except asyncio.CancelledError as exc:
                return _Invocation(error=exc, cancelled=self.cancellation.cancelled)
            except BaseException as exc:
                return _Invocation(error=exc)
        task.cancel()
        task.add_done_callback(_consume_background_task)
        if cancel_task in done or self.cancellation.cancelled:
            return _Invocation(cancelled=True)
        cancel_task.cancel()
        return _Invocation(timed_out=True)

    async def _record_output(
        self,
        phase: ActivityPhase,
        output: JsonValue,
        key: str,
        binding: CycleActivityBinding,
    ) -> None:
        open_round = cast(dict[str, Any], self.fold.state["openRound"])
        usage = {"attempts": 1, "costUsd": binding.max_cost_usd_per_attempt}
        if phase is ActivityPhase.FINDER:
            seen = cast(list[str], self.fold.state["seenKeys"])
            classified = classify_candidates(
                output,
                seen_keys=seen,
                policy=self.request.model.policy,
            )
            payload: JsonObject = {
                "disposition": "inline-unredacted",
                "redacted": False,
                "encoding": "canonical-json/v1alpha1",
                "canonicalJson": classified.canonical_json,
                "utf8ByteLength": len(classified.canonical_json.encode("utf-8")),
                "sha256": classified.sha256,
            }
            await self.journal.append(
                "DiscoveryCommitted",
                lambda timestamp: {
                    "iteration": open_round["iteration"],
                    "activityKey": key,
                    "candidateBatch": payload,
                    "candidateBatchHash": classified.sha256,
                    "candidateCount": len(classified.candidates),
                    "freshKeys": list(classified.fresh_keys),
                    "duplicateKeys": list(classified.duplicate_keys),
                    "seenAdditions": list(classified.seen_additions),
                    "usage": usage,
                    "durationMs": self._elapsed(timestamp),
                },
            )
            return
        if phase is ActivityPhase.CANDIDATE_EVALUATOR:
            verdicts = self._validate_verdicts(output, open_round)
            partitions: dict[str, list[str]] = {"accept": [], "reject": [], "unknown": []}
            for verdict in verdicts:
                partitions[cast(str, verdict["verdict"])].append(cast(str, verdict["key"]))
            await self.journal.append(
                "CandidateEvaluationCommitted",
                lambda timestamp: {
                    "iteration": open_round["iteration"],
                    "activityKey": key,
                    "verdicts": verdicts,
                    "acceptedKeys": partitions["accept"],
                    "rejectedKeys": partitions["reject"],
                    "unknownKeys": partitions["unknown"],
                    "usage": usage,
                    "durationMs": self._elapsed(timestamp),
                },
            )
            return
        if phase is ActivityPhase.CONDITION:
            if type(output) is not bool:
                raise CycleRuntimeError(
                    CycleErrorCode.ACTIVITY_OUTPUT_INVALID,
                    "condition output must be an exact boolean",
                )
            outcome: JsonObject = {"mode": "while", "condition": output}
            await self.journal.append(
                "ModeOutcomeCommitted",
                lambda timestamp: {
                    "iteration": open_round["iteration"],
                    "activityKey": key,
                    "outcome": outcome,
                    "usage": usage,
                    "durationMs": self._elapsed(timestamp),
                },
            )
            return
        if phase is ActivityPhase.OPTIMIZER_EVALUATOR:
            if output not in {"accept", "revise", "unknown"}:
                raise CycleRuntimeError(
                    CycleErrorCode.ACTIVITY_OUTPUT_INVALID,
                    "optimizer evaluator output must be accept, revise, or unknown",
                )
            outcome = {
                "mode": "evaluator-optimizer",
                "verdict": output,
            }
            await self.journal.append(
                "ModeOutcomeCommitted",
                lambda timestamp: {
                    "iteration": open_round["iteration"],
                    "activityKey": key,
                    "outcome": outcome,
                    "usage": usage,
                    "durationMs": self._elapsed(timestamp),
                },
            )
            return
        await self._record_patch(output, key, binding, open_round)

    async def _record_patch(
        self,
        output: JsonValue,
        key: str,
        binding: CycleActivityBinding,
        open_round: dict[str, Any],
    ) -> None:
        if self.patch_runtime is None or self.patch_authority is None:
            raise CycleRuntimeError(
                CycleErrorCode.PATCH_UNSUPPORTED,
                "native patch runtime and authority are required",
            )
        boundary_reason = self._before_dispatch_reason()
        if boundary_reason is not None:
            # The planner call already occurred and is charged, but its
            # result-dependent structural mutation must not cross a newly
            # observed cancellation/deadline/resource boundary.
            await self._settle_open_claim()
            await self._terminate(boundary_reason)
            return
        plan = cast(dict[str, Any], open_round["plan"])
        dynamic = cast(int, plan["maxDynamicNodes"])

        async def record(decision: PatchDecision) -> None:
            canonical = decision.canonical_json
            raw = canonical.encode("utf-8")
            patch_payload: JsonObject = {
                "disposition": "inline-unredacted",
                "redacted": False,
                "encoding": "canonical-json/v1alpha1",
                "canonicalJson": canonical,
                "utf8ByteLength": len(raw),
                "sha256": decision.patch_hash,
            }
            common: dict[str, Any] = {
                "iteration": open_round["iteration"],
                "plannerActivityKey": key,
                "patchId": decision.patch_id,
                "patch": patch_payload,
                "patchHash": decision.patch_hash,
                "requestedBase": decision.requested_base,
                "authoritySnapshot": decision.authority_snapshot,
                "policySnapshotHash": decision.policy_snapshot_hash,
                "budgetOutcome": decision.budget_outcome,
                "diagnostics": [
                    {"code": item.code, "phase": item.phase, "path": item.path}
                    for item in decision.diagnostics
                ],
                "outcome": decision.outcome,
            }
            if decision.outcome == "accepted":
                assert decision.resulting_revision is not None
                common["resultingRevision"] = decision.resulting_revision
                graph_revision = cast(
                    int,
                    cast(dict[str, Any], decision.resulting_revision["body"])[
                        "graphRevision"
                    ],
                )
                await self.journal.append(
                    "PatchAccepted",
                    lambda timestamp: {
                        **common,
                        "decidedAtDurationMs": self._elapsed(timestamp),
                    },
                    graph_revision=graph_revision,
                )
            else:
                assert decision.error_code is not None
                common["errorCode"] = decision.error_code.value
                await self.journal.append(
                    "PatchRejected",
                    lambda timestamp: {
                        **common,
                        "decidedAtDurationMs": self._elapsed(timestamp),
                    },
                )

        effective_authority = replace(
            self.patch_authority,
            proposer_activity_key=key,
        )
        await self.patch_runtime.apply(
            output,
            authority=effective_authority,
            policy_snapshot_hash=effective_authority.policy_hash,
            reservation=PatchReservation(
                cast(str, open_round["reservationId"]),
                1,
                binding.max_cost_usd_per_attempt,
                dynamic,
            ),
            record=record,
        )

    def _validate_verdicts(
        self,
        value: JsonValue,
        open_round: dict[str, Any],
    ) -> list[JsonObject]:
        if type(value) is not list:
            raise CycleRuntimeError(
                CycleErrorCode.ACTIVITY_OUTPUT_INVALID,
                "candidate evaluator output must be an array",
            )
        discovery = cast(dict[str, Any], open_round["discovery"])
        fresh = cast(list[str], discovery["freshKeys"])
        verdicts: list[JsonObject] = []
        for item in value:
            if (
                type(item) is not dict
                or set(item) != {"key", "verdict"}
                or item.get("verdict") not in {"accept", "reject", "unknown"}
            ):
                raise CycleRuntimeError(
                    CycleErrorCode.ACTIVITY_OUTPUT_INVALID,
                    "verdict must be a closed key/verdict object",
                )
            verdicts.append(item)
        if [item["key"] for item in verdicts] != fresh:
            raise CycleRuntimeError(
                CycleErrorCode.ACTIVITY_OUTPUT_INVALID,
                "verdicts must cover every fresh key exactly once in order",
            )
        return verdicts

    async def _settle_pending(self, event: CycleEvent) -> None:
        data = event.data
        if event.type in {
            "DiscoveryCommitted",
            "CandidateEvaluationCommitted",
            "ModeOutcomeCommitted",
            "ActivityFailed",
        }:
            usage = cast(dict[str, Any], data["usage"])
            committed: JsonObject = {
                "attempts": cast(JsonValue, usage["attempts"]),
                "costUsd": cast(JsonValue, usage["costUsd"]),
                "dynamicNodes": 0,
            }
            phase = (
                cast(str, cast(dict[str, Any], data["failure"])["phase"])
                if event.type == "ActivityFailed"
                else self._outcome_phase(event)
            )
        elif event.type in {"PatchAccepted", "PatchRejected"}:
            committed = cast(JsonObject, cast(dict[str, Any], data["budgetOutcome"])["committed"])
            phase = "patch-planner"
        else:
            raise CycleRuntimeError(
                CycleErrorCode.INVALID_HISTORY,
                "tail event has no pending settlement",
            )
        await self._append_settlement(phase, committed)

    async def _settle_open_claim(self) -> None:
        open_round = cast(dict[str, Any], self.fold.state["openRound"])
        activity = cast(dict[str, Any], open_round["openActivity"])
        binding = self._binding(ActivityPhase(cast(str, activity["phase"])))
        await self._append_settlement(
            cast(str, activity["phase"]),
            {
                "attempts": 1,
                "costUsd": binding.max_cost_usd_per_attempt,
                "dynamicNodes": 0,
            },
        )

    async def _append_settlement(self, phase: str, committed: JsonObject) -> None:
        state = self.fold.state
        open_round = cast(dict[str, Any], state["openRound"])
        reservation = cast(dict[str, Any], cast(list[Any], state["liveReservations"])[0])
        remaining_before = cast(dict[str, Any], reservation["remaining"])
        remaining_after = {
            field: remaining_before[field] - committed[field]
            for field in ("attempts", "costUsd", "dynamicNodes")
        }
        totals = {
            "attemptsCommitted": cast(int, state["attemptsUsed"])
            + cast(int, committed["attempts"]),
            "costUsdCommitted": cast(int | float, state["costUsd"])
            + cast(int | float, committed["costUsd"]),
            "dynamicNodesCommitted": cast(int, state["dynamicNodes"])
            + cast(int, committed["dynamicNodes"]),
            "liveReservations": remaining_after,
        }
        await self.journal.append(
            "BudgetReservationSettled",
            {
                "iteration": open_round["iteration"],
                "reservationId": open_round["reservationId"],
                "phase": phase,
                "committed": committed,
                "totals": totals,
            },
        )

    async def _record_activity_failure(
        self,
        phase: ActivityPhase,
        key: str,
        attempt: int,
        binding: CycleActivityBinding,
        error: BaseException,
        *,
        retryable: bool | None = None,
    ) -> None:
        open_round = cast(dict[str, Any], self.fold.state["openRound"])
        if retryable is None:
            retryable = (
                binding.side_effects != "non-idempotent"
                and attempt < binding.max_attempts_per_round
            )
        in_doubt = binding.side_effects == "non-idempotent"
        code = (
            error.code.value
            if isinstance(error, CycleRuntimeError)
            else CycleErrorCode.ACTIVITY_FAILED.value
        )
        await self.journal.append(
            "ActivityFailed",
            {
                "iteration": open_round["iteration"],
                "activityKey": key,
                "attempt": attempt,
                "failure": {
                    "phase": phase.value,
                    "code": code,
                    "retryable": retryable,
                    "inDoubt": in_doubt,
                },
                "usage": {
                    "attempts": 1,
                    "costUsd": binding.max_cost_usd_per_attempt,
                },
            },
        )

    async def _after_failed_activity(self) -> None:
        failures = [
            event for event in self.journal.events if event.type == "ActivityFailed"
        ]
        failure = failures[-1]
        details = cast(dict[str, Any], failure.data["failure"])
        phase = ActivityPhase(cast(str, details["phase"]))
        if details["retryable"] is True and details["inDoubt"] is False:
            await self._dispatch(phase)
            return
        await self._terminate("FAILED", failure_code=cast(str, details["code"]))

    async def _recover_open_activity(self, open_round: dict[str, Any]) -> None:
        activity = cast(dict[str, Any], open_round["openActivity"])
        phase = ActivityPhase(cast(str, activity["phase"]))
        binding = self._binding(phase)
        if binding.side_effects == "non-idempotent":
            raise CycleRuntimeError(
                CycleErrorCode.IN_DOUBT_SIDE_EFFECT,
                "an open non-idempotent cycle activity cannot be resumed automatically",
                details={
                    "phase": phase.value,
                    "activityKey": activity["activityKey"],
                },
            )
        await self.journal.append(
            "ActivityFailed",
            {
                "iteration": open_round["iteration"],
                "activityKey": activity["activityKey"],
                "attempt": activity["attempt"],
                "failure": {
                    "phase": phase.value,
                    "code": "GE_ACTIVITY_INTERRUPTED",
                    "retryable": True,
                    "inDoubt": False,
                },
                "usage": {
                    "attempts": 1,
                    "costUsd": binding.max_cost_usd_per_attempt,
                },
            },
        )

    async def _finish_round(self) -> None:
        await self._release_remaining("round-complete")
        state = self.fold.state
        open_round = cast(dict[str, Any], state["openRound"])
        discovery = cast(dict[str, Any], open_round["discovery"])
        evaluation = cast(dict[str, Any], open_round["evaluation"])
        dry = (
            cast(int, state["consecutiveDryRounds"]) + 1
            if self.request.model.policy.mode == "until-dry" and not discovery["freshKeys"]
            else 0
        )
        record: JsonObject = {
            "iteration": open_round["iteration"],
            "candidateBatchHash": discovery["candidateBatchHash"],
            "candidateCount": discovery["candidateCount"],
            "freshKeys": discovery["freshKeys"],
            "duplicateKeys": discovery["duplicateKeys"],
            "acceptedKeys": evaluation["acceptedKeys"],
            "rejectedKeys": evaluation["rejectedKeys"],
            "unknownKeys": evaluation["unknownKeys"],
            "modeOutcome": open_round["modeOutcome"],
            "patchDecision": open_round["patchDecision"],
            "consecutiveDryRounds": dry,
            "attemptsUsed": state["attemptsUsed"],
            "costUsd": state["costUsd"],
            "dynamicNodes": state["dynamicNodes"],
            "durationMs": state["durationMs"],
            "currentRevision": self.fold.current_revision,
        }
        await self.journal.append("RoundCommitted", {"record": record})
        warning = await self.journal.checkpoint(
            f"{self.request.model.controller_run_id}-round-{record['iteration']}"
        )
        self.checkpoint_warning = warning or self.checkpoint_warning

    async def _release_remaining(self, reason: str) -> None:
        state = self.fold.state
        reservations = cast(list[Any], state["liveReservations"])
        if not reservations:
            return
        reservation = cast(dict[str, Any], reservations[0])
        remaining = cast(dict[str, Any], reservation["remaining"])
        if all(remaining[field] == 0 for field in ("attempts", "costUsd", "dynamicNodes")):
            return
        open_round = cast(dict[str, Any], state["openRound"])
        await self.journal.append(
            "BudgetReservationReleased",
            {
                "iteration": open_round["iteration"],
                "reservationId": open_round["reservationId"],
                "reason": reason,
                "released": remaining,
                "remaining": {"attempts": 0, "costUsd": 0, "dynamicNodes": 0},
                "totals": {
                    "attemptsCommitted": state["attemptsUsed"],
                    "costUsdCommitted": state["costUsd"],
                    "dynamicNodesCommitted": state["dynamicNodes"],
                    "liveReservations": {
                        "attempts": 0,
                        "costUsd": 0,
                        "dynamicNodes": 0,
                    },
                },
            },
        )

    async def _terminate(
        self,
        trigger: str,
        *,
        failure_code: str | None = None,
    ) -> CycleRunResult:
        if self.fold.state["openRound"] is not None:
            release_reason = {
                "CANCELLED": "cancelled",
                "PATCH_REJECTED": "patch-rejected",
                "FAILED": "failed",
            }.get(trigger, "bound-reached")
            await self._release_remaining(release_reason)
        state = self.fold.state
        convergence, unknown_verdict = self._convergence_facts()
        open_round = state["openRound"]
        patch_rejected = (
            type(open_round) is dict
            and type(open_round.get("patchDecision")) is dict
            and cast(dict[str, Any], open_round["patchDecision"]).get("outcome") == "rejected"
        )
        failed = trigger == "FAILED"
        facts = HardStopFacts(
            cancelled=trigger == "CANCELLED" or self.cancellation.cancelled,
            duration_ms=cast(int, state["durationMs"]),
            cost_usd=cast(int | float, state["costUsd"]),
            attempts_used=cast(int, state["attemptsUsed"]),
            dynamic_nodes=cast(int, state["dynamicNodes"]),
            seen_count=len(cast(list[Any], state["seenKeys"])),
            iterations=cast(int, state["nextIteration"]) - 1,
            duration_observed=trigger == "MAX_DURATION",
            cost_reservation_blocked=trigger == "MAX_COST",
            attempt_reservation_blocked=trigger == "MAX_TOTAL_ATTEMPTS",
            dynamic_reservation_blocked=trigger == "MAX_DYNAMIC_NODES",
            patch_rejected=patch_rejected,
            failed=failed,
            unknown_verdict=unknown_verdict,
            convergence_reason=convergence,
        )
        reason = select_exit_reason(facts, self.request.model.policy)
        if reason is None:
            raise CycleRuntimeError(
                CycleErrorCode.INVALID_HISTORY,
                f"terminal trigger {trigger} has no observable folded reason",
            )
        policy = self.request.model.policy
        observation: JsonObject = {
            "cancelled": facts.cancelled,
            "maxDuration": facts.duration_observed
            or facts.duration_ms >= policy.max_duration_ms,
            "maxCost": facts.cost_reservation_blocked
            or (facts.cost_usd > 0 and facts.cost_usd >= policy.max_cost_usd),
            "maxTotalAttempts": facts.attempt_reservation_blocked
            or (
                facts.attempts_used > 0
                and facts.attempts_used >= policy.max_total_attempts
            ),
            "maxDynamicNodes": facts.dynamic_reservation_blocked
            or (
                facts.dynamic_nodes > 0
                and facts.dynamic_nodes >= policy.max_dynamic_nodes
            ),
            "maxDiscoveries": convergence is None
            and facts.seen_count >= policy.max_discoveries,
            "maxIterations": facts.iterations >= policy.max_iterations,
            "patchRejected": facts.patch_rejected,
            "failed": facts.failed,
            "failureCode": failure_code if facts.failed else None,
            "unknownVerdict": facts.unknown_verdict,
            "convergenceReason": convergence,
        }
        status = {
            "DRY": "converged",
            "CONDITION_FALSE": "converged",
            "EVALUATOR_ACCEPTED": "converged",
            "UNKNOWN_VERDICT": "unknown",
            "MAX_ITERATIONS": "bounded",
            "MAX_DURATION": "bounded",
            "MAX_COST": "bounded",
            "MAX_TOTAL_ATTEMPTS": "bounded",
            "MAX_DYNAMIC_NODES": "bounded",
            "MAX_DISCOVERIES": "bounded",
            "PATCH_REJECTED": "failed",
            "FAILED": "failed",
            "CANCELLED": "cancelled",
        }[reason]
        categories = {
            "seenCount": len(cast(list[Any], state["seenKeys"])),
            "acceptedCount": len(cast(list[Any], state["acceptedKeys"])),
            "rejectedCount": len(cast(list[Any], state["rejectedKeys"])),
            "unknownCount": len(cast(list[Any], state["unknownKeys"])),
            "unevaluatedCount": len(cast(list[Any], state["unevaluatedKeys"])),
        }
        terminal_sequence = len(self.journal.events)
        history_hash = self.journal.events[-1].record_hash
        result: JsonObject = {
            "apiVersion": "graphengineering.reacher-z.github.io/cycle-results/v1alpha1",
            "kind": "CycleControllerResult",
            "controllerRunId": self.request.model.controller_run_id,
            "controllerHash": self.request.controller_hash,
            "requestHash": self.request.request_hash,
            "mode": self.request.model.policy.mode,
            "status": status,
            "exitReason": reason,
            "iterations": cast(int, state["nextIteration"]) - 1,
            "consecutiveDryRounds": state["consecutiveDryRounds"],
            **categories,
            "attemptsUsed": state["attemptsUsed"],
            "costUsd": state["costUsd"],
            "dynamicNodes": state["dynamicNodes"],
            "durationMs": state["durationMs"],
            "lastGraphRevision": self.fold.current_revision["graphRevision"],
            "lastGraphHash": self.fold.current_revision["graphHash"],
            "lastRevisionHash": self.fold.current_revision["revisionHash"],
            "terminalSequence": terminal_sequence,
            "historyPrefixHash": history_hash,
        }
        await self.journal.append(
            "ControllerTerminated",
            {"observation": observation, "result": result},
        )
        self.checkpoint_warning = (
            await self.journal.checkpoint(f"{self.request.model.controller_run_id}-terminal")
            or self.checkpoint_warning
        )
        assert self.fold.terminal_result is not None
        return CycleRunResult(
            self.fold.terminal_result,
            self.journal.events,
            self.checkpoint_warning,
        )

    def _phase_input(self, phase: ActivityPhase) -> JsonValue:
        state = self.fold.state
        objective = json.loads(self.request.model.objective.canonical_json_value)
        open_round = cast(dict[str, Any], state["openRound"])
        base: dict[str, Any]
        if phase is ActivityPhase.FINDER:
            base = {
                "objective": objective,
                "currentRevision": self.fold.current_revision,
                "remainingDiscoveryCredit": (
                    self.request.model.policy.max_discoveries
                    - len(cast(list[Any], state["seenKeys"]))
                ),
            }
        else:
            discovery_event = next(
                event
                for event in reversed(self.journal.events)
                if event.type == "DiscoveryCommitted"
                and event.data["iteration"] == open_round["iteration"]
            )
            payload = cast(dict[str, Any], discovery_event.data["candidateBatch"])
            candidates = cast(
                list[dict[str, Any]],
                json.loads(cast(str, payload["canonicalJson"])),
            )
            fresh_keys = cast(list[str], discovery_event.data["freshKeys"])
            fresh_set = set(fresh_keys)
            emitted: set[str] = set()
            fresh_candidates: list[dict[str, Any]] = []
            for candidate in candidates:
                key = cast(str, candidate["key"])
                if key in fresh_set and key not in emitted:
                    emitted.add(key)
                    fresh_candidates.append(candidate)
            if phase is ActivityPhase.CANDIDATE_EVALUATOR:
                base = {
                    "objective": objective,
                    "candidates": fresh_candidates,
                }
            else:
                evaluation_event = next(
                    event
                    for event in reversed(self.journal.events)
                    if event.type == "CandidateEvaluationCommitted"
                    and event.data["iteration"] == open_round["iteration"]
                )
                verdicts = evaluation_event.data["verdicts"]
                if phase in {
                    ActivityPhase.CONDITION,
                    ActivityPhase.OPTIMIZER_EVALUATOR,
                }:
                    base = {
                        "objective": objective,
                        "candidates": candidates,
                        "verdicts": verdicts,
                        "graphHash": self.fold.current_revision["graphHash"],
                    }
                else:
                    base = {
                        "objective": objective,
                        "candidates": candidates,
                        "verdicts": verdicts,
                        "modeOutcome": open_round["modeOutcome"],
                        "currentRevision": self.fold.current_revision,
                    }
        captured = capture_portable_json(base)
        return captured

    def _binding(self, phase: ActivityPhase) -> CycleActivityBinding:
        binding = {
            ActivityPhase.FINDER: self.request.model.activities.finder,
            ActivityPhase.CANDIDATE_EVALUATOR: self.request.model.activities.candidate_evaluator,
            ActivityPhase.CONDITION: self.request.model.activities.condition,
            ActivityPhase.OPTIMIZER_EVALUATOR: self.request.model.activities.optimizer_evaluator,
            ActivityPhase.PATCH_PLANNER: self.request.model.activities.patch_planner,
        }[phase]
        if binding is None:
            raise CycleRuntimeError(
                CycleErrorCode.INVALID_REQUEST,
                f"request does not bind {phase.value}",
            )
        return binding

    def _outcome_phase(self, event: CycleEvent) -> str:
        if event.type == "DiscoveryCommitted":
            return "finder"
        if event.type == "CandidateEvaluationCommitted":
            return "candidate-evaluator"
        outcome = cast(dict[str, Any], event.data["outcome"])
        return "condition" if outcome["mode"] == "while" else "optimizer-evaluator"

    def _elapsed(self, timestamp: str) -> int:
        return _elapsed_milliseconds(cast(str, self.fold.state["startedAt"]), timestamp)

    def _observed_duration(self) -> int:
        observed = _elapsed_milliseconds(
            cast(str, self.fold.state["startedAt"]),
            self.journal.timestamp(),
        )
        return max(cast(int, self.fold.state["durationMs"]), observed)


def _consume_background_task(task: asyncio.Task[object]) -> None:
    with contextlib.suppress(asyncio.CancelledError, Exception):
        task.exception()


def _validate_handler_shape(request: ValidatedCycleRequest, handlers: CycleHandlers) -> None:
    mode = request.model.policy.mode
    if mode == "while" and handlers.condition is None:
        raise CycleRuntimeError(CycleErrorCode.INVALID_REQUEST, "while requires condition handler")
    if mode == "evaluator-optimizer" and handlers.optimizer_evaluator is None:
        raise CycleRuntimeError(
            CycleErrorCode.INVALID_REQUEST,
            "evaluator-optimizer requires optimizer evaluator handler",
        )


def _validate_patch_execution_inputs(
    request: ValidatedCycleRequest,
    *,
    patch_each_round: bool,
    patch_runtime: GraphPatchRuntime | None,
    patch_authority: PatchAuthority | None,
) -> None:
    if not patch_each_round:
        return
    if not request.model.patches.enabled:
        raise CycleRuntimeError(
            CycleErrorCode.INVALID_REQUEST,
            "patch_each_round is forbidden by the request patch policy",
        )
    if patch_runtime is None or patch_authority is None:
        raise CycleRuntimeError(
            CycleErrorCode.PATCH_UNSUPPORTED,
            "patch-enabled execution requires a native runtime and authority snapshot",
        )


def _last_recorded_lease_id(events: tuple[CycleEvent, ...]) -> str | None:
    for event in reversed(events):
        if event.lease is not None:
            return event.lease.lease_id
    return None


def _require_new_lease_fence(events: tuple[CycleEvent, ...], lease: JsonObject) -> None:
    epochs = [event.lease.lease_epoch for event in events if event.lease is not None]
    fences = [event.lease.fencing_token for event in events if event.lease is not None]
    if (
        epochs
        and (
            cast(int, lease["leaseEpoch"]) <= max(epochs)
            or cast(int, lease["fencingToken"]) <= max(fences)
        )
    ):
        raise CycleRuntimeError(
            CycleErrorCode.STALE_LEASE,
            "resume lease epoch and fencing token must strictly advance",
        )


async def _resolve_parent_fold(
    request: ValidatedCycleRequest,
    store: CycleStore,
    *,
    ancestors: frozenset[str] = frozenset(),
) -> CycleFold | None:
    lineage = request.model.lineage
    if lineage.origin == "start":
        return None
    run_id = request.model.controller_run_id
    if run_id in ancestors or len(ancestors) >= 100:
        raise CycleRuntimeError(
            CycleErrorCode.INVALID_HISTORY,
            "fork lineage is cyclic or exceeds the bounded ancestry depth",
        )
    parent_events = await store.read_by_controller_run_id(
        lineage.parent_controller_run_id,
        through_sequence=lineage.parent_sequence,
    )
    if (
        len(parent_events) != lineage.parent_sequence + 1
        or parent_events[-1].record_hash != lineage.parent_history_hash
    ):
        raise CycleRuntimeError(
            CycleErrorCode.INVALID_HISTORY,
            "fork parent prefix length or history hash differs from lineage",
        )
    parent_request = validate_cycle_request(parent_events[0].data["request"])
    parent_parent = await _resolve_parent_fold(
        parent_request,
        store,
        ancestors=ancestors | {run_id},
    )
    return fold_cycle_events(parent_events, parent_fold=parent_parent)


async def _fold_stored_events(
    request: ValidatedCycleRequest,
    events: tuple[CycleEvent, ...],
    store: CycleStore,
    *,
    require_terminal: bool = False,
) -> tuple[CycleFold, CycleFold | None]:
    parent_fold = await _resolve_parent_fold(request, store)
    return (
        fold_cycle_events(
            events,
            require_terminal=require_terminal,
            parent_fold=parent_fold,
        ),
        parent_fold,
    )


async def _checkpoint_validation_warning(
    request: ValidatedCycleRequest,
    store: CycleStore,
    events: tuple[CycleEvent, ...],
    parent_fold: CycleFold | None,
    checkpoint_id: str | None,
) -> CycleRuntimeError | None:
    if checkpoint_id is None:
        return None
    try:
        checkpoint = await store.load_checkpoint(
            request.model.checkpoint_scope,
            checkpoint_id,
        )
        if checkpoint is not None:
            validate_checkpoint(checkpoint, events, parent_fold=parent_fold)
    except CycleRuntimeError as exc:
        return exc
    except Exception as exc:
        return CycleRuntimeError(
            CycleErrorCode.STORE_FAILED,
            "checkpoint validation failed; resume will use the full event stream",
            details={"causeName": type(exc).__name__},
            cause=exc,
        )
    return None


async def start_cycle(
    request: object,
    handlers: CycleHandlers,
    *,
    store: CycleStore,
    lease: object,
    clock: Clock = _default_clock,
    event_id_factory: EventIdFactory = _default_event_id,
    cancellation: CycleCancellation | None = None,
    fault_hook: FaultHook | None = None,
    patch_runtime: GraphPatchRuntime | None = None,
    patch_authority: PatchAuthority | None = None,
    patch_each_round: bool = False,
) -> CycleRunResult:
    """Create a new empty controller stream and execute it to a bounded terminal."""

    validated = validate_cycle_request(request)
    if validated.model.lineage.origin != "start":
        raise CycleRuntimeError(
            CycleErrorCode.INVALID_REQUEST,
            "start_cycle requires start lineage; use fork_cycle for a fork request",
        )
    _validate_handler_shape(validated, handlers)
    _validate_patch_execution_inputs(
        validated,
        patch_each_round=patch_each_round,
        patch_runtime=patch_runtime,
        patch_authority=patch_authority,
    )
    if patch_each_round and patch_runtime is not None:
        expected_initial = cast(JsonObject, validated.document["initialGraph"])
        if canonical_json(patch_runtime.coordinate) != canonical_json(expected_initial):
            raise CycleRuntimeError(
                CycleErrorCode.PATCH_STALE_BASE,
                "native GraphPatch runtime does not start at the request initial revision",
            )
    existing = await store.read(validated.model.event_stream_id)
    if existing:
        raise CycleRuntimeError(
            CycleErrorCode.VERSION_CONFLICT,
            "start refuses a nonempty controller stream",
        )
    lease_document, _ = validate_lease(lease)
    journal = _CycleJournal(
        validated,
        store,
        clock=clock,
        event_id_factory=event_id_factory,
        fault_hook=fault_hook,
    )
    await journal.append(
        "ControllerCreated",
        lambda timestamp: {
            "request": validated.document,
            "requestHash": validated.request_hash,
            "identity": validated.identity,
            "controllerHash": validated.controller_hash,
            "startedAt": timestamp,
            "deadlineAt": _add_milliseconds(
                timestamp,
                validated.model.policy.max_duration_ms,
            ),
        },
    )
    await journal.append(
        "LeaseAcquired",
        {"reason": "start", "previousLeaseId": None},
        lease=lease_document,
    )
    controller = _CycleController(
        validated,
        handlers,
        journal,
        cancellation or CycleCancellation(),
        patch_runtime=patch_runtime,
        patch_authority=patch_authority,
        patch_each_round=patch_each_round,
    )
    return await controller.run()


async def fork_cycle(
    request: object,
    handlers: CycleHandlers,
    *,
    store: CycleStore,
    lease: object,
    parent_controller_run_id: str,
    parent_sequence: int,
    parent_history_hash: str,
    clock: Clock = _default_clock,
    event_id_factory: EventIdFactory = _default_event_id,
    cancellation: CycleCancellation | None = None,
    fault_hook: FaultHook | None = None,
    patch_runtime: GraphPatchRuntime | None = None,
    patch_authority: PatchAuthority | None = None,
    patch_each_round: bool = False,
) -> CycleRunResult:
    """Create an independent child bound to one immutable parent prefix."""

    validated = validate_cycle_request(request)
    lineage = validated.model.lineage
    if lineage.origin != "fork" or (
        lineage.parent_controller_run_id != parent_controller_run_id
        or lineage.parent_sequence != parent_sequence
        or lineage.parent_history_hash != parent_history_hash
    ):
        raise CycleRuntimeError(
            CycleErrorCode.INVALID_REQUEST,
            "fork operation arguments differ from the request's closed lineage",
        )
    if validated.model.controller_run_id == parent_controller_run_id:
        raise CycleRuntimeError(
            CycleErrorCode.INVALID_REQUEST,
            "fork child controllerRunId must differ from its parent",
        )
    _validate_handler_shape(validated, handlers)
    _validate_patch_execution_inputs(
        validated,
        patch_each_round=patch_each_round,
        patch_runtime=patch_runtime,
        patch_authority=patch_authority,
    )
    existing = await store.read(validated.model.event_stream_id)
    if existing:
        raise CycleRuntimeError(
            CycleErrorCode.VERSION_CONFLICT,
            "fork refuses a nonempty child stream",
        )
    parent_fold = await _resolve_parent_fold(validated, store)
    if parent_fold is None:  # pragma: no cover - lineage branch above
        raise CycleRuntimeError(CycleErrorCode.INVALID_HISTORY, "fork parent did not resolve")
    if canonical_json(parent_fold.current_revision) != canonical_json(
        validated.document["initialGraph"]
    ):
        raise CycleRuntimeError(
            CycleErrorCode.INVALID_REQUEST,
            "fork initialGraph must equal the exact parent-prefix revision",
        )
    if patch_each_round and patch_runtime is not None and canonical_json(
        patch_runtime.coordinate
    ) != canonical_json(parent_fold.current_revision):
        raise CycleRuntimeError(
            CycleErrorCode.PATCH_STALE_BASE,
            "fork GraphPatch runtime differs from the inherited revision",
        )
    lease_document, _ = validate_lease(lease)
    journal = _CycleJournal(
        validated,
        store,
        clock=clock,
        event_id_factory=event_id_factory,
        fault_hook=fault_hook,
        parent_fold=parent_fold,
    )
    await journal.append(
        "ControllerCreated",
        lambda timestamp: {
            "request": validated.document,
            "requestHash": validated.request_hash,
            "identity": validated.identity,
            "controllerHash": validated.controller_hash,
            "startedAt": timestamp,
            "deadlineAt": _add_milliseconds(
                timestamp,
                validated.model.policy.max_duration_ms,
            ),
        },
    )
    child_fold = journal.fold
    if child_fold is None:  # pragma: no cover - successful append invariant
        raise CycleRuntimeError(
            CycleErrorCode.INVALID_HISTORY,
            "fork child creation did not produce a fold",
        )
    if any(
        activity["sideEffects"] == "non-idempotent"
        for activity in cast(
            list[dict[str, Any]],
            child_fold.state["inDoubtActivities"],
        )
    ):
        raise CycleRuntimeError(
            CycleErrorCode.IN_DOUBT_SIDE_EFFECT,
            "fork inherited an open non-idempotent activity and cannot dispatch automatically",
        )
    await journal.append(
        "LeaseAcquired",
        {"reason": "start", "previousLeaseId": None},
        lease=lease_document,
    )
    controller = _CycleController(
        validated,
        handlers,
        journal,
        cancellation or CycleCancellation(),
        patch_runtime=patch_runtime,
        patch_authority=patch_authority,
        patch_each_round=patch_each_round,
    )
    return await controller.run()


async def resume_cycle(
    request: object,
    handlers: CycleHandlers,
    *,
    store: CycleStore,
    expected_version: int,
    lease: object,
    clock: Clock = _default_clock,
    event_id_factory: EventIdFactory = _default_event_id,
    cancellation: CycleCancellation | None = None,
    fault_hook: FaultHook | None = None,
    patch_runtime: GraphPatchRuntime | None = None,
    patch_authority: PatchAuthority | None = None,
    patch_each_round: bool = False,
    checkpoint_id: str | None = None,
) -> CycleRunResult:
    """Resume one exact nonterminal request under a strictly higher lease fence."""

    validated = validate_cycle_request(request)
    events = await store.read(validated.model.event_stream_id)
    if not events:
        raise CycleRuntimeError(CycleErrorCode.INVALID_HISTORY, "resume refuses an empty stream")
    if len(events) - 1 != expected_version:
        raise CycleRuntimeError(
            CycleErrorCode.VERSION_CONFLICT,
            "resume expected version differs from stream tail",
        )
    fold, parent_fold = await _fold_stored_events(validated, events, store)
    checkpoint_warning = await _checkpoint_validation_warning(
        validated,
        store,
        events,
        parent_fold,
        checkpoint_id,
    )
    if (
        fold.request.request_hash != validated.request_hash
        or fold.request.controller_hash != validated.controller_hash
    ):
        raise CycleRuntimeError(
            CycleErrorCode.INVALID_REQUEST,
            "resume request identity differs from stored history",
        )
    if fold.terminal:
        assert fold.terminal_result is not None
        return CycleRunResult(fold.terminal_result, events, checkpoint_warning)
    open_round = fold.state["openRound"]
    open_activity = (
        cast(dict[str, Any], open_round).get("openActivity")
        if type(open_round) is dict
        else None
    )
    if any(
        activity["sideEffects"] == "non-idempotent"
        for activity in cast(
            list[dict[str, Any]],
            fold.state["inDoubtActivities"],
        )
    ) or (
        type(open_activity) is dict
        and open_activity.get("sideEffects") == "non-idempotent"
    ):
        raise CycleRuntimeError(
            CycleErrorCode.IN_DOUBT_SIDE_EFFECT,
            "resume is blocked by an in-doubt non-idempotent activity",
        )
    _validate_handler_shape(validated, handlers)
    _validate_patch_execution_inputs(
        validated,
        patch_each_round=patch_each_round,
        patch_runtime=patch_runtime,
        patch_authority=patch_authority,
    )
    lease_document, _ = validate_lease(lease)
    _require_new_lease_fence(events, lease_document)
    if patch_runtime is not None:
        await patch_runtime.restore(events)
        if canonical_json(patch_runtime.coordinate) != canonical_json(fold.current_revision):
            raise CycleRuntimeError(
                CycleErrorCode.PATCH_STALE_BASE,
                "restored GraphPatch runtime differs from folded controller revision",
            )
    journal = _CycleJournal(
        validated,
        store,
        events=events,
        clock=clock,
        event_id_factory=event_id_factory,
        fault_hook=fault_hook,
        parent_fold=parent_fold,
    )
    previous_lease = fold.active_lease
    previous_id = _last_recorded_lease_id(events)
    await journal.append(
        "LeaseAcquired",
        {
            "reason": "resume" if previous_lease is None else "takeover",
            "previousLeaseId": previous_id,
        },
        lease=lease_document,
    )
    controller = _CycleController(
        validated,
        handlers,
        journal,
        cancellation or CycleCancellation(),
        patch_runtime=patch_runtime,
        patch_authority=patch_authority,
        patch_each_round=patch_each_round,
    )
    controller.checkpoint_warning = checkpoint_warning
    return await controller.run()


async def replay_cycle(
    event_stream_id: str,
    *,
    store: CycleStore,
    through_sequence: int | None = None,
) -> CycleReplayResult:
    """Read/fold only: no clock, handler, lease, checkpoint, or append call."""

    events = await store.read(event_stream_id, through_sequence=through_sequence)
    if not events:
        raise CycleRuntimeError(CycleErrorCode.INVALID_HISTORY, "replay stream is empty")
    request = validate_cycle_request(events[0].data["request"])
    fold, _ = await _fold_stored_events(
        request,
        events,
        store,
        require_terminal=through_sequence is None,
    )
    return CycleReplayResult(
        fold.terminal_result,
        fold.state,
        events,
        fold.terminal,
    )


async def pause_cycle(
    request: object,
    *,
    store: CycleStore,
    expected_version: int,
    reason: Literal["paused", "handoff"] = "paused",
    clock: Clock = _default_clock,
    event_id_factory: EventIdFactory = _default_event_id,
    fault_hook: FaultHook | None = None,
) -> CyclePauseResult:
    """Voluntarily release the exact active lease without dispatching work."""

    validated = validate_cycle_request(request)
    events = await store.read(validated.model.event_stream_id)
    if not events:
        raise CycleRuntimeError(CycleErrorCode.INVALID_HISTORY, "pause refuses an empty stream")
    if len(events) - 1 != expected_version:
        raise CycleRuntimeError(
            CycleErrorCode.VERSION_CONFLICT,
            "pause expected version differs from stream tail",
        )
    fold, parent_fold = await _fold_stored_events(validated, events, store)
    if (
        fold.request.request_hash != validated.request_hash
        or fold.request.controller_hash != validated.controller_hash
    ):
        raise CycleRuntimeError(
            CycleErrorCode.INVALID_REQUEST,
            "pause request identity differs from stored history",
        )
    if fold.terminal or fold.active_lease is None:
        raise CycleRuntimeError(
            CycleErrorCode.LEASE_CONFLICT,
            "pause requires one active nonterminal lease",
        )
    released_id = cast(str, fold.active_lease["leaseId"])
    journal = _CycleJournal(
        validated,
        store,
        events=events,
        clock=clock,
        event_id_factory=event_id_factory,
        fault_hook=fault_hook,
        parent_fold=parent_fold,
    )
    await journal.append("LeaseReleased", {"reason": reason})
    return CyclePauseResult(journal.events, released_id)


__all__ = [
    "ActivityHandler",
    "ActivityPhase",
    "Clock",
    "CycleActivityContext",
    "CycleCancellation",
    "CycleHandlers",
    "CyclePauseResult",
    "CycleReplayResult",
    "CycleRunResult",
    "EventIdFactory",
    "fork_cycle",
    "pause_cycle",
    "replay_cycle",
    "resume_cycle",
    "start_cycle",
]
