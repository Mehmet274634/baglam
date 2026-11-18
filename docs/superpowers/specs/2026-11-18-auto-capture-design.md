# Automatic saving (auto-capture) — design

## Why
Handoffs only work when the agent calls `context_checkpoint`, and agents forget. In the real test on
2026-11-18 Claude finished a task, then built three more features in the same chat without one
checkpoint; had it stopped, the next agent would have seen "last task done" and nothing else.
The user wants progress saved even when the agent forgets: a safety net, not a replacement for the
agent's own, richer checkpoints.

## Goals
- Every AI tool Bağlam sets up records, without the agent's cooperation:
  1. the user's request when it is sent (starts a task when none is in progress),
  2. every file the agent edits,
  3. the agent's last reply when its turn ends ("where it stands"), when the tool provides it.
- Zero extra steps for the user: `baglam setup` installs it, `setup --undo` removes it, `doctor` checks it.
- Never slows down, blocks or breaks the AI tool. Never writes outside initialised projects.
- On by default; one switch per project (CLI + panel) turns it off. Secrets are never stored.

## Non-goals
- Replacing agent checkpoints: the agent's own `done/next` stay the best source; auto data fills gaps.
- Guessing "done" or "next" from text. Auto-capture never marks a task done.
- Windsurf (not used by the user; can follow later with the same pattern).

## Anti-goals (failure even if it "works")
- A hook that prints something the tool injects into the conversation, blocks a prompt, or adds latency
  the user notices.
- Starting a new task when the user says "devam et" to the next agent (must continue the live one).
- Auto data overwriting what the agent itself wrote.
- Capturing in folders that never ran `baglam init` (hooks fire everywhere).

## Approaches considered
1. **Tool hooks (chosen).** All six tools support lifecycle hooks (checked against official docs
   2026-11-18). Reliable, sees the user's own words and real file edits. Cost: one adapter per tool,
   Codex needs a one-time trust click in `/hooks`.
2. Server-side inference only (MCP server guesses from calls it sees). Sees nothing when the agent never
   calls Bağlam — exactly the failure we are fixing. Rejected.
3. File-watcher daemon. Sees edits but not the request or the reply, needs a background process. Rejected.

## Design

### Hook entry
`node <cli.js> hook <client-id> <event>` with the tool's JSON on stdin. Events: `prompt`, `edit`, `stop`.
- Always exits 0, never throws; prints only the neutral output each tool needs (nothing, `{}` or
  `{"continue": true}`), so it can never block or inject context. Errors go to a small log file
  (`~/.baglam/hook-errors.log`, capped).
- Fast path: parse stdin, find the project marker at/above the working folder (no marker → exit at
  once, database never opened), then a single transaction. Imports only what it needs (no MCP SDK).
- Reads at most 1 MB of stdin; gives up after 3 s.

### Per-tool adapters (normalise to `{cwd, prompt?, files?, reply?}`)
| Tool | Config written by setup | prompt | edit | stop (reply) |
|---|---|---|---|---|
| Claude Code | `~/.claude/settings.json` `hooks` | UserPromptSubmit `prompt` | PostToolUse `Write|Edit|MultiEdit|NotebookEdit` → `tool_input.file_path` / `notebook_path` | Stop `last_assistant_message` if present |
| Codex CLI | `~/.codex/hooks.json` | UserPromptSubmit `prompt` | PostToolUse `apply_patch` → paths parsed from the patch (`*** Add/Update/Delete File:`) | Stop `last_assistant_message` |
| Gemini CLI | `~/.gemini/settings.json` `hooks` | BeforeAgent `prompt` | AfterTool `write_file|replace` → `tool_input.file_path` | AfterAgent `prompt_response` |
| Cursor | `~/.cursor/hooks.json` | beforeSubmitPrompt `prompt` (reply `{"continue":true}`) | afterFileEdit `file_path` | afterAgentResponse `text` |
| Antigravity | `~/.gemini/config/hooks.json` | PreInvocation `lastUserInput` (only when `invocationNum` is the first of a turn) | PostToolUse `write_to_file|replace_file_content|multi_replace_file_content` → `toolCall.args.TargetFile` | — (not provided) |
| VS Code (Copilot) | `~/.copilot/hooks/baglam.json` | userPromptSubmitted `prompt` | postToolUse, file path from `tool_input.file_path`/`filePath`/`path` | agentStop — (best effort) |
Working folder: `cwd`, else `workspace_roots[0]` / `workspacePaths[0]`, else the process cwd.
Each tool's own field names are read defensively; unknown shapes are ignored, never fatal.

Commands are written with absolute, forward-slash paths. Where the tool runs hooks through
PowerShell (Cursor on Windows) the command is prefixed with `& `; Codex gets `commandWindows`.
Bağlam's entries are recognised by the `hook <client-id>` part of the command, so setup updates them
in place, keeps every other hook the user has, backs the file up once, and `--undo` removes only ours.

### Capture rules (store)
- **prompt:** no live task, or the live one is done → start a task, goal = the request's first line
  (cleaned, ≤300 chars). A task in progress (any agent) → keep it and add the request to its
  `requests` list (last 5, ≤300 chars each). So "devam et" to the next agent continues the task.
- **edit:** add the path, relative to the project folder, to `files` (dedupe, newest last, cap 50).
  Paths outside the project are ignored. No live in-progress task → ignored.
- **stop:** if the agent has not checkpointed itself since the last request, set `now` to
  "Last reply: …" (≤1000 chars). If the agent did checkpoint, auto leaves `now` alone.
- Auto-capture never changes `status`, `done`, `next`, `blockers`, `notes`.
- Secrets: request and reply text are scanned with the existing guards; a hit is stored as
  "(hidden: looked like a secret)". Never an error.
- Each handoff records `agentAt` (last checkpoint by the agent itself) and `autoAt`; the stale
  reminder uses `agentAt`, so automatic updates never silence it.
- Writer is the tool's setup id (verified), so the existing verified-agent guard is respected.

### Showing it
- Brief, `baglam handoff`, panel card: requests are shown ("Asked: …"); when the agent never
  checkpointed the task, a line says it was saved automatically from the tool.
- `doctor`: per tool, "auto-save installed" and "last automatic save: 3 min ago / never"
  (a tiny `hook_seen` table), plus the Codex note: "open Codex, run /hooks, trust Bağlam's hooks".

### Switch
Per-project `auto_capture` (default on) in `project_settings` (schema v7).
`baglam capture on|off|status`, a panel switch next to autonomous mode, and
`BAGLAM_AUTO_CAPTURE=0` to turn it off everywhere.

## Left to the builder
Exact module layout, test fixtures per tool, wording of panel strings (tr/en).
