"""Portable types for ``adapter-contract/v1alpha1``.

Every type here mirrors a member of the frozen D13 schema set
(``spec/adapter-capability.schema.json``, ``spec/adapter-descriptor.schema.json``,
``spec/adapter-usage.schema.json``, ``spec/adapter-error.schema.json``).  The
conformance corpus ``spec/conformance/adapter.case.json`` is the authority: the
package tests feed its literal documents through these types.

Vocabulary members that arrive from a document are typed ``str`` rather than a
closed ``Literal``.  That is deliberate and honest: the corpus deliberately
mutates a resource into ``money-nano-minor`` or an aggregation into ``maximum``
so that the rule engine must reject it, and a parser that refused those values
would shadow the very rules the corpus isolates.  Shape validity never implies
semantic validity, so the closed vocabularies are enforced by the rules of
``contract.py`` and never by the reader.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Final, Literal, TypeAlias, cast

from ..models import JsonValue

ADAPTER_API_VERSION: Final = "graphengineering.reacher-z.github.io/adapters/v1alpha1"
ADAPTER_CONTRACT_VERSION: Final = "adapter-contract/v1alpha1"

#: ``adapter-capability.schema.json`` — closed at sixteen members.
AdapterCapability: TypeAlias = Literal[
    "attachments",
    "cached-input-usage-reporting",
    "cancellation",
    "content-filter-reporting",
    "deterministic-replay",
    "fault-injection",
    "idempotency-key",
    "parallel-tool-calls",
    "provider-request-id",
    "rate-limit-reporting",
    "reasoning-usage-reporting",
    "retry-after-hint",
    "streaming",
    "structured-output",
    "tool-calling",
    "usage-reporting",
]

#: ``adapter-descriptor.schema.json#/$defs/adapterKind`` — closed at eight kinds.
AdapterKind: TypeAlias = Literal[
    "anthropic",
    "google-gemini",
    "http",
    "mcp",
    "mock",
    "openai",
    "openai-compatible",
    "shell",
]

AdapterEvidenceClass: TypeAlias = Literal["deterministic-mock", "live-provider"]

#: Exactly the vocabulary of
#: ``cycle-controller.schema.json#/$defs/activity/properties/sideEffects``.
SideEffectClass: TypeAlias = Literal["none", "idempotent", "non-idempotent"]

#: ``adapter-error.schema.json#/$defs/errorCode`` — closed at fourteen codes.
AdapterErrorCode: TypeAlias = Literal[
    "GE_ADAPTER_AUTHENTICATION",
    "GE_ADAPTER_BOUNDS_EXCEEDED",
    "GE_ADAPTER_CANCELLED",
    "GE_ADAPTER_CAPABILITY_UNSUPPORTED",
    "GE_ADAPTER_CONTENT_FILTERED",
    "GE_ADAPTER_DESCRIPTOR_INVALID",
    "GE_ADAPTER_INVALID_REQUEST",
    "GE_ADAPTER_MALFORMED_RESPONSE",
    "GE_ADAPTER_POLICY_DENIED",
    "GE_ADAPTER_QUOTA_EXCEEDED",
    "GE_ADAPTER_RATE_LIMITED",
    "GE_ADAPTER_TIMEOUT",
    "GE_ADAPTER_TOOL_VALIDATION_FAILED",
    "GE_ADAPTER_TRANSPORT_FAILURE",
]

AdapterBoundary: TypeAlias = Literal["dispatch", "pre-dispatch"]
EffectDisposition: TypeAlias = Literal["applied", "in-doubt", "not-applied"]
UsageDisposition: TypeAlias = Literal["conservative", "none"]
LedgerAction: TypeAlias = Literal["commit-conservative", "release-reservation"]

#: ``adapter-error.schema.json#/$defs/denialReason`` — closed at eleven reasons.
DenialReason: TypeAlias = Literal[
    "capability-approval",
    "circuit-open",
    "egress-not-allowlisted",
    "environment-not-allowlisted",
    "executable-not-authorized",
    "idempotency-key-missing",
    "mcp-mutation-not-approved",
    "mcp-tool-not-allowlisted",
    "redirect-not-reauthorized",
    "stdin-policy",
    "tls-policy",
]

FinishReason: TypeAlias = Literal[
    "cancelled",
    "content-filter",
    "max-output",
    "stop",
    "tool-calls",
]

#: The subset of ``budget-vector.schema.json`` resources an adapter may observe.
#: ``money-nano-minor`` and every ``maximum``-aggregated resource are absent by
#: construction: an adapter reports meters, never money.
ReportableResource: TypeAlias = Literal[
    "audio-units",
    "cached-input-units",
    "image-units",
    "input-units",
    "output-units",
    "provider-calls",
    "reasoning-units",
    "tool-calls",
    "transport-bytes",
]

ResourceUnit: TypeAlias = Literal["byte", "count", "usage-unit"]

#: Three of the seven public cost states of budget-semantics 7.5.
BudgetCostState: TypeAlias = Literal["estimated", "provider-reported", "unknown"]
UsageTrust: TypeAlias = Literal["adapter-conservative", "provider-reported", "unknown"]

CircuitState: TypeAlias = Literal["closed", "half-open", "open"]
CircuitEvent: TypeAlias = Literal["advance", "failure", "success"]
StreamFrameKind: TypeAlias = Literal["finish", "start", "text-delta", "tool-call", "usage"]
RetryRule: TypeAlias = Literal["R-001", "R-002", "R-003", "R-004", "R-005", "R-006"]


class AdapterDocumentError(ValueError):
    """A document is not shaped like the contract member it claims to be.

    This is a reader defect, never a portable adapter code: a malformed
    *document* is not an adapter outcome.
    """


def _mapping(value: object, where: str) -> Mapping[str, object]:
    if not isinstance(value, Mapping):
        raise AdapterDocumentError(f"{where} must be a JSON object")
    return {str(key): item for key, item in value.items()}


def _sequence(value: object, where: str) -> tuple[object, ...]:
    if isinstance(value, str | bytes) or not isinstance(value, Sequence):
        raise AdapterDocumentError(f"{where} must be a JSON array")
    return tuple(value)


def _member(document: Mapping[str, object], key: str, where: str) -> object:
    if key not in document:
        raise AdapterDocumentError(f"{where} is missing required member '{key}'")
    return document[key]


def _text(document: Mapping[str, object], key: str, where: str) -> str:
    value = _member(document, key, where)
    if not isinstance(value, str):
        raise AdapterDocumentError(f"{where}.{key} must be a string")
    return value


def _optional_text(document: Mapping[str, object], key: str, where: str) -> str | None:
    value = _member(document, key, where)
    if value is None:
        return None
    if not isinstance(value, str):
        raise AdapterDocumentError(f"{where}.{key} must be a string or null")
    return value


def _integer(document: Mapping[str, object], key: str, where: str) -> int:
    value = _member(document, key, where)
    if isinstance(value, bool) or not isinstance(value, int):
        raise AdapterDocumentError(f"{where}.{key} must be an integer")
    return value


def _optional_integer(document: Mapping[str, object], key: str, where: str) -> int | None:
    value = _member(document, key, where)
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int):
        raise AdapterDocumentError(f"{where}.{key} must be an integer or null")
    return value


def _flag(document: Mapping[str, object], key: str, where: str) -> bool:
    value = _member(document, key, where)
    if not isinstance(value, bool):
        raise AdapterDocumentError(f"{where}.{key} must be a boolean")
    return value


def _texts(document: Mapping[str, object], key: str, where: str) -> tuple[str, ...]:
    items = _sequence(_member(document, key, where), f"{where}.{key}")
    for item in items:
        if not isinstance(item, str):
            raise AdapterDocumentError(f"{where}.{key} must contain only strings")
    return tuple(item for item in items if isinstance(item, str))


def _integers(document: Mapping[str, object], key: str, where: str) -> tuple[int, ...]:
    items = _sequence(_member(document, key, where), f"{where}.{key}")
    for item in items:
        if isinstance(item, bool) or not isinstance(item, int):
            raise AdapterDocumentError(f"{where}.{key} must contain only integers")
    return tuple(item for item in items if isinstance(item, int) and not isinstance(item, bool))


# ---------------------------------------------------------------------------
# Descriptor
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class AdapterBounds:
    """Every external byte is bounded in both directions."""

    max_request_bytes: int
    max_response_bytes: int
    max_stream_frame_bytes: int
    max_stream_frames: int
    max_tool_definitions: int
    max_tool_calls_per_response: int
    max_attachments: int
    max_attachment_bytes: int
    request_timeout_ms: int

    @classmethod
    def from_document(cls, value: object) -> AdapterBounds:
        document = _mapping(value, "bounds")
        return cls(
            max_request_bytes=_integer(document, "maxRequestBytes", "bounds"),
            max_response_bytes=_integer(document, "maxResponseBytes", "bounds"),
            max_stream_frame_bytes=_integer(document, "maxStreamFrameBytes", "bounds"),
            max_stream_frames=_integer(document, "maxStreamFrames", "bounds"),
            max_tool_definitions=_integer(document, "maxToolDefinitions", "bounds"),
            max_tool_calls_per_response=_integer(document, "maxToolCallsPerResponse", "bounds"),
            max_attachments=_integer(document, "maxAttachments", "bounds"),
            max_attachment_bytes=_integer(document, "maxAttachmentBytes", "bounds"),
            request_timeout_ms=_integer(document, "requestTimeoutMs", "bounds"),
        )

    def as_document(self) -> dict[str, JsonValue]:
        return {
            "maxRequestBytes": self.max_request_bytes,
            "maxResponseBytes": self.max_response_bytes,
            "maxStreamFrameBytes": self.max_stream_frame_bytes,
            "maxStreamFrames": self.max_stream_frames,
            "maxToolDefinitions": self.max_tool_definitions,
            "maxToolCallsPerResponse": self.max_tool_calls_per_response,
            "maxAttachments": self.max_attachments,
            "maxAttachmentBytes": self.max_attachment_bytes,
            "requestTimeoutMs": self.request_timeout_ms,
        }


@dataclass(frozen=True, slots=True)
class AdapterRetryPolicy:
    """Integer backoff only.  A jittered schedule is not reproducible."""

    max_attempts: int
    initial_backoff_ms: int
    #: Growth factor in thousandths.  Integer arithmetic only.
    backoff_multiplier_milli: int
    max_backoff_ms: int
    jitter: bool

    @classmethod
    def from_document(cls, value: object) -> AdapterRetryPolicy:
        document = _mapping(value, "retryPolicy")
        return cls(
            max_attempts=_integer(document, "maxAttempts", "retryPolicy"),
            initial_backoff_ms=_integer(document, "initialBackoffMs", "retryPolicy"),
            backoff_multiplier_milli=_integer(document, "backoffMultiplierMilli", "retryPolicy"),
            max_backoff_ms=_integer(document, "maxBackoffMs", "retryPolicy"),
            jitter=_flag(document, "jitter", "retryPolicy"),
        )

    def as_document(self) -> dict[str, JsonValue]:
        return {
            "maxAttempts": self.max_attempts,
            "initialBackoffMs": self.initial_backoff_ms,
            "backoffMultiplierMilli": self.backoff_multiplier_milli,
            "maxBackoffMs": self.max_backoff_ms,
            "jitter": self.jitter,
        }


@dataclass(frozen=True, slots=True)
class AdapterCircuitPolicy:
    consecutive_failure_threshold: int
    open_duration_ms: int
    half_open_probe_limit: int

    @classmethod
    def from_document(cls, value: object) -> AdapterCircuitPolicy:
        document = _mapping(value, "circuitPolicy")
        return cls(
            consecutive_failure_threshold=_integer(
                document, "consecutiveFailureThreshold", "circuitPolicy"
            ),
            open_duration_ms=_integer(document, "openDurationMs", "circuitPolicy"),
            half_open_probe_limit=_integer(document, "halfOpenProbeLimit", "circuitPolicy"),
        )

    def as_document(self) -> dict[str, JsonValue]:
        return {
            "consecutiveFailureThreshold": self.consecutive_failure_threshold,
            "openDurationMs": self.open_duration_ms,
            "halfOpenProbeLimit": self.half_open_probe_limit,
        }


@dataclass(frozen=True, slots=True)
class AdapterCapture:
    """Capture is opt-in; there is no implicit retention."""

    enabled: bool
    retention: str

    @classmethod
    def from_document(cls, value: object) -> AdapterCapture:
        document = _mapping(value, "capture")
        return cls(
            enabled=_flag(document, "enabled", "capture"),
            retention=_text(document, "retention", "capture"),
        )

    def as_document(self) -> dict[str, JsonValue]:
        return {"enabled": self.enabled, "retention": self.retention}


@dataclass(frozen=True, slots=True)
class ProviderMetricDeclaration:
    metric_id: str
    unit_id: str
    aggregation: str

    @classmethod
    def from_document(cls, value: object) -> ProviderMetricDeclaration:
        document = _mapping(value, "providerMetric")
        return cls(
            metric_id=_text(document, "metricId", "providerMetric"),
            unit_id=_text(document, "unitId", "providerMetric"),
            aggregation=_text(document, "aggregation", "providerMetric"),
        )

    def as_document(self) -> dict[str, JsonValue]:
        return {
            "metricId": self.metric_id,
            "unitId": self.unit_id,
            "aggregation": self.aggregation,
        }


@dataclass(frozen=True, slots=True)
class NetworkProfile:
    allowed_schemes: tuple[str, ...]
    allowed_hosts: tuple[str, ...]
    allowed_ports: tuple[int, ...]
    allow_redirects: bool
    redirect_reauthorization: bool
    rebinding_defense: bool
    credential_isolation: bool
    tls_minimum_version: str

    @classmethod
    def from_document(cls, value: object) -> NetworkProfile:
        document = _mapping(value, "network")
        return cls(
            allowed_schemes=_texts(document, "allowedSchemes", "network"),
            allowed_hosts=_texts(document, "allowedHosts", "network"),
            allowed_ports=_integers(document, "allowedPorts", "network"),
            allow_redirects=_flag(document, "allowRedirects", "network"),
            redirect_reauthorization=_flag(document, "redirectReauthorization", "network"),
            rebinding_defense=_flag(document, "rebindingDefense", "network"),
            credential_isolation=_flag(document, "credentialIsolation", "network"),
            tls_minimum_version=_text(document, "tlsMinimumVersion", "network"),
        )

    def as_document(self) -> dict[str, JsonValue]:
        return {
            "allowedSchemes": list(self.allowed_schemes),
            "allowedHosts": list(self.allowed_hosts),
            "allowedPorts": list(self.allowed_ports),
            "allowRedirects": self.allow_redirects,
            "redirectReauthorization": self.redirect_reauthorization,
            "rebindingDefense": self.rebinding_defense,
            "credentialIsolation": self.credential_isolation,
            "tlsMinimumVersion": self.tls_minimum_version,
        }


@dataclass(frozen=True, slots=True)
class ProcessProfile:
    executable_path: str
    argument_vector: tuple[str, ...]
    working_directory: str
    environment_allowlist: tuple[str, ...]
    stdin_policy: str
    #: Always false.  There is no implicit shell.
    shell_expansion: bool
    max_output_bytes: int
    max_duration_ms: int
    max_processes: int
    max_memory_bytes: int
    cancel_signal: str

    @classmethod
    def from_document(cls, value: object) -> ProcessProfile:
        document = _mapping(value, "process")
        return cls(
            executable_path=_text(document, "executablePath", "process"),
            argument_vector=_texts(document, "argumentVector", "process"),
            working_directory=_text(document, "workingDirectory", "process"),
            environment_allowlist=_texts(document, "environmentAllowlist", "process"),
            stdin_policy=_text(document, "stdinPolicy", "process"),
            shell_expansion=_flag(document, "shellExpansion", "process"),
            max_output_bytes=_integer(document, "maxOutputBytes", "process"),
            max_duration_ms=_integer(document, "maxDurationMs", "process"),
            max_processes=_integer(document, "maxProcesses", "process"),
            max_memory_bytes=_integer(document, "maxMemoryBytes", "process"),
            cancel_signal=_text(document, "cancelSignal", "process"),
        )

    def as_document(self) -> dict[str, JsonValue]:
        return {
            "executablePath": self.executable_path,
            "argumentVector": list(self.argument_vector),
            "workingDirectory": self.working_directory,
            "environmentAllowlist": list(self.environment_allowlist),
            "stdinPolicy": self.stdin_policy,
            "shellExpansion": self.shell_expansion,
            "maxOutputBytes": self.max_output_bytes,
            "maxDurationMs": self.max_duration_ms,
            "maxProcesses": self.max_processes,
            "maxMemoryBytes": self.max_memory_bytes,
            "cancelSignal": self.cancel_signal,
        }


@dataclass(frozen=True, slots=True)
class McpProfile:
    server_id: str
    mode: str
    allowed_tools: tuple[str, ...]
    approval_required: bool
    idempotency_required: bool

    @classmethod
    def from_document(cls, value: object) -> McpProfile:
        document = _mapping(value, "mcp")
        return cls(
            server_id=_text(document, "serverId", "mcp"),
            mode=_text(document, "mode", "mcp"),
            allowed_tools=_texts(document, "allowedTools", "mcp"),
            approval_required=_flag(document, "approvalRequired", "mcp"),
            idempotency_required=_flag(document, "idempotencyRequired", "mcp"),
        )

    def as_document(self) -> dict[str, JsonValue]:
        return {
            "serverId": self.server_id,
            "mode": self.mode,
            "allowedTools": list(self.allowed_tools),
            "approvalRequired": self.approval_required,
            "idempotencyRequired": self.idempotency_required,
        }


@dataclass(frozen=True, slots=True)
class AdapterDescriptor:
    """What an adapter declares before dispatch."""

    adapter_id: str
    adapter_kind: str
    adapter_version: str
    evidence_class: str
    side_effect_class: str
    capabilities: tuple[str, ...]
    bounds: AdapterBounds
    retry_policy: AdapterRetryPolicy
    circuit_policy: AdapterCircuitPolicy
    capture: AdapterCapture
    allowed_provider_metrics: tuple[ProviderMetricDeclaration, ...]
    network: NetworkProfile | None
    process: ProcessProfile | None
    mcp: McpProfile | None

    @classmethod
    def from_document(cls, value: object) -> AdapterDescriptor:
        document = _mapping(value, "descriptor")
        network = _member(document, "network", "descriptor")
        process = _member(document, "process", "descriptor")
        mcp = _member(document, "mcp", "descriptor")
        metrics = _sequence(
            _member(document, "allowedProviderMetrics", "descriptor"),
            "descriptor.allowedProviderMetrics",
        )
        return cls(
            adapter_id=_text(document, "adapterId", "descriptor"),
            adapter_kind=_text(document, "adapterKind", "descriptor"),
            adapter_version=_text(document, "adapterVersion", "descriptor"),
            evidence_class=_text(document, "evidenceClass", "descriptor"),
            side_effect_class=_text(document, "sideEffectClass", "descriptor"),
            capabilities=_texts(document, "capabilities", "descriptor"),
            bounds=AdapterBounds.from_document(_member(document, "bounds", "descriptor")),
            retry_policy=AdapterRetryPolicy.from_document(
                _member(document, "retryPolicy", "descriptor")
            ),
            circuit_policy=AdapterCircuitPolicy.from_document(
                _member(document, "circuitPolicy", "descriptor")
            ),
            capture=AdapterCapture.from_document(_member(document, "capture", "descriptor")),
            allowed_provider_metrics=tuple(
                ProviderMetricDeclaration.from_document(item) for item in metrics
            ),
            network=None if network is None else NetworkProfile.from_document(network),
            process=None if process is None else ProcessProfile.from_document(process),
            mcp=None if mcp is None else McpProfile.from_document(mcp),
        )

    def as_document(self) -> dict[str, JsonValue]:
        return {
            "apiVersion": ADAPTER_API_VERSION,
            "kind": "AdapterDescriptor",
            "contractVersion": ADAPTER_CONTRACT_VERSION,
            "adapterId": self.adapter_id,
            "adapterKind": self.adapter_kind,
            "adapterVersion": self.adapter_version,
            "evidenceClass": self.evidence_class,
            "sideEffectClass": self.side_effect_class,
            "capabilities": list(self.capabilities),
            "bounds": self.bounds.as_document(),
            "retryPolicy": self.retry_policy.as_document(),
            "circuitPolicy": self.circuit_policy.as_document(),
            "capture": self.capture.as_document(),
            "allowedProviderMetrics": [
                metric.as_document() for metric in self.allowed_provider_metrics
            ],
            "network": None if self.network is None else self.network.as_document(),
            "process": None if self.process is None else self.process.as_document(),
            "mcp": None if self.mcp is None else self.mcp.as_document(),
        }

    def declares(self, capability: str) -> bool:
        return capability in self.capabilities


# ---------------------------------------------------------------------------
# Request
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class ToolDefinition:
    name: str
    required_arguments: tuple[str, ...]
    allowed_arguments: tuple[str, ...]

    @classmethod
    def from_document(cls, value: object) -> ToolDefinition:
        document = _mapping(value, "toolDefinition")
        return cls(
            name=_text(document, "name", "toolDefinition"),
            required_arguments=_texts(document, "requiredArguments", "toolDefinition"),
            allowed_arguments=_texts(document, "allowedArguments", "toolDefinition"),
        )


@dataclass(frozen=True, slots=True)
class RequestAttachment:
    bytes: int

    @classmethod
    def from_document(cls, value: object) -> RequestAttachment:
        document = _mapping(value, "attachment")
        return cls(bytes=_integer(document, "bytes", "attachment"))


@dataclass(frozen=True, slots=True)
class EgressTarget:
    scheme: str
    host: str
    port: int
    redirected: bool
    reauthorized: bool

    @classmethod
    def from_document(cls, value: object) -> EgressTarget:
        document = _mapping(value, "target")
        return cls(
            scheme=_text(document, "scheme", "target"),
            host=_text(document, "host", "target"),
            port=_integer(document, "port", "target"),
            redirected=_flag(document, "redirected", "target"),
            reauthorized=_flag(document, "reauthorized", "target"),
        )


@dataclass(frozen=True, slots=True)
class McpCall:
    tool: str
    mutating: bool
    approval_token: str | None

    @classmethod
    def from_document(cls, value: object) -> McpCall:
        document = _mapping(value, "mcpCall")
        return cls(
            tool=_text(document, "tool", "mcpCall"),
            mutating=_flag(document, "mutating", "mcpCall"),
            approval_token=_optional_text(document, "approvalToken", "mcpCall"),
        )


@dataclass(frozen=True, slots=True)
class ProcessCall:
    argument_vector: tuple[str, ...]
    environment: tuple[str, ...]
    stdin_bytes: int

    @classmethod
    def from_document(cls, value: object) -> ProcessCall:
        document = _mapping(value, "processCall")
        return cls(
            argument_vector=_texts(document, "argumentVector", "processCall"),
            environment=_texts(document, "environment", "processCall"),
            stdin_bytes=_integer(document, "stdinBytes", "processCall"),
        )


@dataclass(frozen=True, slots=True)
class AdapterRequest:
    """The preflight view of a request.

    It carries only what the boundary rules of adapter-semantics 4 and 5 read;
    payload content is deliberately absent so a refusal can never quote a
    prompt.
    """

    request_id: str
    side_effect_class: str
    required_capabilities: tuple[str, ...] = ()
    request_bytes: int = 0
    attachments: tuple[RequestAttachment, ...] = ()
    tool_definitions: tuple[ToolDefinition, ...] = ()
    streaming: bool = False
    structured_output: bool = False
    cancellable: bool = False
    idempotency_key: str | None = None
    circuit_state: str = "closed"
    target: EgressTarget | None = None
    mcp_call: McpCall | None = None
    process_call: ProcessCall | None = None

    @classmethod
    def from_document(cls, value: object) -> AdapterRequest:
        document = _mapping(value, "request")
        target = _member(document, "target", "request")
        mcp_call = _member(document, "mcpCall", "request")
        process_call = _member(document, "processCall", "request")
        attachments = _sequence(
            _member(document, "attachments", "request"), "request.attachments"
        )
        definitions = _sequence(
            _member(document, "toolDefinitions", "request"), "request.toolDefinitions"
        )
        return cls(
            request_id=_text(document, "requestId", "request"),
            side_effect_class=_text(document, "sideEffectClass", "request"),
            required_capabilities=_texts(document, "requiredCapabilities", "request"),
            request_bytes=_integer(document, "requestBytes", "request"),
            attachments=tuple(RequestAttachment.from_document(item) for item in attachments),
            tool_definitions=tuple(ToolDefinition.from_document(item) for item in definitions),
            streaming=_flag(document, "streaming", "request"),
            structured_output=_flag(document, "structuredOutput", "request"),
            cancellable=_flag(document, "cancellable", "request"),
            idempotency_key=_optional_text(document, "idempotencyKey", "request"),
            circuit_state=_text(document, "circuitState", "request"),
            target=None if target is None else EgressTarget.from_document(target),
            mcp_call=None if mcp_call is None else McpCall.from_document(mcp_call),
            process_call=None if process_call is None else ProcessCall.from_document(process_call),
        )


@dataclass(frozen=True, slots=True)
class PreflightOutcome:
    admitted: bool
    adapter_id: str
    request_id: str
    side_effect_class: str
    idempotency_key: str | None


# ---------------------------------------------------------------------------
# Stream
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class StreamFrame:
    sequence: int
    kind: str
    bytes: int
    tool_call_id: str | None = None
    finish_reason: str | None = None

    @classmethod
    def from_document(cls, value: object) -> StreamFrame:
        document = _mapping(value, "streamFrame")
        tool_call_id = document.get("toolCallId")
        finish_reason = document.get("finishReason")
        if tool_call_id is not None and not isinstance(tool_call_id, str):
            raise AdapterDocumentError("streamFrame.toolCallId must be a string")
        if finish_reason is not None and not isinstance(finish_reason, str):
            raise AdapterDocumentError("streamFrame.finishReason must be a string")
        return cls(
            sequence=_integer(document, "sequence", "streamFrame"),
            kind=_text(document, "kind", "streamFrame"),
            bytes=_integer(document, "bytes", "streamFrame"),
            tool_call_id=tool_call_id,
            finish_reason=finish_reason,
        )

    def as_document(self) -> dict[str, JsonValue]:
        document: dict[str, JsonValue] = {
            "sequence": self.sequence,
            "kind": self.kind,
            "bytes": self.bytes,
        }
        if self.tool_call_id is not None:
            document["toolCallId"] = self.tool_call_id
        if self.finish_reason is not None:
            document["finishReason"] = self.finish_reason
        return document


@dataclass(frozen=True, slots=True)
class NormalizedStream:
    frames: int
    text_bytes: int
    tool_calls: int
    usage_frames: int
    finish_reason: str | None

    def as_document(self) -> dict[str, JsonValue]:
        return {
            "frames": self.frames,
            "textBytes": self.text_bytes,
            "toolCalls": self.tool_calls,
            "usageFrames": self.usage_frames,
            "finishReason": self.finish_reason,
        }


# ---------------------------------------------------------------------------
# Usage
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class UsageQuantity:
    resource: str
    unit: str
    aggregation: str
    amount: int

    @classmethod
    def from_document(cls, value: object) -> UsageQuantity:
        document = _mapping(value, "quantity")
        return cls(
            resource=_text(document, "resource", "quantity"),
            unit=_text(document, "unit", "quantity"),
            aggregation=_text(document, "aggregation", "quantity"),
            amount=_integer(document, "amount", "quantity"),
        )

    def as_document(self) -> dict[str, JsonValue]:
        return {
            "resource": self.resource,
            "unit": self.unit,
            "aggregation": self.aggregation,
            "amount": self.amount,
        }


@dataclass(frozen=True, slots=True)
class ProviderQuantity:
    metric_id: str
    unit_id: str
    aggregation: str
    amount: int

    @classmethod
    def from_document(cls, value: object) -> ProviderQuantity:
        document = _mapping(value, "providerQuantity")
        return cls(
            metric_id=_text(document, "metricId", "providerQuantity"),
            unit_id=_text(document, "unitId", "providerQuantity"),
            aggregation=_text(document, "aggregation", "providerQuantity"),
            amount=_integer(document, "amount", "providerQuantity"),
        )

    def as_document(self) -> dict[str, JsonValue]:
        return {
            "metricId": self.metric_id,
            "unitId": self.unit_id,
            "aggregation": self.aggregation,
            "amount": self.amount,
        }


@dataclass(frozen=True, slots=True)
class AdapterUsage:
    """The meters an adapter observed for one attempt.

    There is no ``currency`` member, no ``minorUnitExponent`` and no
    ``money-nano-minor`` entry: an adapter reports meters, never money.
    """

    adapter_id: str
    adapter_kind: str
    request_id: str
    provider_request_id: str | None
    trust: str
    budget_cost_state: str
    finish_reason: str | None
    quantities: tuple[UsageQuantity, ...]
    provider_specific: tuple[ProviderQuantity, ...] = ()

    @classmethod
    def from_document(cls, value: object) -> AdapterUsage:
        document = _mapping(value, "usage")
        quantities = _sequence(_member(document, "quantities", "usage"), "usage.quantities")
        provider = _sequence(
            _member(document, "providerSpecific", "usage"), "usage.providerSpecific"
        )
        return cls(
            adapter_id=_text(document, "adapterId", "usage"),
            adapter_kind=_text(document, "adapterKind", "usage"),
            request_id=_text(document, "requestId", "usage"),
            provider_request_id=_optional_text(document, "providerRequestId", "usage"),
            trust=_text(document, "trust", "usage"),
            budget_cost_state=_text(document, "budgetCostState", "usage"),
            finish_reason=_optional_text(document, "finishReason", "usage"),
            quantities=tuple(UsageQuantity.from_document(item) for item in quantities),
            provider_specific=tuple(ProviderQuantity.from_document(item) for item in provider),
        )

    def as_document(self) -> dict[str, JsonValue]:
        return {
            "apiVersion": ADAPTER_API_VERSION,
            "kind": "AdapterUsage",
            "contractVersion": ADAPTER_CONTRACT_VERSION,
            "adapterId": self.adapter_id,
            "adapterKind": self.adapter_kind,
            "requestId": self.request_id,
            "providerRequestId": self.provider_request_id,
            "trust": self.trust,
            "budgetCostState": self.budget_cost_state,
            "finishReason": self.finish_reason,
            "quantities": [quantity.as_document() for quantity in self.quantities],
            "providerSpecific": [metric.as_document() for metric in self.provider_specific],
        }


@dataclass(frozen=True, slots=True)
class NormalizedUsage:
    resources: int
    provider_calls: int | None
    budget_cost_state: str

    def as_document(self) -> dict[str, JsonValue]:
        return {
            "resources": self.resources,
            "providerCalls": self.provider_calls,
            "budgetCostState": self.budget_cost_state,
        }


# ---------------------------------------------------------------------------
# Tool calls
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class ModelToolCall:
    id: str
    name: str
    arguments: Mapping[str, JsonValue] = field(default_factory=dict)

    @classmethod
    def from_document(cls, value: object) -> ModelToolCall:
        document = _mapping(value, "toolCall")
        arguments = _mapping(_member(document, "arguments", "toolCall"), "toolCall.arguments")
        return cls(
            id=_text(document, "id", "toolCall"),
            name=_text(document, "name", "toolCall"),
            arguments=cast("Mapping[str, JsonValue]", arguments),
        )


@dataclass(frozen=True, slots=True)
class ToolCallResponse:
    tool_calls: tuple[ModelToolCall, ...]
    #: Authority comes from policy; a model-selected tool never grants it.
    authorized_tools: tuple[str, ...]

    @classmethod
    def from_document(cls, value: object) -> ToolCallResponse:
        document = _mapping(value, "toolResponse")
        calls = _sequence(_member(document, "toolCalls", "toolResponse"), "toolResponse.toolCalls")
        return cls(
            tool_calls=tuple(ModelToolCall.from_document(item) for item in calls),
            authorized_tools=_texts(document, "authorizedTools", "toolResponse"),
        )


@dataclass(frozen=True, slots=True)
class NormalizedToolCalls:
    tool_calls: int


# ---------------------------------------------------------------------------
# Error envelope
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class ProviderSafeField:
    name: str
    value: str

    @classmethod
    def from_document(cls, value: object) -> ProviderSafeField:
        document = _mapping(value, "providerSafeField")
        return cls(
            name=_text(document, "name", "providerSafeField"),
            value=_text(document, "value", "providerSafeField"),
        )

    def as_document(self) -> dict[str, JsonValue]:
        return {"name": self.name, "value": self.value}


@dataclass(frozen=True, slots=True)
class AdapterErrorEnvelope:
    adapter_id: str
    adapter_kind: str
    request_id: str
    attempt: int
    code: str
    boundary: str
    retryable: bool
    effect_disposition: str
    usage_disposition: str
    side_effect_class: str
    denial_reason: str | None
    provider_request_id: str | None
    retry_after_ms: int | None
    message: str
    provider_safe_fields: tuple[ProviderSafeField, ...]
    usage: AdapterUsage | None

    @classmethod
    def from_document(cls, value: object) -> AdapterErrorEnvelope:
        document = _mapping(value, "error")
        detail = _mapping(_member(document, "detail", "error"), "error.detail")
        fields = _sequence(
            _member(detail, "providerSafeFields", "error.detail"),
            "error.detail.providerSafeFields",
        )
        usage = _member(document, "usage", "error")
        return cls(
            adapter_id=_text(document, "adapterId", "error"),
            adapter_kind=_text(document, "adapterKind", "error"),
            request_id=_text(document, "requestId", "error"),
            attempt=_integer(document, "attempt", "error"),
            code=_text(document, "code", "error"),
            boundary=_text(document, "boundary", "error"),
            retryable=_flag(document, "retryable", "error"),
            effect_disposition=_text(document, "effectDisposition", "error"),
            usage_disposition=_text(document, "usageDisposition", "error"),
            side_effect_class=_text(document, "sideEffectClass", "error"),
            denial_reason=_optional_text(document, "denialReason", "error"),
            provider_request_id=_optional_text(document, "providerRequestId", "error"),
            retry_after_ms=_optional_integer(document, "retryAfterMs", "error"),
            message=_text(document, "message", "error"),
            provider_safe_fields=tuple(ProviderSafeField.from_document(item) for item in fields),
            usage=None if usage is None else AdapterUsage.from_document(usage),
        )

    def as_document(self) -> dict[str, JsonValue]:
        return {
            "apiVersion": ADAPTER_API_VERSION,
            "kind": "AdapterError",
            "contractVersion": ADAPTER_CONTRACT_VERSION,
            "adapterId": self.adapter_id,
            "adapterKind": self.adapter_kind,
            "requestId": self.request_id,
            "attempt": self.attempt,
            "code": self.code,
            "boundary": self.boundary,
            "retryable": self.retryable,
            "effectDisposition": self.effect_disposition,
            "usageDisposition": self.usage_disposition,
            "sideEffectClass": self.side_effect_class,
            "denialReason": self.denial_reason,
            "providerRequestId": self.provider_request_id,
            "retryAfterMs": self.retry_after_ms,
            "message": self.message,
            "detail": {
                "providerSafeFields": [item.as_document() for item in self.provider_safe_fields]
            },
            "usage": None if self.usage is None else self.usage.as_document(),
        }


@dataclass(frozen=True, slots=True)
class NormalizedErrorOutcome:
    code: str
    ledger_action: str
    #: cycle-semantics 13.4: ``none`` creates no in-doubt evidence; an external
    #: ``idempotent`` or ``non-idempotent`` claim retains one in-doubt identity.
    requires_in_doubt_record: bool

    def as_document(self) -> dict[str, JsonValue]:
        return {
            "code": self.code,
            "ledgerAction": self.ledger_action,
            "requiresInDoubtRecord": self.requires_in_doubt_record,
        }


# ---------------------------------------------------------------------------
# Retry and circuit decisions
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class RetryDecision:
    may_retry: bool
    backoff_ms: int | None
    rule: str

    def as_document(self) -> dict[str, JsonValue]:
        return {"mayRetry": self.may_retry, "backoffMs": self.backoff_ms, "rule": self.rule}


@dataclass(frozen=True, slots=True)
class CircuitStep:
    event: str
    now_ms: int
    code: str | None = None

    @classmethod
    def from_document(cls, value: object) -> CircuitStep:
        document = _mapping(value, "circuitStep")
        code = document.get("code")
        if code is not None and not isinstance(code, str):
            raise AdapterDocumentError("circuitStep.code must be a string")
        return cls(
            event=_text(document, "event", "circuitStep"),
            now_ms=_integer(document, "nowMs", "circuitStep"),
            code=code,
        )


@dataclass(frozen=True, slots=True)
class CircuitProjection:
    state: str
    consecutive_failures: int
    opened_at_ms: int | None
    admitted: int
    refused: int

    def as_document(self) -> dict[str, JsonValue]:
        return {
            "state": self.state,
            "consecutiveFailures": self.consecutive_failures,
            "openedAtMs": self.opened_at_ms,
            "admitted": self.admitted,
            "refused": self.refused,
        }
