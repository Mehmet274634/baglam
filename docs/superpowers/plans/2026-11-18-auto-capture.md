# Auto-capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tool hooks save the user's request, edited files and the agent's last reply into the live handoff, so a task survives even when the agent never calls `context_checkpoint`.

**Architecture:** A separate tiny entry `dist/hook.js <client> <event>` reads the tool's JSON from stdin, normalises it per tool, and applies capture rules in the store (schema v7). Setup writes our hook entries into each tool's hook config; doctor reports them and when each last fired.

**Tech Stack:** TypeScript, node:sqlite, vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-18-auto-capture-design.md`

## Global Constraints
- Hook process: always exit 0; stdout only the neutral reply per tool (Claude/Codex/VS Code: nothing; Gemini/Antigravity: `{}`; Cursor prompt: `{"continue":true}`, other Cursor events: `{}`).
- No `.baglam/project.json` at/above the working folder → exit before opening the database.
- stdin cap 1 MB, overall deadline 3 s; errors appended to `~/.baglam/hook-errors.log` (truncate when > 256 KB).
- Limits: goal 300, each request 300, last 5 requests, `now` 1000 ("Last reply: " prefix), files 50.
- Secret hit in request/reply → stored as `(hidden: looked like a secret)`.
- Auto-capture never changes `status`, `done`, `next`, `blockers`, `notes`.
- `auto_capture` default on; `BAGLAM_AUTO_CAPTURE=0` disables everywhere.
- Hook commands use absolute forward-slash paths; Cursor on win32 prefixed with `& `; Codex also gets `commandWindows`.
- Tests never rebuild `dist/` (use `.test-dist` as today).

## Review Focus
- "devam et" sent to a second tool while a task is in progress must continue that task, not start one → Task 1 test `prompt continues a live task of another agent`.
- A hook firing in a folder without a marker (e.g. Desktop) must not create anything → Task 3 test `no marker: exits without opening the database`.
- Malformed / empty / huge stdin must still exit 0 with the neutral output → Task 3 tests.
- User's own hooks in the same config files must survive install, re-install and undo byte-for-byte in content → Task 4 tests.
- Automatic edits must not silence the stale-checkpoint reminder (it keys on the agent's own checkpoint time) → Task 5 test.

---

### Task 1: Capture rules in the store (schema v7)

**Files:**
- Modify: `src/migrate.ts` (V7: `ALTER TABLE project_settings ADD COLUMN auto_capture INTEGER NOT NULL DEFAULT 1`; `CREATE TABLE hook_seen (client TEXT PRIMARY KEY, at INTEGER NOT NULL, event TEXT NOT NULL)`)
- Modify: `src/handoff.ts` (Handoff gains `requests: string[]`, `agentAt: number | null`, `autoAt: number | null`; stored in `data`; old rows read as `[]`/`updatedAt`/`null`)
- Create: `src/capture.ts`
- Modify: `src/store.ts` (wrappers)
- Test: `test/capture.test.ts`

**Interfaces:**
- Produces: `type AutoEvent = { kind: "prompt"; text: string } | { kind: "edit"; files: string[] } | { kind: "stop"; reply: string }`
- Produces: `ContextStore.autoCapture(i: { project: string; branch: string; dir: string; agent: string; event: AutoEvent }): Handoff | undefined` (undefined = nothing to do)
- Produces: `ContextStore.setAutoCapture(project: string, on: boolean, by: string): void`, `isAutoCapture(project: string): boolean` (false when env `BAGLAM_AUTO_CAPTURE=0`)
- Produces: `ContextStore.noteHookSeen(client: string, event: string): void`, `hookSeen(): Record<string, { at: number; event: string }>`
- `checkpoint()` from the MCP tool sets `agentAt = now`; autoCapture sets `autoAt = now` and leaves `agentAt`.

- [ ] **Step 1: Write failing tests** in `test/capture.test.ts`:
  - `prompt starts a task when none is live`: goal = first line of "Yapılacaklar uygulaması yap\nayrıntı", status in_progress, requests = [that first line], agentVerified true.
  - `prompt continues a live task of another agent`: claude-code checkpoints goal "Todo"; codex prompt "devam et" → same taskId, goal "Todo", requests ends with "devam et".
  - `prompt after a done task starts a new one` (new taskId, old one stays in history).
  - `requests keep the last 5, each ≤ 300 chars`.
  - `edit adds project-relative paths, dedupes, ignores paths outside the project`, and `edit with no live task does nothing` (returns undefined).
  - `stop sets "Last reply: …" only when the agent has not checkpointed since the last request`; after an agent checkpoint with `now: "X"` a stop leaves `now` = "X".
  - `secret in a request is stored hidden` (use the AWS-key fixture already used in guards tests).
  - `auto-capture never changes status, done or next`.
  - `isAutoCapture defaults on, setAutoCapture off works, env BAGLAM_AUTO_CAPTURE=0 wins`.
  - `migrates a v6 database to v7 keeping handoffs` (old row reads requests `[]`).
- [ ] **Step 2: Run** `npx vitest run test/capture.test.ts` — Expected: FAIL (autoCapture is not a function).
- [ ] **Step 3: Implement** the migration, fields, `src/capture.ts` (`applyAutoEvent(existing, event, ctx): CheckpointInput | null` pure rules) and the store wrappers; autoCapture runs the secret scan, then `handoffs.checkpoint` with the result inside one transaction. Paths: `relative(dir, abs)` with `/`, rejected if it starts with `..` or is absolute.
- [ ] **Step 4: Run** `npx vitest run test/capture.test.ts test/handoff*.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(capture): store rules for automatic saving (schema v7)`.

### Task 2: Per-tool normalisers

**Files:**
- Create: `src/hooks/normalize.ts`
- Test: `test/hook-normalize.test.ts`

**Interfaces:**
- Produces: `type HookClient = "claude-code" | "codex" | "gemini-cli" | "cursor" | "antigravity" | "vscode"`, `type HookEvent = "prompt" | "edit" | "stop"`
- Produces: `normalize(client: HookClient, event: HookEvent, input: unknown): { cwd?: string; event?: AutoEvent }` — never throws.
- Produces: `neutralOutput(client: HookClient, event: HookEvent): string` (values in Global Constraints).

- [ ] **Step 1: Write failing tests**, one fixture per row of the spec's table, using the documented field names:
  - claude-code: prompt `{cwd, prompt}`; edit `{cwd, tool_name:"Edit", tool_input:{file_path}}` and `NotebookEdit` `notebook_path`; stop `{cwd, last_assistant_message}`; stop without it reads the last assistant text from a fixture `transcript_path` JSONL (last line with `type:"assistant"`, text blocks joined).
  - codex: edit `{tool_name:"apply_patch", tool_input:{command:"*** Begin Patch\n*** Update File: src/a.ts\n...\n*** Add File: b.md\n*** End Patch"}}` → files `["src/a.ts","b.md"]` resolved against cwd; stop `last_assistant_message`.
  - gemini-cli: prompt BeforeAgent `prompt`; edit `write_file`/`replace` `tool_input.file_path`; stop AfterAgent `prompt_response`.
  - cursor: prompt `{prompt, workspace_roots:[dir]}` → cwd = dir; edit `{file_path}`; stop afterAgentResponse `{text}`.
  - antigravity: prompt PreInvocation `{lastUserInput, invocationNum:0, workspacePaths:[dir]}` → prompt; `invocationNum:3` → no event; edit `{toolCall:{name:"write_to_file", args:{TargetFile}}}`.
  - vscode: prompt `{prompt, cwd}`; edit `{tool_input:{filePath}}`.
  - garbage (`null`, `"x"`, `{}`) → `{}` for every client/event.
- [ ] **Step 2: Run** `npx vitest run test/hook-normalize.test.ts` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `normalize` and `neutralOutput`; relative paths are resolved against cwd; transcript read is capped at the last 256 KB.
- [ ] **Step 4: Run** the test — Expected: PASS.
- [ ] **Step 5: Commit** `feat(hooks): normalise each tool's hook payload`.

### Task 3: The hook entry point

**Files:**
- Create: `src/hook.ts` (compiled to `dist/hook.js`; must not import `server.ts`, `cli.ts` or the MCP SDK)
- Test: `test/hook-entry.test.ts`, extend `scripts/test-perf.mjs` with a hook timing

**Interfaces:**
- Consumes: Task 1 store API, Task 2 `normalize`/`neutralOutput`, `resolveDirectory` from `src/project.ts`, `currentBranch` from `src/git.ts`.
- Produces: `runHook(argv: string[], io: { stdin: string; env: NodeJS.ProcessEnv; dbPath: string; now?: () => number }): { stdout: string; code: 0 }`; the file's main reads stdin (1 MB / 3 s cap) and calls it.

- [ ] **Step 1: Write failing tests:**
  - `prompt in an initialised folder starts a task` (temp dir + `createMarker`, then store shows the goal).
  - `no marker: exits without opening the database` (dbPath points into a dir that does not exist; file still absent afterwards).
  - `auto_capture off: nothing saved but hook_seen updated`.
  - `bad JSON, empty stdin, unknown client/event: stdout is the neutral output, code 0`, and an error line lands in the log only for real failures (not for "no marker").
  - `records hook_seen per client`.
  - Spawned check: `node .test-dist/hook.js cursor prompt` with stdin fixture prints exactly `{"continue":true}`.
- [ ] **Step 2: Run** `npx vitest run test/hook-entry.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `src/hook.ts`; add `"dist/hook.js"` to package `files` if listed; perf script: 20 spawned prompt hooks, report median, budget < 250 ms on this machine.
- [ ] **Step 4: Run** the test and `npm run test:perf` — Expected: PASS, hook median printed under budget.
- [ ] **Step 5: Commit** `feat(hooks): hook entry that never blocks the tool`.

### Task 4: Install hooks with setup, check them with doctor

**Files:**
- Create: `src/clients/hooks.ts`
- Modify: `src/clients/types.ts` (optional `hooks?: HookInstaller` on ClientAdapter), `src/clients/claude.ts`, `src/clients/codex.ts`, `src/clients/json.ts` (attach installers), `src/setup.ts` (install/uninstall hooks after the MCP entry; Change per hook file), `src/doctor.ts`
- Test: `test/hook-install.test.ts`, extend `test/doctor.test.ts`

**Interfaces:**
- Produces: `interface HookInstaller { file(h: HostEnv): string; install(h: HostEnv, opts?: WriteOptions): Change; uninstall(h: HostEnv, opts?: WriteOptions): Change; status(h: HostEnv): { installed: boolean; problem?: string } }`
- Produces: `hookCommand(h: HostEnv, client: HookClient, event: HookEvent, shell: "posix" | "powershell"): string` → `"<node>" "<dist>/hook.js" <client> <event>` with `/` paths; powershell form prefixed `& `.
- Files and shapes (from the spec table): Claude `~/.claude/settings.json` `hooks.{UserPromptSubmit,PostToolUse(matcher "Write|Edit|MultiEdit|NotebookEdit"),Stop}`; Codex `~/.codex/hooks.json` `hooks.{UserPromptSubmit,PostToolUse(matcher "apply_patch"),Stop}` each with `commandWindows`; Gemini `~/.gemini/settings.json` `hooks.{BeforeAgent,AfterTool(matcher "write_file|replace"),AfterAgent}` with `name: "baglam-<event>"`; Cursor `~/.cursor/hooks.json` `{version:1, hooks:{beforeSubmitPrompt,afterFileEdit,afterAgentResponse}}`; Antigravity `~/.gemini/config/hooks.json` `{"baglam":{PreInvocation:[...], PostToolUse:[{matcher:"write_to_file|replace_file_content|multi_replace_file_content", hooks:[...]}]}}`; VS Code `~/.copilot/hooks/baglam.json` `{version:1, hooks:{userPromptSubmitted, postToolUse, agentStop}}`.
- Our entries are found by the substring `hook.js <client-id> ` in `command`.

- [ ] **Step 1: Write failing tests** (temp HOME via `testHost()`):
  - per client: install writes the expected events; second install → `unchanged`; a pre-existing user hook in the same event array is kept; `--undo` leaves the user's hook and removes the file only when it held nothing but ours (Cursor/VS Code/Antigravity) — Claude/Gemini settings files are never deleted.
  - invalid JSON in a hook file → `skipped` with a note, file untouched.
  - BOM and CRLF preserved (reuse the json.ts read/write helpers).
  - doctor: shows `<Tool>: auto-save` ok/missing with fix `baglam setup`; shows `last automatic save: never` / `3 min ago` from `hookSeen()`; Codex line adds "open Codex, run /hooks and trust Bağlam's hooks once" while Codex has never been seen.
- [ ] **Step 2: Run** `npx vitest run test/hook-install.test.ts test/doctor.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** installers (shared JSON read/write from `json.ts`, `backupOnce` before the first write), wire into setup/undo and doctor.
- [ ] **Step 4: Run** the tests — Expected: PASS.
- [ ] **Step 5: Commit** `feat(setup): install automatic-saving hooks for every tool`.

### Task 5: Show it, switch it, keep reminders honest

**Files:**
- Modify: `src/format.ts` (Continue section: `Asked: <last request>` line, `(saved automatically from the tool; the agent did not checkpoint this task)` when `agentAt` is null), `src/server.ts` (reminder staleness uses `agentAt ?? updatedAt`; checkpoint sets agentAt via store), `src/cli.ts` (`baglam capture on|off|status`, USAGE line; `handoff` prints Asked), `src/ui/api.ts` (`GET/POST /api/projects/:key/capture`), `ui/src/components/AutoCaptureSwitch.tsx` (copy of AutonomousSwitch without confirm), `ui/src/components/ContinueCard.tsx` (Asked line + auto badge), `ui/src/i18n` (tr/en strings), `ui/src/api.ts`, `ui/src/types.ts`, projects screen placement next to AutonomousSwitch
- Test: `test/format.test.ts`, `test/nudges.test.ts`, `test/cli*.test.ts`, `test/ui-api.test.ts`, panel component test next to existing ones

- [ ] **Step 1: Write failing tests:**
  - brief shows `Asked: devam et` and the automatic line for an auto-only task, not for one the agent checkpointed.
  - nudges: agent checkpoints, clock +6 min, autoCapture edit at +5 min → reminder still appears (uses agentAt).
  - cli: `capture off` → `isAutoCapture` false and status prints "Automatic saving is off"; `capture on` back.
  - api: POST capture false/true round-trips; requires the session cookie like the autonomous route.
  - ContinueCard renders the last request and the auto badge (tr strings).
- [ ] **Step 2: Run** those tests — Expected: FAIL.
- [ ] **Step 3: Implement**; i18n tr: `"capture.title": "Otomatik kayıt"`, `"capture.on": "Açık: istekler, değişen dosyalar ve son cevap kendiliğinden kaydedilir"`, `"capture.off": "Kapalı"`, `"continue.asked": "İstenen"`, `"continue.auto": "Otomatik kaydedildi"`; en equivalents.
- [ ] **Step 4: Run** `npx vitest run` — Expected: all pass.
- [ ] **Step 5: Commit** `feat(capture): brief, CLI and panel show and switch automatic saving`.

### Task 6: Real tools end to end, docs, release

**Files:**
- Modify: `README.md`, `README.tr.md`, `docs/clients.md`, `docs/troubleshooting.md`, `CHANGELOG.md`
- Test: manual run recorded in `.superpowers/sdd/auto-capture/progress.md`

- [ ] **Step 1:** `npm run build`, `node dist/cli.js setup --yes` (or interactive confirm), `node dist/cli.js doctor` → every installed tool shows auto-save ok.
- [ ] **Step 2: Headless real runs** in a fresh temp project (`git init`, `baglam init`), with prompts that forbid calling Bağlam tools ("do not use any MCP tools"):
  - `claude -p "create hello.txt containing hi"` → `baglam handoff` shows goal from the prompt, `Files: hello.txt`, `Now: Last reply: …`.
  - `codex exec "create hi.md with one line"` → same (after trusting hooks once if Codex reports review needed; if trust blocks headless use, record it and use `--dangerously-bypass-hook-trust` only for this test).
  - `gemini -p "create g.txt with one line" --yolo` → same.
  - Cursor, Antigravity, VS Code: ask the user to send one prompt each in that project; doctor's "last automatic save" proves it fired.
- [ ] **Step 3:** Docs: what is saved, where to switch it off, Codex trust step, privacy line ("your requests are stored locally in ~/.baglam; secrets are hidden").
- [ ] **Step 4:** Full `npx vitest run`, `npm run test:perf`; final whole-branch review by a fresh reviewer; fix findings.
- [ ] **Step 5: Commit, merge to main, `npm run build`, doctor** — `feat: automatic saving (1.0.0-rc.3)`, version bump in `package.json`/`src/version.ts`.
