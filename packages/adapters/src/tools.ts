/**
 * Model-emitted tool-call validation, rules `T-001` through `T-006`.
 *
 * adapter-semantics 6.4: every model-emitted tool call is validated before the
 * tool runs. Authority comes from policy and never from the model or from a
 * tool description.
 */

import { fail } from "./errors.js";
import type { AdapterDescriptor, AdapterRequest, ToolCallResponse } from "./types.js";

const TOOL_FAILED = "GE_ADAPTER_TOOL_VALIDATION_FAILED" as const;

export interface NormalizedToolCalls {
  readonly toolCalls: number;
}

export function validateToolCalls(
  descriptor: AdapterDescriptor,
  request: AdapterRequest,
  response: ToolCallResponse,
): NormalizedToolCalls {
  const definitions = new Map(
    request.toolDefinitions.map((definition) => [definition.name, definition]),
  );
  const authorized = new Set(response.authorizedTools);

  if (response.toolCalls.length > descriptor.bounds.maxToolCallsPerResponse) {
    fail(TOOL_FAILED, "T-003", "the response exceeds maxToolCallsPerResponse");
  }
  const ids = response.toolCalls.map((call) => call.id);
  if (new Set(ids).size !== ids.length) {
    fail(TOOL_FAILED, "T-004", "tool call identifiers must be unique");
  }
  for (const call of response.toolCalls) {
    const definition = definitions.get(call.name);
    if (definition === undefined) {
      fail(TOOL_FAILED, "T-001", `tool '${call.name}' was not declared to the provider`);
    }
    for (const required of definition.requiredArguments) {
      if (!Object.hasOwn(call.arguments, required)) {
        fail(TOOL_FAILED, "T-002",
          `tool '${call.name}' is missing required argument '${required}'`);
      }
    }
    for (const name of Object.keys(call.arguments)) {
      if (!definition.allowedArguments.includes(name)) {
        fail(TOOL_FAILED, "T-002",
          `tool '${call.name}' received an undeclared argument '${name}'`);
      }
    }
    if (!authorized.has(call.name)) {
      fail(TOOL_FAILED, "T-005",
        "authority comes from policy; a model-selected tool never grants it");
    }
    if (descriptor.mcp !== null && !descriptor.mcp.allowedTools.includes(call.name)) {
      fail(TOOL_FAILED, "T-006", "a tool description cannot widen the MCP server allowlist");
    }
  }
  return Object.freeze({ toolCalls: response.toolCalls.length });
}
