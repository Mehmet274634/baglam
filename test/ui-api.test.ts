import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { EVENT_TYPES } from "../src/portable.js";
import { apiHarness, type ApiHarness } from "./ui-helpers.js";

const A = "11111111-2222-4333-8444-555555555555";
const AWS = ["AKIA", "IOSFODNN7EXAMPLE"].join("");

describe("panel API", () => {
  let h: ApiHarness;
  beforeEach(async () => {
    h = await apiHarness();
    h.store.touchProject({ key: A, name: "app", dir: "c:/work/app" });
  });
  afterEach(() => h.close());

  const propose = (title = "Use pnpm", extra: Record<string, unknown> = {}) =>
    h.store.propose({ project: A, kind: "convention", title, body: `${title} body`, sourceAgent: "claude-code", ...extra });

  it("overview lists user, projects, pending total and tools", async () => {
    mkdirSync(join(h.host.home, ".cursor"));
    propose();
    const r = await h.call("GET", "/api/overview");
    expect(r.status).toBe(200);
    expect(r.json.user).toBe("human:ev");
    expect(r.json.pendingTotal).toBe(1);
    expect(r.json.projects.map((p: { key: string }) => p.key)).toEqual([A]);
    expect(r.json.tools).toEqual([{ id: "cursor", label: "Cursor", registered: false, autoSave: { installed: false, lastSeen: null } }]);
    h.store.noteHookSeen("cursor", "start");
    const r2 = await h.call("GET", "/api/overview");
    expect(r2.json.tools[0].autoSave.lastSeen).toBeTypeOf("number");
  });

  it("pending includes similar records", async () => {
    const a = propose();
    const b = h.store.propose({ project: A, kind: "convention", title: "Use pnpm", body: "x", sourceAgent: "codex", similarTo: [a.id] });
    const r = await h.call("GET", `/api/pending?project=${A}`);
    const item = r.json.items.find((x: { id: string }) => x.id === b.id);
    expect(item.similar.map((s: { id: string }) => s.id)).toEqual([a.id]);
    expect((await h.call("GET", "/api/pending")).json.items).toHaveLength(2);
  });

  it("approve, reject and approve-all", async () => {
    const a = propose("One alpha");
    const b = propose("Two beta");
    const c = propose("Three gamma");
    expect((await h.call("POST", `/api/entries/${a.id}/approve`, { note: "ok" })).status).toBe(200);
    expect(h.store.get(a.id)?.decidedBy).toBe("human:ev");
    expect((await h.call("POST", `/api/entries/${b.id}/reject`, { note: "no" })).json.status).toBe("rejected");
    const late = propose("Four delta arrived later");
    const all = await h.call("POST", "/api/approve-all", { ids: [c.id] });
    expect(all.json).toEqual({ approved: 1, skipped: 0 });
    expect(h.store.get(c.id)?.status).toBe("approved");
    expect(h.store.get(late.id)?.status).toBe("proposed");
    expect((await h.call("POST", "/api/approve-all", { project: A })).status).toBe(400);
  });

  it("approving a decided proposal is a 409", async () => {
    const a = propose();
    await h.call("POST", `/api/entries/${a.id}/approve`, {});
    const again = await h.call("POST", `/api/entries/${a.id}/approve`, {});
    expect(again.status).toBe(409);
    expect(again.json.error).toMatch(/not pending/);
  });

  it("busy database is a 503 with a plain message", async () => {
    const { statusFor } = await import("../src/ui/http.js");
    expect(statusFor(new Error("database is locked"))).toBe(503);
    expect(statusFor(new Error("database table is locked"))).toBe(503);
  });

  it("edit and approve happen in one step", async () => {
    const a = propose();
    const r = await h.call("POST", `/api/entries/${a.id}/edit`, { patch: { body: "new" }, approve: true });
    expect(r.status).toBe(200);
    expect(h.store.history(a.id).map((x) => x.type)).toEqual(["proposed", "edited", "approved"]);
    expect(typeof h.store.editAndApprove).toBe("function");
  });

  it("unknown entry is a 404", async () => {
    expect((await h.call("POST", "/api/entries/cnope/approve", {})).status).toBe(404);
  });

  it("edit with a secret is 409 unless force; edit+approve in one go", async () => {
    const a = propose();
    const blocked = await h.call("POST", `/api/entries/${a.id}/edit`, { patch: { body: `key ${AWS}` } });
    expect(blocked.status).toBe(409);
    expect(blocked.json.secrets[0]).toMatchObject({ type: "AWS access key", masked: "AKIA…" });
    expect(h.store.get(a.id)?.body).toBe("Use pnpm body");
    const ok = await h.call("POST", `/api/entries/${a.id}/edit`, { patch: { body: "Use pnpm 9" }, approve: true });
    expect(ok.status).toBe(200);
    expect(h.store.get(a.id)).toMatchObject({ body: "Use pnpm 9", status: "approved" });
    const forced = await h.call("POST", `/api/entries/${a.id}/edit`, { patch: { body: `key ${AWS}` }, force: true });
    expect(forced.status).toBe(200);
  });

  it("retire and entry detail with history", async () => {
    const a = propose();
    h.store.approve(a.id, "human:ev");
    expect((await h.call("POST", `/api/entries/${a.id}/retire`, { note: "old" })).json.status).toBe("retired");
    const d = await h.call("GET", `/api/entries/${a.id}`);
    expect(d.json.entry.status).toBe("retired");
    expect(d.json.history.map((x: { type: string }) => x.type)).toEqual(["proposed", "approved", "retired"]);
  });

  it("records query", async () => {
    h.store.approve(propose("Zebra rule").id, "human:ev");
    propose("Pending lion");
    const r = await h.call("GET", `/api/records?project=${A}&status=active&q=zebra`);
    expect(r.json.total).toBe(1);
    expect(r.json.items[0].title).toBe("Zebra rule");
    expect((await h.call("GET", `/api/records?project=${A}&limit=1&offset=1`)).json.items).toHaveLength(1);
    expect((await h.call("GET", "/api/records?status=bogus")).status).toBe(400);
  });

  it("project rename, archive, restore", async () => {
    expect((await h.call("POST", `/api/projects/${A}/rename`, { name: "Main app" })).status).toBe(200);
    await h.call("POST", `/api/projects/${A}/archive`, {});
    expect((await h.call("GET", "/api/overview")).json.projects).toEqual([]);
    expect((await h.call("GET", "/api/projects?archived=1")).json.items[0]).toMatchObject({ name: "Main app", archived: true });
    await h.call("POST", `/api/projects/${A}/restore`, {});
    expect((await h.call("GET", "/api/overview")).json.projects[0].name).toBe("Main app");
  });

  it("delete needs the project name", async () => {
    h.store.approve(propose().id, "human:ev");
    expect((await h.call("DELETE", `/api/projects/${A}`, { confirm: "wrong" })).status).toBe(400);
    const ok = await h.call("DELETE", `/api/projects/${A}`, { confirm: "app" });
    expect(ok.json).toEqual({ deleted: 1 });
  });

  it("trust rules list/add/remove", async () => {
    const added = await h.call("POST", "/api/trust", { projectId: A, agent: "codex", kind: "fact" });
    expect(added.status).toBe(200);
    expect((await h.call("POST", "/api/trust", { projectId: null })).status).toBe(400);
    const list = await h.call("GET", `/api/trust?project=${A}`);
    expect(list.json.items.map((r: { id: string }) => r.id)).toEqual([added.json.id]);
    expect((await h.call("DELETE", `/api/trust/${added.json.id}`)).status).toBe(200);
    expect((await h.call("DELETE", `/api/trust/${added.json.id}`)).status).toBe(404);
  });
});

describe("panel API: handoffs and autonomous mode", () => {
  let h: ApiHarness;
  const A = "11111111-2222-4333-8444-555555555555";
  beforeEach(async () => {
    h = await apiHarness();
    h.store.touchProject({ key: A, name: "app", dir: "c:/work/app" });
  });
  afterEach(() => h.close());
  const enc = encodeURIComponent;

  it("lists live handoffs and shows one with history", async () => {
    h.store.checkpoint({ project: A, branch: "feature/pay", agent: "claude-code", goal: "Stripe checkout", next: ["tests"] });
    const list = await h.call("GET", `/api/handoffs?project=${A}`);
    expect(list.json.items.map((x: { goal: string }) => x.goal)).toEqual(["Stripe checkout"]);
    const one = await h.call("GET", `/api/handoffs/${enc(A)}/${enc("feature/pay")}`);
    expect(one.status).toBe(200);
    expect(one.json.handoff.goal).toBe("Stripe checkout");
    expect(one.json.history).toHaveLength(1);
    expect(one.json.git).toBeNull();
    const prompt = await h.call("GET", `/api/handoffs/${enc(A)}/${enc("feature/pay")}/prompt`);
    expect(prompt.json.text).toMatch(/continuing a task/);
    expect((await h.call("POST", `/api/handoffs/${enc(A)}/${enc("feature/pay")}/clear`, {})).status).toBe(200);
    expect(h.store.getHandoff(A, "feature/pay")?.status).toBe("done");
    expect((await h.call("GET", `/api/handoffs/${enc(A)}/nope`)).status).toBe(404);
  });

  it("autonomous switch per project", async () => {
    expect((await h.call("GET", `/api/projects/${enc(A)}/autonomous`)).json).toEqual({ on: false });
    expect((await h.call("POST", `/api/projects/${enc(A)}/autonomous`, { on: true })).json).toEqual({ on: true });
    expect(h.store.isAutonomous(A)).toBe(true);
    const projects = await h.call("GET", "/api/projects");
    expect(projects.json.items[0]).toMatchObject({ key: A, autonomous: true });
  });

  it("review list, keep and undo (with conflict message)", async () => {
    const share = (title: string, extra: Record<string, unknown> = {}) =>
      h.store.approve(h.store.propose({ project: A, kind: "decision", title, body: `${title} body`, sourceAgent: "codex", ...extra }).id, "autonomous-mode", undefined, { auto: true, review: true });
    const a = share("Use Vite");
    const b = share("Use Vitest");
    share("Use Vitest 3", { supersedes: b.id });
    const list = await h.call("GET", `/api/review?project=${A}`);
    // "Use Vitest" was replaced by "Use Vitest 3", so only active records are listed.
    expect(list.json.items.map((e: { title: string }) => e.title).sort()).toEqual(["Use Vite", "Use Vitest 3"]);
    expect((await h.call("POST", "/api/review/keep", { ids: [a.id] })).json).toEqual({ kept: 1 });
    const conflict = await h.call("POST", `/api/entries/${b.id}/undo`, {});
    expect(conflict.status).toBe(409);
    expect(conflict.json.error).toMatch(/first/);
    const notAuto = h.store.addApproved({ project: A, kind: "fact", title: "t", body: "b" }, "human");
    expect((await h.call("POST", `/api/entries/${notAuto.id}/undo`, {})).status).toBe(409);
  });
});

describe("panel API: automatic saving", () => {
  let h: ApiHarness;
  const A = "11111111-2222-4333-8444-555555555555";
  beforeEach(async () => {
    h = await apiHarness();
    h.store.touchProject({ key: A, name: "app", dir: "c:/work/app" });
  });
  afterEach(() => h.close());

  it("switch per project", async () => {
    const enc = encodeURIComponent;
    expect((await h.call("GET", `/api/projects/${enc(A)}/capture`)).json).toEqual({ on: true });
    expect((await h.call("POST", `/api/projects/${enc(A)}/capture`, { on: false })).json).toEqual({ on: false });
    expect(h.store.isAutoCapture(A)).toBe(false);
    expect((await h.call("POST", `/api/projects/${enc(A)}/capture`, { on: "yes" })).status).toBe(400);
  });

  it("panel i18n defines a label for every history event the store writes", () => {
    const src = readFileSync(join(import.meta.dirname, "..", "ui", "src", "i18n.tsx"), "utf8");
    for (const type of EVENT_TYPES) {
      expect(src, type).toContain(`"history.${type}":`);
    }
  });

  it("overview caches slow tool probes (like claude mcp get) while keeping pendingTotal and hook lastSeen live", async () => {
    const { testHost } = await import("./helpers.js");
    let claudeCalls = 0;
    const host = testHost({
      commands: {
        claude: (args) => {
          if (args[1] === "get") claudeCalls++;
          return { code: 0, stdout: `Command: C:/node/node.exe\nArgs: C:/baglam/dist/cli.js mcp\nBAGLAM_AGENT=claude-code\n` };
        },
      },
    });
    const h2 = await apiHarness(host);
    try {
      h2.store.touchProject({ key: A, name: "app", dir: "c:/work/app" });
      const p = h2.store.propose({ project: A, kind: "fact", title: "T", body: "B", sourceAgent: "codex" });
      const r1 = await h2.call("GET", "/api/overview");
      expect(r1.json.pendingTotal).toBe(1);
      expect(r1.json.tools[0].registered).toBe(true);
      expect(claudeCalls).toBe(1);

      // Approving + new hook_seen updates immediately without re-spawning claude CLI.
      await h2.call("POST", `/api/entries/${p.id}/approve`, {});
      h2.store.noteHookSeen("claude-code", "prompt");
      const r2 = await h2.call("GET", "/api/overview");
      expect(r2.json.pendingTotal).toBe(0);
      expect(r2.json.tools[0].autoSave.lastSeen).toBeTypeOf("number");
      expect(claudeCalls).toBe(1);

      // Explicit ?fresh=1 bypasses the cache.
      await h2.call("GET", "/api/overview?fresh=1");
      expect(claudeCalls).toBe(2);
    } finally {
      await h2.close();
    }
  });
});
