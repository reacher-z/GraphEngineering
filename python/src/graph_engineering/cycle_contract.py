"""Closed D7 cycle-controller wire models and portable capture helpers.

The D7 carrier is deliberately separate from :mod:`graph_engineering.models`.
Ordinary Graph IR stays acyclic; only this standalone, versioned request can
authorize bounded repetition or a dynamic graph patch.

Every public validation function snapshots exact built-in containers before
Pydantic sees a value.  This is important: accepting an arbitrary ``Mapping``
would let validation execute caller-controlled ``__iter__``/``__getitem__``
code before the controller has established a durable activity boundary.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from types import MappingProxyType
from typing import Annotated, Literal, TypeAlias, cast

from pydantic import ConfigDict, Field, ValidationError, field_validator, model_validator

from .canonical import canonical_json
from .models import MAX_SAFE_INTEGER, JsonObject, JsonValue, StrictModel

CYCLE_REQUEST_DOMAIN = "graph-engineering/cycle-controller-request/v1alpha1\0"
CYCLE_CONTROLLER_DOMAIN = "graph-engineering/cycle-controller/v1alpha1\0"
CYCLE_EVENT_DOMAIN = "graph-engineering/cycle-event/v1alpha1\0"
CYCLE_ACTIVITY_DOMAIN = "graph-engineering/cycle-activity/v1alpha1\0"
CYCLE_ROUND_PLAN_DOMAIN = "graph-engineering/cycle-round-plan/v1alpha1\0"
REVISION_DOMAIN = "graph-engineering/revision-chain/v1alpha1\0"

MAX_CAPTURE_DEPTH = 100
MAX_CAPTURE_VALUES = 100_000
MAX_PATCH_BYTES = 4_194_304
MAX_CANDIDATE_BATCH_BYTES = 16_777_216
MAX_TIMER_MILLISECONDS = 2_147_483_647

_HASH = re.compile(r"^[0-9a-f]{64}$")
_IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
_PATCH_IDENTIFIER = re.compile(r"^[A-Za-z][A-Za-z0-9_.-]{0,127}$")
_VERSIONED_IDENTITY = re.compile(
    r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}/v[0-9]+(?:alpha[0-9]+|beta[0-9]+)?$"
)
_RFC3339 = re.compile(
    r"^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])"
    r"T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?"
    r"(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$"
)


class CycleErrorCode(StrEnum):
    """Stable D7 validation, history, and coordination failure codes."""

    INVALID_POLICY = "GE_CYCLE_INVALID_POLICY"
    INVALID_REQUEST = "GE_CYCLE_INVALID_REQUEST"
    INVALID_CANDIDATE = "GE_CYCLE_INVALID_CANDIDATE"
    COUNTER_MISMATCH = "GE_CYCLE_COUNTER_MISMATCH"
    INVALID_HISTORY = "GE_CYCLE_INVALID_HISTORY"
    STORE_FAILED = "GE_CYCLE_STORE_FAILED"
    VERSION_CONFLICT = "GE_CYCLE_VERSION_CONFLICT"
    LEASE_CONFLICT = "GE_CYCLE_LEASE_CONFLICT"
    STALE_LEASE = "GE_CYCLE_STALE_LEASE"
    CLOCK_ROLLBACK = "GE_CYCLE_CLOCK_ROLLBACK"
    ACTIVITY_FAILED = "GE_ACTIVITY_FAILED"
    ACTIVITY_OUTPUT_INVALID = "GE_ACTIVITY_OUTPUT_INVALID"
    IN_DOUBT_SIDE_EFFECT = "IN_DOUBT_SIDE_EFFECT"
    PATCH_INVALID = "GE_PATCH_INVALID"
    PATCH_STALE_BASE = "GE_PATCH_STALE_BASE"
    PATCH_IDEMPOTENCY_CONFLICT = "GE_PATCH_IDEMPOTENCY_CONFLICT"
    PATCH_DUPLICATE_ID = "GE_PATCH_DUPLICATE_ID"
    PATCH_GRAPH_INVALID = "GE_PATCH_GRAPH_INVALID"
    PATCH_AUTHORITY_EXPANSION = "GE_PATCH_AUTHORITY_EXPANSION"
    PATCH_BUDGET_EXCEEDED = "GE_PATCH_BUDGET_EXCEEDED"
    PATCH_STATE_CONFLICT = "GE_PATCH_STATE_CONFLICT"
    PATCH_UNSUPPORTED = "GE_PATCH_UNSUPPORTED"


@dataclass(frozen=True, slots=True)
class CycleIssue:
    code: str
    path: str
    phase: int = 1


class CycleRuntimeError(Exception):
    """Structured cycle error that never degrades into ``None``."""

    def __init__(
        self,
        code: CycleErrorCode,
        message: str,
        *,
        path: str = "",
        details: dict[str, JsonValue] | None = None,
        cause: BaseException | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.path = path
        self.details = MappingProxyType(dict(details or {}))
        self.cause = cause

    def to_dict(self) -> dict[str, JsonValue]:
        return {
            "name": type(self).__name__,
            "code": self.code.value,
            "message": str(self),
            "path": self.path,
            "details": dict(self.details),
        }


class PortableCaptureError(CycleRuntimeError):
    def __init__(self, message: str, *, path: str = "") -> None:
        super().__init__(CycleErrorCode.INVALID_REQUEST, message, path=path)


@dataclass(slots=True)
class _CaptureBudget:
    values: int = 0


def capture_portable_json(
    value: object,
    *,
    max_depth: int = MAX_CAPTURE_DEPTH,
    max_values: int = MAX_CAPTURE_VALUES,
    error_code: CycleErrorCode = CycleErrorCode.INVALID_REQUEST,
) -> JsonValue:
    """Detach exact built-in JSON without invoking caller-controlled behavior.

    Aliases are copied independently; an ancestry cycle is rejected.  Depth
    and value limits are checked before descending into the next value.
    """

    budget = _CaptureBudget()
    try:
        return _capture(
            value,
            ancestors=set(),
            depth=0,
            max_depth=max_depth,
            max_values=max_values,
            budget=budget,
            path="",
            error_code=error_code,
        )
    except RecursionError as exc:
        raise CycleRuntimeError(
            error_code,
            "portable JSON exceeds the constructed depth limit",
            cause=exc,
        ) from exc


def _capture(
    value: object,
    *,
    ancestors: set[int],
    depth: int,
    max_depth: int,
    max_values: int,
    budget: _CaptureBudget,
    path: str,
    error_code: CycleErrorCode,
) -> JsonValue:
    if depth > max_depth:
        raise CycleRuntimeError(
            error_code,
            "portable JSON exceeds the constructed depth limit",
            path=path,
        )
    budget.values += 1
    if budget.values > max_values:
        raise CycleRuntimeError(
            error_code,
            "portable JSON exceeds the value-count limit",
            path=path,
        )

    value_type = type(value)
    if value is None:
        return None
    if value_type is str:
        return cast(str, value)
    if value_type is bool:
        return cast(bool, value)
    if value_type is int:
        integer = cast(int, value)
        if abs(integer) > MAX_SAFE_INTEGER:
            raise CycleRuntimeError(
                error_code,
                "integer exceeds the portable safe range",
                path=path,
            )
        return integer
    if value_type is float:
        number = cast(float, value)
        if not math.isfinite(number):
            raise CycleRuntimeError(
                error_code,
                "floating-point value must be finite",
                path=path,
            )
        if number.is_integer():
            if abs(number) > MAX_SAFE_INTEGER:
                raise CycleRuntimeError(
                    error_code,
                    "integer-valued float exceeds the portable safe range",
                    path=path,
                )
            return int(number)
        return number

    if value_type is list:
        identity = id(value)
        if identity in ancestors:
            raise CycleRuntimeError(error_code, "portable JSON contains a cycle", path=path)
        ancestors.add(identity)
        try:
            return [
                _capture(
                    item,
                    ancestors=ancestors,
                    depth=depth + 1,
                    max_depth=max_depth,
                    max_values=max_values,
                    budget=budget,
                    path=f"{path}/{index}",
                    error_code=error_code,
                )
                for index, item in enumerate(cast(list[object], value))
            ]
        finally:
            ancestors.remove(identity)

    if value_type is dict:
        identity = id(value)
        if identity in ancestors:
            raise CycleRuntimeError(error_code, "portable JSON contains a cycle", path=path)
        ancestors.add(identity)
        try:
            result: dict[str, JsonValue] = {}
            # Exact dict iteration is a CPython built-in operation.  Subclasses
            # were rejected above, so no user method or proxy trap can run.
            for key, item in cast(dict[object, object], value).items():
                if type(key) is not str:
                    raise CycleRuntimeError(
                        error_code,
                        "portable JSON object keys must be exact strings",
                        path=path,
                    )
                result[key] = _capture(
                    item,
                    ancestors=ancestors,
                    depth=depth + 1,
                    max_depth=max_depth,
                    max_values=max_values,
                    budget=budget,
                    path=f"{path}/{_pointer_token(key)}",
                    error_code=error_code,
                )
            return result
        finally:
            ancestors.remove(identity)

    raise CycleRuntimeError(
        error_code,
        "value is not exact portable JSON",
        path=path,
    )


def _pointer_token(value: str) -> str:
    return value.replace("~", "~0").replace("/", "~1")


def domain_hash(domain: str, value: object) -> str:
    captured = capture_portable_json(value)
    return hashlib.sha256((domain + canonical_json(captured)).encode("utf-8")).hexdigest()


def raw_sha256(value: str | bytes) -> str:
    payload = value.encode("utf-8") if type(value) is str else cast(bytes, value)
    return hashlib.sha256(payload).hexdigest()


def strict_rfc3339(value: object, *, path: str = "") -> str:
    if type(value) is not str:
        raise CycleRuntimeError(
            CycleErrorCode.INVALID_REQUEST,
            "timestamp must be strict RFC 3339",
            path=path,
        )
    text = value
    if not _RFC3339.fullmatch(text):
        raise CycleRuntimeError(
            CycleErrorCode.INVALID_REQUEST,
            "timestamp must be strict RFC 3339",
            path=path,
        )
    normalized = f"{text[:-1]}+00:00" if text.endswith("Z") else text
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise CycleRuntimeError(
            CycleErrorCode.INVALID_REQUEST,
            "timestamp must be strict RFC 3339",
            path=path,
            cause=exc,
        ) from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise CycleRuntimeError(
            CycleErrorCode.INVALID_REQUEST,
            "timestamp must include an offset",
            path=path,
        )
    return text


SafeCounter = Annotated[int, Field(strict=True, ge=0, le=MAX_SAFE_INTEGER)]
PositiveCounter = Annotated[int, Field(strict=True, ge=1, le=MAX_SAFE_INTEGER)]
PositiveTimer = Annotated[int, Field(strict=True, ge=1, le=MAX_TIMER_MILLISECONDS)]
HashValue = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
Identifier = Annotated[
    str,
    Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$"),
]
VersionedIdentity = Annotated[
    str,
    Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}/v[0-9]+(?:alpha[0-9]+|beta[0-9]+)?$"),
]
Cost: TypeAlias = int | float


def _finite_cost(value: object) -> int | float:
    if type(value) not in (int, float):
        raise ValueError("cost must be an exact JSON number")
    number = cast(int | float, value)
    if isinstance(number, float) and not math.isfinite(number):
        raise ValueError("cost must be finite")
    if number < 0 or number > MAX_SAFE_INTEGER:
        raise ValueError("cost is outside the portable range")
    return number


class _CycleModel(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        populate_by_name=False,
        strict=True,
    )


class CycleControllerPolicy(_CycleModel):
    api_version: Literal[
        "graphengineering.reacher-z.github.io/cycle-policies/v1alpha1"
    ] = Field(alias="apiVersion")
    kind: Literal["CycleControllerPolicy"]
    mode: Literal["until-dry", "while", "evaluator-optimizer"]
    max_iterations: Annotated[int, Field(strict=True, ge=1, le=10_000)] = Field(
        alias="maxIterations"
    )
    max_duration_ms: PositiveTimer = Field(alias="maxDurationMs")
    max_cost_usd: Cost = Field(alias="maxCostUsd")
    max_total_attempts: PositiveCounter = Field(alias="maxTotalAttempts")
    max_discoveries: Annotated[int, Field(strict=True, ge=0, le=10_000_000)] = Field(
        alias="maxDiscoveries"
    )
    max_dynamic_nodes: Annotated[int, Field(strict=True, ge=0, le=100_000)] = Field(
        alias="maxDynamicNodes"
    )
    max_candidates_per_round: Annotated[
        int, Field(strict=True, ge=1, le=100_000)
    ] = Field(alias="maxCandidatesPerRound")
    max_candidate_bytes: Annotated[
        int, Field(strict=True, ge=1, le=1_048_576)
    ] = Field(alias="maxCandidateBytes")
    max_candidate_batch_bytes: Annotated[
        int, Field(strict=True, ge=1, le=16_777_216)
    ] = Field(alias="maxCandidateBatchBytes")
    consecutive_dry_rounds: Annotated[
        int, Field(strict=True, ge=1, le=100)
    ] | None = Field(default=None, alias="consecutiveDryRounds")

    @field_validator("max_cost_usd")
    @classmethod
    def cost_is_portable(cls, value: Cost) -> Cost:
        return _finite_cost(value)

    @model_validator(mode="after")
    def mode_fields_are_closed(self) -> CycleControllerPolicy:
        if self.mode == "until-dry" and self.consecutive_dry_rounds is None:
            raise ValueError("until-dry requires consecutiveDryRounds")
        if self.mode != "until-dry" and self.consecutive_dry_rounds is not None:
            raise ValueError("only until-dry accepts consecutiveDryRounds")
        return self


class InlinePayload(_CycleModel):
    disposition: Literal["inline-unredacted"]
    redacted: Literal[False]
    encoding: Literal["canonical-json/v1alpha1"]
    canonical_json_value: Annotated[
        str, Field(min_length=1, max_length=MAX_CANDIDATE_BATCH_BYTES)
    ] = Field(alias="canonicalJson")
    utf8_byte_length: Annotated[
        int, Field(strict=True, ge=1, le=MAX_CANDIDATE_BATCH_BYTES)
    ] = Field(alias="utf8ByteLength")
    sha256: HashValue

    @model_validator(mode="after")
    def payload_identity_matches(self) -> InlinePayload:
        encoded = self.canonical_json_value.encode("utf-8")
        if len(encoded) != self.utf8_byte_length:
            raise ValueError("utf8ByteLength does not match canonicalJson")
        if raw_sha256(encoded) != self.sha256:
            raise ValueError("sha256 does not match canonicalJson")
        try:
            decoded = json.loads(
                self.canonical_json_value,
                parse_constant=lambda token: (_raise_json_constant(token)),
            )
        except (json.JSONDecodeError, ValueError) as exc:
            raise ValueError("canonicalJson is not strict JSON") from exc
        if canonical_json(capture_portable_json(decoded)) != self.canonical_json_value:
            raise ValueError("canonicalJson is not canonical-json/v1alpha1")
        return self


def _raise_json_constant(token: str) -> None:
    raise ValueError(f"invalid JSON numeric token: {token}")


class GraphCoordinate(_CycleModel):
    graph_revision: Annotated[int, Field(strict=True, ge=1, le=MAX_SAFE_INTEGER)] = Field(
        alias="graphRevision"
    )
    graph_hash: HashValue = Field(alias="graphHash")
    revision_hash: HashValue = Field(alias="revisionHash")


class CycleActivityBinding(_CycleModel):
    activity_id: Identifier = Field(alias="activityId")
    implementation_hash: HashValue = Field(alias="implementationHash")
    side_effects: Literal["none", "idempotent", "non-idempotent"] = Field(
        alias="sideEffects"
    )
    max_attempts_per_round: Annotated[int, Field(strict=True, ge=1, le=100)] = Field(
        alias="maxAttemptsPerRound"
    )
    max_cost_usd_per_attempt: Cost = Field(alias="maxCostUsdPerAttempt")
    timeout_ms: PositiveTimer = Field(alias="timeoutMs")

    @field_validator("max_cost_usd_per_attempt")
    @classmethod
    def cost_is_portable(cls, value: Cost) -> Cost:
        return _finite_cost(value)


class CycleActivities(_CycleModel):
    finder: CycleActivityBinding
    candidate_evaluator: CycleActivityBinding = Field(alias="candidateEvaluator")
    condition: CycleActivityBinding | None
    optimizer_evaluator: CycleActivityBinding | None = Field(alias="optimizerEvaluator")
    patch_planner: CycleActivityBinding | None = Field(alias="patchPlanner")


class GraphPatchLimits(_CycleModel):
    max_nodes: Annotated[int, Field(strict=True, ge=1, le=100_000)] = Field(
        alias="maxNodes"
    )
    max_edges: Annotated[int, Field(strict=True, ge=0, le=200_000)] = Field(
        alias="maxEdges"
    )
    max_outputs: Annotated[int, Field(strict=True, ge=1, le=100_000)] = Field(
        alias="maxOutputs"
    )
    max_depth: Annotated[int, Field(strict=True, ge=1, le=100_000)] = Field(
        alias="maxDepth"
    )
    max_fan_out: Annotated[int, Field(strict=True, ge=1, le=100_000)] = Field(
        alias="maxFanOut"
    )


class GraphPatchOptions(_CycleModel):
    enabled: bool
    limits: GraphPatchLimits | None

    @model_validator(mode="after")
    def enabled_requires_limits(self) -> GraphPatchOptions:
        if self.enabled != (self.limits is not None):
            raise ValueError("patch limits are required exactly when patches are enabled")
        return self


class PayloadProfile(_CycleModel):
    contract_version: Literal["cycle-controller-inline-payloads/v1alpha1"] = Field(
        alias="contractVersion"
    )
    disposition: Literal["inline-unredacted"]
    redacted: Literal[False]
    inline_risk_authorization_hash: HashValue = Field(alias="inlineRiskAuthorizationHash")


class HostRun(_CycleModel):
    relationship: Literal["standalone-child-controller"]
    run_id: Identifier = Field(alias="runId")


class StartLineage(_CycleModel):
    origin: Literal["start"]


class ForkLineage(_CycleModel):
    origin: Literal["fork"]
    parent_controller_run_id: Identifier = Field(alias="parentControllerRunId")
    parent_sequence: SafeCounter = Field(alias="parentSequence")
    parent_history_hash: HashValue = Field(alias="parentHistoryHash")


class CycleControllerRequest(_CycleModel):
    api_version: Literal[
        "graphengineering.reacher-z.github.io/cycle-controllers/v1alpha1"
    ] = Field(alias="apiVersion")
    kind: Literal["CycleControllerRequest"]
    controller_run_id: Identifier = Field(alias="controllerRunId")
    controller_id: Identifier = Field(alias="controllerId")
    host_run: HostRun = Field(alias="hostRun")
    event_stream_id: Identifier = Field(alias="eventStreamId")
    checkpoint_scope: Identifier = Field(alias="checkpointScope")
    policy: CycleControllerPolicy
    objective: InlinePayload
    key_strategy_id: VersionedIdentity = Field(alias="keyStrategyId")
    rubric_identity: VersionedIdentity = Field(alias="rubricIdentity")
    authority_ceiling_hash: HashValue = Field(alias="authorityCeilingHash")
    pricing_policy_hash: HashValue = Field(alias="pricingPolicyHash")
    implementation_hash: HashValue = Field(alias="implementationHash")
    payload_profile: PayloadProfile = Field(alias="payloadProfile")
    initial_graph: GraphCoordinate = Field(alias="initialGraph")
    activities: CycleActivities
    patches: GraphPatchOptions
    lineage: StartLineage | ForkLineage

    @model_validator(mode="after")
    def bindings_match_mode_and_patch_policy(self) -> CycleControllerRequest:
        mode = self.policy.mode
        if mode == "until-dry":
            if (
                self.activities.condition is not None
                or self.activities.optimizer_evaluator is not None
            ):
                raise ValueError("until-dry forbids condition and optimizerEvaluator")
        elif mode == "while":
            if self.activities.condition is None or self.activities.optimizer_evaluator is not None:
                raise ValueError("while requires only condition")
        elif self.activities.condition is not None or self.activities.optimizer_evaluator is None:
            raise ValueError("evaluator-optimizer requires only optimizerEvaluator")
        if self.patches.enabled != (self.activities.patch_planner is not None):
            raise ValueError("patchPlanner is required exactly when patches are enabled")
        if self.patches.enabled and self.initial_graph.graph_revision >= MAX_SAFE_INTEGER:
            raise ValueError("patch-enabled initial revision cannot overflow")
        return self


@dataclass(frozen=True, slots=True)
class ValidatedCycleRequest:
    document: JsonObject
    model: CycleControllerRequest
    objective_hash: str
    identity: JsonObject
    controller_hash: str
    request_hash: str


def _validation_message(exc: ValidationError) -> tuple[str, str]:
    first = exc.errors()[0]
    path = "".join(f"/{_pointer_token(str(part))}" for part in first["loc"])
    return first["msg"], path


def validate_cycle_policy(value: object) -> tuple[JsonObject, CycleControllerPolicy]:
    captured = capture_portable_json(value, error_code=CycleErrorCode.INVALID_POLICY)
    if type(captured) is not dict:
        raise CycleRuntimeError(CycleErrorCode.INVALID_POLICY, "policy must be an object")
    try:
        model = CycleControllerPolicy.model_validate(captured)
    except ValidationError as exc:
        message, path = _validation_message(exc)
        raise CycleRuntimeError(
            CycleErrorCode.INVALID_POLICY,
            message,
            path=path,
            cause=exc,
        ) from exc
    return captured, model


def validate_cycle_request(value: object) -> ValidatedCycleRequest:
    captured = capture_portable_json(value)
    if type(captured) is not dict:
        raise CycleRuntimeError(CycleErrorCode.INVALID_REQUEST, "request must be an object")
    document = captured
    try:
        model = CycleControllerRequest.model_validate(document)
    except ValidationError as exc:
        message, path = _validation_message(exc)
        raise CycleRuntimeError(
            CycleErrorCode.INVALID_REQUEST,
            message,
            path=path,
            cause=exc,
        ) from exc

    objective_hash = model.objective.sha256
    identity: JsonObject = {
        "policy": cast(JsonObject, document["policy"]),
        "objectiveHash": objective_hash,
        "keyStrategyId": model.key_strategy_id,
        "rubricIdentity": model.rubric_identity,
        "authorityCeilingHash": model.authority_ceiling_hash,
        "pricingPolicyHash": model.pricing_policy_hash,
        "initialGraphRevision": model.initial_graph.graph_revision,
        "initialGraphHash": model.initial_graph.graph_hash,
        "initialRevisionHash": model.initial_graph.revision_hash,
    }
    return ValidatedCycleRequest(
        document=document,
        model=model,
        objective_hash=objective_hash,
        identity=identity,
        controller_hash=domain_hash(CYCLE_CONTROLLER_DOMAIN, identity),
        request_hash=domain_hash(CYCLE_REQUEST_DOMAIN, document),
    )


class LeaseClaim(_CycleModel):
    lease_id: Identifier = Field(alias="leaseId")
    holder_id: Identifier = Field(alias="holderId")
    lease_epoch: PositiveCounter = Field(alias="leaseEpoch")
    fencing_token: PositiveCounter = Field(alias="fencingToken")
    acquired_at: str = Field(alias="acquiredAt")
    expires_at: str = Field(alias="expiresAt")

    @field_validator("acquired_at", "expires_at")
    @classmethod
    def timestamps_are_strict(cls, value: str) -> str:
        return strict_rfc3339(value)

    @model_validator(mode="after")
    def expiry_is_after_acquisition(self) -> LeaseClaim:
        if parse_timestamp(self.expires_at) <= parse_timestamp(self.acquired_at):
            raise ValueError("expiresAt must be after acquiredAt")
        return self


def validate_lease(value: object) -> tuple[JsonObject, LeaseClaim]:
    captured = capture_portable_json(value)
    if type(captured) is not dict:
        raise CycleRuntimeError(CycleErrorCode.LEASE_CONFLICT, "lease must be an object")
    try:
        model = LeaseClaim.model_validate(captured)
    except ValidationError as exc:
        message, path = _validation_message(exc)
        raise CycleRuntimeError(
            CycleErrorCode.LEASE_CONFLICT,
            message,
            path=path,
            cause=exc,
        ) from exc
    return captured, model


def parse_timestamp(value: str) -> datetime:
    normalized = f"{value[:-1]}+00:00" if value.endswith("Z") else value
    return datetime.fromisoformat(normalized)


CycleEventType: TypeAlias = Literal[
    "ControllerCreated",
    "LeaseAcquired",
    "LeaseRenewed",
    "LeaseReleased",
    "RoundReserved",
    "ActivityStarted",
    "ActivityFailed",
    "DiscoveryCommitted",
    "CandidateEvaluationCommitted",
    "ModeOutcomeCommitted",
    "BudgetReservationSettled",
    "BudgetReservationReleased",
    "PatchAccepted",
    "PatchRejected",
    "RoundCommitted",
    "ControllerTerminated",
]


class CycleEvent(_CycleModel):
    api_version: Literal[
        "graphengineering.reacher-z.github.io/cycle-controller-events/v1alpha1"
    ] = Field(alias="apiVersion")
    contract_version: Literal["cycle-controller-recovery/v1alpha1"] = Field(
        alias="contractVersion"
    )
    event_id: Identifier = Field(alias="eventId")
    type: CycleEventType
    timestamp: str
    controller_run_id: Identifier = Field(alias="controllerRunId")
    host_run_id: Identifier = Field(alias="hostRunId")
    controller_hash: HashValue = Field(alias="controllerHash")
    request_hash: HashValue = Field(alias="requestHash")
    graph_revision: Annotated[int, Field(strict=True, ge=1, le=MAX_SAFE_INTEGER)] = Field(
        alias="graphRevision"
    )
    sequence: SafeCounter
    expected_previous_sequence: Annotated[
        int, Field(strict=True, ge=-1, le=MAX_SAFE_INTEGER - 1)
    ] = Field(alias="expectedPreviousSequence")
    previous_event_hash: HashValue | None = Field(alias="previousEventHash")
    lease: LeaseClaim | None
    payload_disposition: Literal["inline-unredacted"] = Field(alias="payloadDisposition")
    redacted: Literal[False]
    payload_hash: HashValue = Field(alias="payloadHash")
    data: JsonObject
    record_hash: HashValue = Field(alias="recordHash")

    @field_validator("timestamp")
    @classmethod
    def timestamp_is_strict(cls, value: str) -> str:
        return strict_rfc3339(value)


def cycle_event_document(event: CycleEvent) -> JsonObject:
    document = capture_portable_json(event.model_dump(by_alias=True))
    if type(document) is not dict:  # pragma: no cover - model dump invariant
        raise CycleRuntimeError(CycleErrorCode.INVALID_HISTORY, "event dump is not an object")
    return document


def validate_cycle_event(value: object) -> CycleEvent:
    if type(value) is CycleEvent:
        document = cycle_event_document(value)
    else:
        captured = capture_portable_json(value, error_code=CycleErrorCode.INVALID_HISTORY)
        if type(captured) is not dict:
            raise CycleRuntimeError(CycleErrorCode.INVALID_HISTORY, "event must be an object")
        document = captured
    try:
        event = CycleEvent.model_validate(document)
    except ValidationError as exc:
        message, path = _validation_message(exc)
        raise CycleRuntimeError(
            CycleErrorCode.INVALID_HISTORY,
            message,
            path=path,
            cause=exc,
        ) from exc
    expected_payload = hashlib.sha256(canonical_json(event.data).encode("utf-8")).hexdigest()
    if event.payload_hash != expected_payload:
        raise CycleRuntimeError(
            CycleErrorCode.INVALID_HISTORY,
            "payloadHash does not match event data",
            path="/payloadHash",
        )
    without_record = dict(document)
    without_record.pop("recordHash", None)
    expected_record = domain_hash(CYCLE_EVENT_DOMAIN, without_record)
    if event.record_hash != expected_record:
        raise CycleRuntimeError(
            CycleErrorCode.INVALID_HISTORY,
            "recordHash does not match event envelope",
            path="/recordHash",
        )
    return event


def make_cycle_event(
    *,
    event_id: str,
    event_type: CycleEventType,
    timestamp: str,
    request: ValidatedCycleRequest,
    graph_revision: int,
    sequence: int,
    previous_event_hash: str | None,
    lease: JsonObject | None,
    data: object,
) -> CycleEvent:
    captured_data = capture_portable_json(data, error_code=CycleErrorCode.INVALID_HISTORY)
    if type(captured_data) is not dict:
        raise CycleRuntimeError(CycleErrorCode.INVALID_HISTORY, "event data must be an object")
    document: JsonObject = {
        "apiVersion": "graphengineering.reacher-z.github.io/cycle-controller-events/v1alpha1",
        "contractVersion": "cycle-controller-recovery/v1alpha1",
        "eventId": event_id,
        "type": event_type,
        "timestamp": strict_rfc3339(timestamp),
        "controllerRunId": request.model.controller_run_id,
        "hostRunId": request.model.host_run.run_id,
        "controllerHash": request.controller_hash,
        "requestHash": request.request_hash,
        "graphRevision": graph_revision,
        "sequence": sequence,
        "expectedPreviousSequence": sequence - 1,
        "previousEventHash": previous_event_hash,
        "lease": lease,
        "payloadDisposition": "inline-unredacted",
        "redacted": False,
        "payloadHash": hashlib.sha256(canonical_json(captured_data).encode("utf-8")).hexdigest(),
        "data": captured_data,
    }
    document["recordHash"] = domain_hash(CYCLE_EVENT_DOMAIN, document)
    return validate_cycle_event(document)


def activity_key(
    *,
    controller_run_id: str,
    controller_hash: str,
    iteration: int,
    phase: str,
    activity_id: str,
    input_hash: str,
) -> str:
    return domain_hash(
        CYCLE_ACTIVITY_DOMAIN,
        {
            "controllerRunId": controller_run_id,
            "controllerHash": controller_hash,
            "iteration": iteration,
            "phase": phase,
            "activityId": activity_id,
            "inputHash": input_hash,
        },
    )


def round_plan_hash(plan: object) -> str:
    return domain_hash(CYCLE_ROUND_PLAN_DOMAIN, plan)


def revision_hash(body: object) -> str:
    return domain_hash(REVISION_DOMAIN, body)


def patch_hash(document: object) -> str:
    captured = capture_portable_json(document, error_code=CycleErrorCode.PATCH_INVALID)
    encoded = canonical_json(captured).encode("utf-8")
    if len(encoded) > MAX_PATCH_BYTES:
        raise CycleRuntimeError(
            CycleErrorCode.PATCH_INVALID,
            "GraphPatch exceeds the canonical UTF-8 byte ceiling",
        )
    return hashlib.sha256(encoded).hexdigest()


def assert_identifier(value: object, *, patch: bool = False, path: str = "") -> str:
    expression = _PATCH_IDENTIFIER if patch else _IDENTIFIER
    if type(value) is not str:
        raise CycleRuntimeError(
            CycleErrorCode.PATCH_INVALID if patch else CycleErrorCode.INVALID_REQUEST,
            "identifier is invalid",
            path=path,
        )
    if not expression.fullmatch(value):
        raise CycleRuntimeError(
            CycleErrorCode.PATCH_INVALID if patch else CycleErrorCode.INVALID_REQUEST,
            "identifier is invalid",
            path=path,
        )
    return value


def assert_hash(value: object, *, path: str = "") -> str:
    if type(value) is not str:
        raise CycleRuntimeError(
            CycleErrorCode.INVALID_HISTORY,
            "hash must be 64 lowercase hexadecimal characters",
            path=path,
        )
    if not _HASH.fullmatch(value):
        raise CycleRuntimeError(
            CycleErrorCode.INVALID_HISTORY,
            "hash must be 64 lowercase hexadecimal characters",
            path=path,
        )
    return value


__all__ = [
    "CYCLE_ACTIVITY_DOMAIN",
    "CYCLE_CONTROLLER_DOMAIN",
    "CYCLE_EVENT_DOMAIN",
    "CYCLE_REQUEST_DOMAIN",
    "CYCLE_ROUND_PLAN_DOMAIN",
    "MAX_CAPTURE_DEPTH",
    "MAX_CAPTURE_VALUES",
    "MAX_PATCH_BYTES",
    "CycleActivityBinding",
    "CycleControllerPolicy",
    "CycleControllerRequest",
    "CycleErrorCode",
    "CycleEvent",
    "CycleIssue",
    "CycleRuntimeError",
    "GraphCoordinate",
    "GraphPatchLimits",
    "LeaseClaim",
    "ValidatedCycleRequest",
    "activity_key",
    "capture_portable_json",
    "cycle_event_document",
    "domain_hash",
    "make_cycle_event",
    "parse_timestamp",
    "patch_hash",
    "revision_hash",
    "round_plan_hash",
    "strict_rfc3339",
    "validate_cycle_event",
    "validate_cycle_policy",
    "validate_cycle_request",
    "validate_lease",
]
