#!/usr/bin/env node
import { parseArgs } from "node:util";
import { userInfo } from "node:os";
import { pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";
import { ContextStore, KINDS, type Entry, type Kind } from "./store.js";
import { day, formatEntry } from "./format.js";
import { resolveDbPath } from "./config.js";
import { resolveProject } from "./project.js";

const USAGE = `Usage: baglam <command> [options]

Review what agents proposed:
  pending [--all-projects]            List proposals waiting for review
  approve <id...> | --all [--note t]  Approve proposals (they become visible to agents)
  reject <id> [--note text]           Reject a proposal

For AI tools:
  mcp                                 Run the MCP server on stdio (what you register in Claude Code, Cursor, …)

Manage context yourself:
  add <kind> <title> <body> [--why text] [--tags a,b] [--to agent,agent] [--ttl days] [--replaces id]
                                      Add an approved record (kind: ${KINDS.join(" | ")})
  list [--everything]                 Show active records (--everything: all statuses)
  show <id>                           Show one record in full
  projects                            Projects in the database with counts

Options:
  --project <path>                    Project to act on (default: git root of the current folder)

Environment: BAGLAM_DB (database path), BAGLAM_PROJECT (project override)`;

export interface CliContext {
  store: ContextStore;
  project: string;
  user: string;
  print: (line: string) => void;
}

const list = (v: string | undefined) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : undefined);

function summary(e: Entry): string {
  return `${e.id}  [${e.kind}] ${e.title}\n         from ${e.sourceAgent} · ${day(e.createdAt)}${
    e.supersedes ? ` · replaces ${e.supersedes}` : ""
  }${e.audience.includes("*") ? "" : ` · only for ${e.audience.join(", ")}`}`;
}

export function runCli(argv: string[], ctx: CliContext): number {
  const { store, project, user, print } = ctx;
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        all: { type: "boolean" },
        "all-projects": { type: "boolean" },
        everything: { type: "boolean" },
        note: { type: "string" },
        why: { type: "string" },
        tags: { type: "string" },
        to: { type: "string" },
        ttl: { type: "string" },
        replaces: { type: "string" },
        project: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (err) {
    print(`${(err as Error).message}\n\n${USAGE}`);
    return 1;
  }
  const { values: o, positionals } = parsed;
  const [cmd, ...args] = positionals;

  try {
    switch (cmd) {
      case "pending": {
        const items = store.pending(o["all-projects"] ? undefined : project);
        if (!items.length) {
          print("Nothing waiting for review.");
          return 0;
        }
        for (const e of items) {
          print(summary(e) + (o["all-projects"] ? `\n         project ${e.project}` : ""));
          print(`         ${e.body.replace(/\s+/g, " ").slice(0, 160)}`);
        }
        print(`\n${items.length} pending. Approve: baglam approve <id...>  ·  Reject: baglam reject <id>`);
        return 0;
      }
      case "approve": {
        const ids = o.all ? store.pending(project).map((e) => e.id) : args;
        if (!ids.length) throw new Error(o.all ? "nothing pending" : "give at least one id, or --all");
        for (const id of ids) {
          const e = store.approve(id, user, o.note);
          print(`approved ${e.id}  ${e.title}`);
        }
        return 0;
      }
      case "reject": {
        if (args.length !== 1) throw new Error("give exactly one id");
        const e = store.reject(args[0], user, o.note);
        print(`rejected ${e.id}  ${e.title}`);
        return 0;
      }
      case "add": {
        const [kind, title, body] = args;
        if (!body) throw new Error("add needs <kind> <title> <body>");
        const e = store.addApproved(
          {
            project,
            kind: kind as Kind,
            title,
            body,
            rationale: o.why,
            tags: list(o.tags),
            audience: list(o.to),
            ttlDays: o.ttl ? Number(o.ttl) : undefined,
            supersedes: o.replaces,
          },
          user,
        );
        print(`added ${e.id}  [${e.kind}] ${e.title}`);
        return 0;
      }
      case "list": {
        const items = o.everything
          ? store.all(project)
          : store.all(project).filter((e) => e.status === "approved" && (!e.expiresAt || e.expiresAt > Date.now()));
        if (!items.length) {
          print(`No records for ${project}.`);
          return 0;
        }
        for (const e of items) print(formatEntry(e) + "\n");
        return 0;
      }
      case "show": {
        const e = store.get(args[0] ?? "");
        if (!e) throw new Error(`unknown entry ${args[0] ?? ""}`);
        print(`${formatEntry(e, { full: true })}\nProject: ${e.project}`);
        return 0;
      }
      case "projects": {
        const rows = store.projects();
        if (!rows.length) print("No projects yet.");
        for (const r of rows) print(`${String(r.approved).padStart(4)} active  ${String(r.pending).padStart(3)} pending  ${r.project}`);
        return 0;
      }
      case undefined:
      case "help":
        print(USAGE);
        return o.help || cmd === "help" ? 0 : 1;
      default:
        print(`Unknown command "${cmd}".\n\n${USAGE}`);
        return 1;
    }
  } catch (err) {
    print(`Error: ${(err as Error).message}`);
    return 1;
  }
}

function isMain(): boolean {
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (isMain() && process.argv[2] === "mcp") {
  const { startMcpServer } = await import("./mcp.js");
  await startMcpServer();
} else if (isMain()) {
  const argv = process.argv.slice(2);
  const projectIdx = argv.indexOf("--project");
  const store = new ContextStore(resolveDbPath());
  const code = runCli(argv, {
    store,
    project: resolveProject(projectIdx >= 0 ? argv[projectIdx + 1] : undefined),
    user: process.env.BAGLAM_USER?.trim() || `human:${userInfo().username}`,
    print: (s) => console.log(s),
  });
  store.close();
  process.exitCode = code;
}
