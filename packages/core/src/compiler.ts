import {
  CanonicalizationError,
  captureCanonicalJson,
  compareUnicodeCodePoints,
  hashCanonicalSerialization,
} from "./canonical.js";
import { validateGraphDocument } from "./schema-validation.js";
import type { EdgeSpec, GraphSpec } from "./types.js";

export type DiagnosticSeverity = "error" | "warning";

export type DiagnosticCode =
  | "GE1001_DUPLICATE_NODE"
  | "GE1002_DUPLICATE_EDGE"
  | "GE1003_MISSING_SOURCE"
  | "GE1004_MISSING_TARGET"
  | "GE1005_CYCLE"
  | "GE1006_UNREACHABLE_NODE"
  | "GE1007_INVALID_GRAPH"
  | "GE1008_MISSING_ENTRYPOINT"
  | "GE1009_MISSING_OUTPUT"
  | "GE1010_ENTRYPOINT_HAS_INCOMING"
  | "GE1101_MAX_FAN_OUT"
  | "GE1102_MAX_DEPTH";

export interface CompilerDiagnostic {
  code: DiagnosticCode;
  severity: DiagnosticSeverity;
  message: string;
  path?: string;
  nodeIds?: readonly string[];
  edgeId?: string;
}

export interface CompilationResult {
  valid: boolean;
  graphHash: string | null;
  canonicalGraph: string | null;
  entrypoints: readonly string[];
  topologicalLayers: readonly (readonly string[])[];
  diagnostics: readonly CompilerDiagnostic[];
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort(compareUnicodeCodePoints);
}

function diagnostic(
  code: DiagnosticCode,
  message: string,
  fields: Omit<CompilerDiagnostic, "code" | "severity" | "message"> = {},
): CompilerDiagnostic {
  return { code, severity: "error", message, ...fields };
}

/** Compile and statically validate a v1alpha1 graph. */
export function compileGraph(document: GraphSpec | unknown): CompilationResult {
  const diagnostics: CompilerDiagnostic[] = [];
  let captured: ReturnType<typeof captureCanonicalJson>;
  try {
    captured = captureCanonicalJson(document);
  } catch (error) {
    const message = error instanceof CanonicalizationError
      ? error.message
      : "Graph input could not be inspected safely";
    return {
      valid: false,
      graphHash: null,
      canonicalGraph: null,
      entrypoints: [],
      topologicalLayers: [],
      diagnostics: [diagnostic("GE1007_INVALID_GRAPH", message)],
    };
  }

  let schemaIssues: readonly string[];
  try {
    schemaIssues = validateGraphDocument(captured.value);
  } catch {
    return {
      valid: false,
      graphHash: null,
      canonicalGraph: null,
      entrypoints: [],
      topologicalLayers: [],
      diagnostics: [
        diagnostic("GE1007_INVALID_GRAPH", "Graph validation could not be completed safely"),
      ],
    };
  }
  if (schemaIssues.length > 0) {
    const invalid = diagnostic("GE1007_INVALID_GRAPH", schemaIssues.join("; "));
    return {
      valid: false,
      graphHash: null,
      canonicalGraph: null,
      entrypoints: [],
      topologicalLayers: [],
      diagnostics: [invalid],
    };
  }
  const graph = captured.value as unknown as GraphSpec;
  const canonicalGraph = captured.serialized;
  const graphHash = hashCanonicalSerialization(canonicalGraph);

  const nodesById = new Map<string, GraphSpec["nodes"][number]>();
  for (const [index, node] of graph.nodes.entries()) {
    if (nodesById.has(node.id)) {
      diagnostics.push(
        diagnostic("GE1001_DUPLICATE_NODE", `Node id '${node.id}' is declared more than once`, {
          path: `#/nodes/${index}/id`,
          nodeIds: [node.id],
        }),
      );
      continue;
    }
    nodesById.set(node.id, node);
  }

  const seenEdgeIds = new Set<string>();
  const validEdges: EdgeSpec[] = [];
  for (const [index, edge] of graph.edges.entries()) {
    if (seenEdgeIds.has(edge.id)) {
      diagnostics.push(
        diagnostic("GE1002_DUPLICATE_EDGE", `Edge id '${edge.id}' is declared more than once`, {
          path: `#/edges/${index}/id`,
          edgeId: edge.id,
        }),
      );
    } else {
      seenEdgeIds.add(edge.id);
    }

    const sourceExists = nodesById.has(edge.from.node);
    const targetExists = nodesById.has(edge.to.node);
    if (!sourceExists) {
      diagnostics.push(
        diagnostic("GE1003_MISSING_SOURCE", `Edge '${edge.id}' references missing source '${edge.from.node}'`, {
          path: `#/edges/${index}/from/node`,
          edgeId: edge.id,
          nodeIds: [edge.from.node],
        }),
      );
    }
    if (!targetExists) {
      diagnostics.push(
        diagnostic("GE1004_MISSING_TARGET", `Edge '${edge.id}' references missing target '${edge.to.node}'`, {
          path: `#/edges/${index}/to/node`,
          edgeId: edge.id,
          nodeIds: [edge.to.node],
        }),
      );
    }
    if (sourceExists && targetExists) {
      validEdges.push(edge);
    }
  }

  const entrypoints = [...new Set(graph.entrypoints)];
  for (const [index, entrypoint] of graph.entrypoints.entries()) {
    if (!nodesById.has(entrypoint)) {
      diagnostics.push(
        diagnostic("GE1008_MISSING_ENTRYPOINT", `Entrypoint '${entrypoint}' does not name a node`, {
          path: `#/entrypoints/${index}`,
          nodeIds: [entrypoint],
        }),
      );
    }
  }

  for (const [name, endpoint] of Object.entries(graph.outputs).sort(([left], [right]) =>
    compareUnicodeCodePoints(left, right),
  )) {
    if (!nodesById.has(endpoint.node)) {
      diagnostics.push(
        diagnostic("GE1009_MISSING_OUTPUT", `Output '${name}' references missing node '${endpoint.node}'`, {
          path: `#/outputs/${name}/node`,
          nodeIds: [endpoint.node],
        }),
      );
    }
  }

  // Identity and reference errors make adjacency ambiguous. Do not manufacture
  // cycle/reachability cascades from a graph whose structural index is invalid.
  if (diagnostics.length > 0) {
    return {
      valid: false,
      graphHash,
      canonicalGraph,
      entrypoints,
      topologicalLayers: [],
      diagnostics,
    };
  }

  const adjacency = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  const declarationIndex = new Map<string, number>();
  for (const [index, nodeId] of [...nodesById.keys()].entries()) {
    adjacency.set(nodeId, []);
    inDegree.set(nodeId, 0);
    declarationIndex.set(nodeId, index);
  }
  for (const edge of validEdges) {
    adjacency.get(edge.from.node)?.push(edge.to.node);
    inDegree.set(edge.to.node, (inDegree.get(edge.to.node) ?? 0) + 1);
  }
  const compareNodes = (left: string, right: string): number =>
    (declarationIndex.get(left) ?? Number.MAX_SAFE_INTEGER) -
      (declarationIndex.get(right) ?? Number.MAX_SAFE_INTEGER) ||
    compareUnicodeCodePoints(left, right);
  for (const targets of adjacency.values()) {
    targets.sort(compareNodes);
  }

  let currentLayer = [...nodesById.keys()].filter((nodeId) => inDegree.get(nodeId) === 0);
  const topologicalLayers: string[][] = [];
  const processed = new Set<string>();

  while (currentLayer.length > 0) {
    topologicalLayers.push(currentLayer);
    const nextLayer = new Set<string>();
    for (const nodeId of currentLayer) {
      processed.add(nodeId);
      for (const target of adjacency.get(nodeId) ?? []) {
        const nextDegree = (inDegree.get(target) ?? 0) - 1;
        inDegree.set(target, nextDegree);
        if (nextDegree === 0) {
          nextLayer.add(target);
        }
      }
    }
    currentLayer = [...nextLayer].sort(compareNodes);
  }

  const cycleNodes = [...nodesById.keys()].filter((nodeId) => !processed.has(nodeId));
  if (cycleNodes.length > 0) {
    diagnostics.push(
      diagnostic("GE1005_CYCLE", `Graph contains a cycle involving: ${cycleNodes.join(", ")}`, {
        nodeIds: cycleNodes,
      }),
    );

    return {
      valid: false,
      graphHash,
      canonicalGraph,
      entrypoints,
      topologicalLayers,
      diagnostics,
    };
  }

  for (const [index, entrypoint] of graph.entrypoints.entries()) {
    if (validEdges.some((edge) => edge.to.node === entrypoint)) {
      diagnostics.push(
        diagnostic(
          "GE1010_ENTRYPOINT_HAS_INCOMING",
          `Entrypoint '${entrypoint}' cannot have incoming edges`,
          { path: `#/entrypoints/${index}`, nodeIds: [entrypoint] },
        ),
      );
    }
  }

  // Reachability is deliberately rooted in explicit IR entrypoints. This keeps
  // disconnected parallel roots legal only when the author lists each one.
  const reachable = new Set<string>();
  const queue = entrypoints.filter((nodeId) => nodesById.has(nodeId));
  for (let index = 0; index < queue.length; index += 1) {
    const nodeId = queue[index] as string;
    if (reachable.has(nodeId)) {
      continue;
    }
    reachable.add(nodeId);
    for (const target of adjacency.get(nodeId) ?? []) {
      if (!reachable.has(target)) {
        queue.push(target);
      }
    }
  }
  for (const nodeId of [...nodesById.keys()].filter((id) => !reachable.has(id))) {
    diagnostics.push(
      diagnostic("GE1006_UNREACHABLE_NODE", `Node '${nodeId}' is not reachable from an entrypoint`, {
        nodeIds: [nodeId],
      }),
    );
  }

  const maxFanOut = graph.policies?.maxFanOut;
  if (typeof maxFanOut === "number") {
    for (const nodeId of nodesById.keys()) {
      const count = adjacency.get(nodeId)?.length ?? 0;
      if (count > maxFanOut) {
        diagnostics.push(
          diagnostic("GE1101_MAX_FAN_OUT", `Node '${nodeId}' fan-out ${count} exceeds policy ${maxFanOut}`, {
            nodeIds: [nodeId],
          }),
        );
      }
    }
  }

  const maxDepth = graph.policies?.maxDepth;
  if (typeof maxDepth === "number" && cycleNodes.length === 0 && topologicalLayers.length > maxDepth) {
    diagnostics.push(
      diagnostic(
        "GE1102_MAX_DEPTH",
        `Graph depth ${topologicalLayers.length} exceeds policy ${maxDepth}`,
      ),
    );
  }

  return {
    valid: diagnostics.every((item) => item.severity !== "error"),
    graphHash,
    canonicalGraph,
    entrypoints,
    topologicalLayers,
    diagnostics,
  };
}
