"""Pydantic models for the language-neutral Graph Engineering IR."""

from __future__ import annotations

from typing import Annotated, Literal, TypeAlias

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic import JsonValue as PydanticJsonValue

JsonPrimitive: TypeAlias = str | int | float | bool | None
JsonValue: TypeAlias = PydanticJsonValue
JsonObject: TypeAlias = dict[str, JsonValue]
MAX_SAFE_INTEGER = 2**53 - 1

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
    initial_delay_ms: Annotated[int, Field(ge=0)] | None = Field(
        default=None, alias="initialDelayMs"
    )
    max_delay_ms: Annotated[int, Field(ge=0)] | None = Field(default=None, alias="maxDelayMs")
    backoff_multiplier: Annotated[float, Field(ge=1)] | None = Field(
        default=None, alias="backoffMultiplier"
    )
    jitter: bool | None = None


class NodeSpec(StrictModel):
    id: Identifier
    kind: NodeKind
    input_schema: JsonObject = Field(alias="inputSchema")
    output_schema: JsonObject = Field(alias="outputSchema")
    config: JsonValue
    retry: RetryPolicy | None = None
    timeout_ms: Annotated[int, Field(ge=1)] | None = Field(default=None, alias="timeoutMs")
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


class GraphPolicies(BaseModel):
    """Known policies plus forward-compatible extension keys."""

    model_config = ConfigDict(
        extra="allow",
        frozen=True,
        populate_by_name=True,
        strict=True,
    )

    max_concurrency: Annotated[int, Field(ge=1)] | None = Field(
        default=None, alias="maxConcurrency"
    )
    max_dynamic_nodes: Annotated[int, Field(ge=0)] | None = Field(
        default=None, alias="maxDynamicNodes"
    )
    max_depth: Annotated[int, Field(ge=1)] | None = Field(default=None, alias="maxDepth")
    max_fan_out: Annotated[int, Field(ge=1)] | None = Field(default=None, alias="maxFanOut")
    max_total_attempts: Annotated[int, Field(ge=1)] | None = Field(
        default=None, alias="maxTotalAttempts"
    )
    max_duration_ms: Annotated[int, Field(ge=1)] | None = Field(
        default=None, alias="maxDurationMs"
    )
    max_cost_usd: Annotated[float, Field(ge=0)] | None = Field(default=None, alias="maxCostUsd")


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
