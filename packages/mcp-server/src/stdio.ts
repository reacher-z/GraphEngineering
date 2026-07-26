#!/usr/bin/env node

import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createGraphEngineeringMcpServer } from "./server.js";

export async function serveStdio(): Promise<void> {
  const server = createGraphEngineeringMcpServer();
  const transport = new StdioServerTransport();
  let closing = false;
  const close = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    await server.close();
  };
  process.once("SIGINT", () => {
    void close().finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void close().finally(() => process.exit(0));
  });
  await server.connect(transport);
}

/** Resolve npm/pnpm `.bin` symlinks without ever guessing on filesystem errors. */
export async function isStdioEntrypoint(argument: string | undefined): Promise<boolean> {
  if (argument === undefined) return false;
  try {
    const [modulePath, argumentPath] = await Promise.all([
      realpath(fileURLToPath(import.meta.url)),
      realpath(resolve(argument)),
    ]);
    return modulePath === argumentPath;
  } catch {
    return false;
  }
}

if (await isStdioEntrypoint(process.argv[1])) {
  serveStdio().catch((error: unknown) => {
    // stdout belongs exclusively to MCP JSON-RPC.
    console.error("graph-engineering-mcp:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
