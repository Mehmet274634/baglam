#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ContextStore } from "./store.js";
import { createServer } from "./server.js";
import { resolveAgentOverride, resolveDbPath, resolveProject } from "./config.js";

const store = new ContextStore(resolveDbPath());
const project = resolveProject();
const server = createServer(store, { project, agent: resolveAgentOverride() });

const shutdown = async () => {
  await server.close().catch(() => {});
  store.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.stdin.on("close", shutdown);

await server.connect(new StdioServerTransport());
console.error(`[baglam] serving project ${project}`);
