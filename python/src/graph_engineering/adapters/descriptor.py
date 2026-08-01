"""Descriptor obligations, rules ``D-001`` through ``D-033``.

Shape validity never implies semantic validity: a descriptor that validates
against ``adapter-descriptor.schema.json`` and violates adapter-semantics 5 is
``GE_ADAPTER_DESCRIPTOR_INVALID``, and no request may be dispatched through it.
"""

from __future__ import annotations

from collections.abc import Sequence
from itertools import pairwise
from typing import Final

from .contract import (
    CAPABILITY_IMPLICATIONS,
    MOCK_ONLY_CAPABILITIES,
    MODEL_ADAPTER_KINDS,
    is_non_routable_host,
)
from .errors import fail
from .ordering import is_sorted_by_code_point
from .types import AdapterDescriptor, AdapterErrorCode, ProviderMetricDeclaration

_INVALID: Final[AdapterErrorCode] = "GE_ADAPTER_DESCRIPTOR_INVALID"
_NUL = "\x00"


def _metric_key(metric: ProviderMetricDeclaration) -> str:
    return f"{metric.metric_id}{_NUL}{metric.unit_id}"


def validate_descriptor(descriptor: AdapterDescriptor) -> bool:
    """Raise ``AdapterContractError`` on the first violated rule."""
    capabilities = descriptor.capabilities
    declared = frozenset(capabilities)

    if not is_sorted_by_code_point(capabilities):
        fail(
            _INVALID,
            "D-001",
            f"adapter {descriptor.adapter_id!r} capabilities are not in Unicode code-point order",
        )

    if descriptor.evidence_class == "deterministic-mock" and descriptor.network is not None:
        for host in descriptor.network.allowed_hosts:
            if not is_non_routable_host(host):
                fail(
                    _INVALID,
                    "D-002",
                    f"deterministic-mock adapter {descriptor.adapter_id!r} "
                    f"allows routable host {host!r}",
                )

    kind = descriptor.adapter_kind
    if kind == "mock" and (
        descriptor.network is not None
        or descriptor.process is not None
        or descriptor.mcp is not None
    ):
        fail(_INVALID, "D-003", "a mock adapter declares no network, process or MCP profile")
    if kind == "http" and (
        descriptor.network is None or descriptor.process is not None or descriptor.mcp is not None
    ):
        fail(
            _INVALID,
            "D-004",
            "an http adapter declares exactly one network profile and no process or MCP profile",
        )
    if kind == "shell" and (
        descriptor.process is None or descriptor.network is not None or descriptor.mcp is not None
    ):
        fail(
            _INVALID,
            "D-005",
            "a shell adapter declares exactly one process profile and no network or MCP profile",
        )
    if kind == "mcp" and (
        descriptor.mcp is None or descriptor.network is not None or descriptor.process is not None
    ):
        fail(
            _INVALID,
            "D-006",
            "an mcp adapter declares exactly one MCP profile and no network or process profile",
        )
    if kind in MODEL_ADAPTER_KINDS and (
        descriptor.network is None or descriptor.process is not None or descriptor.mcp is not None
    ):
        fail(_INVALID, "D-007", f"model adapter kind {kind!r} declares exactly one network profile")

    if descriptor.side_effect_class == "idempotent" and "idempotency-key" not in declared:
        fail(
            _INVALID,
            "D-008",
            "an idempotent adapter must be able to pass a stable idempotency key",
        )

    for implication in CAPABILITY_IMPLICATIONS:
        if implication.capability in declared and implication.requires not in declared:
            fail(
                _INVALID,
                implication.rule,
                f"capability {implication.capability!r} requires {implication.requires!r}",
            )

    for entry in MOCK_ONLY_CAPABILITIES:
        if entry.capability in declared and descriptor.evidence_class != "deterministic-mock":
            fail(
                _INVALID,
                entry.rule,
                f"capability {entry.capability!r} is available only to a "
                "deterministic-mock adapter",
            )

    if descriptor.retry_policy.max_backoff_ms < descriptor.retry_policy.initial_backoff_ms:
        fail(_INVALID, "D-015", "maxBackoffMs must not be below initialBackoffMs")

    if descriptor.capture.enabled != (descriptor.capture.retention != "none"):
        fail(_INVALID, "D-016", "capture.enabled and a non-none retention disposition must agree")

    network = descriptor.network
    if network is not None:
        if network.rebinding_defense is not True:
            fail(_INVALID, "D-017", "a network adapter must declare DNS and IP rebinding defense")
        if network.credential_isolation is not True:
            fail(
                _INVALID,
                "D-018",
                "a network adapter must isolate headers and credentials per host",
            )
        if network.allow_redirects is True and network.redirect_reauthorization is not True:
            fail(_INVALID, "D-019", "redirects are permitted only with redirect re-authorization")
        if "http" in network.allowed_schemes:
            for host in network.allowed_hosts:
                if not is_non_routable_host(host):
                    fail(
                        _INVALID,
                        "D-020",
                        f"plaintext http is permitted only for non-routable hosts, not {host!r}",
                    )
        if not is_sorted_by_code_point(network.allowed_schemes) or not is_sorted_by_code_point(
            network.allowed_hosts
        ):
            fail(_INVALID, "D-021", "network schemes and hosts must be in Unicode code-point order")
        if not _strictly_ascending(network.allowed_ports):
            fail(_INVALID, "D-021", "network ports must be strictly ascending")

    process = descriptor.process
    if process is not None:
        first = process.argument_vector[0] if process.argument_vector else None
        if first != process.executable_path:
            fail(_INVALID, "D-022", "argumentVector[0] must be the explicit executable identity")
        if not is_sorted_by_code_point(process.environment_allowlist):
            fail(_INVALID, "D-023", "environmentAllowlist must be in Unicode code-point order")

    mcp = descriptor.mcp
    if mcp is not None:
        if mcp.mode == "mutating":
            if mcp.approval_required is not True:
                fail(_INVALID, "D-024", "a mutating MCP adapter must require approval")
            if mcp.idempotency_required is not True:
                fail(_INVALID, "D-025", "a mutating MCP adapter must require an idempotency gate")
            if len(mcp.allowed_tools) == 0:
                fail(
                    _INVALID,
                    "D-026",
                    "a mutating MCP adapter must name the exact tools it may mutate through",
                )
        if mcp.mode == "read-only" and descriptor.side_effect_class == "non-idempotent":
            fail(
                _INVALID,
                "D-027",
                "a read-only MCP adapter cannot declare non-idempotent side effects",
            )

    if not is_sorted_by_code_point(
        [_metric_key(metric) for metric in descriptor.allowed_provider_metrics]
    ):
        fail(
            _INVALID,
            "D-028",
            "allowedProviderMetrics must be unique and ordered by metricId + U+0000 + unitId",
        )

    if "streaming" in declared and descriptor.bounds.max_stream_frames < 2:
        fail(
            _INVALID,
            "D-030",
            "a streaming adapter must admit at least a start and a finish frame",
        )
    if "tool-calling" not in declared and (
        descriptor.bounds.max_tool_definitions != 0
        or descriptor.bounds.max_tool_calls_per_response != 0
    ):
        fail(
            _INVALID,
            "D-031",
            "an adapter without tool-calling must bound tool definitions and tool calls at zero",
        )
    if "attachments" not in declared and descriptor.bounds.max_attachments != 0:
        fail(_INVALID, "D-032", "an adapter without attachments must bound attachments at zero")
    if descriptor.bounds.max_stream_frame_bytes > descriptor.bounds.max_response_bytes:
        fail(_INVALID, "D-033", "a single stream frame cannot exceed the whole response bound")
    return True


def _strictly_ascending(values: Sequence[int]) -> bool:
    return all(previous < current for previous, current in pairwise(values))


def validate_descriptor_against_budget_policy(
    descriptor: AdapterDescriptor,
    policy_metrics: Sequence[ProviderMetricDeclaration],
) -> bool:
    """``D-029``.

    The active budget policy allowlist is caller state rather than descriptor
    state, so it is a separate entry point.  An adapter narrows the policy and
    can never widen it.
    """
    allowed = {
        f"{_metric_key(metric)}{_NUL}{metric.aggregation}" for metric in policy_metrics
    }
    for metric in descriptor.allowed_provider_metrics:
        if f"{_metric_key(metric)}{_NUL}{metric.aggregation}" not in allowed:
            fail(
                _INVALID,
                "D-029",
                f"provider metric {metric.metric_id!r} is not in the active "
                "budget policy allowlist",
            )
    return True
