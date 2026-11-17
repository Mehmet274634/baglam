import { describe, it, expect } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { testHost } from "./helpers.js";
import { codex } from "../src/clients/codex.js";
import { claudeCode } from "../src/clients/claude.js";
import { ALL_CLIENTS } from "../src/clients/index.js";

function codexFile(home: string, content?: string) {
  const dir = join(home, ".codex");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "config.toml");
  if (content !== undefined) writeFileSync(file, content);
  return file;
}

describe("Codex adapter", () => {
  it("codex appends a block to an existing config", () => {
    const host = testHost();
    const original = 'model = "gpt"\n\n[plugins.x]\nenabled = true\n';
    const file = codexFile(host.home, original);
    expect(codex.install(host).action).toBe("updated");
    const text = readFileSync(file, "utf8");
    expect(text.startsWith(original)).toBe(true);
    expect(text).toContain("[mcp_servers.baglam]");
    expect(text).toContain(`command = ${JSON.stringify(host.nodePath)}`);
    expect(text).toContain(`args = [${JSON.stringify(host.cliPath)}, "mcp"]`);
    expect(text).toContain('env = { BAGLAM_AGENT = "codex" }');
    expect(codex.install(host).action).toBe("unchanged");
    expect(codex.status(host)).toMatchObject({ registered: true, entry: { args: [host.cliPath, "mcp"] } });
  });

  it("replaces the block in place, CRLF preserved", () => {
    const host = testHost();
    const before = 'a = 1\r\n';
    const after = '[other]\r\nx = 2\r\n';
    const file = codexFile(host.home, `${before}# baglam:start\r\n[mcp_servers.baglam]\r\ncommand = "old"\r\n# baglam:end\r\n${after}`);
    expect(codex.install(host).action).toBe("updated");
    const text = readFileSync(file, "utf8");
    expect(text.startsWith(before + "# baglam:start\r\n")).toBe(true);
    expect(text.endsWith("# baglam:end\r\n" + after)).toBe(true);
    expect(text).not.toContain('"old"');
    expect(text.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("codex refuses an unfenced baglam table", () => {
    const host = testHost();
    const original = '[mcp_servers.baglam]\ncommand = "mine"\n';
    const file = codexFile(host.home, original);
    const change = codex.install(host);
    expect(change.action).toBe("skipped");
    expect(change.note).toMatch(/by hand/);
    expect(readFileSync(file, "utf8")).toBe(original);
  });

  it("codex uninstall removes only the block", () => {
    const host = testHost();
    const original = 'model = "gpt"\n';
    const file = codexFile(host.home, original);
    codex.install(host);
    expect(codex.uninstall(host).action).toBe("removed");
    expect(readFileSync(file, "utf8")).toBe(original);
    expect(codex.uninstall(host).action).toBe("absent");
  });

  it("codex escapes Windows paths", () => {
    const host = { ...testHost(), nodePath: "C:\\Program Files\\nodejs\\node.exe" };
    const file = codexFile(host.home, "");
    codex.install(host);
    expect(readFileSync(file, "utf8")).toContain('command = "C:\\\\Program Files\\\\nodejs\\\\node.exe"');
    expect(codex.status(host).entry?.command).toBe("C:\\Program Files\\nodejs\\node.exe");
  });
});

describe("Claude Code adapter", () => {
  it("claude install calls remove then add with the agent id", () => {
    const host = testHost({ commands: { claude: (args) => ({ code: args[1] === "get" ? 1 : 0 }) } });
    expect(claudeCode.detect(host)).toBe(true);
    expect(claudeCode.install(host).action).toBe("added");
    const cmds = host.calls.map((c) => c.slice(0, 3).join(" "));
    expect(cmds).toEqual(["claude mcp get", "claude mcp remove", "claude mcp add"]);
    expect(host.calls[2]).toEqual([
      "claude", "mcp", "add", "baglam", "-s", "user", "-e", "BAGLAM_AGENT=claude-code", "--", host.nodePath, host.cliPath, "mcp",
    ]);
  });

  it("claude install is unchanged when already registered with this cli", () => {
    const host = testHost({
      commands: { claude: (args) => (args[1] === "get" ? { code: 0, stdout: `Args: ${"C:/baglam/dist/cli.js"} mcp\nBAGLAM_AGENT=claude-code` } : { code: 0 }) },
    });
    expect(claudeCode.install(host).action).toBe("unchanged");
    expect(host.calls).toHaveLength(1);
  });

  it("claude failure is reported, others continue", () => {
    const host = testHost({
      commands: { claude: (args) => (args[1] === "add" ? { code: 1, stderr: "boom: config locked\nmore" } : { code: args[1] === "get" ? 1 : 0 }) },
    });
    const change = claudeCode.install(host);
    expect(change.action).toBe("skipped");
    expect(change.note).toContain("boom: config locked");
  });

  it("claude missing is not detected", () => {
    expect(claudeCode.detect(testHost())).toBe(false);
  });
});

describe("client registry", () => {
  it("ALL_CLIENTS ids are unique and in order", () => {
    expect(ALL_CLIENTS.map((c) => c.id)).toEqual(["claude-code", "codex", "antigravity", "gemini-cli", "cursor", "windsurf", "vscode"]);
  });
});
