import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ContextStore } from "./store.js";
import { SCHEMA_VERSION } from "./migrate.js";
import { normalizeProject } from "./config.js";
import { isUnsafeProjectDir, resolveDirectory } from "./project.js";
import { BLOCK_START } from "./instructions.js";
import { detectClients } from "./setup.js";
import type { HostEnv } from "./host.js";
import type { ServerEntryShape } from "./clients/types.js";

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
  /** Command that fixes a failed check. */
  fix?: string;
}

/** Start the entry like the tool would and list its tools. Returns an error message, or null when fine. */
export type Handshake = (entry: ServerEntryShape) => Promise<string | null>;

const EXPECTED_TOOLS = ["context_brief", "context_get", "context_propose", "context_search"];
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

  try {
    new ContextStore(opts.dbPath).close();
    checks.push({ name: "Database", ok: true, detail: `${opts.dbPath} (schema ${SCHEMA_VERSION})` });
  } catch (err) {
    checks.push({ name: "Database", ok: false, detail: `${opts.dbPath}: ${(err as Error).message}` });
  }

  for (const client of detectClients(host)) {
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
    checks.push({ name: `${client.label}: registered`, ok: true, detail: `as ${s.entry?.env?.BAGLAM_AGENT ?? client.id}` });
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
    const hasBlock = existsSync(agentsMd) && readFileSync(agentsMd, "utf8").includes(BLOCK_START);
    checks.push(
      hasBlock
        ? { name: "Agent instructions", ok: true, detail: "AGENTS.md tells agents to use Bağlam" }
        : { name: "Agent instructions", ok: false, detail: "agents in this folder are not told to use Bağlam", fix: "baglam init" },
    );
  }
  return checks;
}

export function formatCheck(c: Check): string {
  const line = `${c.ok ? "✓" : "✗"} ${c.name} — ${c.detail}`;
  return c.fix ? `${line}\n    fix: ${c.fix}` : line;
}
