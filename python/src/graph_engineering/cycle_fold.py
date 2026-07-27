"""Immutable fold and semantic oracles for the D7 controller event stream."""

from __future__ import annotations

import hashlib
import json
import math
import re
from dataclasses import dataclass
from datetime import timedelta
from typing import Any, Literal, cast

from .canonical import canonical_json
from .cycle_contract import (
    CYCLE_CONTROLLER_DOMAIN,
    CYCLE_REQUEST_DOMAIN,
    CycleControllerPolicy,
    CycleErrorCode,
    CycleEvent,
    CycleRuntimeError,
    ValidatedCycleRequest,
    activity_key,
    capture_portable_json,
    domain_hash,
    parse_timestamp,
    revision_hash,
    round_plan_hash,
    validate_cycle_event,
    validate_cycle_request,
)
from .graph_patch import validate_graph_patch_shape
from .models import MAX_SAFE_INTEGER, JsonObject, JsonValue

ExitReason = Literal[
    "DRY",
    "CONDITION_FALSE",
    "EVALUATOR_ACCEPTED",
    "UNKNOWN_VERDICT",
    "MAX_ITERATIONS",
    "MAX_DURATION",
    "MAX_COST",
    "MAX_TOTAL_ATTEMPTS",
    "MAX_DYNAMIC_NODES",
    "MAX_DISCOVERIES",
    "PATCH_REJECTED",
    "FAILED",
    "CANCELLED",
]

_PHASES = (
    "finder",
    "candidate-evaluator",
    "condition",
    "optimizer-evaluator",
    "patch-planner",
)
_BUDGET_FIELDS = ("attempts", "costUsd", "dynamicNodes")

_EVENT_DATA_KEYS: dict[str, frozenset[str]] = {
    "ControllerCreated": frozenset(
        {"request", "requestHash", "identity", "controllerHash", "startedAt", "deadlineAt"}
    ),
    "LeaseAcquired": frozenset({"reason", "previousLeaseId"}),
    "LeaseRenewed": frozenset({"previousExpiresAt", "newExpiresAt"}),
    "LeaseReleased": frozenset({"reason"}),
    "RoundReserved": frozenset(
        {
            "iteration",
            "plan",
            "planHash",
            "reservationId",
            "maximum",
            "deadlineAt",
            "currentRevision",
        }
    ),
    "ActivityStarted": frozenset(
        {
            "iteration",
            "phase",
            "activityId",
            "activityKey",
            "attempt",
            "sideEffects",
            "inputHash",
            "reservationId",
        }
    ),
    "ActivityFailed": frozenset({"iteration", "activityKey", "attempt", "failure", "usage"}),
    "DiscoveryCommitted": frozenset(
        {
            "iteration",
            "activityKey",
            "candidateBatch",
            "candidateBatchHash",
            "candidateCount",
            "freshKeys",
            "duplicateKeys",
            "seenAdditions",
            "usage",
            "durationMs",
        }
    ),
    "CandidateEvaluationCommitted": frozenset(
        {
            "iteration",
            "activityKey",
            "verdicts",
            "acceptedKeys",
            "rejectedKeys",
            "unknownKeys",
            "usage",
            "durationMs",
        }
    ),
    "ModeOutcomeCommitted": frozenset(
        {"iteration", "activityKey", "outcome", "usage", "durationMs"}
    ),
    "BudgetReservationSettled": frozenset(
        {"iteration", "reservationId", "phase", "committed", "totals"}
    ),
    "PatchAccepted": frozenset(
        {
            "iteration",
            "plannerActivityKey",
            "patchId",
            "patch",
            "patchHash",
            "requestedBase",
            "authoritySnapshot",
            "policySnapshotHash",
            "budgetOutcome",
            "diagnostics",
            "decidedAtDurationMs",
            "outcome",
            "resultingRevision",
        }
    ),
    "PatchRejected": frozenset(
        {
            "iteration",
            "plannerActivityKey",
            "patchId",
            "patch",
            "patchHash",
            "requestedBase",
            "authoritySnapshot",
            "policySnapshotHash",
            "budgetOutcome",
            "diagnostics",
            "decidedAtDurationMs",
            "outcome",
            "errorCode",
        }
    ),
    "RoundCommitted": frozenset({"record"}),
    "ControllerTerminated": frozenset({"observation", "result"}),
}


def _history_error(message: str, *, counter: bool = False, path: str = "") -> CycleRuntimeError:
    return CycleRuntimeError(
        CycleErrorCode.COUNTER_MISMATCH if counter else CycleErrorCode.INVALID_HISTORY,
        message,
        path=path,
    )


def _exact(value: object, expected: object, message: str, *, counter: bool = False) -> None:
    if canonical_json(value) != canonical_json(expected):
        raise _history_error(message, counter=counter)


def _object(value: object, label: str) -> dict[str, Any]:
    if type(value) is not dict:
        raise _history_error(f"{label} must be an object")
    return cast(dict[str, Any], value)


def _array(value: object, label: str) -> list[Any]:
    if type(value) is not list:
        raise _history_error(f"{label} must be an array")
    return value


def _integer(value: object, label: str, *, positive: bool = False) -> int:
    minimum = 1 if positive else 0
    if type(value) is not int or value < minimum or value > MAX_SAFE_INTEGER:
        raise _history_error(f"{label} is not a portable counter", counter=True)
    return value


def _cost(value: object, label: str) -> int | float:
    if type(value) not in (int, float):
        raise _history_error(f"{label} is not a portable cost", counter=True)
    result = cast(int | float, value)
    if not math.isfinite(result) or result < 0 or result > MAX_SAFE_INTEGER:
        raise _history_error(f"{label} is not a finite portable cost", counter=True)
    return result


def _add_cost(left: int | float, right: int | float, label: str) -> int | float:
    value = left + right
    if not math.isfinite(value) or value < 0 or value > MAX_SAFE_INTEGER:
        raise _history_error(f"{label} overflowed", counter=True)
    return value


def _require_data_shape(event_type: str, data: dict[str, Any]) -> None:
    if event_type == "BudgetReservationReleased":
        expected = {
            "iteration",
            "reservationId",
            "reason",
            "released",
            "remaining",
            "totals",
        }
        if data.get("reason") == "phase-complete":
            expected.add("phase")
        if set(data) != expected:
            raise _history_error(f"{event_type} data is not closed")
        return
    closed_keys = _EVENT_DATA_KEYS.get(event_type)
    if closed_keys is None or set(data) != closed_keys:
        raise _history_error(f"{event_type} data is not closed")


def _inline_payload(value: object, label: str, *, max_bytes: int) -> JsonValue:
    payload = _object(value, label)
    if set(payload) != {
        "disposition",
        "redacted",
        "encoding",
        "canonicalJson",
        "utf8ByteLength",
        "sha256",
    }:
        raise _history_error(f"{label} is not a closed inline payload")
    if (
        payload["disposition"] != "inline-unredacted"
        or payload["redacted"] is not False
        or payload["encoding"] != "canonical-json/v1alpha1"
        or type(payload["canonicalJson"]) is not str
    ):
        raise _history_error(f"{label} lies about payload disposition")
    raw = payload["canonicalJson"].encode("utf-8")
    if not raw or len(raw) > max_bytes or payload["utf8ByteLength"] != len(raw):
        raise _history_error(f"{label} byte length is invalid")
    digest = hashlib.sha256(raw).hexdigest()
    if payload["sha256"] != digest:
        raise _history_error(f"{label} hash is invalid")
    try:
        decoded = json.loads(
            raw,
            parse_constant=lambda token: (_invalid_json_constant(token)),
        )
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
        raise _history_error(f"{label} is not strict JSON") from exc
    captured = capture_portable_json(decoded, error_code=CycleErrorCode.INVALID_HISTORY)
    if canonical_json(captured).encode("utf-8") != raw:
        raise _history_error(f"{label} is not canonical JSON")
    return captured


def _invalid_json_constant(token: str) -> None:
    raise ValueError(f"invalid JSON constant {token}")


def _key(value: object, label: str) -> str:
    if type(value) is not str or not value or len(value.encode("utf-8")) > 512:
        raise CycleRuntimeError(CycleErrorCode.INVALID_CANDIDATE, f"{label} is invalid")
    for index, character in enumerate(value):
        codepoint = ord(character)
        if 0xD800 <= codepoint <= 0xDFFF:
            raise CycleRuntimeError(
                CycleErrorCode.INVALID_CANDIDATE,
                f"{label} contains a lone surrogate",
                path=f"/{index}",
            )
    return value


@dataclass(frozen=True, slots=True)
class CandidateClassification:
    candidates: tuple[JsonObject, ...]
    fresh_keys: tuple[str, ...]
    duplicate_keys: tuple[str, ...]
    seen_additions: tuple[str, ...]
    canonical_json: str
    sha256: str


def classify_candidates(
    candidates: object,
    *,
    seen_keys: tuple[str, ...] | list[str],
    policy: CycleControllerPolicy,
) -> CandidateClassification:
    """Validate a complete batch before returning any durable seen additions."""

    captured = capture_portable_json(
        candidates,
        error_code=CycleErrorCode.INVALID_CANDIDATE,
    )
    if type(captured) is not list:
        raise CycleRuntimeError(
            CycleErrorCode.INVALID_CANDIDATE,
            "candidate batch must be an array",
        )
    batch = captured
    if len(batch) > policy.max_candidates_per_round:
        raise CycleRuntimeError(
            CycleErrorCode.INVALID_CANDIDATE,
            "candidate batch exceeds maxCandidatesPerRound",
        )
    batch_json = canonical_json(batch)
    if len(batch_json.encode("utf-8")) > policy.max_candidate_batch_bytes:
        raise CycleRuntimeError(
            CycleErrorCode.INVALID_CANDIDATE,
            "candidate batch exceeds maxCandidateBatchBytes",
        )

    detached_seen = set(seen_keys)
    fresh: list[str] = []
    duplicates: list[str] = []
    documents: list[JsonObject] = []
    for index, value in enumerate(batch):
        if type(value) is not dict or set(value) != {"key", "value"}:
            raise CycleRuntimeError(
                CycleErrorCode.INVALID_CANDIDATE,
                "candidate must be a closed key/value object",
                path=f"/{index}",
            )
        document = value
        if len(canonical_json(document).encode("utf-8")) > policy.max_candidate_bytes:
            raise CycleRuntimeError(
                CycleErrorCode.INVALID_CANDIDATE,
                "candidate exceeds maxCandidateBytes",
                path=f"/{index}",
            )
        key = _key(document["key"], f"candidate {index} key")
        documents.append(document)
        if key in detached_seen:
            duplicates.append(key)
        else:
            detached_seen.add(key)
            fresh.append(key)
    if len(seen_keys) + len(fresh) > policy.max_discoveries:
        raise CycleRuntimeError(
            CycleErrorCode.INVALID_CANDIDATE,
            "candidate batch exceeds remaining discovery credit",
        )
    return CandidateClassification(
        candidates=tuple(documents),
        fresh_keys=tuple(fresh),
        duplicate_keys=tuple(duplicates),
        seen_additions=tuple(fresh),
        canonical_json=batch_json,
        sha256=hashlib.sha256(batch_json.encode("utf-8")).hexdigest(),
    )


@dataclass(frozen=True, slots=True)
class HardStopFacts:
    cancelled: bool
    duration_ms: int
    cost_usd: int | float
    attempts_used: int
    dynamic_nodes: int
    seen_count: int
    iterations: int
    duration_observed: bool = False
    cost_reservation_blocked: bool = False
    attempt_reservation_blocked: bool = False
    dynamic_reservation_blocked: bool = False
    patch_rejected: bool = False
    failed: bool = False
    unknown_verdict: bool = False
    convergence_reason: Literal["DRY", "CONDITION_FALSE", "EVALUATOR_ACCEPTED"] | None = None


def select_exit_reason(facts: HardStopFacts, policy: CycleControllerPolicy) -> ExitReason | None:
    """Apply the normative inclusive hard-stop precedence."""

    candidates: tuple[tuple[bool, ExitReason], ...] = (
        (facts.cancelled, "CANCELLED"),
        (
            facts.duration_observed or facts.duration_ms >= policy.max_duration_ms,
            "MAX_DURATION",
        ),
        (
            facts.cost_reservation_blocked
            or (facts.cost_usd > 0 and facts.cost_usd >= policy.max_cost_usd),
            "MAX_COST",
        ),
        (
            facts.attempt_reservation_blocked
            or (facts.attempts_used > 0 and facts.attempts_used >= policy.max_total_attempts),
            "MAX_TOTAL_ATTEMPTS",
        ),
        (
            facts.dynamic_reservation_blocked
            or (facts.dynamic_nodes > 0 and facts.dynamic_nodes >= policy.max_dynamic_nodes),
            "MAX_DYNAMIC_NODES",
        ),
        (
            facts.convergence_reason is None and facts.seen_count >= policy.max_discoveries,
            "MAX_DISCOVERIES",
        ),
        (facts.iterations >= policy.max_iterations, "MAX_ITERATIONS"),
        (facts.patch_rejected, "PATCH_REJECTED"),
        (facts.failed, "FAILED"),
        (facts.unknown_verdict, "UNKNOWN_VERDICT"),
    )
    for observed, reason in candidates:
        if observed:
            return reason
    return facts.convergence_reason


@dataclass(frozen=True, slots=True)
class CycleFold:
    request: ValidatedCycleRequest
    events: tuple[CycleEvent, ...]
    state: JsonObject
    active_lease: JsonObject | None
    current_revision: JsonObject
    terminal: bool
    terminal_result: JsonObject | None
    terminal_observation: JsonObject | None

    @property
    def tail_sequence(self) -> int:
        return len(self.events) - 1

    @property
    def tail_hash(self) -> str:
        return self.events[-1].record_hash


def _budget(value: object, label: str) -> dict[str, int | float]:
    document = _object(value, label)
    if set(document) != set(_BUDGET_FIELDS):
        raise _history_error(f"{label} is not closed", counter=True)
    return {
        "attempts": _integer(document["attempts"], f"{label}.attempts"),
        "costUsd": _cost(document["costUsd"], f"{label}.costUsd"),
        "dynamicNodes": _integer(document["dynamicNodes"], f"{label}.dynamicNodes"),
    }


def _remaining(round_state: dict[str, Any]) -> dict[str, int | float]:
    return {
        field: cast(int | float, round_state["maximum"][field])
        - cast(int | float, round_state["committed"][field])
        - cast(int | float, round_state["released"][field])
        for field in _BUDGET_FIELDS
    }


def _binding(request: ValidatedCycleRequest, phase: str) -> Any:
    activities = request.model.activities
    return {
        "finder": activities.finder,
        "candidate-evaluator": activities.candidate_evaluator,
        "condition": activities.condition,
        "optimizer-evaluator": activities.optimizer_evaluator,
        "patch-planner": activities.patch_planner,
    }.get(phase)


def _plan_entry(plan: dict[str, Any], phase: str) -> dict[str, Any] | None:
    key = {
        "finder": "finder",
        "candidate-evaluator": "candidateEvaluator",
        "condition": "modeActivity",
        "optimizer-evaluator": "modeActivity",
        "patch-planner": "patchPlanner",
    }.get(phase)
    if key is None or plan.get(key) is None:
        return None
    return _object(plan[key], f"round plan {phase}")


def _minimum_required_round_budget(
    request: ValidatedCycleRequest,
) -> tuple[int, int | float]:
    """Return the canonical producer's complete next-round reservation.

    A native v1alpha1 controller reserves every request-bound retry and, when
    patches are enabled, the patch planner plus all remaining dynamic-node
    credit.  A deterministic route may release an unused planner reservation,
    but replay must use the same complete envelope when proving a preflight
    MAX_COST or MAX_TOTAL_ATTEMPTS terminal.
    """

    bindings = [
        request.model.activities.finder,
        request.model.activities.candidate_evaluator,
    ]
    if request.model.policy.mode == "while":
        assert request.model.activities.condition is not None
        bindings.append(request.model.activities.condition)
    elif request.model.policy.mode == "evaluator-optimizer":
        assert request.model.activities.optimizer_evaluator is not None
        bindings.append(request.model.activities.optimizer_evaluator)
    if request.model.patches.enabled:
        assert request.model.activities.patch_planner is not None
        bindings.append(request.model.activities.patch_planner)
    attempts = 0
    cost: int | float = 0
    for binding in bindings:
        attempts += binding.max_attempts_per_round
        phase_cost: int | float = 0
        for _ in range(binding.max_attempts_per_round):
            phase_cost += binding.max_cost_usd_per_attempt
        cost += phase_cost
    return attempts, cost


def _validate_round_plan(
    request: ValidatedCycleRequest,
    plan: dict[str, Any],
    maximum: dict[str, int | float],
    *,
    attempts_used: int,
    cost_usd: int | float,
    dynamic_nodes: int,
) -> None:
    if set(plan) != {
        "finder",
        "candidateEvaluator",
        "modeActivity",
        "patchPlanner",
        "maxDynamicNodes",
    }:
        raise _history_error("round plan is not closed")
    expected_phases = ["finder", "candidate-evaluator"]
    if request.model.policy.mode == "while":
        expected_phases.append("condition")
    elif request.model.policy.mode == "evaluator-optimizer":
        expected_phases.append("optimizer-evaluator")
    if (plan["patchPlanner"] is not None) != request.model.patches.enabled:
        raise _history_error("patch plan contradicts request enablement")
    if plan["patchPlanner"] is not None:
        expected_phases.append("patch-planner")
    elif plan["maxDynamicNodes"] != 0:
        raise _history_error("patch-free plan reserves dynamic nodes")

    expected_attempts = 0
    expected_cost: int | float = 0
    for phase in expected_phases:
        entry = _plan_entry(plan, phase)
        binding = _binding(request, phase)
        if entry is None or binding is None:
            raise _history_error(f"round plan omits {phase}")
        if set(entry) != {"phase", "activityId", "maxAttempts", "maxCostUsd"}:
            raise _history_error(f"round plan {phase} is not closed")
        if entry["phase"] != phase or entry["activityId"] != binding.activity_id:
            raise _history_error(f"round plan {phase} binding drifted")
        attempts = _integer(entry["maxAttempts"], f"{phase} maxAttempts", positive=True)
        if attempts > binding.max_attempts_per_round:
            raise _history_error(f"round plan widens {phase} attempts")
        expected_phase_cost: int | float = 0
        for _ in range(attempts):
            expected_phase_cost = _add_cost(
                expected_phase_cost,
                binding.max_cost_usd_per_attempt,
                f"{phase} planned cost",
            )
        if entry["maxCostUsd"] != expected_phase_cost:
            raise _history_error(f"round plan {phase} cost is not worst case")
        expected_attempts += attempts
        expected_cost = _add_cost(expected_cost, expected_phase_cost, "round cost")

    expected = {
        "attempts": expected_attempts,
        "costUsd": expected_cost,
        "dynamicNodes": _integer(plan["maxDynamicNodes"], "plan maxDynamicNodes"),
    }
    _exact(maximum, expected, "round maximum differs from plan", counter=True)
    policy = request.model.policy
    if (
        attempts_used + expected_attempts > policy.max_total_attempts
        or _add_cost(cost_usd, expected_cost, "reserved cost") > policy.max_cost_usd
        or dynamic_nodes + cast(int, expected["dynamicNodes"]) > policy.max_dynamic_nodes
    ):
        raise _history_error("round reservation exceeds controller policy", counter=True)


def fold_cycle_events(
    values: object,
    *,
    require_terminal: bool = False,
    parent_fold: CycleFold | None = None,
) -> CycleFold:
    """Validate and fold an exact event prefix without external dispatch."""

    if type(values) not in (tuple, list):
        raise _history_error("event history must be an exact sequence")
    raw_events = cast(tuple[object, ...] | list[object], values)
    if not raw_events:
        raise _history_error("event history is empty")
    events = tuple(validate_cycle_event(value) for value in raw_events)
    first_data = events[0].data
    if events[0].type != "ControllerCreated":
        raise _history_error("history does not begin with ControllerCreated")
    request = validate_cycle_request(first_data.get("request"))
    policy = request.model.policy

    lineage = request.model.lineage
    inherited_state: dict[str, Any] | None = None
    if lineage.origin == "fork":
        if parent_fold is None:
            raise _history_error("fork history requires its exact parent prefix")
        if (
            parent_fold.request.model.controller_run_id
            != lineage.parent_controller_run_id
            or parent_fold.tail_sequence != lineage.parent_sequence
            or parent_fold.tail_hash != lineage.parent_history_hash
        ):
            raise _history_error("fork lineage does not bind the supplied parent prefix")
        inherited_state = cast(dict[str, Any], parent_fold.state)
        _exact(
            request.document["initialGraph"],
            parent_fold.current_revision,
            "fork initial revision differs from parent prefix",
        )
    elif parent_fold is not None:
        raise _history_error("start lineage cannot consume a parent prefix")

    active_lease: JsonObject | None = None
    last_lease_id: str | None = None
    max_epoch = 0
    max_fence = 0
    current_revision: JsonObject = cast(
        JsonObject,
        capture_portable_json(
            request.document["initialGraph"]
            if inherited_state is None
            else inherited_state["currentRevision"]
        ),
    )
    next_iteration = (
        1 if inherited_state is None else cast(int, inherited_state["nextIteration"])
    )
    round_state: dict[str, Any] | None = None
    open_activity: dict[str, Any] | None = None
    open_activity_settled = False
    unresolved_failure: dict[str, Any] | None = None
    unresolved_failure_activity: dict[str, Any] | None = None
    attempts_used = (
        0 if inherited_state is None else cast(int, inherited_state["attemptsUsed"])
    )
    cost_usd: int | float = (
        0 if inherited_state is None else cast(int | float, inherited_state["costUsd"])
    )
    dynamic_nodes = (
        0 if inherited_state is None else cast(int, inherited_state["dynamicNodes"])
    )
    duration_ms = (
        0 if inherited_state is None else cast(int, inherited_state["durationMs"])
    )
    consecutive_dry = (
        0
        if inherited_state is None
        else cast(int, inherited_state["consecutiveDryRounds"])
    )
    if inherited_state is not None:
        assert parent_fold is not None
        inherited_open_round = inherited_state.get("openRound")
        if type(inherited_open_round) is dict:
            inherited_iteration = inherited_open_round["iteration"]
            pending_parent_event: CycleEvent | None = None
            for parent_event in reversed(parent_fold.events):
                if parent_event.data.get("iteration") != inherited_iteration:
                    continue
                if parent_event.type == "BudgetReservationSettled":
                    break
                if parent_event.type in {
                    "ActivityFailed",
                    "DiscoveryCommitted",
                    "CandidateEvaluationCommitted",
                    "ModeOutcomeCommitted",
                    "PatchAccepted",
                    "PatchRejected",
                }:
                    pending_parent_event = parent_event
                    break
                if parent_event.type == "ActivityStarted":
                    break
            if pending_parent_event is not None:
                if pending_parent_event.type in {"PatchAccepted", "PatchRejected"}:
                    pending_budget = _budget(
                        _object(
                            pending_parent_event.data["budgetOutcome"],
                            "fork pending patch budget",
                        )["committed"],
                        "fork pending patch committed budget",
                    )
                else:
                    pending_usage = _object(
                        pending_parent_event.data["usage"],
                        "fork pending activity usage",
                    )
                    pending_budget = _budget(
                        {**pending_usage, "dynamicNodes": 0},
                        "fork pending activity budget",
                    )
                attempts_used += cast(int, pending_budget["attempts"])
                cost_usd = _add_cost(
                    cost_usd,
                    pending_budget["costUsd"],
                    "fork pending cost",
                )
                dynamic_nodes += cast(int, pending_budget["dynamicNodes"])
    last_timestamp = None
    started_at = ""
    deadline_at = ""
    terminal = False
    terminal_result: JsonObject | None = None
    terminal_observation: JsonObject | None = None
    terminal_in_doubt: list[JsonObject] = []
    activity_projection_fields = (
        "iteration",
        "reservationId",
        "phase",
        "activityId",
        "activityKey",
        "attempt",
        "sideEffects",
        "inputHash",
    )

    def _upsert_in_doubt(activity_value: object) -> None:
        activity = _object(activity_value, "external in-doubt activity")
        if set(activity) != set(activity_projection_fields):
            raise _history_error("external in-doubt activity projection is not closed")
        if activity["sideEffects"] == "none":
            raise _history_error(
                "side-effect-free activity cannot enter the external in-doubt projection"
            )
        projected = cast(
            JsonObject,
            capture_portable_json(
                {field: activity[field] for field in activity_projection_fields}
            ),
        )
        if not terminal_in_doubt:
            terminal_in_doubt.append(projected)
            return
        current = terminal_in_doubt[0]
        if len(terminal_in_doubt) != 1 or current["activityKey"] != projected["activityKey"]:
            raise _history_error("multiple external in-doubt activity keys are invalid")
        if cast(int, projected["attempt"]) < cast(int, current["attempt"]):
            raise _history_error("external in-doubt activity attempt regressed")
        terminal_in_doubt[0] = projected

    def _resolve_in_doubt(activity_key_value: object) -> None:
        if terminal_in_doubt and terminal_in_doubt[0]["activityKey"] == activity_key_value:
            terminal_in_doubt.clear()

    if inherited_state is not None:
        for inherited_activity in _array(
            inherited_state["inDoubtActivities"],
            "inherited external in-doubt activities",
        ):
            _upsert_in_doubt(inherited_activity)
    if inherited_state is not None:
        assert parent_fold is not None
        inherited_open = inherited_state.get("openRound")
        if type(inherited_open) is dict and type(inherited_open.get("openActivity")) is dict:
            activity = cast(JsonObject, capture_portable_json(inherited_open["openActivity"]))
            if activity["sideEffects"] != "none":
                _upsert_in_doubt(activity)
    committed_rounds: list[JsonObject] = (
        []
        if inherited_state is None
        else cast(
            list[JsonObject],
            capture_portable_json(inherited_state["committedRounds"]),
        )
    )
    last_round: dict[str, Any] | None = (
        None if not committed_rounds else cast(dict[str, Any], committed_rounds[-1])
    )
    seen: list[str] = (
        []
        if inherited_state is None
        else cast(list[str], capture_portable_json(inherited_state["seenKeys"]))
    )
    accepted: list[str] = (
        []
        if inherited_state is None
        else cast(list[str], capture_portable_json(inherited_state["acceptedKeys"]))
    )
    rejected: list[str] = (
        []
        if inherited_state is None
        else cast(list[str], capture_portable_json(inherited_state["rejectedKeys"]))
    )
    unknown: list[str] = (
        []
        if inherited_state is None
        else cast(list[str], capture_portable_json(inherited_state["unknownKeys"]))
    )
    decided_patches: list[JsonObject] = (
        []
        if inherited_state is None
        else cast(
            list[JsonObject],
            capture_portable_json(inherited_state["decidedPatches"]),
        )
    )
    decided_patch_ids: set[str] = {
        cast(str, item["patchId"]) for item in decided_patches
    }
    event_ids: set[str] = set()

    for index, event in enumerate(events):
        if terminal:
            raise _history_error("event follows terminal result")
        data = cast(dict[str, Any], event.data)
        _require_data_shape(event.type, data)
        event_time = parse_timestamp(event.timestamp)
        if last_timestamp is not None and event_time < last_timestamp:
            raise _history_error("event timestamps regress")
        last_timestamp = event_time
        if event.sequence != index or event.expected_previous_sequence != index - 1:
            raise _history_error("event CAS sequence is not contiguous")
        prior_hash = None if index == 0 else events[index - 1].record_hash
        if event.previous_event_hash != prior_hash:
            raise _history_error("event hash chain is discontinuous")
        if event.event_id in event_ids:
            raise _history_error("event ID is duplicated")
        event_ids.add(event.event_id)
        if (
            event.controller_run_id != request.model.controller_run_id
            or event.host_run_id != request.model.host_run.run_id
            or event.controller_hash != request.controller_hash
            or event.request_hash != request.request_hash
        ):
            raise _history_error("controller identity drifted")
        event_lease = (
            None
            if event.lease is None
            else cast(JsonObject, capture_portable_json(event.lease.model_dump(by_alias=True)))
        )
        if index == 0:
            if event.lease is not None:
                raise _history_error("ControllerCreated must be unleased")
        elif event_lease is None:
            raise _history_error("mutation event has no lease")
        elif event.type not in {"LeaseAcquired", "LeaseRenewed"}:
            if active_lease is None:
                raise _history_error("event has no active lease")
            _exact(event_lease, active_lease, "event uses a stale lease")
            if event_time >= parse_timestamp(cast(str, active_lease["expiresAt"])):
                raise _history_error("event uses an expired lease")

        if event.type == "ControllerCreated":
            _exact(data["request"], request.document, "stored request bytes drifted")
            _exact(data["identity"], request.identity, "controller identity body drifted")
            if (
                data["requestHash"] != domain_hash(CYCLE_REQUEST_DOMAIN, data["request"])
                or data["controllerHash"]
                != domain_hash(CYCLE_CONTROLLER_DOMAIN, data["identity"])
                or data["requestHash"] != event.request_hash
                or data["controllerHash"] != event.controller_hash
            ):
                raise _history_error("controller creation hash mismatch")
            _inline_payload(request.document["objective"], "objective", max_bytes=4_194_304)
            started_at = cast(str, data["startedAt"])
            deadline_at = cast(str, data["deadlineAt"])
            if parse_timestamp(deadline_at) - parse_timestamp(started_at) != timedelta(
                milliseconds=policy.max_duration_ms
            ):
                raise _history_error("controller deadline differs from policy")
            if event_time != parse_timestamp(started_at):
                raise _history_error("ControllerCreated timestamp differs from startedAt")

        elif event.type == "LeaseAcquired":
            assert event_lease is not None
            epoch = _integer(event_lease["leaseEpoch"], "lease epoch", positive=True)
            fence = _integer(event_lease["fencingToken"], "fencing token", positive=True)
            if epoch <= max_epoch or fence <= max_fence:
                raise _history_error("lease fence did not advance")
            if parse_timestamp(cast(str, event_lease["expiresAt"])) <= event_time:
                raise _history_error("lease is already expired")
            if max_epoch == 0:
                if data != {"reason": "start", "previousLeaseId": None}:
                    raise _history_error("first lease is not a start lease")
            elif (
                data["reason"] == "start"
                or data["previousLeaseId"] != last_lease_id
                or event_lease["leaseId"] == last_lease_id
            ):
                raise _history_error("reacquired lease does not bind prior lease")
            active_lease = event_lease
            last_lease_id = cast(str, event_lease["leaseId"])
            max_epoch = epoch
            max_fence = fence

        elif event.type == "LeaseRenewed":
            assert event_lease is not None
            if active_lease is None:
                raise _history_error("lease renewal has no active lease")
            for field in ("leaseId", "holderId", "leaseEpoch", "fencingToken", "acquiredAt"):
                if event_lease[field] != active_lease[field]:
                    raise _history_error("lease renewal changed fencing identity")
            if (
                data["previousExpiresAt"] != active_lease["expiresAt"]
                or data["newExpiresAt"] != event_lease["expiresAt"]
                or parse_timestamp(cast(str, event_lease["expiresAt"]))
                <= parse_timestamp(cast(str, active_lease["expiresAt"]))
            ):
                raise _history_error("lease renewal did not extend expiry")
            active_lease = event_lease

        elif event.type == "LeaseReleased":
            if data["reason"] not in {"paused", "handoff"}:
                raise _history_error("lease release reason is invalid")
            active_lease = None

        elif event.type == "RoundReserved":
            if round_state is not None or data["iteration"] != next_iteration:
                raise _history_error("round reservation is not contiguous")
            if next_iteration > policy.max_iterations:
                raise _history_error("round reservation exceeds maxIterations")
            if len(seen) >= policy.max_discoveries:
                raise _history_error("round reservation has no discovery credit")
            if event_time >= parse_timestamp(deadline_at):
                raise _history_error("round reserved at or after deadline")
            _exact(data["currentRevision"], current_revision, "round revision drifted")
            if data["deadlineAt"] != deadline_at:
                raise _history_error("round deadline drifted")
            plan = _object(data["plan"], "round plan")
            if data["planHash"] != round_plan_hash(plan):
                raise _history_error("round plan hash drifted")
            maximum = _budget(data["maximum"], "round maximum")
            _validate_round_plan(
                request,
                plan,
                maximum,
                attempts_used=attempts_used,
                cost_usd=cost_usd,
                dynamic_nodes=dynamic_nodes,
            )
            round_state = {
                "iteration": next_iteration,
                "plan": plan,
                "planHash": data["planHash"],
                "reservationId": data["reservationId"],
                "maximum": maximum,
                "committed": {field: 0 for field in _BUDGET_FIELDS},
                "released": {field: 0 for field in _BUDGET_FIELDS},
                "attemptsByPhase": {},
                "keysByPhase": {},
                "pendingSettlement": None,
                "pendingPhase": None,
                "discovery": None,
                "evaluation": None,
                "modeOutcome": None,
                "patchDecision": None,
                "closingRelease": None,
            }
            next_iteration += 1

        elif event.type == "ActivityStarted":
            if (
                round_state is None
                or open_activity is not None
                or round_state["pendingSettlement"] is not None
            ):
                raise _history_error("activity starts outside a ready round")
            if round_state["closingRelease"] is not None:
                raise _history_error("activity starts after a closing release")
            phase = cast(str, data["phase"])
            if phase not in _PHASES or data["iteration"] != round_state["iteration"]:
                raise _history_error("activity phase or iteration is invalid")
            allowed = (
                (phase == "finder" and round_state["discovery"] is None)
                or (
                    phase == "candidate-evaluator"
                    and round_state["discovery"] is not None
                    and round_state["evaluation"] is None
                )
                or (
                    phase == "condition"
                    and policy.mode == "while"
                    and round_state["evaluation"] is not None
                    and round_state["modeOutcome"] is None
                )
                or (
                    phase == "optimizer-evaluator"
                    and policy.mode == "evaluator-optimizer"
                    and round_state["evaluation"] is not None
                    and round_state["modeOutcome"] is None
                )
                or (
                    phase == "patch-planner"
                    and round_state["modeOutcome"] is not None
                    and round_state["patchDecision"] is None
                )
            )
            if not allowed or data["reservationId"] != round_state["reservationId"]:
                raise _history_error("activity phase is not ready")
            binding = _binding(request, phase)
            planned = _plan_entry(round_state["plan"], phase)
            if (
                binding is None
                or planned is None
                or data["activityId"] != binding.activity_id
                or data["sideEffects"] != binding.side_effects
                or planned["activityId"] != binding.activity_id
            ):
                raise _history_error("activity start is detached from request plan")
            attempt = _integer(data["attempt"], "activity attempt", positive=True)
            prior_attempt = cast(dict[str, int], round_state["attemptsByPhase"]).get(phase, 0)
            if attempt != prior_attempt + 1 or attempt > planned["maxAttempts"]:
                raise _history_error("activity attempt is not contiguous")
            expected_key = activity_key(
                controller_run_id=event.controller_run_id,
                controller_hash=event.controller_hash,
                iteration=round_state["iteration"],
                phase=phase,
                activity_id=binding.activity_id,
                input_hash=cast(str, data["inputHash"]),
            )
            if data["activityKey"] != expected_key:
                raise _history_error("activity key preimage drifted")
            prior_key = cast(dict[str, str], round_state["keysByPhase"]).get(phase)
            if prior_key is not None and prior_key != expected_key:
                raise _history_error("activity retry changed key")
            if unresolved_failure is not None:
                if not unresolved_failure["retryable"]:
                    raise _history_error("non-retryable activity failure was retried")
                if (
                    unresolved_failure["inDoubt"]
                    and unresolved_failure_activity is not None
                    and unresolved_failure_activity["sideEffects"] == "non-idempotent"
                ):
                    raise CycleRuntimeError(
                        CycleErrorCode.IN_DOUBT_SIDE_EFFECT,
                        "in-doubt non-idempotent activity cannot retry",
                    )
            cast(dict[str, int], round_state["attemptsByPhase"])[phase] = attempt
            cast(dict[str, str], round_state["keysByPhase"])[phase] = expected_key
            open_activity = dict(data)
            open_activity_settled = False
            unresolved_failure = None
            unresolved_failure_activity = None

        elif event.type == "ActivityFailed":
            if (
                round_state is None
                or open_activity is None
                or data["iteration"] != round_state["iteration"]
                or data["activityKey"] != open_activity["activityKey"]
                or data["attempt"] != open_activity["attempt"]
            ):
                raise _history_error("activity failure has no matching claim")
            failure = _object(data["failure"], "activity failure")
            if set(failure) != {"phase", "code", "retryable", "inDoubt"}:
                raise _history_error("activity failure is not closed")
            phase = cast(str, open_activity["phase"])
            binding = _binding(request, phase)
            if (
                failure["phase"] != phase
                or type(failure["code"]) is not str
                or re.fullmatch(r"GE_[A-Z0-9_]{3,64}", cast(str, failure["code"])) is None
                or type(failure["retryable"]) is not bool
                or type(failure["inDoubt"]) is not bool
                or binding is None
                or (
                    binding.side_effects == "non-idempotent"
                    and failure["inDoubt"] is not True
                )
                or (
                    binding.side_effects == "none"
                    and failure["inDoubt"] is not False
                )
            ):
                raise _history_error("activity failure is malformed")
            usage = _budget(
                {**_object(data["usage"], "failure usage"), "dynamicNodes": 0},
                "failure usage",
            )
            if (
                usage["attempts"] != 1
                or cast(int | float, usage["costUsd"]) > binding.max_cost_usd_per_attempt
            ):
                raise _history_error("activity failure usage exceeds its claim", counter=True)
            unresolved_failure_activity = dict(open_activity)
            unresolved_failure = failure
            round_state["pendingSettlement"] = usage
            round_state["pendingPhase"] = open_activity["phase"]
            if failure["inDoubt"] is True:
                _upsert_in_doubt(open_activity)
            open_activity = None
            open_activity_settled = False

        elif event.type == "DiscoveryCommitted":
            if (
                round_state is None
                or open_activity is None
                or open_activity["phase"] != "finder"
                or data["activityKey"] != open_activity["activityKey"]
                or data["iteration"] != round_state["iteration"]
            ):
                raise _history_error("discovery has no matching finder")
            candidates = _inline_payload(
                data["candidateBatch"],
                "candidate batch",
                max_bytes=policy.max_candidate_batch_bytes,
            )
            classification = classify_candidates(candidates, seen_keys=seen, policy=policy)
            if data["candidateBatchHash"] != classification.sha256:
                raise _history_error("candidate batch hash drifted")
            if data["candidateCount"] != len(classification.candidates):
                raise _history_error("candidate count drifted")
            _exact(data["freshKeys"], list(classification.fresh_keys), "fresh keys drifted")
            _exact(
                data["duplicateKeys"],
                list(classification.duplicate_keys),
                "duplicate keys drifted",
            )
            _exact(
                data["seenAdditions"],
                list(classification.seen_additions),
                "seen additions drifted",
            )
            seen.extend(classification.seen_additions)
            new_duration = _integer(data["durationMs"], "discovery duration")
            if new_duration < duration_ms:
                raise _history_error("discovery duration regressed", counter=True)
            duration_ms = new_duration
            usage_raw = _object(data["usage"], "discovery usage")
            usage = _budget({**usage_raw, "dynamicNodes": 0}, "discovery usage")
            if usage["attempts"] != 1:
                raise _history_error("finder usage must claim one attempt", counter=True)
            round_state["discovery"] = dict(data)
            round_state["pendingSettlement"] = usage
            round_state["pendingPhase"] = "finder"
            _resolve_in_doubt(open_activity["activityKey"])
            open_activity = None
            open_activity_settled = False
            unresolved_failure = None
            unresolved_failure_activity = None

        elif event.type == "CandidateEvaluationCommitted":
            if (
                round_state is None
                or round_state["discovery"] is None
                or open_activity is None
                or open_activity["phase"] != "candidate-evaluator"
                or data["activityKey"] != open_activity["activityKey"]
            ):
                raise _history_error("evaluation has no matching claim")
            verdicts = _array(data["verdicts"], "verdicts")
            fresh_keys = cast(dict[str, Any], round_state["discovery"])["freshKeys"]
            verdict_keys: list[str] = []
            partitions: dict[str, list[str]] = {"accept": [], "reject": [], "unknown": []}
            for verdict_value in verdicts:
                verdict = _object(verdict_value, "verdict")
                if set(verdict) != {"key", "verdict"} or verdict["verdict"] not in partitions:
                    raise _history_error("verdict is invalid")
                key = _key(verdict["key"], "verdict key")
                verdict_keys.append(key)
                partitions[cast(str, verdict["verdict"])].append(key)
            _exact(verdict_keys, fresh_keys, "verdicts do not cover fresh keys")
            _exact(data["acceptedKeys"], partitions["accept"], "accepted keys drifted")
            _exact(data["rejectedKeys"], partitions["reject"], "rejected keys drifted")
            _exact(data["unknownKeys"], partitions["unknown"], "unknown keys drifted")
            accepted.extend(partitions["accept"])
            rejected.extend(partitions["reject"])
            unknown.extend(partitions["unknown"])
            new_duration = _integer(data["durationMs"], "evaluation duration")
            if new_duration < duration_ms:
                raise _history_error("evaluation duration regressed", counter=True)
            duration_ms = new_duration
            usage_raw = _object(data["usage"], "evaluation usage")
            usage = _budget({**usage_raw, "dynamicNodes": 0}, "evaluation usage")
            if usage["attempts"] != 1:
                raise _history_error("evaluation usage must claim one attempt", counter=True)
            round_state["evaluation"] = dict(data)
            round_state["pendingSettlement"] = usage
            round_state["pendingPhase"] = "candidate-evaluator"
            _resolve_in_doubt(open_activity["activityKey"])
            open_activity = None
            open_activity_settled = False

        elif event.type == "ModeOutcomeCommitted":
            if (
                round_state is None
                or round_state["evaluation"] is None
                or round_state["modeOutcome"] is not None
                or round_state["pendingSettlement"] is not None
            ):
                raise _history_error("mode outcome is out of phase")
            outcome = _object(data["outcome"], "mode outcome")
            if outcome.get("mode") != policy.mode:
                raise _history_error("mode outcome changed controller mode")
            usage_raw = _object(data["usage"], "mode usage")
            if policy.mode == "until-dry":
                if data["activityKey"] is not None or usage_raw != {"attempts": 0, "costUsd": 0}:
                    raise _history_error("until-dry claimed mode activity usage")
            else:
                expected_phase = "condition" if policy.mode == "while" else "optimizer-evaluator"
                if (
                    open_activity is None
                    or open_activity["phase"] != expected_phase
                    or data["activityKey"] != open_activity["activityKey"]
                ):
                    raise _history_error("mode outcome has no matching activity")
                usage = _budget({**usage_raw, "dynamicNodes": 0}, "mode usage")
                if usage["attempts"] != 1:
                    raise _history_error("mode usage must claim one attempt", counter=True)
                round_state["pendingSettlement"] = usage
                round_state["pendingPhase"] = expected_phase
                _resolve_in_doubt(open_activity["activityKey"])
                open_activity = None
                open_activity_settled = False
            new_duration = _integer(data["durationMs"], "mode duration")
            if new_duration < duration_ms:
                raise _history_error("mode duration regressed", counter=True)
            duration_ms = new_duration
            round_state["modeOutcome"] = outcome

        elif event.type in {"PatchAccepted", "PatchRejected"}:
            if (
                round_state is None
                or open_activity is None
                or open_activity["phase"] != "patch-planner"
                or data["plannerActivityKey"] != open_activity["activityKey"]
                or _object(data["authoritySnapshot"], "authority snapshot").get(
                    "proposerActivityKey"
                )
                != open_activity["activityKey"]
                or round_state["patchDecision"] is not None
            ):
                raise _history_error("patch decision is out of phase")
            patch_document = _inline_payload(data["patch"], "patch", max_bytes=4_194_304)
            if type(patch_document) is not dict:
                raise _history_error("stored patch is not an object")
            try:
                patch_document_object, validated_patch_id, computed_patch_hash = (
                    validate_graph_patch_shape(patch_document)
                )
            except CycleRuntimeError as exc:
                raise _history_error("stored patch violates the GraphPatch schema") from exc
            if (
                data["patchHash"] != computed_patch_hash
                or _object(data["patch"], "patch")["sha256"] != computed_patch_hash
                or data["patchId"] != validated_patch_id
                or cast(str, data["patchId"]) in decided_patch_ids
            ):
                raise _history_error("stored patch identity is invalid")
            _exact(
                patch_document_object.get("base"),
                data["requestedBase"],
                "patch bytes base drifted",
            )
            stale_rejection = (
                event.type == "PatchRejected"
                and data.get("errorCode") == CycleErrorCode.PATCH_STALE_BASE.value
            )
            if stale_rejection:
                if canonical_json(data["requestedBase"]) == canonical_json(current_revision):
                    raise _history_error("stale-base rejection used the current revision")
            else:
                _exact(data["requestedBase"], current_revision, "patch base drifted")
            budget = _object(data["budgetOutcome"], "patch budget")
            if set(budget) != {"reservationId", "requested", "committed", "released"}:
                raise _history_error("patch budget is not closed", counter=True)
            requested = _budget(budget["requested"], "patch requested")
            committed = _budget(budget["committed"], "patch committed")
            released = _budget(budget["released"], "patch released")
            for field in _BUDGET_FIELDS:
                if requested[field] != committed[field] + released[field]:
                    raise _history_error("patch budget does not reconcile", counter=True)
                if requested[field] > _remaining(round_state)[field]:
                    raise _history_error("patch budget exceeds reservation", counter=True)
            accepted_outcome = event.type == "PatchAccepted"
            append = _object(patch_document_object["append"], "append")
            appended_nodes = len(_array(append["nodes"], "nodes"))
            if committed["dynamicNodes"] != (appended_nodes if accepted_outcome else 0):
                raise _history_error("patch node accounting drifted", counter=True)
            round_state["pendingSettlement"] = committed
            round_state["pendingPhase"] = "patch-planner"
            new_duration = _integer(data["decidedAtDurationMs"], "patch duration")
            if new_duration < duration_ms:
                raise _history_error("patch duration regressed", counter=True)
            duration_ms = new_duration
            patch_id = cast(str, data["patchId"])
            decided_patch_ids.add(patch_id)
            if accepted_outcome:
                if data["outcome"] != "accepted" or data["diagnostics"] != []:
                    raise _history_error("accepted patch decision shape drifted")
                revision = _object(data["resultingRevision"], "resulting revision")
                body = _object(revision["body"], "revision body")
                if (
                    body["graphRevision"] != cast(int, current_revision["graphRevision"]) + 1
                    or body["previousRevisionHash"] != current_revision["revisionHash"]
                    or body["patchHash"] != computed_patch_hash
                    or revision.get("revisionHash") != revision_hash(body)
                ):
                    raise _history_error("accepted revision chain is invalid")
                current_revision = {
                    "graphRevision": cast(JsonValue, body["graphRevision"]),
                    "graphHash": cast(JsonValue, body["graphHash"]),
                    "revisionHash": cast(JsonValue, revision["revisionHash"]),
                }
                decision: JsonObject = {
                    "patchId": patch_id,
                    "patchHash": computed_patch_hash,
                    "outcome": "accepted",
                    "requestedBase": cast(JsonValue, data["requestedBase"]),
                    "resultingRevision": current_revision,
                }
            else:
                if data["outcome"] != "rejected" or not data["diagnostics"]:
                    raise _history_error("rejected patch decision shape drifted")
                decision = {
                    "patchId": patch_id,
                    "patchHash": computed_patch_hash,
                    "outcome": "rejected",
                    "requestedBase": cast(JsonValue, data["requestedBase"]),
                    "errorCode": cast(JsonValue, data["errorCode"]),
                }
            round_state["patchDecision"] = decision
            decided_patches.append(
                {
                    "patchId": patch_id,
                    "patchHash": computed_patch_hash,
                    "outcome": "accepted" if accepted_outcome else "rejected",
                    "decisionSequence": event.sequence,
                }
            )
            _resolve_in_doubt(open_activity["activityKey"])
            open_activity = None
            open_activity_settled = False

        elif event.type == "BudgetReservationSettled":
            if (
                round_state is None
                or data["iteration"] != round_state["iteration"]
                or data["reservationId"] != round_state["reservationId"]
            ):
                raise _history_error("budget settlement has no reservation")
            expected = round_state["pendingSettlement"]
            settlement_phase = round_state["pendingPhase"]
            if expected is None and open_activity is not None and not open_activity_settled:
                binding = _binding(request, cast(str, open_activity["phase"]))
                if binding is None:
                    raise _history_error("open activity binding disappeared")
                expected = {
                    "attempts": 1,
                    "costUsd": binding.max_cost_usd_per_attempt,
                    "dynamicNodes": 0,
                }
                settlement_phase = open_activity["phase"]
                open_activity_settled = True
            committed = _budget(data["committed"], "settlement")
            if expected is None or data["phase"] != settlement_phase:
                raise _history_error("budget settlement is detached from activity")
            _exact(committed, expected, "settlement differs from usage", counter=True)
            for field in _BUDGET_FIELDS:
                round_state["committed"][field] += committed[field]
                if round_state["committed"][field] > round_state["maximum"][field]:
                    raise _history_error("reservation over-settled", counter=True)
            attempts_used += cast(int, committed["attempts"])
            cost_usd = _add_cost(cost_usd, committed["costUsd"], "committed cost")
            dynamic_nodes += cast(int, committed["dynamicNodes"])
            round_state["pendingSettlement"] = None
            round_state["pendingPhase"] = None
            expected_totals = {
                "attemptsCommitted": attempts_used,
                "costUsdCommitted": cost_usd,
                "dynamicNodesCommitted": dynamic_nodes,
                "liveReservations": _remaining(round_state),
            }
            _exact(data["totals"], expected_totals, "settlement totals drifted", counter=True)

        elif event.type == "BudgetReservationReleased":
            if (
                round_state is None
                or data["iteration"] != round_state["iteration"]
                or data["reservationId"] != round_state["reservationId"]
                or round_state["pendingSettlement"] is not None
            ):
                raise _history_error("budget release has no settled reservation")
            released_budget = _budget(data["released"], "release")
            if all(released_budget[field] == 0 for field in _BUDGET_FIELDS):
                raise _history_error("budget release is a no-op", counter=True)
            before = _remaining(round_state)
            reason = data["reason"]
            if reason != "phase-complete":
                _exact(released_budget, before, "closing release is not exact", counter=True)
                if round_state["closingRelease"] is not None:
                    raise _history_error("round has multiple closing releases")
                round_state["closingRelease"] = reason
            for field in _BUDGET_FIELDS:
                round_state["released"][field] += released_budget[field]
            expected_remaining = _remaining(round_state)
            _exact(data["remaining"], expected_remaining, "release remainder drifted", counter=True)
            expected_totals = {
                "attemptsCommitted": attempts_used,
                "costUsdCommitted": cost_usd,
                "dynamicNodesCommitted": dynamic_nodes,
                "liveReservations": expected_remaining,
            }
            _exact(data["totals"], expected_totals, "release totals drifted", counter=True)

        elif event.type == "RoundCommitted":
            if (
                round_state is None
                or open_activity is not None
                or round_state["pendingSettlement"] is not None
                or unresolved_failure is not None
                or round_state["discovery"] is None
                or round_state["evaluation"] is None
                or round_state["modeOutcome"] is None
                or any(value != 0 for value in _remaining(round_state).values())
            ):
                raise _history_error("round commits before phases settle")
            record = _object(data["record"], "round record")
            discovery = cast(dict[str, Any], round_state["discovery"])
            evaluation = cast(dict[str, Any], round_state["evaluation"])
            expected_dry = (
                consecutive_dry + 1
                if policy.mode == "until-dry" and not discovery["freshKeys"]
                else 0
            )
            expected_record: JsonObject = {
                "iteration": cast(JsonValue, round_state["iteration"]),
                "candidateBatchHash": cast(JsonValue, discovery["candidateBatchHash"]),
                "candidateCount": cast(JsonValue, discovery["candidateCount"]),
                "freshKeys": cast(JsonValue, discovery["freshKeys"]),
                "duplicateKeys": cast(JsonValue, discovery["duplicateKeys"]),
                "acceptedKeys": cast(JsonValue, evaluation["acceptedKeys"]),
                "rejectedKeys": cast(JsonValue, evaluation["rejectedKeys"]),
                "unknownKeys": cast(JsonValue, evaluation["unknownKeys"]),
                "modeOutcome": cast(JsonValue, round_state["modeOutcome"]),
                "patchDecision": cast(JsonValue, round_state["patchDecision"]),
                "consecutiveDryRounds": expected_dry,
                "attemptsUsed": attempts_used,
                "costUsd": cost_usd,
                "dynamicNodes": dynamic_nodes,
                "durationMs": duration_ms,
                "currentRevision": current_revision,
            }
            _exact(record, expected_record, "round record drifted", counter=True)
            consecutive_dry = expected_dry
            committed_record = cast(JsonObject, capture_portable_json(record))
            committed_rounds.append(committed_record)
            last_round = record
            round_state = None

        elif event.type == "ControllerTerminated":
            if round_state is not None and (
                round_state["pendingSettlement"] is not None
                or any(value != 0 for value in _remaining(round_state).values())
            ):
                raise _history_error("terminal event leaves live reservation", counter=True)
            result = _object(data["result"], "terminal result")
            observation = _object(data["observation"], "exit observation")
            unevaluated = [
                key
                for key in seen
                if key not in set(accepted) | set(rejected) | set(unknown)
            ]
            convergence: Literal["DRY", "CONDITION_FALSE", "EVALUATOR_ACCEPTED"] | None = None
            unknown_verdict = False
            if last_round is not None:
                mode_outcome = _object(last_round["modeOutcome"], "last mode outcome")
                if policy.mode == "until-dry" and consecutive_dry >= cast(
                    int, policy.consecutive_dry_rounds
                ):
                    convergence = "DRY"
                elif policy.mode == "while" and mode_outcome.get("condition") is False:
                    convergence = "CONDITION_FALSE"
                elif policy.mode == "evaluator-optimizer":
                    if mode_outcome.get("verdict") == "accept":
                        convergence = "EVALUATOR_ACCEPTED"
                    elif mode_outcome.get("verdict") == "unknown":
                        unknown_verdict = True
            patch_rejected = (
                round_state is not None
                and isinstance(round_state.get("patchDecision"), dict)
                and round_state["patchDecision"].get("outcome") == "rejected"
            )
            failed = unresolved_failure is not None or observation.get("failed") is True
            failure_code = (
                unresolved_failure.get("code")
                if unresolved_failure is not None
                else observation.get("failureCode")
            )
            naturally_duration_limited = duration_ms >= policy.max_duration_ms
            naturally_cost_limited = cost_usd > 0 and cost_usd >= policy.max_cost_usd
            naturally_attempt_limited = (
                attempts_used > 0 and attempts_used >= policy.max_total_attempts
            )
            naturally_dynamic_limited = (
                dynamic_nodes > 0 and dynamic_nodes >= policy.max_dynamic_nodes
            )
            naturally_discovery_limited = (
                convergence is None and len(seen) >= policy.max_discoveries
            )
            naturally_iteration_limited = next_iteration - 1 >= policy.max_iterations
            may_need_another_round = not any(
                (
                    observation.get("cancelled") is True,
                    naturally_duration_limited,
                    naturally_cost_limited,
                    naturally_attempt_limited,
                    naturally_dynamic_limited,
                    naturally_discovery_limited,
                    naturally_iteration_limited,
                    patch_rejected,
                    failed,
                    unknown_verdict,
                    convergence is not None,
                )
            )
            minimum_attempts, minimum_cost = _minimum_required_round_budget(request)
            attempt_reservation_blocked = may_need_another_round and (
                attempts_used + minimum_attempts > policy.max_total_attempts
            )
            cost_reservation_blocked = may_need_another_round and (
                _add_cost(cost_usd, minimum_cost, "next round minimum cost")
                > policy.max_cost_usd
            )
            # A terminal timestamp may supply the first deadline observation;
            # no earlier activity outcome exists in that case.  It cannot be
            # forged because the event timestamp is in the validated chain.
            terminal_elapsed = _integer(
                int((event_time - parse_timestamp(started_at)).total_seconds() * 1000),
                "terminal elapsed duration",
            )
            duration_observed = terminal_elapsed >= policy.max_duration_ms
            facts = HardStopFacts(
                cancelled=observation.get("cancelled") is True,
                duration_ms=duration_ms,
                cost_usd=cost_usd,
                attempts_used=attempts_used,
                dynamic_nodes=dynamic_nodes,
                seen_count=len(seen),
                iterations=next_iteration - 1,
                duration_observed=duration_observed,
                cost_reservation_blocked=cost_reservation_blocked,
                attempt_reservation_blocked=attempt_reservation_blocked,
                patch_rejected=patch_rejected,
                failed=failed,
                unknown_verdict=unknown_verdict,
                convergence_reason=convergence,
            )
            selected = select_exit_reason(facts, policy)
            expected_observation: JsonObject = {
                "cancelled": facts.cancelled,
                "maxDuration": facts.duration_observed or naturally_duration_limited,
                "maxCost": facts.cost_reservation_blocked or naturally_cost_limited,
                "maxTotalAttempts": facts.attempt_reservation_blocked
                or naturally_attempt_limited,
                "maxDynamicNodes": naturally_dynamic_limited,
                "maxDiscoveries": naturally_discovery_limited,
                "maxIterations": naturally_iteration_limited,
                "patchRejected": patch_rejected,
                "failed": failed,
                "failureCode": cast(JsonValue, failure_code),
                "unknownVerdict": unknown_verdict,
                "convergenceReason": cast(JsonValue, convergence),
            }
            _exact(observation, expected_observation, "terminal observation drifted")
            if selected is None or result.get("exitReason") != selected:
                raise _history_error("terminal result violates exit precedence")
            expected_result_values = {
                "controllerRunId": event.controller_run_id,
                "controllerHash": event.controller_hash,
                "requestHash": event.request_hash,
                "mode": policy.mode,
                "iterations": next_iteration - 1,
                "consecutiveDryRounds": consecutive_dry,
                "seenCount": len(seen),
                "acceptedCount": len(accepted),
                "rejectedCount": len(rejected),
                "unknownCount": len(unknown),
                "unevaluatedCount": len(unevaluated),
                "attemptsUsed": attempts_used,
                "costUsd": cost_usd,
                "dynamicNodes": dynamic_nodes,
                "durationMs": duration_ms,
                "lastGraphRevision": current_revision["graphRevision"],
                "lastGraphHash": current_revision["graphHash"],
                "lastRevisionHash": current_revision["revisionHash"],
                "terminalSequence": event.sequence,
                "historyPrefixHash": event.previous_event_hash,
            }
            if any(result.get(key) != value for key, value in expected_result_values.items()):
                raise _history_error("terminal projection differs from fold", counter=True)
            if open_activity is not None and open_activity["sideEffects"] != "none":
                _upsert_in_doubt(open_activity)
            terminal = True
            terminal_result = cast(JsonObject, capture_portable_json(result))
            terminal_observation = cast(JsonObject, capture_portable_json(observation))
            active_lease = None
            round_state = None
            open_activity = None

        if event.graph_revision != current_revision["graphRevision"]:
            raise _history_error("event graph revision differs from folded revision")

    if require_terminal and not terminal:
        raise _history_error("history is not terminal")

    unevaluated_keys = [
        key for key in seen if key not in set(accepted) | set(rejected) | set(unknown)
    ]
    open_round: JsonValue = None
    live_reservations: list[JsonObject] = []
    if round_state is not None:
        phase = "reserved"
        if unresolved_failure is not None:
            phase = "failed"
        elif open_activity is not None:
            phase = "running"
        elif round_state["patchDecision"] is not None:
            phase = "patch-decided"
        elif round_state["modeOutcome"] is not None:
            phase = "mode-decided"
        elif round_state["evaluation"] is not None:
            phase = "evaluated"
        elif round_state["discovery"] is not None:
            phase = "discovered"
        discovery_projection = None
        if round_state["discovery"] is not None:
            discovery = cast(dict[str, Any], round_state["discovery"])
            discovery_projection = {
                key: discovery[key]
                for key in (
                    "candidateBatchHash",
                    "candidateCount",
                    "freshKeys",
                    "duplicateKeys",
                    "seenAdditions",
                )
            }
        evaluation_projection = None
        if round_state["evaluation"] is not None:
            evaluation = cast(dict[str, Any], round_state["evaluation"])
            evaluation_projection = {
                key: evaluation[key]
                for key in ("acceptedKeys", "rejectedKeys", "unknownKeys")
            }
        open_round = capture_portable_json(
            {
                "iteration": round_state["iteration"],
                "phase": phase,
                "plan": round_state["plan"],
                "planHash": round_state["planHash"],
                "reservationId": round_state["reservationId"],
                "openActivity": open_activity,
                "discovery": discovery_projection,
                "evaluation": evaluation_projection,
                "modeOutcome": round_state["modeOutcome"],
                "patchDecision": round_state["patchDecision"],
            }
        )
        live_reservations.append(
            cast(
                JsonObject,
                capture_portable_json(
                    {
                        "reservationId": round_state["reservationId"],
                        "iteration": round_state["iteration"],
                        "maximum": round_state["maximum"],
                        "committed": round_state["committed"],
                        "released": round_state["released"],
                        "remaining": _remaining(round_state),
                    }
                ),
            )
        )

    state: dict[str, object] = {
        "contractVersion": "cycle-controller-recovery/v1alpha1",
        "request": request.document,
        "requestHash": request.request_hash,
        "controllerHash": request.controller_hash,
        "startedAt": started_at,
        "deadlineAt": deadline_at,
        "currentRevision": current_revision,
        "status": "terminal" if terminal else "active",
        "nextIteration": next_iteration,
        "seenKeys": seen,
        "acceptedKeys": accepted,
        "rejectedKeys": rejected,
        "unknownKeys": unknown,
        "unevaluatedKeys": unevaluated_keys,
        "consecutiveDryRounds": consecutive_dry,
        "attemptsUsed": attempts_used,
        "costUsd": cost_usd,
        "dynamicNodes": dynamic_nodes,
        "durationMs": duration_ms,
        "liveReservations": live_reservations,
        "inDoubtActivities": terminal_in_doubt,
        "decidedPatches": decided_patches,
        "committedRounds": committed_rounds,
        "openRound": open_round,
        "terminalObservation": terminal_observation,
        "terminalResult": terminal_result,
    }
    detached_state = capture_portable_json(state)
    if type(detached_state) is not dict:  # pragma: no cover - construction invariant
        raise _history_error("fold state is not an object")
    return CycleFold(
        request=request,
        events=events,
        state=detached_state,
        active_lease=active_lease,
        current_revision=current_revision,
        terminal=terminal,
        terminal_result=terminal_result,
        terminal_observation=terminal_observation,
    )


def build_checkpoint(
    fold: CycleFold,
    *,
    checkpoint_id: str,
    created_at: str,
) -> JsonObject:
    """Create a content-hashed cache over one already validated event prefix."""

    body: JsonObject = {
        "apiVersion": "graphengineering.reacher-z.github.io/cycle-controller-checkpoints/v1alpha1",
        "kind": "CycleControllerCheckpoint",
        "controllerRunId": fold.request.model.controller_run_id,
        "hostRunId": fold.request.model.host_run.run_id,
        "eventStreamId": fold.request.model.event_stream_id,
        "checkpointId": checkpoint_id,
        "lastSequence": fold.tail_sequence,
        "historyPrefixHash": fold.tail_hash,
        "controllerHash": fold.request.controller_hash,
        "requestHash": fold.request.request_hash,
        "graphRevision": fold.current_revision["graphRevision"],
        "createdAt": created_at,
        "lease": fold.active_lease,
        "payloadDisposition": "inline-unredacted",
        "redacted": False,
        "state": fold.state,
    }
    content_hash = hashlib.sha256(canonical_json(body).encode("utf-8")).hexdigest()
    return {**body, "contentHash": content_hash}


def validate_checkpoint(
    checkpoint: object,
    events: object,
    *,
    parent_fold: CycleFold | None = None,
) -> CycleFold:
    """Refold the named full prefix and compare the complete checkpoint projection."""

    captured = capture_portable_json(
        checkpoint,
        error_code=CycleErrorCode.INVALID_HISTORY,
    )
    if type(captured) is not dict:
        raise _history_error("checkpoint must be an object")
    document = captured
    required = {
        "apiVersion",
        "kind",
        "controllerRunId",
        "hostRunId",
        "eventStreamId",
        "checkpointId",
        "lastSequence",
        "historyPrefixHash",
        "controllerHash",
        "requestHash",
        "graphRevision",
        "createdAt",
        "lease",
        "payloadDisposition",
        "redacted",
        "state",
        "contentHash",
    }
    if set(document) != required:
        raise _history_error("checkpoint envelope is not closed")
    body = dict(document)
    content_hash = body.pop("contentHash")
    if content_hash != hashlib.sha256(canonical_json(body).encode("utf-8")).hexdigest():
        raise _history_error("checkpoint content hash drifted")
    last_sequence = _integer(document["lastSequence"], "checkpoint lastSequence")
    if type(events) not in (tuple, list):
        raise _history_error("checkpoint event history must be an exact sequence")
    event_sequence = cast(tuple[object, ...] | list[object], events)
    if last_sequence >= len(event_sequence):
        raise _history_error("checkpoint is ahead of event tail")
    prefix = event_sequence[: last_sequence + 1]
    fold = fold_cycle_events(prefix, parent_fold=parent_fold)
    expected = build_checkpoint(
        fold,
        checkpoint_id=cast(str, document["checkpointId"]),
        created_at=cast(str, document["createdAt"]),
    )
    _exact(document, expected, "checkpoint differs from complete prefix fold")
    return fold


__all__ = [
    "CandidateClassification",
    "CycleFold",
    "ExitReason",
    "HardStopFacts",
    "build_checkpoint",
    "classify_candidates",
    "fold_cycle_events",
    "select_exit_reason",
    "validate_checkpoint",
]
