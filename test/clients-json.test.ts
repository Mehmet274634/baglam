import { describe, it, expect } from "vitest";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { testHost } from "./helpers.js";
import { serverEntry } from "../src/host.js";
import { antigravity, cursor, vscode } from "../src/clients/json.js";

const write = (file: string, data: string) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data);
};
const readJson = (file: string) => JSON.parse(readFileSync(file, "utf8"));

describe("JSON client adapters", () => {
  it("adds an entry and keeps other servers", () => {
    const host = testHost();
    const file = join(host.home, ".cursor", "mcp.json");
    write(file, JSON.stringify({ mcpServers: { other: { command: "x" } } }));
    const change = cursor.install(host);
    expect(change).toMatchObject({ client: "cursor", action: "updated", file });
    const cfg = readJson(file);
    expect(cfg.mcpServers.other).toEqual({ command: "x" });
    expect(cfg.mcpServers.baglam).toEqual(serverEntry(host, "cursor"));
  });

  it("creates a missing config file", () => {
    const host = testHost();
    mkdirSync(join(host.home, ".cursor"));
    expect(cursor.install(host).action).toBe("added");
    expect(readJson(join(host.home, ".cursor", "mcp.json")).mcpServers.baglam.env).toEqual({ BAGLAM_AGENT: "cursor" });
  });

  it("replaces a pinned BAGLAM_PROJECT entry", () => {
    const host = testHost();
    const file = join(host.home, ".gemini", "antigravity", "mcp_config.json");
    write(file, JSON.stringify({ mcpServers: { baglam: { command: "node", args: ["old/mcp.js"], env: { BAGLAM_AGENT: "antigravity", BAGLAM_PROJECT: "C:/x" } } } }));
    expect(antigravity.install(host).action).toBe("updated");
    expect(readJson(file).mcpServers.baglam.env).toEqual({ BAGLAM_AGENT: "antigravity" });
  });

  it("is idempotent", () => {
    const host = testHost();
    const file = join(host.home, ".cursor", "mcp.json");
    write(file, JSON.stringify({ mcpServers: {} }));
    cursor.install(host);
    expect(cursor.install(host).action).toBe("unchanged");
    expect(readdirSync(dirname(file)).filter((f) => f.endsWith(".baglam-backup"))).toEqual(["mcp.json.baglam-backup"]);
  });

  it("skips an unparsable config untouched", () => {
    const host = testHost();
    const file = join(host.home, ".cursor", "mcp.json");
    const original = '{ // my servers\n  "mcpServers": {},\n}\n';
    write(file, original);
    const change = cursor.install(host);
    expect(change.action).toBe("skipped");
    expect(change.note).toMatch(/not valid JSON/);
    expect(readFileSync(file, "utf8")).toBe(original);
    expect(existsSync(file + ".baglam-backup")).toBe(false);
  });

  it("dry run reports without writing", () => {
    const host = testHost();
    const file = join(host.home, ".cursor", "mcp.json");
    write(file, "{}");
    expect(cursor.install(host, { dryRun: true }).action).toBe("updated");
    expect(readFileSync(file, "utf8")).toBe("{}");
  });

  it("vscode uses servers + type stdio", () => {
    const host = testHost();
    mkdirSync(join(host.appData, "Code", "User"), { recursive: true });
    expect(vscode.detect(host)).toBe(true);
    vscode.install(host);
    const cfg = readJson(join(host.appData, "Code", "User", "mcp.json"));
    expect(cfg.servers.baglam).toEqual({ type: "stdio", ...serverEntry(host, "vscode") });
    expect(cfg.mcpServers).toBeUndefined();
  });

  it("uninstall removes only baglam", () => {
    const host = testHost();
    const file = join(host.home, ".cursor", "mcp.json");
    write(file, JSON.stringify({ mcpServers: { other: { command: "x" } } }));
    cursor.install(host);
    expect(cursor.uninstall(host).action).toBe("removed");
    expect(readJson(file).mcpServers).toEqual({ other: { command: "x" } });
    expect(cursor.uninstall(host).action).toBe("absent");
  });

  it("status reports registration and entry", () => {
    const host = testHost();
    expect(cursor.status(host)).toMatchObject({ installed: false, registered: false });
    mkdirSync(join(host.home, ".cursor"));
    expect(cursor.status(host)).toMatchObject({ installed: true, registered: false });
    cursor.install(host);
    const s = cursor.status(host);
    expect(s.registered).toBe(true);
    expect(s.entry?.args).toEqual([host.cliPath, "mcp"]);
  });
});
