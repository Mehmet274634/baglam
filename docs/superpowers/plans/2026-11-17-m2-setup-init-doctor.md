# Bağlam v1.0 · Milestone 2: setup, init, doctor · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One command connects every installed AI tool (`baglam setup`), one command prepares a project (`baglam init`), and one command explains what is broken (`baglam doctor`), with no hand-edited config.

**Architecture:** A `HostEnv` value (home, appData, platform, node path, CLI path, command runner) is the only way setup/init/doctor touch the machine, so tests run against a temp home. Each AI tool is a `ClientAdapter`; JSON-config tools share one adapter factory, Codex has a TOML adapter, Claude Code goes through its own CLI.

**Tech Stack:** as M1; no new runtime dependencies (TOML handled as a fenced text block).

**Spec:** `docs/superpowers/specs/2026-11-17-baglam-v1-design.md` §1, §7 (`setup`, `init`, `doctor`), "Settled after builder review" (agent ids, project_path).

## Global Constraints
- Server entry written to every tool: `command` = absolute node path (`process.execPath`), `args` = [absolute path of `dist/cli.js`, `"mcp"`], `env` = `{ "BAGLAM_AGENT": "<agent id>" }`. Never `BAGLAM_PROJECT`.
- Agent ids: `claude-code`, `codex`, `antigravity`, `gemini-cli`, `cursor`, `windsurf`, `vscode`.
- Before changing a file: copy it to `<file>.baglam-backup` (only if that backup does not exist yet). Merge, never overwrite other servers or settings. Preserve the file's other content byte-for-byte where the format allows.
- `--undo` removes only Bağlam's entries/blocks; nothing else.
- Instruction blocks are fenced `<!-- baglam:start -->` … `<!-- baglam:end -->` (TOML: `# baglam:start` … `# baglam:end`).
- `createMarker` refuses unsafe folders (M1); `init` reports that refusal as a friendly error, exit 1.
- Every command prints exactly what it changed (path + action).

## Review Focus
1. **Config file with comments / trailing commas / invalid JSON** (users hand-edit these): setup must not destroy it; it skips that tool with a clear message and leaves the file untouched. → Task 1 test `skips an unparsable config untouched`.
2. **Re-running setup or init** changes nothing the second time and creates no second backup. → Task 1 `is idempotent`, Task 4 `re-running init is a no-op`.
3. **Codex `config.toml` with other tables after ours, and CRLF line endings**: the block is replaced in place and the rest is byte-identical. → Task 2 test `replaces the block in place, CRLF preserved`.
4. **`claude` CLI missing or failing** (`claude mcp add` exits non-zero): setup reports it and continues with the other tools. → Task 2 test `claude failure is reported, others continue`.
5. **init in a folder that already has v0.1 path-keyed records** (the user's `deneme`): records move to the new id and stay visible. → Task 4 test `moves path-keyed records to the new id`.

---

### Task 1: HostEnv and the JSON client adapters

**Files:** Create `src/host.ts`, `src/clients/types.ts`, `src/clients/json.ts`. Test `test/clients-json.test.ts`.

**Interfaces (Produces):**
```ts
// src/host.ts
export interface HostEnv {
  home: string; appData: string; platform: NodeJS.Platform;
  nodePath: string; cliPath: string;                 // absolute paths written into configs
  run(cmd: string, args: string[]): { code: number; stdout: string; stderr: string };
  hasCommand(cmd: string): boolean;
}
export function realHost(): HostEnv;                  // cliPath = dist/cli.js of this package
export function serverEntry(host: HostEnv, agentId: string): { command: string; args: string[]; env: Record<string, string> };
export function backupOnce(file: string): boolean;    // true when a backup was written

// src/clients/types.ts
export type ChangeAction = "added" | "updated" | "unchanged" | "removed" | "absent" | "skipped";
export interface Change { client: string; file: string; action: ChangeAction; note?: string }
export interface ClientStatus { installed: boolean; registered: boolean; entry?: { command: string; args: string[]; env?: Record<string, string> }; problem?: string }
export interface ClientAdapter {
  id: string; label: string;
  detect(host: HostEnv): boolean;
  install(host: HostEnv, opts?: { dryRun?: boolean }): Change;
  uninstall(host: HostEnv, opts?: { dryRun?: boolean }): Change;
  status(host: HostEnv): ClientStatus;
}

// src/clients/json.ts
export function jsonClient(o: { id: string; label: string; configPath: (h: HostEnv) => string; detectPath: (h: HostEnv) => string; key?: "mcpServers" | "servers"; vscodeStyle?: boolean }): ClientAdapter;
export const cursor: ClientAdapter;      // ~/.cursor/mcp.json, detect ~/.cursor
export const antigravity: ClientAdapter; // ~/.gemini/antigravity/mcp_config.json, detect ~/.gemini/antigravity
export const geminiCli: ClientAdapter;   // ~/.gemini/settings.json, detect ~/.gemini/settings.json
export const windsurf: ClientAdapter;    // ~/.codeium/windsurf/mcp_config.json, detect ~/.codeium/windsurf
export const vscode: ClientAdapter;      // <appData>/Code/User/mcp.json, key "servers", entry gets "type": "stdio"; detect <appData>/Code/User
```
JSON is written with 2-space indent and a trailing newline; a missing file is created (with parent dirs). Unparsable JSON → `{action:"skipped", note:"…not valid JSON…"}`, file untouched.

- [ ] **Step 1: Failing tests** (temp `home`/`appData` via a `testHost()` helper in `test/helpers.ts` with `run`/`hasCommand` stubs):
  - `adds an entry and keeps other servers` → existing `{"mcpServers":{"other":{"command":"x"}}}` → after install both keys exist; `baglam` equals `serverEntry(host,"cursor")`.
  - `replaces a pinned BAGLAM_PROJECT entry` → antigravity entry with `env.BAGLAM_PROJECT` → after install `env` is exactly `{BAGLAM_AGENT:"antigravity"}`, action `updated`.
  - `is idempotent` → second install `unchanged`, exactly one `.baglam-backup`.
  - `skips an unparsable config untouched` → file `{ // comment\n }` → `skipped`, bytes unchanged, no backup.
  - `vscode uses servers + type stdio`.
  - `uninstall removes only baglam` → other server remains; uninstall on missing file → `absent`.
  - `status reports registration and entry`.
- [ ] **Step 2:** `npx vitest run test/clients-json.test.ts` → FAIL (modules missing).
- [ ] **Step 3: Implement** the three files.
- [ ] **Step 4:** `npx vitest run` → PASS.
- [ ] **Step 5: Commit** `feat(setup): host abstraction and JSON client adapters`.

### Task 2: Codex (TOML) and Claude Code (CLI) adapters, client registry

**Files:** Create `src/clients/codex.ts`, `src/clients/claude.ts`, `src/clients/index.ts`. Test `test/clients-other.test.ts`.

**Interfaces:**
- Consumes: Task 1 types, `serverEntry`, `backupOnce`.
- Produces: `codex: ClientAdapter` (`~/.codex/config.toml`, detect `~/.codex`), `claudeCode: ClientAdapter` (detect `host.hasCommand("claude")`), `ALL_CLIENTS: ClientAdapter[]` in order claude-code, codex, antigravity, gemini-cli, cursor, windsurf, vscode.
- Codex block (TOML strings JSON-escaped, which is valid TOML basic-string escaping):
  ```
  # baglam:start
  [mcp_servers.baglam]
  command = "<node>"
  args = ["<cli>", "mcp"]
  env = { BAGLAM_AGENT = "codex" }
  # baglam:end
  ```
  Existing fenced block → replaced in place; none → appended after one blank line; an unfenced `[mcp_servers.baglam]` table present → `skipped` with note "remove it by hand". Line endings follow the file's (CRLF if it contains `\r\n`).
- Claude: install = `claude mcp remove baglam -s user` (ignore failure) then `claude mcp add baglam -s user -e BAGLAM_AGENT=claude-code -- <node> <cli> mcp`; status = `claude mcp get baglam` exit 0 and stdout contains the cli path; uninstall = `claude mcp remove baglam -s user`. Non-zero add → `skipped` with stderr first line. Install when status already matches → `unchanged` (no CLI writes).

- [ ] **Step 1: Failing tests:**
  - `codex appends a block to an existing config` → original content is a prefix of the new file.
  - `replaces the block in place, CRLF preserved` → content `a = 1\r\n# baglam:start\r\n…old…\r\n# baglam:end\r\n[other]\r\nx = 2\r\n` → text before/after the block byte-identical, block has new values, every newline `\r\n`.
  - `codex refuses an unfenced baglam table`.
  - `codex uninstall removes only the block`.
  - `claude install calls remove then add with the agent id` (recording `run` stub).
  - `claude failure is reported, others continue` → `run` returns code 1 for `add` → `skipped`, note contains stderr.
  - `ALL_CLIENTS ids are unique and in order`.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** `npx vitest run` → PASS.
- [ ] **Step 5: Commit** `feat(setup): Codex and Claude Code adapters`.

### Task 3: `baglam setup`

**Files:** Create `src/setup.ts`; modify `src/cli.ts` (command `setup [--yes] [--dry-run] [--undo]`). Test `test/setup.test.ts`.

**Interfaces:**
- Produces: `runSetup(host: HostEnv, opts: { undo?: boolean; dryRun?: boolean; confirm: (detected: ClientAdapter[]) => boolean; clients?: ClientAdapter[] }): { detected: string[]; changes: Change[] }`.
- Flow: detect → none found: return with no changes → `confirm(detected)` false: no changes → install (or uninstall) each, collecting `Change`s; one adapter throwing becomes a `skipped` change, the rest continue. `dryRun` reports `would add/update/remove` without writing (adapters get a `dryRun` flag via a wrapped host whose fs writes are disabled: implement by passing `dryRun` into `install/uninstall(host, { dryRun })`; add that optional second parameter to the `ClientAdapter` methods).
- CLI prints: detected tools, then one line per change (`✓ cursor  updated  C:\Users\…\mcp.json`), then "Restart these apps so they load Bağlam." Interactive confirm `Connect Bağlam to these N tools? [Y/n]` via `node:readline`; `--yes` skips; non-TTY without `--yes` → refuse with hint.

- [ ] **Step 1: Failing tests:** `installs into every detected client`, `confirm=false changes nothing`, `dry run writes nothing`, `undo removes from every client`, `one failing adapter does not stop the others`, `cli: setup --yes prints a line per change` (via `runCli` with injected host: add `host?: HostEnv` to `CliContext`).
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** `npx vitest run` → PASS.
- [ ] **Step 5: Commit** `feat(cli): baglam setup`.

### Task 4: `baglam init`

**Files:** Create `src/init.ts`, `src/instructions.ts`; modify `src/store.ts` (add `rekeyProject`), `src/cli.ts` (command `init [--undo]`). Test `test/init.test.ts`.

**Interfaces:**
- Produces:
  - `ContextStore.rekeyProject(from: string, to: string): number` (moves entries and events; returns moved entry count; no-op when `from === to`).
  - `instructionBlock(): string`: the fenced Markdown block (exact copy below).
  - `upsertBlock(file: string, block: string): ChangeAction` / `removeBlock(file: string): ChangeAction`: create file if missing; replace an existing fenced block in place; else append after a blank line; preserve line endings.
  - `runInit(dir: string, opts: { store: ContextStore; host: HostEnv; undo?: boolean }): { project: ProjectRef; moved: number; changes: Change[] }`.
- Files written: `CLAUDE.md` and `AGENTS.md` always; `GEMINI.md` when antigravity or gemini-cli is detected; `.cursor/rules/baglam.mdc` (front-matter `---\ndescription: Shared project context (Bağlam)\nalwaysApply: true\n---\n` + block) when cursor is detected.
- Rekey: old key = `normalizeProject(resolveDirectory(dir) before marker)`; after `createMarker`, `rekeyProject(oldKey, marker.id)` and `touchProject`.
- `--undo`: removes the blocks (and the `.mdc` file if only ours remains); keeps the marker (identity is history) and says so.
- Exact block:
  ```markdown
  <!-- baglam:start -->
  ## Shared project context (Bağlam)
  This project uses Bağlam to share decisions between AI agents.
  - At the start of every task, call the `context_brief` tool with `project_path` set to the absolute path of this project folder, and follow what it returns.
  - When you settle a decision, learn a convention or a user preference, or hit a pitfall other agents should know about, call `context_propose` (same `project_path`). Use `supersedes` when it replaces an existing record.
  - Never put secrets, credentials or personal data in a proposal.
  <!-- baglam:end -->
  ```

- [ ] **Step 1: Failing tests:** `creates marker and instruction files`, `keeps existing CLAUDE.md content` (existing text unchanged above the block), `re-running init is a no-op` (all `unchanged`, same id), `moves path-keyed records to the new id` (approved record under `normalizeProject(dir)` → visible under the marker id afterwards), `writes GEMINI.md and cursor rule only when those tools are detected`, `undo removes blocks but keeps the marker`, `refuses the home folder` (throws `/cannot be a project/`), `cli: init prints the project id and files`.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** `npx vitest run` → PASS.
- [ ] **Step 5: Commit** `feat(cli): baglam init with instruction blocks and record migration`.

### Task 5: `baglam doctor`

**Files:** Create `src/doctor.ts`; modify `src/cli.ts` (command `doctor`). Test `test/doctor.test.ts`.

**Interfaces:**
- Produces: `type Check = { name: string; ok: boolean; detail: string; fix?: string }`; `runDoctor(opts: { host: HostEnv; dbPath: string; cwd: string; handshake?: (entry) => Promise<string | null> }): Promise<Check[]>` (handshake returns an error message or null; default spawns the entry with `StdioClientTransport`, 10 s timeout, expects the 4 tools).
- Checks, in order: Node ≥ 22.13; database opens and schema = `SCHEMA_VERSION`; per detected client: registered (fix: `baglam setup`), entry points at this install's `cliPath` (fix: `baglam setup`), handshake ok; current folder: project resolved and initialised (fix: `baglam init`); instruction block present in `AGENTS.md` (fix: `baglam init`).
- CLI prints `✓`/`✗` lines with fixes; exit code 1 if any check failed.

- [ ] **Step 1: Failing tests:** `all green on a set-up machine` (temp host, run setup+init first, stub handshake → null), `reports an unregistered client with the fix`, `reports a stale entry path`, `reports a failed handshake`, `reports an uninitialised folder`, `cli: doctor exits 1 on failure`.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** `npx vitest run` → PASS.
- [ ] **Step 5: Real-machine check:** `node dist/cli.js doctor` on this machine prints a line for each installed tool (expected before migration: Antigravity "entry points at …dist/mcp.js" stale → fix setup).
- [ ] **Step 6: Commit** `feat(cli): baglam doctor`.

---
After the milestone review: run `baglam setup` and `baglam init` (in `deneme`) on the owner's machine **with their go-ahead**, since that edits their real tool configs.
