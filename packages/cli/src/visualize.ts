import type { Endpoint, GraphSpec } from "@graph-engineering/core";

export type VisualizationFormat = "mermaid" | "dot";

export interface VisualizationResult {
  format: VisualizationFormat;
  content: string;
  nodeCount: number;
  edgeCount: number;
}

interface NamedOutput {
  name: string;
  endpoint: Endpoint;
}

type LabelEscaper = (value: string) => string;

/**
 * Encode every character which could acquire meaning in Mermaid, DOT, or HTML.
 *
 * Keeping only a deliberately small ASCII display alphabet means quotes,
 * newlines, brackets, pipes, angle brackets, ampersands, backticks, and Unicode
 * controls can never escape a label. `entityPrefix` selects the renderer's
 * documented decimal-entity spelling: Mermaid uses `#NN;`, while Graphviz uses
 * the XML-compatible `&#NN;` form during label evaluation.
 */
function escapeDiagramText(value: string, entityPrefix: "#" | "&#"): string {
  let result = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) continue;
    const safe =
      (codePoint >= 0x30 && codePoint <= 0x39) ||
      (codePoint >= 0x41 && codePoint <= 0x5a) ||
      (codePoint >= 0x61 && codePoint <= 0x7a) ||
      character === " " ||
      character === "." ||
      character === "_" ||
      character === "-";
    result += safe ? character : `${entityPrefix}${codePoint};`;
  }
  return result;
}

const escapeMermaidText: LabelEscaper = (value) => escapeDiagramText(value, "#");
const escapeDotText: LabelEscaper = (value) => escapeDiagramText(value, "&#");

function outputsByNode(graph: GraphSpec): ReadonlyMap<string, readonly NamedOutput[]> {
  const result = new Map<string, NamedOutput[]>();
  for (const [name, endpoint] of Object.entries(graph.outputs)) {
    const existing = result.get(endpoint.node);
    const output = { name, endpoint };
    if (existing === undefined) result.set(endpoint.node, [output]);
    else existing.push(output);
  }
  return result;
}

function namedOutputLabel(output: NamedOutput, escape: LabelEscaper): string {
  const port = output.endpoint.port;
  return port === undefined
    ? escape(output.name)
    : `${escape(output.name)} at ${escape(port)}`;
}

function nodeLabel(
  id: string,
  kind: string,
  entrypoint: boolean,
  outputs: readonly NamedOutput[],
  escape: LabelEscaper,
): string {
  const parts = [
    `id=${escape(id)}`,
    `kind=${escape(kind)}`,
  ];
  if (entrypoint) parts.push("entrypoint");
  if (outputs.length > 0) {
    parts.push(`outputs=${outputs.map((output) => namedOutputLabel(output, escape)).join(", ")}`);
  }
  return parts.join("; ");
}

function edgeLabel(
  id: string,
  fromPort: string | undefined,
  toPort: string | undefined,
  mode: string | undefined,
  escape: LabelEscaper,
): string {
  return [
    `id=${escape(id)}`,
    `fromPort=${fromPort === undefined ? "default" : escape(fromPort)}`,
    `toPort=${toPort === undefined ? "default" : escape(toPort)}`,
    `mode=${mode === undefined ? "default" : escape(mode)}`,
  ].join("; ");
}

function aliases(graph: GraphSpec): ReadonlyMap<string, string> {
  return new Map(graph.nodes.map((node, index) => [node.id, `n${index}`]));
}

function endpointAlias(
  nodeAliases: ReadonlyMap<string, string>,
  endpoint: Endpoint,
): string {
  const alias = nodeAliases.get(endpoint.node);
  if (alias === undefined) {
    throw new Error("visualizeGraph requires a canonically compiled, valid Graph IR");
  }
  return alias;
}

function renderMermaid(graph: GraphSpec): string {
  const nodeAliases = aliases(graph);
  const entrypoints = new Set(graph.entrypoints);
  const graphOutputs = outputsByNode(graph);
  const lines = ["flowchart TD"];

  graph.nodes.forEach((node, index) => {
    const label = nodeLabel(
      node.id,
      node.kind,
      entrypoints.has(node.id),
      graphOutputs.get(node.id) ?? [],
      escapeMermaidText,
    );
    lines.push(`  n${index}["${label}"]`);
  });

  graph.edges.forEach((edge, index) => {
    const from = endpointAlias(nodeAliases, edge.from);
    const to = endpointAlias(nodeAliases, edge.to);
    const label = edgeLabel(
      edge.id,
      edge.from.port,
      edge.to.port,
      edge.mode,
      escapeMermaidText,
    );
    lines.push(`  ${from} e${index}@-->|"${label}"| ${to}`);
  });

  return `${lines.join("\n")}\n`;
}

function renderDot(graph: GraphSpec): string {
  const nodeAliases = aliases(graph);
  const entrypoints = new Set(graph.entrypoints);
  const graphOutputs = outputsByNode(graph);
  const lines = [
    "digraph GraphEngineering {",
    "  rankdir=TB;",
    "  node [shape=box];",
  ];

  graph.nodes.forEach((node, index) => {
    const label = nodeLabel(
      node.id,
      node.kind,
      entrypoints.has(node.id),
      graphOutputs.get(node.id) ?? [],
      escapeDotText,
    );
    lines.push(`  n${index} [label="${label}"];`);
  });

  graph.edges.forEach((edge, index) => {
    const from = endpointAlias(nodeAliases, edge.from);
    const to = endpointAlias(nodeAliases, edge.to);
    const label = edgeLabel(edge.id, edge.from.port, edge.to.port, edge.mode, escapeDotText);
    lines.push(`  ${from} -> ${to} [id="e${index}", label="${label}"];`);
  });

  lines.push("}");
  return `${lines.join("\n")}\n`;
}

/** Render an already validated Graph IR without I/O or node execution. */
export function visualizeGraph(
  graph: GraphSpec,
  format: VisualizationFormat,
): VisualizationResult {
  return {
    format,
    content: format === "mermaid" ? renderMermaid(graph) : renderDot(graph),
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
  };
}
