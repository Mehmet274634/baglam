import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Everything setup/init/doctor need from the machine, so tests can run against a temp home. */
export interface HostEnv {
  home: string;
  /** Per-user app config root: %APPDATA% on Windows, ~/Library/Application Support on macOS, ~/.config on Linux. */
  appData: string;
  platform: NodeJS.Platform;
  /** Absolute paths written into tool configs (GUI apps often have no PATH). */
  nodePath: string;
  cliPath: string;
  run(cmd: string, args: string[]): { code: number; stdout: string; stderr: string };
  hasCommand(cmd: string): boolean;
}

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

export function realHost(): HostEnv {
  const home = homedir();
  const appData =
    process.platform === "win32"
      ? (process.env.APPDATA ?? join(home, "AppData", "Roaming"))
      : process.platform === "darwin"
        ? join(home, "Library", "Application Support")
        : (process.env.XDG_CONFIG_HOME ?? join(home, ".config"));
  return {
    home,
    appData,
    platform: process.platform,
    nodePath: process.execPath,
    cliPath: join(PACKAGE_ROOT, "dist", "cli.js"),
    run(cmd, args) {
      const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 60_000, windowsHide: true });
      return { code: r.status ?? (r.error ? 127 : 1), stdout: r.stdout ?? "", stderr: r.stderr || r.error?.message || "" };
    },
    hasCommand(cmd) {
      const probe = spawnSync(process.platform === "win32" ? "where" : "which", [cmd], { encoding: "utf8", windowsHide: true });
      return probe.status === 0;
    },
  };
}

/** The MCP server entry every tool gets: absolute node + cli path, and the tool's agent id. */
export function serverEntry(host: HostEnv, agentId: string): { command: string; args: string[]; env: Record<string, string> } {
  return { command: host.nodePath, args: [host.cliPath, "mcp"], env: { BAGLAM_AGENT: agentId } };
}

/** Copy `file` to `file.baglam-backup` unless that backup already exists. */
export function backupOnce(file: string): boolean {
  const backup = `${file}.baglam-backup`;
  if (!existsSync(file) || existsSync(backup)) return false;
  copyFileSync(file, backup);
  return true;
}
