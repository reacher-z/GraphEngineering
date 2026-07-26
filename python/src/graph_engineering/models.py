"""Pydantic models for the language-neutral Graph Engineering IR."""

from __future__ import annotations

import math
from collections.abc import Mapping
from typing import Annotated, Literal, TypeAlias, cast

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from pydantic import JsonValue as PydanticJsonValue

JsonPrimitive: TypeAlias = str | int | float | bool | None
JsonValue: TypeAlias = PydanticJsonValue
JsonObject: TypeAlias = dict[str, JsonValue]
MAX_SAFE_INTEGER = 2**53 - 1
MAX_TIMER_MILLISECONDS = 2**31 - 1
SafePositiveInteger: TypeAlias = Annotated[int, Field(ge=1, le=MAX_SAFE_INTEGER)]
SafeNonNegativeInteger: TypeAlias = Annotated[int, Field(ge=0, le=MAX_SAFE_INTEGER)]
TimerPositiveMilliseconds: TypeAlias = Annotated[int, Field(ge=1, le=MAX_TIMER_MILLISECONDS)]
TimerNonNegativeMilliseconds: TypeAlias = Annotated[int, Field(ge=0, le=MAX_TIMER_MILLISECONDS)]

NodeKind: TypeAlias = Literal[
    "agent",
    "model",
    "tool",
    "transform",
    "subgraph",
    "router",
    "barrier",
    "validator",
    "human",
]
EdgeMode: TypeAlias = Literal["value", "stream", "artifact-ref"]
SideEffects: TypeAlias = Literal["none", "idempotent", "non-idempotent"]

Identifier = Annotated[str, Field(pattern=r"^[A-Za-z][A-Za-z0-9_.-]{0,127}$")]


class StrictModel(BaseModel):
    """Base model matching Graph IR's reject-unknown-fields policy."""

    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        populate_by_name=True,
        strict=True,
    )

    @model_validator(mode="before")
    @classmethod
    def present_optional_fields_are_not_null(cls, value: object) -> object:
        """Keep schema-optional fields absent instead of accepting explicit null."""

        if not isinstance(value, Mapping):
            return value
        for field_name, field in cls.model_fields.items():
            if field.is_required():
                continue
            alias = field.alias or field_name
            for input_name in {field_name, alias}:
                if input_name in value and value[input_name] is None:
                    raise ValueError(f"{alias} cannot be null when present")
        return value


class Metadata(StrictModel):
    name: Annotated[str, Field(pattern=r"^[a-z][a-z0-9-]{0,62}$")]
    version: Annotated[str, Field(min_length=1)]
    description: str | None = None
    labels: dict[str, str] | None = None


class Endpoint(StrictModel):
    node: Annotated[str, Field(min_length=1)]
    port: Annotated[str, Field(min_length=1)] | None = None


class RetryPolicy(StrictModel):
    max_attempts: Annotated[int, Field(ge=1, le=100)] | None = Field(
        default=None, alias="maxAttempts"
    )
    initial_delay_ms: TimerNonNegativeMilliseconds | None = Field(
        default=None, alias="initialDelayMs"
    )
    max_delay_ms: TimerNonNegativeMilliseconds | None = Field(default=None, alias="maxDelayMs")
    backoff_multiplier: Annotated[float, Field(ge=1)] | None = Field(
        default=None, alias="backoffMultiplier"
    )
    jitter: bool | None = None

    @field_validator("backoff_multiplier")
    @classmethod
    def backoff_multiplier_is_portable(cls, value: float | None) -> float | None:
        if value is not None and (
            not math.isfinite(value) or (value.is_integer() and abs(value) > MAX_SAFE_INTEGER)
        ):
            raise ValueError("backoffMultiplier must be a portable finite number")
        return value


class NodeSpec(StrictModel):
    id: Identifier
    kind: NodeKind
    input_schema: JsonObject = Field(alias="inputSchema")
    output_schema: JsonObject = Field(alias="outputSchema")
    config: JsonValue
    retry: RetryPolicy | None = None
    timeout_ms: TimerPositiveMilliseconds | None = Field(default=None, alias="timeoutMs")
    cache: JsonObject | None = None
    resources: JsonObject | None = None
    isolation: JsonObject | None = None
    side_effects: SideEffects | None = Field(default=None, alias="sideEffects")


class EdgeSpec(StrictModel):
    id: Identifier
    source: Endpoint = Field(alias="from")
    target: Endpoint = Field(alias="to")
    mapping: JsonObject | None = Field(default=None, alias="map")
    condition: JsonObject | None = None
    mode: EdgeMode | None = None
    schema_: JsonObject | None = Field(default=None, alias="schema")


class _KnownGraphPolicies(StrictModel):
    """Validation-only view of the policy keys defined by Graph IR v1alpha1."""

    max_concurrency: SafePositiveInteger | None = Field(default=None, alias="maxConcurrency")
    max_dynamic_nodes: SafeNonNegativeInteger | None = Field(default=None, alias="maxDynamicNodes")
    max_depth: SafePositiveInteger | None = Field(default=None, alias="maxDepth")
    max_fan_out: SafePositiveInteger | None = Field(default=None, alias="maxFanOut")
    max_total_attempts: SafePositiveInteger | None = Field(default=None, alias="maxTotalAttempts")
    max_duration_ms: TimerPositiveMilliseconds | None = Field(default=None, alias="maxDurationMs")
    max_cost_usd: Annotated[float, Field(ge=0)] | None = Field(default=None, alias="maxCostUsd")

    @field_validator("max_cost_usd")
    @classmethod
    def max_cost_usd_is_portable(cls, value: float | None) -> float | None:
        if value is not None and (
            not math.isfinite(value) or (value.is_integer() and abs(value) > MAX_SAFE_INTEGER)
        ):
            raise ValueError("maxCostUsd must be a portable finite number")
        return value


class GraphPolicies(StrictModel):
    """Lossless policy map with typed accessors for the v1alpha1 keys.

    Policy objects deliberately keep every JSON key in ``model_extra``.  A
    Python field name such as ``max_concurrency`` is a valid future extension
    key and must not be mistaken for the canonical ``maxConcurrency`` key.
    """

    model_config = ConfigDict(
        extra="allow",
        frozen=True,
        populate_by_name=False,
        strict=True,
    )
    __pydantic_extra__: dict[str, JsonValue] = Field(init=False)

    @classmethod
    def known_keys(cls) -> frozenset[str]:
        """Return the canonical policy keys defined by this IR version."""

        return frozenset(
            field.alias or name for name, field in _KnownGraphPolicies.model_fields.items()
        )

    @model_validator(mode="before")
    @classmethod
    def validate_known_policy_keys(cls, value: object) -> object:
        if not isinstance(value, Mapping):
            return value
        _KnownGraphPolicies.model_validate(
            {key: item for key, item in value.items() if key in cls.known_keys()}
        )
        return value

    def _known_value(self, alias: str) -> JsonValue | None:
        return self.__pydantic_extra__.get(alias)

    @property
    def max_concurrency(self) -> int | None:
        return cast(int | None, self._known_value("maxConcurrency"))

    @property
    def max_dynamic_nodes(self) -> int | None:
        return cast(int | None, self._known_value("maxDynamicNodes"))

    @property
    def max_depth(self) -> int | None:
        return cast(int | None, self._known_value("maxDepth"))

    @property
    def max_fan_out(self) -> int | None:
        return cast(int | None, self._known_value("maxFanOut"))

    @property
    def max_total_attempts(self) -> int | None:
        return cast(int | None, self._known_value("maxTotalAttempts"))

    @property
    def max_duration_ms(self) -> int | None:
        return cast(int | None, self._known_value("maxDurationMs"))

    @property
    def max_cost_usd(self) -> float | None:
        return cast(float | None, self._known_value("maxCostUsd"))


class GraphSpec(StrictModel):
    api_version: Literal["graphengineering.reacher-z.github.io/v1alpha1"] = Field(
        alias="apiVersion"
    )
    kind: Literal["Graph"]
    metadata: Metadata
    input_schema: JsonObject = Field(alias="inputSchema")
    output_schema: JsonObject = Field(alias="outputSchema")
    state_schema: JsonObject | None = Field(default=None, alias="stateSchema")
    entrypoints: Annotated[list[Annotated[str, Field(min_length=1)]], Field(min_length=1)]
    outputs: Annotated[dict[str, Endpoint], Field(min_length=1)]
    nodes: list[NodeSpec]
    edges: list[EdgeSpec]
    policies: GraphPolicies | None = None

    @field_validator("entrypoints")
    @classmethod
    def entrypoints_are_unique(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)):
            raise ValueError("entrypoints must be unique")
        return value

    def canonical_json(self) -> str:
        from .canonical import canonical_json

        return canonical_json(self)

    def canonical_hash(self) -> str:
        from .canonical import canonical_sha256

        return canonical_sha256(self)
