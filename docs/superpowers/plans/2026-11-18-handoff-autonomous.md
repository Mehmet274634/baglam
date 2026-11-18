# Bağlam · Handoff and autonomous mode · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Any agent can continue another agent's unfinished task (live handoff + git snapshot), and a project can share agents' records instantly with review afterwards (autonomous mode).

**Architecture:** New `src/handoff.ts` (types, validation, merge rules) and `src/git.ts` (read-only git snapshot) sit beside `ContextStore`, which gains schema v6 tables. `server.ts` adds `context_checkpoint`, `context_handoff` and the brief's "Continue from here" section; `policy.ts` gains the autonomous branch. CLI and panel get thin layers over the same store methods.

**Tech Stack:** as v1 (TypeScript, node:sqlite, MCP SDK, Preact panel). No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-11-18-handoff-autonomous-design.md` (incl. "Settled after builder review").

## Global Constraints
- One live handoff per (project, branch); branch `"-"` when the folder is not a git repo.
- Field caps: goal 300; done ≤ 30 × 300; now 1000; next ≤ 20 × 300; files ≤ 50 × 300; blockers 1000; notes 2000. All handoff text is secret-scanned (refused, nothing stored).
- Handoff expiry 7 days after last update (`BAGLAM_HANDOFF_TTL_DAYS`); `done` visible 24 h in the brief; history keeps the last 50 per (project, branch); same agent writing again within 60 s replaces its last history entry.
- Every checkpoint is written immediately.
- Brief: "Continue from here" ≤ 35 % of the brief budget; shown only for a live, unexpired, not-done (or done < 24 h) handoff on the caller's branch; other-branch handoffs get one line.
- Git: commands run with `cwd` = project folder, 2 s timeout each, never throw; snapshot omitted on any failure.
- Autonomous mode: off by default, per project key; only verified agents; secrets blocked, flood limit kept, look-alikes of **rejected** records wait for review; everything else shared now with `review_state = 'unreviewed'`.
- Undo: new record → `rejected` (note "undone after automatic sharing"); replacement B → B rejected, A restored only if A is `superseded` with `superseded_by = B`; refused if B is already superseded ("undo <C> first").
- Trust rules unchanged; their approvals never get `review_state`.

## Review Focus
1. **An agent rewords the goal while continuing** → same task, done/next kept. → Task 1 test `rewording the goal keeps the task`.
2. **Agent dies after editing files past its last checkpoint** → next brief lists those files from git. → Task 6 test `resume after an abrupt stop`.
3. **Two worktrees of one project on different branches** → separate handoffs, each brief shows its own; other branch is one line. → Task 3 test `other branch is mentioned, not continued`.
4. **Handoff text containing a secret or a 10 MB string** → refused/capped, nothing stored, no crash. → Task 1 tests `checkpoint refuses secrets`, `checkpoint caps field sizes`.
5. **Undo after the replaced record changed** → replacement undone, old one not resurrected, clear message. → Task 1 test `undo leaves a changed original alone`.

---

### Task 1: Store (schema v6)
**Files:** `src/migrate.ts`, `src/handoff.ts` (new), `src/store.ts`. Tests `test/handoff-store.test.ts`, `test/autonomous-store.test.ts`.
**Produces:**
```ts
// src/handoff.ts
export type HandoffStatus = "in_progress" | "blocked" | "done";
export interface Handoff { project: string; branch: string; dir: string | null; taskId: string; goal: string; status: HandoffStatus;
  done: string[]; now: string | null; next: string[]; files: string[]; blockers: string | null; notes: string | null;
  agent: string; createdAt: number; updatedAt: number; expiresAt: number }
export interface CheckpointInput { project: string; branch: string; dir?: string; agent: string; goal?: string; status?: HandoffStatus;
  done?: string[]; doneAdd?: string[]; now?: string; next?: string[]; files?: string[]; blockers?: string; notes?: string; newTask?: boolean }
export function validateCheckpoint(i: CheckpointInput): CheckpointInput   // caps, trims, throws on bad status / missing goal for a new task
// store
checkpoint(i: CheckpointInput): Handoff            // secret-scans (throws "looks like a secret: …"), merge rules per spec
getHandoff(project: string, branch: string): Handoff | undefined   // undefined when expired
listHandoffs(project?: string): Handoff[]          // live ones, newest first
handoffHistory(project: string, branch: string, limit?: number): (Handoff & { replaced?: boolean })[]
clearHandoff(project: string, branch: string, by: string): boolean // sets done, keeps history
setAutonomous(project: string, on: boolean, by: string): void; isAutonomous(project: string): boolean
unreviewed(project?: string): Entry[]; keep(ids: string[], by: string): number
undoAuto(id: string, by: string): { undone: Entry; restored?: Entry; note?: string }
findRejectedSimilar(project, text, opts?): Entry[]
```
Schema v6: `handoffs(project, branch, dir, task_id, data TEXT JSON, agent, created_at, updated_at, expires_at, PRIMARY KEY(project, branch))`, `handoff_history(seq, project, branch, task_id, data, agent, at)`, `project_settings(project PRIMARY KEY, autonomous INTEGER, changed_at, changed_by)`, `entries.review_state TEXT`. `rekeyProject` also moves handoffs, history, settings. `Entry.reviewState: "unreviewed" | "kept" | null`.
- [ ] Tests: `first checkpoint needs a goal`, `rewording the goal keeps the task`, `new_task archives the old task`, `done_add appends; omitted fields keep values`, `checkpoint refuses secrets`, `checkpoint caps field sizes`, `expired handoff is gone`, `history coalesces same agent within 60 s`, `history keeps 50`, `branches are separate`, `clearHandoff marks done`, `autonomous flag per project`, `undo new record → rejected`, `undo replacement restores original`, `undo leaves a changed original alone`, `undo refused when already replaced`, `keep marks reviewed`, `rekey moves handoffs and settings`, migration test `schema 6`. → FAIL → implement → PASS → commit.

### Task 2: Git snapshot
**Files:** `src/git.ts`. Test `test/git.test.ts` (temp repos via `git init`; skipped if git missing).
**Produces:** `gitSnapshot(dir: string, since?: number): Promise<GitSnapshot | null>`; `currentBranch(dir: string): string` (sync, `"-"` when not a repo); `interface GitSnapshot { branch: string; ahead: number | null; behind: number | null; changed: string[]; changedCount: number; commitsSince: { hash: string; subject: string; at: number }[]; lastCommit?: { hash; subject; at } }`.
- [ ] Tests: `not a repo → null and branch "-"`, `reports branch and uncommitted files`, `commits since a time`, `caps changed list at 20 with full count`, `timeout returns null` (via injected slow command). → implement with `execFile("git", …, { cwd, timeout: 2000 })` → commit.

### Task 3: Agent tools, brief, autonomous policy, instructions
**Files:** `src/server.ts`, `src/format.ts`, `src/policy.ts`, `src/instructions.ts`, `src/doctor.ts`. Tests in `test/server.test.ts`, `test/format.test.ts`, `test/policy.test.ts`, `test/doctor.test.ts`, `test/init.test.ts`.
- `context_checkpoint` (fields as snake_case: `goal, status, done, done_add, now, next, files, blockers, notes, new_task, project_path`); branch from `currentBranch(project.dir)`; returns "Saved progress for <goal> (<branch>)."; secret → tool error.
- `context_handoff`: live handoff + last 10 history entries + git snapshot.
- `formatBrief` gains `handoff?: { handoff: Handoff; git: GitSnapshot | null; otherBranches: Handoff[] }`, rendering "Continue from here" (wording from spec) within 35 % budget.
- Prompt `baglam_resume`.
- `submitProposal` autonomous branch (constraints above); returns `{ status: "auto-shared", entry }` → reply "Saved and shared now (autonomous mode); the owner reviews it afterwards."
- Instruction block adds the two checkpoint paragraphs from spec §4; `doctor` check "Agent instructions" fails with "outdated" when the block differs from `instructionBlock()`.
- [ ] Tests: `checkpoint tool saves and brief shows Continue from here`, `other branch is mentioned, not continued`, `done task shows 24 h then disappears`, `brief stays within budget with a huge handoff`, `autonomous: verified agent shared now as unreviewed`, `autonomous: unverified waits`, `autonomous: rejected look-alike waits`, `autonomous: secret blocked`, `instruction block mentions context_checkpoint`, `doctor flags outdated instructions`. → commit.

### Task 4: CLI
**Files:** `src/cli.ts`. Test `test/cli.test.ts`.
- `auto on|off|status [--yes]`, `handoff [--branch b] [--history] [--copy]`, `handoff clear`, `review`, `keep <id…>|--all`, `undo <id>`. `--copy` writes the resume prompt via `clip`/`pbcopy`/`xclip`/`wl-copy` through `HostEnv.run`; falls back to printing it.
- [ ] Tests per command incl. `auto on needs --yes when not interactive`, `handoff --copy falls back to printing`. → commit.

### Task 5: Panel
**Files:** `src/ui/api.ts`, `ui/src/*`. Tests `test/ui-api.test.ts`, `test/ui-app.test.tsx`.
- API: `GET /api/handoffs?project`, `GET /api/handoffs/:project/:branch` (with history + git), `POST /api/handoffs/:project/:branch/clear`, `GET /api/review?project`, `POST /api/review/keep {ids}`, `POST /api/entries/:id/undo`, `GET/POST /api/projects/:key/autonomous {on}`.
- UI: Inbox top "Continue from here" cards (checklist of done/next, files, blockers, who/when, git changes since; Copy resume prompt; Mark done; history drawer); "Shared automatically" list with Keep / Undo / Keep all; Projects shows live task line + Autonomous badge; Settings autonomous switch with explanation + confirm. All strings in i18n (tr/en).
- [ ] Tests: API happy paths + `undo conflict message`; UI `continue card renders checklist as text`, `keep and undo call the api`, `autonomous switch asks to confirm`. Browser check at desktop and 375 px. → commit.

### Task 6: Export/import, end-to-end, speed
**Files:** `src/portable.ts`, `test/portable.test.ts`, `test/resume-e2e.test.ts`, `test/perf.test.ts`, docs (`README.md`, `README.tr.md`, `docs/clients.md`, `CHANGELOG.md`).
- Export/import include `handoffs` and `settings` (optional sections).
- [ ] `resume after an abrupt stop`: temp git repo; agent A (claude-code, verified) checkpoints twice, writes two files, never checkpoints again; agent B (codex) `context_brief` contains the goal, B's next steps from A, and both files under "Since then (git)". `brief with handoff + git` timing recorded in perf test. Docs updated. → commit.
