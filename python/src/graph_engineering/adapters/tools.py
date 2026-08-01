"""Model-emitted tool-call validation, rules ``T-001`` through ``T-006``.

adapter-semantics 6.4: every model-emitted tool call is validated before the
tool runs.  Authority comes from policy and never from the model or from a tool
description.
"""

from __future__ import annotations

from typing import Final

from .errors import fail
from .types import (
    AdapterDescriptor,
    AdapterErrorCode,
    AdapterRequest,
    NormalizedToolCalls,
    ToolCallResponse,
)

_TOOL_FAILED: Final[AdapterErrorCode] = "GE_ADAPTER_TOOL_VALIDATION_FAILED"


def validate_tool_calls(
    descriptor: AdapterDescriptor,
    request: AdapterRequest,
    response: ToolCallResponse,
) -> NormalizedToolCalls:
    definitions = {definition.name: definition for definition in request.tool_definitions}
    authorized = frozenset(response.authorized_tools)

    if len(response.tool_calls) > descriptor.bounds.max_tool_calls_per_response:
        fail(_TOOL_FAILED, "T-003", "the response exceeds maxToolCallsPerResponse")
    identifiers = [call.id for call in response.tool_calls]
    if len(set(identifiers)) != len(identifiers):
        fail(_TOOL_FAILED, "T-004", "tool call identifiers must be unique")
    for call in response.tool_calls:
        definition = definitions.get(call.name)
        if definition is None:
            fail(_TOOL_FAILED, "T-001", f"tool {call.name!r} was not declared to the provider")
        for required in definition.required_arguments:
            if required not in call.arguments:
                fail(
                    _TOOL_FAILED,
                    "T-002",
                    f"tool {call.name!r} is missing required argument {required!r}",
                )
        for name in call.arguments:
            if name not in definition.allowed_arguments:
                fail(
                    _TOOL_FAILED,
                    "T-002",
                    f"tool {call.name!r} received an undeclared argument {name!r}",
                )
        if call.name not in authorized:
            fail(
                _TOOL_FAILED,
                "T-005",
                "authority comes from policy; a model-selected tool never grants it",
            )
        if descriptor.mcp is not None and call.name not in descriptor.mcp.allowed_tools:
            fail(_TOOL_FAILED, "T-006", "a tool description cannot widen the MCP server allowlist")
    return NormalizedToolCalls(tool_calls=len(response.tool_calls))
