import { join } from "node:path";
import { backupOnce, type HostEnv } from "../host.js";
import type { Change, ClientAdapter, ClientStatus, WriteOptions } from "./types.js";

const ID = "claude-code";
const NAME = "baglam";

/** Claude Code's own config is managed through its CLI, never edited directly. */
const configFile = (h: HostEnv) => join(h.home, ".claude.json");

function get(h: HostEnv) {
  return h.run("claude", ["mcp", "get", NAME]);
}

const samePath = (a: string, b: string) => a.replace(/\\/g, "/").toLowerCase() === b.replace(/\\/g, "/").toLowerCase();

function matches(h: HostEnv, stdout: string): boolean {
  const cmd = /Command:\s*(.*)/.exec(stdout)?.[1]?.trim();
  if (cmd && !samePath(cmd, h.nodePath)) return false;
  return stdout.includes(h.cliPath) && stdout.includes(`BAGLAM_AGENT=${ID}`);
}

const firstLine = (s: string) => s.split(/\r?\n/).find((l) => l.trim())?.trim() ?? "unknown error";

export const claudeCode: ClientAdapter = {
  id: ID,
  label: "Claude Code",

  detect: (h) => h.hasCommand("claude"),

  install(h: HostEnv, opts: WriteOptions = {}): Change {
    const file = configFile(h);
    const current = get(h);
    if (current.code === 0 && matches(h, current.stdout)) return { client: ID, file, action: "unchanged" };
    const action = current.code === 0 ? "updated" : "added";
    if (opts.dryRun) return { client: ID, file, action };
    backupOnce(file);
    h.run("claude", ["mcp", "remove", NAME, "-s", "user"]);
    const add = h.run("claude", [
      "mcp", "add", NAME, "-s", "user", "-e", `BAGLAM_AGENT=${ID}`, "--", h.nodePath, h.cliPath, "mcp",
    ]);
    if (add.code !== 0) {
      const removed = current.code === 0 ? " The previous entry was removed; run setup again once this is fixed." : "";
      return {
        client: ID,
        file,
        action: "skipped",
        note: `claude mcp add failed: ${firstLine(add.stderr || add.stdout)}.${removed}`,
      };
    }
    return { client: ID, file, action };
  },

  uninstall(h: HostEnv, opts: WriteOptions = {}): Change {
    const file = configFile(h);
    if (get(h).code !== 0) return { client: ID, file, action: "absent" };
    if (!opts.dryRun) {
      const r = h.run("claude", ["mcp", "remove", NAME, "-s", "user"]);
      if (r.code !== 0) return { client: ID, file, action: "skipped", note: `claude mcp remove failed: ${firstLine(r.stderr)}` };
    }
    return { client: ID, file, action: "removed" };
  },

  status(h: HostEnv): ClientStatus {
    const installed = h.hasCommand("claude");
    if (!installed) return { installed, registered: false };
    const r = get(h);
    if (r.code !== 0) return { installed, registered: false };
    const args = /Args:\s*(.*)/.exec(r.stdout)?.[1]?.trim().split(/\s+/) ?? [];
    const command = /Command:\s*(.*)/.exec(r.stdout)?.[1]?.trim() ?? "";
    const agent = /BAGLAM_AGENT=(\S+)/.exec(r.stdout)?.[1];
    return {
      installed,
      registered: true,
      entry: { command, args: matches(h, r.stdout) ? [h.cliPath, "mcp"] : args, env: agent ? { BAGLAM_AGENT: agent } : undefined },
    };
  },
};
