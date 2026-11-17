# Bağlam v1.0: design

Status: draft for approval · 2026-11-17 · builds on v0.1 (`docs/design.md`)

## Intent
v0.1 proved the loop: one agent proposes, the human approves, a different agent
(even from another vendor) reads it. v1.0 turns that prototype into a product an
individual developer can install in one minute and trust daily, with no manual
config editing and no reminders to the agent.

**Audience, in order:** individual developers who use several AI coding tools
(first). Teams and companies later, only once the individual product is
excellent. v1.0 must not make the later team version harder (stable project ids,
clean data model), but builds none of it.

**Quality bar the owner set:** "unique, top-tier, fast, functional." Translated:
- Install-to-first-value in under 2 minutes, one command, zero file editing.
- Every action a non-expert needs (review, approve, edit, find) works from a
  visual panel, not only the terminal.
- Fast: MCP tool calls answer in < 50 ms on 10k records; CLI starts < 300 ms.
- Nothing surprising or unsafe: no secrets leak into shared memory, nothing an
  agent writes reaches other agents unreviewed (unless the owner opts in).
- Works on Windows, macOS and Linux, Turkish and English.

## Goals
1. **`baglam setup`** (once per machine): detects installed AI tools and registers
   the MCP server in each. **`baglam init`** (once per project): gives the project
   a stable identity and writes the agent instructions so agents use Bağlam
   unprompted.
2. **Automatic project detection** for every client: no pinned paths.
3. **Review panel**: `baglam ui` opens a local web app to review, edit-then-approve,
   reject, search and manage records.
4. **Guards**: secret blocking, duplicate detection, proposal flood limits.
5. **Optional trust rules**: auto-approve chosen kinds or agents (off by default).
6. **Diagnostics**: `baglam doctor` explains exactly what is or isn't connected.
7. **Portability**: export/import (Markdown and JSON).
8. **Release-ready**: npm package `baglam` (name is free as of 2026-11-17), CI on
   three OSes, bilingual docs, landing page.

## Non-goals (v1.0)
Cloud sync, accounts, teams, billing, embeddings/vector search, automatic
extraction of decisions from chat transcripts, IDE extensions, mobile.

## Anti-goals
- A setup that edits a user's config files in ways they can't see or undo.
- Shared memory turning into noise: if agents flood the queue, the product failed
  even if every feature works.
- The panel reachable by other machines or other websites.
- Any record text presented to agents as if it were the user's instructions.

## Approaches (decided)
1. **Local-first open tool now, cloud for teams later (chosen by owner).** Fast to
   ship, earns users and feedback, zero data-custody risk.
2. Hosted team SaaS first. Rejected for now: months of auth/billing/security
   work before learning whether people want the core loop.

Panel technology, considered:
- **Static SPA (Preact + Vite) served by a tiny built-in HTTP server (chosen).**
  Small bundle, fast, polished UI possible, no runtime dependency for users.
- Server-rendered HTML with no JS framework: simplest, but edit-in-place, live
  updates and keyboard flows get clumsy.
- Electron/Tauri desktop app: heavy install, overkill for a local review queue.

## The product, part by part

### 1. Installation and setup
- `npm i -g baglam` (or `npx baglam setup`). Node ≥ 22.13 (needed for `node:sqlite`).
- One binary `baglam`; the MCP server is `baglam mcp` (stdio), replacing the
  separate `baglam-mcp` bin.
- **`baglam setup`** detects, shows, then asks once ("Connect these 4 tools? Y/n"):

  | Client | How it's registered |
  |---|---|
  | Claude Code | `claude mcp add -s user` (CLI) |
  | Codex CLI | `~/.codex/config.toml` `[mcp_servers.baglam]` |
  | Antigravity | `~/.gemini/antigravity/mcp_config.json` |
  | Gemini CLI | `~/.gemini/settings.json` `mcpServers` |
  | Cursor | `~/.cursor/mcp.json` |
  | Windsurf | `~/.codeium/windsurf/mcp_config.json` |
  | VS Code (Copilot) | user `mcp.json` |

  Rules: back up every file before changing it (`*.baglam-backup`), merge (never
  overwrite other servers), use the absolute node path (GUI apps often lack PATH),
  print exactly what changed. `baglam setup --undo` removes only Bağlam's entries.
  Exact config paths per OS are verified at build time; a client whose format
  can't be confirmed is skipped with a doctor hint, not guessed.
- **`baglam init`** in a project folder:
  - Creates `.baglam/project.json` `{ "id": "<uuid>", "name": "<folder>" }`. The
    id, not the path, is the project key from now on, so renaming/moving the
    folder keeps history, and a future cloud can sync by id. Committing this file
    is recommended (README explains).
  - Writes an instruction block into the files agents read: `CLAUDE.md`,
    `AGENTS.md` (Codex, Cursor and others), `GEMINI.md`, and
    `.cursor/rules/baglam.mdc`, only for clients setup found, plus `AGENTS.md`
    always. Blocks are fenced with `<!-- baglam:start -->` / `<!-- baglam:end -->`
    so re-running updates in place and `baglam init --undo` removes them.
  - Migrates existing v0.1 path-keyed records of this folder to the new id.

### 2. Project detection (order)
1. `BAGLAM_PROJECT` env (explicit override).
2. MCP **roots** from the client (`roots/list`), when the client supports them;
   re-read on `roots/list_changed`.
3. Server working directory.

From the chosen directory, walk up to the nearest `.baglam/project.json` → its id.
None found → nearest git root's normalised path (v0.1 behaviour), and
`context_brief` tells the agent the project isn't initialised and to suggest
`baglam init` to the user. Several roots → use the one containing a
`.baglam/project.json`; if ambiguous, brief says so and lists them.
The pinned `BAGLAM_PROJECT` in today's Antigravity config is removed by `setup`.

### 3. Agent tools (MCP)
Same four tools as v0.1, improved:
- `context_brief`: grouped records, token-budgeted (default ≈ 2,000 tokens;
  warnings and decisions first, then newest; tells the agent when it truncated
  and to use `context_search`). Includes pending count and setup hints.
- `context_search`, `context_get`: unchanged semantics.
- `context_propose` now returns one of:
  - `pending`: queued for review;
  - `auto-approved`: matched a trust rule;
  - `blocked`: contained a secret; nothing stored, reason given;
  - `possible duplicate`: still queued, but lists the similar records and
    suggests `supersedes`. The panel shows the pair side by side.
- Flood limit: at most 20 pending proposals per agent per project; beyond that,
  proposals are refused with a message telling the agent to stop proposing.
- The MCP server also exposes the brief as a **resource** (`baglam://brief`) for
  clients that prefer resources, and a `baglam_start` **prompt**.

### 4. Guards
- **Secret blocking** on propose and on human add: well-known key formats (AWS,
  GitHub, OpenAI, Anthropic, Google, Stripe, Slack, private-key blocks, JWTs,
  connection strings with passwords) plus a high-entropy token heuristic. Agents
  are blocked; humans get a warning and must confirm.
- **Duplicate detection:** FTS similarity against active records of the same
  project and kind; threshold tuned by tests on a fixture set.
- **Audit trail:** every state change (proposed, edited, approved, rejected,
  superseded, expired, deleted) is appended to an `events` table with actor and
  time. Visible per record in the panel. Needed later for teams; cheap now.

### 5. Trust rules (opt-in)
Configured in the panel or `baglam trust`: e.g. "auto-approve `fact` from
`claude-code`", "auto-approve everything from me". Auto-approved records are
marked as such everywhere. Secret blocking and flood limits still apply. Default:
no rules, everything goes through review.

### 6. Review panel (`baglam ui`)
- Local HTTP server bound to `127.0.0.1` on a free port; opens the browser with a
  one-time token in the URL, exchanged for an HttpOnly cookie. Checks `Host` and
  `Origin` headers (blocks DNS-rebinding and cross-site requests). Stops with
  Ctrl+C; `--port` and `--no-open` flags.
- Screens:
  - **Inbox** (default): pending proposals as cards: kind, title, body, why,
    source agent, time, duplicate warnings. Actions: Approve, Edit & approve,
    Reject (with note), Approve all. Keyboard: `j/k` move, `a` approve, `e` edit,
    `r` reject.
  - **Records**: active records with search, filters (kind, agent, project),
    edit, retire, expiry, audience; "superseded" history chain.
  - **Projects**: all projects with counts, rename, remove.
  - **Settings**: trust rules, language, connected tools (same data as doctor).
- Live: the inbox refreshes when a new proposal arrives (server-sent events,
  polling SQLite change counter).
- Design: clean, calm, dark/light following the OS, Turkish/English following the
  OS locale with a switch. Empty states that teach ("No proposals yet. Ask your
  agent to …").
- Optional desktop notification for new proposals (OS notification via the
  browser's Notification API while the panel is open).

### 7. CLI
Kept and extended: `setup`, `init`, `ui`, `doctor`, `pending`, `approve`,
`reject`, `edit`, `add`, `list`, `show`, `search`, `retire`, `projects`, `trust`,
`export`, `import`, `mcp`. Coloured, aligned output; `--json` on every read
command for scripting. Same TR/EN localisation as the panel.

`baglam doctor` checks: node version, DB readable/writable and schema version,
each detected client's config contains a working entry (spawns the server and
completes an MCP handshake), current folder's project identity, instruction
blocks present. Each failure prints the fix command.

### 8. Data and storage
- SQLite (`node:sqlite`) at `~/.baglam/baglam.db`, WAL mode. Schema migrations
  versioned with `PRAGMA user_version`; v0.1 databases upgrade automatically
  (with a backup copy first).
- New tables: `projects` (id, name, last known path, created), `events` (audit),
  `trust_rules`. Records gain `edited_at`, `auto_approved`.
- Export: `baglam export --format md|json` (human-readable `CONTEXT.md` or full
  JSON). Import JSON merges by id.

### 9. Quality and release
- Tests: unit (store, guards, detection), MCP integration (in-memory and real
  stdio), CLI, panel API, and browser end-to-end tests for the panel's main flows
  (Playwright). Performance test: 10k records, brief and search < 50 ms.
- CI (GitHub Actions): Windows, macOS, Linux × Node 22 and 24; lint, typecheck,
  tests, build, package smoke test (`npm pack` → install → `baglam doctor`).
- Versioning: semver, CHANGELOG, `npm publish` with provenance.
- Docs: README (TR + EN), `docs/` guides per client, troubleshooting.
- Landing page: a single static page (what it is, 30-second demo GIF, install
  command), deployable to Vercel. Publishing anything (npm, GitHub, Vercel)
  happens only after the owner says so.

## Decided by the builder (owner may override)
- Package and command name `baglam` (ASCII; display name "Bağlam").
- Brief token budget 2,000; flood limit 20; both configurable.
- Panel stack: Preact + Vite, bundled into the npm package; no runtime CDN.
- Licence: MIT (common for adoption-first developer tools; owner to confirm
  before publishing, since it affects a future paid tier: open-core with a
  closed cloud service is compatible with MIT).

## Settled after builder review (builder's calls)
- **Agent identity.** `setup` writes a fixed `BAGLAM_AGENT` id into every client
  entry it creates (`claude-code`, `codex`, `antigravity`, `gemini-cli`, `cursor`,
  `windsurf`, `vscode`). Trust rules, flood limits and `audience` match these ids.
  Without `BAGLAM_AGENT` the client-reported name is used but shown as
  "unverified" in the panel, and trust rules never match it. Honest limit, stated
  in docs: on one machine any local process could already write the database, so
  agent ids are labels for the owner's convenience, not a security boundary;
  human approval is the boundary. "Everything from me" means records the human
  adds via CLI/panel.
- **No usable project directory.** All four tools gain an optional `project_path`
  argument (the agent's workspace folder); the instruction block written by `init`
  tells agents to pass it. Resolution order becomes: `project_path` →
  `BAGLAM_PROJECT` → roots → cwd. The home folder, a filesystem root, and the
  Bağlam install folder are never accepted as a project: reads return a clear
  "project unknown, pass project_path" message and writes are refused. `setup`
  removes a pinned `BAGLAM_PROJECT` only after `project_path` is in place.
- **Ambiguous roots.** Writes are refused with the list of candidate roots and a
  request to pass `project_path`; reads return the brief of each candidate that
  has a `.baglam/project.json`, labelled.
- **Trust rules** are global with an optional project scope (`project_id`
  nullable). The panel shows global rules and per-project rules separately.
- **Removing a project** archives it (hidden, restorable, records kept). Permanent
  deletion is a separate, confirmed action that deletes records; `events` rows are
  kept (with record ids) so history survives. A re-appearing archived id (init,
  import) is restored, not duplicated.

## Left to the builder
Visual design details, exact secret patterns and duplicate threshold (tuned by
tests), CLI wording, internal module layout, order of work.

## Delivery
Built in milestones, each usable on its own and verified before the next:
1. Foundation: single `baglam` binary, schema migrations, project ids, events,
   detection with roots. (Fixes today's Antigravity pinning.)
2. `setup`, `init`, `doctor`.
3. Guards and trust rules.
4. Review panel.
5. Export/import, polish, perf, CI, docs, landing page; release candidate.
