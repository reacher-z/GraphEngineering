import { readFile } from "node:fs/promises";
import { canonicalHash } from "@graph-engineering/core";
import { GRAPH_API_VERSION, GRAPH_SCHEMA_URI } from "./constants.js";

const BUNDLED_SCHEMA_URL = new URL("../../schemas/v1alpha1/graph.schema.json", import.meta.url);
let cachedSchema: Promise<BundledSchema> | undefined;

export interface BundledSchema {
  apiVersion: string;
  uri: string;
  schemaId: string;
  canonicalSha256: string;
  schema: Record<string, unknown>;
}

async function readBundledSchema(): Promise<BundledSchema> {
  const source = await readFile(BUNDLED_SCHEMA_URL, "utf8");
  const parsed = JSON.parse(source) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Bundled Graph IR schema is not an object");
  }
  const schema = parsed as Record<string, unknown>;
  if (typeof schema.$id !== "string") {
    throw new Error("Bundled Graph IR schema has no $id");
  }
  return {
    apiVersion: GRAPH_API_VERSION,
    uri: GRAPH_SCHEMA_URI,
    schemaId: schema.$id,
    canonicalSha256: canonicalHash(schema),
    schema,
  };
}

export async function getBundledGraphSchema(): Promise<BundledSchema> {
  cachedSchema ??= readBundledSchema();
  return await cachedSchema;
}
