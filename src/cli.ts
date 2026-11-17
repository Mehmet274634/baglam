#!/usr/bin/env node
import { parseArgs } from "node:util";
import { userInfo } from "node:os";
import { pathToFileURL } from "node:url";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { ContextStore, KINDS, type Entry, type Kind, type TrustRule } from "./store.js";
import { day, formatEntry } from "./format.js";
import { resolveDbPath } from "./config.js";
import { resolveProject } from "./project.js";
import { realHost, type HostEnv } from "./host.js";
import { detectClients, runSetup } from "./setup.js";
import { runInit } from "./init.js";
import { describeFindings, scanEntryFields } from "./guards.js";
import { exportJson, exportMarkdown, importJson } from "./portable.js";
import { formatCheck, runDoctor, type Handshake } from "./doctor.js";
import { basename } from "node:path";
import type { Change } from "./clients/types.js";

const USAGE = `Usage: baglam <command> [options]

Review what agents proposed:
  pending [--all-projects]            List proposals waiting for review
  approve <id...> | --all [--note t]  Approve proposals (they become visible to agents)
  reject <id> [--note text]           Reject a proposal

Set up:
  setup [--yes] [--dry-run] [--undo]  Connect Bağlam to every AI tool installed on this machine
  init [--here] [--undo]              Prepare this folder: project id + instructions for agents
  doctor                              Check that everything is connected, with fixes
  ui [--port n] [--no-open]           Open the review panel in your browser

For AI tools:
  mcp                                 Run the MCP server on stdio (what you register in Claude Code, Cursor, …)

Move data:
  export [--format md|json] [--out file] [--all-projects]   CONTEXT.md or a full JSON backup
  import <file.json> [--force]        Merge a JSON export (existing records are kept)

Trust (opt-in auto-approval):
  trust add [--agent id] [--kind k] [--global]  Let matching records skip review
  trust list | trust remove <id>

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
  /** Machine access for setup/init/doctor (default: the real machine). */
  host?: HostEnv;
  /** False when nobody can answer a question (CI, piped input). */
  interactive?: boolean;
  /** Answer to "connect these tools?" collected before runCli (interactive shells). */
  confirm?: (labels: string[]) => boolean;
  /** Test seams for doctor. */
  doctor?: { handshake?: Handshake; dbPath?: string };
}

const MARK: Record<Change["action"], string> = {
  added: "✓", updated: "✓", removed: "✓", unchanged: "·", absent: "·", skipped: "✗",
};

export function formatChange(c: Change, label: string): string {
  const line = `${MARK[c.action]} ${label.padEnd(12)} ${c.action.padEnd(9)} ${c.file}`;
  return c.note ? `${line}
    ${c.note}` : line;
}

const list = (v: string | undefined) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : undefined);

function describeRule(r: TrustRule): string {
  const who = r.agent ? `from ${r.agent}` : "from any agent";
  const what = r.kind ? `${r.kind} records` : "all records";
  const where = r.projectId ? "this project" : "all projects";
  return `auto-approve ${what} ${who} in ${where}`;
}

function summary(e: Entry): string {
  return `${e.id}  [${e.kind}] ${e.title}\n         from ${e.sourceAgent} · ${day(e.createdAt)}${
    e.supersedes ? ` · replaces ${e.supersedes}` : ""
  }${e.audience.includes("*") ? "" : ` · only for ${e.audience.join(", ")}`}`;
}

export function runCli(argv: string[], ctx: CliContext): number | Promise<number> {
  const { store, user, print } = ctx;
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
        yes: { type: "boolean", short: "y" },
        "dry-run": { type: "boolean" },
        undo: { type: "boolean" },
        here: { type: "boolean" },
        force: { type: "boolean" },
        global: { type: "boolean" },
        agent: { type: "string" },
        kind: { type: "string" },
        format: { type: "string" },
        out: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (err) {
    print(`${(err as Error).message}\n\n${USAGE}`);
    return 1;
  }
  const { values: o, positionals } = parsed;
  const project = o.project ? resolveProject(o.project) : ctx.project;
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
          if (e.similarTo.length) print(`         ⚠ possible duplicate of ${e.similarTo.join(", ")}`);
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
        const findings = scanEntryFields({ title, body, rationale: o.why, tags: list(o.tags) });
        if (findings.length && !o.force) {
          print(
            `This looks like it contains a secret: ${describeFindings(findings)}.\n` +
              "Anything in Bağlam is shown to your AI agents. Add --force to store it anyway.",
          );
          return 1;
        }
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
      case "setup": {
        const host = ctx.host ?? realHost();
        if (!o.undo && /[\\/]_npx[\\/]/.test(host.cliPath)) {
          print(
            "This copy of Bağlam runs from npm's temporary npx cache, which npm may delete at any time;\n" +
              "registering it would break every tool later. Install it permanently first:\n\n" +
              "  npm i -g baglam\n  baglam setup",
          );
          return 1;
        }
        const found = detectClients(host);
        if (!found.length) {
          print("No supported AI tools found (Claude Code, Codex, Antigravity, Gemini CLI, Cursor, Windsurf, VS Code).");
          return 0;
        }
        const labels = found.map((c) => c.label);
        print(`Found: ${labels.join(", ")}`);
        let confirm: () => boolean;
        if (o.yes || o["dry-run"]) confirm = () => true;
        else if (ctx.confirm) confirm = () => ctx.confirm!(labels);
        else {
          print("Run again with --yes to confirm (this shell cannot ask).");
          return 1;
        }
        const result = runSetup(host, { undo: o.undo, dryRun: o["dry-run"], confirm });
        if (!result.changes.length) {
          print("Nothing changed.");
          return 0;
        }
        const label = (id: string) => found.find((c) => c.id === id)?.label ?? id;
        if (o["dry-run"]) print("Dry run, nothing was written:");
        for (const c of result.changes) print(formatChange(c, label(c.client)));
        const failed = result.changes.filter((c) => c.action === "skipped").length;
        if (!o["dry-run"]) print(`
Restart these apps so they load the change.${failed ? ` ${failed} tool(s) need attention (see ✗ above).` : ""}`);
        return failed ? 1 : 0;
      }
      case "export": {
        const format = o.format ?? "md";
        if (format !== "md" && format !== "json") throw new Error("--format must be md or json");
        const text =
          format === "json"
            ? JSON.stringify(exportJson(store, { project: o["all-projects"] ? undefined : project }), null, 2) + "\n"
            : exportMarkdown(store, project);
        if (o.out) {
          writeFileSync(o.out, text);
          print(`Wrote ${o.out}`);
        } else print(text.trimEnd());
        return 0;
      }
      case "import": {
        if (args.length !== 1) throw new Error("give the export file: baglam import <file.json>");
        let data: unknown;
        try {
          data = JSON.parse(readFileSync(args[0], "utf8"));
        } catch (err) {
          throw new Error(`cannot read ${args[0]} as JSON (${(err as Error).message})`);
        }
        const r = importJson(store, data, { force: o.force, by: user });
        print(`Imported ${r.imported} record(s); ${r.skipped} skipped (already present or unreadable).`);
        for (const b of r.blocked) print(`✗ ${b.id} not imported: looks like a secret (${describeFindings(b.findings)}). Use --force to import anyway.`);
        return r.blocked.length ? 1 : 0;
      }
      case "trust": {
        const [sub, id] = args;
        if (sub === "add") {
          const rule = store.addTrustRule({
            projectId: o.global ? null : project,
            agent: o.agent,
            kind: o.kind as Kind | undefined,
          });
          print(`added ${rule.id}  ${describeRule(rule)}`);
          print(
            "Records matching this rule skip your review. Secrets are always blocked; look-alikes of existing,\n" +
              "rejected or replaced records and anything that replaces a record still come to you for review.",
          );
          return 0;
        }
        if (sub === "list") {
          const rules = store.listTrustRules(project);
          if (!rules.length) print("No trust rules. Every proposal waits for your review.");
          for (const r of rules) print(`${r.id}  ${describeRule(r)}`);
          return 0;
        }
        if (sub === "remove") {
          if (!id) throw new Error("give the rule id (see baglam trust list)");
          if (!store.removeTrustRule(id)) throw new Error(`no trust rule ${id}`);
          print(`removed ${id}`);
          return 0;
        }
        throw new Error("use: baglam trust add|list|remove");
      }
      case "doctor": {
        const host = ctx.host ?? realHost();
        return runDoctor({
          host,
          dbPath: ctx.doctor?.dbPath ?? resolveDbPath(),
          cwd: o.project ?? process.cwd(),
          handshake: ctx.doctor?.handshake,
        }).then(
          (checks) => {
            for (const c of checks) print(formatCheck(c));
            const bad = checks.filter((c) => !c.ok).length;
            print(bad ? `\n${bad} problem(s) found.` : "\nEverything looks good.");
            return bad ? 1 : 0;
          },
          (err: Error) => {
            print(`Error: ${err.message}`);
            return 1;
          },
        );
      }
      case "init": {
        const host = ctx.host ?? realHost();
        const dir = o.project ?? process.cwd();
        const r = runInit(dir, { store, host, undo: o.undo, here: o.here });
        print(`Project: ${r.project.name}  (id ${r.project.key})`);
        print(`Folder:  ${r.project.dir}`);
        if (r.moved) print(`Moved ${r.moved} existing record(s) to this project id.`);
        for (const c of r.changes) print(formatChange(c, basename(c.file)));
        if (o.undo) print("\nInstructions removed. The project id (.baglam/project.json) is kept so its history stays linked.");
        else print("\nAgents in this folder will now load the shared context at the start of each task.\nCommit .baglam/project.json so the project keeps its identity everywhere.");
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

if (isMain() && process.argv[2] === "ui") {
  const { runUi } = await import("./ui/launch.js");
  try {
    await runUi(process.argv.slice(3));
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exitCode = 1;
  }
} else if (isMain() && process.argv[2] === "mcp") {
  const { startMcpServer } = await import("./mcp.js");
  await startMcpServer();
} else if (isMain()) {
  const argv = process.argv.slice(2);
  const interactive = !!process.stdin.isTTY && !!process.stdout.isTTY;
  let confirm: CliContext["confirm"];
  if (argv[0] === "setup" && interactive && !argv.includes("--yes") && !argv.includes("-y") && !argv.includes("--dry-run")) {
    const labels = detectClients(realHost()).map((c) => c.label);
    if (labels.length) {
      const { createInterface } = await import("node:readline/promises");
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const verb = argv.includes("--undo") ? "Disconnect Bağlam from" : "Connect Bağlam to";
      const answer = (await rl.question(`${verb} ${labels.join(", ")}? [Y/n] `)).trim().toLowerCase();
      rl.close();
      const yes = answer === "" || answer === "y" || answer === "yes" || answer === "e" || answer === "evet";
      confirm = () => yes;
    }
  }
  const store = new ContextStore(resolveDbPath());
  const code = await runCli(argv, {
    store,
    project: resolveProject(),
    user: process.env.BAGLAM_USER?.trim() || `human:${userInfo().username}`,
    print: (s) => console.log(s),
    interactive,
    confirm,
  });
  store.close();
  process.exitCode = code;
}
