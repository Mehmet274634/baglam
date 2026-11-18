import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ContextStore } from "../src/store.js";
import { createServer } from "../src/server.js";
import { runCli } from "../src/cli.js";
import { testHost } from "./helpers.js";

const text = (r: unknown) => (r as { content: { text: string }[] }).content.map((c) => c.text).join("\n");

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), "baglam-nudge-"));
  mkdirSync(join(dir, ".git"));
  let now = 1_700_000_000_000;
  const clock = { set: (t: number) => (now = t), get: () => now };
  const store = new ContextStore(":memory:", () => now);
  const connect = async (agent: string) => {
    const server = createServer(store, { cwd: dir, agent, now: () => now });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: agent, version: "1" });
    await Promise.all([server.connect(a), client.connect(b)]);
    return client;
  };
  return { dir, store, clock, connect };
}

describe("checkpoint nudges", () => {
  it("every checkpoint reply asks for the next one; a finished task does not", async () => {
    const { connect } = await setup();
    const c = await connect("claude-code");
    const r = text(await c.callTool({ name: "context_checkpoint", arguments: { goal: "Calculator", next: ["add"] } }));
    expect(r).toMatch(/Checkpoint again right after your next step/);
    const done = text(await c.callTool({ name: "context_checkpoint", arguments: { status: "done" } }));
    expect(done).not.toMatch(/Checkpoint again/);
  });

  it("reminds the agent whose own checkpoint went stale, on any other tool call", async () => {
    const { connect, clock } = await setup();
    const c = await connect("claude-code");
    await c.callTool({ name: "context_checkpoint", arguments: { goal: "Calculator", next: ["add"] } });
    clock.set(clock.get() + 4 * 60_000);
    expect(text(await c.callTool({ name: "context_search", arguments: { query: "x" } }))).not.toMatch(/Reminder/);
    clock.set(clock.get() + 2 * 60_000);
    const later = text(await c.callTool({ name: "context_search", arguments: { query: "x" } }));
    expect(later).toMatch(/Reminder: your last checkpoint on "Calculator" was 6 min ago/);
    expect(later).toMatch(/context_checkpoint/);
    // Another agent reading the same project is not nagged about someone else's task.
    const other = await connect("codex");
    expect(text(await other.callTool({ name: "context_search", arguments: { query: "x" } }))).not.toMatch(/Reminder/);
  });

  it("no reminder once the task is done", async () => {
    const { connect, clock } = await setup();
    const c = await connect("claude-code");
    await c.callTool({ name: "context_checkpoint", arguments: { goal: "Calculator", status: "done" } });
    clock.set(clock.get() + 30 * 60_000);
    expect(text(await c.callTool({ name: "context_search", arguments: { query: "x" } }))).not.toMatch(/Reminder/);
  });
});

describe("reminders only for this connection's own task", () => {
  it("a fresh session meeting an older session's stale task is not nagged", async () => {
    const { connect, clock } = await setup();
    const crashed = await connect("claude-code");
    await crashed.callTool({ name: "context_checkpoint", arguments: { goal: "Old task" } });
    clock.set(clock.get() + 60 * 60_000);
    const fresh = await connect("claude-code"); // same client name, new session
    expect(text(await fresh.callTool({ name: "context_search", arguments: { query: "x" } }))).not.toMatch(/Reminder/);
    expect(text(await crashed.callTool({ name: "context_search", arguments: { query: "x" } }))).toMatch(/Reminder/);
  });

  it("a blocked task is not nagged and its reply does not ask for more", async () => {
    const { connect, clock } = await setup();
    const c = await connect("claude-code");
    const r = text(await c.callTool({ name: "context_checkpoint", arguments: { goal: "Waiting", status: "blocked", blockers: "needs the user's API choice" } }));
    expect(r).not.toMatch(/Checkpoint again/);
    clock.set(clock.get() + 30 * 60_000);
    expect(text(await c.callTool({ name: "context_search", arguments: { query: "x" } }))).not.toMatch(/Reminder/);
  });
});

describe("init git hint", () => {
  it("does not blame the folder when a .git folder exists (git missing or refusing)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "baglam-fakegit-"));
    mkdirSync(join(dir, ".git"));
    const out: string[] = [];
    await runCli(["init", "--project", dir], { store: new ContextStore(":memory:"), project: "x", user: "u", print: (s) => out.push(s), host: testHost() });
    expect(out.join("\n")).not.toMatch(/not a git repository/);
  });

  it("suggests git init when the folder is not a git repository", async () => {
    const dir = mkdtempSync(join(tmpdir(), "baglam-nogit-"));
    const out: string[] = [];
    const code = await runCli(["init", "--project", dir], { store: new ContextStore(":memory:"), project: "x", user: "u", print: (s) => out.push(s), host: testHost() });
    expect(code).toBe(0);
    expect(out.join("\n")).toMatch(/not a git repository/);
    expect(out.join("\n")).toMatch(/git init/);
  });

  it("says nothing about git inside a repository", async () => {
    const dir = mkdtempSync(join(tmpdir(), "baglam-git-"));
    const { execFileSync } = await import("node:child_process");
    execFileSync("git", ["init", "-q"], { cwd: dir });
    const out: string[] = [];
    await runCli(["init", "--project", dir], { store: new ContextStore(":memory:"), project: "x", user: "u", print: (s) => out.push(s), host: testHost() });
    expect(out.join("\n")).not.toMatch(/not a git repository/);
  });
});
