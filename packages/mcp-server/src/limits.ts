import { Worker } from "node:worker_threads";
import type { CompilationResult } from "@graph-engineering/core";
import {
  MAX_GRAPH_BYTES,
  MAX_GRAPH_EDGES,
  MAX_GRAPH_NODES,
  TOOL_TIMEOUT_MS,
} from "./constants.js";

export type McpIssueCode =
  | "MCP_INPUT_TOO_LARGE"
  | "MCP_GRAPH_TOO_LARGE"
  | "MCP_TOOL_TIMEOUT"
  | "MCP_REQUEST_CANCELLED"
  | "MCP_INTERNAL_ERROR";

export interface McpIssue {
  code: McpIssueCode;
  message: string;
}

export type BoundedCompilation =
  | { ok: true; compilation: CompilationResult }
  | { ok: false; issue: McpIssue };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function inputLimitIssue(graph: unknown): McpIssue | null {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(graph);
  } catch (error) {
    return {
      code: "MCP_INTERNAL_ERROR",
      message: `Graph input is not JSON-serializable: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (serialized === undefined) {
    return {
      code: "MCP_INTERNAL_ERROR",
      message: "Graph input is not a JSON value",
    };
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_GRAPH_BYTES) {
    return {
      code: "MCP_INPUT_TOO_LARGE",
      message: `Graph input exceeds the ${MAX_GRAPH_BYTES}-byte limit`,
    };
  }
  if (record(graph)) {
    const nodes = Array.isArray(graph.nodes) ? graph.nodes.length : 0;
    const edges = Array.isArray(graph.edges) ? graph.edges.length : 0;
    if (nodes > MAX_GRAPH_NODES || edges > MAX_GRAPH_EDGES) {
      return {
        code: "MCP_GRAPH_TOO_LARGE",
        message:
          `Graph exceeds structural limits (${MAX_GRAPH_NODES} nodes, ` +
          `${MAX_GRAPH_EDGES} edges); received ${nodes} nodes and ${edges} edges`,
      };
    }
  }
  return null;
}

export async function compileGraphBounded(
  graph: unknown,
  signal?: AbortSignal,
  timeoutMs = TOOL_TIMEOUT_MS,
): Promise<BoundedCompilation> {
  const limitIssue = inputLimitIssue(graph);
  if (limitIssue) return { ok: false, issue: limitIssue };
  if (signal?.aborted) {
    return {
      ok: false,
      issue: { code: "MCP_REQUEST_CANCELLED", message: "MCP request was cancelled before compilation" },
    };
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) {
    return {
      ok: false,
      issue: { code: "MCP_INTERNAL_ERROR", message: "Compiler timeout must be a positive finite number" },
    };
  }

  return await new Promise<BoundedCompilation>((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./compile-worker.js", import.meta.url), { workerData: graph });
    } catch (error) {
      resolve({
        ok: false,
        issue: {
          code: "MCP_INTERNAL_ERROR",
          message: `Could not start compiler worker: ${error instanceof Error ? error.message : String(error)}`,
        },
      });
      return;
    }
    let settled = false;

    const finish = (value: BoundedCompilation, terminate: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      worker.removeAllListeners();
      if (terminate) void worker.terminate();
      resolve(value);
    };
    const onAbort = (): void => {
      finish(
        {
          ok: false,
          issue: { code: "MCP_REQUEST_CANCELLED", message: "MCP request was cancelled" },
        },
        true,
      );
    };
    const timer = setTimeout(() => {
      finish(
        {
          ok: false,
          issue: {
            code: "MCP_TOOL_TIMEOUT",
            message: `Graph compilation exceeded the ${timeoutMs}-ms limit`,
          },
        },
        true,
      );
    }, timeoutMs);

    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    worker.once("message", (compilation: CompilationResult) => {
      finish({ ok: true, compilation }, false);
    });
    worker.once("error", (error) => {
      finish(
        {
          ok: false,
          issue: { code: "MCP_INTERNAL_ERROR", message: `Compiler worker failed: ${error.message}` },
        },
        true,
      );
    });
    worker.once("exit", (code) => {
      if (code !== 0) {
        finish(
          {
            ok: false,
            issue: { code: "MCP_INTERNAL_ERROR", message: `Compiler worker exited with code ${code}` },
          },
          false,
        );
      }
    });
  });
}
