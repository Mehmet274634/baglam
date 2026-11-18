# Bağlam: Handoff and autonomous mode · design

Status: draft for approval · 2026-11-18 · builds on v1.0.0-rc.1

## Intent
A developer works with Claude Code until its tokens run out and wants Codex (or Cursor, Antigravity…) to **continue the same task within seconds**, with no re-explaining and no waiting on approvals.

v1 shares durable knowledge ("how things are done here"). It does not share **work in progress** ("where are we right now"), and its approval step slows down a developer who wants to keep moving. This design adds both, on the same foundation (same database, same tools, same brief, same panel).

Promise to the user, in one line: **"Your agent ran out? The next one picks up where it stopped."**

## Goals
1. **Handoff:** a living, per-project, per-branch note of the current task (goal, done, now, next, files, blockers) that any agent sees first in `context_brief` and can resume from.
2. **Survives abrupt stops:** works even when the previous agent dies mid-task without writing anything (token limit, crash, closed window), because part of the handoff comes from git, not from the agent.
3. **No approval friction for work state:** handoff notes are shared instantly; they are never queued for review.
4. **Autonomous mode (opt-in per project):** durable records from set-up agents are shared instantly too, and the owner reviews them *afterwards* with one-click keep/undo.
5. **Tool-agnostic resume:** a resume prompt the owner can paste into any tool, even one not connected to Bağlam.
6. **Zero new setup:** existing installs get it by upgrading; `baglam init` refreshes the agent instructions; `doctor` says when they are outdated.

## Non-goals
- Moving a conversation transcript between tools, or summarising chat history.
- Detecting token exhaustion or switching tools automatically (the human decides when to switch).
- Merging two agents' simultaneous edits to the same handoff (last writer wins, visibly).
- Cloud sync / multi-user.

## Anti-goals
- The handoff becomes noise: a pile of stale "I'm doing X" notes. (One live note per project+branch, overwritten, expiring.)
- Autonomous mode quietly removes the owner's control: changes the owner cannot see or undo.
- Secrets leak through the fast path. (The secret block applies to handoffs and to autonomous mode exactly as everywhere else.)
- An agent is told to "continue" a task that is already finished or belongs to another branch.

## Approaches considered
1. **Separate handoff channel + git snapshot + post-review autonomous mode (chosen).** Work state and durable knowledge have different lifecycles (minutes vs months), so they get different storage and rules; git provides the part the agent cannot (state at the moment it died).
2. Store handoffs as ordinary records (kind `progress`). Rejected: they would need approval, would accumulate, would compete with decisions for the brief's space, and agents are told to propose only durable things.
3. Agent writes a handoff only "at the end". Rejected: the end is exactly the moment that is lost when tokens run out.

## The design

### 1. Handoff data
One **live handoff per (project, branch)**. Branch = current git branch of the project folder; folders without git use `"-"`.

Fields (all text is secret-scanned; sizes capped):
- `goal`: one line, what the task is (≤ 300)
- `status`: `in_progress` | `blocked` | `done`
- `done`: list of completed steps (≤ 30 items, ≤ 300 each)
- `now`: what is being worked on right now (≤ 1000)
- `next`: ordered list of next steps (≤ 20 items)
- `files`: paths touched or important (≤ 50, project-relative)
- `blockers`: free text (≤ 1000)
- `notes`: anything else the next agent must know (≤ 2000)
- meta: `agent` (who wrote it), `updatedAt`, `createdAt`, `taskId` (stable id while the goal stays the same; a new goal starts a new task)

History: every write is kept as a snapshot in `handoff_history` (last 50 per project+branch) so the panel can show a timeline and the owner can see who did what.

Lifecycle:
- Expires 7 days after the last update (configurable via `BAGLAM_HANDOFF_TTL_DAYS`).
- `status: done` is shown for 24 h as "last task finished", then hidden from the brief (kept in history).
- Writing a new `goal` while the old one is `in_progress` archives the old task into history (the panel shows "replaced by a new task").

### 2. Git snapshot (needs nothing from the agent)
When building a brief, Bağlam reads, with a 2 s timeout and only inside the resolved project folder:
- current branch, ahead/behind upstream,
- uncommitted changes (`git status --porcelain`: count + first 20 paths),
- commits since the handoff's `updatedAt` (up to 10: hash, subject, relative time),
- last commit if there is no handoff.
No git, not a repo, or timeout → section omitted, never an error.

This is what makes resume work after an abrupt stop: even if the last checkpoint is 20 minutes old, the next agent sees the files changed since.

### 3. Agent tools (MCP)
- **`context_checkpoint`** (new): writes the handoff. Accepts the fields above plus `project_path`. Partial updates are allowed: fields not given keep their values; `done_add` appends to `done`. Returns a one-line confirmation. Secret → refused, nothing stored. Rate-limited to 1 write / 5 s per agent per project (later writes within the window replace the pending one; the agent still gets "saved").
- **`context_brief`** (changed): starts with a **"Continue from here"** section when a live, unexpired, unfinished handoff exists for this project+branch:
  ```
  ## Continue from here
  Task: Stripe checkout (in progress) · last update 12 min ago by claude-code
  Done: form validation; price calculation
  Now: webhook handler in src/payment/webhook.ts
  Next: 1) verify signature  2) idempotency  3) tests
  Since then (git): 3 files changed, not committed: src/payment/webhook.ts, …
  Blockers: none
  → If you continue this task, keep calling context_checkpoint as you go.
  ```
  If the handoff is on another branch, the brief says so in one line and does not ask the agent to continue it. Budget: the section takes at most 35% of the brief's token budget; durable records fill the rest.
- **`context_handoff`** (new, read-only): the full live handoff plus the last 10 history entries, for agents that want detail.
- MCP prompt **`baglam_resume`**: "Read context_brief; if there is a task to continue, continue it from 'Next' and checkpoint as you go."

### 4. Agent instructions (written by `baglam init`)
The instruction block gains:
- "When you start or pick up a task, call `context_checkpoint` with the goal. After every meaningful step (a file finished, a test passing, a decision made) call it again with what is done, what you are doing now and what comes next. Do this before long operations too: you may be stopped at any moment and another agent will continue from your last checkpoint."
- "If `context_brief` shows a task to continue and the user's request is about it, continue from 'Next' instead of starting over."

Re-running `baglam init` updates the block in place (existing behaviour). `baglam doctor` reports an **outdated instruction block** (content differs from the current version) with fix `baglam init`.

### 5. Autonomous mode
Per-project setting, off by default. Stored in a new `project_settings` table keyed by project key (works for initialised and path-keyed projects).

When on, a proposal from a **verified** agent (its id set by `baglam setup`):
- with secrets → blocked (unchanged);
- over the flood limit → refused (unchanged);
- that looks like something the owner **rejected before** → still waits for review (the owner already said no once);
- anything else, including replacements (`supersedes`) and look-alikes → **shared immediately**, marked `auto_approved` with `review_state = 'unreviewed'`.

Unverified agents (name reported by the client) are never auto-shared, even in autonomous mode.

**Review afterwards:** the panel's Inbox gets a second list, "Shared automatically · review when you have time", with **Keep** (marks reviewed) and **Undo**:
- Undo of a new record → retired (hidden from agents, history kept).
- Undo of a replacement → the replacement is retired and the record it replaced is restored to active.
- "Keep all" marks every listed one reviewed.

Trust rules keep working and are now explained in the panel as "autonomous mode for only some agents or kinds".

### 6. CLI
- `baglam auto on|off|status [--project p]`: prints the exact rules in effect; `on` asks for confirmation unless `--yes`.
- `baglam handoff [--branch b] [--history]`: shows the live handoff (and timeline).
- `baglam handoff --copy`: copies a ready-to-paste resume prompt (handoff + git snapshot + key decisions) to the clipboard, for tools not connected to Bağlam.
- `baglam handoff clear`: ends the live task (kept in history).
- `baglam review` (terminal version of review-afterwards): lists unreviewed auto-shared records; `baglam keep <id…>|--all`, `baglam undo <id>`.

### 7. Panel
- **Inbox, top:** a "Continue from here" card per project (current branch first): goal, progress (done/next as a checklist), files, blockers, who/when, git changes since; buttons **Copy resume prompt** and **Mark done**; link to the timeline.
- **Inbox:** the "Shared automatically" review list when autonomous mode produced unreviewed records.
- **Projects:** each project shows its live task in one line and an "Autonomous" badge when on.
- **Settings → Autonomous mode:** per-project switch with a plain explanation of what changes and what stays protected; confirmation when turning on.
- **Timeline** (in Records, per project): handoff history interleaved with record events.
- Live updates as today.

### 8. Data and migration
- Schema v6: `handoffs` (project, branch, task_id, fields as JSON, agent, created_at, updated_at, expires_at; unique (project, branch)), `handoff_history`, `project_settings` (project, autonomous, changed_at, changed_by), `entries.review_state` (`null` | `unreviewed` | `kept`).
- Export/import include handoffs and project settings (format `baglam/1` stays readable; new optional sections).
- `rekeyProject` moves handoffs and settings too.

### 9. Quality bar
- Every behaviour above has tests: store, policy, git snapshot (temp repos), MCP tools, CLI, panel API and UI.
- End-to-end test: agent A (claude-code) checkpoints twice and edits files in a temp git repo, then "dies"; agent B (codex) calls `context_brief` and gets the goal, the next steps and the files changed after the last checkpoint.
- Speed: brief with handoff + git snapshot stays < 50 ms excluding git, and git adds ≤ 150 ms on a normal repo (measured; git step skipped when it exceeds 2 s).
- Real-machine check on the owner's setup: Claude Code checkpoints a small task in `deneme`; Codex or Cursor continues it.
- Independent review before merge, as in v1.

## Decided by the builder (owner may override)
- One live handoff per project **and branch** (two branches = two tasks; matches how developers work with worktrees).
- Handoffs are never queued for review (they are work state, not knowledge); secret blocking still applies.
- Autonomous mode is per project, off by default, and uses review-afterwards rather than no review.
- 7-day handoff expiry; 24 h visibility for finished tasks; 1 write / 5 s checkpoint coalescing.
- The tool name `context_checkpoint` (verb agents understand: "save progress").

## Settled after builder review (builder's calls)
1. **Same task vs new task.** While a task is `in_progress` or `blocked`, a different `goal` only rewords it (same `taskId`; `done`/`next` kept). A new task starts only when the caller passes `new_task: true`, or when the live handoff is `done` or expired. The brief and the instructions tell agents: "to continue, don't pass new_task".
2. **"Rejected before"** means records with status `rejected` only (superseded ones are normal history and do not count). **Undo of an auto-shared new record sets it to `rejected`** (note "undone after automatic sharing", actor = owner), so the same thing is not auto-shared again.
3. **Trust rules keep their current, stricter behaviour** (pre-approval; replacements and look-alikes still go to review). Records they approve do not enter the review-afterwards list. The panel explains: "Trust rules: let specific agents or kinds skip review. Autonomous mode: share everything from set-up agents now, review afterwards."
4. **Every checkpoint is saved immediately** (nothing is lost if the agent dies). Only history snapshots are coalesced: a write by the same agent within 60 s of its previous one replaces that history entry instead of adding one.
5. **Undo edge cases.** Undo of a replacement B restores the record A it replaced only if A is still `superseded` with `superseded_by = B`; otherwise B is undone and the panel says A was not restored because it changed since. If B has itself been replaced (by C), Undo of B is refused with "undo C first".
6. **Which folder feeds git.** Each checkpoint stores the folder it was written from (`dir`) and its branch. The brief uses the agent's resolved folder; the panel and `handoff --copy` use the `dir` stored with that handoff. Worktrees on different branches therefore show as separate handoffs, each with its own git details.

## Left to the builder
Exact brief wording, panel layout details, history retention mechanics, git command flags, internal module layout.
