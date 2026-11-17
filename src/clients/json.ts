import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { backupOnce, serverEntry, type HostEnv } from "../host.js";
import type { Change, ClientAdapter, ClientStatus, ServerEntryShape, WriteOptions } from "./types.js";

type Json = Record<string, unknown>;

interface JsonClientOptions {
  id: string;
  label: string;
  configPath: (h: HostEnv) => string;
  /** Exists when the tool is installed. */
  detectPath: (h: HostEnv) => string;
  /** Top-level key holding servers. */
  key?: "mcpServers" | "servers";
  /** VS Code wants `"type": "stdio"` on each server. */
  vscodeStyle?: boolean;
}

const SERVER_NAME = "baglam";

function read(file: string): { ok: true; data: Json; exists: boolean } | { ok: false; error: string } {
  if (!existsSync(file)) return { ok: true, data: {}, exists: false };
  const text = readFileSync(file, "utf8");
  if (!text.trim()) return { ok: true, data: {}, exists: true };
  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== "object" || Array.isArray(data)) return { ok: false, error: `${file} is not a JSON object` };
    return { ok: true, data, exists: true };
  } catch (err) {
    return { ok: false, error: `${file} is not valid JSON (${(err as Error).message}); fix it or add Bağlam by hand` };
  }
}

function write(file: string, data: Json): void {
  backupOnce(file);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

export function jsonClient(o: JsonClientOptions): ClientAdapter {
  const key = o.key ?? "mcpServers";
  const desired = (h: HostEnv): Json => (o.vscodeStyle ? { type: "stdio", ...serverEntry(h, o.id) } : serverEntry(h, o.id));

  return {
    id: o.id,
    label: o.label,

    detect: (h) => existsSync(o.detectPath(h)),

    install(h: HostEnv, opts: WriteOptions = {}): Change {
      const file = o.configPath(h);
      const cur = read(file);
      if (!cur.ok) return { client: o.id, file, action: "skipped", note: cur.error };
      const servers = (cur.data[key] && typeof cur.data[key] === "object" ? cur.data[key] : {}) as Json;
      const want = desired(h);
      if (JSON.stringify(servers[SERVER_NAME]) === JSON.stringify(want)) return { client: o.id, file, action: "unchanged" };
      if (!opts.dryRun) write(file, { ...cur.data, [key]: { ...servers, [SERVER_NAME]: want } });
      return { client: o.id, file, action: cur.exists ? "updated" : "added" };
    },

    uninstall(h: HostEnv, opts: WriteOptions = {}): Change {
      const file = o.configPath(h);
      const cur = read(file);
      if (!cur.ok) return { client: o.id, file, action: "skipped", note: cur.error };
      const servers = cur.data[key] as Json | undefined;
      if (!servers || !(SERVER_NAME in servers)) return { client: o.id, file, action: "absent" };
      const { [SERVER_NAME]: _removed, ...rest } = servers;
      if (!opts.dryRun) write(file, { ...cur.data, [key]: rest });
      return { client: o.id, file, action: "removed" };
    },

    status(h: HostEnv): ClientStatus {
      const installed = existsSync(o.detectPath(h));
      const cur = read(o.configPath(h));
      if (!cur.ok) return { installed, registered: false, problem: cur.error };
      const entry = (cur.data[key] as Json | undefined)?.[SERVER_NAME] as ServerEntryShape | undefined;
      return { installed, registered: !!entry, entry };
    },
  };
}

export const cursor = jsonClient({
  id: "cursor",
  label: "Cursor",
  configPath: (h) => join(h.home, ".cursor", "mcp.json"),
  detectPath: (h) => join(h.home, ".cursor"),
});

export const antigravity = jsonClient({
  id: "antigravity",
  label: "Antigravity",
  configPath: (h) => join(h.home, ".gemini", "antigravity", "mcp_config.json"),
  detectPath: (h) => join(h.home, ".gemini", "antigravity"),
});

export const geminiCli = jsonClient({
  id: "gemini-cli",
  label: "Gemini CLI",
  configPath: (h) => join(h.home, ".gemini", "settings.json"),
  detectPath: (h) => join(h.home, ".gemini", "settings.json"),
});

export const windsurf = jsonClient({
  id: "windsurf",
  label: "Windsurf",
  configPath: (h) => join(h.home, ".codeium", "windsurf", "mcp_config.json"),
  detectPath: (h) => join(h.home, ".codeium", "windsurf"),
});

export const vscode = jsonClient({
  id: "vscode",
  label: "VS Code",
  configPath: (h) => join(h.appData, "Code", "User", "mcp.json"),
  detectPath: (h) => join(h.appData, "Code", "User"),
  key: "servers",
  vscodeStyle: true,
});
