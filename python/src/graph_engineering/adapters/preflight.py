"""Dispatch preflight, rules ``P-001`` through ``P-029``.

Preflight refuses, before any external effect, every request the descriptor does
not authorize.  adapter-semantics 4.1: capability refusal is a preflight fact,
so a refused call performs zero provider requests, zero usage and zero ledger
writes, and a caller cannot reach an undeclared capability by any request shape.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from .contract import escalates_side_effect
from .descriptor import validate_descriptor, validate_descriptor_against_budget_policy
from .errors import fail
from .types import (
    AdapterCapability,
    AdapterDescriptor,
    AdapterRequest,
    PreflightOutcome,
    ProviderMetricDeclaration,
)

#: U+0000, written as an escape so no source file carries a raw NUL byte.
_NUL = "\x00"


def capability_failure_message(capability: str, request_id: str, adapter_id: str) -> str:
    """The exact message adapter-semantics 4.1 pins."""
    return (
        f"Adapter capability '{capability}' required by request '{request_id}' "
        f"is not declared by adapter '{adapter_id}'"
    )


@dataclass(frozen=True, slots=True)
class _ImpliedCapability:
    rule: str
    active: bool
    capability: AdapterCapability


def preflight(
    descriptor: AdapterDescriptor,
    request: AdapterRequest,
    policy_metrics: Sequence[ProviderMetricDeclaration] = (),
) -> PreflightOutcome:
    """Admit a request or raise the first rule it violates.

    Requiring a capability is both explicit (``requiredCapabilities``) and
    implied by the request shape.  ``P-001`` through ``P-006`` and ``P-029`` are
    distinct so that deleting any one of them is observable.
    """
    # An invalid descriptor is refused before any request rule runs, so a broken
    # adapter can never reach a provider by supplying a benign request.
    validate_descriptor(descriptor)
    validate_descriptor_against_budget_policy(descriptor, policy_metrics)

    declared = frozenset(descriptor.capabilities)
    missing = sorted(
        capability
        for capability in request.required_capabilities
        if capability not in declared
    )
    if missing:
        fail(
            "GE_ADAPTER_CAPABILITY_UNSUPPORTED",
            "P-001",
            capability_failure_message(missing[0], request.request_id, descriptor.adapter_id),
        )

    implied = (
        _ImpliedCapability("P-002", request.streaming is True, "streaming"),
        _ImpliedCapability("P-003", request.structured_output is True, "structured-output"),
        _ImpliedCapability("P-004", len(request.tool_definitions) > 0, "tool-calling"),
        _ImpliedCapability("P-005", len(request.attachments) > 0, "attachments"),
        _ImpliedCapability("P-006", request.cancellable is True, "cancellation"),
        _ImpliedCapability("P-029", request.idempotency_key is not None, "idempotency-key"),
    )
    for entry in implied:
        if entry.active and entry.capability not in declared:
            fail(
                "GE_ADAPTER_CAPABILITY_UNSUPPORTED",
                entry.rule,
                capability_failure_message(
                    entry.capability, request.request_id, descriptor.adapter_id
                ),
            )

    if escalates_side_effect(request.side_effect_class, descriptor.side_effect_class):
        fail(
            "GE_ADAPTER_POLICY_DENIED",
            "P-007",
            "a request cannot escalate beyond the side-effect class the adapter is authorized for",
            "capability-approval",
        )

    bounds = descriptor.bounds
    if request.request_bytes > bounds.max_request_bytes:
        fail("GE_ADAPTER_BOUNDS_EXCEEDED", "P-008", "request exceeds maxRequestBytes")
    if len(request.attachments) > bounds.max_attachments:
        fail("GE_ADAPTER_BOUNDS_EXCEEDED", "P-009", "request exceeds maxAttachments")
    attachment_bytes = 0
    for attachment in request.attachments:
        attachment_bytes += attachment.bytes
        if (
            attachment.bytes > bounds.max_attachment_bytes
            or attachment_bytes > bounds.max_attachment_bytes
        ):
            fail(
                "GE_ADAPTER_BOUNDS_EXCEEDED",
                "P-010",
                "attachment payload exceeds maxAttachmentBytes",
            )
    if len(request.tool_definitions) > bounds.max_tool_definitions:
        fail("GE_ADAPTER_BOUNDS_EXCEEDED", "P-011", "request exceeds maxToolDefinitions")
    definition_names = [definition.name for definition in request.tool_definitions]
    if len(set(definition_names)) != len(definition_names):
        fail("GE_ADAPTER_TOOL_VALIDATION_FAILED", "P-012", "tool definition names must be unique")

    if request.circuit_state == "open":
        fail("GE_ADAPTER_POLICY_DENIED", "P-013", "the adapter circuit is open", "circuit-open")

    target = request.target
    if target is not None:
        network = descriptor.network
        if network is None or target.scheme not in network.allowed_schemes:
            fail(
                "GE_ADAPTER_POLICY_DENIED",
                "P-014",
                f"scheme {target.scheme!r} is not allowlisted",
                "egress-not-allowlisted",
            )
        if target.host not in network.allowed_hosts:
            fail(
                "GE_ADAPTER_POLICY_DENIED",
                "P-015",
                f"host {target.host!r} is not allowlisted",
                "egress-not-allowlisted",
            )
        if target.port not in network.allowed_ports:
            fail(
                "GE_ADAPTER_POLICY_DENIED",
                "P-016",
                f"port {target.port} is not allowlisted",
                "egress-not-allowlisted",
            )
        if target.redirected is True and network.allow_redirects is not True:
            fail(
                "GE_ADAPTER_POLICY_DENIED",
                "P-018",
                "this adapter does not follow redirects",
                "egress-not-allowlisted",
            )
        if target.redirected is True and target.reauthorized is not True:
            fail(
                "GE_ADAPTER_POLICY_DENIED",
                "P-017",
                "a redirect target must be re-authorized against the allowlist",
                "redirect-not-reauthorized",
            )
        if target.redirected is True and target.scheme == "http":
            # `D-020` already refuses a descriptor that allowlists plaintext to a
            # routable host.  What remains reachable at dispatch time is a
            # redirect that downgrades an https request onto an allowlisted
            # plaintext origin.
            fail(
                "GE_ADAPTER_POLICY_DENIED",
                "P-019",
                "a redirect may not downgrade the transport to plaintext",
                "tls-policy",
            )

    call = request.mcp_call
    if call is not None:
        mcp = descriptor.mcp
        if mcp is None or call.tool not in mcp.allowed_tools:
            fail(
                "GE_ADAPTER_POLICY_DENIED",
                "P-020",
                f"MCP tool {call.tool!r} is not allowlisted",
                "mcp-tool-not-allowlisted",
            )
        if call.mutating is True and mcp.mode != "mutating":
            fail(
                "GE_ADAPTER_POLICY_DENIED",
                "P-021",
                "a read-only MCP adapter refuses a mutating call",
                "mcp-mutation-not-approved",
            )
        if call.mutating is True and call.approval_token is None:
            fail(
                "GE_ADAPTER_POLICY_DENIED",
                "P-022",
                "a mutating MCP call requires an approval token",
                "mcp-mutation-not-approved",
            )

    process_call = request.process_call
    if process_call is not None:
        profile = descriptor.process
        first = process_call.argument_vector[0] if process_call.argument_vector else None
        if profile is None or first != profile.executable_path:
            fail(
                "GE_ADAPTER_POLICY_DENIED",
                "P-023",
                "the call does not name the adapter's explicit executable identity",
                "executable-not-authorized",
            )
        for index, declared_argument in enumerate(profile.argument_vector):
            supplied = (
                process_call.argument_vector[index]
                if index < len(process_call.argument_vector)
                else None
            )
            if supplied != declared_argument:
                fail(
                    "GE_ADAPTER_POLICY_DENIED",
                    "P-024",
                    "the declared argument vector must be an exact prefix of the call",
                    "executable-not-authorized",
                )
        for name in process_call.environment:
            if name not in profile.environment_allowlist:
                fail(
                    "GE_ADAPTER_POLICY_DENIED",
                    "P-025",
                    f"environment variable {name!r} is not allowlisted",
                    "environment-not-allowlisted",
                )
        if profile.stdin_policy == "closed" and process_call.stdin_bytes > 0:
            fail(
                "GE_ADAPTER_POLICY_DENIED",
                "P-026",
                "this adapter runs with stdin closed",
                "stdin-policy",
            )
        for argument in process_call.argument_vector:
            if _NUL in argument:
                fail(
                    "GE_ADAPTER_POLICY_DENIED",
                    "P-027",
                    "an argument contains a NUL byte",
                    "executable-not-authorized",
                )

    if request.side_effect_class == "idempotent" and request.idempotency_key is None:
        fail(
            "GE_ADAPTER_POLICY_DENIED",
            "P-028",
            "an idempotent request must carry a stable idempotency key",
            "idempotency-key-missing",
        )

    return PreflightOutcome(
        admitted=True,
        adapter_id=descriptor.adapter_id,
        request_id=request.request_id,
        side_effect_class=request.side_effect_class,
        idempotency_key=request.idempotency_key,
    )
