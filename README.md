# Bağlam

**Shared, human-approved project memory for AI coding agents.**

[Türkçe](README.tr.md)

You use Claude Code on Monday, Cursor on Tuesday and Codex on Wednesday, and you explain the same decisions to each of them. Bağlam ("context" in Turkish) gives all your agents one shared memory per project, and you decide what goes into it.

```
 agent learns something ──► proposes it ──► you approve ──► every agent knows it
   (any tool, any vendor)   context_propose   baglam ui      context_brief
```

- **Works with the tools you already use:** Claude Code, Codex CLI, Antigravity, Gemini CLI, Cursor, Windsurf, VS Code (any MCP client).
- **You stay in control:** nothing an agent writes reaches other agents until you approve it, or until a trust rule you set allows it.
- **Safe by default:** secrets are blocked, look-alike records are flagged, and an agent can't flood your queue.
- **Local-first:** one SQLite file on your machine. No account, no cloud, no telemetry.

## Install

Requires Node.js 22.13 or newer.

```bash
npm i -g baglam
baglam setup
```

`setup` finds the AI tools on your computer, shows what it will change and asks once. Every file it touches is backed up first (`*.baglam-backup`), and `baglam setup --undo` removes it again. Restart your tools afterwards.

Then, in each project folder:

```bash
cd my-project
baglam init
```

`init` gives the folder a stable project id (`.baglam/project.json`, worth committing) and adds a short instruction block to `CLAUDE.md`, `AGENTS.md`, `GEMINI.md` and Cursor rules, so agents load the shared context at the start of every task without being told.

## Daily use

```bash
baglam ui        # review panel in your browser
baglam pending   # or review in the terminal
baglam approve <id> · baglam reject <id> --note "why"
```

The panel shows proposals as cards: approve, edit & approve, or reject. Keyboard: `j`/`k` move, `a` approve, `e` edit, `r` reject. It also lists every record with its history, your projects, trust rules and which tools are connected. It runs only on `127.0.0.1`, and its link works once.

Add something yourself, approved at once:

```bash
baglam add warning "Prod DB is read-only" "Never run migrations from an agent session." --ttl 30
baglam add preference "UI copy is Turkish" "All user-facing text is Turkish." --to cursor,claude-code
baglam add decision "Moved to MySQL" "Primary DB is MySQL 8." --replaces <old-id>
```

Kinds: `decision`, `convention`, `preference`, `fact`, `warning`.

## What agents get

| MCP tool | What it does |
|---|---|
| `context_brief` | All approved, active records for this project, warnings and decisions first, kept under a token budget |
| `context_search` | Full-text search over approved records |
| `context_get` | One record, including what it replaced |
| `context_propose` | Propose a record; it waits for your review |

Agents pass `project_path` (their workspace folder), so Bağlam always knows the project. If it can't tell, it refuses to write rather than guess.

## Trust rules (optional)

By default every proposal waits for you. To let some through:

```bash
baglam trust add --agent codex --kind fact          # this project
baglam trust add --kind convention --global         # every project
baglam trust list · baglam trust remove <id>
```

Trust rules never apply to secrets (always blocked), to records that replace another, to look-alikes of existing records, or to anything you rejected before.

## When something doesn't work

```bash
baglam doctor
```

It checks Node, the database, each tool's registration (and starts the server the way the tool would), and the current folder, and prints a fix for each problem. See [docs/troubleshooting.md](docs/troubleshooting.md) and per-tool setup in [docs/clients.md](docs/clients.md).

## Data

- One file: `~/.baglam/baglam.db` (`BAGLAM_DB` to move it). Upgrades back it up first.
- `baglam export --format md` writes a readable `CONTEXT.md`; `--format json` writes a full backup with history; `baglam import <file>` merges one back (existing records are never overwritten).
- Every change is recorded: who proposed, who approved, edits, retirements.

## Limits worth knowing

- Agent names are labels set by `baglam setup`, not a security boundary: any program on your computer can already read the database. Your approval is the boundary.
- Agents that are not set up by `baglam setup` report their own name; the 20-proposal limit counts per name.
- Speed: brief, search and duplicate checks stay under 50 ms with 10,000+ records.

## Development

```bash
npm install
npm test            # unit, MCP, CLI, panel API and UI tests, 10k-record speed test
npm run typecheck
npm run build       # server to dist/, panel to dist/panel
npm run smoke       # pack, install into a temp prefix, run the installed CLI
```

Design: [docs/superpowers/specs/2026-11-17-baglam-v1-design.md](docs/superpowers/specs/2026-11-17-baglam-v1-design.md). Licence: MIT.
