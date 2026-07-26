import type { GraphSpec } from "@graph-engineering/core";
import type { ValidationResult } from "./validation.js";

export interface GraphPlan {
  graphName: string;
  canonicalSha256: string;
  nodeCount: number;
  edgeCount: number;
  layerCount: number;
  maxParallelWidth: number;
  configuredMaxConcurrency: number | null;
  topologicalLayers: readonly (readonly string[])[];
}

export function planGraph(graph: GraphSpec, validation: ValidationResult): GraphPlan {
  if (!validation.valid || validation.canonicalSha256 === null) {
    throw new Error("cannot plan an invalid graph");
  }
  return {
    graphName: graph.metadata.name,
    canonicalSha256: validation.canonicalSha256,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    layerCount: validation.topologicalLayers.length,
    maxParallelWidth: Math.max(0, ...validation.topologicalLayers.map((layer) => layer.length)),
    configuredMaxConcurrency:
      typeof graph.policies?.maxConcurrency === "number" ? graph.policies.maxConcurrency : null,
    topologicalLayers: validation.topologicalLayers,
  };
}
