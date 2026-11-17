import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ListRootsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { ContextStore } from "../src/store.js";
import { createServer } from "../src/server.js";
import { createMarker } from "../src/project.js";
import { normalizeProject } from "../src/config.js";

const tmp = () => mkdtempSync(join(tmpdir(), "baglam-srv-"));

function text(res: unknown): string {
  return (res as { content: { type: string; text: string }[] }).content.map((c) => c.text).join("\n");
}

describe("MCP server", () => {
  let store: ContextStore;
  let closers: (() => Promise<void>)[];
  let dir: string;
  let P: string;

  beforeEach(() => {
    store = new ContextStore(":memory:");
    closers = [];
    dir = tmp();
    P = normalizeProject(dir);
  });
  afterEach(async () => {
    await Promise.all(closers.map((c) => c()));
    store.close();
  });

  async function agent(
    name: string,
    opts: { agent?: string; cwd?: string; envProject?: string; roots?: () => string[] } = {},
  ) {
    const server = createServer(store, { cwd: opts.cwd ?? dir, envProject: opts.envProject, agent: opts.agent });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client(
      { name, version: "1.0.0" },
      opts.roots ? { capabilities: { roots: { listChanged: true } } } : {},
    );
    if (opts.roots) {
      const roots = opts.roots;
      client.setRequestHandler(ListRootsRequestSchema, async () => ({
        roots: roots().map((d) => ({ uri: pathToFileURL(d).href })),
      }));
    }
    await Promise.all([server.connect(a), client.connect(b)]);
    closers.push(() => client.close());
    return client;
  }

  const propose = (c: Client, extra: Record<string, unknown> = {}) =>
    c.callTool({ name: "context_propose", arguments: { kind: "fact", title: "t", body: "b", ...extra } });

  it("exposes exactly the four agent tools (no approve/reject)", async () => {
    const { tools } = await (await agent("cursor")).listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["context_brief", "context_get", "context_propose", "context_search"]);
    for (const t of tools) expect(Object.keys(t.inputSchema.properties ?? {})).toContain("project_path");
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
    await propose(await agent("generic-client", { agent: "research-agent" }));
    expect(store.pending(P)[0].sourceAgent).toBe("research-agent");
  });

  it("brief shows approved context to another agent, with provenance and data framing", async () => {
    await propose(await agent("claude-code"), { kind: "decision", title: "Use pnpm", body: "Package manager is pnpm." });
    store.approve(store.pending(P)[0].id, "human");
    const out = text(await (await agent("cursor")).callTool({ name: "context_brief", arguments: {} }));
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
    const e = store.addApproved(
      { project: P, kind: "fact", title: "Customer ACME history", body: "Refunded twice.", audience: ["support"] },
      "human",
    );
    const cursor = await agent("cursor");
    expect(text(await cursor.callTool({ name: "context_search", arguments: { query: "ACME" } }))).toMatch(/no matching/i);
    expect((await cursor.callTool({ name: "context_get", arguments: { id: e.id } })).isError).toBe(true);
    const support = await agent("support");
    expect(text(await support.callTool({ name: "context_search", arguments: { query: "ACME" } }))).toContain("Refunded twice");
    expect(text(await support.callTool({ name: "context_get", arguments: { id: e.id } }))).toContain(e.id);
  });

  it("propose with invalid supersedes returns a tool error, not a crash", async () => {
    const res = await propose(await agent("cursor"), { supersedes: "cmissing" });
    expect(res.isError).toBe(true);
    expect(text(res)).toMatch(/unknown entry/);
  });

  it("uses client roots", async () => {
    const root = tmp();
    const { key } = createMarker(root);
    await propose(await agent("antigravity", { cwd: homedir(), roots: () => [root] }));
    expect(store.pending(key)).toHaveLength(1);
    expect(store.projectInfo(key)?.lastPath).toBeTruthy();
  });

  it("project_path argument is honoured", async () => {
    const d = tmp();
    await propose(await agent("antigravity", { cwd: homedir() }), { project_path: d });
    expect(store.pending(normalizeProject(d))).toHaveLength(1);
  });

  it("propose is refused when project is unknown", async () => {
    const res = await propose(await agent("antigravity", { cwd: homedir() }));
    expect(res.isError).toBe(true);
    expect(text(res)).toMatch(/project_path/);
    expect(store.projects()).toEqual([]);
  });

  it("brief explains an unknown project instead of failing", async () => {
    const res = await (await agent("antigravity", { cwd: homedir() })).callTool({ name: "context_brief", arguments: {} });
    expect(res.isError).toBeFalsy();
    expect(text(res)).toMatch(/project_path/);
  });

  it("ambiguous roots: propose refused, brief lists each initialised project", async () => {
    const a = tmp(), b = tmp();
    const ka = createMarker(a).key, kb = createMarker(b).key;
    store.addApproved({ project: ka, kind: "fact", title: "Alpha fact", body: "a" }, "human");
    store.addApproved({ project: kb, kind: "fact", title: "Beta fact", body: "b" }, "human");
    const c = await agent("antigravity", { cwd: homedir(), roots: () => [a, b] });
    const res = await propose(c);
    expect(res.isError).toBe(true);
    expect(text(res)).toMatch(/several projects/);
    const brief = text(await c.callTool({ name: "context_brief", arguments: {} }));
    expect(brief).toContain("Alpha fact");
    expect(brief).toContain("Beta fact");
  });

  it("roots change is picked up", async () => {
    const a = tmp(), b = tmp();
    const ka = createMarker(a).key, kb = createMarker(b).key;
    let current = [a];
    const c = await agent("antigravity", { cwd: homedir(), roots: () => current });
    await propose(c);
    current = [b];
    await c.sendRootsListChanged();
    await new Promise((r) => setTimeout(r, 20));
    await propose(c);
    expect(store.pending(ka)).toHaveLength(1);
    expect(store.pending(kb)).toHaveLength(1);
  });
});
