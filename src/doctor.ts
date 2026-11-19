import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { DatabaseSync } from "node:sqlite";
import { SCHEMA_VERSION } from "./migrate.js";
import { normalizeProject } from "./config.js";
import { isUnsafeProjectDir, resolveDirectory } from "./project.js";
import { BLOCK_START, instructionBlock } from "./instructions.js";
import { detectClients } from "./setup.js";
import type { HostEnv } from "./host.js";
import type { ServerEntryShape } from "./clients/types.js";
import { HOOK_INSTALLERS } from "./clients/hooks.js";
import type { HookClient } from "./hooks/normalize.js";

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
  /** Command that fixes a failed check. */
  fix?: string;
}

/** Start the entry like the tool would and list its tools. Returns an error message, or null when fine. */
export type Handshake = (entry: ServerEntryShape) => Promise<string | null>;

const EXPECTED_TOOLS = ["context_brief", "context_checkpoint", "context_get", "context_handoff", "context_propose", "context_search"];
const MIN_NODE = [22, 13];

export const defaultHandshake: Handshake = async (entry) => {
  const client = new Client({ name: "baglam-doctor", version: "1" });
  const transport = new StdioClientTransport({
    command: entry.command,
    args: entry.args,
    env: { ...(process.env as Record<string, string>), ...(entry.env ?? {}) },
    stderr: "ignore",
  });
  let timer: NodeJS.Timeout | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("no answer within 10 s")), 10_000);
    });
    await Promise.race([client.connect(transport), timeout]);
    const { tools } = await Promise.race([client.listTools(), timeout]);
    const names = tools.map((t) => t.name);
    const missing = EXPECTED_TOOLS.filter((t) => !names.includes(t));
    return missing.length ? `server answered but lacks ${missing.join(", ")}` : null;
  } catch (err) {
    return (err as Error).message;
  } finally {
    clearTimeout(timer);
    await client.close().catch(() => {});
  }
};

function nodeOk(version: string): boolean {
  const [major, minor] = version.split(".").map(Number);
  return major > MIN_NODE[0] || (major === MIN_NODE[0] && minor >= MIN_NODE[1]);
}

const samePath = (a: string, b: string) => normalizeProject(a) === normalizeProject(b);

/** When each tool's hook last fired; read-only, empty for a database older than schema 7. */
function hookSeenReadOnly(dbPath: string): Record<string, number> {
  if (!existsSync(dbPath)) return {};
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true, timeout: 5000 });
    try {
      const rows = db.prepare("SELECT client, at FROM hook_seen").all() as { client: string; at: number }[];
      return Object.fromEntries(rows.map((r) => [r.client, Number(r.at)]));
    } finally {
      db.close();
    }
  } catch {
    return {};
  }
}

function ago(at: number): string {
  const min = Math.round((Date.now() - at) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

function autoSaveCheck(id: string, label: string, s: { installed: boolean; problem?: string }, lastAt: number | undefined): Check {
  const name = `${label}: auto-save`;
  if (s.problem) return { name, ok: false, detail: s.problem, fix: "fix the file, then baglam setup" };
  if (!s.installed) return { name, ok: false, detail: "requests and edits are not saved automatically", fix: "baglam setup" };
  const when = lastAt ? `last automatic save ${ago(lastAt)}` : "no automatic save yet (use the tool in a project)";
  // Codex skips new hooks until the user trusts them once.
  const trust = id === "codex" && !lastAt ? "; open Codex, run /hooks and trust Bağlam's hooks once" : "";
  return { name, ok: true, detail: `installed; ${when}${trust}` };
}

export async function runDoctor(opts: {
  host: HostEnv;
  dbPath: string;
  cwd: string;
  handshake?: Handshake;
}): Promise<Check[]> {
  const { host } = opts;
  const handshake = opts.handshake ?? defaultHandshake;
  const checks: Check[] = [];

  const node = process.versions.node;
  checks.push({
    name: "Node.js",
    ok: nodeOk(node),
    detail: nodeOk(node) ? `v${node}` : `v${node} is too old; Bağlam needs ${MIN_NODE.join(".")} or newer`,
    fix: nodeOk(node) ? undefined : "install Node.js 22 LTS or newer from nodejs.org",
  });

  // Read-only: a check must not create or upgrade anything.
  if (!existsSync(opts.dbPath)) {
    checks.push({ name: "Database", ok: true, detail: `${opts.dbPath} not created yet; it appears on first use` });
  } else {
    try {
      const db = new DatabaseSync(opts.dbPath, { readOnly: true, timeout: 5000 });
      const v = Number((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);
      db.close();
      if (v > SCHEMA_VERSION) {
        checks.push({
          name: "Database",
          ok: false,
          detail: `${opts.dbPath} was written by a newer version of Bağlam (schema ${v})`,
          fix: "npm i -g baglam@latest",
        });
      } else {
        const note = v < SCHEMA_VERSION ? `; upgrades to ${SCHEMA_VERSION} on next use` : "";
        checks.push({ name: "Database", ok: true, detail: `${opts.dbPath} (schema ${v}${note})` });
      }
    } catch (err) {
      checks.push({ name: "Database", ok: false, detail: `${opts.dbPath}: ${(err as Error).message}` });
    }
  }

  const seen = hookSeenReadOnly(opts.dbPath);
  for (const client of detectClients(host)) {
    const hooks = HOOK_INSTALLERS[client.id as HookClient];
    if (hooks) checks.push(autoSaveCheck(client.id, client.label, hooks.status(host), seen[client.id]));
    const s = client.status(host);
    const pointsHere = !!s.entry?.args?.some((a) => samePath(a, host.cliPath));
    if (s.problem) {
      checks.push({ name: `${client.label}: registered`, ok: false, detail: s.problem, fix: "baglam setup" });
      continue;
    }
    if (!s.registered) {
      checks.push({ name: `${client.label}: registered`, ok: false, detail: "Bağlam is not connected to it", fix: "baglam setup" });
      continue;
    }
    if (!pointsHere) {
      checks.push({
        name: `${client.label}: registered`,
        ok: false,
        detail: `points at ${s.entry?.args?.join(" ") ?? "an unknown command"}, not this install`,
        fix: "baglam setup",
      });
      continue;
    }
    const agentId = s.entry?.env?.BAGLAM_AGENT;
    if (!agentId) {
      // Added by hand: the server then runs under the tool's own client name as an unverified agent
      // (no trust rules or autonomous mode, and it may not change a task the hooks saved).
      checks.push({
        name: `${client.label}: registered`,
        ok: false,
        detail: "added without BAGLAM_AGENT, so it runs as an unverified agent under the tool's own name",
        fix: "baglam setup",
      });
      continue;
    }
    checks.push({ name: `${client.label}: registered`, ok: true, detail: `as ${agentId}` });
    const error = await handshake(s.entry!);
    checks.push({
      name: `${client.label}: connects`,
      ok: !error,
      detail: error ?? "server starts and answers",
      fix: error ? "baglam setup, then restart the app" : undefined,
    });
  }

  if (isUnsafeProjectDir(opts.cwd)) {
    checks.push({ name: "This folder", ok: false, detail: `${opts.cwd} is not a project folder`, fix: "cd into a project, then baglam init" });
  } else {
    const ref = resolveDirectory(opts.cwd);
    checks.push(
      ref.initialized
        ? { name: "This folder", ok: true, detail: `project "${ref.name}" (id ${ref.key})` }
        : { name: "This folder", ok: false, detail: ref.warning ?? `${ref.dir} is not initialised`, fix: "baglam init" },
    );
    const agentsMd = join(ref.dir, "AGENTS.md");
    const content = existsSync(agentsMd) ? readFileSync(agentsMd, "utf8").replace(/\r\n/g, "\n") : "";
    const hasBlock = content.includes(BLOCK_START);
    const current = content.includes(instructionBlock());
    checks.push(
      !hasBlock
        ? { name: "Agent instructions", ok: false, detail: "agents in this folder are not told to use Bağlam", fix: "baglam init" }
        : !current
          ? { name: "Agent instructions", ok: false, detail: "AGENTS.md has an outdated Bağlam block (agents miss newer features such as handoffs)", fix: "baglam init" }
          : { name: "Agent instructions", ok: true, detail: "AGENTS.md tells agents to use Bağlam" },
    );
  }
  return checks;
}

export function formatCheck(c: Check): string {
  const line = `${c.ok ? "✓" : "✗"} ${c.name} — ${c.detail}`;
  return c.fix ? `${line}\n    fix: ${c.fix}` : line;
}
