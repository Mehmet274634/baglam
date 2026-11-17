# Bağlam: design

## Why
Developers who run several coding agents on the same project (Claude Code, Cursor,
Codex, custom agents) keep re-explaining the same decisions to each one. Context
learned by one agent never reaches the others, so outputs drift and mistakes repeat.

## What it is
A local MCP server plus a CLI. Agents share one **project decision log**:
decisions, conventions, preferences, facts and warnings. Every record carries
provenance (which agent proposed it, why, when, who approved it).

## Goals
- Any MCP client can read the project's shared context and propose additions.
- **Agents propose, humans approve.** Nothing an agent writes reaches other agents
  until a person approves it with the CLI. This is the main defence against
  memory poisoning (one agent reads a hostile page and "teaches" the others).
- Selective sharing: a record can target specific agents (`audience`).
- Records can expire (`ttl_days`) and be replaced (`supersedes`), so stale
  decisions stop circulating.
- Zero native build steps: Node ≥ 22.13 with the built-in `node:sqlite`.

## Non-goals (v0.1)
- No vector search, no embeddings, no cloud sync, no web UI, no auto-extraction
  of "important decisions" from chat transcripts.
- No multi-user auth: one machine, one person.

## Anti-goals
- Becoming a dumping ground: agents must not be able to flood other agents'
  context without a human in the loop.
- Returning stored text in a way that looks like user instructions.

## Approaches considered
1. **MCP server + SQLite, human approval queue (chosen).** Works with every MCP
   client today, local-first, small surface, approval solves trust.
2. Shared Markdown file (`CONTEXT.md`) that every agent reads. Zero infra, but no
   provenance, no scoping, no expiry, and any agent can rewrite it silently.
3. Hosted service with vector memory (Mem0-style). Better recall at scale, but
   needs accounts, sends project data off the machine, and already exists.

## Data model
`entries`: `id`, `project`, `kind` (decision | convention | preference | fact |
warning), `title`, `body`, `rationale`, `tags[]`, `audience[]` (`*` = all agents),
`status` (proposed | approved | rejected | superseded), `source_agent`,
`created_at`, `decided_at`, `decided_by`, `decision_note`, `expires_at`,
`supersedes`, `superseded_by`. Full-text index (FTS5) over title/body/rationale/tags.

Visible to agent A in project P: `project = P`, `status = approved`, not expired,
and `audience` contains `*` or A.

## Identity
- **Project:** `BAGLAM_PROJECT` env, else the git root above the working
  directory, else the working directory. Normalised (forward slashes, lower-case
  on Windows).
- **Agent:** `BAGLAM_AGENT` env, else the MCP client's `clientInfo.name`.
- **Database:** `BAGLAM_DB` env, else `~/.baglam/baglam.db`.

## MCP tools
| Tool | Purpose |
|---|---|
| `context_brief` | Call at the start of a task: all active approved context for this agent, grouped by kind, plus pending count. |
| `context_search` | Full-text search over visible records, optional `kind` filter. |
| `context_get` | One record with its supersede chain. |
| `context_propose` | Propose a record (lands as `proposed`). |

Agents cannot approve, reject or delete.

## CLI (`baglam`)
`pending`, `approve <id...> | --all`, `reject <id> [--note]`, `add <kind> <title> <body>`
(human-authored, approved at once), `list`, `show <id>`, `projects`.
Approving a record that `supersedes` another marks the old one `superseded`.

## Left to the builder
Output formatting, ID format, CLI ergonomics.
