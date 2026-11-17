#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ContextStore } from "./store.js";
import { createServer } from "./server.js";
import { resolveAgentOverride, resolveDbPath } from "./config.js";

/** Run the Bağlam MCP server on stdin/stdout until the client disconnects. */
export async function startMcpServer(): Promise<void> {
  const store = new ContextStore(resolveDbPath());
  const server = createServer(store, {
    cwd: process.cwd(),
    envProject: process.env.BAGLAM_PROJECT?.trim() || undefined,
    agent: resolveAgentOverride(),
  });

  const shutdown = async () => {
    await server.close().catch(() => {});
    store.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.stdin.on("close", shutdown);

  await server.connect(new StdioServerTransport());
  console.error(`[baglam] MCP server ready (cwd ${process.cwd()})`);
}

/** Kept so configs that point at dist/mcp.js (v0.1) keep working. */
function isMain(): boolean {
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (isMain()) await startMcpServer();
