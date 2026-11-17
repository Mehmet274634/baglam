# Changelog

All notable changes to Bağlam. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

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
