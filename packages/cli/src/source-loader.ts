import { extname } from "node:path";
import type {
  GraphSourceErrorProjection,
  GraphSourceFormat,
} from "@graph-engineering/core";

export type GraphInputFormat = GraphSourceFormat | "auto";

export class GraphInputFormatError extends Error {
  readonly code = "GECLI_INPUT_FORMAT" as const;

  constructor(message: string) {
    super(message);
    this.name = "GraphInputFormatError";
  }
}

export class GraphInputSourceError extends Error {
  readonly projection: GraphSourceErrorProjection;

  constructor(projection: GraphSourceErrorProjection) {
    super(projection.message);
    this.name = "GraphInputSourceError";
    this.projection = projection;
  }
}

/** Resolve transport-level format only; source safety remains core-owned. */
export function resolveGraphSourceFormat(
  path: string,
  requested: GraphInputFormat,
): GraphSourceFormat {
  if (requested !== "auto") return requested;
  if (path === "-") return "json";

  const extension = extname(path).toLowerCase();
  if (extension === ".json") return "json";
  if (extension === ".yaml" || extension === ".yml") return "yaml";
  throw new GraphInputFormatError(
    extension.length === 0
      ? "cannot infer an input format without a file extension; use --input-format json or yaml"
      : `cannot infer an input format from extension '${extension}'; use --input-format json or yaml`,
  );
}

/** Decode untrusted bytes with the one canonical core source decoder. */
export async function decodeGraphInput(
  source: Uint8Array,
  path: string,
  requested: GraphInputFormat,
): Promise<unknown> {
  const format = resolveGraphSourceFormat(path, requested);
  const { decodeGraphSource, GraphSourceError } = await import("@graph-engineering/core");
  try {
    return decodeGraphSource(source, { format });
  } catch (error) {
    if (error instanceof GraphSourceError) {
      throw new GraphInputSourceError(error.toJSON());
    }
    throw error;
  }
}
