import { existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import type { HostEnv } from "../host.js";
import { HOOK_CLIENTS, type HookClient, type HookEvent } from "../hooks/normalize.js";
import { isPlainObject, read, write, type Json } from "./json.js";
import type { Change, WriteOptions } from "./types.js";

/** Writes, checks and removes Bağlam's automatic-saving hooks in one tool's hook config. */
export interface HookInstaller {
  file(h: HostEnv): string;
  install(h: HostEnv, opts?: WriteOptions): Change;
  uninstall(h: HostEnv, opts?: WriteOptions): Change;
  status(h: HostEnv): { installed: boolean; problem?: string };
}

type Shell = "posix" | "powershell";
const slash = (p: string) => p.replace(/\\/g, "/");

/** `"<node>" "<dist>/hook.js" <client> <event>`; PowerShell needs `&` to run a quoted path. */
export function hookCommand(h: HostEnv, client: HookClient, event: HookEvent, shell: Shell): string {
  const line = `"${slash(h.nodePath)}" "${slash(join(dirname(h.cliPath), "hook.js"))}" ${client} ${event}`;
  return shell === "powershell" ? `& ${line}` : line;
}

const OURS = new RegExp(String.raw`hook\.js"?\s+(?:${HOOK_CLIENTS.join("|")})\s+(?:prompt|edit|stop)\b`);
const isOurs = (handler: unknown) =>
  isPlainObject(handler) && [handler.command, handler.commandWindows].some((c) => typeof c === "string" && OURS.test(c));

/**
 * How a tool lays out hooks:
 * - nested: hooks.<Event> = [{ matcher?, hooks: [handler] }] (Claude Code, Codex, Gemini CLI)
 * - flat:   hooks.<event> = [handler]                         (Cursor, VS Code)
 * - named:  <name>.<Event> = [...]                           (Antigravity; we own the "baglam" name)
 */
type Layout = "nested" | "flat" | "named";

interface Spec {
  client: HookClient;
  layout: Layout;
  file: (h: HostEnv) => string;
  /** The file holds only hooks: delete it when nothing but ours was in it. */
  ownFile: boolean;
  /** Our part: event name → entries to append. Version fields etc. go in `top`. */
  entries: (h: HostEnv) => Record<string, Json[]>;
  top?: Json;
}

const NAMED_KEY = "baglam";

function strip(data: Json, layout: Layout): Json {
  if (layout === "named") {
    const { [NAMED_KEY]: _ours, ...rest } = data;
    return rest;
  }
  if (!isPlainObject(data.hooks)) return data;
  const hooks: Json = {};
  for (const [event, list] of Object.entries(data.hooks)) {
    if (!Array.isArray(list)) {
      hooks[event] = list;
      continue;
    }
    const kept =
      layout === "flat"
        ? list.filter((x) => !isOurs(x))
        : list
            .map((g) => {
              if (!isPlainObject(g) || !Array.isArray(g.hooks) || !g.hooks.some(isOurs)) return g;
              const left = g.hooks.filter((x) => !isOurs(x));
              return left.length ? { ...g, hooks: left } : null;
            })
            .filter((g) => g !== null);
    if (kept.length) hooks[event] = kept;
  }
  const { hooks: _old, ...rest } = data;
  return Object.keys(hooks).length ? { ...rest, hooks } : rest;
}

function merge(data: Json, spec: Spec, h: HostEnv): Json {
  const base = strip(data, spec.layout);
  const ours = spec.entries(h);
  if (spec.layout === "named") return { ...base, [NAMED_KEY]: ours };
  const hooks: Json = isPlainObject(base.hooks) ? { ...base.hooks } : {};
  for (const [event, list] of Object.entries(ours)) {
    const cur = Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : [];
    hooks[event] = [...cur, ...list];
  }
  return { ...(spec.top ?? {}), ...base, hooks };
}

/** Nothing of the user's left (only fields we add ourselves, like "version"). */
const isEmpty = (data: Json, spec: Spec) => Object.keys(data).every((k) => spec.top && k in spec.top);

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function installer(spec: Spec): HookInstaller {
  return {
    file: spec.file,

    install(h, opts = {}) {
      const file = spec.file(h);
      const cur = read(file);
      if (!cur.ok) return { client: spec.client, file, action: "skipped", note: cur.error, part: "auto-save" };
      const next = merge(cur.data, spec, h);
      if (cur.exists && same(next, cur.data)) return { client: spec.client, file, action: "unchanged", part: "auto-save" };
      if (!opts.dryRun) write(file, next, cur.bom);
      return { client: spec.client, file, action: cur.exists ? "updated" : "added", part: "auto-save" };
    },

    uninstall(h, opts = {}) {
      const file = spec.file(h);
      const cur = read(file);
      if (!cur.ok) return { client: spec.client, file, action: "skipped", note: cur.error, part: "auto-save" };
      const next = strip(cur.data, spec.layout);
      if (!cur.exists || same(next, cur.data)) return { client: spec.client, file, action: "absent", part: "auto-save" };
      if (!opts.dryRun) {
        if (spec.ownFile && isEmpty(next, spec)) rmSync(file, { force: true });
        else write(file, next, cur.bom);
      }
      return { client: spec.client, file, action: "removed", part: "auto-save" };
    },

    status(h) {
      const file = spec.file(h);
      if (!existsSync(file)) return { installed: false };
      const cur = read(file);
      if (!cur.ok) return { installed: false, problem: cur.error };
      return { installed: same(merge(cur.data, spec, h), cur.data) };
    },
  };
}

const TIMEOUT_S = 10;
const win = (h: HostEnv) => h.platform === "win32";

/** Claude Code style handler group. */
const group = (command: string, extra: Json = {}, matcher?: string): Json => ({
  ...(matcher ? { matcher } : {}),
  hooks: [{ ...extra, type: "command", command, timeout: TIMEOUT_S }],
});

export const HOOK_INSTALLERS: Record<HookClient, HookInstaller> = {
  "claude-code": installer({
    client: "claude-code",
    layout: "nested",
    ownFile: false,
    file: (h) => join(h.home, ".claude", "settings.json"),
    entries: (h) => ({
      UserPromptSubmit: [group(hookCommand(h, "claude-code", "prompt", "posix"))],
      PostToolUse: [group(hookCommand(h, "claude-code", "edit", "posix"), {}, "Write|Edit|MultiEdit|NotebookEdit")],
      Stop: [group(hookCommand(h, "claude-code", "stop", "posix"))],
    }),
  }),

  codex: installer({
    client: "codex",
    layout: "nested",
    ownFile: true,
    file: (h) => join(h.home, ".codex", "hooks.json"),
    entries: (h) => {
      const handler = (event: HookEvent): Json => ({
        type: "command",
        command: hookCommand(h, "codex", event, "posix"),
        commandWindows: hookCommand(h, "codex", event, "powershell"),
        timeout: TIMEOUT_S,
      });
      return {
        UserPromptSubmit: [{ hooks: [handler("prompt")] }],
        PostToolUse: [{ matcher: "apply_patch|Edit|Write", hooks: [handler("edit")] }],
        Stop: [{ hooks: [handler("stop")] }],
      };
    },
  }),

  "gemini-cli": installer({
    client: "gemini-cli",
    layout: "nested",
    ownFile: false,
    file: (h) => join(h.home, ".gemini", "settings.json"),
    entries: (h) => {
      const handler = (event: HookEvent): Json => ({
        name: `baglam-${event}`,
        type: "command",
        command: hookCommand(h, "gemini-cli", event, "posix"),
        timeout: TIMEOUT_S * 1000,
      });
      return {
        BeforeAgent: [{ matcher: "*", hooks: [handler("prompt")] }],
        AfterTool: [{ matcher: "write_file|replace", hooks: [handler("edit")] }],
        AfterAgent: [{ matcher: "*", hooks: [handler("stop")] }],
      };
    },
  }),

  cursor: installer({
    client: "cursor",
    layout: "flat",
    ownFile: true,
    top: { version: 1 },
    file: (h) => join(h.home, ".cursor", "hooks.json"),
    entries: (h) => {
      // The Cursor desktop app runs hook commands through PowerShell on Windows.
      const shell: Shell = win(h) ? "powershell" : "posix";
      const handler = (event: HookEvent): Json => ({ command: hookCommand(h, "cursor", event, shell), timeout: TIMEOUT_S });
      return { beforeSubmitPrompt: [handler("prompt")], afterFileEdit: [handler("edit")], afterAgentResponse: [handler("stop")] };
    },
  }),

  antigravity: installer({
    client: "antigravity",
    layout: "named",
    ownFile: true,
    file: (h) => join(h.home, ".gemini", "config", "hooks.json"),
    entries: (h) => {
      const handler = (event: HookEvent): Json => ({ type: "command", command: hookCommand(h, "antigravity", event, "posix"), timeout: TIMEOUT_S });
      // Antigravity gives no final reply text, so there is no stop hook.
      return {
        PreInvocation: [handler("prompt")],
        PostToolUse: [{ matcher: "write_to_file|replace_file_content|multi_replace_file_content", hooks: [handler("edit")] }],
      };
    },
  }),

  vscode: installer({
    client: "vscode",
    layout: "flat",
    ownFile: true,
    top: { version: 1 },
    file: (h) => join(h.home, ".copilot", "hooks", "baglam.json"),
    entries: (h) => {
      const handler = (event: HookEvent): Json => ({ type: "command", command: hookCommand(h, "vscode", event, "posix"), timeoutSec: TIMEOUT_S });
      return { userPromptSubmitted: [handler("prompt")], postToolUse: [handler("edit")], agentStop: [handler("stop")] };
    },
  }),
};
