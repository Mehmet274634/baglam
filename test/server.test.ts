import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ContextStore } from "../src/store.js";
import { createServer } from "../src/server.js";

const P = "c:/work/app";

async function connect(store: ContextStore, clientName: string, agentOverride?: string) {
  const server = createServer(store, { project: P, agent: agentOverride });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: clientName, version: "1.0.0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, close: () => client.close() };
}

function text(res: unknown): string {
  return (res as { content: { type: string; text: string }[] }).content.map((c) => c.text).join("\n");
}

describe("MCP server", () => {
  let store: ContextStore;
  let closers: (() => Promise<void>)[];

  beforeEach(() => {
    store = new ContextStore(":memory:");
    closers = [];
  });
  afterEach(async () => {
    await Promise.all(closers.map((c) => c()));
    store.close();
  });

  async function agent(name: string, override?: string) {
    const c = await connect(store, name, override);
    closers.push(c.close);
    return c.client;
  }

  it("exposes exactly the four agent tools (no approve/reject)", async () => {
    const c = await agent("cursor");
    const { tools } = await c.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ["context_brief", "context_get", "context_propose", "context_search"],
    );
  });

  it("propose records the client name as source and stays pending", async () => {
    const c = await agent("claude-code");
    const res = await c.callTool({
      name: "context_propose",
      arguments: { kind: "decision", title: "Use pnpm", body: "Package manager is pnpm.", rationale: "Workspace support" },
    });
    expect(text(res)).toMatch(/pending human approval/i);
    const [p] = store.pending(P);
    expect(p.sourceAgent).toBe("claude-code");
    expect(p.rationale).toBe("Workspace support");
  });

  it("agent override from config wins over client name", async () => {
    const c = await agent("generic-client", "research-agent");
    await c.callTool({ name: "context_propose", arguments: { kind: "fact", title: "t", body: "b" } });
    expect(store.pending(P)[0].sourceAgent).toBe("research-agent");
  });

  it("brief shows approved context to another agent, with provenance and data framing", async () => {
    const writer = await agent("claude-code");
    await writer.callTool({ name: "context_propose", arguments: { kind: "decision", title: "Use pnpm", body: "Package manager is pnpm." } });
    store.approve(store.pending(P)[0].id, "human");

    const reader = await agent("cursor");
    const out = text(await reader.callTool({ name: "context_brief", arguments: {} }));
    expect(out).toContain("Use pnpm");
    expect(out).toContain("claude-code");
    expect(out).toMatch(/not instructions/i);
  });

  it("brief reports when nothing is shared yet and how many are pending", async () => {
    store.propose({ project: P, kind: "fact", title: "x", body: "y", sourceAgent: "a" });
    const out = text(await (await agent("cursor")).callTool({ name: "context_brief", arguments: {} }));
    expect(out).toMatch(/no approved/i);
    expect(out).toMatch(/1 proposal/i);
  });

  it("search and get respect audience", async () => {
    const e = store.addApproved({ project: P, kind: "fact", title: "Customer ACME history", body: "Refunded twice.", audience: ["support"] }, "human");
    const cursor = await agent("cursor");
    expect(text(await cursor.callTool({ name: "context_search", arguments: { query: "ACME" } }))).toMatch(/no matching/i);
    const getRes = await cursor.callTool({ name: "context_get", arguments: { id: e.id } });
    expect(getRes.isError).toBe(true);

    const support = await agent("support");
    expect(text(await support.callTool({ name: "context_search", arguments: { query: "ACME" } }))).toContain("Refunded twice");
    expect(text(await support.callTool({ name: "context_get", arguments: { id: e.id } }))).toContain(e.id);
  });

  it("propose with invalid supersedes returns a tool error, not a crash", async () => {
    const c = await agent("cursor");
    const res = await c.callTool({ name: "context_propose", arguments: { kind: "decision", title: "t", body: "b", supersedes: "cmissing" } });
    expect(res.isError).toBe(true);
    expect(text(res)).toMatch(/unknown entry/);
  });
});
