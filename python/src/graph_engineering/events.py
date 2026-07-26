"""Validated runtime event envelope shared by persistence implementations."""

from __future__ import annotations

import math
import re
from datetime import datetime
from typing import Annotated, Literal, TypeAlias, cast

from pydantic import ConfigDict, Field, field_validator

from ._json import JsonKeyCollisionError, normalize_json_strings
from .models import MAX_SAFE_INTEGER, JsonObject, StrictModel

EventType: TypeAlias = Literal[
    "RunCreated",
    "RunStarted",
    "RunPaused",
    "RunResumed",
    "GraphPatched",
    "NodeScheduled",
    "NodeStarted",
    "NodeAttemptFailed",
    "NodeSettledWithoutAttempt",
    "NodeRetried",
    "NodeSucceeded",
    "EdgeEmitted",
    "BarrierSatisfied",
    "RouteSelected",
    "VerificationRecorded",
    "BudgetUpdated",
    "ArtifactCreated",
    "HumanInputRequested",
    "HumanInputReceived",
    "RunCancelled",
    "RunFailed",
    "RunSucceeded",
]
_RFC3339 = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?"
    r"(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$"
)


def _contains_nonfinite_number(value: object) -> bool:
    if isinstance(value, float):
        return not math.isfinite(value)
    if isinstance(value, list):
        return any(_contains_nonfinite_number(item) for item in value)
    if isinstance(value, dict):
        return any(_contains_nonfinite_number(item) for item in value.values())
    return False


class GraphEvent(StrictModel):
    """A strict ``event.schema.json`` v1alpha1 envelope."""

    # Re-state the inherited config so generated schemas carry the intended title.
    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        populate_by_name=True,
        strict=True,
        title="Graph Engineering Runtime Event",
    )

    api_version: Literal["graphengineering.reacher-z.github.io/events/v1alpha1"] = Field(
        alias="apiVersion"
    )
    event_id: Annotated[str, Field(min_length=1)] = Field(alias="eventId")
    type: EventType
    timestamp: str
    run_id: Annotated[str, Field(min_length=1)] = Field(alias="runId")
    graph_revision: Annotated[int, Field(ge=1, le=MAX_SAFE_INTEGER)] = Field(alias="graphRevision")
    sequence: Annotated[int, Field(ge=0, le=MAX_SAFE_INTEGER)]
    trace_id: str | None = Field(default=None, alias="traceId")
    span_id: str | None = Field(default=None, alias="spanId")
    parent_span_id: str | None = Field(default=None, alias="parentSpanId")
    node_id: str | None = Field(default=None, alias="nodeId")
    edge_id: str | None = Field(default=None, alias="edgeId")
    attempt: Annotated[int, Field(ge=1, le=MAX_SAFE_INTEGER)] | None = None
    payload_hash: str | None = Field(default=None, alias="payloadHash")
    artifact_ref: str | None = Field(default=None, alias="artifactRef")
    redacted: bool = True
    data: JsonObject

    @field_validator("timestamp")
    @classmethod
    def timestamp_is_timezone_aware_iso8601(cls, value: str) -> str:
        if not _RFC3339.fullmatch(value):
            raise ValueError("timestamp must be an ISO 8601 date-time")
        if int(value[11:13]) > 23 or int(value[14:16]) > 59 or int(value[17:19]) > 59:
            raise ValueError("timestamp contains an invalid time of day")
        normalized = f"{value[:-1]}+00:00" if value.endswith("Z") else value
        try:
            parsed = datetime.fromisoformat(normalized)
        except ValueError as exc:
            raise ValueError("timestamp must be an ISO 8601 date-time") from exc
        if parsed.tzinfo is None or parsed.utcoffset() is None:
            raise ValueError("timestamp must include a UTC offset")
        return value

    @field_validator(
        "trace_id",
        "span_id",
        "parent_span_id",
        "node_id",
        "edge_id",
        "payload_hash",
        "artifact_ref",
    )
    @classmethod
    def present_optional_strings_are_not_null(cls, value: str | None) -> str:
        if value is None:
            raise ValueError("present optional string fields cannot be null")
        return value

    @field_validator("attempt")
    @classmethod
    def present_attempt_is_not_null(cls, value: int | None) -> int:
        if value is None:
            raise ValueError("present attempt cannot be null")
        return value

    @field_validator("data")
    @classmethod
    def data_contains_only_finite_numbers(cls, value: JsonObject) -> JsonObject:
        if _contains_nonfinite_number(value):
            raise ValueError("event data must contain only finite JSON numbers")
        try:
            normalized = normalize_json_strings(value)
        except JsonKeyCollisionError as exc:
            raise ValueError(str(exc)) from exc
        if not isinstance(normalized, dict):
            raise ValueError("event data must be a JSON object")
        return cast(JsonObject, normalized)
