# Bağlam v1.0 · Milestone 4: Review panel · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `baglam ui` opens a fast, calm local web panel where the owner reviews proposals (approve, edit & approve, reject), manages records, projects and trust rules, and sees which tools are connected, live and in Turkish or English.

**Architecture:** `src/ui/server.ts` is a dependency-free `node:http` server bound to 127.0.0.1 that serves a JSON API over `ContextStore` plus the built static app, with a one-time-token → HttpOnly-cookie login, Host/Origin checks and server-sent events driven by SQLite's `PRAGMA data_version`. The app lives in `ui/` (Preact + Vite) and is built into `dist/ui`, shipped in the npm package; no runtime CDN.

**Tech Stack:** Node ≥ 22.13, `node:http`, Preact 10, Vite (dev dependency only), vitest.

**Spec:** `docs/superpowers/specs/2026-11-17-baglam-v1-design.md` §6 (panel), §4 (secret warnings for humans, audit trail), "Settled after builder review" (project archive/delete).

## Global Constraints
- Bind `127.0.0.1` only; free port unless `--port`; open the browser unless `--no-open`; Ctrl+C stops it.
- Auth: one-time token in the opened URL (`/?t=<token>`), exchanged once for an HttpOnly, `SameSite=Strict` session cookie; every `/api/*` call needs the cookie. Reject requests whose `Host` is not `127.0.0.1:<port>` / `localhost:<port>`; reject state-changing requests whose `Origin` is present and not the panel's own origin.
- Human writes in the panel run the same secret scan as `baglam add`; findings come back as HTTP 409 with the masked list, and the UI asks to confirm (`force: true`).
- Every state change writes an event (existing store behaviour); actor = `BAGLAM_USER` or `human:<os user>`.
- UI language follows `navigator.language` (`tr*` → Turkish, else English) with a switch; theme follows `prefers-color-scheme`. Keyboard on Inbox: `j`/`k` move, `a` approve, `e` edit, `r` reject.
- Removing a project archives it (restorable); permanent delete is a separate confirmed action that keeps `events`.

## Review Focus
1. **Another website open in the same browser** posting to the panel's port (CSRF / DNS rebinding): refused. → Task 2 tests `rejects foreign Origin`, `rejects foreign Host`.
2. **Reusing the opened URL** (shared screenshot, browser history): the token works once. → Task 2 test `token is single-use`.
3. **Two panels or CLI approving the same proposal at once**: second action gets a clear 409, not a 500. → Task 3 test `approving a decided proposal is a 409`.
4. **Very long bodies, Markdown-looking text or HTML in records**: shown as text, never injected as HTML. → Task 4: the app renders text nodes only (no `dangerouslySetInnerHTML`); test `renders record text as text`.
5. **Panel left open while agents propose**: inbox updates within ~2 s without reload. → Task 2 test `sends an event after a change from another connection`.

---

### Task 1: Store additions

**Files:** Modify `src/store.ts`. Test `test/store-panel.test.ts`.

**Interfaces (Produces):**
- `Status` gains `"retired"`; `EventType` gains `"retired" | "archived" | "restored"`.
- `retire(id: string, by: string, note?: string): Entry`: approved → retired (hidden from agents), event `retired`.
- `listProjects(opts?: { includeArchived?: boolean }): ProjectRow[]` with `interface ProjectRow { key: string; name: string; path: string | null; archived: boolean; approved: number; pending: number; lastActivity: number | null }` covering both registered (UUID) projects and path-keyed ones that have entries.
- `renameProject(id: string, name: string): void`, `archiveProject(id: string, by: string): void`, `restoreProject(id: string, by: string): void`, `deleteProject(key: string, by: string): number` (deletes entries, keeps events, writes one `deleted` event per entry).
- `query(opts: { project?: string; status?: Status | "active"; kind?: Kind; agent?: string; text?: string; limit?: number; offset?: number }): { items: Entry[]; total: number }` for the Records screen (`"active"` = approved and unexpired).
- `dataVersion(): number` (`PRAGMA data_version`, changes when another connection commits).

- [ ] **Step 1: Failing tests** for each method (`retire hides from agents and logs`, `retire refuses non-approved`, `listProjects covers uuid and path projects with counts`, `archive hides from default list and restore brings back`, `delete removes entries keeps events`, `query filters and paginates`, `query text search`, `dataVersion changes after another connection writes`).
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** `npx vitest run` → PASS. **Step 5: Commit** `feat(store): panel queries, retire, project management`.

### Task 2: HTTP server, security, live events

**Files:** Create `src/ui/server.ts`, `src/ui/http.ts` (tiny router, JSON helpers, static files). Test `test/ui-server.test.ts`.

**Interfaces (Produces):**
```ts
export interface PanelOptions { store: ContextStore; user: string; host: HostEnv; dbPath: string; port?: number; staticDir: string; pollMs?: number }
export interface Panel { url: string /* with ?t=token */; port: number; close(): Promise<void> }
export function startPanel(o: PanelOptions): Promise<Panel>
```
- `GET /?t=<token>`: valid unused token → `Set-Cookie: baglam_session=<random 32 bytes hex>; HttpOnly; SameSite=Strict; Path=/` and 302 to `/`. Reused/invalid token without a session → 403 page "Open the panel again with `baglam ui`".
- Static: `/` and unknown non-API paths → `index.html`; assets from `staticDir` with correct content types; `Cache-Control: no-store` for HTML.
- `GET /api/events`: SSE; sends `event: change` whenever `store.dataVersion()` (polled every `pollMs`, default 1000) changes; heartbeat comment every 25 s.
- Errors: thrown `Error` → 400 `{error}`; "not pending"/"cannot edit" → 409; unknown entry → 404; unexpected → 500 with a generic message.

- [ ] **Step 1: Failing tests** (start on port 0 with a temp static dir containing `index.html`): `token is single-use`, `api needs the session cookie`, `rejects foreign Host`, `rejects foreign Origin on POST`, `allows same-origin POST`, `serves index.html for app routes`, `sends an event after a change from another connection` (second `ContextStore` on the same temp DB file writes; SSE receives `change` within 3 s).
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** `npx vitest run` → PASS. **Step 5: Commit** `feat(ui): secure local panel server with live events`.

### Task 3: Panel API

**Files:** Create `src/ui/api.ts`; wire into `src/ui/server.ts`. Test `test/ui-api.test.ts`.

**Endpoints (JSON):**
| Method & path | Does |
|---|---|
| `GET /api/overview` | `{ user, projects: ProjectRow[], pendingTotal, tools: {id,label,registered,ok}[] }` (tools from `detectClients` + `status`, no handshake) |
| `GET /api/pending?project=` | pending entries (all projects when omitted) incl. `similar: Entry[]` resolved from `similarTo` |
| `POST /api/entries/:id/approve` `{note?}` | approve |
| `POST /api/entries/:id/reject` `{note?}` | reject |
| `POST /api/entries/:id/edit` `{patch, approve?: boolean, force?: boolean}` | secret-scan patch (409 `{secrets}` unless force) → `edit` → optionally `approve` |
| `POST /api/entries/:id/retire` `{note?}` | retire |
| `POST /api/approve-all` `{project}` | approve every pending in project; returns count |
| `GET /api/records?project&status&kind&agent&q&limit&offset` | `query` |
| `GET /api/entries/:id` | entry + `history` |
| `POST /api/projects/:id/rename` `{name}` · `/archive` · `/restore` · `DELETE /api/projects/:key` `{confirm: "<project name>"}` | project management |
| `GET/POST /api/trust`, `DELETE /api/trust/:id` | trust rules (`{projectId|null, agent?, kind?}`) |

- [ ] **Step 1: Failing tests:** one per endpoint happy path, plus `approving a decided proposal is a 409`, `edit with a secret is 409 unless force`, `delete needs the project name`, `pending includes similar records`.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** `npx vitest run` → PASS. **Step 5: Commit** `feat(ui): panel API`.

### Task 4: The app and `baglam ui`

**Files:** Create `ui/index.html`, `ui/vite.config.ts`, `ui/src/main.tsx`, `ui/src/api.ts`, `ui/src/i18n.ts`, `ui/src/app.tsx`, `ui/src/screens/{Inbox,Records,Projects,Settings}.tsx`, `ui/src/components/*.tsx`, `ui/src/styles.css`; modify `package.json` (`build` = `tsc && vite build ui` into `dist/ui`; devDeps `preact`, `vite`, `@preact/preset-vite`, `@testing-library/preact`, `jsdom`), `src/cli.ts` (`ui [--port n] [--no-open]`). Test `test/ui-app.test.tsx` (jsdom).

**Behaviour:**
- Layout: left rail (Inbox with pending badge, Records, Projects, Settings), project switcher at top (All projects + each project), content area.
- Inbox: cards (kind chip, title, body, why, source agent, relative time, duplicate panel listing similar records side by side); actions Approve, Edit & approve (inline form), Reject (note field), Approve all; keyboard j/k/a/e/r; toast with undo-free confirmation text; empty state teaches the first step.
- Records: search box, filters (kind, agent, status), list with expand to history; edit, retire.
- Projects: counts, last activity, rename, archive/restore, delete (type the name to confirm).
- Settings: trust rules (add/remove with plain-language preview of the rule), language switch, connected tools list with "run `baglam setup`" hint for missing ones.
- Live: `EventSource('/api/events')` → refetch current screen; desktop notification for new proposals when permission granted (asked from Settings, never on load).
- Strings: every user-visible string in `i18n.ts` (`tr`, `en`); no hard-coded copy in components.
- `baglam ui`: starts the panel, prints the URL, opens it with the OS opener (`start ""`/`open`/`xdg-open`) unless `--no-open`.

- [ ] **Step 1: Failing tests:** `i18n has the same keys in tr and en`, `picks Turkish for tr-TR`, `renders record text as text` (body `<img src=x onerror=alert(1)>` appears as text, no `img` element), `inbox keyboard: j/k move, a approves the selected card` (mocked api), `edit with a secret asks for confirmation`.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** `npm run build && npx vitest run` → PASS.
- [ ] **Step 5: Browser check:** start `baglam ui --no-open` against a temp DB seeded with proposals, open the URL in the browser pane, check Inbox approve/edit/reject, Records search, Projects, Settings, dark mode, mobile width; fix what looks wrong.
- [ ] **Step 6: Commit** `feat(ui): review panel app and baglam ui`.
