# Changelog

All notable changes to Bağlam. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [1.0.0-rc.2] - 2026-11-18

### Added
- **Handoff between agents.** `context_checkpoint` saves the task in progress (goal, done, now, next, files, blockers, notes) per project and branch; `context_brief` opens with "Continue from here", including the files git shows changed since, so a task survives an agent stopping abruptly. `context_handoff` gives the details; prompt `baglam_resume`.
- `baglam handoff` (`--history`, `--copy` for a resume prompt usable in any AI tool, `clear`).
- **Autonomous mode** per project: `baglam auto on|off|status`; records from set-up agents are shared at once and reviewed afterwards with `baglam review`, `keep` and `undo` (undoing a replacement restores the original).
- Panel: "Continue from here" cards, "Shared automatically" review list, autonomous switch, task line and badge on Projects.
- Export/import include tasks in progress; an import never turns autonomous mode on by itself.
- `baglam doctor` reports outdated agent instructions and servers missing the new tools.

- **Checkpoint nudges.** Every `context_checkpoint` reply for a task in progress asks for the next checkpoint, and an agent whose own task has not been checkpointed for 5 minutes is reminded on its next tool call (only the session that is working on it; never for blocked or finished tasks). Marking a task done tells the agent to checkpoint a new goal before working on the user's next request, and the agent instructions say a follow-up request in the same conversation is a new task.
- `baglam init` suggests `git init` when the folder is not inside a git repository.

### Changed
- Agent instructions written by `baglam init` teach checkpointing; re-run `baglam init` after upgrading.
- A git repository without commits now keys tasks by its branch name (for example `main`) instead of `-`, so the key no longer changes at the first commit.
- Schema v6 (automatic backup and upgrade).

## [1.0.0-rc.1] - 2026-11-17

First release candidate.

### Added
- **Shared, human-approved memory over MCP.** Agents read approved records with `context_brief` / `context_search` / `context_get` and propose new ones with `context_propose`. Nothing an agent writes reaches other agents until you approve it.
- **One-command setup.** `baglam setup` connects Claude Code, Codex CLI, Antigravity, Gemini CLI, Cursor, Windsurf and VS Code, backing up every file it changes; `--undo` reverts it.
- **Project init.** `baglam init` gives a folder a stable id, moves older path-keyed records to it and writes instructions to `CLAUDE.md`, `AGENTS.md`, `GEMINI.md` and Cursor rules.
- **Automatic project detection** from the agent's `project_path`, MCP roots, `BAGLAM_PROJECT` or the working folder; never writes to a guessed or unsafe folder.
- **Review panel.** `baglam ui` opens a local web panel (Turkish/English, light/dark, phone layout): inbox with keyboard shortcuts, records with history, projects, trust rules, connected tools, live updates.
- **Guards.** Secrets (API keys, tokens, private keys, passwords in URLs, high-entropy strings) are blocked; look-alike records are flagged; each agent can have at most 20 proposals waiting.
- **Trust rules (opt-in).** Let chosen agents or kinds skip review; never for replacements, look-alikes or anything you rejected before.
- **Diagnostics.** `baglam doctor` checks Node, the database, every tool's registration and a live handshake, and the current folder, with a fix for each problem.
- **Export / import.** `baglam export --format md|json`, `baglam import <file.json>`.
- **Audit trail** for every change; versioned database migrations with automatic backups.

### Performance
- Brief, search and duplicate checks stay under 50 ms with 10,000+ records.
