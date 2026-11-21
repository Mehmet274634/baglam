import { describe, it, expect } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testHost } from "./helpers.js";
import { ContextStore } from "../src/store.js";
import { runSetup } from "../src/setup.js";
import { runInit } from "../src/init.js";
import { runDoctor, type Check } from "../src/doctor.js";
import { runCli } from "../src/cli.js";

function machine() {
  const host = testHost();
  mkdirSync(join(host.home, ".cursor"));
  const base = mkdtempSync(join(tmpdir(), "baglam-doc-"));
  const dbPath = join(base, "baglam.db");
  const project = join(base, "proj");
  mkdirSync(project);
  return { host, dbPath, project };
}

const failed = (checks: Check[]) => checks.filter((c) => !c.ok);

describe("baglam doctor", () => {
  it("all green on a set-up machine", async () => {
    const { host, dbPath, project } = machine();
    const store = new ContextStore(dbPath);
    runSetup(host, { confirm: () => true });
    runInit(project, { store, host });
    store.close();
    const checks = await runDoctor({ host, dbPath, cwd: project, handshake: async () => null });
    expect(failed(checks)).toEqual([]);
    expect(checks.map((c) => c.name)).toEqual(
      expect.arrayContaining(["Node.js", "Database", "Cursor: registered", "Cursor: connects", "This folder", "Agent instructions"]),
    );
  });

  it("reports an unregistered client with the fix", async () => {
    const { host, dbPath, project } = machine();
    const checks = await runDoctor({ host, dbPath, cwd: project, handshake: async () => null });
    const c = checks.find((x) => x.name === "Cursor: registered");
    expect(c).toMatchObject({ ok: false, fix: "baglam setup" });
  });

  it("reports a stale entry path", async () => {
    const { host, dbPath, project } = machine();
    writeFileSync(
      join(host.home, ".cursor", "mcp.json"),
      JSON.stringify({ mcpServers: { baglam: { command: "node", args: ["C:/old/dist/mcp.js"] } } }),
    );
    const checks = await runDoctor({ host, dbPath, cwd: project, handshake: async () => null });
    const c = checks.find((x) => x.name === "Cursor: registered");
    expect(c?.ok).toBe(false);
    expect(c?.detail).toMatch(/old/);
    expect(c?.fix).toBe("baglam setup");
  });

  it("an entry added by hand without BAGLAM_AGENT is flagged (it runs as an unverified agent); setup fixes it", async () => {
    const { host, dbPath, project } = machine();
    const file = join(host.home, ".cursor", "mcp.json");
    writeFileSync(file, JSON.stringify({ mcpServers: { baglam: { command: host.nodePath, args: [host.cliPath, "mcp"] } } }));
    const checks = await runDoctor({ host, dbPath, cwd: project, handshake: async () => null });
    const c = checks.find((x) => x.name === "Cursor: registered");
    expect(c).toMatchObject({ ok: false, fix: "baglam setup" });
    expect(c?.detail).toMatch(/without BAGLAM_AGENT/);
    runSetup(host, { confirm: () => true });
    const after = await runDoctor({ host, dbPath, cwd: project, handshake: async () => null });
    expect(after.find((x) => x.name === "Cursor: registered")).toMatchObject({ ok: true, detail: "as cursor" });
  });

  it("Claude Code registered by hand without BAGLAM_AGENT is flagged too", async () => {
    const { dbPath, project } = machine();
    const host = testHost({ commands: { claude: (args) => (args[1] === "get" ? { code: 0, stdout: "Command: node\nArgs: C:/baglam/dist/cli.js mcp\n" } : { code: 0 }) } });
    const checks = await runDoctor({ host, dbPath, cwd: project, handshake: async () => null });
    const c = checks.find((x) => x.name === "Claude Code: registered");
    expect(c).toMatchObject({ ok: false, fix: "baglam setup" });
    expect(c?.detail).toMatch(/without BAGLAM_AGENT/);
  });

  it("reports a failed handshake", async () => {
    const { host, dbPath, project } = machine();
    runSetup(host, { confirm: () => true });
    const checks = await runDoctor({ host, dbPath, cwd: project, handshake: async () => "spawn ENOENT" });
    expect(checks.find((x) => x.name === "Cursor: connects")).toMatchObject({ ok: false, detail: expect.stringMatching(/ENOENT/) });
  });

  it("reports an uninitialised folder", async () => {
    const { host, dbPath, project } = machine();
    const checks = await runDoctor({ host, dbPath, cwd: project, handshake: async () => null });
    expect(checks.find((x) => x.name === "This folder")).toMatchObject({ ok: false, fix: "baglam init" });
    expect(checks.find((x) => x.name === "Agent instructions")).toMatchObject({ ok: false, fix: "baglam init" });
  });

  it("reports a database from a newer version", async () => {
    const { host, dbPath, project } = machine();
    new ContextStore(dbPath).close();
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(dbPath);
    db.exec("PRAGMA user_version = 99");
    db.close();
    const checks = await runDoctor({ host, dbPath, cwd: project, handshake: async () => null });
    expect(checks.find((x) => x.name === "Database")).toMatchObject({ ok: false, detail: expect.stringMatching(/newer/) });
  });

  it("does not create the database when it is missing", async () => {
    const { host, dbPath, project } = machine();
    const checks = await runDoctor({ host, dbPath, cwd: project, handshake: async () => null });
    expect(checks.find((x) => x.name === "Database")).toMatchObject({ ok: true, detail: expect.stringMatching(/not created yet/) });
    expect(existsSync(dbPath)).toBe(false);
  });

  it("cli: doctor exits 1 on failure", async () => {
    const { host, project } = machine();
    const out: string[] = [];
    const code = await runCli(["doctor", "--project", project], {
      store: new ContextStore(":memory:"), project: "x", user: "ev", print: (s) => out.push(s), host,
      doctor: { handshake: async () => null, dbPath: join(mkdtempSync(join(tmpdir(), "d-")), "x.db") },
    });
    expect(code).toBe(1);
    expect(out.join("\n")).toMatch(/✗ Cursor: registered/);
    expect(out.join("\n")).toMatch(/baglam setup/);
  });

  it("doctor flags outdated instructions", async () => {
    const { host, dbPath, project } = machine();
    const store = new ContextStore(dbPath);
    runInit(project, { store, host });
    store.close();
    writeFileSync(join(project, "AGENTS.md"), "<!-- baglam:start -->\nold text\n<!-- baglam:end -->\n");
    const checks = await runDoctor({ host, dbPath, cwd: project, handshake: async () => null });
    expect(checks.find((x) => x.name === "Agent instructions")).toMatchObject({ ok: false, detail: expect.stringMatching(/outdated/), fix: "baglam init" });
  });

  it("doctor checks every expected instruction file (e.g. missing Cursor rule or Copilot instructions)", async () => {
    const { host, dbPath, project } = machine();
    mkdirSync(join(host.appData, "Code", "User"), { recursive: true });
    const store = new ContextStore(dbPath);
    runInit(project, { store, host });
    store.close();
    // Simulate a tool added after init: remove its instruction file.
    const { rmSync } = await import("node:fs");
    rmSync(join(project, ".github", "copilot-instructions.md"));
    const checks = await runDoctor({ host, dbPath, cwd: project, handshake: async () => null });
    expect(checks.find((x) => x.name === "Agent instructions")).toMatchObject({
      ok: false,
      detail: expect.stringMatching(/\.github\/copilot-instructions\.md/),
      fix: "baglam init",
    });
  });

  it("doctor flags a stale Node binary path after a Node upgrade", async () => {
    const { host, dbPath, project } = machine();
    writeFileSync(
      join(host.home, ".cursor", "mcp.json"),
      JSON.stringify({ mcpServers: { baglam: { command: "/old/nvm/v20/bin/node", args: [host.cliPath, "mcp"], env: { BAGLAM_AGENT: "cursor" } } } }),
    );
    const checks = await runDoctor({ host, dbPath, cwd: project, handshake: async () => null });
    expect(checks.find((x) => x.name === "Cursor: registered")).toMatchObject({
      ok: false,
      detail: expect.stringMatching(/different Node/),
      fix: "baglam setup",
    });
  });

  it("doctor runs MCP handshakes concurrently while keeping deterministic client order", async () => {
    const { host, dbPath, project } = machine();
    mkdirSync(join(host.home, ".codex"));
    mkdirSync(join(host.home, ".gemini", "config"), { recursive: true });
    writeFileSync(join(host.home, ".gemini", "config", ".migrated"), "");
    runSetup(host, { confirm: () => true });

    let active = 0;
    let peak = 0;
    const handshake = async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 120));
      active--;
      return null;
    };
    const checks = await runDoctor({ host, dbPath, cwd: project, handshake });
    expect(peak).toBeGreaterThanOrEqual(3);
    const connects = checks.filter((c) => c.name.endsWith(": connects")).map((c) => c.name);
    expect(connects).toEqual(["Codex CLI: connects", "Antigravity: connects", "Cursor: connects"]);
  });
});

describe("doctor: automatic saving", () => {
  it("reports missing hooks with the fix", async () => {
    const { host, dbPath, project } = machine();
    writeFileSync(join(host.home, ".cursor", "mcp.json"), "{}");
    const checks = await runDoctor({ host, dbPath, cwd: project, handshake: async () => null });
    expect(checks.find((c) => c.name === "Cursor: auto-save")).toMatchObject({ ok: false, fix: "baglam setup" });
  });

  it("says when each tool last saved automatically", async () => {
    const { host, dbPath, project } = machine();
    runSetup(host, { confirm: () => true });
    let checks = await runDoctor({ host, dbPath, cwd: project, handshake: async () => null });
    expect(checks.find((c) => c.name === "Cursor: auto-save")).toMatchObject({ ok: true });
    expect(checks.find((c) => c.name === "Cursor: auto-save")!.detail).toMatch(/installed; no automatic save yet/);
    const store = new ContextStore(dbPath);
    store.noteHookSeen("cursor", "prompt");
    store.close();
    checks = await runDoctor({ host, dbPath, cwd: project, handshake: async () => null });
    expect(checks.find((c) => c.name === "Cursor: auto-save")!.detail).toMatch(/last automatic save just now/);
  });

  it("tells Codex users to trust the hooks once", async () => {
    const { host, dbPath, project } = machine();
    mkdirSync(join(host.home, ".codex"));
    runSetup(host, { confirm: () => true });
    const checks = await runDoctor({ host, dbPath, cwd: project, handshake: async () => null });
    expect(checks.find((c) => c.name === "Codex CLI: auto-save")!.detail).toMatch(/run \/hooks and trust/);
  });
});
