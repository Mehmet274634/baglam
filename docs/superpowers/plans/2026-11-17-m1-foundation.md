# Bağlam v1.0 · Milestone 1: Foundation · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn v0.1 into a stable foundation: versioned schema with audit events and project identities, per-call project resolution (`project_path` → env → MCP roots → cwd) that never writes to a wrong or unsafe folder, a token-budgeted brief, and a single `baglam` binary.

**Architecture:** `ContextStore` stays the only DB gateway; a new `migrate.ts` owns schema versions. A new `project.ts` resolves a directory to a project key (marker id or normalised git root) with no DB access. `server.ts` resolves the project on every tool call from the call's `project_path`, env, cached client roots, or cwd.

**Tech Stack:** TypeScript 7, Node ≥ 22.13 (`node:sqlite`), `@modelcontextprotocol/sdk` 1.32, zod 4, vitest 5.

**Spec:** `docs/superpowers/specs/2026-11-17-baglam-v1-design.md` (sections 2, 3, 8; "Settled after builder review").

## Global Constraints
- Node ≥ 22.13; no native dependencies; no new runtime dependencies in this milestone.
- DB default path `~/.baglam/baglam.db`; env overrides `BAGLAM_DB`, `BAGLAM_PROJECT`, `BAGLAM_AGENT`, `BAGLAM_USER` keep working.
- Project marker file: `.baglam/project.json` = `{ "id": "<uuid>", "name": "<folder name>" }`.
- Brief token budget default 2,000 (estimate tokens as `ceil(chars / 4)`).
- Agents can never approve, reject, edit or delete. Records shown to agents keep the v0.1 framing text.
- Existing installs (`dist/mcp.js` registered in Claude Code and Antigravity) must keep working after rebuild.
- Every existing v0.1 test keeps passing (adjusted only where an interface intentionally changed).

## Review Focus
1. **v0.1 database opened by v1 code**: migrates in place, keeps every record, and a file-copy backup `baglam.db.v1-backup` exists afterwards. → Task 1 test `migrates a v0.1 file and keeps a backup`.
2. **Agent started from the home folder with no roots and no `project_path`**: reads say "project unknown", writes are refused, nothing is stored under the home path. → Task 4 test `refuses writes when the only candidate is the home folder`.
3. **Client sends two roots, both initialised**: propose is refused listing both; brief returns both, labelled. → Task 4 test `ambiguous roots`.
4. **`project_path` pointing to a subfolder of an initialised project** resolves to that project's id (walks up to the marker). → Task 2 test `walks up to the marker`.
5. **Corrupt or hand-edited `.baglam/project.json`** (invalid JSON, missing id): treated as not initialised with a warning in the brief, never a crash. → Task 2 test `ignores a corrupt marker`.

---

### Task 1: Versioned schema migrations

**Files:**
- Create: `src/migrate.ts`
- Modify: `src/store.ts` (replace inline `SCHEMA` exec with `migrate(db, path)`)
- Test: `test/migrate.test.ts`

**Interfaces:**
- Produces: `export const SCHEMA_VERSION = 2`; `migrate(db: DatabaseSync, filePath: string | ":memory:"): { from: number; to: number }`.
- v1 = the v0.1 schema exactly as in today's `store.ts` (entries + entries_fts + 3 triggers + index). A v0.1 DB has `user_version = 0` but an `entries` table: treat as version 1.
- v2 adds:
  - `projects(id TEXT PRIMARY KEY, name TEXT NOT NULL, last_path TEXT, created_at INTEGER NOT NULL, archived_at INTEGER)`
  - `events(seq INTEGER PRIMARY KEY AUTOINCREMENT, entry_id TEXT, project TEXT NOT NULL, type TEXT NOT NULL, actor TEXT NOT NULL, at INTEGER NOT NULL, detail TEXT)` + index on `entry_id`
  - `trust_rules(id TEXT PRIMARY KEY, project_id TEXT, agent TEXT, kind TEXT, created_at INTEGER NOT NULL)` (used in M3)
  - `entries.edited_at INTEGER`, `entries.auto_approved INTEGER NOT NULL DEFAULT 0`
- Before upgrading a file DB from a version ≥ 1, copy it to `<path>.v<from>-backup` (after `PRAGMA wal_checkpoint(TRUNCATE)`). Migrations run inside one transaction.

- [ ] **Step 1: Write failing tests** in `test/migrate.test.ts`:
  - `fresh in-memory db ends at SCHEMA_VERSION` → `PRAGMA user_version` = 2, tables `projects`, `events`, `trust_rules` exist.
  - `migrates a v0.1 file and keeps a backup` → create a temp file DB using the v1 SQL, insert one entry, run `new ContextStore(path)`; expect the entry readable via `store.get`, `user_version` = 2, `existsSync(path + ".v1-backup")`.
  - `is idempotent` → opening the same file twice returns `{from: 2, to: 2}` and creates no new backup.
  - `refuses a newer schema` → set `user_version = 99`; `new ContextStore(path)` throws `/newer version of Bağlam/`.
- [ ] **Step 2: Run** `npx vitest run test/migrate.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement** `src/migrate.ts` as an ordered array of `(db) => void` steps indexed by target version; wire into `ContextStore` constructor; extend `Entry` with `editedAt: number | null` and `autoApproved: boolean`.
- [ ] **Step 4: Run** `npx vitest run` → all PASS.
- [ ] **Step 5: Commit** `feat(store): versioned schema migrations with backup`.

### Task 2: Project identity (filesystem)

**Files:**
- Create: `src/project.ts`
- Modify: `src/config.ts` (keep `normalizeProject`, `findProjectRoot`; `resolveProject` becomes a thin wrapper over `resolveDirectory` for the CLI)
- Test: `test/project.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ProjectRef { key: string; name: string; dir: string; initialized: boolean; warning?: string }
  export function readMarker(dir: string): { id: string; name: string } | { error: string } | null
  export function resolveDirectory(dir: string): ProjectRef      // walk up to marker, else git root, else dir
  export function createMarker(dir: string): ProjectRef          // writes .baglam/project.json (uuid via crypto.randomUUID), idempotent
  export function isUnsafeProjectDir(dir: string): boolean       // home dir, filesystem root, Bağlam's own install dir
  ```
- `key` = marker id when initialised, else `normalizeProject(gitRootOrDir)` (v0.1 key, so existing records stay reachable).
- `name` = marker name, else folder basename.

- [ ] **Step 1: Write failing tests** (temp dirs via `mkdtempSync`):
  - `uses the marker id as key` → `createMarker(d)` then `resolveDirectory(d).key` equals the id in the file; `initialized` true.
  - `walks up to the marker` → `resolveDirectory(join(d, "src/deep"))` returns the same key and `dir === d`.
  - `falls back to git root then dir` → folder with `.git` and no marker → key `normalizeProject(gitRoot)`, `initialized` false.
  - `ignores a corrupt marker` → marker content `{oops`; `resolveDirectory(d).initialized` false and `warning` matches `/project.json/`.
  - `createMarker is idempotent` → two calls return the same key.
  - `isUnsafeProjectDir` → true for `os.homedir()`, `path.parse(process.cwd()).root`, and the package root; false for a temp dir.
- [ ] **Step 2: Run** `npx vitest run test/project.test.ts` → FAIL.
- [ ] **Step 3: Implement** `src/project.ts`. Package root = `dirname(dirname(fileURLToPath(import.meta.url)))`. Compare paths through `normalizeProject`.
- [ ] **Step 4: Run** `npx vitest run` → PASS.
- [ ] **Step 5: Commit** `feat(project): marker-based project identity`.

### Task 3: Audit events, projects table, edit

**Files:**
- Modify: `src/store.ts`
- Test: `test/store.test.ts` (add cases)

**Interfaces:**
- Produces on `ContextStore`:
  - `touchProject(ref: { key: string; name: string; dir: string }): void` (upsert into `projects`, update `last_path`/`name`; only for initialised projects, i.e. keys that are UUIDs)
  - `edit(id: string, patch: Partial<Pick<NewEntry, "title"|"body"|"rationale"|"tags"|"audience"|"kind">>, by: string): Entry` (allowed on `proposed` and `approved`; sets `edited_at`)
  - `history(id: string): { type: EventType; actor: string; at: number; detail: string | null }[]` (oldest first)
  - `export type EventType = "proposed" | "approved" | "rejected" | "superseded" | "edited" | "expired" | "deleted"`
- Every existing state change writes an event in the same transaction (`propose`→proposed, `approve`→approved and the old entry's superseded, `reject`→rejected with note as detail, `edit`→edited with changed field names as detail, `addApproved`→proposed+approved by the human).

- [ ] **Step 1: Write failing tests:**
  - `records history for propose → approve → supersede` → old entry history types `["proposed","approved","superseded"]`, actors `["claude-code","human","human"]`.
  - `edit updates fields, FTS and history` → edit body to contain "zebra"; `search(P, "x", "zebra")` finds it (after approval); history ends with `edited`, detail `"body"`.
  - `edit refuses rejected/superseded` → throws `/cannot edit/`.
  - `touchProject upserts` → twice with new name; `SELECT name FROM projects` returns the latest.
- [ ] **Step 2: Run** `npx vitest run test/store.test.ts` → FAIL.
- [ ] **Step 3: Implement** in `store.ts`; route all writes through the existing `transaction()` helper.
- [ ] **Step 4: Run** `npx vitest run` → PASS.
- [ ] **Step 5: Commit** `feat(store): audit events, project registry, edit`.

### Task 4: Per-call project resolution in the MCP server

**Files:**
- Create: `src/resolve.ts`
- Modify: `src/server.ts`, `src/format.ts`
- Test: `test/resolve.test.ts`, `test/server.test.ts`

**Interfaces:**
- Consumes: `resolveDirectory`, `isUnsafeProjectDir` (Task 2); `touchProject` (Task 3).
- Produces:
  ```ts
  export type Resolution =
    | { ok: true; project: ProjectRef; via: "project_path" | "env" | "roots" | "cwd" }
    | { ok: false; reason: "unknown" | "ambiguous"; candidates: ProjectRef[]; message: string }
  export function resolveProjectFor(input: { projectPath?: string; env?: string; roots?: string[]; cwd: string }): Resolution
  ```
  Order: `projectPath` → `env` → roots → cwd. Unsafe dirs are dropped at every step. Roots: map each `file://` URI to a path (`fileURLToPath`), resolve each; keep distinct keys; if more than one remains, prefer the initialised ones; still more than one → `ambiguous`. Nothing left → `unknown`.
- `ServerOptions` changes to `{ cwd: string; envProject?: string; agent?: string }` (replaces `project`). `mcp.ts` passes `process.cwd()` and `BAGLAM_PROJECT`.
- Roots: when the client declares the `roots` capability, call `server.server.listRoots()` lazily on the first tool call, cache, and clear the cache on `notifications/roots/list_changed`. A failed `listRoots` call counts as no roots.
- Every tool gains `project_path: z.string().optional().describe("Absolute path of your workspace folder")`.
- Writes (`context_propose`) on `ok:false` → tool error with `message`. Reads on `unknown` → normal text "Project unknown …pass project_path…"; `context_brief` on `ambiguous` → one labelled brief per initialised candidate.
- Successful resolution of an initialised project calls `store.touchProject`.

- [ ] **Step 1: Write failing tests** in `test/resolve.test.ts`:
  - `project_path wins over env and roots`.
  - `refuses writes when the only candidate is the home folder` → `resolveProjectFor({ cwd: homedir() })` is `{ok:false, reason:"unknown"}`.
  - `ambiguous roots` → two temp dirs each with a marker → `reason: "ambiguous"`, `candidates.length === 2`.
  - `prefers the initialised root` → one root with marker, one plain → `ok`, key = marker id, `via: "roots"`.
- [ ] **Step 2: Add failing tests** in `test/server.test.ts` (update `connect` to pass `{ cwd: dir }`; use a `Client` declaring `capabilities: { roots: { listChanged: true } }` and `client.setRequestHandler(ListRootsRequestSchema, …)`):
  - `uses client roots` → client returns root with a marker; propose; `store.pending(markerId)` has 1.
  - `project_path argument is honoured` → server cwd = homedir, call with `project_path: d` → stored under d's key.
  - `propose is refused when project is unknown` → server cwd = homedir, no roots → `isError`, text `/project_path/`; `store.projects()` empty.
  - `roots change is picked up` → change handler result, send `client.sendRootsListChanged()`, next propose lands in the new project.
- [ ] **Step 3: Run** `npx vitest run` → new tests FAIL.
- [ ] **Step 4: Implement** `src/resolve.ts` and update `server.ts`; brief header shows project name and how it was resolved.
- [ ] **Step 5: Run** `npx vitest run` → PASS.
- [ ] **Step 6: Commit** `feat(server): per-call project resolution with roots and project_path`.

### Task 5: Token-budgeted brief, brief resource, start prompt

**Files:**
- Modify: `src/format.ts`, `src/server.ts`
- Test: `test/format.test.ts`, `test/server.test.ts`

**Interfaces:**
- Produces: `formatBrief(input: { project: ProjectRef; agent: string; entries: Entry[]; pendingCount: number; budgetTokens?: number }): string` (default 2000). Order inside the budget: all warnings, then decisions, then remaining kinds, newest first within each. When records are cut: append `"N more record(s) not shown. Use context_search to find them."`. Uninitialised project: append the hint `"This project is not initialised. Suggest the user run: baglam init"`.
- MCP resource `baglam://brief` (text/markdown) = brief for cwd/env/roots resolution; MCP prompt `baglam_start` = a user message asking the agent to call `context_brief` and follow it.

- [ ] **Step 1: Write failing tests:**
  - `format: stays within budget and reports the cut` → 300 entries of ~400 chars; `Math.ceil(out.length/4) <= 2000`; output contains `/more record\(s\) not shown/`.
  - `format: warnings survive truncation` → 300 facts + 1 warning; warning title present.
  - `format: uninitialised hint` → `initialized:false` → contains `baglam init`.
  - `server: lists brief resource and start prompt` → `client.listResources()` includes `baglam://brief`; `client.listPrompts()` includes `baglam_start`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `npx vitest run` → PASS.
- [ ] **Step 5: Commit** `feat(brief): token budget, resource and start prompt`.

### Task 6: Single `baglam` binary with `mcp` subcommand

**Files:**
- Modify: `src/cli.ts` (add `mcp` command that starts the stdio server), `src/mcp.ts` (export `startMcpServer(): Promise<void>`; when run directly, call it, so `dist/mcp.js` stays a working entry for existing configs), `package.json` (`bin` = `{ "baglam": "dist/cli.js" }` only; add `"files": ["dist"]`), `README.md` (registration examples use `baglam mcp`)
- Test: `test/stdio.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `baglam mcp` CLI command; `startMcpServer()`.

- [ ] **Step 1: Write failing test** `test/stdio.test.ts`, which builds first (`beforeAll` runs `npm run build`, timeout 60 s), then for each entry `["dist/cli.js","mcp"]` and `["dist/mcp.js"]`: spawn via `StdioClientTransport` with `BAGLAM_DB` = temp file and `BAGLAM_PROJECT` = temp dir, call `context_propose`, expect a `"Proposed c"` text.
- [ ] **Step 2: Run** `npx vitest run test/stdio.test.ts` → FAIL for `cli.js mcp`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run typecheck && npx vitest run` → all PASS.
- [ ] **Step 5: Manual check:** `claude mcp get baglam` shows Connected; the Antigravity config entry starts and returns a brief (same check script as v0.1 handover).
- [ ] **Step 6: Commit** `feat(cli): single baglam binary with mcp subcommand`.

---

Later milestones (each gets its own plan when reached): M2 `setup`/`init`/`doctor` (incl. migrating v0.1 path-keyed records to marker ids, removing Antigravity's pin), M3 guards and trust rules, M4 review panel, M5 export/import, perf, CI, docs, landing page.
