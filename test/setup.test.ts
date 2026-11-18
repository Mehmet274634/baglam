import { describe, it, expect } from "vitest";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { testHost } from "./helpers.js";
import { runSetup } from "../src/setup.js";
import { runCli } from "../src/cli.js";
import { ContextStore } from "../src/store.js";
import type { ClientAdapter } from "../src/clients/types.js";
import { codex } from "../src/clients/codex.js";
import { cursor } from "../src/clients/json.js";

function hostWithCursorAndCodex() {
  const host = testHost();
  mkdirSync(join(host.home, ".cursor"));
  mkdirSync(join(host.home, ".codex"));
  return host;
}

describe("runSetup", () => {
  it("installs into every detected client", () => {
    const host = hostWithCursorAndCodex();
    const r = runSetup(host, { confirm: () => true });
    expect(r.detected).toEqual(["codex", "cursor"]);
    expect(r.changes.filter((c) => !c.part).map((c) => [c.client, c.action])).toEqual([["codex", "added"], ["cursor", "added"]]);
    expect(existsSync(join(host.home, ".cursor", "mcp.json"))).toBe(true);
  });

  it("confirm=false changes nothing", () => {
    const host = hostWithCursorAndCodex();
    const seen: string[][] = [];
    const r = runSetup(host, { confirm: (d) => (seen.push(d.map((c) => c.id)), false) });
    expect(seen).toEqual([["codex", "cursor"]]);
    expect(r.changes).toEqual([]);
    expect(existsSync(join(host.home, ".cursor", "mcp.json"))).toBe(false);
  });

  it("dry run writes nothing", () => {
    const host = hostWithCursorAndCodex();
    const r = runSetup(host, { confirm: () => true, dryRun: true });
    expect(r.changes.filter((c) => !c.part).map((c) => c.action)).toEqual(["added", "added"]);
    expect(existsSync(join(host.home, ".cursor", "mcp.json"))).toBe(false);
  });

  it("undo removes from every client", () => {
    const host = hostWithCursorAndCodex();
    runSetup(host, { confirm: () => true });
    const r = runSetup(host, { confirm: () => true, undo: true });
    expect(r.changes.filter((c) => !c.part).map((c) => c.action)).toEqual(["removed", "removed"]);
    expect(JSON.parse(readFileSync(join(host.home, ".cursor", "mcp.json"), "utf8")).mcpServers).toEqual({});
  });

  it("nothing detected means no confirm and no changes", () => {
    let asked = false;
    const r = runSetup(testHost(), { confirm: () => ((asked = true), true) });
    expect(asked).toBe(false);
    expect(r).toEqual({ detected: [], changes: [] });
  });

  it("one failing adapter does not stop the others", () => {
    const host = hostWithCursorAndCodex();
    const broken: ClientAdapter = {
      id: "broken", label: "Broken", detect: () => true,
      install: () => { throw new Error("disk full"); },
      uninstall: () => { throw new Error("disk full"); },
      status: () => ({ installed: true, registered: false }),
    };
    const r = runSetup(host, { confirm: () => true, clients: [broken, codex, cursor] });
    expect(r.changes[0]).toMatchObject({ client: "broken", action: "skipped", note: "disk full" });
    expect(r.changes.slice(1).every((c) => c.action === "added")).toBe(true);
  });

  it("cli: setup --yes prints a line per change", () => {
    const host = hostWithCursorAndCodex();
    const out: string[] = [];
    const code = runCli(["setup", "--yes"], {
      store: new ContextStore(":memory:"), project: "x", user: "ev", print: (s) => out.push(s), host,
    });
    expect(code).toBe(0);
    const text = out.join("\n");
    expect(text).toMatch(/Codex CLI\s+added/);
    expect(text).toMatch(/Cursor\s+added/);
    expect(text).toMatch(/Restart/);
  });

  it("cli: setup without --yes in a non-interactive shell refuses", () => {
    const host = hostWithCursorAndCodex();
    const out: string[] = [];
    const code = runCli(["setup"], {
      store: new ContextStore(":memory:"), project: "x", user: "ev", print: (s) => out.push(s), host, interactive: false,
    });
    expect(code).toBe(1);
    expect(out.join("\n")).toMatch(/--yes/);
    expect(existsSync(join(host.home, ".cursor", "mcp.json"))).toBe(false);
  });

  it("cli: refuses to register a copy inside the npx cache", () => {
    const host = { ...hostWithCursorAndCodex(), cliPath: "C:/Users/ev/AppData/Local/npm-cache/_npx/1a2b/node_modules/baglam/dist/cli.js" };
    const out: string[] = [];
    const code = runCli(["setup", "--yes"], {
      store: new ContextStore(":memory:"), project: "x", user: "ev", print: (s) => out.push(s), host,
    });
    expect(code).toBe(1);
    expect(out.join("\n")).toMatch(/npm i -g baglam/);
    expect(existsSync(join(host.home, ".cursor", "mcp.json"))).toBe(false);
  });
});

describe("automatic saving hooks", () => {
  it("setup installs them for each tool, undo removes them", () => {
    const host = hostWithCursorAndCodex();
    const r = runSetup(host, { confirm: () => true });
    expect(r.changes.filter((c) => c.part === "auto-save").map((c) => [c.client, c.action])).toEqual([["codex", "added"], ["cursor", "added"]]);
    expect(existsSync(join(host.home, ".codex", "hooks.json"))).toBe(true);
    expect(existsSync(join(host.home, ".cursor", "hooks.json"))).toBe(true);
    const u = runSetup(host, { confirm: () => true, undo: true });
    expect(u.changes.filter((c) => c.part === "auto-save").map((c) => c.action)).toEqual(["removed", "removed"]);
    expect(existsSync(join(host.home, ".cursor", "hooks.json"))).toBe(false);
  });

  it("cli prints the hook files as their own lines", () => {
    const host = hostWithCursorAndCodex();
    const out: string[] = [];
    runCli(["setup", "--yes"], { store: new ContextStore(":memory:"), project: "x", user: "ev", print: (s) => out.push(s), host });
    expect(out.join("\n")).toMatch(/Cursor auto-save\s+added\s+\S*hooks\.json/);
  });
});
