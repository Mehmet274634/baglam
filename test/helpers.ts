import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HostEnv, RunOptions } from "../src/host.js";

export interface TestHost extends HostEnv {
  calls: string[][];
}

/** A HostEnv rooted in a fresh temp folder. `commands` decides which CLIs exist and what they return. */
export function testHost(
  opts: {
    commands?: Record<string, (args: string[], input?: string, opts?: RunOptions) => { code: number; stdout?: string; stderr?: string }>;
  } = {},
): TestHost {
  const base = mkdtempSync(join(tmpdir(), "baglam-host-"));
  const home = join(base, "home");
  const appData = join(base, "appdata");
  mkdirSync(home, { recursive: true });
  mkdirSync(appData, { recursive: true });
  const calls: string[][] = [];
  const commands = opts.commands ?? {};
  return {
    home,
    appData,
    platform: process.platform,
    nodePath: "C:/node/node.exe",
    cliPath: "C:/baglam/dist/cli.js",
    calls,
    hasCommand: (cmd) => cmd in commands,
    run: (cmd, args, input, opts) => {
      calls.push([cmd, ...args]);
      const fn = commands[cmd];
      if (!fn) return { code: 127, stdout: "", stderr: `${cmd}: not found` };
      const r = fn(args, input, opts);
      return { code: r.code, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
    },
  };
}
